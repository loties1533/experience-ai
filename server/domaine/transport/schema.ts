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
export const SOURCE_VOLS_AMADEUS =
  'https://test.api.amadeus.com/v2/shopping/flight-offers';
export const NOMBRE_MAX_VOYAGEURS_VOL_AMADEUS = 9;
export const NOMBRE_MAX_RESULTATS_VOLS = 20;
export const NOMBRE_RESULTATS_VOLS_PAR_DEFAUT = 10;
export const NOMBRE_MAX_SEGMENTS_VOL = 9;

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

/**
 * Recherche interne d'un seul tronçon aérien à partir de deux identités
 * Amadeus déjà sélectionnées. Elle ne résout jamais une ville libre.
 */
export const RechercheVolAerienSchema = z
  .object({
    origine: CandidatLieuAerienSchema,
    destination: CandidatLieuAerienSchema,
    dateDepart: z.iso.date(),
    occupation: OccupationTransportDeclareeSchema,
    correspondances: CorrespondancesTransportSchema,
    devise: z
      .string()
      .regex(
        /^[A-Z]{3}$/,
        'la devise doit être un code ISO 4217 sur trois lettres'
      )
      .optional(),
    maximumResultats: z
      .number()
      .int()
      .min(1)
      .max(NOMBRE_MAX_RESULTATS_VOLS)
      .default(NOMBRE_RESULTATS_VOLS_PAR_DEFAUT),
  })
  .strict()
  .superRefine((recherche, contexte) => {
    if (!recherche.origine.codeIata) {
      contexte.addIssue({
        code: 'custom',
        path: ['origine', 'codeIata'],
        message: 'l’origine doit posséder un code IATA',
      });
    }
    if (!recherche.destination.codeIata) {
      contexte.addIssue({
        code: 'custom',
        path: ['destination', 'codeIata'],
        message: 'la destination doit posséder un code IATA',
      });
    }
    if (
      recherche.origine.identifiantExterne ===
      recherche.destination.identifiantExterne
    ) {
      contexte.addIssue({
        code: 'custom',
        path: ['destination', 'identifiantExterne'],
        message: 'l’origine et la destination doivent être distinctes',
      });
    }
    if (
      recherche.origine.codeIata &&
      recherche.origine.codeIata === recherche.destination.codeIata
    ) {
      contexte.addIssue({
        code: 'custom',
        path: ['destination', 'codeIata'],
        message: 'les codes IATA de départ et d’arrivée doivent différer',
      });
    }
    if (
      recherche.occupation.adultes + recherche.occupation.enfants >
      NOMBRE_MAX_VOYAGEURS_VOL_AMADEUS
    ) {
      contexte.addIssue({
        code: 'custom',
        path: ['occupation'],
        message: `Amadeus accepte au maximum ${NOMBRE_MAX_VOYAGEURS_VOL_AMADEUS} voyageurs assis`,
      });
    }
  });

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

function estDateHeureLocaleReelle(valeur: string): boolean {
  const correspondance =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(valeur);
  if (!correspondance) return false;
  const [, date, heure, minute, seconde] = correspondance;
  return (
    z.iso.date().safeParse(date).success &&
    Number(heure) <= 23 &&
    Number(minute) <= 59 &&
    Number(seconde) <= 59
  );
}

/**
 * Date et heure locale Amadeus, sans décalage ni fuseau. Ce contrat est
 * volontairement incompatible avec DateHeureTransportObserveeSchema.
 */
export const DateHeureLocaleVolSchema = z
  .string()
  .refine(
    estDateHeureLocaleReelle,
    'la date-heure locale doit être réelle et au format AAAA-MM-JJTHH:mm:ss'
  );

