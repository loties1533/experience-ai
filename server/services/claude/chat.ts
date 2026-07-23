import * as Mocks from '../mocks.js';
import { callAI, parseJSON, sanitizeInput, normalizeChips } from './core.js';
import type { ResultatOnboarding, Pack, TravelMode, Activite } from '../../lib/types.js';

interface ParamsChatIntake {
  currentData?: Record<string, unknown>;
  userMessage: string;
}

interface ParamsChatModify {
  currentPack?: Partial<Pack>;
  userMessage: string;
  mode?: TravelMode;
}

interface ResultatChatModify {
  response: string;
  needs_full_regen?: boolean;
  modifications?: Partial<Pack>;
  chips?: string[];
}

export async function chatIntake({ currentData, userMessage }: ParamsChatIntake): Promise<ResultatOnboarding & { isMock?: boolean }> {
  const systemPrompt = `Tu es l'assistant de TripGenie. Tu aides l'utilisateur à préparer son voyage en récoltant l'essentiel : profil, voyageurs, budget, dates.
Le but est d'être prêt (isReady: true) en 2-3 échanges maximum.

ANNÉE EN COURS : ${new Date().getFullYear()}. Pour toute date sans année (ex: "15/08", "du 15 au 21 août"), utilise TOUJOURS ${new Date().getFullYear()}.

RÈGLES :
1. Ne redemande jamais une information déjà connue.
2. isReady passe à true dès qu'au moins 3 champs sont remplis parmi (travelers, budget, profile, duration).
3. Déduis ce que tu peux : "On est 4 amis" → travelers=4, profile="amis", mode="party".
4. Rédige "response" et tous les "chips" en français, sur un ton simple et direct.

DONNÉES ACTUELLES :
${JSON.stringify(currentData ?? {})}

QUESTIONS PRIORITAIRES (si manquantes) :
${!currentData?.profile   ? "→ Priorité 1 : avec qui partez-vous ?"            : 'Profil connu'}
${!currentData?.travelers ? '→ Priorité 2 : combien de voyageurs ?'           : 'Voyageurs connus'}
${!currentData?.budget    ? '→ Priorité 3 : quel budget ?'                     : 'Budget connu'}
${!currentData?.departure ? '→ Priorité 4 : à quelles dates ?'                 : 'Dates connues'}

FORMAT DE RÉPONSE (JSON STRICT) :
{
  "response": "Ta réponse courte et claire (2 phrases max).",
  "chips": ["Option 1", "Option 2", "Option 3"],
  "extractedData": {
    "travelers": null, "profile": null, "mode": "relax", "premium": false, "budget": null, "duration": null, "departure": null, "origin": "Paris"
  },
  "isReady": false
}`;

  const messageNormalise = sanitizeInput(userMessage).toLowerCase();

  if (messageNormalise.includes('montre-moi')) {
    const profile = (currentData?.profile as string | undefined) ?? (Mocks.MOCK_ONBOARDING.extractedData.profile as string);
    return {
      response:      "C'est parti, je prépare votre voyage.",
      isReady:       true,
      chips:         [],
      extractedData: { ...Mocks.MOCK_ONBOARDING.extractedData, profile },
      isMock:        true,
    };
  }

  if (messageNormalise.includes('attendre')) {
    return {
      response:      "Pas de souci, revenez quand vous voulez.",
      isReady:       false,
      chips:         ['Réessayer'],
      extractedData: {},
      isMock:        true,
    };
  }

  try {
    const reponseIABrute = await callAI(
      `${systemPrompt}\n\nMessage utilisateur : "${sanitizeInput(userMessage)}"`,
      undefined,
      'onboarding'
    );
    return parseJSON(reponseIABrute) as ResultatOnboarding;
  } catch (err) {
    console.error('ChatIntake échoué, activation du mode survie :', (err as Error).message);
    return {
      ...Mocks.MOCK_ONBOARDING,
      response: "Je n'ai pas tout capté, mais on peut continuer sur une base simple. Qu'en pensez-vous ?",
      isMock: true,
    };
  }
}

export async function chatModify({ currentPack, userMessage }: ParamsChatModify): Promise<ResultatChatModify> {
  const systemPrompt = `Tu es l'expert voyage TripGenie. L'utilisateur veut modifier son voyage à ${currentPack?.destination ?? 'destination'}.

  CONTEXTE ACTUEL :
  - Destination : ${currentPack?.destination}
  - Budget : ${currentPack?.summary?.total_budget}
  - Pack actuel : ${JSON.stringify(currentPack)}

  CONSIGNES :
  1. Réponds de manière amicale et concise (champ "response").
  2. Si l'utilisateur demande une modification majeure, mets "needs_full_regen" à true.
  3. Pour des modifications précises, suggère les changements dans "modifications".
  4. LANGUE : rédige "response" et les "chips" exclusivement EN FRANÇAIS.

  RÈGLE CRITIQUE SUR "modifications" (chaque liste REMPLACE l'existante) :
  - N'inclus une clé (activities / hotels / itinerary) QUE si tu la modifies vraiment.
  - Quand tu renvoies une de ces clés, renvoie la LISTE COMPLÈTE ET À JOUR :
    les éléments existants à CONSERVER + tes ajouts/remplacements. Ne renvoie
    JAMAIS une liste partielle, sinon les anciens éléments seront perdus.
  - Le pack contient actuellement ${currentPack?.activities?.length ?? 0} activité(s)
    et ${currentPack?.hotels?.length ?? 0} hôtel(s). Ex : pour "plus d'activités",
    renvoie les activités existantes + les nouvelles dans le même tableau.

  FORMAT RÉPONSE (JSON UNIQUEMENT) :
  {
    "response": "Ma réponse à l'utilisateur",
    "needs_full_regen": false,
    "modifications": {
      "hotels": [...],
      "activities": [...],
      "itinerary": [...]
    }
  }`;

  try {
    const reponseIABrute = await callAI(`${systemPrompt}\n\nMessage de l'utilisateur : "${sanitizeInput(userMessage)}"`);
    const packModifie = parseJSON(reponseIABrute) as ResultatChatModify;
    if (packModifie.chips) packModifie.chips = normalizeChips(packModifie.chips);

    // Les activités modifiées par l'IA peuvent contenir un booking_url bidon
    // (domaine inventé, ex: luxe-restaurant.com). On le normalise vers un lien
    // Google Maps universel, comme à la génération initiale (transformerActivites).
    const destinationPack = currentPack?.destination ?? '';
    if (packModifie.modifications?.activities) {
      packModifie.modifications.activities = packModifie.modifications.activities.map((a: Activite & { title?: string }) => ({
        ...a,
        booking_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((a.name || a.title || '') + ' ' + destinationPack)}`,
      }));
    }
    return packModifie;
  } catch (err) {
    console.error('ChatModify échoué :', (err as Error).message);
    return {
      response:      "Je n'ai pas pu modifier le pack, réessayez avec une autre formulation.",
      needs_full_regen: false,
      modifications: {},
      chips:         ['Réessayer', 'Modifier un hôtel', 'Changer une activité'],
    };
  }
}
