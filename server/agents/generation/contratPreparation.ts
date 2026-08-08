import { z } from 'zod';

// Frontière métier placée avant la génération des lots. Elle ne décrit ni un
// plan détaillé ni une sortie de LLM : seulement si le brief peut poursuivre,
// doit être clarifié, ou relève d'un refus déjà connu du produit.

export const CodeClarificationGenerationSchema = z.enum([
  'zone_geographique_requise',
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
  z.object({ type: z.literal('planifiable') }).strict(),
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
export type ResultatCadrageGeneration = z.infer<
  typeof ResultatCadrageGenerationSchema
>;
