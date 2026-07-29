import {
  CandidatLieuAerienSchema,
  RechercheLieuAerienSchema,
  SOURCE_LIEUX_AMADEUS,
  normaliserVillePourComparaison,
  type CandidatLieuAerien,
  type RechercheLieuAerien,
} from '../../domaine/transport/index.js';
import {
  memoriserSelonResultat,
} from '../../lib/cacheMemoire.js';
import {
  rechercheIndisponible,
  resultatVide,
  type CauseIndisponibilite,
  type ResultatRecherche,
} from '../rechercheExterne.js';
import {
  invaliderJetonAmadeus,
  obtenirJetonAmadeus,
} from './auth.js';
import { requeteJsonAmadeus } from './client.js';
import {
  CHEMIN_LIEUX_AMADEUS,
  FOURNISSEUR_AMADEUS,
} from './config.js';
import {
  ReponseLieuxAmadeusSchema,
  type LieuAmadeus,
} from './schema.js';

const DUREE_CACHE_RESULTAT_MS = 30 * 60 * 1_000;
const DUREE_CACHE_VIDE_MS = 5 * 60 * 1_000;

export type ResultatRechercheLieuAerien =
  ResultatRecherche<CandidatLieuAerien>;

export type ResolutionLieuAerien =
  | {
      statut: 'unique';
      candidat: CandidatLieuAerien;
      recupereLe: string;
    }
  | {
      statut: 'ambigue';
      candidats: CandidatLieuAerien[];
      recupereLe: string;
    }
  | {
      statut: 'vide';
      recupereLe: string;
    }
  | {
      statut: 'indisponible';
      fournisseur: 'Amadeus';
      raison: CauseIndisponibilite;
    };

export class RechercheLieuAerienInvalide extends Error {
  constructor() {
    super('Recherche de lieu aérien invalide');
    this.name = 'RechercheLieuAerienInvalide';
  }
}

function sousTypesDemandes(
  preference: RechercheLieuAerien['preference']
): 'AIRPORT' | 'CITY' | 'CITY,AIRPORT' {
  if (preference === 'aeroport') return 'AIRPORT';
  if (preference === 'ville') return 'CITY';
  return 'CITY,AIRPORT';
}

function cleRecherche(demande: RechercheLieuAerien): string {
  return [
    'amadeus',
    'lieux-aeriens',
    normaliserVillePourComparaison(demande.ville),
    demande.codePays ?? 'tous-pays',
    demande.preference ?? 'ville-et-aeroport',
  ]
    .map(encodeURIComponent)
    .join(':');
}

function candidatDepuisLieu(
  lieu: LieuAmadeus,
  recupereLe: string
): CandidatLieuAerien | null {
  const candidat = {
    type: lieu.subType === 'AIRPORT' ? 'aeroport' : 'ville',
    identifiantExterne: lieu.id,
    nom: lieu.name,
    ville: lieu.address.cityName,
    codePays: lieu.address.countryCode,
    ...(lieu.iataCode ? { codeIata: lieu.iataCode } : {}),
    ...(lieu.geoCode
      ? {
          coordonnees: {
            latitude: lieu.geoCode.latitude,
            longitude: lieu.geoCode.longitude,
          },
        }
      : {}),
    ...(lieu.timeZoneOffset
      ? { decalageHoraire: lieu.timeZoneOffset }
      : {}),
    fournisseur: FOURNISSEUR_AMADEUS,
    source: SOURCE_LIEUX_AMADEUS,
    recupereLe,
  };
  const validation = CandidatLieuAerienSchema.safeParse(candidat);
  return validation.success ? validation.data : null;
}

function comparerCandidats(
  premier: CandidatLieuAerien,
  second: CandidatLieuAerien
): number {
  const valeursPremier = [
    premier.type,
    premier.codePays,
    normaliserVillePourComparaison(premier.ville),
    normaliserVillePourComparaison(premier.nom),
    premier.codeIata ?? '',
    premier.identifiantExterne,
  ];
  const valeursSecond = [
    second.type,
    second.codePays,
    normaliserVillePourComparaison(second.ville),
    normaliserVillePourComparaison(second.nom),
    second.codeIata ?? '',
    second.identifiantExterne,
  ];
  return valeursPremier.join('\u0000').localeCompare(
    valeursSecond.join('\u0000'),
    'fr'
  );
}

function memeCandidat(
  premier: CandidatLieuAerien,
  second: CandidatLieuAerien
): boolean {
  return JSON.stringify(premier) === JSON.stringify(second);
}

