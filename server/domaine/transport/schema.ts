import { z } from 'zod';
import {
  comparerDatesCiviles,
  comparerInstants,
  normaliserVillePourComparaison,
  verifierContinuiteSegments,
} from './invariants.js';

export const NOMBRE_MAX_TRONCONS_TRANSPORT = 8;
export const NOMBRE_MAX_SEGMENTS_TRAJET = 16;
// Un trajet demandé ne peut pas dépasser trente jours exprimés en minutes.
export const DUREE_MAX_TRANSPORT_MINUTES = 43_200;

const LONGUEUR_MAX_VILLE = 120;
const LONGUEUR_MAX_LIBELLE = 200;
const LONGUEUR_MAX_IDENTIFIANT = 200;
const LONGUEUR_MAX_SOURCE = 2_048;

const TexteCourtSchema = z.string().trim().min(1).max(LONGUEUR_MAX_LIBELLE);
const VilleSchema = z.string().trim().min(1).max(LONGUEUR_MAX_VILLE);
const IdentifiantExterneSchema = z
  .string()
  .trim()
  .min(1)
  .max(LONGUEUR_MAX_IDENTIFIANT);
const CodePaysSchema = z.string().regex(/^[A-Z]{2}$/);
const FuseauIanaSchema = z.string().trim().min(1).max(100);
const SourceHttpsSchema = z
  .string()
  .trim()
  .max(LONGUEUR_MAX_SOURCE)
  .refine((source) => {
    try {
      return new URL(source).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'la source doit être une URL HTTPS valide');
const DateHeureAvecDecalageSchema = z.iso.datetime({ offset: true });

export const ModeTransportSchema = z.enum([
  'avion',
  'train',
  'bus',
  'ferry',
  'voiture',
  'transport_local',
  'autre',
]);

export const TypePreferenceLieuTransportSchema = z.enum([
  'aeroport',
  'gare',
  'arret',
  'port',
]);

export const PreferenceLieuTransportSchema = z
  .object({
    type: TypePreferenceLieuTransportSchema,
    libelle: TexteCourtSchema,
  })
  .strict();

/**
 * Intention exprimée par l'utilisateur. Elle ne contient volontairement
 * aucun identifiant, code opérateur, fuseau ni provenance fournisseur.
 */
export const LieuTransportDemandeSchema = z
  .object({
    ville: VilleSchema,
    codePays: CodePaysSchema.optional(),
    preference: PreferenceLieuTransportSchema.optional(),
  })
  .strict();

const LONGUEUR_MIN_RECHERCHE_LIEU_AERIEN = 2;
const LONGUEUR_MAX_RECHERCHE_LIEU_AERIEN = 80;
export const SOURCE_LIEUX_AMADEUS =
  'https://test.api.amadeus.com/v1/reference-data/locations';

function contientCaractereControle(texte: string): boolean {
  return [...texte].some((caractere) => {
    const code = caractere.codePointAt(0);
    return code !== undefined && (code <= 31 || code === 127);
  });
}

const MotCleLieuAerienSchema = z
  .string()
  .trim()
  .min(LONGUEUR_MIN_RECHERCHE_LIEU_AERIEN)
  .max(LONGUEUR_MAX_RECHERCHE_LIEU_AERIEN)
  .refine(
    (ville) => !contientCaractereControle(ville),
    'la recherche contient un caractère de contrôle'
  )
  .refine(
    (ville) => /^[\p{L}\p{M}\p{N} ./,:;'()"-]+$/u.test(ville),
    'la recherche contient un caractère interdit'
  )
  .refine(
    (ville) =>
      !/\b(?:[a-z][a-z0-9+.-]*:\/\/|(?:javascript|data|mailto):|www\.)/iu.test(
        ville
      ),
    'une URL ne peut pas servir de recherche de lieu aérien'
  )
  .refine(
    (ville) =>
      !/\b(?:identifiantExterne|fournisseur|source|fuseauIana)\b/iu.test(
        ville
      ),
    'la recherche contient un champ fournisseur interdit'
  );

export const PreferenceLieuAerienSchema = z.enum(['aeroport', 'ville']);

/**
 * Demande interne limitée aux paramètres autorisés par Airport & City Search.
 * Aucun identifiant, fournisseur, code IATA ou fuseau ne peut venir du client.
 */
export const RechercheLieuAerienSchema = z
  .object({
    ville: MotCleLieuAerienSchema,
    codePays: CodePaysSchema.optional(),
    preference: PreferenceLieuAerienSchema.optional(),
  })
  .strict();

const CodeIataLieuAerienSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'le code IATA doit contenir trois lettres majuscules');

const CoordonneesLieuAerienSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
  })
  .strict();

