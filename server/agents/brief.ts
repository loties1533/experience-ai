import { z } from 'zod';
import {
  ContexteSchema,
  NombreAdultesHebergementSchema,
  NombreChambresHebergementSchema,
  NombreEnfantsHebergementSchema,
  SejourHebergementSchema,
} from '../domaine/parcours/index.js';
import {
  DateTransportDemandeeSchema,
  DemandeTransportSchema,
  LieuTransportDemandeSchema,
  ModeTransportSchema,
  NOMBRE_MAX_TRONCONS_TRANSPORT,
  NombreAdultesTransportSchema,
  NombreEnfantsTransportSchema,
  PreferencesTransportSchema,
  normaliserVillePourComparaison,
  type DemandeTransport,
} from '../domaine/transport/index.js';

// Le brief : ce que le dialogue d'intake doit réunir avant de générer.
// Intention + contexte sont co-égaux (ADR-0005). Le dialogue exige aussi des
// dates globales pour lancer les connecteurs ; les données hôtelières ne
// deviennent bloquantes que lorsqu'un hébergement est explicitement nécessaire.

/**
 * Le brief peut conserver une saisie partielle, mais son statut reste alors
 * explicitement `a_confirmer`. La variante `declaree` exige les trois valeurs
 * et ne peut donc jamais présenter une occupation incomplète comme certaine.
 */
export const OccupationHebergementBriefSchema = z.discriminatedUnion('statut', [
  z
    .object({
      statut: z.literal('declaree'),
      adultes: NombreAdultesHebergementSchema,
      enfants: NombreEnfantsHebergementSchema,
      chambres: NombreChambresHebergementSchema,
    })
    .strict(),
  z
    .object({
      statut: z.literal('a_confirmer'),
      adultes: NombreAdultesHebergementSchema.optional(),
      enfants: NombreEnfantsHebergementSchema.optional(),
      chambres: NombreChambresHebergementSchema.optional(),
    })
    .strict(),
]);

export const HebergementBriefSchema = z.discriminatedUnion('necessaire', [
  z.object({ necessaire: z.literal(false) }).strict(),
  z
    .object({
      necessaire: z.literal(true),
      occupation: OccupationHebergementBriefSchema.default({ statut: 'a_confirmer' }),
      sejours: z.array(SejourHebergementSchema).default([]),
    })
    .strict(),
]);

/**
 * Un tronçon de dialogue peut être partiel. Dès qu'il devient complet, il
 * repasse par `DemandeTransportSchema` avant toute génération ou persistance.
 * Les lieux restent des intentions : aucun champ de lieu confirmé n'existe ici.
 */
export const LieuTransportBriefSchema =
  LieuTransportDemandeSchema.omit({ preference: true }).strict();

export const TronconTransportBriefSchema = z
  .object({
    origine: LieuTransportBriefSchema.optional(),
    destination: LieuTransportBriefSchema.optional(),
    depart: DateTransportDemandeeSchema.optional(),
    modeSouhaite: ModeTransportSchema.optional(),
  })
  .strict();

export const OccupationTransportBriefSchema = z.discriminatedUnion('statut', [
  z
    .object({
      statut: z.literal('declaree'),
      adultes: NombreAdultesTransportSchema,
      enfants: NombreEnfantsTransportSchema,
    })
    .strict(),
  z
    .object({
      statut: z.literal('a_confirmer'),
      adultes: NombreAdultesTransportSchema.optional(),
      enfants: NombreEnfantsTransportSchema.optional(),
    })
    .strict(),
]);

export const TransportBriefSchema = z.discriminatedUnion('necessaire', [
  z.object({ necessaire: z.literal(false) }).strict(),
  z
    .object({
      necessaire: z.literal(true),
      troncons: z
        .array(TronconTransportBriefSchema)
        .min(1)
        .max(NOMBRE_MAX_TRONCONS_TRANSPORT),
      occupation: OccupationTransportBriefSchema,
      preferences: PreferencesTransportSchema.optional(),
    })
    .strict(),
]);

