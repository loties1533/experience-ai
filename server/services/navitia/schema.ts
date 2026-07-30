import { z } from 'zod';
import {
  CodeLieuTransportSchema,
  ModeTransportSchema,
} from '../../domaine/transport/index.js';

export const FOURNISSEUR_NAVITIA = 'Navitia' as const;

/** Seul ce type d'objet Navitia peut décrire une gare. */
export const TYPE_LIEU_STOP_AREA_NAVITIA = 'stop_area' as const;

const LONGUEUR_MAX_IDENTIFIANT = 200;
const LONGUEUR_MAX_LIBELLE = 200;
const LONGUEUR_MAX_SOURCE = 2_048;
const LONGUEUR_MAX_FUSEAU = 100;
const LONGUEUR_MAX_TYPE_CODE = 100;
const NOMBRE_MAX_CODES_NAVITIA = 50;

const TexteCourtSchema = z.string().trim().min(1).max(LONGUEUR_MAX_LIBELLE);
const IdentifiantExterneSchema = z
  .string()
  .trim()
  .min(1)
  .max(LONGUEUR_MAX_IDENTIFIANT);

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

/**
 * Navitia rend un vrai fuseau IANA (par exemple `Europe/Paris`). Le runtime
 * tranche seul ce qui existe, et rend au passage la forme canonique de la zone
 * (`europe/paris` devient `Europe/Paris`, `Etc/UTC` devient `UTC`).
 *
 * Un décalage seul est écarté avant cette lecture : `Intl` accepte pourtant
 * `+02:00` comme zone sur les runtimes récents, et un offset ne doit jamais
 * devenir un fuseau (F4-C1). Une zone doit donc commencer par une lettre.
 */
function fuseauIanaCanonique(valeur: string): string | null {
  if (!/^[A-Za-z]/u.test(valeur)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: valeur })
      .resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

const FuseauIanaNavitiaSchema = z
  .string()
  .trim()
  .min(1)
  .max(LONGUEUR_MAX_FUSEAU)
  .transform((valeur, contexte) => {
    const zone = fuseauIanaCanonique(valeur);
    if (zone === null) {
      contexte.addIssue({
        code: 'custom',
        message: 'le fuseau doit désigner une zone IANA connue',
      });
      return z.NEVER;
    }
    return zone;
  });

/**
 * Navitia exprime ses coordonnées en texte dans ses réponses JSON. Les deux
 * formes sont acceptées à la lecture ; leurs bornes sont contrôlées par le
 * contrat du candidat, jamais deux fois.
 */
const CoordonneeNavitiaSchema = z.union([z.number(), z.string()]);

const CoordNavitiaSchema = z.object({
  lat: CoordonneeNavitiaSchema,
  lon: CoordonneeNavitiaSchema,
});

export const CodeNavitiaSchema = z.object({
  type: z.string().trim().min(1).max(LONGUEUR_MAX_TYPE_CODE),
  value: z.string().trim().min(1).max(LONGUEUR_MAX_IDENTIFIANT),
});

/**
 * Sous-ensemble strictement consommé d'un `stop_area` Navitia.
 *
 * Les champs Navitia supplémentaires sont ignorés par Zod. En revanche, une
 * gare dont un champ consommé est invalide rend l'objet entier invalide : elle
 * ne peut pas être transformée silencieusement en candidat partiel.
 */
export const StopAreaNavitiaSchema = z.object({
  id: IdentifiantExterneSchema,
  name: TexteCourtSchema,
  coord: CoordNavitiaSchema,
  codes: z.array(CodeNavitiaSchema).max(NOMBRE_MAX_CODES_NAVITIA).optional(),
  timezone: FuseauIanaNavitiaSchema,
});

/**
 * Élément de liste rendu par l'autocomplétion Navitia. `embedded_type` désigne
 * la nature réelle de l'objet : une région administrative, un arrêt ou un point
 * d'intérêt ne devient jamais une gare.
 */