const DecalageHoraireAmadeusSchema = z
  .string()
  .regex(
    /^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/,
    'le décalage horaire doit être compris entre -14:00 et +14:00'
  );

/**
 * Identité intermédiaire rendue par Amadeus Airport & City Search.
 *
 * `decalageHoraire` reste un simple offset fournisseur. Il ne constitue
 * jamais un fuseau IANA et ne permet donc pas de créer un
 * `LieuTransportConfirme`.
 */
export const CandidatLieuAerienSchema = z
  .object({
    type: z.enum(['aeroport', 'ville']),
    identifiantExterne: IdentifiantExterneSchema,
    nom: TexteCourtSchema,
    ville: VilleSchema,
    codePays: CodePaysSchema,
    codeIata: CodeIataLieuAerienSchema.optional(),
    coordonnees: CoordonneesLieuAerienSchema.optional(),
    decalageHoraire: DecalageHoraireAmadeusSchema.optional(),
    fournisseur: z.literal('Amadeus'),
    source: z.literal(SOURCE_LIEUX_AMADEUS),
    recupereLe: DateHeureAvecDecalageSchema,
  })
  .strict();

export const NombreAdultesTransportSchema = z.number().int().min(1).max(20);
export const NombreEnfantsTransportSchema = z.number().int().min(0).max(20);

export const OccupationTransportDeclareeSchema = z
  .object({
    statut: z.literal('declaree'),
    adultes: NombreAdultesTransportSchema,
    enfants: NombreEnfantsTransportSchema,
  })
  .strict();

export const OccupationTransportSchema = z.discriminatedUnion('statut', [
  z.object({ statut: z.literal('a_confirmer') }).strict(),
  OccupationTransportDeclareeSchema,
]);

export const CreneauTransportSchema = z.enum([
  'matin',
  'apres_midi',
  'soir',
  'nuit',
]);

/**
 * Date civile demandée, sans horaire précis ni conversion en UTC.
 */
export const DateTransportDemandeeSchema = z
  .object({
    date: z.iso.date(),
    creneau: CreneauTransportSchema.optional(),
  })
  .strict();

export const TronconTransportDemandeSchema = z
  .object({
    origine: LieuTransportDemandeSchema,
    destination: LieuTransportDemandeSchema,
    depart: DateTransportDemandeeSchema,
    modeSouhaite: ModeTransportSchema.optional(),
  })
  .strict()
  .superRefine((troncon, contexte) => {
    if (
      normaliserVillePourComparaison(troncon.origine.ville) ===
      normaliserVillePourComparaison(troncon.destination.ville)
    ) {
      contexte.addIssue({
        code: 'custom',
        path: ['destination', 'ville'],
        message:
          'la ville de destination doit différer de la ville d’origine',
      });
    }
  });

export const CorrespondancesTransportSchema = z.enum([
  'direct_uniquement',
  'acceptees',
]);

export const PorteeBudgetTransportSchema = z.enum([
  'par_personne',
  'total',
]);

export const DeviseTransportSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'la devise doit être un code ISO 4217 sur trois lettres');

export const BudgetMaxTransportSchema = z
  .object({
    montant: z.number().finite().positive(),
    devise: DeviseTransportSchema,
    portee: PorteeBudgetTransportSchema,
  })
  .strict();

export const PreferencesTransportSchema = z
  .object({
    correspondances: CorrespondancesTransportSchema.optional(),
    dureeMaxMinutes: z
      .number()
      .int()
      .positive()
      .max(DUREE_MAX_TRANSPORT_MINUTES)
      .optional(),
    mobiliteReduite: z.boolean().optional(),
    budgetMax: BudgetMaxTransportSchema.optional(),
  })
  .strict();

const TronconsTransportDemandesSchema = z
  .tuple(
    [TronconTransportDemandeSchema],
    TronconTransportDemandeSchema
  )
  .superRefine((troncons, contexte) => {
    if (troncons.length > NOMBRE_MAX_TRONCONS_TRANSPORT) {
      contexte.addIssue({
        code: 'too_big',
        origin: 'array',
        maximum: NOMBRE_MAX_TRONCONS_TRANSPORT,
        inclusive: true,
        path: [],
        message: `une demande accepte au maximum ${NOMBRE_MAX_TRONCONS_TRANSPORT} tronçons`,
      });
    }
    for (let index = 1; index < troncons.length; index += 1) {
      if (
        comparerDatesCiviles(
          troncons[index].depart.date,
          troncons[index - 1].depart.date
        ) < 0
      ) {
        contexte.addIssue({
          code: 'custom',
          path: [index, 'depart', 'date'],
          message:
            'la date d’un tronçon ne peut pas précéder celle du tronçon précédent',
        });
      }
    }
  });

