import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Brief } from '../brief.js';

// --- F5 : plan de génération dérivé, puis génération progressive par lots ---
//
// Le plan (F5-A) découpe un parcours en lots par ville et par blocs de jours.
// F5-B le branche réellement : chaque lot est généré par son propre appel IA,
// restreint à sa ville et à sa plage, validé et namespacé, avant assemblage.
// L'ancien appel IA unique a disparu — le cas mono-lot emprunte exactement le
// même pipeline progressif.

const JOURS_MAX_PAR_LOT = 5;

const PlageJoursSchema = z
  .object({ debut: z.iso.date(), fin: z.iso.date() })
  .strict()
  .refine((plage) => plage.debut <= plage.fin, {
    message: 'le début doit précéder ou égaler la fin',
  });

const LotPrevuSchema = z
  .object({
    id: z.string().min(1),
    ville: z.string().min(1).optional(),
    plage: PlageJoursSchema.optional(),
  })
  .strict();

const PlanGenerationSchema = z
  .object({ lots: z.array(LotPrevuSchema).min(1) })
  .strict();

export type PlanGeneration = z.infer<typeof PlanGenerationSchema>;

export type LotPrevu = PlanGeneration['lots'][number];

// On raisonne en jours civils : seule la partie AAAA-MM-JJ compte, jamais
// l'heure ni un fuseau. Le numéro de jour est un simple indice entier continu.
export function numeroDeJour(dateCivile: string): number {
  const [annee, mois, jour] = dateCivile.split('-').map(Number);
  return Math.floor(Date.UTC(annee, mois - 1, jour) / 86_400_000);
}

function dateCivileDepuisNumero(numero: number): string {
  const date = new Date(numero * 86_400_000);
  const annee = date.getUTCFullYear().toString().padStart(4, '0');
  const mois = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const jour = date.getUTCDate().toString().padStart(2, '0');
  return `${annee}-${mois}-${jour}`;
}

/**
 * Découpe une plage de jours civils inclusifs en blocs équilibrés de 2 à 5
 * jours, sans trou ni chevauchement. Un unique jour disponible reste un seul
 * bloc d'un jour (cas légitime) ; au-delà, aucun bloc orphelin d'un jour n'est
 * produit — la répartition la plus égale possible l'empêche.
 */
function decouperEnBlocsDeJours(
  debut: string,
  fin: string
): { debut: string; fin: string }[] {
  const premier = numeroDeJour(debut);
  const dernier = numeroDeJour(fin);
  const totalJours = dernier - premier + 1;
  const nombreLots = Math.max(1, Math.ceil(totalJours / JOURS_MAX_PAR_LOT));
  const base = Math.floor(totalJours / nombreLots);
  const reste = totalJours % nombreLots;

  const blocs: { debut: string; fin: string }[] = [];
  let curseur = premier;
  for (let index = 0; index < nombreLots; index += 1) {
    const taille = base + (index < reste ? 1 : 0);
    const finBloc = curseur + taille - 1;
    blocs.push({
      debut: dateCivileDepuisNumero(curseur),
      fin: dateCivileDepuisNumero(finBloc),
    });
    curseur = finBloc + 1;
  }
  return blocs;
}

/**
 * Dérive le plan de génération à partir du seul brief, sans appel IA ni réseau.
 *
 * - Sans ville : un lot unique, sans étape géographique.
 * - Sans dates réelles : un lot par ville, sans plage (aucun jour attribuable).
 * - Une ville datée : la plage entière découpée en blocs de jours.
 * - Plusieurs villes datées : répartition contiguë et équilibrée des jours,
 *   puis blocs par ville — sauf si chaque ville ne peut recevoir deux jours,
 *   auquel cas on renonce aux plages plutôt que de créer un lot orphelin.
 */
export function deriverPlan(brief: Brief): PlanGeneration {
  const villes = brief.lieux;

  if (villes.length === 0) {
    return PlanGenerationSchema.parse({ lots: [{ id: randomUUID() }] });
  }

  if (!brief.dates) {
    return PlanGenerationSchema.parse({
      lots: villes.map((ville) => ({ id: randomUUID(), ville })),
    });
  }

  const debut = brief.dates.debut.slice(0, 10);
  const fin = brief.dates.fin.slice(0, 10);
  const totalJours = numeroDeJour(fin) - numeroDeJour(debut) + 1;

  if (villes.length === 1) {
    return PlanGenerationSchema.parse({
      lots: decouperEnBlocsDeJours(debut, fin).map((plage) => ({
        id: randomUUID(),
        ville: villes[0],
        plage,
      })),
    });
  }

  if (totalJours < 2 * villes.length) {
    return PlanGenerationSchema.parse({
      lots: villes.map((ville) => ({ id: randomUUID(), ville })),
    });
  }

  const premier = numeroDeJour(debut);
  const base = Math.floor(totalJours / villes.length);
  const reste = totalJours % villes.length;
  const lots: PlanGeneration['lots'] = [];
  let curseur = premier;
  villes.forEach((ville, index) => {
    const taille = base + (index < reste ? 1 : 0);
    const finTranche = curseur + taille - 1;
    for (const plage of decouperEnBlocsDeJours(
      dateCivileDepuisNumero(curseur),
      dateCivileDepuisNumero(finTranche)
    )) {
      lots.push({ id: randomUUID(), ville, plage });
    }
    curseur = finTranche + 1;
  });
  return PlanGenerationSchema.parse({ lots });
}
