import type { CauseIndisponibilite } from '../rechercheExterne.js';
import { requeteJsonAmadeus } from './client.js';
import {
  CHEMIN_AUTHENTIFICATION_AMADEUS,
  lireConfigurationAmadeus,
  type ConfigurationAmadeus,
} from './config.js';
import { ReponseJetonAmadeusSchema } from './schema.js';

const MARGE_MAXIMALE_EXPIRATION_MS = 60_000;
const MARGE_MINIMALE_EXPIRATION_MS = 1_000;

export type ResultatJetonAmadeus =
  | {
      statut: 'ok';
      jeton: string;
    }
  | {
      statut: 'indisponible';
      raison: CauseIndisponibilite;
    };

interface JetonEnMemoire {
  jeton: string;
  utilisableJusqua: number;
  configuration: ConfigurationAmadeus;
}

interface AuthentificationEnCours {
  configuration: ConfigurationAmadeus;
  promesse: Promise<ResultatJetonAmadeus>;
}

let jetonEnMemoire: JetonEnMemoire | undefined;
let authentificationEnCours: AuthentificationEnCours | undefined;

function memeConfiguration(
  premiere: ConfigurationAmadeus,
  seconde: ConfigurationAmadeus
): boolean {
  return (
    premiere.cleApi === seconde.cleApi &&
    premiere.secretApi === seconde.secretApi
  );
}

function margeExpiration(dureeVieMs: number): number {
  return Math.min(
    MARGE_MAXIMALE_EXPIRATION_MS,
    Math.max(MARGE_MINIMALE_EXPIRATION_MS, Math.floor(dureeVieMs / 10))
  );
}

async function demanderJeton(
  configuration: ConfigurationAmadeus
): Promise<ResultatJetonAmadeus> {
  const corps = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: configuration.cleApi,
    client_secret: configuration.secretApi,
  });
  const reponse = await requeteJsonAmadeus({
    chemin: CHEMIN_AUTHENTIFICATION_AMADEUS,
    methode: 'POST',
    enTetes: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    corps: corps.toString(),
  });
  if (reponse.statut === 'indisponible') {
    return { statut: 'indisponible', raison: reponse.raison };
  }

  const validation = ReponseJetonAmadeusSchema.safeParse(reponse.contenu);
  if (!validation.success) {
    return { statut: 'indisponible', raison: 'reponse_invalide' };
  }

  const dureeVieMs = validation.data.expires_in * 1_000;
  jetonEnMemoire = {
    jeton: validation.data.access_token,
    utilisableJusqua:
      Date.now() + dureeVieMs - margeExpiration(dureeVieMs),
    configuration: { ...configuration },
  };
  return { statut: 'ok', jeton: validation.data.access_token };
}

/**
 * Obtient un jeton serveur sans jamais le persister. Deux appels concurrents
 * partageant la même configuration partagent aussi la même authentification.
 */
export async function obtenirJetonAmadeus(): Promise<ResultatJetonAmadeus> {
  const configuration = lireConfigurationAmadeus();
  if (!configuration) {
    return { statut: 'indisponible', raison: 'configuration_absente' };
  }

  if (
    jetonEnMemoire &&
    memeConfiguration(jetonEnMemoire.configuration, configuration) &&
    jetonEnMemoire.utilisableJusqua > Date.now()
  ) {
    return { statut: 'ok', jeton: jetonEnMemoire.jeton };
  }

  if (
    authentificationEnCours &&
    memeConfiguration(authentificationEnCours.configuration, configuration)
  ) {
    return authentificationEnCours.promesse;
  }

  const promesse = demanderJeton(configuration);
  authentificationEnCours = {
    configuration: { ...configuration },
    promesse,
  };
  try {
    return await promesse;
  } finally {
    if (authentificationEnCours?.promesse === promesse) {
      authentificationEnCours = undefined;
    }
  }
}

export function invaliderJetonAmadeus(): void {
  jetonEnMemoire = undefined;
}

/**
 * Helper interne réservé aux tests du connecteur. Il n'est pas réexporté par
 * `server/services/amadeus/index.ts`.
 */
export function reinitialiserAuthentificationAmadeusPourTests(): void {
  jetonEnMemoire = undefined;
  authentificationEnCours = undefined;
}
