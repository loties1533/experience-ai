import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { callAIAvecOutils, parseJSON } from '../services/claude/core.js';
import { creerBoiteAOutils, type BoiteAOutils } from '../services/claude/outils.js';
import { resoudreLiensReels } from '../services/liens.js';
import { construireLienHotel } from '../lib/url.js';
import { AppError } from '../lib/AppError.js';
import {
  ParcoursSchema,
  PlageHoraireSchema,
  TypeElementSchema,
  validerParcours,
  type Parcours,
} from '../domaine/parcours/index.js';
import { normaliserDatesBrief, type Brief } from './brief.js';
import type { PreferencesParcours } from '../domaine/preferences.js';

/** Types pour lesquels un vrai site officiel/billetterie vaut mieux qu'une carte. */
const TYPES_AVEC_LIEN_REEL = new Set(['restaurant', 'activite', 'sortie', 'evenement']);

// L'ORCHESTRATEUR (IA n°1) : brief confirmé → parcours complet.
// À ne pas confondre avec l'agent Modification (IA n°2, modification.ts) qui
// n'agit qu'à l'intérieur d'un parcours existant, jamais sur l'ensemble.
//
// Il CHERCHE avant d'écrire : des outils lui donnent de vrais lieux et de vrais
// événements (services/claude/outils.ts). Sans eux, il puisait dans sa mémoire
// d'entraînement et sortait des « Bar à cocktails réputé du centre » — sur un
// produit dont la valeur est la cohérence avec un thème, un lieu faux ruine la
// confiance. Quand aucune clé n'est configurée, il construit quand même le
// parcours, sans données réelles : c'est un repli, jamais une panne affichée.
//
// Ne jamais faire confiance au LLM : sa sortie est revalidée champ par champ,
// les ids sont attribués ICI (jamais par le modèle), les dépendances vers des
// refs inconnues sont écartées, les liens externes ne viennent PAS de lui mais
// des connecteurs, et le parcours final repasse par les invariants du domaine
// avant de sortir.

const SYSTEM_GENERATION = `Tu construis un parcours personnalisé : un ensemble cohérent de moments autour d'une intention et d'un contexte.

AVANT D'ÉCRIRE, CHERCHE. Tu disposes d'outils qui rendent de vrais lieux, de vrais événements et la météo attendue.
- Appelle-les d'abord, et groupe tes recherches (plusieurs outils dans le même tour) : tu as peu de tours.
- Reprends EXACTEMENT le nom rendu par un outil, sans le reformuler.
- N'invente JAMAIS un nom d'établissement, une date de match ni un événement. Si une recherche ne rend rien (lieu, événement OU date), reste générique et honnête ("un bar à cocktails du centre", "un match de la saison à voir sur place") — sans faire passer une invention pour un fait.
- N'écris jamais d'URL : les liens sont ajoutés après toi.

Puis réponds UNIQUEMENT en JSON valide : {"ambiance": string, "moments": [...]}.
Ta réponse est TOUJOURS ce JSON, même incomplet, même si des recherches n'ont rien donné. N'écris JAMAIS de phrase d'explication, d'excuse ou de constat hors du JSON (ex. "les dates ne sont pas disponibles") : ce qui manque, on le laisse générique DANS le parcours.
- Chaque moment : {"titre": string, "elements": [...]}.
- Chaque élément : {"ref": string (identifiant court unique, ex "resto-soir-1"), "type": "activite"|"restaurant"|"sortie"|"transport"|"hebergement"|"evenement"|"temps_libre", "nom": string, "lieu": string, "plage": {"debut": ISO, "fin": ISO} (optionnel), "prix": number en euros (optionnel), "justification": string (POURQUOI cet élément sert l'intention — obligatoire), "dependDe": [refs] (optionnel), "estAncre": boolean (optionnel).
- "sortie" = ce qui se vit le soir (bar, club, tournée, apéro). Ne JAMAIS le ranger en "temps_libre".
- "temps_libre" = une vraie respiration (repos, pause, réveil tranquille), rien d'autre.
- Prévois des temps libres assumés (la respiration).
- Si le brief donne des dates, TOUTES les plages horaires doivent tomber entre ces dates.
- Reste dans le budget si fourni. Jamais de lien de réservation.`;

