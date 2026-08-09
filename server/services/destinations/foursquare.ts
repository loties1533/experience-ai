import 'dotenv/config';
import { z } from 'zod';
import {
  causeErreurHttp,
  estTimeout,
  rechercheIndisponible,
  resultatVide,
} from '../rechercheExterne.js';
import {
  CoordonneesDestinationSchema,
  FacetteDestinationSchema,
  FOURNISSEUR_POI_DESTINATIONS,
  PoiDestinationSchema,
  type FacetteDestination,
  type PoiDestination,
  type ResultatRecherchePoiDestination,
} from './contrat.js';

const URL_RECHERCHE_FOURSQUARE_DESTINATIONS =
  'https://places-api.foursquare.com/places/search';
const VERSION_API_PLACES = '2025-06-17';

export const RAYON_RECHERCHE_DESTINATIONS_DEFAUT_METRES = 15_000;
export const RAYON_RECHERCHE_DESTINATIONS_MIN_METRES = 1_000;
export const RAYON_RECHERCHE_DESTINATIONS_MAX_METRES = 25_000;
export const LIMITE_RECHERCHE_DESTINATIONS_DEFAUT = 20;
export const LIMITE_RECHERCHE_DESTINATIONS_MAX = 20;

/**
 * Identifiants issus de la taxonomie officielle Places API & Flat File.
 * Le fournisseur reçoit exclusivement ces catégories : aucune catégorie ou
 * requête textuelle fournie par un modèle n'entre dans cette frontière.
 *
 * Source : https://docs.foursquare.com/data-products/docs/categories
 */
export const CATEGORIES_FOURSQUARE_PAR_FACETTE = {
  sports_hiver: ['18058', '18059', '18060', '18061', '18083', '18084'],
  nature: ['16005', '16019', '16032', '16034', '16035', '16038'],
  plage: ['16003'],
  gastronomie: ['13065'],
  culture: ['10004', '10027', '10028', '10030', '10031', '16020', '16026'],
  detente: ['11070', '11073', '18081'],
} as const satisfies Record<FacetteDestination, readonly string[]>;

const DemandeRecherchePoiDestinationSchema = z
  .object({
    coordonnees: CoordonneesDestinationSchema,
    facette: FacetteDestinationSchema,
    rayonMetres: z.number().finite().positive().optional(),
    limite: z.number().finite().positive().optional(),
  })
  .strict();

const CategorieFoursquareSchema = z
  .object({
    fsq_category_id: z.string().trim().min(1),
    name: z.string().trim().min(1),
  })
  .passthrough();

const LieuFoursquareDestinationSchema = z
  .object({
    fsq_place_id: z.string().trim().min(1),
    name: z.string().trim().min(1),
    categories: z.array(z.unknown()).min(1),
    location: z
      .object({
        locality: z.string().trim().min(1).optional(),
        address: z.string().trim().min(1).optional(),
      })
      .passthrough()
      .optional(),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
  })
  .refine(
    (lieu) =>
      (lieu.latitude === undefined) === (lieu.longitude === undefined),
    { message: 'latitude et longitude doivent être présentes ensemble' }
  )
  .passthrough();

const ReponseFoursquareDestinationSchema = z
  .object({ results: z.array(z.unknown()) })
  .passthrough();

function bornerEntier(
  valeur: number | undefined,
  valeurParDefaut: number,
  minimum: number,
  maximum: number
): number {
  if (valeur === undefined) return valeurParDefaut;
  return Math.min(Math.max(Math.trunc(valeur), minimum), maximum);
}

type ConversionPoi =
  | { statut: 'ok'; poi: PoiDestination }
  | { statut: 'hors_facette' }
  | { statut: 'invalide' };

function convertirPoi(
  lieuBrut: unknown,
  categoriesAutorisees: ReadonlySet<string>,
  recupereLe: string
): ConversionPoi {
  const lieu = LieuFoursquareDestinationSchema.safeParse(lieuBrut);
  if (!lieu.success) return { statut: 'invalide' };

  let nombreCategoriesValides = 0;
  const categories = lieu.data.categories.flatMap((categorieBrute) => {
    const categorie = CategorieFoursquareSchema.safeParse(categorieBrute);
    if (!categorie.success) return [];
    nombreCategoriesValides += 1;
    if (!categoriesAutorisees.has(categorie.data.fsq_category_id)) return [];
    return [
      {
        identifiant: categorie.data.fsq_category_id,
        nom: categorie.data.name,
      },
    ];
  });
  if (nombreCategoriesValides === 0) return { statut: 'invalide' };
  if (categories.length === 0) return { statut: 'hors_facette' };

  const coordonnees =
    lieu.data.latitude !== undefined && lieu.data.longitude !== undefined
      ? {
          latitude: lieu.data.latitude,
          longitude: lieu.data.longitude,
        }
      : undefined;
  const validation = PoiDestinationSchema.safeParse({
    identifiantExterne: lieu.data.fsq_place_id,
    nom: lieu.data.name,
    categories,
    ...(lieu.data.location?.address
      ? { adresse: lieu.data.location.address }
      : {}),
    ...(lieu.data.location?.locality
      ? { localite: lieu.data.location.locality }
      : {}),
    ...(coordonnees ? { coordonnees } : {}),
    fournisseur: FOURNISSEUR_POI_DESTINATIONS,
    source: URL_RECHERCHE_FOURSQUARE_DESTINATIONS,
    recupereLe,
  });
  return validation.success
    ? { statut: 'ok', poi: validation.data }
    : { statut: 'invalide' };
}

