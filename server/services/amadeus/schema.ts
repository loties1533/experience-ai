import { z } from 'zod';

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

export type LieuAmadeus = z.infer<typeof LieuAmadeusSchema>;
