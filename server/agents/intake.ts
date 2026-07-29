import { z } from 'zod';
import { callAI, parseJSON, sanitizeInput } from '../services/claude/core.js';
import { AppError } from '../lib/AppError.js';
import {
  DateTimeISOSchema,
  NombreAdultesHebergementSchema,
  NombreChambresHebergementSchema,
  NombreEnfantsHebergementSchema,
  SejourHebergementSchema,
  type SejourHebergement,
} from '../domaine/parcours/index.js';
import {
  DateTransportDemandeeSchema,
  LieuTransportDemandeSchema,
  ModeTransportSchema,
  NombreAdultesTransportSchema,
  NombreEnfantsTransportSchema,
  PreferencesTransportSchema,
  estVilleTransportDemandeePrudente,
  normaliserVillePourComparaison,
  type DateTransportDemandee,
  type LieuTransportDemande,
  type ModeTransport,
  type PreferencesTransport,
} from '../domaine/transport/index.js';
import {
  BriefPartielSchema,
  champsManquants,
  reformulerBrief,
  normaliserDatesBrief,
  calculerDates,
  BriefSchema,
  TransportBriefSchema,
  questionHebergement,
  questionTransport,
  prochainChampTransport,
  type ChampHebergement,
  type ChampTransport,
  type HebergementBrief,
  type OccupationTransportBrief,
  type TransportBrief,
  type TronconTransportBrief,
  type BriefPartiel,
} from './brief.js';

// Agent d'intake : mène le dialogue d'entrée, extrait le brief au fil des
// réponses et ne pose QUE les questions nécessaires. Il ne génère rien —
// la génération est le rôle de l'orchestrateur (generation.ts).

const SYSTEM_INTAKE = `Tu aides à comprendre l'envie d'un utilisateur pour construire un parcours personnalisé.
Réponds UNIQUEMENT en JSON valide : {"reponse": string, "brief": objet}.
- "brief" : uniquement les champs que le DERNIER message permet d'établir, parmi :
  intention (string, l'envie — jamais une destination), avecQui ("solo"|"couple"|"famille"|"amis"|"groupe"),
  duree ({"valeur": number, "unite": "heures"|"jours"|"semaines"}), dates ({"debut": ISO, "fin": ISO} — UNIQUEMENT si
  l'utilisateur donne les DEUX bornes explicitement), dateDebut (ISO — UNIQUEMENT si l'utilisateur donne une VRAIE date
  de départ, même approximative : "mi-août", "le 15 août", "dans deux semaines". Sans année précisée, suppose la
  prochaine occurrence future de cette date. Ne devine JAMAIS dateDebut s'il n'a rien dit sur le moment où il part —
  ce champ concerne QUAND il part, jamais D'OÙ il part : une ville reste "lieux", pas "dateDebut"),
  lieux (string[]), budgetTotal (number, en euros), ambiance (string), contraintes (string[]),
  hebergement (UNIQUEMENT si l'utilisateur exprime explicitement qu'un hébergement est nécessaire ou non) :
    {"necessaire": false}
    ou {"necessaire": true, "occupation": {"statut": "a_confirmer", "adultes"?: entier, "enfants"?: entier,
    "chambres"?: entier}, "sejours": [{"ville": string, "arrivee": "AAAA-MM-JJ", "depart": "AAAA-MM-JJ"}]}.
  transport (UNIQUEMENT si l'utilisateur demande explicitement un trajet, ou répond à une question transport) :
    {"necessaire": false}
    ou {"necessaire": true, "troncons": [{"origine"?: {"ville": string, "codePays"?: "FR"},
    "destination"?: {"ville": string, "codePays"?: "FR"}, "depart"?: {"date": "AAAA-MM-JJ",
    "creneau"?: "matin"|"apres_midi"|"soir"|"nuit"}, "modeSouhaite"?: "avion"|"train"|"bus"|"ferry"|
    "voiture"|"transport_local"|"autre"}], "occupation": {"statut": "a_confirmer", "adultes"?: entier,
    "enfants"?: entier}, "preferences"?: objet}.
- N'infère JAMAIS l'occupation depuis avecQui : "solo", "couple", "famille" ou "groupe" ne donnent aucun nombre.
- N'infère JAMAIS les occupants depuis les participants. N'infère ni enfants=0 ni le nombre de chambres.
- N'infère JAMAIS l'occupation transport depuis avecQui, l'occupation de l'hôtel ou les participants.
- Plusieurs villes ne définissent jamais automatiquement un trajet : attends la confirmation de l'utilisateur.
- Un aller-retour porte deux tronçons explicites. N'inverse jamais automatiquement origine et destination et
  ne calcule jamais une date de retour.
- Pour le transport, conserve seulement ville, code pays explicitement écrit, date civile, créneau et mode souhaité.
  N'invente jamais gare, aéroport, code IATA/UIC, compagnie, numéro, horaire exact, lien, prix ou disponibilité.
- Ne copie pas automatiquement les dates globales du parcours dans un séjour hôtelier : elles doivent être exprimées
  pour l'hébergement. Conserve les dates hôtelières sans heure au format AAAA-MM-JJ.
- "duree" GARDE TOUJOURS l'unité EXACTE que l'utilisateur emploie, ne la convertis JAMAIS toi-même :
  "3 semaines" → {"valeur": 3, "unite": "semaines"}, jamais {"valeur": 3, "unite": "jours"}.
- "reponse" : UNE question courte et chaleureuse en français sur UN champ requis manquant (intention, avecQui, duree,
  une date de départ approximative — jamais "point de départ", qui prête à confusion avec une ville). Jamais deux
  questions. TUTOIE toujours l'utilisateur (« tu », jamais « vous »).
- N'invente jamais un champ que l'utilisateur n'a pas exprimé.`;

