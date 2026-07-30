import { memoriserSelonResultat } from '../../lib/cacheMemoire.js';
import {
  rechercheIndisponible,
  resultatVide,
  type CauseIndisponibilite,
  type ResultatRecherche,
} from '../rechercheExterne.js';
import { requeteJsonNavitia } from './client.js';
import { cheminLieuxNavitia, lireConfigurationNavitia } from './config.js';
import { candidatDepuisStopArea } from './normalisation.js';
import {
  FOURNISSEUR_NAVITIA,
  RechercheGareNavitiaSchema,
  ReponseLieuxNavitiaSchema,
  TYPE_LIEU_STOP_AREA_NAVITIA,
  type CandidatGareNavitia,
  type PlaceNavitia,
  type RechercheGareNavitia,
} from './schema.js';

const DUREE_CACHE_RESULTAT_MS = 24 * 60 * 60 * 1_000;
const DUREE_CACHE_VIDE_MS = 10 * 60 * 1_000;

export type ResultatRechercheGareNavitia =
  ResultatRecherche<CandidatGareNavitia>;

export type ResolutionGareNavitia =
  | {
      statut: 'unique';
      candidat: CandidatGareNavitia;
      recupereLe: string;
    }
  | {
      statut: 'ambigu';
      candidats: CandidatGareNavitia[];
      recupereLe: string;
    }
  | {
      statut: 'vide';
      recupereLe: string;
    }
  | {
      statut: 'indisponible';
      fournisseur: typeof FOURNISSEUR_NAVITIA;
      raison: CauseIndisponibilite;
    };

export class RechercheGareNavitiaInvalide extends Error {
  constructor() {
    super('Recherche de gare Navitia invalide');
    this.name = 'RechercheGareNavitiaInvalide';
  }
}

/**
 * La clé ne sert qu'au cache : la requête réellement envoyée à Navitia garde
 * la casse et les espaces saisis par l'appelant.
 */
function cleRecherche(recherche: RechercheGareNavitia): string {
  return [
    'navitia',
    'gares',
    recherche.requete.replace(/\s+/gu, ' ').toLowerCase(),
    recherche.couverture ?? 'monde',
  ]
    .map(encodeURIComponent)
    .join(':');
}

function dureeCachePourResultat(
  resultat: ResultatRechercheGareNavitia
): number | null {
  if (resultat.statut === 'ok') return DUREE_CACHE_RESULTAT_MS;
  if (resultat.statut === 'vide') return DUREE_CACHE_VIDE_MS;
  return null;
}

/**
 * Un `place` d'un autre `embedded_type` est valide mais hors cible : il est
 * ignoré. En revanche un `stop_area` non convertible invalide toute la réponse.
 *
 * Le silence serait ici plus dangereux que le refus : écarter une gare
 * illisible pourrait transformer une vraie ambiguïté en faux résultat unique,
 * et donc désigner une gare que l'utilisateur n'a jamais demandée.
 */
function candidatsDepuisPlaces(
  places: readonly PlaceNavitia[],
  source: string,
  recupereLe: string
): CandidatGareNavitia[] | null {
  const candidats: CandidatGareNavitia[] = [];
  for (const place of places) {
    if (place.embedded_type !== TYPE_LIEU_STOP_AREA_NAVITIA) continue;
    const candidat = candidatDepuisStopArea(place, { source, recupereLe });
    if (!candidat) return null;
    candidats.push(candidat);
  }
  return candidats;
}

/**
 * Deux entrées portant la même identité fournisseur ne créent pas d'ambiguïté.
 * Le rapprochement se fait uniquement sur `identifiantExterne` : ni le nom, ni
 * les coordonnées, ni un code supposé ne servent jamais à fusionner deux gares.
 */
function dedupliquerParIdentite(
  candidats: readonly CandidatGareNavitia[]
): CandidatGareNavitia[] {
  const parIdentifiant = new Map<string, CandidatGareNavitia>();
  for (const candidat of candidats) {
    if (!parIdentifiant.has(candidat.identifiantExterne)) {
      parIdentifiant.set(candidat.identifiantExterne, candidat);
    }
  }
  return [...parIdentifiant.values()];
}

async function effectuerRecherche(
  recherche: RechercheGareNavitia
): Promise<ResultatRechercheGareNavitia> {
  const configuration = lireConfigurationNavitia();
  if (!configuration) {
    return rechercheIndisponible(
      FOURNISSEUR_NAVITIA,
      'configuration_absente'
    );
  }

  const reponse = await requeteJsonNavitia({
    chemin: cheminLieuxNavitia(recherche.couverture),
    parametres: {
      q: recherche.requete,
      'type[]': [TYPE_LIEU_STOP_AREA_NAVITIA],
    },
    jeton: configuration.jeton,
  });
  if (reponse.statut === 'indisponible') {
    return rechercheIndisponible(FOURNISSEUR_NAVITIA, reponse.raison);
  }

  const validation = ReponseLieuxNavitiaSchema.safeParse(reponse.contenu);
  if (!validation.success) {
    return rechercheIndisponible(FOURNISSEUR_NAVITIA, 'reponse_invalide');
  }

  const recupereLe = new Date().toISOString();
  const candidats = candidatsDepuisPlaces(
    validation.data.places,
    reponse.url,
    recupereLe
  );
  if (!candidats) {
    return rechercheIndisponible(FOURNISSEUR_NAVITIA, 'reponse_invalide');
  }

  const candidatsUniques = dedupliquerParIdentite(candidats);
  if (candidatsUniques.length === 0) return resultatVide(recupereLe);

  return { statut: 'ok', resultats: candidatsUniques, recupereLe };
}

/**
 * Recherche interne de gares via `/places`. Elle rend tous les candidats
 * compatibles et n'en choisit jamais un seul à la place de l'utilisateur.
 */
export function rechercherGaresNavitia(
  rechercheBrute: unknown
): Promise<ResultatRechercheGareNavitia> {
  const validation = RechercheGareNavitiaSchema.safeParse(rechercheBrute);
  if (!validation.success) {
    return Promise.reject(new RechercheGareNavitiaInvalide());
  }
  const recherche = validation.data;
  return memoriserSelonResultat(
    cleRecherche(recherche),
    () => effectuerRecherche(recherche),
    dureeCachePourResultat
  );
}

/**
 * `unique` signifie seulement que Navitia a rendu une seule gare compatible.
 * Ce n'est ni un `LieuTransportConfirme`, ni la garantie qu'il s'agit de la
 * gare voulue : rien n'est persisté ni confirmé ici.
 */
export function evaluerResolutionGareNavitia(
  recherche: ResultatRechercheGareNavitia
): ResolutionGareNavitia {
  if (recherche.statut === 'indisponible') {
    return {
      statut: 'indisponible',
      fournisseur: FOURNISSEUR_NAVITIA,
      raison: recherche.raison,
    };
  }
  if (recherche.statut === 'vide') {
    return { statut: 'vide', recupereLe: recherche.recupereLe };
  }
  if (recherche.resultats.length === 1) {
    return {
      statut: 'unique',
      candidat: recherche.resultats[0],
      recupereLe: recherche.recupereLe,
    };
  }
  return {
    statut: 'ambigu',
    candidats: recherche.resultats,
    recupereLe: recherche.recupereLe,
  };
}
