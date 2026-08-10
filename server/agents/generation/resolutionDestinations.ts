import { AppError } from '../../lib/AppError.js';
import {
  rechercherPoiDestinationFoursquare,
  resoudreDestinationOpenMeteo,
  type DestinationGeographique,
  type FacetteDestination,
  type PoiDestination,
  type ResultatRecherchePoiDestination,
  type ResolutionDestination,
} from '../../services/destinations/index.js';
import type { Brief } from '../brief.js';
import {
  paysDeclares,
  villesDeclarees,
  zonesDeclarees,
} from '../localisationDeclaree.js';
import type {
  CandidatDestinationPropose,
  PropositionDecouverteDestinations,
} from './contratDecouverteDestinations.js';
import type { ContextePlanifiable } from './contratPreparation.js';

/** Seuil produit prudent : trois observations distinctes, jamais une densité. */
export const NOMBRE_MINIMUM_POI_FACETTE_OBLIGATOIRE = 3;
const PLAFOND_POI_CLASSEMENT = 5;

export interface ContraintesGeographiquesBrief {
  villesExplicites: string[];
  codesPaysAutorises?: ReadonlySet<string>;
  zonesDeclarees: string[];
}

/**
 * Consomme exclusivement le typage confirmé par l'intake. Aucune chaîne
 * n'est reclassifiée ici et une zone n'est jamais assimilée à une ville.
 */
export function analyserContraintesGeographiques(
  brief: Brief
): ContraintesGeographiquesBrief {
  const villesExplicites = villesDeclarees(brief).map(({ nom }) => nom);
  const zones = zonesDeclarees(brief);
  const pays = paysDeclares(brief);
  const codesPaysAutorises = new Set(
    [...pays, ...zones].flatMap(({ codePays }) =>
      codePays ? [codePays] : []
    )
  );

  return {
    villesExplicites,
    zonesDeclarees: zones.map(({ nom }) => nom),
    ...(codesPaysAutorises.size > 0 ? { codesPaysAutorises } : {}),
  };
}

export function destinationsAResoudreApresIntake(brief: Brief): boolean {
  return analyserContraintesGeographiques(brief).villesExplicites.length === 0;
}

export function destinationsResoluesParPreparation(
  contexte: ContextePlanifiable
): boolean {
  return (
    contexte.strategie === 'decouverte_evenementielle' ||
    contexte.strategie === 'decouverte_destinations'
  );
}

export type RaisonRejetDestination =
  | 'pays_incoherent'
  | 'introuvable'
  | 'ambigue'
  | 'signaux_obligatoires_insuffisants';

export interface RejetDestination {
  candidat: CandidatDestinationPropose;
  raison: RaisonRejetDestination;
}

export interface DestinationVerifiee {
  destination: DestinationGeographique;
  signauxParFacette: Partial<Record<FacetteDestination, PoiDestination[]>>;
  facettesObligatoiresCouvertes: number;
  facettesSouplesCouvertes: number;
  minimumSignauxPlafonne: number;
}

export type ResultatResolutionDestinations =
  | {
      statut: 'ok';
      destinations: DestinationVerifiee[];
      rejets: RejetDestination[];
    }
  | { statut: 'clarification_zone'; rejets: RejetDestination[] }
  | { statut: 'clarification_intention'; rejets: RejetDestination[] }
  | { statut: 'vide'; rejets: RejetDestination[] };

export interface DependancesResolutionDestinations {
  geocoder: (demande: unknown) => Promise<ResolutionDestination>;
  rechercherPoi: (
    demande: unknown
  ) => Promise<ResultatRecherchePoiDestination>;
}

const DEPENDANCES_PAR_DEFAUT: DependancesResolutionDestinations = {
  geocoder: resoudreDestinationOpenMeteo,
  rechercherPoi: rechercherPoiDestinationFoursquare,
};

function codePaysPourGeocodage(
  candidat: CandidatDestinationPropose,
  codesPaysAutorises: ReadonlySet<string> | undefined
): string | undefined {
  if (candidat.codePaysSuggere) return candidat.codePaysSuggere;
  if (codesPaysAutorises?.size === 1) return [...codesPaysAutorises][0];
  return undefined;
}

function nombreJoursDuree(brief: Brief): number {
  if (brief.duree.unite === 'semaines') return brief.duree.valeur * 7;
  if (brief.duree.unite === 'jours') return brief.duree.valeur;
  return brief.duree.valeur / 24;
}

export function nombreDestinationsAutorise(
  brief: Brief,
  proposition: PropositionDecouverteDestinations
): number {
  if (proposition.format !== 'itineraire') return 1;
  const jours = nombreJoursDuree(brief);
  if (jours >= 14) return 3;
  if (jours >= 7) return 2;
  return 1;
}

function comparerDestinations(
  gauche: DestinationVerifiee,
  droite: DestinationVerifiee
): number {
  return (
    droite.facettesObligatoiresCouvertes -
      gauche.facettesObligatoiresCouvertes ||
    droite.facettesSouplesCouvertes - gauche.facettesSouplesCouvertes ||
    droite.minimumSignauxPlafonne - gauche.minimumSignauxPlafonne ||
    gauche.destination.identifiantGeoNames -
      droite.destination.identifiantGeoNames
  );
}

async function verifierCandidat(
  candidat: CandidatDestinationPropose,
  proposition: PropositionDecouverteDestinations,
  contraintes: ContraintesGeographiquesBrief,
  dependances: DependancesResolutionDestinations
): Promise<
  | { statut: 'ok'; valeur: DestinationVerifiee }
  | { statut: 'rejet'; raison: RaisonRejetDestination }