export const BriefSchema = z
  .object({
    intention: z.string().min(1),
    avecQui: ContexteSchema.shape.avecQui,
    duree: ContexteSchema.shape.duree,
    // Optionnelles, comme dans le contexte : on ne bloque jamais le dialogue
    // sur des dates que l'utilisateur n'a pas encore arrêtées.
    dates: ContexteSchema.shape.dates,
    lieux: z.array(z.string().min(1)).default([]),
    budgetTotal: z.number().positive().optional(),
    ambiance: z.string().optional(),
    contraintes: z.array(z.string().min(1)).default([]),
    // Absent : aucun besoin hôtelier n'a été exprimé. `necessaire: false` :
    // l'utilisateur a explicitement indiqué qu'il ne faut pas d'hébergement.
    hebergement: HebergementBriefSchema.optional(),
    // Absent dans un parcours mono-ville : aucun transport interurbain n'a
    // été demandé. Plusieurs villes exigent en revanche une confirmation
    // explicite `necessaire: true|false`, sans fabriquer de tronçon.
    transport: TransportBriefSchema.optional(),
  })
  .strict();

export const BriefPartielSchema = BriefSchema.partial();

export type Brief = z.infer<typeof BriefSchema>;
export type BriefPartiel = z.infer<typeof BriefPartielSchema>;
export type OccupationHebergementBrief = z.infer<typeof OccupationHebergementBriefSchema>;
export type HebergementBrief = z.infer<typeof HebergementBriefSchema>;
export type TronconTransportBrief = z.infer<
  typeof TronconTransportBriefSchema
>;
export type OccupationTransportBrief = z.infer<
  typeof OccupationTransportBriefSchema
>;
export type TransportBrief = z.infer<typeof TransportBriefSchema>;

const LIBELLES_MANQUANTS: Record<'intention' | 'avecQui' | 'duree' | 'dates', string> = {
  intention: 'l’envie (que voulez-vous vivre ?)',
  avecQui: 'avec qui',
  duree: 'la durée',
  // Une durée seule ("3 semaines") n'ancre le parcours à aucune vraie date :
  // les connecteurs (PredictHQ...) chercheraient alors sur une date inventée,
  // sans rapport avec le vrai séjour. Une date de départ, même approximative,
  // suffit — la fin se calcule ensuite depuis la durée (jamais confiée au LLM).
  // « point de départ » a été essayé puis abandonné : constaté en usage réel
  // (recette live), le modèle le comprend comme une VILLE, pas une date, et
  // demande d'où l'utilisateur part au lieu de quand.
  dates: 'une date de départ, même approximative (à quel moment, pas d’où)',
};

const LIBELLES_HEBERGEMENT = {
  adultes: 'le nombre d’adultes pour l’hébergement',
  enfants: 'le nombre d’enfants pour l’hébergement, même s’il est égal à zéro',
  chambres: 'le nombre de chambres demandé',
  sejours: 'la ville et les dates propres à chaque séjour hôtelier',
} as const;

const LIBELLES_TRANSPORT = {
  besoin:
    'la confirmation qu’un transport doit être organisé entre les villes',
  origine: 'la ville d’origine de chaque tronçon transport',
  destination: 'la ville de destination de chaque tronçon transport',
  date: 'la date civile de départ de chaque tronçon transport',
  adultes: 'le nombre d’adultes pour le transport',
  enfants:
    'le nombre d’enfants pour le transport, même s’il est égal à zéro',
} as const;

export type ChampTransport =
  | 'besoin'
  | 'origine'
  | 'destination'
  | 'date'
  | 'adultes'
  | 'enfants'
  | 'occupation'
  | 'demande';

export interface ChampTransportAttendu {
  champ: ChampTransport;
  indexTroncon?: number;
}

export function estParcoursMultiVille(
  brief: Pick<BriefPartiel, 'lieux'>
): boolean {
  return (
    new Set(
      (brief.lieux ?? []).map(normaliserVillePourComparaison)
    ).size > 1
  );
}