function dedupliquerCandidats(
  candidats: CandidatLieuAerien[]
): CandidatLieuAerien[] | null {
  const parIdentifiant = new Map<string, CandidatLieuAerien>();
  for (const candidat of candidats) {
    const connu = parIdentifiant.get(candidat.identifiantExterne);
    if (connu && !memeCandidat(connu, candidat)) return null;
    if (!connu) parIdentifiant.set(candidat.identifiantExterne, candidat);
  }
  return [...parIdentifiant.values()].sort(comparerCandidats);
}

function dureeCachePourResultat(
  resultat: ResultatRechercheLieuAerien
): number | null {
  if (resultat.statut === 'ok') return DUREE_CACHE_RESULTAT_MS;
  if (resultat.statut === 'vide') return DUREE_CACHE_VIDE_MS;
  return null;
}

async function effectuerRecherche(
  demande: RechercheLieuAerien
): Promise<ResultatRechercheLieuAerien> {
  const authentification = await obtenirJetonAmadeus();
  if (authentification.statut === 'indisponible') {
    return rechercheIndisponible(
      FOURNISSEUR_AMADEUS,
      authentification.raison
    );
  }

  const parametres: Record<string, string> = {
    subType: sousTypesDemandes(demande.preference),
    keyword: demande.ville,
    view: 'FULL',
  };
  if (demande.codePays) parametres.countryCode = demande.codePays;

  const reponse = await requeteJsonAmadeus({
    chemin: CHEMIN_LIEUX_AMADEUS,
    methode: 'GET',
    parametres,
    enTetes: {
      Accept: 'application/json',
      Authorization: `Bearer ${authentification.jeton}`,
    },
  });
  if (reponse.statut === 'indisponible') {
    if (reponse.statutHttp === 401) invaliderJetonAmadeus();
    return rechercheIndisponible(FOURNISSEUR_AMADEUS, reponse.raison);
  }

  const validation = ReponseLieuxAmadeusSchema.safeParse(reponse.contenu);
  if (!validation.success) {
    return rechercheIndisponible(
      FOURNISSEUR_AMADEUS,
      'reponse_invalide'
    );
  }

  const recupereLe = new Date().toISOString();
  const candidats = validation.data.data
    .filter(
      (lieu) =>
        (!demande.codePays ||
          lieu.address.countryCode === demande.codePays) &&
        (!demande.preference ||
          (demande.preference === 'aeroport'
            ? lieu.subType === 'AIRPORT'
            : lieu.subType === 'CITY'))
    )
    .map((lieu) => candidatDepuisLieu(lieu, recupereLe));

  if (candidats.some((candidat) => candidat === null)) {
    return rechercheIndisponible(
      FOURNISSEUR_AMADEUS,
      'reponse_invalide'
    );
  }

  const candidatsUniques = dedupliquerCandidats(
    candidats.filter(
      (candidat): candidat is CandidatLieuAerien => candidat !== null
    )
  );
  if (!candidatsUniques) {
    return rechercheIndisponible(
      FOURNISSEUR_AMADEUS,
      'reponse_invalide'
    );
  }
  if (candidatsUniques.length === 0) return resultatVide(recupereLe);

  return {
    statut: 'ok',
    resultats: candidatsUniques,
    recupereLe,
  };
}

/**
 * Recherche interne Airport & City Search. Elle renvoie tous les candidats
 * compatibles et ne choisit jamais un aéroport pour une ville.
 */
export function rechercherLieuxAeriens(
  demandeBrute: unknown
): Promise<ResultatRechercheLieuAerien> {
  const validation = RechercheLieuAerienSchema.safeParse(demandeBrute);
  if (!validation.success) {
    return Promise.reject(new RechercheLieuAerienInvalide());
  }
  const demande = validation.data;
  return memoriserSelonResultat(
    cleRecherche(demande),
    () => effectuerRecherche(demande),
    dureeCachePourResultat
  );
}

/**
 * `unique` signifie uniquement qu'Amadeus a rendu un candidat compatible. Ce
 * résultat n'est pas un `LieuTransportConfirme` et n'est jamais persisté ici.
 */
export function evaluerResolutionLieuAerien(
  recherche: ResultatRechercheLieuAerien
): ResolutionLieuAerien {
  if (recherche.statut === 'indisponible') {
    return {
      statut: 'indisponible',
      fournisseur: FOURNISSEUR_AMADEUS,
      raison: recherche.raison,
    };
  }
  if (recherche.statut === 'vide') {
    return { statut: 'vide', recupereLe: recherche.recupereLe };
  }
  const candidats = [...recherche.resultats].sort(comparerCandidats);
  if (candidats.length === 1) {
    return {
      statut: 'unique',
      candidat: candidats[0],
      recupereLe: recherche.recupereLe,
    };
  }
  return {
    statut: 'ambigue',
    candidats,
    recupereLe: recherche.recupereLe,
  };
}
