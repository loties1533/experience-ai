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
  typeLienPossible: TypeLienProuve;
  rang: number;
  fournisseurRecherche: 'Tavily';
  recupereLe: string;
  preuves: PreuveLien[];
}

export type LienResolu =
  | {
      statut: 'resolu';
      cleDemande: string;
      url: string;
      typeLien: TypeLienProuve;
      domaine: string;
      rang: number;
      fournisseurRecherche: 'Tavily';
      recupereLe: string;
      preuves: PreuveLien[];
      redirections: string[];
    }
  | {
      statut: 'ambigu';
      cleDemande: string;
      candidats: CandidatLien[];
      fournisseurRecherche: 'Tavily';
      recupereLe: string;
    }
  | {
      statut: 'introuvable';
      cleDemande: string;
      fournisseurRecherche: 'Tavily';
      recupereLe: string;
    }
  | {
      statut: 'indisponible';
      cleDemande: string;
      fournisseurRecherche: 'Tavily';
      raison: CauseIndisponibilite;
      /**
       * Une panne ne récupère aucune donnée : on date le constat, pas une
       * récupération qui n'a pas eu lieu.
       */
      constateLe: string;
    };

export type RaisonRefusControleLien =
  | 'url_invalide'
  | 'destination_interdite'
  | 'https_vers_http'
  | 'boucle_redirection'
  | 'trop_de_redirections'
  | 'location_absente'
  | 'location_invalide'
  | 'statut_http_inacceptable';

export type RaisonIndisponibiliteControleLien =
  | 'timeout'
  | 'erreur_reseau'
  | 'erreur_dns'
  | 'resolution_dns_invalide';

export type RaisonRefusResolutionLien =
  | RaisonRefusControleLien
  | 'changement_domaine_enregistrable';

export type ResultatControleLien =
  | {
      statut: 'accessible';
      urlInitiale: string;
      urlFinale: string;
      statutHttp: number;
      redirections: string[];
      controleLe: string;
    }
  | {
      statut: 'refuse';
      raison: RaisonRefusControleLien;
      constateLe: string;
    }
  | {
      statut: 'indisponible';
      raison: RaisonIndisponibiliteControleLien;
      constateLe: string;
    };

type LienSelectionne = Extract<LienResolu, { statut: 'resolu' }>;
type LienNonSelectionne = Exclude<LienResolu, { statut: 'resolu' }>;

export type ResultatResolutionLien =
  | (Omit<LienSelectionne, 'url' | 'domaine' | 'redirections'> & {
      urlInitiale: string;
      url: string;
      domaine: string;
      redirections: string[];
      controleLe: string;
      statutHttp: number;
    })
  | LienNonSelectionne
  | {
      statut: 'refuse';
      cleDemande: string;
      raison: RaisonRefusResolutionLien;
      constateLe: string;
    }
  | {
      statut: 'indisponible';
      cleDemande: string;
      origine: 'controle_reseau';
      raison: RaisonIndisponibiliteControleLien;
      constateLe: string;
    };