/** Une ville unique ne force rien ; plusieurs villes exigent un oui/non. */
export function prochainChampTransport(
  brief: BriefPartiel
): ChampTransportAttendu | undefined {
  if (!brief.transport) {
    return estParcoursMultiVille(brief)
      ? { champ: 'besoin' }
      : undefined;
  }
  if (!brief.transport.necessaire) return undefined;

  for (
    let indexTroncon = 0;
    indexTroncon < brief.transport.troncons.length;
    indexTroncon += 1
  ) {
    const troncon = brief.transport.troncons[indexTroncon];
    if (!troncon.origine) return { champ: 'origine', indexTroncon };
    if (!troncon.destination) {
      return { champ: 'destination', indexTroncon };
    }
    if (!troncon.depart) return { champ: 'date', indexTroncon };
  }

  // La présence des champs ne suffit pas : origine et destination doivent
  // différer, les dates rester ordonnées et les préférences être cohérentes
  // avant de passer aux voyageurs.
  if (
    !DemandeTransportSchema.safeParse({
      troncons: brief.transport.troncons,
      occupation: { statut: 'a_confirmer' },
      preferences: brief.transport.preferences,
    }).success
  ) {
    return { champ: 'demande' };
  }

  if (brief.transport.occupation.statut === 'a_confirmer') {
    if (brief.transport.occupation.adultes === undefined) {
      return { champ: 'adultes' };
    }
    if (brief.transport.occupation.enfants === undefined) {
      return { champ: 'enfants' };
    }
    return { champ: 'occupation' };
  }
  return undefined;
}

/**
 * Seule une demande complète et une occupation déclarée peuvent rejoindre le
 * parcours. Cette fonction n'invente ni valeur ni statut.
 */
export function demandeTransportComplete(
  brief: BriefPartiel
): DemandeTransport | undefined {
  if (
    brief.transport?.necessaire !== true ||
    prochainChampTransport(brief) !== undefined ||
    brief.transport.occupation.statut !== 'declaree'
  ) {
    return undefined;
  }
  const resultat = DemandeTransportSchema.safeParse({
    troncons: brief.transport.troncons,
    occupation: brief.transport.occupation,
    preferences: brief.transport.preferences,
  });
  return resultat.success ? resultat.data : undefined;
}

/**
 * « Du 4 au 6 septembre » désigne des JOURS, pas des instants : le 6 est
 * compris en entier. Le modèle rend pourtant des dates à minuit — une fin au
 * 6 à 00:00 exclut toute la journée du 6, et le brunch du dimanche tombait
 * alors hors des bornes du parcours. Résultat observé en recette : la
 * génération échouait en « parcours incohérent », sans que rien ne soit
 * réellement incohérent.
 *
 * Une fin posée à minuit est donc étendue à la fin de sa journée. Une fin qui
 * porte une heure explicite est respectée telle quelle : elle vient de
 * quelqu'un qui a voulu cette heure-là.
 */
export function normaliserDatesBrief<T extends BriefPartiel>(brief: T): T {
  if (!brief.dates) return brief;

  const fin = new Date(brief.dates.fin);
  const poseeAMinuit =
    fin.getUTCHours() === 0 &&
    fin.getUTCMinutes() === 0 &&
    fin.getUTCSeconds() === 0 &&
    fin.getUTCMilliseconds() === 0;
  if (!poseeAMinuit) return brief;

  const finDeJournee = new Date(fin);
  finDeJournee.setUTCHours(23, 59, 59, 999);
  return { ...brief, dates: { ...brief.dates, fin: finDeJournee.toISOString() } };
}

/**
 * La fin d'une plage se CALCULE depuis un début connu + la durée — jamais
 * confiée au LLM (arithmétique de dates, pas son fort). Utilisé une fois
 * qu'un point de départ a été obtenu, pour que le domaine porte toujours de
 * vraies dates avant la génération.
 */
export function calculerDates(
  debutISO: string,
  duree: { valeur: number; unite: 'heures' | 'jours' | 'semaines' }
): { debut: string; fin: string } {
  const HEURES_PAR_UNITE: Record<typeof duree.unite, number> = {
    heures: 1,
    jours: 24,
    semaines: 24 * 7,
  };
  const debut = new Date(debutISO);
  const fin = new Date(debut.getTime() + duree.valeur * HEURES_PAR_UNITE[duree.unite] * 3_600_000);
  return { debut: debut.toISOString(), fin: fin.toISOString() };
}

