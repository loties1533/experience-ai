import type { Brief } from '../brief.js';
import {
  ContextePlanifiableSchema,
  ResultatCadrageGenerationSchema,
  type ContextePlanifiable,
  type ResultatCadrageGeneration,
} from './contratPreparation.js';

/** Villes planifiées, sans les réécrire dans le Brief utilisateur. */
export function villesPlanifiees(
  contexte: ContextePlanifiable
): string[] {
  return contexte.etapes.flatMap((etape) =>
    etape.ville ? [etape.ville.nom] : []
  );
}

/**
 * Projection déterministe du brief confirmé vers le rail de planification.
 * Aucun fournisseur, aucune IA et aucune normalisation destructive ici.
 */
export function construireContextePlanifiable(
  brief: Brief
): ContextePlanifiable {
  const contraintesConservees = {
    ...(brief.dates ? { dates: brief.dates } : {}),
    ...(brief.budgetTotal === undefined
      ? {}
      : { budgetTotal: brief.budgetTotal }),
  };

  if (brief.lieux.length > 0) {
    return ContextePlanifiableSchema.parse({
      strategie: 'villes_du_brief',
      etapes: brief.lieux.map((nom) => ({
        ville: { nom, origine: 'utilisateur' },
        ancres: [],
      })),
      contraintesConservees,
    });
  }

  // Dette temporaire PR2 : préserver exactement le flux actuel sans prétendre
  // qu'une intention comme la NBA n'aurait pas besoin de localisation. PR3/PR4
  // remplacera cette branche par une stratégie de découverte contrôlée.
  return ContextePlanifiableSchema.parse({
    strategie: 'compatibilite_sans_localisation',
    etapes: [{ ancres: [] }],
    contraintesConservees,
  });
}

/**
 * Première frontière de préparation : elle ne découvre encore ni ville ni
 * événement. Un brief sans ville reste donc planifiable : les stratégies de
 * découverte ultérieures pourront le traiter sans casser la promesse produit.
 */
export function preparerGeneration(
  brief: Brief
): ResultatCadrageGeneration {
  return ResultatCadrageGenerationSchema.parse({
    type: 'planifiable',
    contexte: construireContextePlanifiable(brief),
  });
}
