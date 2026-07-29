export const FOURNISSEUR_AMADEUS = 'Amadeus' as const;
export const URL_BASE_AMADEUS = 'https://test.api.amadeus.com';
export const CHEMIN_AUTHENTIFICATION_AMADEUS =
  '/v1/security/oauth2/token' as const;
export const CHEMIN_LIEUX_AMADEUS =
  '/v1/reference-data/locations' as const;

export interface ConfigurationAmadeus {
  cleApi: string;
  secretApi: string;
}

/**
 * Lecture volontairement effectuée à chaque appel : une rotation de secret ou
 * un test ne dépend jamais de l'ordre de chargement du module.
 */
export function lireConfigurationAmadeus(): ConfigurationAmadeus | null {
  const cleApi = process.env.AMADEUS_API_KEY?.trim();
  const secretApi = process.env.AMADEUS_API_SECRET?.trim();
  if (!cleApi || !secretApi) return null;
  return { cleApi, secretApi };
}