/** Les champs requis encore absents — le dialogue ne pose que ces questions. */
export function champsManquants(brief: BriefPartiel): string[] {
  const manquants = (Object.keys(LIBELLES_MANQUANTS) as (keyof typeof LIBELLES_MANQUANTS)[])
    .filter((champ) => brief[champ] === undefined)
    .map((champ) => LIBELLES_MANQUANTS[champ]);

  if (brief.hebergement?.necessaire === true) {
    const occupation = brief.hebergement.occupation;
    if (occupation.statut === 'a_confirmer') {
      if (occupation.adultes === undefined) manquants.push(LIBELLES_HEBERGEMENT.adultes);
      if (occupation.enfants === undefined) manquants.push(LIBELLES_HEBERGEMENT.enfants);
      if (occupation.chambres === undefined) manquants.push(LIBELLES_HEBERGEMENT.chambres);
    }
    if (brief.hebergement.sejours.length === 0) {
      manquants.push(LIBELLES_HEBERGEMENT.sejours);
    }
  }

  const transportAttendu = prochainChampTransport(brief);
  if (transportAttendu) {
    const libelles: Record<ChampTransport, string> = {
      besoin: LIBELLES_TRANSPORT.besoin,
      origine: LIBELLES_TRANSPORT.origine,
      destination: LIBELLES_TRANSPORT.destination,
      date: LIBELLES_TRANSPORT.date,
      adultes: LIBELLES_TRANSPORT.adultes,
      enfants: LIBELLES_TRANSPORT.enfants,
      occupation: 'la confirmation de l’occupation transport',
      demande: 'des tronçons transport cohérents et ordonnés',
    };
    manquants.push(libelles[transportAttendu.champ]);
  }
  return manquants;
}

export type ChampHebergement =
  | 'adultes'
  | 'enfants'
  | 'chambres'
  | 'sejours';

/** Question déterministe : le modèle n'invente ni l'ordre ni les valeurs. */
export function questionHebergement(
  brief: BriefPartiel,
  champInvalide?: ChampHebergement
): string | undefined {
  if (brief.hebergement?.necessaire !== true) return undefined;

  const occupation = brief.hebergement.occupation;
  const questions: Record<ChampHebergement, string> = {
    adultes: 'Combien d’adultes séjourneront à l’hôtel ?',
    enfants: 'Combien d’enfants séjourneront à l’hôtel ? Indique 0 s’il n’y en a pas.',
    chambres: 'Combien de chambres te faut-il ?',
    sejours: 'Pour chaque hébergement, quelle est la ville et quelles sont les dates d’arrivée et de départ ?',
  };
  const erreurs: Record<ChampHebergement, string> = {
    adultes: 'Le nombre d’adultes doit être un entier entre 1 et 20.',
    enfants: 'Le nombre d’enfants doit être un entier entre 0 et 20.',
    chambres: 'Le nombre de chambres doit être un entier entre 1 et 10.',
    sejours: 'Chaque séjour doit avoir une ville et des dates AAAA-MM-JJ, avec un départ après l’arrivée.',
  };

  let champAttendu: ChampHebergement | undefined;
  if (occupation.statut === 'a_confirmer') {
    if (occupation.adultes === undefined) champAttendu = 'adultes';
    else if (occupation.enfants === undefined) champAttendu = 'enfants';
    else if (occupation.chambres === undefined) champAttendu = 'chambres';
  }
  if (!champAttendu && brief.hebergement.sejours.length === 0) {
    champAttendu = 'sejours';
  }

  // Une valeur invalide pour un champ ultérieur ne doit jamais court-circuiter
  // l'ordre de collecte. Si l'occupation était déjà complète, une correction
  // invalide reste toutefois signalée sur le champ réellement visé.
  if (
    champInvalide &&
    (champAttendu === undefined || champInvalide === champAttendu)
  ) {
    return `${erreurs[champInvalide]} ${questions[champInvalide]}`;
  }
  return champAttendu ? questions[champAttendu] : undefined;
}

