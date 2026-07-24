import { CLE_ANTHROPIC, CLE_OPENROUTER } from '../lib/keys.js';

const TIMEOUT_IA_MS  = 45_000;

interface OptionsFetch extends RequestInit {
  signal?: AbortSignal;
}

function fetchAvecTimeout(url: string, options: OptionsFetch, timeoutMs = TIMEOUT_IA_MS): Promise<Response> {
  const controleurAbort = new AbortController();
  const minuterie = setTimeout(() => controleurAbort.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controleurAbort.signal }).finally(() => clearTimeout(minuterie));
}

const URL_ANTHROPIC = 'https://api.anthropic.com/v1/messages';
const MODELE_CLAUDE = 'claude-haiku-4-5-20251001';

function entetesAnthropic(): Record<string, string> {
  return {
    'Content-Type':      'application/json',
    'x-api-key':         CLE_ANTHROPIC ?? '',
    'anthropic-version': '2023-06-01',
  };
}

interface ReponseAnthropic {
  content: Array<{ text: string }>;
  error?: { message: string };
}

export async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetchAvecTimeout(URL_ANTHROPIC, {
    method: 'POST',
    headers: entetesAnthropic(),
    body: JSON.stringify({
      model:      MODELE_CLAUDE,
      max_tokens: 4000,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: userPrompt }],
    }),
  });
  const data = (await res.json()) as ReponseAnthropic;
  if (!res.ok) throw new Error(`Claude error: ${JSON.stringify(data.error)}`);
  return data.content[0].text;
}

// ---------------------------------------------------------------------------
// Variante OUTILLÉE : le modèle peut demander une recherche avant de répondre.
//
// Un tour de conversation, rien de plus : on envoie l'historique et les outils
// disponibles, on rend les blocs renvoyés. La BOUCLE (exécuter les outils
// demandés, rendre les résultats, redemander) vit dans claude/core.ts — ici on
// ne fait que parler à l'API.
// ---------------------------------------------------------------------------

export interface OutilLLM {
  name: string;
  description: string;
  input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface BlocTexte { type: 'text'; text: string }
export interface BlocOutil { type: 'tool_use'; id: string; name: string; input: unknown }
export type BlocReponse = BlocTexte | BlocOutil;

export interface MessageLLM {
  role: 'user' | 'assistant';
  content: string | unknown[];
}

interface ReponseAnthropicOutils {
  content?: BlocReponse[];
  error?: { message: string };
}

/** Un aller-retour avec Claude, outils fournis (ou non : au dernier tour, il doit conclure). */
export async function callClaudeOutils(
  systemPrompt: string,
  messages: MessageLLM[],
  outils?: OutilLLM[]
): Promise<BlocReponse[]> {
  const res = await fetchAvecTimeout(URL_ANTHROPIC, {
    method: 'POST',
    headers: entetesAnthropic(),
    body: JSON.stringify({
      model:      MODELE_CLAUDE,
      max_tokens: 4000,
      system:     systemPrompt,
      messages,
      ...(outils?.length ? { tools: outils } : {}),
    }),
  });
  const data = (await res.json()) as ReponseAnthropicOutils;
  if (!res.ok) throw new Error(`Claude error: ${JSON.stringify(data.error)}`);
  return data.content ?? [];
}

// Modèles gratuits OpenRouter, essayés dans l'ordre (repli si l'un est indisponible).
// On ne garde que des modèles assez gros : les plus petits tronquent le JSON.
const MODELES_GRATUITS = [
  'openai/gpt-oss-20b:free',
  'google/gemma-3-27b-it:free',
  'mistralai/mistral-7b-instruct:free',
  'google/gemma-3-12b-it:free',
  'microsoft/phi-3-medium-128k-instruct:free',
  'qwen/qwen-2-7b-instruct:free',
];

interface ReponseOpenRouter {
  choices: Array<{ message: { content: string } }>;
  error?: { code?: number; message?: string };
}

export async function callOpenRouter(systemPrompt: string, userPrompt: string): Promise<string> {
  for (const model of MODELES_GRATUITS) {
    try {
      const res = await fetchAvecTimeout('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${CLE_OPENROUTER}`,
          'HTTP-Referer':  'http://localhost:3001',
          'X-Title':       'Experience AI',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          messages: [
            { role: 'system', content: systemPrompt + '\n\nCRITICAL: REPONDS UNIQUEMENT EN JSON VALIDE.' },
            { role: 'user',   content: userPrompt },
          ],
        }),
      });
      const data = (await res.json()) as ReponseOpenRouter;
      if (!res.ok || data.error?.code === 429) {
        console.warn(`Modèle ${model} indisponible, on essaie le suivant...`);
        continue;
      }
      console.log(`Modèle utilisé : ${model}`);
      return data.choices[0].message.content;
    } catch (err) {
      console.warn(`Modèle ${model} en échec : ${(err as Error).message}`);
      continue;
    }
  }
  throw new Error('QUOTA_EXCEEDED: Tous les modèles gratuits sont épuisés.');
}

interface ReponseGemini {
  candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
  error?: { message: string };
}

export async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetchAvecTimeout(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
        generationConfig: { maxOutputTokens: 4096, temperature: 0.7 },
      }),
    }
  );
  const data = (await res.json()) as ReponseGemini;
  if (res.status === 429) throw new Error('QUOTA_EXCEEDED: Limite gratuite Gemini atteinte.');
  if (!res.ok) throw new Error(`Gemini error: ${JSON.stringify(data.error)}`);
  return data.candidates[0].content.parts[0].text;
}

interface ReponseOllama {
  message: { content: string };
}

export async function callOllama(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetchAvecTimeout(
    `${process.env.OLLAMA_BASE_URL}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:    process.env.OLLAMA_MODEL ?? 'gemma2:9b',
        stream:   false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
      }),
    },
    60_000
  );
  const data = (await res.json()) as ReponseOllama;
  if (!res.ok) throw new Error(`Ollama error: ${JSON.stringify(data)}`);
  return data.message.content;
}
