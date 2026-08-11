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
  enFrancais,
  BriefSchema,
  TransportBriefSchema,
  questionHebergement,
  questionTransport,
  prochainChampTransport,
  prochainChampBase,
  questionChampBase,
  premiereLocalisationInconnue,
  libelleChampBase,
  ORDRE_CHAMPS_BASE,
  type ChampHebergement,
  type ChampTransport,
  type HebergementBrief,
  type OccupationTransportBrief,
  type TransportBrief,
  type TronconTransportBrief,
  type BriefPartiel,
  type EtatDialogue,
} from './brief.js';
import {
  codesPaysDeclaresDansMessage,
  codePaysDepuisNom,
  extraireLocalisationsDeclarees,
  type LocalisationDeclareeEnCours,
} from './localisationDeclaree.js';
import {
  resoudreExpressionRelative,
  contexteTemporelParDefaut,
  dateReferenceLisible,
} from './resolutionDatesRelatives.js';
import { doitDiffererSejoursHebergementNBA } from './generation/demandeNBA.js';

// Agent d'intake : mène le dialogue d'entrée, extrait le brief au fil des
// réponses et ne pose QUE les questions nécessaires. Il ne génère rien —
// la génération est le rôle de l'orchestrateur (generation.ts).

const SYSTEM_INTAKE = `Tu aides à comprendre l'envie d'un utilisateur pour construire un parcours personnalisé.
Réponds UNIQUEMENT en JSON valide : {"brief": objet}. Le serveur formule lui-même la prochaine question.
- "brief" : uniquement les champs que le DERNIER message permet d'établir, parmi :
  intention ({"texte": string, "nature": "complement"|"remplacement"} — jamais une destination. "texte" ne porte QUE
  l'information NOUVELLE de ce dernier message, jamais une fusion avec ce qui précède : la fusion se fait ailleurs, ne
  la fais jamais toi-même. "nature" vaut "remplacement" si ce message change fondamentalement l'envie (l'utilisateur
  abandonne ou change ce qu'il voulait vivre), "complement" s'il précise ou enrichit l'envie déjà exprimée sans la
  remplacer), avecQui ("solo"|"couple"|"famille"|"amis"|"groupe"),
  duree ({"valeur": number, "unite": "heures"|"jours"|"semaines"}), dates ({"debut": ISO, "fin": ISO} — UNIQUEMENT si
  l'utilisateur donne les DEUX bornes explicitement), dateDebut (ISO — UNIQUEMENT si l'utilisateur donne une VRAIE date
  de départ, même approximative : "mi-août", "le 15 août", "dans deux semaines". Sans année précisée, suppose la
  prochaine occurrence future de cette date. Ne devine JAMAIS dateDebut s'il n'a rien dit sur le moment où il part —
  ce champ concerne QUAND il part, jamais D'OÙ il part : une ville reste "lieux", pas "dateDebut". Structure TOUJOURS
  ta meilleure interprétation dans "dateDebut" ou "dates" lorsqu'une date est exprimée),
  lieux ([{"nom": string, "type": "ville"|"zone"|"pays"|"inconnue", "codePays"?: "FR"}]),
  budgetTotal (number, en euros), ambiance (string), contraintes (string[]),
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
- Pour chaque lieu, "type" décrit uniquement ce que l'utilisateur désigne dans sa phrase : ville, zone (région,
  massif, continent ou zone libre), pays, ou inconnue si la nature ne peut pas être établie honnêtement.
- Le nom du lieu doit reprendre une expression réellement écrite dans le DERNIER message. N'invente ni nom canonique,
  ni identité, ni homonyme. "à Paris" est une intention de ville ; "dans les Alpes" une zone ; "en France" un pays.
- codePays n'est permis que si le pays est explicitement déclaré dans le DERNIER message. Ne le déduis jamais de la
  notoriété d'une ville. Une localisation de type pays doit porter son propre code ISO alpha-2 majuscule.
- Un aller-retour porte deux tronçons explicites. N'inverse jamais automatiquement origine et destination et
  ne calcule jamais une date de retour.
- Pour le transport, conserve seulement ville, code pays explicitement écrit, date civile, créneau et mode souhaité.
  N'invente jamais gare, aéroport, code IATA/UIC, compagnie, numéro, horaire exact, lien, prix ou disponibilité.
- Ne copie pas automatiquement les dates globales du parcours dans un séjour hôtelier : elles doivent être exprimées
  pour l'hébergement. Conserve les dates hôtelières sans heure au format AAAA-MM-JJ.
- "duree" GARDE TOUJOURS l'unité EXACTE que l'utilisateur emploie, ne la convertis JAMAIS toi-même :
  "3 semaines" → {"valeur": 3, "unite": "semaines"}, jamais {"valeur": 3, "unite": "jours"}.
- Ne formule aucune question et ne décide jamais du prochain champ : le serveur le fait après validation.
- Le message précise le champ de base actuellement ciblé uniquement pour t'aider à interpréter une réponse courte.
  Ne réémets jamais un champ listé dans "Champs de base déjà validés", sauf si l'utilisateur vient de le corriger
  explicitement dans son dernier message.
- N'invente jamais un champ que l'utilisateur n'a pas exprimé.
- Le message peut contenir un repère temporel ("Repère temporel : ...") et des dates déjà résolues
  ("Dates déjà résolues : ..."). Si des dates déjà résolues sont fournies, reprends-les TELLES QUELLES
  dans "dates" — ne les recalcule pas, ne les modifie pas, n'en déduis pas d'autres. Elles ne remplacent
  jamais des dates explicites différentes que l'utilisateur vient d'exprimer dans le même message.
- Convention déjà appliquée en amont pour "aujourd'hui", "demain", "après-demain", "dans X jours/semaines",
  "ce week-end" et "le week-end prochain" (à ne jamais recalculer toi-même, ni contredire dans "reponse") :
  "ce week-end" couvre samedi et dimanche du week-end courant tant que ce dimanche n'est pas terminé, sinon
  celui à venir ; "le week-end prochain" est toujours celui qui suit "ce week-end".`;

