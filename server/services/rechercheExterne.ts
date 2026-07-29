export type CauseIndisponibilite =
  | 'configuration_absente'
  | 'authentification'
  | 'quota'
  | 'timeout'
  | 'reseau'
  | 'fournisseur'
  | 'reponse_invalide';

export type ResultatRecherche<T> =
  | {
      statut: 'ok';
      resultats: T[];
      recupereLe: string;
    }
  | {
      statut: 'vide';
      resultats: [];
      recupereLe: string;
    }
  | {
      statut: 'indisponible';
      fournisseur: string;
      raison: CauseIndisponibilite;
    };

export type TypeLieuRecherche =
  | 'restaurant'
  | 'activite'
  | 'sortie'
  | 'hebergement';
export type TypeMetierRecherche = TypeLieuRecherche | 'evenement';

export interface CandidatExterne {
  identifiantExterne: string;
  nom: string;
  villeDemandee: string;
  villeConfirmee?: string;
  categorieFournisseur: string;
  typeMetierRecherche: TypeMetierRecherche;
  fournisseur: 'Foursquare' | 'PredictHQ';
  source: string;
  recupereLe: string;
}

interface CandidatLieuFoursquareBase extends CandidatExterne {
  identifiantCategorieFournisseur?: string;
  adresse?: string;
  fournisseur: 'Foursquare';
}

export interface CandidatLieuExterne
  extends CandidatLieuFoursquareBase {
  typeMetierRecherche: Exclude<
    TypeLieuRecherche,
    'hebergement'
  >;
  lienCarte: string;
}

/**
 * Identité hôtelière réellement rendue par Foursquare.
 *
 * Aucun champ de prix, de capacité ou de disponibilité : le connecteur Places
 * ne les prouve pas dans le chemin utilisé par Experience AI.
 */
export interface CandidatHotelExterne
  extends CandidatLieuFoursquareBase {
  typeMetierRecherche: 'hebergement';
}

export type CandidatFoursquareExterne =
  | CandidatLieuExterne
  | CandidatHotelExterne;

export interface CandidatEvenementExterne extends CandidatExterne {
  typeMetierRecherche: 'evenement';
  salle?: string;
  dateDebut: string;
  dateFin?: string;
  description: string;
}

export function resultatVide<T>(recupereLe: string): ResultatRecherche<T> {
  return { statut: 'vide', resultats: [], recupereLe };
}

export function rechercheIndisponible<T>(
  fournisseur: string,
  raison: CauseIndisponibilite
): ResultatRecherche<T> {
  return { statut: 'indisponible', fournisseur, raison };
}

export function causeErreurHttp(statut: number): CauseIndisponibilite {
  if (statut === 401 || statut === 403) return 'authentification';
  if (statut === 429) return 'quota';
  return 'fournisseur';
}

export function estTimeout(erreur: unknown): boolean {
  if (!(erreur instanceof Error)) return false;
  return (
    erreur.name === 'AbortError' ||
    erreur.name === 'TimeoutError' ||
    /abort|timeout|délai/i.test(erreur.message)
  );
}