export const DemandeTransportSchema = z
  .object({
    troncons: TronconsTransportDemandesSchema,
    occupation: OccupationTransportSchema,
    preferences: PreferencesTransportSchema.optional(),
  })
  .strict();

export const TypeLieuTransportConfirmeSchema = z.enum([
  'aeroport',
  'gare',
  'arret',
  'port',
]);

export const SystemeCodeLieuTransportSchema = z.enum([
  'IATA',
  'ICAO',
  'UIC',
  'NAVITIA',
]);

export const CodeLieuTransportSchema = z
  .object({
    systeme: SystemeCodeLieuTransportSchema,
    valeur: z.string().trim().min(1).max(LONGUEUR_MAX_IDENTIFIANT),
  })
  .strict()
  .superRefine((code, contexte) => {
    const formats: Record<typeof code.systeme, RegExp> = {
      IATA: /^[A-Z0-9]{3}$/,
      ICAO: /^[A-Z0-9]{4}$/,
      // Les identifiants UIC rencontrés varient selon le jeu de données :
      // seule leur nature numérique et une borne de sécurité sont imposées.
      UIC: /^\d{1,20}$/,
      NAVITIA: /^.{1,200}$/,
    };
    if (!formats[code.systeme].test(code.valeur)) {
      contexte.addIssue({
        code: 'custom',
        path: ['valeur'],
        message: `le code ${code.systeme} n’a pas un format valide`,
      });
    }
  });

/**
 * Identité observée par une future source serveur. Aucun helper ne peut
 * promouvoir automatiquement un LieuTransportDemande vers ce contrat.
 */
export const LieuTransportConfirmeSchema = z
  .object({
    type: TypeLieuTransportConfirmeSchema,
    identifiantExterne: IdentifiantExterneSchema,
    nom: TexteCourtSchema,
    ville: VilleSchema,
    codePays: CodePaysSchema,
    code: CodeLieuTransportSchema.optional(),
    fuseauIana: FuseauIanaSchema,
    fournisseur: TexteCourtSchema,
    source: SourceHttpsSchema,
    recupereLe: DateHeureAvecDecalageSchema,
  })
  .strict();

/**
 * Horaire observé : l'horodatage porte obligatoirement Z ou un décalage
 * explicite. Le fuseau IANA reste distinct et n'est jamais déduit du décalage.
 */
export const DateHeureTransportObserveeSchema = z
  .object({
    horodatage: DateHeureAvecDecalageSchema,
    fuseauIana: FuseauIanaSchema,
  })
  .strict();