const ElementGenereSchema = z.object({
  ref: z.string().min(1),
  type: TypeElementSchema,
  nom: z.string().min(1),
  lieu: z.string().optional(),
  plage: PlageHoraireSchema.optional(),
  prix: z.number().nonnegative().optional(),
  justification: z.string().min(1),
  dependDe: z.array(z.string()).default([]),
  estAncre: z.boolean().default(false),
});

const SortieGenerationSchema = z.object({
  ambiance: z.string().optional(),
  moments: z
    .array(
      z.object({
        titre: z.string().min(1),
        plage: PlageHoraireSchema.optional(),
        elements: z.array(ElementGenereSchema).min(1),
      })
    )
    .min(1),
});

type ElementGenere = z.infer<typeof ElementGenereSchema>;

/**
 * Ce qui, dans un élément, vient d'une recherche réelle et non du modèle.
 *
 * Quand le nom proposé correspond à un lieu rendu par un outil, on lui rattache
 * son adresse. Pour le LIEN EXTERNE — jamais un achat (invariant 4), le produit
 * conduit vers le lieu, il ne vend rien — trois niveaux, du meilleur au repli :
 *   1. Un vrai site officiel / billetterie (resoudreLiensReels, recherche web
 *      ciblée + filet anti-hallucination) — jamais inventé par le modèle.
 *   2. Pour un hébergement : un lien Booking.com pré-rempli (dates connues du
 *      parcours) — Booking, pas nous, connaît le vrai prix.
 *   3. La carte du connecteur (Foursquare) — jamais un lien cassé.
 */
function tracerLieuReel(
  element: ElementGenere,
  boite: BoiteAOutils,
  liensReels: Map<string, string | null>,
  datesParcours?: { debut: string; fin: string }
): { lieu?: string; reservation?: { lienExterne: string; fournisseur: string } } {
  const reel = boite.trouverLieuReel(element.nom);
  const lieu = reel?.lieu ?? element.lieu;

  // Un temps libre ne se réserve pas (invariant 4) : rien à y rattacher.
  if (element.type === 'temps_libre') return { lieu };

  const lienOfficiel = liensReels.get(element.nom);
  if (lienOfficiel) {
    return { lieu, reservation: { lienExterne: lienOfficiel, fournisseur: 'Web' } };
  }

  if (element.type === 'hebergement' && lieu) {
    const plage = element.plage ?? datesParcours;
    return {
      lieu,
      reservation: {
        lienExterne: construireLienHotel(element.nom, lieu, {
          checkin: plage?.debut,
          checkout: plage?.fin,
        }),
        fournisseur: 'Booking.com',
      },
    };
  }

  if (reel?.lienCarte) {
    return { lieu, reservation: { lienExterne: reel.lienCarte, fournisseur: reel.source } };
  }

  return { lieu };
}