const MOTIF_DUREE_VOL_FOURNISSEUR =
  /^P(?:(?:\d+D)(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?|T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)$/;

function estDureeVolFournisseurPositive(valeur: string): boolean {
  const composantes = valeur.match(/\d+/g);
  return (
    composantes !== null &&
    composantes.some((composante) => Number(composante) > 0)
  );
}

export const DureeVolFournisseurSchema = z
  .string()
  .max(32)
  .regex(
    MOTIF_DUREE_VOL_FOURNISSEUR,
    'la durée fournisseur doit respecter le format ISO 8601'
  )
  .refine(
    estDureeVolFournisseurPositive,
    'la durée fournisseur doit être strictement positive'
  );

const CodeIataTransporteurSchema = z.string().regex(/^[A-Z0-9]{2}$/);
const CodeAppareilIataSchema = z.string().regex(/^[A-Z0-9]{3}$/);

export const PointVolAerienCandidatSchema = z
  .object({
    codeIata: CodeIataLieuAerienSchema,
    terminal: z.string().trim().min(1).max(20).optional(),
  })
  .strict();

export const TransporteurVolAerienSchema = z
  .object({
    code: CodeIataTransporteurSchema,
    nom: TexteCourtSchema.optional(),
  })
  .strict();

/**
 * Segment intermédiaire provenant de Flight Offers Search. Ses horaires
 * locaux ne permettent aucune comparaison d'instants entre fuseaux.
 */
export const SegmentVolAerienCandidatSchema = z
  .object({
    identifiantExterne: IdentifiantExterneSchema,
    origine: PointVolAerienCandidatSchema,
    destination: PointVolAerienCandidatSchema,
    departLocal: DateHeureLocaleVolSchema,
    arriveeLocale: DateHeureLocaleVolSchema,
    transporteurMarketing: TransporteurVolAerienSchema,
    transporteurOperant: TransporteurVolAerienSchema.optional(),
    numeroVol: z.string().trim().regex(/^[A-Z0-9]{1,4}$/),
    appareil: z
      .object({ code: CodeAppareilIataSchema })
      .strict()
      .optional(),
    dureeFournisseur: DureeVolFournisseurSchema.optional(),
    nombreEscales: z.number().int().nonnegative().max(9),
  })
  .strict()
  .superRefine((segment, contexte) => {
    if (segment.origine.codeIata === segment.destination.codeIata) {
      contexte.addIssue({
        code: 'custom',
        path: ['destination', 'codeIata'],
        message: 'un segment aérien doit relier deux codes IATA distincts',
      });
    }
  });

export const ResumeDemandeVolAerienSchema = z
  .object({
    origineIata: CodeIataLieuAerienSchema,
    destinationIata: CodeIataLieuAerienSchema,
    dateDepart: z.iso.date(),
  })
  .strict();

const SegmentsVolAerienCandidatSchema = z
  .tuple(
    [SegmentVolAerienCandidatSchema],
    SegmentVolAerienCandidatSchema
  )
  .superRefine((segments, contexte) => {
    if (segments.length > NOMBRE_MAX_SEGMENTS_VOL) {
      contexte.addIssue({
        code: 'too_big',
        origin: 'array',
        maximum: NOMBRE_MAX_SEGMENTS_VOL,
        inclusive: true,
        path: [],
        message: `un vol candidat accepte au maximum ${NOMBRE_MAX_SEGMENTS_VOL} segments`,
      });
    }
    const identifiants = new Set<string>();
    segments.forEach((segment, index) => {
      if (identifiants.has(segment.identifiantExterne)) {
        contexte.addIssue({
          code: 'custom',
          path: [index, 'identifiantExterne'],
          message: 'les segments aériens doivent avoir des identifiants distincts',
        });
      }
      identifiants.add(segment.identifiantExterne);
      if (
        index > 0 &&
        segments[index - 1].destination.codeIata !==
          segment.origine.codeIata
      ) {
        contexte.addIssue({
          code: 'custom',
          path: [index, 'origine', 'codeIata'],
          message: 'les segments aériens doivent être continus',
        });
      }
    });
  });

/**
 * Observation intermédiaire non commerciale. Ni prix, ni disponibilité,
 * ni réservation ne peuvent être stockés dans ce candidat.
 */
export const CandidatVolAerienSchema = z
  .object({
    fournisseur: z.literal('Amadeus'),
    source: z.literal(SOURCE_VOLS_AMADEUS),
    identifiantExterne: IdentifiantExterneSchema,
    recupereLe: DateHeureAvecDecalageSchema,
    demande: ResumeDemandeVolAerienSchema,
    segments: SegmentsVolAerienCandidatSchema,
    dureeFournisseur: DureeVolFournisseurSchema.optional(),
  })
  .strict()
  .superRefine((candidat, contexte) => {
    const premier = candidat.segments[0];
    const dernier = candidat.segments[candidat.segments.length - 1];
    if (premier.origine.codeIata !== candidat.demande.origineIata) {
      contexte.addIssue({
        code: 'custom',
        path: ['segments', 0, 'origine', 'codeIata'],
        message: 'le premier segment doit partir de l’origine demandée',
      });
    }
    if (dernier?.destination.codeIata !== candidat.demande.destinationIata) {
      contexte.addIssue({
        code: 'custom',
        path: [
          'segments',
          candidat.segments.length - 1,
          'destination',
          'codeIata',
        ],
        message: 'le dernier segment doit arriver à la destination demandée',
      });
    }
    if (
      premier.departLocal.slice(0, 10) !== candidat.demande.dateDepart
    ) {
      contexte.addIssue({
        code: 'custom',
        path: ['segments', 0, 'departLocal'],
        message: 'le premier départ doit correspondre à la date demandée',
      });
    }
  });

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

// ────────────────────────────────────────────────────────────────────────
// F4-D1 — Liens de recherche transport.
//
// Un lien produit ici est seulement un raccourci vers une recherche publique,
// jamais un billet, une réservation, une offre observée, un prix ni une
// disponibilité. Le type, le fournisseur et le libellé rendent cette confusion
// impossible ; aucun champ commercial n'existe dans le contrat.
// ────────────────────────────────────────────────────────────────────────

export const TypeLienRechercheTransportSchema = z.enum([
  'recherche_vol',
  'recherche_train',
  'recherche_transport_local',
]);

export const FournisseurLienRechercheTransportSchema = z.enum([
  'Google Flights',
  'Google Maps',
]);

// Pages de recherche publiques retenues. Google Flights sert de recherche de
// vols en texte libre (aucun deep link `tfs` fragile) ; Google Maps s'appuie
// sur l'API officielle « Maps URLs » pour un itinéraire entre deux lieux.
export const URL_RECHERCHE_VOLS_GOOGLE =
  'https://www.google.com/travel/flights';
export const URL_ITINERAIRE_GOOGLE_MAPS =
  'https://www.google.com/maps/dir/';

const HOTE_LIENS_TRANSPORT = 'www.google.com';
const CHEMIN_VOLS_GOOGLE = '/travel/flights';
const CHEMIN_ITINERAIRE_MAPS = '/maps/dir/';

function analyserUrlLienTransport(valeur: string): URL | null {
  let url: URL;
  try {
    url = new URL(valeur);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== HOTE_LIENS_TRANSPORT) return null;
  if (
    url.pathname !== CHEMIN_VOLS_GOOGLE &&
    url.pathname !== CHEMIN_ITINERAIRE_MAPS
  ) {
    return null;
  }
  return url;
}

function cheminAttenduFournisseur(
  fournisseur: z.infer<typeof FournisseurLienRechercheTransportSchema>
): string {
  return fournisseur === 'Google Flights'
    ? CHEMIN_VOLS_GOOGLE
    : CHEMIN_ITINERAIRE_MAPS;
}

/**
 * Raccourci vers une recherche préremplie, jamais une réservation ni une preuve
 * de disponibilité. Le domaine, le chemin et le fournisseur sont verrouillés :
 * seules les données de recherche vivent dans les paramètres encodés.
 */
export const LienRechercheTransportSchema = z
  .object({
    type: TypeLienRechercheTransportSchema,
    fournisseur: FournisseurLienRechercheTransportSchema,
    url: z
      .string()
      .refine(
        (valeur) => analyserUrlLienTransport(valeur) !== null,
        'le lien doit cibler une page de recherche HTTPS autorisée'
      ),
    libelle: TexteCourtSchema,
    genereLe: DateHeureAvecDecalageSchema,
  })
  .strict()
  .superRefine((lien, contexte) => {
    const url = analyserUrlLienTransport(lien.url);
    if (url === null) return;
    if (url.pathname !== cheminAttenduFournisseur(lien.fournisseur)) {
      contexte.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'le chemin de l’URL doit correspondre au fournisseur',
      });
    }
    const fournisseurAttendu =
      lien.type === 'recherche_vol' ? 'Google Flights' : 'Google Maps';
    if (lien.fournisseur !== fournisseurAttendu) {
      contexte.addIssue({
        code: 'custom',
        path: ['fournisseur'],
        message: 'le fournisseur doit correspondre au type de recherche',
      });
    }
  });