const SortieIntakeSchema = z.object({
  reponse: z.string().min(1),
  brief: z.unknown(),
});

/** Juste un point de départ, sans la fin — extrait séparément de "dates" (les deux bornes). */
function extraireDateDebut(brut: unknown): string | undefined {
  if (typeof brut !== 'object' || brut === null) return undefined;
  const valeur = (brut as Record<string, unknown>).dateDebut;
  const resultat = DateTimeISOSchema.safeParse(valeur);
  return resultat.success ? resultat.data : undefined;
}

/**
 * Filet déterministe pour une plage écrite en chiffres ("du 15/08 au 10/09") :
 * constaté en recette, le LLM la comprend très bien — il la reformule dans
 * "reponse" — mais ne la structure pas toujours dans "brief". On ne dépend
 * pas de lui seul pour un champ aussi structurant. Motif générique : aucune
 * date câblée en dur, marche pour n'importe quelle plage JJ/MM.
 */
function extrairePlageExplicite(message: string): { debut: string; fin: string } | undefined {
  const motif = /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*(?:au|-|à)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/i;
  const trouve = message.match(motif);
  if (!trouve) return undefined;

  const construire = (jourStr: string, moisStr: string, annee: number): Date | undefined => {
    const jour = Number(jourStr);
    const mois = Number(moisStr);
    if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return undefined;
    return new Date(Date.UTC(annee, mois - 1, jour));
  };

  const anneeExpliciteDebut = trouve[3] ? Number(trouve[3]) : undefined;
  const anneeExpliciteFin = trouve[6] ? Number(trouve[6]) : undefined;
  const anneeCourante = new Date().getUTCFullYear();

  let debut = construire(trouve[1], trouve[2], anneeExpliciteDebut ?? anneeCourante);
  if (!debut) return undefined;
  // Sans année précisée : la prochaine occurrence future, jamais une date passée.
  if (!anneeExpliciteDebut && debut.getTime() < Date.now()) {
    debut = construire(trouve[1], trouve[2], anneeCourante + 1);
    if (!debut) return undefined;
  }

  let fin = construire(trouve[4], trouve[5], anneeExpliciteFin ?? debut.getUTCFullYear());
  if (!fin) return undefined;
  // La fin suit le début : si elle tombe avant ("20/12 au 05/01"), l'année suivante.
  if (!anneeExpliciteFin && fin.getTime() <= debut.getTime()) {
    fin = construire(trouve[4], trouve[5], debut.getUTCFullYear() + 1);
    if (!fin) return undefined;
  }
  if (fin.getTime() <= debut.getTime()) return undefined; // garde-fou : jamais une plage inversée

  return { debut: debut.toISOString(), fin: fin.toISOString() };
}

/**
 * Ne jamais faire confiance au LLM : ses extractions passent par Zod. Mais la
 * validation se fait CHAMP PAR CHAMP, jamais sur l'objet entier.
 *
 * Pourquoi : `safeParse` est tout-ou-rien. Un seul champ mal formé — le modèle
 * écrit `avecQui: "groupe de 8"` là où l'enum attend `"amis"` — faisait perdre
 * TOUS les autres, pourtant valides. En pratique la ville, le budget et les
 * dates donnés dans la même phrase disparaissaient, et le dialogue les
 * redemandait : exactement ce que le produit s'interdit de faire.
 *
 * Ici, un champ invalide est le seul à être ignoré ; le dialogue le redemandera.
 */
