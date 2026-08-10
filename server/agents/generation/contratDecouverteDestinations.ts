import { z } from 'zod';
import { FacetteDestinationSchema } from '../../services/destinations/index.js';

export const FormatDecouverteDestinationsSchema = z.enum([
  'sejour',
  'itineraire',
]);

export const CandidatDestinationProposeSchema = z
  .object({
    nom: z.string().trim().min(1).max(120),
    codePaysSuggere: z.string().regex(/^[A-Z]{2}$/).optional(),
  })
  .strict();

function normaliserNomCandidat(nom: string): string {
  return nom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Le modèle propose et classifie seulement. Les champs libres qui pourraient
 * ressembler à une preuve, un score, un prix ou une promesse sont refusés par
 * les objets stricts ; la vérification appartient exclusivement au serveur.
 */
export const PropositionDecouverteDestinationsSchema = z
  .object({
    format: FormatDecouverteDestinationsSchema,
    // Zéro est structurellement valide : le schéma ne doit jamais pousser le
    // modèle à fabriquer une facette. Le pipeline métier clarifie ces Briefs
    // avant l'appel LLM et vérifie ensuite chaque facette contre le Brief.
    facettesObligatoires: z.array(FacetteDestinationSchema).max(6),
    facettesSouples: z.array(FacetteDestinationSchema).max(6),
    candidats: z.array(CandidatDestinationProposeSchema).min(1).max(5),
  })
  .strict()
  .superRefine((proposition, ajout) => {
    const obligatoires = new Set(proposition.facettesObligatoires);
    if (obligatoires.size !== proposition.facettesObligatoires.length) {
      ajout.addIssue({
        code: 'custom',
        path: ['facettesObligatoires'],
        message: 'les facettes obligatoires doivent être distinctes',
      });
    }
    const souples = new Set(proposition.facettesSouples);
    if (souples.size !== proposition.facettesSouples.length) {
      ajout.addIssue({
        code: 'custom',
        path: ['facettesSouples'],
        message: 'les facettes souples doivent être distinctes',
      });
    }
    if ([...souples].some((facette) => obligatoires.has(facette))) {
      ajout.addIssue({
        code: 'custom',
        path: ['facettesSouples'],
        message: 'une facette ne peut pas être obligatoire et souple',
      });
    }

    const noms = proposition.candidats.map((candidat) =>
      normaliserNomCandidat(candidat.nom)
    );
    if (new Set(noms).size !== noms.length) {
      ajout.addIssue({
        code: 'custom',
        path: ['candidats'],
        message: 'les candidats doivent avoir des noms distincts',
      });
    }
  });

export type FormatDecouverteDestinations = z.infer<
  typeof FormatDecouverteDestinationsSchema
>;
export type CandidatDestinationPropose = z.infer<
  typeof CandidatDestinationProposeSchema
>;
export type PropositionDecouverteDestinations = z.infer<
  typeof PropositionDecouverteDestinationsSchema
>;