// Terme de recherche saisissable dans un champ « lieu » : jamais une URL, un
// identifiant fournisseur ni un caractère de contrôle. Réutilise les mêmes
// garde-fous que la recherche de lieu aérien ou de gare.
const LibelleLieuLienTransportSchema = z
  .string()
  .trim()
  .min(1)
  .max(LONGUEUR_MAX_VILLE)
  .refine(
    (valeur) => !contientCaractereControle(valeur),
    'le lieu contient un caractère de contrôle'
  )
  .refine(
    (valeur) => /[\p{L}\p{N}]/u.test(valeur),
    'le lieu doit contenir au moins une lettre ou un chiffre'
  )
  .refine(
    (valeur) => /^[\p{L}\p{M}\p{N} ./,:;'’()"-]+$/u.test(valeur),
    'le lieu contient un caractère interdit'
  )
  .refine(
    (valeur) =>
      !/\b(?:[a-z][a-z0-9+.-]*:\/\/|(?:javascript|data|mailto):|www\.)/iu.test(
        valeur
      ),
    'une URL ne peut pas servir de lieu de recherche'
  );

const LieuLienTransportSchema = z
  .object({
    nom: LibelleLieuLienTransportSchema,
    ville: VilleSchema.optional(),
  })
  .strict();

/**
 * Demande interne de lien de recherche de vols : uniquement des codes IATA
 * confirmés et une date civile valide. Une ville sans aéroport confirmé n'a
 * pas sa place ici — la promotion ville → aéroport est refusée en amont.
 *
 * Google Flights ne documente officiellement aucun paramètre de préremplissage
 * (`?q=` comme `tfs` sont non documentés et fragiles) : le lien produit pointe
 * donc vers la page de recherche générique, sans injecter ces données dans
 * l'URL. `dateDepart` reste exigée pour garder une demande honnête — un lien
 * de vol n'a de sens que rattaché à une date réelle — même si elle n'apparaît
 * pas dans l'URL.
 */
export const DemandeLienRechercheVolSchema = z
  .object({
    origineIata: CodeIataLieuAerienSchema,
    destinationIata: CodeIataLieuAerienSchema,
    dateDepart: z.iso.date(),
  })
  .strict()
  .superRefine((demande, contexte) => {
    if (demande.origineIata === demande.destinationIata) {
      contexte.addIssue({
        code: 'custom',
        path: ['destinationIata'],
        message: 'les codes IATA de départ et d’arrivée doivent différer',
      });
    }
  });

/**
 * Demande de lien de recherche ferroviaire à partir de deux gares observées.
 *
 * Aucune date : l'API « Maps URLs » n'accepte pas d'heure de départ pour un
 * itinéraire — on ne fabrique donc pas un paramètre non supporté. Les gares
 * sont désignées par leur nom observé, jamais par un identifiant Navitia ou un
 * code UIC, que ce fournisseur n'interprète pas.
 */
export const DemandeLienRechercheTrainSchema = z
  .object({
    origine: LieuLienTransportSchema,
    destination: LieuLienTransportSchema,
  })
  .strict()
  .superRefine((demande, contexte) => {
    if (
      memeLieuLienTransport(demande.origine, demande.destination)
    ) {
      contexte.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'l’origine et la destination doivent être différentes',
      });
    }
  });

