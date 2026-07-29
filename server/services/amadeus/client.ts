import {
  causeErreurHttp,
  estTimeout,
  type CauseIndisponibilite,
} from '../rechercheExterne.js';
import {
  CHEMIN_AUTHENTIFICATION_AMADEUS,
  CHEMIN_LIEUX_AMADEUS,
  CHEMIN_VOLS_AMADEUS,
  URL_BASE_AMADEUS,
} from './config.js';

const DELAI_REQUETE_AMADEUS_MS = 8_000;
const TAILLE_MAX_REPONSE_AMADEUS = 1_000_000;

export type CheminAmadeus =
  | typeof CHEMIN_AUTHENTIFICATION_AMADEUS
  | typeof CHEMIN_LIEUX_AMADEUS
  | typeof CHEMIN_VOLS_AMADEUS;

interface RequeteJsonAmadeus {
  chemin: CheminAmadeus;
  methode: 'GET' | 'POST';
  parametres?: Readonly<Record<string, string>>;
  enTetes?: Readonly<Record<string, string>>;
  corps?: string;
}

export type ResultatRequeteJsonAmadeus =
  | {
      statut: 'ok';
      contenu: unknown;
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

/**
 * Client JSON minimal dont le domaine et les chemins sont fermés côté serveur.
 * Aucun paramètre utilisateur ne peut choisir une origine, un chemin ou un
 * en-tête. `redirect: error` empêche également tout suivi libre.
 */
export async function requeteJsonAmadeus(
  requete: RequeteJsonAmadeus
): Promise<ResultatRequeteJsonAmadeus> {
  const url = new URL(requete.chemin, URL_BASE_AMADEUS);
  if (requete.parametres) {
    Object.entries(requete.parametres).forEach(([nom, valeur]) => {
      url.searchParams.set(nom, valeur);
    });
  }

  let reponse: Response;
  try {
    reponse = await fetch(url, {
      method: requete.methode,
      headers: requete.enTetes,
      body: requete.corps,
      redirect: 'error',
      signal: AbortSignal.timeout(DELAI_REQUETE_AMADEUS_MS),
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
    longueurAnnoncee > TAILLE_MAX_REPONSE_AMADEUS
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
  if (!texte || texte.length > TAILLE_MAX_REPONSE_AMADEUS) {
    return { statut: 'indisponible', raison: 'reponse_invalide' };
  }

  try {
    return { statut: 'ok', contenu: JSON.parse(texte) as unknown };
  } catch {
    return { statut: 'indisponible', raison: 'reponse_invalide' };
  }
}
