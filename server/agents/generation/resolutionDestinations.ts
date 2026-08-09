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
import type {
  CandidatDestinationPropose,
  PropositionDecouverteDestinations,
} from './contratDecouverteDestinations.js';
import type { ContextePlanifiable } from './contratPreparation.js';

/** Seuil produit prudent : trois observations distinctes, jamais une densité. */
export const NOMBRE_MINIMUM_POI_FACETTE_OBLIGATOIRE = 3;
const PLAFOND_POI_CLASSEMENT = 5;

const CODES_EUROPE = new Set([
  'AD', 'AL', 'AT', 'BA', 'BE', 'BG', 'BY', 'CH', 'CY', 'CZ', 'DE', 'DK',
  'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI',
  'LT', 'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT',
  'RO', 'RS', 'SE', 'SI', 'SK', 'SM', 'UA', 'VA',
]);

const CODES_ASIE = new Set([
  'AE', 'AF', 'AM', 'AZ', 'BD', 'BH', 'BN', 'BT', 'CN', 'GE', 'HK', 'ID',
  'IL', 'IN', 'IQ', 'IR', 'JO', 'JP', 'KG', 'KH', 'KP', 'KR', 'KW', 'KZ',
  'LA', 'LB', 'LK', 'MM', 'MN', 'MO', 'MV', 'MY', 'NP', 'OM', 'PH', 'PK',
  'PS', 'QA', 'SA', 'SG', 'SY', 'TH', 'TJ', 'TL', 'TM', 'TR', 'TW', 'UZ',
  'VN', 'YE',
]);

const CODES_AFRIQUE = new Set([
  'AO', 'BF', 'BI', 'BJ', 'BW', 'CD', 'CF', 'CG', 'CI', 'CM', 'CV', 'DJ',
  'DZ', 'EG', 'ER', 'ET', 'GA', 'GH', 'GM', 'GN', 'GQ', 'GW', 'KE', 'KM',
  'LR', 'LS', 'LY', 'MA', 'MG', 'ML', 'MR', 'MU', 'MW', 'MZ', 'NA', 'NE',
  'NG', 'RW', 'SC', 'SD', 'SL', 'SN', 'SO', 'SS', 'ST', 'SZ', 'TD', 'TG',
  'TN', 'TZ', 'UG', 'ZA', 'ZM', 'ZW',
]);

const CODES_AMERIQUE_NORD = new Set([
  'BS', 'BZ', 'CA', 'CR', 'CU', 'DO', 'GT', 'HN', 'HT', 'JM', 'MX', 'NI',
  'PA', 'SV', 'US',
]);

const CODES_AMERIQUE_SUD = new Set([
  'AR', 'BO', 'BR', 'CL', 'CO', 'EC', 'GY', 'PE', 'PY', 'SR', 'UY', 'VE',
]);

const CODES_OCEANIE = new Set([
  'AU', 'FJ', 'FM', 'KI', 'MH', 'NR', 'NZ', 'PG', 'PW', 'SB', 'TO', 'TV',
  'VU', 'WS',
]);

// Garde-fou fermé PR5-B : ces valeurs courantes sont des zones, pas des
// villes. Il évite un moteur géographique universel et conserve le chemin
// historique des villes explicites comme Paris.
const CODES_ZONES_REGIONALES_SUPPORTEES = new Map<string, readonly string[]>([
  ['alpes', ['AT', 'CH', 'DE', 'FR', 'IT', 'LI', 'SI']],
  ['toscane', ['IT']],
  ['bretagne', ['FR']],
  ['provence', ['FR']],
]);

function normaliserTexte(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

let codesPaysParNom: Map<string, string> | undefined;

function construireCodesPaysParNom(): Map<string, string> {
  if (codesPaysParNom) return codesPaysParNom;
  const correspondances = new Map<string, string>();
  for (const langue of ['fr', 'en']) {
    const noms = new Intl.DisplayNames([langue], { type: 'region' });
    for (let premier = 65; premier <= 90; premier += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(premier, second);
        const nom = noms.of(code);
        const nomNormalise = nom ? normaliserTexte(nom) : undefined;
        // ICU conserve aussi quelques codes historiques (ex. FX pour France).
        // La première correspondance alphabétique garde le code souverain FR
        // au lieu d'être silencieusement écrasée par un alias obsolète.
        if (nomNormalise && nom !== code && !correspondances.has(nomNormalise)) {
          correspondances.set(nomNormalise, code);
        }
      }
    }
  }
  correspondances.set('etats unis', 'US');
  correspondances.set('usa', 'US');
  correspondances.set('us', 'US');
  correspondances.set('royaume uni', 'GB');
  codesPaysParNom = correspondances;
  return correspondances;
}

function codesPourContrainte(lieu: string): Set<string> | undefined {
  const normalise = normaliserTexte(lieu);
  if (normalise === 'europe') return new Set(CODES_EUROPE);
  if (normalise === 'asie') return new Set(CODES_ASIE);
  if (normalise === 'afrique') return new Set(CODES_AFRIQUE);
  if (normalise === 'amerique du nord') return new Set(CODES_AMERIQUE_NORD);
  if (normalise === 'amerique du sud') return new Set(CODES_AMERIQUE_SUD);
  if (normalise === 'oceanie') return new Set(CODES_OCEANIE);
  const codesRegion = CODES_ZONES_REGIONALES_SUPPORTEES.get(normalise);
  if (codesRegion) return new Set(codesRegion);
  const codePays = construireCodesPaysParNom().get(normalise);
  return codePays ? new Set([codePays]) : undefined;
}

export interface ContraintesGeographiquesBrief {
  villesExplicites: string[];
  codesPaysAutorises?: ReadonlySet<string>;
  zonesDeclarees: string[];
}

/**
 * Les pays, continents et régions explicitement supportées restent des
 * contraintes du Brief, jamais des villes planifiées. Les autres lieux
 * conservent le chemin historique utilisateur sans géocodage généralisé.
 */
export function analyserContraintesGeographiques(
  brief: Brief
): ContraintesGeographiquesBrief {
  const villesExplicites: string[] = [];
  const zonesDeclarees: string[] = [];
  let codesPaysAutorises: Set<string> | undefined;

  for (const lieu of brief.lieux) {
    const codes = codesPourContrainte(lieu);
    if (!codes) {
      villesExplicites.push(lieu);
      continue;
    }
    zonesDeclarees.push(lieu);
    codesPaysAutorises = codesPaysAutorises
      ? new Set([...codesPaysAutorises].filter((code) => codes.has(code)))
      : new Set(codes);
  }

  return { villesExplicites, zonesDeclarees, codesPaysAutorises };
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
