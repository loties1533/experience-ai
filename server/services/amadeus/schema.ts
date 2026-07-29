import { z } from 'zod';
import { DureeVolFournisseurSchema } from '../../domaine/transport/index.js';

export const ReponseJetonAmadeusSchema = z.object({
  token_type: z.literal('Bearer'),
  access_token: z.string().trim().min(1),
  expires_in: z.number().int().positive(),
});

const CodePaysAmadeusSchema = z.string().regex(/^[A-Z]{2}$/);
const CodeIataAmadeusSchema = z.string().regex(/^[A-Z]{3}$/);
const DecalageHoraireAmadeusSchema = z.string().regex(
  /^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/
);

const GeoCodeAmadeusSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});

const AdresseLieuAmadeusSchema = z.object({
  cityName: z.string().trim().min(1),
  countryCode: CodePaysAmadeusSchema,
});

/**
 * Sous-ensemble strictement consommé de la réponse Airport & City Search.
 *
 * Les champs Amadeus supplémentaires sont ignorés par Zod. En revanche, une
 * entrée dont un champ consommé est invalide rend la réponse entière invalide :
 * elle ne peut pas être transformée silencieusement en recherche vide.
 */
export const LieuAmadeusSchema = z.object({
  type: z.literal('location'),
  subType: z.enum(['AIRPORT', 'CITY']),
  name: z.string().trim().min(1),
  detailedName: z.string().trim().min(1).optional(),
  id: z.string().trim().min(1),
  iataCode: CodeIataAmadeusSchema.optional(),
  geoCode: GeoCodeAmadeusSchema.optional(),
  timeZoneOffset: DecalageHoraireAmadeusSchema.optional(),
  address: AdresseLieuAmadeusSchema,
});

export const ReponseLieuxAmadeusSchema = z.object({
  data: z.array(LieuAmadeusSchema),
});

const CodeIataVolAmadeusSchema = z.string().regex(/^[A-Z]{3}$/);
const CodeTransporteurAmadeusSchema = z.string().regex(/^[A-Z0-9]{2}$/);
const DateHeureLocaleAmadeusSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
const DureeAmadeusSchema = DureeVolFournisseurSchema;

const PointVolAmadeusSchema = z.object({
  iataCode: CodeIataVolAmadeusSchema,
  terminal: z.string().trim().min(1).max(20).optional(),
  at: DateHeureLocaleAmadeusSchema,
});

export const SegmentVolAmadeusSchema = z.object({
  id: z.string().trim().min(1).max(200),
  departure: PointVolAmadeusSchema,
  arrival: PointVolAmadeusSchema,
  carrierCode: CodeTransporteurAmadeusSchema,
  number: z.string().trim().min(1).max(4),
  operating: z
    .object({ carrierCode: CodeTransporteurAmadeusSchema })
    .optional(),
  aircraft: z
    .object({ code: z.string().regex(/^[A-Z0-9]{3}$/) })
    .optional(),
  duration: DureeAmadeusSchema.optional(),
  numberOfStops: z.number().int().nonnegative().max(9),
});

export const ItineraireVolAmadeusSchema = z.object({
  duration: DureeAmadeusSchema.optional(),
  segments: z.array(SegmentVolAmadeusSchema).min(1).max(9),
});

export const OffreVolAmadeusSchema = z.object({
  type: z.literal('flight-offer'),
  id: z.string().trim().min(1).max(200),
  source: z.string().trim().min(1).max(40),
  itineraries: z.array(ItineraireVolAmadeusSchema).min(1).max(2),
});

const DictionnaireTransporteursAmadeusSchema = z.record(
  CodeTransporteurAmadeusSchema,
  z.string().trim().min(1).max(200)
);

export const ReponseVolsAmadeusSchema = z.object({
  data: z.array(OffreVolAmadeusSchema).max(250),
  dictionaries: z
    .object({
      carriers: DictionnaireTransporteursAmadeusSchema.optional(),
    })
    .optional(),
});

export type LieuAmadeus = z.infer<typeof LieuAmadeusSchema>;
export type SegmentVolAmadeus = z.infer<typeof SegmentVolAmadeusSchema>;
export type ItineraireVolAmadeus = z.infer<
  typeof ItineraireVolAmadeusSchema
>;
export type OffreVolAmadeus = z.infer<typeof OffreVolAmadeusSchema>;
export type ReponseVolsAmadeus = z.infer<
  typeof ReponseVolsAmadeusSchema
>;
