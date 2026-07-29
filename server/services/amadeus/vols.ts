import {
  CandidatVolAerienSchema,
  RechercheVolAerienSchema,
  SegmentVolAerienCandidatSchema,
  SOURCE_VOLS_AMADEUS,
  type CandidatVolAerien,
  type RechercheVolAerien,
  type SegmentVolAerienCandidat,
  type TransporteurVolAerien,
} from '../../domaine/transport/index.js';
import { memoriserSelonResultat } from '../../lib/cacheMemoire.js';
import {
  rechercheIndisponible,
  resultatVide,
  type ResultatRecherche,
} from '../rechercheExterne.js';
import {
  invaliderJetonAmadeus,
  obtenirJetonAmadeus,
} from './auth.js';
import { requeteJsonAmadeus } from './client.js';
import {
  CHEMIN_VOLS_AMADEUS,
  FOURNISSEUR_AMADEUS,
} from './config.js';
import {
  ReponseVolsAmadeusSchema,
  type OffreVolAmadeus,
  type ReponseVolsAmadeus,
  type SegmentVolAmadeus,
} from './schema.js';

const DUREE_CACHE_RESULTAT_VOL_MS = 3 * 60 * 1_000;
const DUREE_CACHE_VIDE_VOL_MS = 60 * 1_000;

export type ResultatRechercheVolAerien =
  ResultatRecherche<CandidatVolAerien>;

export class RechercheVolAerienInvalide extends Error {
  constructor() {
    super('Recherche de vol aérien invalide');
    this.name = 'RechercheVolAerienInvalide';
  }
}

function cleRechercheVol(recherche: RechercheVolAerien): string {
  return [
    'amadeus',
    'vols',
    recherche.origine.codeIata!,
    recherche.destination.codeIata!,
    recherche.dateDepart,
    String(recherche.occupation.adultes),
    String(recherche.occupation.enfants),
    recherche.correspondances,
    recherche.devise ?? 'sans-devise',
    String(recherche.maximumResultats),
  ]
    .map(encodeURIComponent)
    .join(':');
}

function dureeCachePourResultat(
  resultat: ResultatRechercheVolAerien
): number | null {
  if (resultat.statut === 'ok') return DUREE_CACHE_RESULTAT_VOL_MS;
  if (resultat.statut === 'vide') return DUREE_CACHE_VIDE_VOL_MS;
  return null;
}

function construireParametres(
  recherche: RechercheVolAerien
): Readonly<Record<string, string>> {
  const parametres: Record<string, string> = {
    originLocationCode: recherche.origine.codeIata!,
    destinationLocationCode: recherche.destination.codeIata!,
    departureDate: recherche.dateDepart,
    adults: String(recherche.occupation.adultes),
    // Zéro est envoyé : il vient d'une déclaration explicite et l'API
    // officielle accepte children >= 0.
    children: String(recherche.occupation.enfants),
    nonStop:
      recherche.correspondances === 'direct_uniquement' ? 'true' : 'false',
    max: String(recherche.maximumResultats),
  };
  if (recherche.devise) parametres.currencyCode = recherche.devise;
  return parametres;
}

function transporteurDepuisCode(
  code: string,
  nomsTransporteurs: Readonly<Record<string, string>>
): TransporteurVolAerien {
  const nom = nomsTransporteurs[code];
  return {
    code,
    ...(nom ? { nom } : {}),
  };
}

function mapperSegment(
  segment: SegmentVolAmadeus,
  nomsTransporteurs: Readonly<Record<string, string>>
): SegmentVolAerienCandidat | null {
  const candidat = {
    identifiantExterne: segment.id,
    origine: {
      codeIata: segment.departure.iataCode,
      ...(segment.departure.terminal
        ? { terminal: segment.departure.terminal }
        : {}),
    },
    destination: {
      codeIata: segment.arrival.iataCode,
      ...(segment.arrival.terminal
        ? { terminal: segment.arrival.terminal }
        : {}),
    },
    departLocal: segment.departure.at,
    arriveeLocale: segment.arrival.at,
    transporteurMarketing: transporteurDepuisCode(
      segment.carrierCode,
      nomsTransporteurs
    ),
    ...(segment.operating
      ? {
          transporteurOperant: transporteurDepuisCode(
            segment.operating.carrierCode,
            nomsTransporteurs
          ),
        }
      : {}),
    numeroVol: segment.number,
    ...(segment.aircraft ? { appareil: { code: segment.aircraft.code } } : {}),
    ...(segment.duration
      ? { dureeFournisseur: segment.duration }
      : {}),
    nombreEscales: segment.numberOfStops,
  };
  const validation = SegmentVolAerienCandidatSchema.safeParse(candidat);
  return validation.success ? validation.data : null;
}

type MappingOffre =
  | { statut: 'ok'; candidat: CandidatVolAerien }
  | { statut: 'incompatible' }
  | { statut: 'invalide' };