export const PlaceNavitiaSchema = z.object({
  embedded_type: z.string().trim().min(1),
  stop_area: StopAreaNavitiaSchema.optional(),
});

/**
 * Enveloppe rendue par `/places`. L'API ne pagine pas cette ressource : la
 * liste reçue est la liste complète.
 */
export const ReponseLieuxNavitiaSchema = z.object({
  places: z.array(PlaceNavitiaSchema).max(200),
});

const LONGUEUR_MIN_RECHERCHE_GARE = 2;
const LONGUEUR_MAX_RECHERCHE_GARE = 80;

function contientCaractereControle(texte: string): boolean {
  return [...texte].some((caractere) => {
    const code = caractere.codePointAt(0);
    return code !== undefined && (code <= 31 || code === 127);
  });
}

const MotCleGareNavitiaSchema = z
  .string()
  .trim()
  .min(LONGUEUR_MIN_RECHERCHE_GARE)
  .max(LONGUEUR_MAX_RECHERCHE_GARE)
  .refine(
    (requete) => !contientCaractereControle(requete),
    'la recherche contient un caractère de contrôle'
  );

/**
 * Identifiant de couverture Navitia (par exemple `fr-idf`). Il est repris dans
 * le chemin appelé : son format est donc volontairement fermé, aucune valeur
 * ne peut s'échapper du chemin ni changer l'origine interrogée.
 */
const CouvertureNavitiaSchema = z
  .string()
  .trim()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'la couverture doit être un identifiant Navitia simple'
  )
  .max(40);

export const RechercheGareNavitiaSchema = z
  .object({
    requete: MotCleGareNavitiaSchema,
    couverture: CouvertureNavitiaSchema.optional(),
  })
  .strict();

/**
 * Identité intermédiaire observée chez Navitia.
 *
 * Elle ne constitue pas un `LieuTransportConfirme` : ni ville, ni code pays, ni
 * niveau de confiance n'y figurent, car Navitia ne les garantit pas depuis ses
 * régions administratives. Elle ne prouve non plus aucune desserte
 * commerciale, disponibilité ni réservation.
 *
 * `code` est obligatoire : une gare sans code UIC exploitable garde toujours
 * son identifiant Navitia réel, sinon elle n'est pas normalisée du tout.
 */
export const CandidatGareNavitiaSchema = z
  .object({
    fournisseur: z.literal(FOURNISSEUR_NAVITIA),
    identifiantExterne: IdentifiantExterneSchema,
    nom: TexteCourtSchema,
    coordonnees: z
      .object({
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
      })
      .strict(),
    fuseauIana: FuseauIanaNavitiaSchema,
    code: CodeLieuTransportSchema,
    source: SourceHttpsSchema,
    recupereLe: z.iso.datetime({ offset: true }),
  })
  .strict();

/**
 * Provenance observée d'une gare, fournie par l'appelant. Aucune valeur par
 * défaut : ni configuration, ni environnement, ni horloge implicite.
 */
export const ProvenanceGareNavitiaSchema = z
  .object({
    source: SourceHttpsSchema,
    recupereLe: z.iso.datetime({ offset: true }),
  })
  .strict();

/**
 * Date et heure locales Navitia, au format compact `AAAAMMJJTHHMMSS`.
 *
 * La valeur est seulement reponctuée en `AAAA-MM-JJTHH:mm:ss` : aucune
 * conversion, aucun décalage, aucun instant absolu. Ce contrat est
 * volontairement incompatible avec `DateHeureTransportObserveeSchema`, qui
 * exige un offset explicite.
 */
function heureLocaleNavitiaReponctuee(valeur: string): string | null {
  const correspondance =
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(valeur);
  if (!correspondance) return null;
  const [, annee, mois, jour, heure, minute, seconde] = correspondance;
  if (!z.iso.date().safeParse(`${annee}-${mois}-${jour}`).success) return null;
  if (Number(heure) > 23 || Number(minute) > 59 || Number(seconde) > 59) {
    return null;
  }
  return `${annee}-${mois}-${jour}T${heure}:${minute}:${seconde}`;
}

