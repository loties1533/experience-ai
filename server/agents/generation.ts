import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { callAI, parseJSON } from '../services/claude/core.js';
import { AppError } from '../lib/AppError.js';
import {
  ParcoursSchema,
  PlageHoraireSchema,
  TypeElementSchema,
  validerParcours,
  type Parcours,
} from '../domaine/parcours/index.js';
import type { Brief } from './brief.js';

// L'ORCHESTRATEUR (IA n°1) : brief confirmé → parcours complet, en une passe.
// À ne pas confondre avec l'agent Modification (IA n°2, modification.ts) qui
// n'agit qu'à l'intérieur d'un parcours existant, jamais sur l'ensemble.
//
// Ne jamais faire confiance au LLM : sa sortie est revalidée champ par champ,
// les ids sont attribués ICI (jamais par le modèle), les dépendances vers des
// refs inconnues sont écartées, et le parcours final repasse par les
// invariants du domaine avant de sortir.

const SYSTEM_GENERATION = `Tu construis un parcours personnalisé : un ensemble cohérent de moments autour d'une intention et d'un contexte.
Réponds UNIQUEMENT en JSON valide : {"ambiance": string, "moments": [...]}.
- Chaque moment : {"titre": string, "elements": [...]}.
- Chaque élément : {"ref": string (identifiant court unique, ex "resto-soir-1"), "type": "activite"|"restaurant"|"transport"|"hebergement"|"evenement"|"temps_libre", "nom": string, "lieu": string, "plage": {"debut": ISO, "fin": ISO} (optionnel), "prix": number en euros (optionnel), "justification": string (POURQUOI cet élément sert l'intention — obligatoire), "dependDe": [refs] (optionnel), "estAncre": boolean (optionnel).
- Prévois des temps libres assumés (la respiration).
- Reste dans le budget si fourni. Jamais de lien de réservation.`;

const ElementGenereSchema = z.object({
  ref: z.string().min(1),
  type: TypeElementSchema,
  nom: z.string().min(1),
  lieu: z.string().optional(),
  plage: PlageHoraireSchema.optional(),
  prix: z.number().nonnegative().optional(),
  justification: z.string().min(1),
  dependDe: z.array(z.string()).default([]),
  estAncre: z.boolean().default(false),
});

const SortieGenerationSchema = z.object({
  ambiance: z.string().optional(),
  moments: z
    .array(
      z.object({
        titre: z.string().min(1),
        plage: PlageHoraireSchema.optional(),
        elements: z.array(ElementGenereSchema).min(1),
      })
    )
    .min(1),
});

export async function genererParcours(brief: Brief): Promise<Parcours> {
  const prompt = `Construis un parcours pour ce brief :
${JSON.stringify(brief, null, 2)}`;

  const brut = await callAI(prompt, SYSTEM_GENERATION, 'pack');
  const sortie = SortieGenerationSchema.safeParse(parseJSON(brut));
  if (!sortie.success) {
    throw new AppError('La génération a produit un résultat inexploitable, réessayez', 502);
  }

  // Attribution des ids côté serveur : les refs du LLM ne sortent pas d'ici.
  const idParRef = new Map<string, string>();
  for (const moment of sortie.data.moments) {
    for (const element of moment.elements) {
      if (!idParRef.has(element.ref)) idParRef.set(element.ref, randomUUID());
    }
  }

  const parcours = ParcoursSchema.parse({
    id: randomUUID(),
    intention: { texte: brief.intention },
    contexte: { avecQui: brief.avecQui, duree: brief.duree, lieux: brief.lieux },
    participants: [{ id: randomUUID(), nom: 'Organisateur', role: 'organisateur' }],
    budget: { mode: 'individuel', montantTotal: brief.budgetTotal },
    ambiance: sortie.data.ambiance ?? brief.ambiance,
    timeline: sortie.data.moments.map((moment) => ({
      id: randomUUID(),
      titre: moment.titre,
      plage: moment.plage,
      elements: moment.elements.map((element) => ({
        id: idParRef.get(element.ref) as string,
        type: element.type,
        nom: element.nom,
        lieu: element.lieu,
        plage: element.plage,
        prix: element.prix,
        justification: element.justification,
        estAncre: element.estAncre,
        // Une dépendance vers une ref inventée est écartée, pas propagée.
        dependDe: element.dependDe
          .filter((ref) => idParRef.has(ref) && ref !== element.ref)
          .map((ref) => idParRef.get(ref) as string),
      })),
    })),
  });

  const erreurs = validerParcours(parcours);
  if (erreurs.length > 0) {
    throw new AppError('La génération a produit un parcours incohérent, réessayez', 502);
  }
  return parcours;
}
