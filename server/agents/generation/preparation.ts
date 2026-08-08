import type { Brief } from '../brief.js';
import {
  ResultatCadrageGenerationSchema,
  type ResultatCadrageGeneration,
} from './contratPreparation.js';

/**
 * Première frontière de préparation : elle ne découvre encore ni ville ni
 * événement. Un brief sans ville reste donc planifiable : les stratégies de
 * découverte ultérieures pourront le traiter sans casser la promesse produit.
 */
export function preparerGeneration(
  _brief: Brief
): ResultatCadrageGeneration {
  return ResultatCadrageGenerationSchema.parse({ type: 'planifiable' });
}