export const DateHeureLocaleNavitiaSchema = z
  .string()
  .trim()
  .transform((valeur, contexte) => {
    const locale = heureLocaleNavitiaReponctuee(valeur);
    if (locale === null) {
      contexte.addIssue({
        code: 'custom',
        message:
          'la date-heure locale doit être réelle et au format AAAAMMJJTHHMMSS',
      });
      return z.NEVER;
    }
    return locale;
  });

/**
 * Heure locale déjà reponctuée, telle qu'elle est conservée dans les
 * candidats. Elle ne porte volontairement ni `Z`, ni décalage.
 */
const HeureLocaleIsoNavitiaSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
    'l’heure locale ne doit porter ni décalage ni fuseau'
  )
  .refine(
    (valeur) => z.iso.date().safeParse(valeur.slice(0, 10)).success,
    'l’heure locale doit désigner une date réelle'
  );

export const FRAICHEURS_NAVITIA = ['base_schedule', 'realtime'] as const;
export const FraicheurNavitiaSchema = z.enum(FRAICHEURS_NAVITIA);

export const SensDateNavitiaSchema = z.enum(['departure', 'arrival']);

const NOMBRE_MAX_TRAJETS_NAVITIA = 10;
const NOMBRE_TRAJETS_NAVITIA_PAR_DEFAUT = 5;
const NOMBRE_MAX_SECTIONS_NAVITIA = 24;
const NOMBRE_MAX_JOURNEYS_BRUTS = 50;
// Un trajet ferroviaire demandé ne peut pas dépasser trente jours.
const DUREE_MAX_TRAJET_SECONDES = 2_592_000;

/**
 * Extrémité d'une section. Le fuseau n'existe que sur un `stop_area` : il est
 * lu là où Navitia le publie réellement, jamais déduit d'une coordonnée ni
 * d'un nom de gare.
 */
const StopAreaSectionNavitiaSchema = z.object({
  id: IdentifiantExterneSchema,
  name: TexteCourtSchema,
  timezone: FuseauIanaNavitiaSchema,
});

const PointSectionNavitiaSchema = z.object({
  embedded_type: z.string().trim().min(1),
  stop_area: StopAreaSectionNavitiaSchema.optional(),
  stop_point: z
    .object({ stop_area: StopAreaSectionNavitiaSchema.optional() })
    .optional(),
});

const InformationsAffichageNavitiaSchema = z.object({
  network: TexteCourtSchema.optional(),
  physical_mode: TexteCourtSchema.optional(),
  commercial_mode: TexteCourtSchema.optional(),
  code: TexteCourtSchema.optional(),
  headsign: TexteCourtSchema.optional(),
  direction: TexteCourtSchema.optional(),
  label: TexteCourtSchema.optional(),
});

export const SectionNavitiaSchema = z.object({
  type: z.string().trim().min(1),
  mode: TexteCourtSchema.optional(),
  duration: z.number().int().nonnegative().max(DUREE_MAX_TRAJET_SECONDES),
  from: PointSectionNavitiaSchema.optional(),
  to: PointSectionNavitiaSchema.optional(),
  departure_date_time: DateHeureLocaleNavitiaSchema.optional(),
  arrival_date_time: DateHeureLocaleNavitiaSchema.optional(),
  display_informations: InformationsAffichageNavitiaSchema.optional(),
});

export const JourneyNavitiaSchema = z.object({
  duration: z.number().int().nonnegative().max(DUREE_MAX_TRAJET_SECONDES),
  nb_transfers: z.number().int().nonnegative().max(20),
  departure_date_time: DateHeureLocaleNavitiaSchema,
  arrival_date_time: DateHeureLocaleNavitiaSchema,
  sections: z.array(SectionNavitiaSchema).min(1).max(NOMBRE_MAX_SECTIONS_NAVITIA),
});