function extraireChampsValides(brut: unknown): BriefPartiel {
  if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) return {};

  const formes = BriefPartielSchema.shape;
  const retenu: Record<string, unknown> = {};

  for (const [cle, valeur] of Object.entries(brut as Record<string, unknown>)) {
    if (cle === 'hebergement' || cle === 'transport') {
      continue; // fusions dédiées, champ par champ, ci-dessous
    }
    const forme = formes[cle as keyof typeof formes];
    if (!forme) continue; // champ inventé par le modèle : ignoré
    const resultat = forme.safeParse(valeur);
    if (resultat.success && resultat.data !== undefined) retenu[cle] = resultat.data;
  }

  return retenu as BriefPartiel;
}

type HebergementExtrait =
  | { necessaire: false }
  | {
      necessaire: true;
      occupation?: {
        adultes?: number;
        enfants?: number;
        chambres?: number;
      };
      sejours?: SejourHebergement[];
    };

interface ExtractionHebergement {
  hebergement?: HebergementExtrait;
  champInvalide?: ChampHebergement;
}

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur);
}

type ChampOccupation = 'adultes' | 'enfants' | 'chambres';

function premierChampOccupationManquant(
  brief: BriefPartiel
): ChampOccupation | undefined {
  if (brief.hebergement?.necessaire !== true) return undefined;
  const occupation = brief.hebergement.occupation;
  if (occupation.statut === 'declaree') return undefined;
  if (occupation.adultes === undefined) return 'adultes';
  if (occupation.enfants === undefined) return 'enfants';
  if (occupation.chambres === undefined) return 'chambres';
  return undefined;
}

/**
 * Preuve textuelle minimale : le nombre doit accompagner le mot métier, ou
 * constituer à lui seul la réponse à la question actuellement attendue.
 * Ainsi, un nombre ajouté par le modèle à partir de « famille » est ignoré.
 */