const SortieIntakeSchema = z.object({
  brief: z.unknown(),
});

/** Juste un point de départ, sans la fin — extrait séparément de "dates" (les deux bornes). */
function extraireDateDebut(brut: unknown): string | undefined {
  if (typeof brut !== 'object' || brut === null) return undefined;
  const valeur = (brut as Record<string, unknown>).dateDebut;
  const resultat = DateTimeISOSchema.safeParse(valeur);
  return resultat.success ? resultat.data : undefined;
}

const MOIS_FRANCAIS: Record<string, number> = {
  janvier: 1,
  février: 2,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  août: 8,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  décembre: 12,
  decembre: 12,
};

/**
 * Filet déterministe pour une date isolée écrite en toutes lettres ("le 30
 * septembre", "12 juillet 2027") : le LLM la comprend mais ne la structure pas
 * toujours dans "dateDebut" avant de poser sa question de confirmation. Motif
 * générique : n'importe quel mois, jamais une date câblée en dur — même
 * principe que `extrairePlageExplicite` ci-dessus, pour un seul jour au lieu
 * d'une plage.
 */
function extraireDateSeuleExplicite(message: string): string | undefined {
  const motif =
    /\b(\d{1,2})\s+(janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)(?:\s+(\d{4}))?\b/i;
  const trouve = message.match(motif);
  if (!trouve) return undefined;

  const jour = Number(trouve[1]);
  if (jour < 1 || jour > 31) return undefined;
  const mois = MOIS_FRANCAIS[trouve[2].toLowerCase()];
  const anneeCourante = new Date().getUTCFullYear();
  const anneeExplicite = trouve[3] ? Number(trouve[3]) : undefined;

  let date = new Date(Date.UTC(anneeExplicite ?? anneeCourante, mois - 1, jour));
  // Sans année précisée : la prochaine occurrence future, jamais une date passée.
  if (!anneeExplicite && date.getTime() < Date.now()) {
    date = new Date(Date.UTC(anneeCourante + 1, mois - 1, jour));
  }
  return date.toISOString();
}

const IntentionExtraiteSchema = z
  .object({
    texte: z.string().min(1),
    nature: z.enum(['complement', 'remplacement']),
  })
  .strict();

/**
 * L'intention reste une simple chaîne dans le Brief (`BriefSchema.intention`).
 * Le LLM qualifie seulement ce qu'il vient d'apprendre ; la fusion réelle
 * (compléter ou remplacer) se décide et s'applique ICI, jamais confiée à sa
 * propre reformulation — sinon une précision ("assister à des matchs en
 * direct") peut silencieusement effacer l'intention déjà acquise ("la NBA").
 */
function extraireIntention(
  brut: unknown,
  briefActuel: BriefPartiel
): string | undefined {
  if (typeof brut !== 'object' || brut === null) return undefined;
  const resultat = IntentionExtraiteSchema.safeParse(
    (brut as Record<string, unknown>).intention
  );
  if (!resultat.success) return undefined;

  if (briefActuel.intention === undefined || resultat.data.nature === 'remplacement') {
    return resultat.data.texte;
  }
  return `${briefActuel.intention} ; ${resultat.data.texte}`;
}

/**
 * Secours honnête quand le fournisseur omet l'intention : uniquement une
 * formulation d'envie explicitement mono-intention, conservée sans
 * enrichissement sémantique ni facette ajoutée. Dès qu'une autre donnée métier
 * est détectable, on préfère redemander l'envie plutôt que copier un bloc mêlant
 * intention, localisation, durée, date, budget ou accompagnement.
 */