/**
 * Enveloppe `/journeys`. Navitia peut rendre une erreur métier explicite
 * (`no_solution`) au lieu d'une liste vide : les deux sont des réponses
 * techniquement valides, jamais des pannes.
 */
export const ReponseJourneysNavitiaSchema = z.object({
  journeys: z.array(JourneyNavitiaSchema).max(NOMBRE_MAX_JOURNEYS_BRUTS).optional(),
  error: z
    .object({
      id: z.string().trim().min(1),
      message: z.string().trim().max(500).optional(),
    })
    .optional(),
});

export const IDENTIFIANT_ERREUR_SANS_SOLUTION_NAVITIA = 'no_solution';

/**
 * Recherche interne de trajets entre deux gares déjà résolues. Exiger des
 * candidats fournisseur, et non de simples chaînes, interdit qu'une ville ou
 * un nom saisi devienne une gare.
 */
export const RechercheTrajetsNavitiaSchema = z
  .object({
    origine: CandidatGareNavitiaSchema,
    destination: CandidatGareNavitiaSchema,
    dateHeureLocale: z
      .string()
      .regex(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/,
        'la date-heure locale doit être au format AAAA-MM-JJTHH:mm:ss'
      )
      .refine(
        (valeur) => z.iso.date().safeParse(valeur.slice(0, 10)).success,
        'la date-heure locale doit désigner une date réelle'
      ),
    sensDate: SensDateNavitiaSchema.default('departure'),
    fraicheur: FraicheurNavitiaSchema.default('base_schedule'),
    couverture: CouvertureNavitiaSchema.optional(),
    maximumResultats: z
      .number()
      .int()
      .min(1)
      .max(NOMBRE_MAX_TRAJETS_NAVITIA)
      .default(NOMBRE_TRAJETS_NAVITIA_PAR_DEFAUT),
  })
  .strict()
  .superRefine((recherche, contexte) => {
    if (
      recherche.origine.identifiantExterne ===
      recherche.destination.identifiantExterne
    ) {
      contexte.addIssue({
        code: 'custom',
        path: ['destination'],
        message: 'l’origine et la destination doivent être distinctes',
      });
    }
  });

/**
 * Extrémité observée d'une section : identité fournisseur, libellé et fuseau
 * réellement publiés. Le code métier d'une gare reste le domaine de la
 * résolution (F4-C3b) et n'est pas recalculé ici.
 */
export const PointTrajetNavitiaSchema = z
  .object({
    identifiantExterne: IdentifiantExterneSchema,
    nom: TexteCourtSchema,
    fuseauIana: FuseauIanaNavitiaSchema,
  })
  .strict();

/**
 * Section réellement empruntée en transport public. `reseau` est le réseau
 * publié par Navitia : ce n'est ni un opérateur légal, ni un vendeur de
 * billet. `codeLigne` est un code de ligne, jamais une référence de
 * réservation.
 */
export const SectionTransportPublicNavitiaSchema = z
  .object({
    nature: z.literal('transport_public'),
    mode: ModeTransportSchema,
    modePhysique: TexteCourtSchema,
    modeCommercial: TexteCourtSchema.optional(),
    reseau: TexteCourtSchema.optional(),
    codeLigne: TexteCourtSchema.optional(),
    direction: TexteCourtSchema.optional(),
    origine: PointTrajetNavitiaSchema,
    destination: PointTrajetNavitiaSchema,
    departLocal: HeureLocaleIsoNavitiaSchema,
    arriveeLocale: HeureLocaleIsoNavitiaSchema,
    dureeSecondes: z.number().int().nonnegative().max(DUREE_MAX_TRAJET_SECONDES),
  })
  .strict();

/**
 * Marche, correspondance ou attente : conservées pour ne pas présenter un
 * trajet mixte comme un train de bout en bout, sans être sur-modélisées.
 */
