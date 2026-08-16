import { z } from 'zod';

/**
 * Vocabulaire produit fermé pour cibler une recherche événementielle.
 * Les catégories propres à un fournisseur restent dans son adaptateur.
 */
export const NatureEvenementielleSchema = z.enum([
  'sport',
  'concert',
  'festival',
  'arts_de_la_scene',
  'communautaire',
]);

export type NatureEvenementielle = z.infer<
  typeof NatureEvenementielleSchema
>;