/**
 * Observe des POI catégorisés autour de coordonnées déjà validées. Un résultat
 * vide reste une observation vide ; il ne prouve jamais qu'une destination
 * serait inadaptée à la facette recherchée.
 */
export async function rechercherPoiDestinationFoursquare(
  demandeRecue: unknown
): Promise<ResultatRecherchePoiDestination> {
  const demande = DemandeRecherchePoiDestinationSchema.parse(demandeRecue);
  const cleFoursquare = process.env.FOURSQUARE_API_KEY?.trim();
  if (!cleFoursquare) {
    return rechercheIndisponible(
      FOURNISSEUR_POI_DESTINATIONS,
      'configuration_absente'
    );
  }

  const rayon = bornerEntier(
    demande.rayonMetres,
    RAYON_RECHERCHE_DESTINATIONS_DEFAUT_METRES,
    RAYON_RECHERCHE_DESTINATIONS_MIN_METRES,
    RAYON_RECHERCHE_DESTINATIONS_MAX_METRES
  );
  const limite = bornerEntier(
    demande.limite,
    LIMITE_RECHERCHE_DESTINATIONS_DEFAUT,
    1,
    LIMITE_RECHERCHE_DESTINATIONS_MAX
  );
  const categoriesAutorisees = new Set<string>(
    CATEGORIES_FOURSQUARE_PAR_FACETTE[demande.facette]
  );
  const parametres = new URLSearchParams({
    ll: `${demande.coordonnees.latitude},${demande.coordonnees.longitude}`,
    radius: String(rayon),
    limit: String(limite),
    fsq_category_ids: [...categoriesAutorisees].join(','),
    fields: 'fsq_place_id,name,categories,location,latitude,longitude',
  });

  let reponse: Response;
  try {
    reponse = await fetch(
      `${URL_RECHERCHE_FOURSQUARE_DESTINATIONS}?${parametres.toString()}`,
      {
        headers: {
          Authorization: `Bearer ${cleFoursquare}`,
          'X-Places-Api-Version': VERSION_API_PLACES,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8_000),
      }
    );
  } catch (erreur) {
    return rechercheIndisponible(
      FOURNISSEUR_POI_DESTINATIONS,
      estTimeout(erreur) ? 'timeout' : 'reseau'
    );
  }

  if (!reponse.ok) {
    return rechercheIndisponible(
      FOURNISSEUR_POI_DESTINATIONS,
      causeErreurHttp(reponse.status)
    );
  }

  let contenu: unknown;
  try {
    contenu = await reponse.json();
  } catch {
    return rechercheIndisponible(
      FOURNISSEUR_POI_DESTINATIONS,
      'reponse_invalide'
    );
  }
  const enveloppe = ReponseFoursquareDestinationSchema.safeParse(contenu);
  if (!enveloppe.success) {
    return rechercheIndisponible(
      FOURNISSEUR_POI_DESTINATIONS,
      'reponse_invalide'
    );
  }

  const recupereLe = new Date().toISOString();
  const parIdentifiant = new Map<string, PoiDestination>();
  let nombreLieuxValidesStructurellement = 0;
  for (const lieuBrut of enveloppe.data.results) {
    const conversion = convertirPoi(
      lieuBrut,
      categoriesAutorisees,
      recupereLe
    );
    if (conversion.statut === 'invalide') continue;
    nombreLieuxValidesStructurellement += 1;
    if (
      conversion.statut === 'ok' &&
      !parIdentifiant.has(conversion.poi.identifiantExterne)
    ) {
      parIdentifiant.set(conversion.poi.identifiantExterne, conversion.poi);
    }
  }
  if (
    enveloppe.data.results.length > 0 &&
    nombreLieuxValidesStructurellement === 0
  ) {
    return rechercheIndisponible(
      FOURNISSEUR_POI_DESTINATIONS,
      'reponse_invalide'
    );
  }
  const resultats = [...parIdentifiant.values()];
  return resultats.length > 0
    ? { statut: 'ok', resultats, recupereLe }
    : resultatVide(recupereLe);
}