function intentionExpliciteDuMessage(
  message: string,
  briefActuel: BriefPartiel,
  briefBrut: unknown
): string | undefined {
  if (briefActuel.intention !== undefined) return undefined;
  const texte = sanitizeInput(message).trim();
  const normalise = normaliserPourPreuve(texte);
  const envieExplicite =
    /\b(je veux|je souhaite|j aimerais|j ai envie de|envie de|je reve de)\b/.test(
      normalise
    );
  if (!envieExplicite) return undefined;

  const autreChampFourni =
    estObjet(briefBrut) &&
    Object.keys(briefBrut).some((champ) => champ !== 'intention');
  const repereTemporel =
    /\b(aujourd hui|aujourdhui|demain|apres-demain|ce week-end|ce weekend|week-end prochain|weekend prochain|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/.test(
      normalise
    ) || /\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?\b/.test(normalise);
  const localisationPossible =
    /\b(aller|partir|se rendre)\b[^.!?]*\b(a|au|aux|en|dans|vers)\b/.test(
      normalise
    );
  const autreInformationExplicite =
    extraireAvecQuiExplicite(texte) !== undefined ||
    extraireDureeExplicite(texte) !== undefined ||
    repereTemporel ||
    localisationPossible ||
    /\b(avec|budget|euros?|depenser|cher|chere)\b|€/.test(normalise);

  return autreChampFourni || autreInformationExplicite ? undefined : texte;
}

/**
 * Filet déterministe pour une plage écrite en chiffres ("du 15/08 au 10/09") :
 * constaté en recette, le LLM la comprend mais ne la structure pas toujours
 * dans "brief". On ne dépend pas de lui seul pour un champ aussi structurant.
 * Motif générique : aucune
 * date câblée en dur, marche pour n'importe quelle plage JJ/MM.
 */
function construireDateUTC(
  jour: number,
  mois: number,
  annee: number
): Date | undefined {
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return undefined;
  const date = new Date(Date.UTC(annee, mois - 1, jour));
  if (
    date.getUTCFullYear() !== annee ||
    date.getUTCMonth() + 1 !== mois ||
    date.getUTCDate() !== jour
  ) {
    return undefined;
  }
  return date;
}

function resoudrePlageCivile(
  debutCivil: { jour: number; mois: number; annee?: number },
  finCivil: { jour: number; mois: number; annee?: number }
): { debut: string; fin: string } | undefined {
  const anneeCourante = new Date().getUTCFullYear();
  let anneeDebut = debutCivil.annee;
  let anneeFin = finCivil.annee;

  if (anneeDebut === undefined && anneeFin !== undefined) {
    const debutApresFin =
      debutCivil.mois > finCivil.mois ||
      (debutCivil.mois === finCivil.mois && debutCivil.jour > finCivil.jour);
    anneeDebut = anneeFin - (debutApresFin ? 1 : 0);
  } else if (anneeDebut !== undefined && anneeFin === undefined) {
    const finAvantDebut =
      finCivil.mois < debutCivil.mois ||
      (finCivil.mois === debutCivil.mois && finCivil.jour < debutCivil.jour);
    anneeFin = anneeDebut + (finAvantDebut ? 1 : 0);
  } else if (anneeDebut === undefined && anneeFin === undefined) {
    anneeDebut = anneeCourante;
    let debutProvisoire = construireDateUTC(
      debutCivil.jour,
      debutCivil.mois,
      anneeDebut
    );
    if (!debutProvisoire) return undefined;
    // Sans année : prochaine occurrence future, comme pour une date isolée.
    if (debutProvisoire.getTime() < Date.now()) {
      anneeDebut += 1;
      debutProvisoire = construireDateUTC(
        debutCivil.jour,
        debutCivil.mois,
        anneeDebut
      );
      if (!debutProvisoire) return undefined;
    }
    const finAvantDebut =
      finCivil.mois < debutCivil.mois ||
      (finCivil.mois === debutCivil.mois && finCivil.jour < debutCivil.jour);
    anneeFin = anneeDebut + (finAvantDebut ? 1 : 0);
  }

  if (anneeDebut === undefined || anneeFin === undefined) return undefined;

  const debut = construireDateUTC(
    debutCivil.jour,
    debutCivil.mois,
    anneeDebut
  );
  const fin = construireDateUTC(finCivil.jour, finCivil.mois, anneeFin);
  if (!debut || !fin || fin.getTime() < debut.getTime()) return undefined;
  return { debut: debut.toISOString(), fin: fin.toISOString() };
}

function nombreJoursCivils(plage: { debut: string; fin: string }): number {
  const jour = (iso: string) => {
    const [annee, mois, date] = iso.slice(0, 10).split('-').map(Number);
    return Math.floor(Date.UTC(annee, mois - 1, date) / 86_400_000);
  };
  return jour(plage.fin) - jour(plage.debut) + 1;
}

function dureeExacteEnJours(
  duree: BriefPartiel['duree']
): number | undefined {
  if (!duree || !Number.isInteger(duree.valeur)) return undefined;
  if (duree.unite === 'jours') return duree.valeur;
  if (duree.unite === 'semaines') return duree.valeur * 7;
  return undefined;
}

function extrairePlageExplicite(
  message: string
): { debut: string; fin: string } | undefined {
  const motifNumerique =
    /(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s*(?:au|-|à)\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/i;
  const numerique = message.match(motifNumerique);
  if (numerique) {
    return resoudrePlageCivile(
      {
        jour: Number(numerique[1]),
        mois: Number(numerique[2]),
        ...(numerique[3] ? { annee: Number(numerique[3]) } : {}),
      },
      {
        jour: Number(numerique[4]),
        mois: Number(numerique[5]),
        ...(numerique[6] ? { annee: Number(numerique[6]) } : {}),
      }
    );
  }

  const nomsMois = Object.keys(MOIS_FRANCAIS).join('|');
  const motifFrancais = new RegExp(
    `\\bdu\\s+(\\d{1,2})(?:\\s+(${nomsMois}))?(?:\\s+(\\d{4}))?\\s+au\\s+(\\d{1,2})\\s+(${nomsMois})(?:\\s+(\\d{4}))?\\b`,
    'i'
  );
  const francais = message.match(motifFrancais);
  if (!francais) return undefined;

  const moisFin = MOIS_FRANCAIS[francais[5].toLowerCase()];
  const moisDebut = francais[2]
    ? MOIS_FRANCAIS[francais[2].toLowerCase()]
    : moisFin;
  return resoudrePlageCivile(
    {
      jour: Number(francais[1]),
      mois: moisDebut,
      ...(francais[3] ? { annee: Number(francais[3]) } : {}),
    },
    {
      jour: Number(francais[4]),
      mois: moisFin,
      ...(francais[6] ? { annee: Number(francais[6]) } : {}),
    }
  );
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
    if (
      cle === 'hebergement' ||
      cle === 'transport' ||
      cle === 'intention' ||
      cle === 'lieux'
    ) {
      continue; // fusions dédiées, champ par champ, ci-dessous
    }
    const forme = formes[cle as keyof typeof formes];
    if (!forme) continue; // champ inventé par le modèle : ignoré
    const resultat = forme.safeParse(valeur);
    if (resultat.success && resultat.data !== undefined) retenu[cle] = resultat.data;
  }

  return retenu as BriefPartiel;
}

function normaliserPourPreuve(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function extraireAvecQuiExplicite(
  message: string
): BriefPartiel['avecQui'] | undefined {
  const texte = normaliserPourPreuve(message);
  const motifs: Record<NonNullable<BriefPartiel['avecQui']>, RegExp> = {
    solo: /\b(seul|seule|solo)\b/,
    couple: /\b(couple|a deux|tous les deux|toutes les deux)\b/,
    famille: /\bfamille\b/,
    amis: /\b(ami|amie|amis|amies|copain|copains|copine|copines)\b/,
    groupe: /\bgroupe\b/,
  };
  const valeurs = (Object.entries(motifs) as [
    NonNullable<BriefPartiel['avecQui']>,
    RegExp,
  ][]).flatMap(([valeur, motif]) => (motif.test(texte) ? [valeur] : []));
  return valeurs.length === 1 ? valeurs[0] : undefined;
}

const NOMBRES_FRANCAIS: Record<string, number> = {
  un: 1,
  une: 1,
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
  'dix-sept': 17,
  'dix-huit': 18,
  'dix-neuf': 19,
  vingt: 20,
  trente: 30,
};

const MOTIF_NOMBRE_DUREE =
  '(\\d+(?:[.,]\\d+)?|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|dix-sept|dix-huit|dix-neuf|vingt|trente)';

function extraireDureeExplicite(
  message: string
): BriefPartiel['duree'] | undefined {
  const texte = normaliserPourPreuve(message);
  const motif = new RegExp(
    `\\b${MOTIF_NOMBRE_DUREE}\\s*(heures?|jour(?:s|nees?)?|semaines?)\\b`
  );
  const trouve = texte.match(motif);
  if (!trouve || new RegExp(`\\bdans\\s+${MOTIF_NOMBRE_DUREE}\\s*${trouve[2]}\\b`).test(texte)) {
    return undefined;
  }
  const valeur = NOMBRES_FRANCAIS[trouve[1]] ?? Number(trouve[1].replace(',', '.'));
  const unite = trouve[2].startsWith('heure')
    ? 'heures'
    : trouve[2].startsWith('semaine')
      ? 'semaines'
      : 'jours';
  const resultat = BriefPartielSchema.shape.duree.safeParse({ valeur, unite });
  return resultat.success ? resultat.data : undefined;
}

function messageDeclareDates(message: string): boolean {
  const texte = normaliserPourPreuve(message);
  return (
    /\b(aujourd'hui|aujourdhui|demain|apres-demain|week-end|weekend|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b/.test(
      texte
    ) ||
    /\bdans\s+(?:\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix)\s+(?:jours?|semaines?)\b/.test(
      texte
    ) ||
    /\b\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?\b/.test(texte)
  );
}

/**
 * Avec qui, durée et dates ne peuvent venir d'une simple inférence du modèle,
 * lors de leur première acquisition comme lors d'une correction. Une valeur
 * n'est admise que si le dernier message porte sa preuve lexicale.
 */
function protegerChampsBaseProuves(
  extrait: BriefPartiel,
  messageUtilisateur: string
): BriefPartiel {
  const protege = { ...extrait };
  const avecQuiExplicite = extraireAvecQuiExplicite(messageUtilisateur);
  const dureeExplicite = extraireDureeExplicite(messageUtilisateur);

  if (avecQuiExplicite) {
    protege.avecQui = avecQuiExplicite;
  } else {
    delete protege.avecQui;
  }
  if (dureeExplicite) {
    protege.duree = dureeExplicite;
  } else {
    delete protege.duree;
  }
  if (
    protege.dates !== undefined &&
    !messageDeclareDates(messageUtilisateur)
  ) {
    delete protege.dates;
  }

  return protege;
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

function confirmationNegative(message: string): boolean {
  return /^(?:non|non merci|pas exactement|pas cette date|pas celle[\s-]l[àa])[.! ]*$/i.test(
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
  /** État transitoire de dialogue à retransmettre au tour suivant, ou absent
   * quand rien n'est en attente de confirmation. Jamais persisté dans le
   * brief ni transmis à la génération. */
  etatDialogue?: EtatDialogue;
}

function questionLocalisation(nom: string): string {
  return `Quand tu dis « ${nom} », parles-tu d’une ville, d’un pays ou d’une zone géographique (région, massif ou continent) ?`;
}

function questionConfirmationDates(etat: Extract<EtatDialogue, { champ: 'dates' }>): string {
  if (etat.dureeCandidate) {
    const jours = etat.dureeCandidate.valeur;
    return (
      `La plage du ${enFrancais(etat.valeurCandidate.debut)} au ` +
      `${enFrancais(etat.valeurCandidate.fin)} couvre ${jours} jour(s). ` +
      `Veux-tu garder cette plage et ajuster la durée à ${jours} jour(s) ?`
    );
  }
  return `Tu pars donc le ${enFrancais(etat.valeurCandidate.debut)} ? Réponds « oui » pour confirmer, ou donne une autre date.`;
}

/**
 * Frontière de décision du dialogue : une seule cible nécessaire, dans
 * l'ordre base → localisation → hébergement → transport. La formulation du
 * modèle n'entre jamais dans cette décision.
 */
function prochaineQuestionRequise(
  brief: BriefPartiel,
  champInvalideHebergement: ChampHebergement | undefined,
  champInvalideTransport: ChampTransport | undefined,
  differerSejoursHebergement: boolean,
  etatDialogueEnCours?: EtatDialogue
): string | undefined {
  const champBase = prochainChampBase(brief);
  if (champBase) {
    if (champBase === 'dates' && etatDialogueEnCours?.champ === 'dates') {
      return questionConfirmationDates(etatDialogueEnCours);
    }
    return questionChampBase(champBase);
  }

  const localisationInconnue = premiereLocalisationInconnue(brief);
  if (localisationInconnue) {
    return questionLocalisation(localisationInconnue.localisation.nom);
  }

  return (
    questionHebergement(
      brief,
      champInvalideHebergement,
      differerSejoursHebergement
    ) ?? questionTransport(brief, champInvalideTransport)
  );
}

function typeDepuisClarificationLocalisation(
  message: string
): 'ville' | 'zone' | 'pays' | undefined {
  const texte = message
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (/\bville\b/.test(texte)) return 'ville';
  if (/\bpays\b/.test(texte)) return 'pays';
  if (/\b(zone|region|massif|continent)\b/.test(texte)) return 'zone';
  return undefined;
}

function localisationClarifiee(
  actuelle: LocalisationDeclareeEnCours,
  message: string
): LocalisationDeclareeEnCours | undefined {
  const type = typeDepuisClarificationLocalisation(message);
  if (!type) return undefined;
  const codes = codesPaysDeclaresDansMessage(message);
  const codeContexte = codes.size === 1 ? [...codes][0] : undefined;
  if (type === 'pays') {
    const codePays = codePaysDepuisNom(actuelle.nom) ?? codeContexte;
    return codePays
      ? { nom: actuelle.nom, type: 'pays', codePays }
      : { nom: actuelle.nom, type: 'inconnue' };
  }
  return {
    nom: actuelle.nom,
    type,
    ...(codeContexte ? { codePays: codeContexte } : {}),
  };
}

/**
 * Calcule la question suivante ou la reformulation finale à partir d'un brief
 * déjà fusionné. Partagée par le chemin LLM normal et par la confirmation
 * déterministe d'une date en attente, pour ne jamais dupliquer cette logique.
 */
function finaliserEtape(
  brief: BriefPartiel,
  briefActuel: BriefPartiel,
  auMoinsUnChampNouveau: boolean,
  champInvalideHebergement: ChampHebergement | undefined,
  champInvalideTransport: ChampTransport | undefined,
  etatDialogueEnCours?: EtatDialogue
): { reponse: string; estComplet: boolean } {
  const complet = BriefSchema.safeParse(brief);
  const differerSejoursHebergement = doitDiffererSejoursHebergementNBA(brief);
  // « Complet » exige aussi un point de départ (dates) : une durée seule
  // n'ancre le parcours à aucune vraie date, et les connecteurs chercheraient
  // alors sur une date inventée, sans rapport avec le vrai séjour.
  const dialogueTermine =
    complet.success &&
    champsManquants(brief, differerSejoursHebergement).length === 0 &&
    champInvalideHebergement === undefined &&
    champInvalideTransport === undefined;
  if (dialogueTermine) {
    // Le brief était déjà complet et rien de nouveau n'a été retenu de ce
    // message : l'utilisateur essayait de corriger quelque chose, mais rien
    // n'a été compris (dates ambiguës, format inattendu...). Rejouer la même
    // confirmation mot pour mot donnerait l'impression qu'on l'ignore — on le
    // dit plutôt franchement, sans reformuler le contenu passé sous silence.
    const briefActuelDejaTermine =
      BriefSchema.safeParse(briefActuel).success &&
      champsManquants(
        briefActuel,
        doitDiffererSejoursHebergementNBA(briefActuel)
      ).length === 0;
    if (!auMoinsUnChampNouveau && briefActuelDejaTermine) {
      return {
        reponse:
          "Je n’ai pas pu appliquer ce changement ; le cadrage confirmé reste inchangé.",
        estComplet: true,
      };
    }
    return { reponse: `${reformulerBrief(complet.data)} C'est bien ça ?`, estComplet: true };
  }

  const question = prochaineQuestionRequise(
    brief,
    champInvalideHebergement,
    champInvalideTransport,
    differerSejoursHebergement,
    etatDialogueEnCours
  );
  if (!question) {
    throw new AppError(
      'Le cadrage du dialogue est invalide malgré l’absence de champ requis identifiable.',
      500
    );
  }
  return {
    reponse: question,
    estComplet: false,
  };
}

export async function avancerDialogue(
  briefActuel: BriefPartiel,
  messageUtilisateur: string,
  etatDialogueActuel?: EtatDialogue
): Promise<EtapeDialogue> {
  if (etatDialogueActuel?.champ === 'localisation') {
    const actuelle = briefActuel.lieux?.[etatDialogueActuel.index];
    if (
      actuelle?.type === 'inconnue' &&
      actuelle.nom === etatDialogueActuel.nom
    ) {
      const clarifiee = localisationClarifiee(actuelle, messageUtilisateur);
      if (!clarifiee || clarifiee.type === 'inconnue') {
        return {
          reponse: questionLocalisation(actuelle.nom),
          brief: briefActuel,
          estComplet: false,
          etatDialogue: etatDialogueActuel,
        };
      }
      const lieux = [...(briefActuel.lieux ?? [])];
      lieux[etatDialogueActuel.index] = clarifiee;
      const brief = { ...briefActuel, lieux };
      const { reponse, estComplet } = finaliserEtape(
        brief,
        briefActuel,
        true,
        undefined,
        undefined
      );
      const inconnueSuivante = premiereLocalisationInconnue(brief);
      return {
        reponse,
        brief,
        estComplet,
        ...(inconnueSuivante
          ? {
              etatDialogue: {
                champ: 'localisation' as const,
                code: 'localisation_a_preciser' as const,
                champCible: 'lieux' as const,
                index: inconnueSuivante.index,
                nom: inconnueSuivante.localisation.nom,
              },
            }
          : {}),
      };
    }
  }

  // Une date candidate reste en attente d'un "oui"/"non" : on tranche ici,
  // déterministe, SANS appeler le LLM — "oui" ne veut rien dire pour lui hors
  // de ce contexte précis, et confirmationPositive() sert déjà ce rôle pour
  // le transport (transport.besoin) : même mécanisme, étendu aux dates.
  if (etatDialogueActuel?.champ === 'dates' && !briefActuel.dates) {
    if (confirmationPositive(messageUtilisateur)) {
      const brief = normaliserDatesBrief({
        ...briefActuel,
        ...(etatDialogueActuel.dureeCandidate
          ? { duree: etatDialogueActuel.dureeCandidate }
          : {}),
        dates: etatDialogueActuel.valeurCandidate,
      });
      const { reponse, estComplet } = finaliserEtape(
        brief,
        briefActuel,
        true,
        undefined,
        undefined
      );
      return { reponse, brief, estComplet };
    }
    if (confirmationNegative(messageUtilisateur)) {
      return {
        reponse: 'Pas de souci — quelle est ta date de départ, même approximative ?',
        brief: briefActuel,
        estComplet: false,
      };
    }
    // Ni "oui" ni "non" : le message est traité normalement ci-dessous — une
    // nouvelle date explicite ("plutôt le 2 octobre") remplacera la candidate.
  }

  // Résolution déterministe AVANT l'appel au LLM : une expression relative
  // reconnue ("demain", "ce week-end"...) ne lui est jamais confiée. On ne la
  // tente que si aucune date n'est déjà arrêtée dans le brief — jamais pour
  // écraser une date explicite déjà validée.
  const contexteTemporel = contexteTemporelParDefaut();
  const plageExpliciteExtraite = extrairePlageExplicite(messageUtilisateur);
  // Une plage explicitement rattachée à un hôtel qualifie le séjour hôtelier,
  // jamais les dates globales du parcours (règle d'intake déjà existante).
  const plageExpliciteResolue =
    plageExpliciteExtraite &&
    !/\b(h[oô]tel|h[eé]bergement|chambre|nuit(?:s|ée)?s?)\b/i.test(
      messageUtilisateur
    )
      ? plageExpliciteExtraite
      : undefined;
  const dateRelativeResolue = briefActuel.dates || plageExpliciteResolue
    ? undefined
    : resoudreExpressionRelative(messageUtilisateur, contexteTemporel);

  // État déterministe du dialogue de base (F7-B) : le serveur choisit QUEL
  // champ de base cibler, jamais le LLM. Celui-ci garde la main sur la
  // formulation de "reponse", pas sur le choix du champ.
  const champBaseCible = prochainChampBase(briefActuel);
  const champsBaseValides = ORDRE_CHAMPS_BASE.filter(
    (champ) => briefActuel[champ] !== undefined
  );
  const clarificationPreparation =
    etatDialogueActuel?.champ === 'preparation_generation'
      ? etatDialogueActuel
      : undefined;
  const differerSejoursHebergement =
    doitDiffererSejoursHebergementNBA(briefActuel);

  const prompt = `Brief déjà établi : ${JSON.stringify(briefActuel)}
Dernier message de l'utilisateur : "${sanitizeInput(messageUtilisateur)}"
Champs requis encore manquants : ${champsManquants(briefActuel, differerSejoursHebergement).join(', ') || 'aucun'}
Champs de base déjà validés (ne jamais les redemander) : ${
    champsBaseValides.length > 0
      ? champsBaseValides.map(libelleChampBase).join(', ')
      : 'aucun'
  }
${
    champBaseCible
      ? `Champ de base attendu maintenant pour interpréter une réponse courte : ${libelleChampBase(champBaseCible)}.`
      : 'Tous les champs de base sont déjà validés : n’en extrais une nouvelle valeur qu’en cas de correction explicite de l’utilisateur.'
  }
Repère temporel : nous sommes le ${dateReferenceLisible(contexteTemporel)} (fuseau ${contexteTemporel.fuseau}).${
    plageExpliciteResolue
      ? `
Plage explicite déjà résolue pour ce message, autoritative sur toute date isolée : du ${plageExpliciteResolue.debut} au ${plageExpliciteResolue.fin}.`
      : dateRelativeResolue
      ? `
Dates déjà résolues pour l'expression temporelle de ce message : du ${dateRelativeResolue.debut} au ${dateRelativeResolue.fin}.`
      : ''
  }${
    clarificationPreparation
      ? `
La réponse de l'utilisateur répond à une clarification de préparation. Extrais si possible uniquement le champ ${clarificationPreparation.champCible} demandé ; ne crée aucun état de dialogue et ne répète pas la question.`
      : ''
  }`;

  const brut = await callAI(prompt, SYSTEM_INTAKE, 'onboarding');
  const sortie = SortieIntakeSchema.safeParse(parseJSON(brut));
  if (!sortie.success) {
    throw new AppError('Je n’ai pas réussi à comprendre, peux-tu reformuler ?', 502);
  }

  const extrait = protegerChampsBaseProuves(
    extraireChampsValides(sortie.data.brief),
    messageUtilisateur
  );
  const localisationsExtraites = estObjet(sortie.data.brief)
    ? extraireLocalisationsDeclarees(
        sortie.data.brief.lieux,
        messageUtilisateur
      )
    : undefined;
  const intentionExtraite =
    extraireIntention(sortie.data.brief, briefActuel) ??
    intentionExpliciteDuMessage(
      messageUtilisateur,
      briefActuel,
      sortie.data.brief
    );
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
    ...(localisationsExtraites !== undefined
      ? { lieux: localisationsExtraites }
      : {}),
    ...(intentionExtraite !== undefined ? { intention: intentionExtraite } : {}),
    ...(hebergement ? { hebergement } : {}),
    ...(transport ? { transport } : {}),
  });

  // Si le LLM n'a pas repris les dates relatives déjà résolues (ou n'a rien
  // structuré du tout), on les applique nous-mêmes : jamais dépendant de lui
  // seul pour un champ aussi structurant, même logique que la plage explicite
  // ci-dessous.
  let plageExpliciteUtilisee = false;
  let dateRelativeUtilisee = false;
  if (plageExpliciteResolue) {
    const plageNormalisee = normaliserDatesBrief({
      dates: plageExpliciteResolue,
    }).dates;
    const dureeDeclareeEnJours = dureeExacteEnJours(brief.duree);
    const joursDeLaPlage = nombreJoursCivils(plageExpliciteResolue);
    if (
      plageNormalisee &&
      dureeDeclareeEnJours !== undefined &&
      dureeDeclareeEnJours !== joursDeLaPlage
    ) {
      const { dates: _datesExtraites, ...briefSansDates } = brief;
      return {
        reponse:
          `Tu as indiqué ${dureeDeclareeEnJours} jour(s), mais la plage du ` +
          `${enFrancais(plageNormalisee.debut)} au ${enFrancais(plageNormalisee.fin)} ` +
          `en couvre ${joursDeLaPlage}. Veux-tu garder cette plage et ajuster la durée à ${joursDeLaPlage} jour(s) ?`,
        brief: briefSansDates,
        estComplet: false,
        etatDialogue: {
          champ: 'dates',
          valeurCandidate: plageNormalisee,
          dureeCandidate: { valeur: joursDeLaPlage, unite: 'jours' },
        },
      };
    }
    brief = normaliserDatesBrief({
      ...brief,
      dates: plageExpliciteResolue,
    });
    plageExpliciteUtilisee = true;
  } else if (briefActuel.dates && extrait.dates === undefined) {
    // Une date déjà confirmée est un acquis. Une réponse ultérieure du LLM ne
    // peut l'effacer. Une correction temporelle explicitement extraite reste
    // toutefois possible, comme pour les autres champs déjà confirmés.
    brief = { ...brief, dates: briefActuel.dates };
  } else if (!brief.dates && dateRelativeResolue) {
    brief = { ...brief, dates: dateRelativeResolue };
    dateRelativeUtilisee = true;
  }

  // Un point de départ seul (sans la fin) reste une approximation : elle
  // devient une CANDIDATE en attente de confirmation, jamais commise
  // directement dans le brief. `dateDebut` peut venir du LLM ou, à défaut,
  // du filet déterministe sur une date isolée écrite en toutes lettres.
  let etatDialogueResultant: EtatDialogue | undefined =
    etatDialogueActuel?.champ === 'dates' && !brief.dates
      ? etatDialogueActuel
      : undefined;
  let candidateFraichementProduite = false;
  if (!brief.dates && brief.duree) {
    const dateDebut =
      (messageDeclareDates(messageUtilisateur)
        ? extraireDateDebut(sortie.data.brief)
        : undefined) ?? extraireDateSeuleExplicite(messageUtilisateur);
    if (dateDebut) {
      etatDialogueResultant = {
        champ: 'dates',
        valeurCandidate: calculerDates(dateDebut, brief.duree),
      };
      candidateFraichementProduite = true;
    }
  }

  const auMoinsUnChampNouveau =
    Object.keys(extrait).length > 0 ||
    localisationsExtraites !== undefined ||
    intentionExtraite !== undefined ||
    extractionHebergement.hebergement !== undefined ||
    extractionTransport.transport !== undefined ||
    candidateFraichementProduite ||
    plageExpliciteUtilisee ||
    dateRelativeUtilisee;

  const { reponse, estComplet } = finaliserEtape(
    brief,
    briefActuel,
    auMoinsUnChampNouveau,
    extractionHebergement.champInvalide,
    extractionTransport.champInvalide,
    etatDialogueResultant
  );
  const localisationInconnue = premiereLocalisationInconnue(brief);
  if (
    !etatDialogueResultant &&
    prochainChampBase(brief) === undefined &&
    localisationInconnue
  ) {
    etatDialogueResultant = {
      champ: 'localisation',
      code: 'localisation_a_preciser',
      champCible: 'lieux',
      index: localisationInconnue.index,
      nom: localisationInconnue.localisation.nom,
    };
  }
  return {
    reponse,
    brief,
    estComplet,
    ...(etatDialogueResultant ? { etatDialogue: etatDialogueResultant } : {}),
  };
}
