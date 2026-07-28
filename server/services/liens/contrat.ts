import type {
  CauseIndisponibilite,
  TypeLieuRecherche,
} from '../rechercheExterne.js';

export type TypeLienProuve =
  | 'officiel'
  | 'billetterie'
  | 'reservation';

export type NaturePreuveLien =
  | 'nom_exact'
  | 'ville'
  | 'adresse'
  | 'salle'
  | 'date_evenement'
  | 'identifiant_externe'
  | 'domaine_officiel'
  | 'page_exacte';

export interface PreuveLien {
  nature: NaturePreuveLien;
  valeur: string;
}

interface DemandeResolutionLienBase {
  /**
   * Identifie le candidat métier Foursquare ou PredictHQ. Ce champ n'est une
   * preuve du lien que si la page Web contient elle-même cet identifiant.
   */
  identifiantExterne: string;
  nom: string;
  villeDemandee: string;
  adresseOuSalle?: string;
  sourceMetier: string;
}

export type DemandeResolutionLien =
  | (DemandeResolutionLienBase & {
      typeMetierRecherche: TypeLieuRecherche;
      fournisseurMetier: 'Foursquare';
      dateDebut?: never;
      dateFin?: never;
    })
  | (DemandeResolutionLienBase & {
      typeMetierRecherche: 'evenement';
      fournisseurMetier: 'PredictHQ';
      dateDebut: string;
      dateFin?: string;
    });

export interface CandidatLien {
  url: string;
  domaine: string;
  typeLienPossible?: TypeLienProuve;
  fournisseurRecherche: 'Tavily';
  recupereLe: string;
  preuves: PreuveLien[];
}

export type LienResolu =
  | {
      statut: 'resolu';
      url: string;
      typeLien: TypeLienProuve;
      domaine: string;
      fournisseurRecherche: 'Tavily';
      recupereLe: string;
      preuves: PreuveLien[];
      redirections: string[];
    }
  | {
      statut: 'ambigu';
      candidats: CandidatLien[];
      fournisseurRecherche: 'Tavily';
      recupereLe: string;
    }
  | {
      statut: 'introuvable';
      fournisseurRecherche: 'Tavily';
      recupereLe: string;
    }
  | {
      statut: 'indisponible';
      fournisseurRecherche: 'Tavily';
      raison: CauseIndisponibilite;
      /**
       * Une panne ne récupère aucune donnée : on date le constat, pas une
       * récupération qui n'a pas eu lieu.
       */
      constateLe: string;
    };