function mapperOffre(
  offre: OffreVolAmadeus,
  recherche: RechercheVolAerien,
  nomsTransporteurs: Readonly<Record<string, string>>,
  recupereLe: string
): MappingOffre {
  // Un GET sans returnDate doit produire un seul itinéraire aller simple.
  if (offre.itineraries.length !== 1) return { statut: 'incompatible' };

  const itineraire = offre.itineraries[0];
  const segments = itineraire.segments.map((segment) =>
    mapperSegment(segment, nomsTransporteurs)
  );
  if (segments.some((segment) => segment === null)) {
    return { statut: 'invalide' };
  }
  const segmentsValides = segments.filter(
    (segment): segment is SegmentVolAerienCandidat => segment !== null
  );
  const premier = segmentsValides[0];
  const dernier = segmentsValides.at(-1);
  if (!premier || !dernier) return { statut: 'invalide' };

  if (
    premier.origine.codeIata !== recherche.origine.codeIata ||
    dernier.destination.codeIata !== recherche.destination.codeIata ||
    premier.departLocal.slice(0, 10) !== recherche.dateDepart
  ) {
    return { statut: 'incompatible' };
  }
  if (
    recherche.correspondances === 'direct_uniquement' &&
    (segmentsValides.length !== 1 || premier.nombreEscales !== 0)
  ) {
    return { statut: 'incompatible' };
  }

  const candidatBrut = {
    fournisseur: FOURNISSEUR_AMADEUS,
    source: SOURCE_VOLS_AMADEUS,
    identifiantExterne: offre.id,
    recupereLe,
    demande: {
      origineIata: recherche.origine.codeIata!,
      destinationIata: recherche.destination.codeIata!,
      dateDepart: recherche.dateDepart,
    },
    segments: segmentsValides,
    ...(itineraire.duration
      ? { dureeFournisseur: itineraire.duration }
      : {}),
  };
  const validation = CandidatVolAerienSchema.safeParse(candidatBrut);
  return validation.success
    ? { statut: 'ok', candidat: validation.data }
    : { statut: 'invalide' };
}

function memeCandidat(
  premier: CandidatVolAerien,
  second: CandidatVolAerien
): boolean {
  return JSON.stringify(premier) === JSON.stringify(second);
}

function convertirReponse(
  reponse: ReponseVolsAmadeus,
  recherche: RechercheVolAerien,
  recupereLe: string
): ResultatRechercheVolAerien {
  if (reponse.data.length > recherche.maximumResultats) {
    return rechercheIndisponible(
      FOURNISSEUR_AMADEUS,
      'reponse_invalide'
    );
  }
  if (reponse.data.length === 0) return resultatVide(recupereLe);

  const nomsTransporteurs = reponse.dictionaries?.carriers ?? {};
  const parIdentifiant = new Map<string, CandidatVolAerien>();
  for (const offre of reponse.data) {
    const mapping = mapperOffre(
      offre,
      recherche,
      nomsTransporteurs,
      recupereLe
    );
    if (mapping.statut === 'invalide') {
      return rechercheIndisponible(
        FOURNISSEUR_AMADEUS,
        'reponse_invalide'
      );
    }
    if (mapping.statut === 'incompatible') continue;

    const connue = parIdentifiant.get(mapping.candidat.identifiantExterne);
    if (connue && !memeCandidat(connue, mapping.candidat)) {
      return rechercheIndisponible(
        FOURNISSEUR_AMADEUS,
        'reponse_invalide'
      );
    }
    if (!connue) {
      parIdentifiant.set(
        mapping.candidat.identifiantExterne,
        mapping.candidat
      );
    }
  }

  const candidats = [...parIdentifiant.values()];
  if (candidats.length === 0) return resultatVide(recupereLe);
  return { statut: 'ok', resultats: candidats, recupereLe };
}

async function effectuerRechercheVol(
  recherche: RechercheVolAerien
): Promise<ResultatRechercheVolAerien> {
  const authentification = await obtenirJetonAmadeus();
  if (authentification.statut === 'indisponible') {
    return rechercheIndisponible(
      FOURNISSEUR_AMADEUS,
      authentification.raison
    );
  }

  const reponse = await requeteJsonAmadeus({
    chemin: CHEMIN_VOLS_AMADEUS,
    methode: 'GET',
    parametres: construireParametres(recherche),
    enTetes: {
      Accept: 'application/json',
      Authorization: `Bearer ${authentification.jeton}`,
    },
  });
  if (reponse.statut === 'indisponible') {
    if (reponse.statutHttp === 401) invaliderJetonAmadeus();
    return rechercheIndisponible(FOURNISSEUR_AMADEUS, reponse.raison);
  }

  const validation = ReponseVolsAmadeusSchema.safeParse(reponse.contenu);
  if (!validation.success) {
    return rechercheIndisponible(
      FOURNISSEUR_AMADEUS,
      'reponse_invalide'
    );
  }

  return convertirReponse(
    validation.data,
    recherche,
    new Date().toISOString()
  );
}

/**
 * Capacité interne Flight Offers Search limitée à un seul tronçon demandé.
 * Le résultat reste un candidat non commercial et n'est jamais persisté ici.
 */
export function rechercherVolsAeriens(
  rechercheBrute: unknown
): Promise<ResultatRechercheVolAerien> {
  const validation = RechercheVolAerienSchema.safeParse(rechercheBrute);
  if (!validation.success) {
    return Promise.reject(new RechercheVolAerienInvalide());
  }
  const recherche = validation.data;
  return memoriserSelonResultat(
    cleRechercheVol(recherche),
    () => effectuerRechercheVol(recherche),
    dureeCachePourResultat
  );
}
