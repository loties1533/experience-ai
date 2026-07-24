import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { callAIAvecOutils, parseJSON } from '../services/claude/core.js';
import { creerBoiteAOutils, type BoiteAOutils } from '../services/claude/outils.js';
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
- N'invente JAMAIS un nom d'établissement. Si une recherche ne rend rien, reste générique et honnête ("un bar à cocktails du centre"), sans faire passer une invention pour un lieu existant.
- N'écris jamais d'URL : les liens sont ajoutés après toi.

Puis réponds UNIQUEMENT en JSON valide : {"ambiance": string, "moments": [...]}.
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
 * son adresse et son lien de carte — un LIEN EXTERNE, jamais un achat
 * (invariant 4) : le produit conduit vers le lieu, il ne vend rien. Le lien
 * vient du connecteur, jamais du modèle, qui n'a donc aucune URL à inventer.
 */
function tracerLieuReel(
  element: ElementGenere,
  boite: BoiteAOutils
): { lieu?: string; reservation?: { lienExterne: string; fournisseur: string } } {
  const reel = boite.trouverLieuReel(element.nom);
  const lieu = reel?.lieu ?? element.lieu;

  // Un temps libre ne se réserve pas (invariant 4) : rien à y rattacher.
  if (!reel?.lienCarte || element.type === 'temps_libre') return { lieu };

  return { lieu, reservation: { lienExterne: reel.lienCarte, fournisseur: reel.source } };
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
    throw new AppError('La génération a produit un résultat inexploitable, réessayez', 502);
  }
  const sortie = SortieGenerationSchema.safeParse(contenu);
  if (!sortie.success) {
    throw new AppError('La génération a produit un résultat inexploitable, réessayez', 502);
  }

  // Attribution des ids côté serveur : les refs du LLM ne sortent pas d'ici.
  const idParRef = new Map<string, string>();
  for (const moment of sortie.data.moments) {
    for (const element of moment.elements) {
      if (!idParRef.has(element.ref)) idParRef.set(element.ref, randomUUID());
    }
  }

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
        ...tracerLieuReel(element, boite),
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
    throw new AppError('La génération a produit un parcours incohérent, réessayez', 502);
  }
  return parcours;
}