export const OperateurTransportSchema = z
  .object({
    nom: TexteCourtSchema,
    code: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

function memeIdentiteLieu(
  premier: z.infer<typeof LieuTransportConfirmeSchema>,
  second: z.infer<typeof LieuTransportConfirmeSchema>
): boolean {
  return (
    premier.fournisseur === second.fournisseur &&
    premier.identifiantExterne === second.identifiantExterne
  );
}

export const SegmentTransportExterneSchema = z
  .object({
    identifiantExterne: IdentifiantExterneSchema,
    mode: ModeTransportSchema,
    origine: LieuTransportConfirmeSchema,
    destination: LieuTransportConfirmeSchema,
    depart: DateHeureTransportObserveeSchema,
    arrivee: DateHeureTransportObserveeSchema,
    operateur: OperateurTransportSchema.optional(),
    numeroTrajet: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .superRefine((segment, contexte) => {
    if (memeIdentiteLieu(segment.origine, segment.destination)) {
      contexte.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'l’origine et la destination doivent être différentes',
      });
    }
    if (
      comparerInstants(
        segment.arrivee.horodatage,
        segment.depart.horodatage
      ) <= 0
    ) {
      contexte.addIssue({
        code: 'custom',
        path: ['arrivee', 'horodatage'],
        message: 'l’arrivée doit être strictement postérieure au départ',
      });
    }
  });

const SegmentsTrajetExterneSchema = z
  .tuple([SegmentTransportExterneSchema], SegmentTransportExterneSchema)
  .superRefine((segments, contexte) => {
    if (segments.length > NOMBRE_MAX_SEGMENTS_TRAJET) {
      contexte.addIssue({
        code: 'too_big',
        origin: 'array',
        maximum: NOMBRE_MAX_SEGMENTS_TRAJET,
        inclusive: true,
        path: [],
        message: `un candidat accepte au maximum ${NOMBRE_MAX_SEGMENTS_TRAJET} segments`,
      });
    }
    const identifiants = new Set<string>();
    segments.forEach((segment, index) => {
      if (identifiants.has(segment.identifiantExterne)) {
        contexte.addIssue({
          code: 'custom',
          path: [index, 'identifiantExterne'],
          message: 'les segments d’un candidat doivent être distincts',
        });
      }
      identifiants.add(segment.identifiantExterne);
    });
    if (!verifierContinuiteSegments(segments)) {
      contexte.addIssue({
        code: 'custom',
        path: [],
        message:
          'les segments doivent être continus par identité de lieu et par horaire',
      });
    }
  });

/**
 * Identité de trajet observée. Elle reste distincte d'une offre commerciale :
 * aucun prix, disponibilité, lien ou réservation ne peut y être stocké.
 */
export const CandidatTrajetExterneSchema = z
  .object({
    fournisseur: TexteCourtSchema,
    source: SourceHttpsSchema,
    identifiantExterne: IdentifiantExterneSchema,
    recupereLe: DateHeureAvecDecalageSchema,
    segments: SegmentsTrajetExterneSchema,
  })
  .strict();

export const ChampVerifieTrajetSchema = z.enum([
  'mode',
  'origine',
  'destination',
  'depart',
  'arrivee',
  'operateur',
  'numeroTrajet',
]);

const ChampsVerifiesTrajetSchema = z
  .tuple([ChampVerifieTrajetSchema], ChampVerifieTrajetSchema)
  .superRefine((champs, contexte) => {
    const uniques = new Set(champs);
    if (uniques.size !== champs.length) {
      contexte.addIssue({
        code: 'custom',
        path: [],
        message: 'les champs vérifiés ne doivent contenir aucun doublon',
      });
    }
  });

/**
 * Une preuve énumère seulement les champs réellement vérifiés. La présence
 * d'une source ou d'un lien ne suffit jamais à couvrir l'identité complète.
 */
export const PreuveTrajetSchema = z
  .object({
    fournisseur: TexteCourtSchema,
    source: SourceHttpsSchema,
    identifiantExterne: IdentifiantExterneSchema,
    recupereLe: DateHeureAvecDecalageSchema,
    champsVerifies: ChampsVerifiesTrajetSchema,
  })
  .strict();

export type ModeTransport = z.infer<typeof ModeTransportSchema>;
export type TypePreferenceLieuTransport = z.infer<
  typeof TypePreferenceLieuTransportSchema
>;
export type PreferenceLieuTransport = z.infer<
  typeof PreferenceLieuTransportSchema
>;
export type LieuTransportDemande = z.infer<
  typeof LieuTransportDemandeSchema
>;
export type PreferenceLieuAerien = z.infer<
  typeof PreferenceLieuAerienSchema
>;
export type RechercheLieuAerien = z.infer<
  typeof RechercheLieuAerienSchema
>;
export type CandidatLieuAerien = z.infer<
  typeof CandidatLieuAerienSchema
>;
export type OccupationTransportDeclaree = z.infer<
  typeof OccupationTransportDeclareeSchema
>;
export type OccupationTransport = z.infer<typeof OccupationTransportSchema>;
export type CreneauTransport = z.infer<typeof CreneauTransportSchema>;
export type DateTransportDemandee = z.infer<
  typeof DateTransportDemandeeSchema
>;
export type TronconTransportDemande = z.infer<
  typeof TronconTransportDemandeSchema
>;
export type PreferencesTransport = z.infer<typeof PreferencesTransportSchema>;
export type DemandeTransport = z.infer<typeof DemandeTransportSchema>;
export type TypeLieuTransportConfirme = z.infer<
  typeof TypeLieuTransportConfirmeSchema
>;
export type SystemeCodeLieuTransport = z.infer<
  typeof SystemeCodeLieuTransportSchema
>;
export type CodeLieuTransport = z.infer<typeof CodeLieuTransportSchema>;
export type LieuTransportConfirme = z.infer<
  typeof LieuTransportConfirmeSchema
>;
export type DateHeureTransportObservee = z.infer<
  typeof DateHeureTransportObserveeSchema
>;
export type OperateurTransport = z.infer<typeof OperateurTransportSchema>;
export type SegmentTransportExterne = z.infer<
  typeof SegmentTransportExterneSchema
>;
export type CandidatTrajetExterne = z.infer<
  typeof CandidatTrajetExterneSchema
>;
export type ChampVerifieTrajet = z.infer<typeof ChampVerifieTrajetSchema>;
export type PreuveTrajet = z.infer<typeof PreuveTrajetSchema>;