function extraireNombreOccupationExplicite(
  message: string,
  champ: ChampOccupation,
  briefActuel: BriefPartiel
): number | undefined {
  if (
    /\b(?:transport|trajet|train|avion|vol|bus|ferry|taxi|voyage|voyager|voyageurs?)\b/i.test(
      message
    ) &&
    !/\b(?:h[oô]tel|h[ée]bergement|chambres?)\b/i.test(message)
  ) {
    return undefined;
  }
  const motifs: Record<ChampOccupation, RegExp> = {
    adultes: /(?:^|\D)(\d{1,2})\s*adultes?\b/i,
    enfants: /(?:^|\D)(\d{1,2})\s*enfants?\b/i,
    chambres: /(?:^|\D)(\d{1,2})\s*chambres?\b/i,
  };
  const trouve = message.match(motifs[champ]);
  if (trouve) return Number(trouve[1]);

  if (
    new RegExp(`\\b(?:z[ée]ro)\\s*${champ === 'chambres' ? 'chambres?' : `${champ}?`}\\b`, 'i')
      .test(message)
  ) {
    return 0;
  }

  if (
    champ === 'enfants' &&
    /\b(?:aucun(?:e)?|sans|pas\s+d['’]?)\s*enfants?\b/i.test(message)
  ) {
    return 0;
  }

  const reponseSeule = message.trim().match(/^(\d{1,2})$/);
  if (
    reponseSeule &&
    premierChampOccupationManquant(briefActuel) === champ
  ) {
    return Number(reponseSeule[1]);
  }
  return undefined;
}

/**
 * L'occupation est extraite valeur par valeur : un nombre invalide ne fait pas
 * perdre deux nombres valides donnés dans la même réponse. Le statut final ne
 * vient jamais du modèle ; il est calculé après fusion avec le brief courant.
 */
function extraireHebergement(
  brut: unknown,
  messageUtilisateur: string,
  briefActuel: BriefPartiel
): ExtractionHebergement {
  if (!estObjet(brut)) return {};

  const hebergement = estObjet(brut.hebergement) ? brut.hebergement : {};
  const hebergementFourni = estObjet(brut.hebergement);
  if (hebergementFourni && hebergement.necessaire === false) {
    return { hebergement: { necessaire: false } };
  }
  if (
    hebergement.necessaire !== true &&
    briefActuel.hebergement?.necessaire !== true
  ) {
    return {};
  }

  let champInvalide: ChampHebergement | undefined;
  const occupation: {
    adultes?: number;
    enfants?: number;
    chambres?: number;
  } = {};
  const formes = {
    adultes: NombreAdultesHebergementSchema,
    enfants: NombreEnfantsHebergementSchema,
    chambres: NombreChambresHebergementSchema,
  } as const;

  for (const champ of Object.keys(formes) as (keyof typeof formes)[]) {
    const explicite = extraireNombreOccupationExplicite(
      messageUtilisateur,
      champ,
      briefActuel
    );
    if (explicite !== undefined) {
      const resultat = formes[champ].safeParse(explicite);
      if (resultat.success) {
        occupation[champ] = resultat.data;
      } else if (!champInvalide) {
        champInvalide = champ;
      }
      continue;
    }
  }

  let sejours: SejourHebergement[] | undefined;
  if ('sejours' in hebergement) {
    if (!Array.isArray(hebergement.sejours)) {
      champInvalide ??= 'sejours';
    } else if (hebergement.sejours.length === 0) {
      // Le modèle renvoie parfois le tableau vide du format attendu alors que
      // le dernier message ne parle pas des dates : ce n'est pas une demande
      // de supprimer un séjour déjà confirmé.
      sejours = undefined;
    } else {
      const resultat = z.array(SejourHebergementSchema).safeParse(hebergement.sejours);
      if (!resultat.success) {
        champInvalide ??= 'sejours';
      } else {
        sejours = resultat.data;
      }
    }
  }

  if (
    !hebergementFourni &&
    Object.keys(occupation).length === 0 &&
    sejours === undefined
  ) {
    return {};
  }

  return {
    hebergement: {
      necessaire: true,
      ...(Object.keys(occupation).length > 0 ? { occupation } : {}),
      ...(sejours ? { sejours } : {}),
    },
    champInvalide,
  };
}

function valeursOccupation(
  hebergement: HebergementBrief | undefined
): { adultes?: number; enfants?: number; chambres?: number } {
  if (hebergement?.necessaire !== true) return {};
  return {
    adultes: hebergement.occupation.adultes,
    enfants: hebergement.occupation.enfants,
    chambres: hebergement.occupation.chambres,
  };
}

/** Fusionne les réponses successives sans jamais promouvoir un objet partiel. */
function fusionnerHebergement(
  actuel: HebergementBrief | undefined,
  extrait: HebergementExtrait | undefined
): HebergementBrief | undefined {
  if (!extrait) return actuel;
  if (!extrait.necessaire) return { necessaire: false };

  const occupation = {
    ...valeursOccupation(actuel),
    ...extrait.occupation,
  };
  const { adultes, enfants, chambres } = occupation;
  const complete =
    adultes !== undefined &&
    enfants !== undefined &&
    chambres !== undefined;

  return {
    necessaire: true,
    occupation: complete
      ? {
          statut: 'declaree',
          adultes,
          enfants,
          chambres,
        }
      : { statut: 'a_confirmer', ...occupation },
    sejours:
      extrait.sejours ??
      (actuel?.necessaire === true ? actuel.sejours : []),
  };
}

type TransportExtrait =
  | { necessaire: false }
  | {
      necessaire: true;
      troncons?: TronconTransportBrief[];
      occupation?: {
        adultes?: number;
        enfants?: number;
      };
      preferences?: PreferencesTransport;
    };

interface ExtractionTransport {
  transport?: TransportExtrait;
  champInvalide?: ChampTransport;
}

function contientExpression(message: string, expression: string): boolean {
  const texte = ` ${normaliserVillePourComparaison(message)} `;
  const recherche = normaliserVillePourComparaison(expression);
  return recherche.length > 0 && texte.includes(` ${recherche} `);
}

function mentionTransportExplicite(message: string): boolean {
  return /\b(?:transport|trajet|train|avion|vol|bus|ferry|taxi|voiture|aller[\s-]?retour)\b/i.test(
    message
  );
}

function messageConcerneUniquementHebergement(message: string): boolean {
  return (
    /\b(?:h[oô]tel|h[ée]bergement|chambres?)\b/i.test(message) &&
    !mentionTransportExplicite(message) &&
    !/\b(?:voyage|voyager|voyageurs?)\b/i.test(message)
  );
}

function refusTransportExplicite(message: string): boolean {
  return (
    /\b(?:sans|aucun|pas\s+de|ne\s+veux\s+pas\s+de)\s+(?:transport|trajet|train|avion|vol|bus|ferry|taxi|voiture)\b/i.test(
      message
    ) ||
    /^(?:non|non merci|pas besoin)[.! ]*$/i.test(message.trim())
  );
}

function decisionTransportDifferee(message: string): boolean {
  return (
    mentionTransportExplicite(message) &&
    /\b(?:on verra|plus tard|pas maintenant|à confirmer|a confirmer)\b/i.test(
      message
    )
  );
}

function confirmationPositive(message: string): boolean {
  return /^(?:oui|oui merci|d['’]accord|exactement|tout à fait)[.! ]*$/i.test(
    message.trim()
  );
}

function codePaysExplicitementEcrit(
  message: string,
  codePays: string
): boolean {
  return new RegExp(
    `(?:^|[\\s,;(])${codePays.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s,;.)])`
  ).test(message);
}

function extraireLieuTransportExplicite(
  brut: unknown,
  message: string
): LieuTransportDemande | undefined {
  if (messageConcerneUniquementHebergement(message)) return undefined;
  const resultat = LieuTransportDemandeSchema.safeParse(brut);
  if (!resultat.success) return undefined;
  if (!estVilleTransportDemandeePrudente(resultat.data.ville)) {
    return undefined;
  }
  if (!contientExpression(message, resultat.data.ville)) return undefined;

  if (
    resultat.data.codePays &&
    !codePaysExplicitementEcrit(message, resultat.data.codePays)
  ) {
    return { ville: resultat.data.ville };
  }
  return {
    ville: resultat.data.ville,
    ...(resultat.data.codePays
      ? { codePays: resultat.data.codePays }
      : {}),
  };
}

/**
 * Quand deux villes sont extraites du même message, leur rôle ne vient pas du
 * LLM : l'origine doit réellement précéder la destination dans le texte. Les
 * formulations plus complexes restent collectées en deux questions, ce qui
 * préfère un faux négatif à un trajet inversé.
 */
function lieuxTransportDansOrdreExplicite(
  message: string,
  origine: string,
  destination: string
): boolean {
  const texte = ` ${normaliserVillePourComparaison(message)} `;
  const origineNormalisee = normaliserVillePourComparaison(origine);
  const destinationNormalisee =
    normaliserVillePourComparaison(destination);
  const debutOrigine = texte.indexOf(` ${origineNormalisee} `);
  const debutDestination = texte.indexOf(
    ` ${destinationNormalisee} `
  );
  if (debutOrigine < 0 || debutDestination < 0) return false;
  const finOrigine = debutOrigine + origineNormalisee.length + 1;
  return finOrigine <= debutDestination;
}

function extraireDateTransportExplicite(
  brut: unknown,
  message: string
): DateTransportDemandee | undefined {
  if (messageConcerneUniquementHebergement(message)) return undefined;
  const resultat = DateTransportDemandeeSchema.safeParse(brut);
  if (!resultat.success) return undefined;
  const expressionDate =
    /\d|janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre|demain|après-demain|apres-demain/i;
  if (!expressionDate.test(message)) return undefined;
  if (
    resultat.data.creneau &&
    !contientExpression(
      message,
      resultat.data.creneau.replace('_', ' ')
    )
  ) {
    return { date: resultat.data.date };
  }
  return resultat.data;
}

function modeTransportExplicitementEcrit(
  message: string
): ModeTransport | undefined {
  const modes: Array<[ModeTransport, RegExp]> = [
    ['avion', /\b(?:avion|vol)\b/i],
    ['train', /\btrain\b/i],
    ['bus', /\bbus\b/i],
    ['ferry', /\b(?:ferry|bateau)\b/i],
    ['voiture', /\bvoiture\b/i],
    [
      'transport_local',
      /\b(?:transport local|métro|metro|tram|taxi)\b/i,
    ],
  ];
  return modes.find(([, motif]) => motif.test(message))?.[0];
}

function extrairePreferencesTransportExplicites(
  brut: unknown,
  message: string
): PreferencesTransport | undefined {
  const resultat = PreferencesTransportSchema.safeParse(brut);
  if (!resultat.success) return undefined;
  const preferences: PreferencesTransport = {};

  if (
    resultat.data.correspondances &&
    (resultat.data.correspondances === 'direct_uniquement'
      ? /\b(?:direct|sans correspondance)\b/i.test(message)
      : /\b(?:avec correspondances?|correspondances? (?:accept[ée]es?|possibles?|ok))\b/i.test(
          message
        ))
  ) {
    preferences.correspondances = resultat.data.correspondances;
  }
  if (
    resultat.data.mobiliteReduite !== undefined &&
    (resultat.data.mobiliteReduite
      ? /\b(?:mobilité réduite|mobilite reduite|PMR|fauteuil)\b/i.test(
          message
        ) &&
        !/\b(?:sans|pas de|aucun besoin de)\s+(?:mobilité réduite|mobilite reduite|PMR|fauteuil)\b/i.test(
          message
        )
      : /\b(?:sans|pas de|aucun besoin de)\s+(?:mobilité réduite|mobilite reduite|PMR|fauteuil)\b/i.test(
          message
        ))
  ) {
    preferences.mobiliteReduite = resultat.data.mobiliteReduite;
  }
  if (
    resultat.data.dureeMaxMinutes !== undefined &&
    new RegExp(
      `\\b${resultat.data.dureeMaxMinutes}\\s*minutes?\\b`,
      'i'
    ).test(message)
  ) {
    preferences.dureeMaxMinutes = resultat.data.dureeMaxMinutes;
  }
  if (resultat.data.budgetMax) {
    const { montant, devise, portee } = resultat.data.budgetMax;
    const montantExplicite = new RegExp(
      `(?:^|\\D)${String(montant).replace('.', '[.,]')}(?:\\D|$)`
    ).test(message);
    const deviseExplicite =
      codePaysExplicitementEcrit(message, devise) ||
      (devise === 'EUR' && message.includes('€'));
    const porteeExplicite =
      portee === 'par_personne'
        ? /\bpar personne\b/i.test(message)
        : /\b(?:au total|budget total|total)\b/i.test(message);
    if (montantExplicite && deviseExplicite && porteeExplicite) {
      preferences.budgetMax = resultat.data.budgetMax;
    }
  }
  return Object.keys(preferences).length > 0 ? preferences : undefined;
}

type ChampOccupationTransport = 'adultes' | 'enfants';

function extraireNombreOccupationTransportExplicite(
  message: string,
  champ: ChampOccupationTransport,
  briefActuel: BriefPartiel
): number | undefined {
  if (messageConcerneUniquementHebergement(message)) return undefined;
  const motifs: Record<ChampOccupationTransport, RegExp> = {
    adultes: /(?:^|\D)(\d{1,2})\s*adultes?\b/i,
    enfants: /(?:^|\D)(\d{1,2})\s*enfants?\b/i,
  };
  const trouve = message.match(motifs[champ]);
  if (trouve) return Number(trouve[1]);
  if (
    champ === 'enfants' &&
    /\b(?:aucun(?:e)?|sans|pas\s+d['’]?)\s*enfants?\b/i.test(message)
  ) {
    return 0;
  }
  const reponseSeule = message.trim().match(/^(\d{1,2})$/);
  const attendu = prochainChampTransport(briefActuel);
  if (reponseSeule && attendu?.champ === champ) {
    return Number(reponseSeule[1]);
  }
  return undefined;
}

function occupationTransportFusionnee(
  actuelle: OccupationTransportBrief | undefined,
  valeurs: { adultes?: number; enfants?: number }
): OccupationTransportBrief {
  const precedentes =
    actuelle?.statut === 'declaree'
      ? { adultes: actuelle.adultes, enfants: actuelle.enfants }
      : {
          adultes: actuelle?.adultes,
          enfants: actuelle?.enfants,
        };
  const fusion = { ...precedentes, ...valeurs };
  if (fusion.adultes !== undefined && fusion.enfants !== undefined) {
    return {
      statut: 'declaree',
      adultes: fusion.adultes,
      enfants: fusion.enfants,
    };
  }
  return { statut: 'a_confirmer', ...fusion };
}

function extraireVilleTransportDirecte(
  message: string
): LieuTransportDemande | undefined {
  const ville = message.trim();
  if (
    ville.length > 80 ||
    !/^[\p{L}\p{M}'’ -]+$/u.test(ville) ||
    !estVilleTransportDemandeePrudente(ville) ||
    /\b(?:je|pars?|partir|depuis|vers|origine|destination)\b/i.test(
      ville
    )
  ) {
    return undefined;
  }
  const resultat = LieuTransportDemandeSchema.safeParse({ ville });
  return resultat.success ? resultat.data : undefined;
}

/**
 * Extraction transport défensive : les valeurs structurées du modèle ne sont
 * retenues que lorsqu'elles ont une trace explicite dans le dernier message.
 */
function extraireTransport(
  brut: unknown,
  messageUtilisateur: string,
  briefActuel: BriefPartiel
): ExtractionTransport {
  const racine = estObjet(brut) ? brut : {};
  const transportBrut = estObjet(racine.transport)
    ? racine.transport
    : undefined;
  const attendu = prochainChampTransport(briefActuel);
  const mention = mentionTransportExplicite(messageUtilisateur);
  const refus = refusTransportExplicite(messageUtilisateur);

  if (refus && (mention || attendu?.champ === 'besoin')) {
    return { transport: { necessaire: false } };
  }
  if (decisionTransportDifferee(messageUtilisateur)) {
    return {};
  }

  const demandeConfirmee =
    mention ||
    (attendu?.champ === 'besoin' &&
      confirmationPositive(messageUtilisateur));
  const transportDejaDemande =
    briefActuel.transport?.necessaire === true;
  if (!demandeConfirmee && !transportDejaDemande) return {};

  const troncons: TronconTransportBrief[] =
    briefActuel.transport?.necessaire === true
    ? briefActuel.transport.troncons.map((troncon) => ({
        ...troncon,
        origine: troncon.origine ? { ...troncon.origine } : undefined,
        destination: troncon.destination
          ? { ...troncon.destination }
          : undefined,
        depart: troncon.depart ? { ...troncon.depart } : undefined,
      }))
    : [{}];
  let champInvalide: ChampTransport | undefined;

  if (transportBrut && 'troncons' in transportBrut) {
    if (!Array.isArray(transportBrut.troncons)) {
      champInvalide =
        attendu?.champ === 'origine' ||
        attendu?.champ === 'destination' ||
        attendu?.champ === 'date'
          ? attendu.champ
          : undefined;
    } else {
      transportBrut.troncons
        .slice(0, 8)
        .forEach((tronconBrut, index) => {
          if (!estObjet(tronconBrut)) return;
          const actuel = troncons[index] ?? {};
          const origine = extraireLieuTransportExplicite(
            tronconBrut.origine,
            messageUtilisateur
          );
          const destination = extraireLieuTransportExplicite(
            tronconBrut.destination,
            messageUtilisateur
          );
          const paireDansOrdre =
            !origine ||
            !destination ||
            lieuxTransportDansOrdreExplicite(
              messageUtilisateur,
              origine.ville,
              destination.ville
            );
          const depart = extraireDateTransportExplicite(
            tronconBrut.depart,
            messageUtilisateur
          );
          const mode = ModeTransportSchema.safeParse(
            tronconBrut.modeSouhaite
          );
          const modeExplicite =
            mode.success &&
            mode.data ===
              modeTransportExplicitementEcrit(messageUtilisateur)
              ? mode.data
              : undefined;
          troncons[index] = {
            ...actuel,
            ...(origine && paireDansOrdre ? { origine } : {}),
            ...(destination && paireDansOrdre
              ? { destination }
              : {}),
            ...(depart ? { depart } : {}),
            ...(modeExplicite ? { modeSouhaite: modeExplicite } : {}),
          };
          if (!paireDansOrdre && !champInvalide) {
            champInvalide = 'origine';
          }
        });
    }
  }

  if (
    /\baller[\s-]?retour\b/i.test(messageUtilisateur) &&
    troncons.length < 2
  ) {
    // Le second tronçon reste vide : aucune inversion ni date n'est inventée.
    troncons.push({});
  }

  if (
    attendu?.indexTroncon !== undefined &&
    attendu.champ === 'date' &&
    !troncons[attendu.indexTroncon]?.depart &&
    /^\d{4}-\d{2}-\d{2}$/.test(messageUtilisateur.trim())
  ) {
    const dateDirecte = DateTransportDemandeeSchema.safeParse({
      date: messageUtilisateur.trim(),
    });
    if (dateDirecte.success) {
      troncons[attendu.indexTroncon] = {
        ...troncons[attendu.indexTroncon],
        depart: dateDirecte.data,
      };
    } else {
      champInvalide = 'date';
    }
  }

  if (
    attendu?.indexTroncon !== undefined &&
    (attendu.champ === 'origine' ||
      attendu.champ === 'destination') &&
    !troncons[attendu.indexTroncon]?.[attendu.champ]
  ) {
    const lieuDirect = extraireVilleTransportDirecte(messageUtilisateur);
    if (lieuDirect) {
      troncons[attendu.indexTroncon] = {
        ...troncons[attendu.indexTroncon],
        [attendu.champ]: lieuDirect,
      };
    } else {
      champInvalide = attendu.champ;
    }
  }

  const valeursOccupation: {
    adultes?: number;
    enfants?: number;
  } = {};
  for (const champ of ['adultes', 'enfants'] as const) {
    const valeur = extraireNombreOccupationTransportExplicite(
      messageUtilisateur,
      champ,
      briefActuel
    );
    if (valeur === undefined) continue;
    const schema =
      champ === 'adultes'
        ? NombreAdultesTransportSchema
        : NombreEnfantsTransportSchema;
    const resultat = schema.safeParse(valeur);
    if (resultat.success) {
      valeursOccupation[champ] = resultat.data;
    } else if (!champInvalide) {
      champInvalide = champ;
    }
  }

  const preferences =
    transportBrut && 'preferences' in transportBrut
      ? extrairePreferencesTransportExplicites(
          transportBrut.preferences,
          messageUtilisateur
        )
      : undefined;
  const transport: TransportExtrait = {
    necessaire: true,
    troncons,
    occupation: valeursOccupation,
    ...(preferences ? { preferences } : {}),
  };
  return { transport, champInvalide };
}

function fusionnerTransport(
  actuel: TransportBrief | undefined,
  extrait: TransportExtrait | undefined
): TransportBrief | undefined {
  if (!extrait) return actuel;
  if (!extrait.necessaire) return { necessaire: false };

  const occupationActuelle =
    actuel?.necessaire === true ? actuel.occupation : undefined;
  const resultat = TransportBriefSchema.safeParse({
    necessaire: true,
    troncons:
      extrait.troncons ??
      (actuel?.necessaire === true ? actuel.troncons : [{}]),
    occupation: occupationTransportFusionnee(
      occupationActuelle,
      extrait.occupation ?? {}
    ),
    preferences:
      extrait.preferences ??
      (actuel?.necessaire === true ? actuel.preferences : undefined),
  });
  return resultat.success ? resultat.data : actuel;
}

export interface EtapeDialogue {
  /** Question suivante, ou reformulation à valider quand le brief est complet. */
  reponse: string;
  brief: BriefPartiel;
  estComplet: boolean;
}

export async function avancerDialogue(
  briefActuel: BriefPartiel,
  messageUtilisateur: string
): Promise<EtapeDialogue> {
  const prompt = `Brief déjà établi : ${JSON.stringify(briefActuel)}
Dernier message de l'utilisateur : "${sanitizeInput(messageUtilisateur)}"
Champs requis encore manquants : ${champsManquants(briefActuel).join(', ') || 'aucun'}`;

  const brut = await callAI(prompt, SYSTEM_INTAKE, 'onboarding');
  const sortie = SortieIntakeSchema.safeParse(parseJSON(brut));
  if (!sortie.success) {
    throw new AppError('Je n’ai pas réussi à comprendre, peux-tu reformuler ?', 502);
  }

  const extrait = extraireChampsValides(sortie.data.brief);
  const extractionHebergement = extraireHebergement(
    sortie.data.brief,
    messageUtilisateur,
    briefActuel
  );
  const hebergement = fusionnerHebergement(
    briefActuel.hebergement,
    extractionHebergement.hebergement
  );
  const extractionTransport = extraireTransport(
    sortie.data.brief,
    messageUtilisateur,
    briefActuel
  );
  const transport = fusionnerTransport(
    briefActuel.transport,
    extractionTransport.transport
  );
  let brief: BriefPartiel = normaliserDatesBrief({
    ...briefActuel,
    ...extrait,
    ...(hebergement ? { hebergement } : {}),
    ...(transport ? { transport } : {}),
  });

  // Filet déterministe, avant de compter sur le LLM : une plage explicite
  // ("du 15/08 au 10/09") qu'il aurait comprise sans la structurer.
  let plageExpliciteUtilisee = false;
  if (!brief.dates) {
    const plage = extrairePlageExplicite(messageUtilisateur);
    if (plage) {
      brief = { ...brief, dates: plage };
      plageExpliciteUtilisee = true;
    }
  }

  // Un point de départ seul (sans la fin) ne vient pas de extraireChampsValides,
  // qui ne connaît que les champs du domaine : on calcule la fin nous-mêmes,
  // depuis la durée déjà connue — jamais confié au LLM.
  let dateDebutUtilise = false;
  if (!brief.dates && brief.duree) {
    const dateDebut = extraireDateDebut(sortie.data.brief);
    if (dateDebut) {
      brief = { ...brief, dates: calculerDates(dateDebut, brief.duree) };
      dateDebutUtilise = true;
    }
  }

  const complet = BriefSchema.safeParse(brief);
  // « Complet » exige aussi un point de départ (dates) : une durée seule
  // n'ancre le parcours à aucune vraie date, et les connecteurs chercheraient
  // alors sur une date inventée, sans rapport avec le vrai séjour.
  const dialogueTermine =
    complet.success &&
    champsManquants(brief).length === 0 &&
    extractionHebergement.champInvalide === undefined &&
    extractionTransport.champInvalide === undefined;
  if (dialogueTermine) {
    // Le brief était déjà complet et rien de nouveau n'a été retenu de ce
    // message : l'utilisateur essayait de corriger quelque chose, mais rien
    // n'a été compris (dates ambiguës, format inattendu...). Rejouer la même
    // confirmation mot pour mot donnerait l'impression qu'on l'ignore — on le
    // dit plutôt franchement, sans reformuler le contenu passé sous silence.
    const auMoinsUnChampNouveau =
      Object.keys(extrait).length > 0 ||
      extractionHebergement.hebergement !== undefined ||
      extractionTransport.transport !== undefined ||
      dateDebutUtilise ||
      plageExpliciteUtilisee;
    const briefActuelDejaTermine =
      BriefSchema.safeParse(briefActuel).success && champsManquants(briefActuel).length === 0;
    if (!auMoinsUnChampNouveau && briefActuelDejaTermine) {
      return {
        reponse: "Je n'ai pas compris ce changement — peux-tu préciser autrement (ex. une date au format JJ/MM/AAAA) ?",
        brief,
        estComplet: true,
      };
    }
    return {
      reponse: `${reformulerBrief(complet.data)} C'est bien ça ?`,
      brief,
      estComplet: true,
    };
  }
  return {
    reponse:
      questionHebergement(brief, extractionHebergement.champInvalide) ??
      questionTransport(brief, extractionTransport.champInvalide) ??
      sortie.data.reponse,
    brief,
    estComplet: false,
  };
}
