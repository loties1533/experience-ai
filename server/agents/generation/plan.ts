import { z } from 'zod';
import {
  ContextePlanifiableSchema,
  type ContextePlanifiable,
  type EtapePlanifiable,
} from './contratPreparation.js';
import {
  CandidatEvenementEventFirstSchema,
  type CandidatEvenementEventFirst,
} from '../../services/rechercheExterne.js';

// --- PR2 : contexte préparé → plan déterministe de lots ---
// Ce module ne connaît ni Brief, ni fournisseur, ni LLM. Les étapes y sont
// déjà décidées par la préparation ; il ne fait que les découper en lots.

const JOURS_MAX_PAR_LOT = 5;

const PlageJoursSchema = z
  .object({ debut: z.iso.date(), fin: z.iso.date() })
  .strict()
  .refine((plage) => plage.debut <= plage.fin, {
    message: 'le début doit précéder ou égaler la fin',
  });

export const LotPrevuSchema = z
  .object({
    id: z.string().min(1),
    ville: z.string().min(1),
    plage: PlageJoursSchema.optional(),
    ancres: z.array(CandidatEvenementEventFirstSchema).default([]),
  })
  .strict();

const TransitionPlanifieeSchema = z
  .object({
    origine: z.string().min(1),
    destination: z.string().min(1),
  })
  .strict();

const PlanGenerationSchema = z
  .object({
    lots: z.array(LotPrevuSchema).min(1),
    transitions: z.array(TransitionPlanifieeSchema).default([]),
  })
  .strict();

export type PlanGeneration = z.infer<typeof PlanGenerationSchema>;
export type LotPrevu = PlanGeneration['lots'][number];
export type TransitionPlanifiee = PlanGeneration['transitions'][number];

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

function plagesDepuisEtape(
  etape: EtapePlanifiable,
  plageParDefaut: { debut: string; fin: string } | undefined
): { debut: string; fin: string } | undefined {
  return etape.plage ?? plageParDefaut;
}

/** Découpe une plage inclusive en blocs équilibrés de 2 à 5 jours. */
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

function transitionsDepuisEtapes(
  etapes: EtapePlanifiable[]
): TransitionPlanifiee[] {
  const transitions: TransitionPlanifiee[] = [];
  for (let index = 1; index < etapes.length; index += 1) {
    const origine = etapes[index - 1].ville.nom;
    const destination = etapes[index].ville.nom;
    if (origine !== destination) {
      transitions.push({ origine, destination });
    }
  }
  return transitions;
}

function lotsSansPlage(etapes: EtapePlanifiable[]): PlanGeneration['lots'] {
  return etapes.map((etape, index) => ({
    id: `lot-${index}`,
    ville: etape.ville.nom,
    ancres: etape.ancres,
  }));
}

/**
 * Une ancre datée est rattachée à un unique lot : les deux bornes civiles
 * sont inclusives. Une ancre au premier ou au dernier jour appartient donc à
 * ce lot, jamais au voisin.
 */
function ancresDuLot(
  ancres: CandidatEvenementEventFirst[],
  plage: { debut: string; fin: string } | undefined
): CandidatEvenementEventFirst[] {
  if (!plage) return ancres;
  return ancres.filter((ancre) => {
    const jour = ancre.dateDebut.slice(0, 10);
    return jour >= plage.debut && jour <= plage.fin;
  });
}

/**
 * Dérive les lots depuis les seules étapes préparées. Même entrée, même plan :
 * les identifiants sont des positions stables, jamais des UUID aléatoires.
 */
export function deriverPlan(contexteRecu: ContextePlanifiable): PlanGeneration {
  const contexte = ContextePlanifiableSchema.parse(contexteRecu);
  const etapes = contexte.etapes;

  const plageGlobale = contexte.contraintesConservees.dates
    ? {
        debut: contexte.contraintesConservees.dates.debut.slice(0, 10),
        fin: contexte.contraintesConservees.dates.fin.slice(0, 10),
      }
    : undefined;
  const transitions = transitionsDepuisEtapes(etapes);
  const plagesExplicites = etapes.map((etape) =>
    plagesDepuisEtape(etape, undefined)
  );
  if (plagesExplicites.some((plage) => plage !== undefined)) {
    const lots: PlanGeneration['lots'] = [];
    etapes.forEach((etape, index) => {
      const plage = plagesExplicites[index] ?? plageGlobale;
      if (!plage) {
        lots.push({
          id: `lot-${lots.length}`,
          ville: etape.ville.nom,
          ancres: etape.ancres,
        });
        return;
      }
      for (const bloc of decouperEnBlocsDeJours(plage.debut, plage.fin)) {
        lots.push({
          id: `lot-${lots.length}`,
          ville: etape.ville.nom,
          plage: bloc,
          ancres: ancresDuLot(etape.ancres, bloc),
        });
      }
    });
    return PlanGenerationSchema.parse({ lots, transitions });
  }

  if (!plageGlobale) {
    return PlanGenerationSchema.parse({ lots: lotsSansPlage(etapes), transitions });
  }

  if (etapes.length === 1) {
    const lots = decouperEnBlocsDeJours(plageGlobale.debut, plageGlobale.fin).map(
      (plage, index) => ({
        id: `lot-${index}`,
        ville: etapes[0].ville.nom,
        plage,
        ancres: ancresDuLot(etapes[0].ancres, plage),
      })
    );
    return PlanGenerationSchema.parse({ lots, transitions });
  }

  const totalJours =
    numeroDeJour(plageGlobale.fin) - numeroDeJour(plageGlobale.debut) + 1;
  if (totalJours < 2 * etapes.length) {
    return PlanGenerationSchema.parse({ lots: lotsSansPlage(etapes), transitions });
  }

  const premier = numeroDeJour(plageGlobale.debut);
  const base = Math.floor(totalJours / etapes.length);
  const reste = totalJours % etapes.length;
  const lots: PlanGeneration['lots'] = [];
  let curseur = premier;
  etapes.forEach((etape, index) => {
    const taille = base + (index < reste ? 1 : 0);
    const finTranche = curseur + taille - 1;
    for (const plage of decouperEnBlocsDeJours(
      dateCivileDepuisNumero(curseur),
      dateCivileDepuisNumero(finTranche)
    )) {
      lots.push({
        id: `lot-${lots.length}`,
        ville: etape.ville.nom,
        plage,
        ancres: ancresDuLot(etape.ancres, plage),
      });
    }
    curseur = finTranche + 1;
  });
  return PlanGenerationSchema.parse({ lots, transitions });
}
