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

export type TypeLieuRecherche = 'restaurant' | 'activite' | 'sortie';
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

export interface CandidatLieuExterne extends CandidatExterne {
  typeMetierRecherche: TypeLieuRecherche;
  adresse?: string;
  lienCarte: string;
}

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
