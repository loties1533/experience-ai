import {
  causeErreurHttp,
  estTimeout,
  type CauseIndisponibilite,
} from '../rechercheExterne.js';
import { enTeteAuthentificationNavitia } from './auth.js';
import { URL_BASE_NAVITIA } from './config.js';

const DELAI_REQUETE_NAVITIA_MS = 8_000;
const TAILLE_MAX_REPONSE_NAVITIA = 1_000_000;

interface RequeteJsonNavitia {
  chemin: string;
  parametres?: Readonly<Record<string, string | string[]>>;
  jeton: string;
}

export type ResultatRequeteJsonNavitia =
  | {
      statut: 'ok';
      contenu: unknown;
      /** URL réellement interrogée, sans jeton : elle sert de provenance. */
      url: string;
    }
  | {
      statut: 'indisponible';
      raison: CauseIndisponibilite;
      statutHttp?: number;
    };

async function annulerCorps(reponse: Response): Promise<void> {
  try {
    await reponse.body?.cancel();
  } catch {
    // Le corps n'est jamais utile pour une erreur fournisseur.
  }
}

function construireUrl(
  chemin: string,
  parametres: RequeteJsonNavitia['parametres']
): URL {
  const url = new URL(chemin, URL_BASE_NAVITIA);
  if (parametres) {
    Object.entries(parametres).forEach(([nom, valeur]) => {
      const valeurs = Array.isArray(valeur) ? valeur : [valeur];
      valeurs.forEach((element) => url.searchParams.append(nom, element));
    });
  }
  return url;
}

/**
 * Client JSON minimal dont l'origine est fermée côté serveur : le chemin est
 * toujours résolu contre l'URL Navitia officielle, et `redirect: error`
 * empêche tout suivi libre.
 *
 * Le jeton ne voyage que dans l'en-tête `Authorization` : il n'apparaît ni dans
 * l'URL rendue, ni dans une raison d'indisponibilité.
 */
export async function requeteJsonNavitia(
  requete: RequeteJsonNavitia
): Promise<ResultatRequeteJsonNavitia> {
  const url = construireUrl(requete.chemin, requete.parametres);

  let reponse: Response;
  try {
    reponse = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: enTeteAuthentificationNavitia(requete.jeton),
      },
      redirect: 'error',
      signal: AbortSignal.timeout(DELAI_REQUETE_NAVITIA_MS),
    });
  } catch (erreur) {
    return {
      statut: 'indisponible',
      raison: estTimeout(erreur) ? 'timeout' : 'reseau',
    };
  }

  if (!reponse.ok) {
    await annulerCorps(reponse);
    return {
      statut: 'indisponible',
      raison: causeErreurHttp(reponse.status),
      statutHttp: reponse.status,
    };
  }

  const typeContenu = reponse.headers.get('content-type');
  if (typeContenu && !typeContenu.toLowerCase().includes('json')) {
    await annulerCorps(reponse);
    return { statut: 'indisponible', raison: 'reponse_invalide' };
  }

  const longueurAnnoncee = Number(reponse.headers.get('content-length'));
  if (
    Number.isFinite(longueurAnnoncee) &&
    longueurAnnoncee > TAILLE_MAX_REPONSE_NAVITIA
  ) {
    await annulerCorps(reponse);
    return { statut: 'indisponible', raison: 'reponse_invalide' };
  }

  let texte: string;
  try {
    texte = await reponse.text();
  } catch {
    return { statut: 'indisponible', raison: 'reponse_invalide' };
  }
  if (!texte || texte.length > TAILLE_MAX_REPONSE_NAVITIA) {
    return { statut: 'indisponible', raison: 'reponse_invalide' };
  }

  try {
    return {
      statut: 'ok',
      contenu: JSON.parse(texte) as unknown,
      url: url.toString(),
    };
  } catch {
    return { statut: 'indisponible', raison: 'reponse_invalide' };
  }
}