export const SectionHorsTransportPublicNavitiaSchema = z
  .object({
    nature: z.literal('hors_transport_public'),
    typeNavitia: z.string().trim().min(1).max(60),
    dureeSecondes: z.number().int().nonnegative().max(DUREE_MAX_TRAJET_SECONDES),
  })
  .strict();

export const SectionTrajetNavitiaSchema = z.discriminatedUnion('nature', [
  SectionTransportPublicNavitiaSchema,
  SectionHorsTransportPublicNavitiaSchema,
]);

/**
 * Observation d'un itinéraire ferroviaire. Ce n'est ni un billet, ni une
 * réservation, ni une disponibilité, ni une garantie de circulation : aucun
 * prix, lien ou statut commercial ne peut y être stocké.
 *
 * Les heures restent locales et le fuseau de chaque extrémité reste distinct :
 * aucune promotion en instant absolu n'est effectuée.
 *
 * Deux échelles cohabitent volontairement, sans être mélangées :
 * `departLocal`, `arriveeLocale`, `dureeSecondes` et
 * `nombreCorrespondancesFournisseur` décrivent l'itinéraire **entier** tel que
 * Navitia l'a calculé, marche comprise ; `origine` et `destination` sont les
 * extrémités **en transport public** (première et dernière section), donc les
 * gares. Un itinéraire commençant à pied part ainsi avant d'atteindre
 * `origine` — c'est un fait fournisseur, pas une incohérence.
 */
export const CandidatTrajetFerroviaireNavitiaSchema = z
  .object({
    fournisseur: z.literal(FOURNISSEUR_NAVITIA),
    signature: z.string().trim().min(1).max(2_000),
    origine: PointTrajetNavitiaSchema,
    destination: PointTrajetNavitiaSchema,
    departLocal: HeureLocaleIsoNavitiaSchema,
    arriveeLocale: HeureLocaleIsoNavitiaSchema,
    dureeSecondes: z.number().int().nonnegative().max(DUREE_MAX_TRAJET_SECONDES),
    nombreCorrespondancesFournisseur: z.number().int().nonnegative().max(20),
    sections: z
      .array(SectionTrajetNavitiaSchema)
      .min(1)
      .max(NOMBRE_MAX_SECTIONS_NAVITIA),
    fraicheur: FraicheurNavitiaSchema,
    source: SourceHttpsSchema,
    recupereLe: z.iso.datetime({ offset: true }),
  })
  .strict();

export type CodeNavitia = z.infer<typeof CodeNavitiaSchema>;
export type StopAreaNavitia = z.infer<typeof StopAreaNavitiaSchema>;
export type PlaceNavitia = z.infer<typeof PlaceNavitiaSchema>;
export type RechercheGareNavitia = z.infer<typeof RechercheGareNavitiaSchema>;
export type CandidatGareNavitia = z.infer<typeof CandidatGareNavitiaSchema>;
export type FraicheurNavitia = z.infer<typeof FraicheurNavitiaSchema>;
export type SensDateNavitia = z.infer<typeof SensDateNavitiaSchema>;
export type SectionNavitia = z.infer<typeof SectionNavitiaSchema>;
export type JourneyNavitia = z.infer<typeof JourneyNavitiaSchema>;
export type RechercheTrajetsNavitia = z.infer<
  typeof RechercheTrajetsNavitiaSchema
>;
export type PointTrajetNavitia = z.infer<typeof PointTrajetNavitiaSchema>;
export type SectionTrajetNavitia = z.infer<typeof SectionTrajetNavitiaSchema>;
export type SectionTransportPublicNavitia = z.infer<
  typeof SectionTransportPublicNavitiaSchema
>;
export type CandidatTrajetFerroviaireNavitia = z.infer<
  typeof CandidatTrajetFerroviaireNavitiaSchema
>;
export type ProvenanceGareNavitia = z.infer<
  typeof ProvenanceGareNavitiaSchema
>;