export async function genererParcours(
  briefRecu: Brief,
  preferences: PreferencesParcours | null = null
): Promise<Parcours> {
  // Une fin de journée posée à minuit exclurait tout le dernier jour : on la
  // ramène au sens courant (« du 4 au 6 » comprend le 6 en entier). Fait ici
  // aussi, et pas seulement à l'intake, car un brief peut arriver directement
  // par l'API sans être passé par le dialogue.
  const brief = normaliserDatesBrief(briefRecu);

  // Mémoire simple (sprint R5) : les préférences orientent, le brief prime.
  const blocPreferences = preferences
    ? `\nPréférences connues de l'utilisateur (souples — le brief prime toujours) :
${JSON.stringify(preferences, null, 2)}`
    : '';
  const prompt = `Construis un parcours pour ce brief :
${JSON.stringify(brief, null, 2)}${blocPreferences}`;

  // Une boîte par génération : le journal des lieux trouvés appartient à CE
  // parcours (le cache des appels, lui, est partagé — cf. lib/cacheMemoire).
  const boite = creerBoiteAOutils();
  const brut = await callAIAvecOutils(prompt, SYSTEM_GENERATION, boite, 'pack');
  // Un modèle outillé peut conclure en prose ou tronquer son JSON : c'est une
  // sortie inexploitable, pas une panne du serveur.
  let contenu: unknown;
  try {
    contenu = parseJSON(brut);
  } catch {
    throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502);
  }
  // Aucun fournisseur d'IA n'a répondu (clé à sec, quotas, panne) : le mode
  // secours renvoie ce signal explicite. On le distingue d'un vrai « charabia »
  // — ici réessayer tout de suite ne sert à rien, d'où un 503 (service
  // indisponible) et un message honnête, plutôt qu'un 502 « réessaie ».
  if (
    typeof contenu === 'object' &&
    contenu !== null &&
    (contenu as { indisponible?: unknown }).indisponible === true
  ) {
    throw new AppError('Service IA momentanément indisponible, réessaie dans un instant', 503);
  }
  const sortie = SortieGenerationSchema.safeParse(contenu);
  if (!sortie.success) {
    throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502);
  }

  // Attribution des ids côté serveur : les refs du LLM ne sortent pas d'ici.
  const idParRef = new Map<string, string>();
  for (const moment of sortie.data.moments) {
    for (const element of moment.elements) {
      if (!idParRef.has(element.ref)) idParRef.set(element.ref, randomUUID());
    }
  }

  // Un vrai site officiel / billetterie vaut mieux qu'une simple carte : une
  // seule recherche groupée pour tout le parcours (services/liens.ts). Une
  // recherche web échouée ou une clé absente rend une Map à null pour tous les
  // noms — tracerLieuReel retombe alors sur la carte, jamais un lien cassé.
  const nomsAResoudre = [
    ...new Set(
      sortie.data.moments
        .flatMap((m) => m.elements)
        .filter((e) => TYPES_AVEC_LIEN_REEL.has(e.type))
        .map((e) => e.nom)
    ),
  ];
  const liensReels = await resoudreLiensReels(nomsAResoudre, brief.lieux[0] ?? brief.intention);

  const parcours = ParcoursSchema.parse({
    id: randomUUID(),
    intention: { texte: brief.intention },
    contexte: {
      avecQui: brief.avecQui,
      duree: brief.duree,
      dates: brief.dates,
      lieux: brief.lieux,
    },
    participants: [{ id: randomUUID(), nom: 'Organisateur', role: 'organisateur' }],
    budget: { mode: 'individuel', montantTotal: brief.budgetTotal },
    ambiance: sortie.data.ambiance ?? brief.ambiance,
    timeline: sortie.data.moments.map((moment) => ({
      id: randomUUID(),
      titre: moment.titre,
      plage: moment.plage,
      elements: moment.elements.map((element) => ({
        id: idParRef.get(element.ref) as string,
        type: element.type,
        nom: element.nom,
        ...tracerLieuReel(element, boite, liensReels, brief.dates),
        plage: element.plage,
        prix: element.prix,
        justification: element.justification,
        estAncre: element.estAncre,
        // Une dépendance vers une ref inventée est écartée, pas propagée.
        dependDe: element.dependDe
          .filter((ref) => idParRef.has(ref) && ref !== element.ref)
          .map((ref) => idParRef.get(ref) as string),
      })),
    })),
  });

  const erreurs = validerParcours(parcours);
  if (erreurs.length > 0) {
    throw new AppError('La génération a produit un parcours incohérent, réessaie', 502);
  }
  return parcours;
}