/**
 * Demande de lien de transport local : un itinéraire cartographique générique
 * entre deux lieux suffisamment identifiés. Aucune durée ni disponibilité n'est
 * promise ; l'utilisateur consulte lui-même les options réelles.
 */
export const DemandeLienRechercheTransportLocalSchema = z
  .object({
    origine: LieuLienTransportSchema,
    destination: LieuLienTransportSchema,
  })
  .strict()
  .superRefine((demande, contexte) => {
    if (
      memeLieuLienTransport(demande.origine, demande.destination)
    ) {
      contexte.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'l’origine et la destination doivent être différentes',
      });
    }
  });

function normaliserLieuPourComparaison(
  lieu: z.infer<typeof LieuLienTransportSchema>
): string {
  return [lieu.nom, lieu.ville ?? '']
    .map((valeur) => normaliserVillePourComparaison(valeur))
    .join('|');
}

function memeLieuLienTransport(
  premier: z.infer<typeof LieuLienTransportSchema>,
  second: z.infer<typeof LieuLienTransportSchema>
): boolean {
  return (
    normaliserLieuPourComparaison(premier) ===
    normaliserLieuPourComparaison(second)
  );
}

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
export type RechercheVolAerien = z.infer<typeof RechercheVolAerienSchema>;
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
export type DateHeureLocaleVol = z.infer<typeof DateHeureLocaleVolSchema>;
export type PointVolAerienCandidat = z.infer<
  typeof PointVolAerienCandidatSchema
>;
export type TransporteurVolAerien = z.infer<
  typeof TransporteurVolAerienSchema
>;
export type SegmentVolAerienCandidat = z.infer<
  typeof SegmentVolAerienCandidatSchema
>;
export type ResumeDemandeVolAerien = z.infer<
  typeof ResumeDemandeVolAerienSchema
>;
export type CandidatVolAerien = z.infer<typeof CandidatVolAerienSchema>;
export type OperateurTransport = z.infer<typeof OperateurTransportSchema>;
export type SegmentTransportExterne = z.infer<
  typeof SegmentTransportExterneSchema
>;
export type CandidatTrajetExterne = z.infer<
  typeof CandidatTrajetExterneSchema
>;
export type ChampVerifieTrajet = z.infer<typeof ChampVerifieTrajetSchema>;
export type PreuveTrajet = z.infer<typeof PreuveTrajetSchema>;
export type TypeLienRechercheTransport = z.infer<
  typeof TypeLienRechercheTransportSchema
>;
export type FournisseurLienRechercheTransport = z.infer<
  typeof FournisseurLienRechercheTransportSchema
>;
export type LienRechercheTransport = z.infer<
  typeof LienRechercheTransportSchema
>;
export type DemandeLienRechercheVol = z.infer<
  typeof DemandeLienRechercheVolSchema
>;
export type DemandeLienRechercheTrain = z.infer<
  typeof DemandeLienRechercheTrainSchema
>;
export type DemandeLienRechercheTransportLocal = z.infer<
  typeof DemandeLienRechercheTransportLocalSchema
>;
