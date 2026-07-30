export const URL_BASE_NAVITIA = 'https://api.navitia.io';

export interface ConfigurationNavitia {
  jeton: string;
}

/**
 * Lecture volontairement effectuée à chaque appel : une rotation de secret ou
 * un test ne dépend jamais de l'ordre de chargement du module. C'est le seul
 * point du connecteur qui lit l'environnement.
 */
export function lireConfigurationNavitia(): ConfigurationNavitia | null {
  const jeton = process.env.NAVITIA_API_TOKEN?.trim();
  if (!jeton) return null;
  return { jeton };
}

/**
 * Chemin de recherche de lieux, éventuellement restreint à une couverture.
 * La couverture est validée par le schéma de recherche : elle ne peut donc pas
 * s'échapper du chemin ni changer l'origine interrogée.
 */
export function cheminLieuxNavitia(couverture?: string): string {
  return couverture ? `/v1/coverage/${couverture}/places` : '/v1/places';
}
