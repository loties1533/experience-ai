import { z } from 'zod';
import { PlageHoraireSchema } from '../../domaine/parcours/index.js';
import { CandidatEvenementEventFirstSchema } from '../../services/rechercheExterne.js';

// Frontière métier placée avant la génération des lots. Elle ne décrit ni un
// plan détaillé ni une sortie de LLM : seulement si le brief peut poursuivre,
// doit être clarifié, ou relève d'un refus déjà connu du produit.

export const CodeClarificationGenerationSchema = z.enum([
  'zone_geographique_requise',
  'localisation_a_preciser',
]);

export const ChampCibleClarificationGenerationSchema = z.enum(['lieux']);

export const ClarificationGenerationSchema = z
  .object({
    code: CodeClarificationGenerationSchema,
    question: z.string().min(1),
    champCible: ChampCibleClarificationGenerationSchema,
  })
  .strict();

// Cet état reste frère du Brief. Il ne transporte que le contexte nécessaire
// pour que l'intake interprète la réponse suivante, jamais une donnée acquise.
export const EtatDialoguePreparationGenerationSchema = z
  .object({
    champ: z.literal('preparation_generation'),
    code: CodeClarificationGenerationSchema,
    champCible: ChampCibleClarificationGenerationSchema,
  })
  .strict();

const PlageJoursPlanifieeSchema = z
  .object({
    debut: z.iso.date(),
    fin: z.iso.date(),
  })
  .strict()
  .refine((plage) => plage.debut <= plage.fin, {
    message: 'le début doit précéder ou égaler la fin',
  });

export const VillePlanifieeSchema = z
  .object({
    nom: z.string().min(1),
    origine: z.enum(['utilisateur', 'fournisseur']),
  })
  .strict();

export const EtapePlanifiableSchema = z
  .object({
    ville: VillePlanifieeSchema.optional(),
    plage: PlageJoursPlanifieeSchema.optional(),
    ancres: z.array(CandidatEvenementEventFirstSchema).default([]),
  })
  .strict();

const ContraintesConserveesSchema = z
  .object({
    dates: PlageHoraireSchema.optional(),
    budgetTotal: z.number().positive().optional(),
  })
  .strict();

/**
 * Décisions de préparation, séparées des données déclarées dans le Brief.
 * La seconde stratégie est une compatibilité temporaire : elle conserve le
 * lot sans ville actuel jusqu'aux stratégies de découverte de PR3/PR4.
 */
export const ContextePlanifiableSchema = z
  .object({
    strategie: z.enum([
      'villes_du_brief',
      'decouverte_evenementielle',
      'compatibilite_sans_localisation',
    ]),
    etapes: z.array(EtapePlanifiableSchema).min(1),
    contraintesConservees: ContraintesConserveesSchema,
  })
  .strict()
  .superRefine((contexte, ajout) => {
    if (contexte.strategie === 'villes_du_brief') {
      if (contexte.etapes.some((etape) => etape.ville?.origine !== 'utilisateur')) {
        ajout.addIssue({
          code: 'custom',
          message: 'les étapes des villes du brief doivent avoir une origine utilisateur',
        });
      }
      if (contexte.etapes.some((etape) => etape.ville === undefined)) {
        ajout.addIssue({
          code: 'custom',
          message: 'les étapes des villes du brief exigent une ville',
        });
      }
    }
    if (contexte.strategie === 'decouverte_evenementielle') {
      if (
        contexte.etapes.some(
          (etape) =>
            etape.ville?.origine !== 'fournisseur' ||
            etape.plage === undefined ||
            etape.ancres.length === 0
        )
      ) {
        ajout.addIssue({
          code: 'custom',
          message:
            'la découverte événementielle exige une ville fournisseur, une plage et une ancre par étape',
        });
      }
      for (const etape of contexte.etapes) {
        if (!etape.ville || !etape.plage) continue;
        for (const ancre of etape.ancres) {
          const jourAncre = ancre.dateDebut.slice(0, 10);
          if (
            ancre.ville !== etape.ville.nom ||
            jourAncre < etape.plage.debut ||
            jourAncre > etape.plage.fin
          ) {
            ajout.addIssue({
              code: 'custom',
              message:
                'une ancre événementielle doit appartenir à la ville et à la plage de son étape',
            });
          }
        }
      }
    }
    if (contexte.strategie === 'compatibilite_sans_localisation') {
      const [etape] = contexte.etapes;
      if (
        contexte.etapes.length !== 1 ||
        etape.ville !== undefined ||
        etape.plage !== undefined ||
        etape.ancres.length !== 0
      ) {
        ajout.addIssue({
          code: 'custom',
          message: 'la compatibilité sans localisation ne porte aucun lieu, plage ou ancre',
        });
      }
    }
  });

export const RefusPreparationGenerationSchema = z
  .discriminatedUnion('code', [
    z
      .object({
        code: z.literal('donnees_essentielles_insuffisantes'),
        message: z.string().min(1),
      })
      .strict(),
    z
      .object({
        code: z.literal('hors_perimetre_produit'),
        message: z.string().min(1),
      })
      .strict(),
  ]);

export const ResultatCadrageGenerationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('planifiable'),
      contexte: ContextePlanifiableSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('clarification_requise'),
      clarification: ClarificationGenerationSchema,
      etatDialogue: EtatDialoguePreparationGenerationSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('refus'),
      refus: RefusPreparationGenerationSchema,
    })
    .strict(),
]);

export type ClarificationGeneration = z.infer<
  typeof ClarificationGenerationSchema
>;
export type EtatDialoguePreparationGeneration = z.infer<
  typeof EtatDialoguePreparationGenerationSchema
>;
export type EtapePlanifiable = z.infer<typeof EtapePlanifiableSchema>;
export type ContextePlanifiable = z.infer<typeof ContextePlanifiableSchema>;
export type ResultatCadrageGeneration = z.infer<
  typeof ResultatCadrageGenerationSchema
>;
