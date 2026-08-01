import { ErreurApi } from './api'

/**
 * Classe une erreur API en statut métier affichable (doc 15 §7) :
 * 422 → refus produit honnête, 503 → panne technique passagère.
 * Toute autre erreur (400, 404, 500…) reste hors de cette distinction et
 * continue de passer par le toast générique existant.
 */
export function statutMetierDepuisErreur(erreur: unknown): 'refus' | 'indisponible' | null {
  if (!(erreur instanceof ErreurApi)) return null
  if (erreur.statutHttp === 422) return 'refus'
  if (erreur.statutHttp === 503) return 'indisponible'
  return null
}