> {
  if (
    candidat.codePaysSuggere &&
    contraintes.codesPaysAutorises &&
    !contraintes.codesPaysAutorises.has(candidat.codePaysSuggere)
  ) {
    return { statut: 'rejet', raison: 'pays_incoherent' };
  }

  const codePays = codePaysPourGeocodage(
    candidat,
    contraintes.codesPaysAutorises
  );
  const resolution = await dependances.geocoder({
    nom: candidat.nom,
    ...(codePays ? { codePays } : {}),
  });
  if (resolution.statut === 'indisponible') {
    throw new AppError(
      'La vérification géographique des destinations est momentanément indisponible.',
      503
    );
  }
  if (resolution.statut === 'vide') {
    return { statut: 'rejet', raison: 'introuvable' };
  }
  if (resolution.statut === 'ambigue') {
    return { statut: 'rejet', raison: 'ambigue' };
  }
  if (
    contraintes.codesPaysAutorises &&
    !contraintes.codesPaysAutorises.has(resolution.destination.codePays)
  ) {
    return { statut: 'rejet', raison: 'pays_incoherent' };
  }

  const facettes = [
    ...proposition.facettesObligatoires,
    ...proposition.facettesSouples,
  ];
  const recherches = await Promise.all(
    facettes.map(async (facette) => ({
      facette,
      recherche: await dependances.rechercherPoi({
        coordonnees: resolution.destination.coordonnees,
        facette,
      }),
    }))
  );
  const signauxParFacette: Partial<
    Record<FacetteDestination, PoiDestination[]>
  > = {};
  for (const { facette, recherche } of recherches) {
    if (recherche.statut === 'indisponible') {
      throw new AppError(
        'La vérification des signaux de destination est momentanément indisponible.',
        503
      );
    }
    const uniques =
      recherche.statut === 'ok'
        ? [
            ...new Map(
              recherche.resultats.map((poi) => [poi.identifiantExterne, poi])
            ).values(),
          ]
        : [];
    signauxParFacette[facette] = uniques;
  }

  const facettesObligatoiresCouvertes =
    proposition.facettesObligatoires.filter(
      (facette) =>
        (signauxParFacette[facette]?.length ?? 0) >=
        NOMBRE_MINIMUM_POI_FACETTE_OBLIGATOIRE
    ).length;
  if (
    facettesObligatoiresCouvertes !==
    proposition.facettesObligatoires.length
  ) {
    return {
      statut: 'rejet',
      raison: 'signaux_obligatoires_insuffisants',
    };
  }
  const facettesSouplesCouvertes = proposition.facettesSouples.filter(
    (facette) => (signauxParFacette[facette]?.length ?? 0) > 0
  ).length;
  const minimumSignauxPlafonne = Math.min(
    PLAFOND_POI_CLASSEMENT,
    ...proposition.facettesObligatoires.map(
      (facette) => signauxParFacette[facette]?.length ?? 0
    )
  );

  return {
    statut: 'ok',
    valeur: {
      destination: resolution.destination,
      signauxParFacette,
      facettesObligatoiresCouvertes,
      facettesSouplesCouvertes,
      minimumSignauxPlafonne,
    },
  };
}

/**
 * Valide et classe les seules propositions du LLM. Les nombres de POI sont
 * des observations bornées par l'API, utilisées uniquement comme politique
 * interne de sélection ; ils ne sont jamais présentés comme une densité.
 */
export async function resoudreDestinationsProposees(
  brief: Brief,
  proposition: PropositionDecouverteDestinations,
  dependances: DependancesResolutionDestinations = DEPENDANCES_PAR_DEFAUT
): Promise<ResultatResolutionDestinations> {
  const contraintes = analyserContraintesGeographiques(brief);
  if (contraintes.zonesDeclarees.length > 0) {
    return { statut: 'clarification_zone', rejets: [] };
  }
  if (proposition.facettesObligatoires.length === 0) {
    return { statut: 'clarification_intention', rejets: [] };
  }
  const verifications = await Promise.all(
    proposition.candidats.map(async (candidat) => ({
      candidat,
      resultat: await verifierCandidat(
        candidat,
        proposition,
        contraintes,
        dependances
      ),
    }))
  );
  const rejets: RejetDestination[] = verifications.flatMap(
    ({ candidat, resultat }) =>
      resultat.statut === 'rejet'
        ? [{ candidat, raison: resultat.raison }]
        : []
  );
  const admissibles = verifications.flatMap(({ resultat }) =>
    resultat.statut === 'ok' ? [resultat.valeur] : []
  );
  if (admissibles.length === 0) {
    const ambiguiteSansZone =
      contraintes.codesPaysAutorises === undefined &&
      rejets.some(
        (rejet) =>
          rejet.raison === 'ambigue' &&
          rejet.candidat.codePaysSuggere === undefined
      );
    return ambiguiteSansZone
      ? { statut: 'clarification_zone', rejets }
      : { statut: 'vide', rejets };
  }

  const limite = nombreDestinationsAutorise(brief, proposition);
  const admissiblesDistincts = [
    ...new Map(
      admissibles.map((destination) => [
        destination.destination.identifiantGeoNames,
        destination,
      ])
    ).values(),
  ];
  const destinations = admissiblesDistincts
    .sort(comparerDestinations)
    .slice(0, limite);
  return { statut: 'ok', destinations, rejets };
}
