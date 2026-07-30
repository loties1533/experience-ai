import { memoriserSelonResultat } from '../../lib/cacheMemoire.js';
import {
  rechercheIndisponible,
  resultatVide,
  type ResultatRecherche,
} from '../rechercheExterne.js';
import { requeteJsonNavitia } from './client.js';
import { cheminTrajetsNavitia, lireConfigurationNavitia } from './config.js';
import { candidatDepuisJourney } from './normalisationTrajets.js';
import {
  FOURNISSEUR_NAVITIA,
  IDENTIFIANT_ERREUR_SANS_SOLUTION_NAVITIA,
  RechercheTrajetsNavitiaSchema,
  ReponseJourneysNavitiaSchema,
  type CandidatTrajetFerroviaireNavitia,
  type FraicheurNavitia,
  type JourneyNavitia,
  type ProvenanceGareNavitia,
  type RechercheTrajetsNavitia,
} from './schema.js';

const DUREE_CACHE_RESULTAT_THEORIQUE_MS = 30 * 60 * 1_000;
const DUREE_CACHE_RESULTAT_TEMPS_REEL_MS = 2 * 60 * 1_000;
const DUREE_CACHE_VIDE_MS = 5 * 60 * 1_000;

export type ResultatRechercheTrajetsNavitia =
  ResultatRecherche<CandidatTrajetFerroviaireNavitia>;

export class RechercheTrajetsNavitiaInvalide extends Error {
  constructor() {
    super('Recherche de trajets Navitia invalide');
    this.name = 'RechercheTrajetsNavitiaInvalide';
  }
}

/** Navitia attend une date locale compacte : simple reponctuation, sans `Date`. */
function dateHeureNavitia(dateHeureLocale: string): string {
  return dateHeureLocale.replace(/[-:]/gu, '');
}

function cleRecherche(recherche: RechercheTrajetsNavitia): string {
  return [
    'navitia',
    'trajets',
    recherche.origine.identifiantExterne,
    recherche.destination.identifiantExterne,
    recherche.dateHeureLocale,
    recherche.sensDate,
    recherche.fraicheur,
    recherche.couverture ?? 'monde',
    String(recherche.maximumResultats),
  ]
    .map(encodeURIComponent)
    .join(':');
}

function dureeCachePourResultat(
  resultat: ResultatRechercheTrajetsNavitia,
  recherche: RechercheTrajetsNavitia
): number | null {
  if (resultat.statut === 'vide') return DUREE_CACHE_VIDE_MS;
  if (resultat.statut !== 'ok') return null;
  return recherche.fraicheur === 'realtime'
    ? DUREE_CACHE_RESULTAT_TEMPS_REEL_MS
    : DUREE_CACHE_RESULTAT_THEORIQUE_MS;
}

/**
 * Un itinéraire non représentable invalide toute la réponse : l'écarter en
 * silence retirerait un choix de la liste et ferait passer les trajets
 * restants pour l'offre complète.
 *
 * Un itinéraire valide mais sans section ferroviaire est en revanche
 * simplement hors cible : il est ignoré sans fausser la liste.
 */
function candidatsDepuisJourneys(
  journeys: readonly JourneyNavitia[],
  contexte: ProvenanceGareNavitia & { fraicheur: FraicheurNavitia }
): CandidatTrajetFerroviaireNavitia[] | null {
  const candidats: CandidatTrajetFerroviaireNavitia[] = [];
  for (const journey of journeys) {
    const candidat = candidatDepuisJourney(journey, contexte);
    if (candidat === null) return null;
    if (candidat === undefined) continue;
    candidats.push(candidat);
  }
  return candidats;
}

/** Deux itinéraires de même signature fournisseur ne sont pas deux offres. */
function dedupliquerParSignature(
  candidats: readonly CandidatTrajetFerroviaireNavitia[]
): CandidatTrajetFerroviaireNavitia[] {
  const parSignature = new Map<string, CandidatTrajetFerroviaireNavitia>();
  for (const candidat of candidats) {
    if (!parSignature.has(candidat.signature)) {
      parSignature.set(candidat.signature, candidat);
    }
  }
  return [...parSignature.values()];
}

async function effectuerRecherche(
  recherche: RechercheTrajetsNavitia
): Promise<ResultatRechercheTrajetsNavitia> {
  const configuration = lireConfigurationNavitia();
  if (!configuration) {
    return rechercheIndisponible(
      FOURNISSEUR_NAVITIA,
      'configuration_absente'
    );
  }

  const reponse = await requeteJsonNavitia({
    chemin: cheminTrajetsNavitia(recherche.couverture),
    parametres: {
      from: recherche.origine.identifiantExterne,
      to: recherche.destination.identifiantExterne,
      datetime: dateHeureNavitia(recherche.dateHeureLocale),
      datetime_represents: recherche.sensDate,
      data_freshness: recherche.fraicheur,
      count: String(recherche.maximumResultats),
    },
    jeton: configuration.jeton,
  });
  if (reponse.statut === 'indisponible') {
    return rechercheIndisponible(FOURNISSEUR_NAVITIA, reponse.raison);
  }

  const validation = ReponseJourneysNavitiaSchema.safeParse(reponse.contenu);
  if (!validation.success) {
    return rechercheIndisponible(FOURNISSEUR_NAVITIA, 'reponse_invalide');
  }

  const recupereLe = new Date().toISOString();
  const { error: erreur, journeys } = validation.data;
  // Une absence de solution est une réponse fournisseur valide ; toute autre
  // erreur reste une indisponibilité et ne devient jamais un résultat vide.
  if (erreur) {
    return erreur.id === IDENTIFIANT_ERREUR_SANS_SOLUTION_NAVITIA
      ? resultatVide(recupereLe)
      : rechercheIndisponible(FOURNISSEUR_NAVITIA, 'fournisseur');
  }
  if (!journeys) {
    return rechercheIndisponible(FOURNISSEUR_NAVITIA, 'reponse_invalide');
  }

  const candidats = candidatsDepuisJourneys(journeys, {
    source: reponse.url,
    recupereLe,
    fraicheur: recherche.fraicheur,
  });
  if (!candidats) {
    return rechercheIndisponible(FOURNISSEUR_NAVITIA, 'reponse_invalide');
  }

  const candidatsUniques = dedupliquerParSignature(candidats);
  if (candidatsUniques.length === 0) return resultatVide(recupereLe);

  return { statut: 'ok', resultats: candidatsUniques, recupereLe };
}

/**
 * Recherche interne d'itinéraires ferroviaires entre deux gares déjà résolues.
 *
 * Elle rend tous les candidats compatibles dans l'ordre du fournisseur et n'en
 * élit jamais un : ni meilleur trajet, ni tri commercial, ni prix, ni
 * réservation.
 */
export function rechercherTrajetsFerroviairesNavitia(
  rechercheBrute: unknown
): Promise<ResultatRechercheTrajetsNavitia> {
  const validation = RechercheTrajetsNavitiaSchema.safeParse(rechercheBrute);
  if (!validation.success) {
    return Promise.reject(new RechercheTrajetsNavitiaInvalide());
  }
  const recherche = validation.data;
  return memoriserSelonResultat(
    cleRecherche(recherche),
    () => effectuerRecherche(recherche),
    (resultat) => dureeCachePourResultat(resultat, recherche)
  );
}
