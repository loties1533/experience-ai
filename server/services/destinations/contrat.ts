import { z } from 'zod';
import type {
  CauseIndisponibilite,
  ResultatRecherche,
} from '../rechercheExterne.js';

export const FOURNISSEUR_GEOCODAGE_DESTINATIONS =
  'Open-Meteo/GeoNames' as const;
export const FOURNISSEUR_POI_DESTINATIONS = 'Foursquare' as const;

export const DemandeGeocodageDestinationSchema = z
  .object({
    nom: z.string().trim().min(2).max(120),
    codePays: z.string().regex(/^[A-Z]{2}$/).optional(),
  })
  .strict();

export const CoordonneesDestinationSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();

/**
 * Open-Meteo n'expose que le `feature_code` GeoNames, pas sa classe séparée.
 * Cette liste reprend les codes décrivant une localité actuellement habitée.
 * Les anciennes capitales, lieux historiques, abandonnés, détruits, groupes
 * de localités et simples sections de ville sont volontairement exclus.
 *
 * Source : https://www.geonames.org/export/codes.html
 */
export const CODES_GEONAMES_LOCALITES_PEUPLEES = [
  'PPL',
  'PPLA',
  'PPLA2',
  'PPLA3',
  'PPLA4',
  'PPLA5',
  'PPLC',
  'PPLF',
  'PPLG',
  'PPLL',
  'PPLR',
  'STLMT',
] as const;

export const CodeGeoNamesLocalitePeupleeSchema = z.enum(
  CODES_GEONAMES_LOCALITES_PEUPLEES
);

export const DestinationGeographiqueSchema = z
  .object({
    identifiantGeoNames: z.number().int().positive(),
    nomCanonique: z.string().trim().min(1),
    codePays: z.string().regex(/^[A-Z]{2}$/),
    coordonnees: CoordonneesDestinationSchema,
    featureCode: CodeGeoNamesLocalitePeupleeSchema,
    fournisseur: z.literal(FOURNISSEUR_GEOCODAGE_DESTINATIONS),
    source: z.string().url(),
    recupereLe: z.iso.datetime({ offset: true }),
  })
  .strict();

const ResolutionDestinationUniqueSchema = z
  .object({
    statut: z.literal('unique'),
    destination: DestinationGeographiqueSchema,
    recupereLe: z.iso.datetime({ offset: true }),
  })
  .strict();

const ResolutionDestinationAmbigueSchema = z
  .object({
    statut: z.literal('ambigue'),
    destinations: z.array(DestinationGeographiqueSchema).min(2),
    recupereLe: z.iso.datetime({ offset: true }),
  })
  .strict();

const ResolutionDestinationVideSchema = z
  .object({
    statut: z.literal('vide'),
    destinations: z.tuple([]),
    recupereLe: z.iso.datetime({ offset: true }),
  })
  .strict();

const CAUSES_INDISPONIBILITE = [
  'configuration_absente',
  'authentification',
  'quota',
  'timeout',
  'reseau',
  'fournisseur',
  'reponse_invalide',
] as const satisfies readonly CauseIndisponibilite[];

const ResolutionDestinationIndisponibleSchema = z
  .object({
    statut: z.literal('indisponible'),
    fournisseur: z.literal(FOURNISSEUR_GEOCODAGE_DESTINATIONS),
    raison: z.enum(CAUSES_INDISPONIBILITE),
  })
  .strict();

export const ResolutionDestinationSchema = z.discriminatedUnion('statut', [
  ResolutionDestinationUniqueSchema,
  ResolutionDestinationAmbigueSchema,
  ResolutionDestinationVideSchema,
  ResolutionDestinationIndisponibleSchema,
]);

export const FacetteDestinationSchema = z.enum([
  'sports_hiver',
  'nature',
  'plage',
  'gastronomie',
  'culture',
  'detente',
]);

export const CategoriePoiDestinationSchema = z
  .object({
    identifiant: z.string().min(1),
    nom: z.string().trim().min(1),
  })
  .strict();

export const PoiDestinationSchema = z
  .object({
    identifiantExterne: z.string().trim().min(1),
    nom: z.string().trim().min(1),
    categories: z.array(CategoriePoiDestinationSchema).min(1),
    adresse: z.string().trim().min(1).optional(),
    localite: z.string().trim().min(1).optional(),
    coordonnees: CoordonneesDestinationSchema.optional(),
    fournisseur: z.literal(FOURNISSEUR_POI_DESTINATIONS),
    source: z.string().url(),
    recupereLe: z.iso.datetime({ offset: true }),
  })
  .strict();

export type DemandeGeocodageDestination = z.infer<
  typeof DemandeGeocodageDestinationSchema
>;
export type DestinationGeographique = z.infer<
  typeof DestinationGeographiqueSchema
>;
export type ResolutionDestination = z.infer<
  typeof ResolutionDestinationSchema
>;
export type FacetteDestination = z.infer<typeof FacetteDestinationSchema>;
export type PoiDestination = z.infer<typeof PoiDestinationSchema>;
export type ResultatRecherchePoiDestination = ResultatRecherche<PoiDestination>;