/** Question transport déterministe, une seule information essentielle à la fois. */
export function questionTransport(
  brief: BriefPartiel,
  champInvalide?: ChampTransport
): string | undefined {
  const attendu = prochainChampTransport(brief);
  if (!attendu) return undefined;

  const numero =
    attendu.indexTroncon === undefined
      ? ''
      : ` du tronçon ${attendu.indexTroncon + 1}`;
  const questions: Record<ChampTransport, string> = {
    besoin:
      'Faut-il organiser un transport entre les villes de ce parcours ?',
    origine: `Quelle est la ville d’origine${numero} ?`,
    destination: `Quelle est la ville de destination${numero} ?`,
    date: `Quelle est la date de départ${numero}, au format AAAA-MM-JJ ?`,
    adultes: 'Combien d’adultes voyageront ?',
    enfants:
      'Combien d’enfants voyageront ? Indique 0 s’il n’y en a pas.',
    occupation:
      'Confirme séparément le nombre d’adultes puis le nombre d’enfants pour le transport.',
    demande:
      'Peux-tu repréciser les tronçons transport dans leur ordre, avec des villes distinctes et des dates non décroissantes ?',
  };
  const erreurs: Partial<Record<ChampTransport, string>> = {
    origine: 'La ville d’origine doit être indiquée sans gare ni aéroport.',
    destination:
      'La ville de destination doit être indiquée sans gare ni aéroport.',
    date: 'La date doit être une date civile réelle au format AAAA-MM-JJ.',
    adultes: 'Le nombre d’adultes doit être un entier entre 1 et 20.',
    enfants: 'Le nombre d’enfants doit être un entier entre 0 et 20.',
  };

  if (champInvalide === attendu.champ && erreurs[champInvalide]) {
    return `${erreurs[champInvalide]} ${questions[champInvalide]}`;
  }
  return questions[attendu.champ];
}

const LIBELLES_AVEC_QUI = {
  solo: 'en solo',
  couple: 'en couple',
  famille: 'en famille',
  amis: 'entre amis',
  groupe: 'en groupe',
} as const;

/** Date affichable (« 12 juillet 2026 ») à partir d'un horodatage ISO. */
function enFrancais(horodatageISO: string): string {
  return new Date(horodatageISO).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

const SINGULIERS: Record<'heures' | 'jours' | 'semaines', string> = {
  heures: 'heure',
  jours: 'jour',
  semaines: 'semaine',
};

/** « 1 jour », « 2 jours », « 3 semaines » : le singulier sous 2, sinon le pluriel. */
function accorderDuree(valeur: number, unite: 'heures' | 'jours' | 'semaines'): string {
  return `${valeur} ${valeur < 2 ? SINGULIERS[unite] : unite}`;
}

/** Reformulation affichable du brief compris — validée par l'utilisateur avant génération. */
export function reformulerBrief(brief: Brief): string {
  const morceaux = [
    `Tu veux ${brief.intention}, ${LIBELLES_AVEC_QUI[brief.avecQui]}, sur ${accorderDuree(brief.duree.valeur, brief.duree.unite)}`,
  ];
  if (brief.dates) {
    morceaux.push(`du ${enFrancais(brief.dates.debut)} au ${enFrancais(brief.dates.fin)}`);
  }
  if (brief.lieux.length > 0) morceaux.push(`du côté de ${brief.lieux.join(', ')}`);
  if (brief.budgetTotal !== undefined) morceaux.push(`avec un budget d'environ ${brief.budgetTotal} €`);
  if (brief.ambiance) morceaux.push(`dans une ambiance ${brief.ambiance}`);
  if (brief.hebergement?.necessaire === true) {
    const { occupation, sejours } = brief.hebergement;
    if (occupation.statut === 'declaree') {
      morceaux.push(
        `avec ${occupation.adultes} adulte${occupation.adultes > 1 ? 's' : ''}, ` +
          `${occupation.enfants} enfant${occupation.enfants > 1 ? 's' : ''} et ` +
          `${occupation.chambres} chambre${occupation.chambres > 1 ? 's' : ''} pour l’hébergement`
      );
    }
    if (sejours.length > 0) {
      morceaux.push(
        sejours
          .map((sejour) => `${sejour.ville} du ${sejour.arrivee} au ${sejour.depart}`)
          .join(' puis ')
      );
    }
  }
  const demandeTransport = demandeTransportComplete(brief);
  if (demandeTransport) {
    morceaux.push(
      demandeTransport.troncons
        .map(
          (troncon) =>
            `${troncon.origine.ville} → ${troncon.destination.ville} le ${troncon.depart.date}`
        )
        .join(' puis ')
    );
    if (demandeTransport.occupation.statut === 'declaree') {
      morceaux.push(
        `avec ${demandeTransport.occupation.adultes} adulte${demandeTransport.occupation.adultes > 1 ? 's' : ''} et ` +
          `${demandeTransport.occupation.enfants} enfant${demandeTransport.occupation.enfants > 1 ? 's' : ''} pour le transport`
      );
    }
  }
  const phrase = morceaux.join(', ');
  const fin = brief.contraintes.length > 0 ? `. À respecter : ${brief.contraintes.join(' ; ')}.` : '.';
  return phrase + fin;
}
