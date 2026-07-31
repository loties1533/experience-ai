import 'dotenv/config';
import { callClaude, callClaudeOutils, callOpenRouter, callGemini, callOllama, MODELE_CLAUDE } from '../providers.js';
import type { BlocOutil, BlocReponse, MessageLLM, OutilLLM } from '../providers.js';
import { CLE_ANTHROPIC, CLE_OPENROUTER } from '../../lib/keys.js';

export const SYSTEM_PROMPT = `Tu es un expert du voyage. Réponds UNIQUEMENT en JSON valide, sans markdown, sans texte avant ou après.`;

type ContexteIA = 'onboarding' | 'destinations' | 'pack';

console.log(`AI Provider: ${
  process.env.AI_PROVIDER === 'ollama'     ? 'Ollama'     :
  process.env.AI_PROVIDER === 'openrouter' ? 'OpenRouter' :
  process.env.AI_PROVIDER === 'gemini'     ? 'Gemini'     :
  CLE_ANTHROPIC                            ? 'Claude'     : 'AUCUN'
}`);

export function sanitizeInput(str: unknown): string {
  if (typeof str !== 'string') return String(str ?? '');
  return str.slice(0, 300).replace(/[`\\]/g, ' ').trim();
}

export function parseJSON(raw: string): unknown {
  let str = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();

  // Trouver le début du JSON (objet ou tableau)
  const startObj = str.indexOf('{');
  const startArr = str.indexOf('[');
  const start = startObj === -1 ? startArr
              : startArr === -1 ? startObj
              : Math.min(startObj, startArr);
  if (start !== -1) str = str.slice(start);

  // Normaliser les newlines brutes dans les valeurs de string
  // (certains modèles comme gpt-oss-20b injectent de vraies newlines à l'intérieur des strings)
  str = str.replace(/[\r\n\t]+/g, ' ');

  // Corriger les escapes Unicode Python-style \U0000XXXX → \uXXXX
  // (gpt-oss-20b génère parfois \U00e0 au lieu de à)
  str = str.replace(/\\U[0-9a-fA-F]{8}/g, (m) => '\\u' + m.slice(-4));
  // Corriger aussi les \U courts (ex: \U00e0 sur 6 chars)
  str = str.replace(/\\U[0-9a-fA-F]{4}/g, (m) => '\\u' + m.slice(2));

  // Déterminer le délimiteur de fin selon le type de JSON
  const isArray = str.startsWith('[');
  const closeChar = isArray ? ']' : '}';

  const attempts = [
    str,
    str.slice(0, str.lastIndexOf(closeChar) + 1),
    str.replace(/,(\s*[}\]])/g, '$1'),
  ];

  for (const attempt of attempts) {
    try { return JSON.parse(attempt); } catch { /* continue */ }
  }

  // Tentative 4 : fermer les brackets/braces manquants
  try {
    let fixed = str;
    fixed = fixed.replace(/,\s*$/, '');
    const opens  = (fixed.match(/\[/g) ?? []).length - (fixed.match(/\]/g) ?? []).length;
    const braces = (fixed.match(/\{/g) ?? []).length - (fixed.match(/\}/g) ?? []).length;
    fixed += ']'.repeat(Math.max(0, opens)) + '}'.repeat(Math.max(0, braces));
    return JSON.parse(fixed);
  } catch { /* continue */ }

  // Tentative 5 : supprimer le champ final incomplet puis fermer
  try {
    let fixed = str;
    // Supprime le dernier champ tronqué : ,"key":"val_incomplete ou ,"key":{... ou ,"key":[...
    fixed = fixed.replace(/,\s*"[^"]*"\s*:\s*(?:"[^"]*|[^,}\]]+)?$/, '');
    fixed = fixed.replace(/,\s*$/, '');
    const opens  = (fixed.match(/\[/g) ?? []).length - (fixed.match(/\]/g) ?? []).length;
    const braces = (fixed.match(/\{/g) ?? []).length - (fixed.match(/\}/g) ?? []).length;
    fixed += ']'.repeat(Math.max(0, opens)) + '}'.repeat(Math.max(0, braces));
    return JSON.parse(fixed);
  } catch (e) {
    console.error('parseJSON en échec :', raw.slice(0, 200));
    throw new Error(`JSON malformé: ${(e as Error).message}`);
  }
}

export function normalizeChips(chips: unknown): string[] {
  if (!Array.isArray(chips)) return [];
  return (chips as unknown[]).map(c => {
    if (typeof c === 'string') return c;
    if (c && typeof c === 'object') {
      const obj = c as Record<string, unknown>;
      if (obj.label)  return String(obj.label);
      if (obj.value)  return String(obj.value);
      if (obj.text)   return String(obj.text);
    }
    return String(c);
  }).filter(Boolean);
}

export async function callAI(
  userPrompt: string,
  systemPrompt: string = SYSTEM_PROMPT,
  context: ContexteIA = 'onboarding'
): Promise<string> {
  const erreursProviders: string[] = [];
  const provider = process.env.AI_PROVIDER;

  // Ollama (local, si configuré)
  if (provider === 'ollama' && process.env.OLLAMA_BASE_URL) {
    try { return await callOllama(systemPrompt, userPrompt); } catch (e) { erreursProviders.push(`Ollama: ${(e as Error).message}`); }
  }

  // Claude (Anthropic) — provider principal (payant, JSON fiable, pas de restriction géo)
  if (CLE_ANTHROPIC) {
    try { return await callClaude(systemPrompt, userPrompt); } catch (e) { erreursProviders.push(`Claude: ${(e as Error).message}`); }
  }

  // Gemini — repli si Claude indisponible
  if (process.env.GEMINI_API_KEY) {
    try { return await callGemini(systemPrompt, userPrompt); } catch (e) { erreursProviders.push(`Gemini: ${(e as Error).message}`); }
  }

  // OpenRouter (modèles gratuits) — dernier recours car JSON souvent malformé
  if (CLE_OPENROUTER) {
    try { return await callOpenRouter(systemPrompt, userPrompt); } catch (e) { erreursProviders.push(`OpenRouter: ${(e as Error).message}`); }
  }

  // MODE SECOURS — aucun fournisseur disponible. On ne fabrique plus de fausse
  // réponse « à la forme attendue » : l'appelant valide sa sortie (Zod) et
  // préfère un refus explicite à un contenu inventé.
  console.error('Échecs fournisseurs IA :', JSON.stringify(erreursProviders, null, 2));
  console.error(`Aucun fournisseur disponible — contexte : ${context}.`);
  return JSON.stringify({ indisponible: true, message: 'Service temporairement indisponible, réessayez dans une minute.' });
}

// ---------------------------------------------------------------------------
// APPEL OUTILLÉ — le modèle cherche avant de répondre.
//
// callAI ne sait faire qu'un prompt → texte : le modèle n'a que sa mémoire
// d'entraînement, et il invente donc des lieux plausibles (« Bar à cocktails
// réputé du centre »). Ici, on lui donne des outils de recherche, on exécute ce
// qu'il demande, on lui rend les résultats réels, et il conclut à partir d'eux.
//
// Les appels existants (intake, modification) ne passent PAS par ici : ils
// n'ont rien à chercher, callAI leur suffit et ne change pas d'un iota.
// ---------------------------------------------------------------------------

/** Ce qu'un appelant doit fournir pour outiller le modèle. */
export interface BoiteAOutilsLLM {
  definitions: OutilLLM[];
  /** Ne lève jamais : un outil en panne rend un message, pas une exception. */
  executer(nom: string, entree: unknown): Promise<string>;
}

// Borne de coût. Le modèle est Haiku 4.5 et il sait grouper ses recherches
// (plusieurs outils dans un même tour) : en pratique il lui faut UN tour, deux
// s'il complète. Trois tours d'outils = quatre appels au modèle au maximum pour
// une génération, dernier tour compris. Au-delà, on ne cherche plus : on écrit.
export const MAX_TOURS_OUTILS = 3;

function texteDe(contenu: BlocReponse[]): string {
  return contenu
    .filter((bloc): bloc is Extract<BlocReponse, { type: 'text' }> => bloc.type === 'text')
    .map((bloc) => bloc.text)
    .join('\n');
}

/**
 * Mesures d'un appel outillé complet, préparées pour F6-B (benchmark de
 * modèles) : jamais de prompt, de réponse ou d'intention utilisateur dedans,
 * uniquement des grandeurs. `succes` porte sur la boucle elle-même (a-t-elle
 * pu conclure ?), pas sur la validité métier de sa sortie — ce que classe
 * déjà genererLot en 422/502/503 reste inchangé et hors de cette fonction.
 */
export interface MetriquesAppelOutils {
  modele: string;
  tokensEntree: number;
  tokensSortie: number;
  dureeMs: number;
  tours: number;
  succes: boolean;
  typeEchec?: 'cle_absente' | 'boucle_interrompue';
}

export interface OptionsAppelOutils {
  /** Modèle Anthropic à interroger. Par défaut MODELE_CLAUDE (comportement inchangé). */
  modele?: string;
  /** Reçoit les métriques une fois l'appel terminé (succès ou échec). */
  onMetriques?: (metriques: MetriquesAppelOutils) => void;
}

export async function callAIAvecOutils(
  userPrompt: string,
  systemPrompt: string,
  boite: BoiteAOutilsLLM,
  _context: ContexteIA = 'pack',
  options: OptionsAppelOutils = {}
): Promise<string> {
  const modele = options.modele ?? MODELE_CLAUDE;
  const debut = Date.now();
  let tokensEntree = 0;
  let tokensSortie = 0;
  let tours = 0;

  const enregistrerUsage = (usage: { tokensEntree: number; tokensSortie: number }): void => {
    tokensEntree += usage.tokensEntree;
    tokensSortie += usage.tokensSortie;
  };
  const metriques = (succes: boolean, typeEchec?: MetriquesAppelOutils['typeEchec']): void => {
    options.onMetriques?.({
      modele,
      tokensEntree,
      tokensSortie,
      dureeMs: Date.now() - debut,
      tours,
      succes,
      ...(typeEchec ? { typeEchec } : {}),
    });
  };

  // La boucle d'outils est propre à l'API Anthropic. Un fournisseur sans outils
  // peut reformuler ou interpréter, mais il ne peut pas garantir les lieux d'un
  // parcours. Depuis F1 on signale l'indisponibilité au lieu d'abaisser
  // silencieusement la confiance des données.
  if (!CLE_ANTHROPIC) {
    metriques(false, 'cle_absente');
    return JSON.stringify({
      outilsIndisponibles: true,
      message: 'Les sources de vérification sont momentanément indisponibles.',
    });
  }

  const messages: MessageLLM[] = [{ role: 'user', content: userPrompt }];

  try {
    for (let tour = 0; tour <= MAX_TOURS_OUTILS; tour++) {
      // Au dernier tour, on retire les outils : le modèle n'a plus qu'à écrire.
      const outils = tour < MAX_TOURS_OUTILS ? boite.definitions : undefined;
      const contenu = await callClaudeOutils(systemPrompt, messages, outils, {
        modele: options.modele,
        onUsage: enregistrerUsage,
      });
      tours += 1;

      const demandes = contenu.filter((bloc): bloc is BlocOutil => bloc.type === 'tool_use');
      if (demandes.length === 0) {
        metriques(true);
        return texteDe(contenu);
      }

      messages.push({ role: 'assistant', content: contenu });
      // Les recherches d'un même tour partent ensemble : le modèle demande
      // souvent les lieux et les événements d'un coup.
      const resultats = await Promise.all(
        demandes.map(async (demande) => ({
          type: 'tool_result',
          tool_use_id: demande.id,
          content: await boite.executer(demande.name, demande.input),
        }))
      );
      messages.push({ role: 'user', content: resultats });
    }
  } catch (erreur) {
    console.error('Boucle d’outils interrompue :', (erreur as Error).message);
  }

  // La boucle elle-même n'a pas pu terminer : aucune preuve n'existe que les
  // recherches nécessaires ont été exécutées. On ne masque plus cet échec
  // derrière une génération simple.
  metriques(false, 'boucle_interrompue');
  return JSON.stringify({
    outilsIndisponibles: true,
    message: 'Les sources de vérification sont momentanément indisponibles.',
  });
}
