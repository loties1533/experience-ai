// TRIPGENIE — Résolveur UNIQUE de liens de réservation.
//
// Rôle : associer à chaque lieu du pack (événements ET activités) la VRAIE URL
// de sa page (billetterie / site officiel) trouvée par la recherche web.
// C'est le SEUL endroit du code qui décide d'un lien de réservation :
// les services (PredictHQ, Yelp, Foursquare, LLM pack) ne fabriquent plus d'URL.
//
// Garanties :
// - anti-hallucination : une URL n'est gardée QUE si elle existe littéralement
//   dans les résultats web fournis (comparaison normalisée) → zéro 404 inventé ;
// - dégradation propre : toute erreur (LLM down, JSON invalide…) retourne une
//   Map complète à null → le front retombe sur la recherche Google, jamais de crash.

import { callAI, parseJSON } from './claude/index.js';
import { searchWeb } from './tools/webSearch.js';
import type { Pack } from '../lib/types.js';

/** Extrait toutes les URLs présentes dans le contexte web Tavily (dédupliquées). */
export function extraireUrlsContexte(contexteWeb: string): string[] {
  const urls = contexteWeb.match(/https?:\/\/[^\s)\]"'<>]+/g) ?? [];
  return [...new Set(urls)];
}

/** Normalisation pour comparer deux URLs : http→https, slash final, casse. */
function normaliserUrl(url: string): string {
  return url.trim().toLowerCase().replace(/^http:\/\//, 'https://').replace(/\/+$/, '');
}

/**
 * Filet anti-hallucination : ne garde l'URL proposée par le LLM que si elle
 * correspond (après normalisation) à une URL réellement présente dans le
 * contexte web. Retourne l'URL ORIGINALE du contexte (pas la variante du LLM).
 */
export function validerUrlReservation(
  urlProposee: string | null | undefined,
  urlsContexte: string[],
): string | null {
  if (!urlProposee || typeof urlProposee !== 'string') return null;
  const cible = normaliserUrl(urlProposee);
  return urlsContexte.find(u => normaliserUrl(u) === cible) ?? null;
}

/**
 * Associe chaque nom de lieu à la vraie URL correspondante du contexte web
 * (ou null). Un seul appel LLM pour tous les items du pack.
 */
export async function resoudreLiensReservation(
  noms: string[],
  contexteWeb: string,
): Promise<Map<string, string | null>> {
  const liens = new Map<string, string | null>(noms.map(n => [n, null]));
  if (noms.length === 0 || !contexteWeb) return liens;

  const urlsContexte = extraireUrlsContexte(contexteWeb);
  if (urlsContexte.length === 0) return liens;

  const prompt = `
Voici des résultats web (chacun avec son URL) pour des lieux et sorties :
${contexteWeb}

Voici des lieux à associer :
${noms.map(n => `- ${n}`).join('\n')}

Pour CHAQUE lieu, donne l'URL EXACTE (champ "URL:" ci-dessus) de la page qui lui
correspond le mieux : billetterie ou site officiel du lieu.
RÈGLES STRICTES :
- Utilise UNIQUEMENT une URL présente telle quelle dans les résultats ci-dessus.
- N'INVENTE JAMAIS d'URL. Ne modifie pas les URLs.
- Si aucune URL fournie ne correspond vraiment au lieu, mets null.

Retourne UNIQUEMENT un objet JSON { "nom exact du lieu": "url ou null", ... }.`;

  try {
    const reponseIABrute = await callAI(prompt, undefined, 'destinations');
    const associations = parseJSON(reponseIABrute) as Record<string, string | null>;
    if (associations && typeof associations === 'object') {
      for (const nom of noms) {
        liens.set(nom, validerUrlReservation(associations[nom], urlsContexte));
      }
    }
  } catch (err) {
    // Dégradation propre : liens à null → repli Google côté front.
    console.warn('Résolveur de liens indisponible (repli Google) :', (err as Error).message);
  }
  return liens;
}

/**
 * Point d'entrée UNIQUE : pose `reservation_url` sur les événements ET les
 * activités du pack (restaurants inclus — fusionnés dans activities avant l'appel).
 *
 * CLÉ du taux de réussite : on cherche le web AVEC les vrais noms des lieux du
 * pack (pas une requête générique) → Tavily ramène LEURS pages de billetterie
 * → le matching trouve les URLs. Une recherche + un appel LLM pour tout le pack.
 */
export async function appliquerLiensReservation(pack: Pack, destination: string): Promise<void> {
  const noms = [
    ...(pack.events ?? []).map(e => e.title),
    ...(pack.activities ?? []).map(a => a.name),
  ].filter(Boolean);
  if (noms.length === 0) return;

  // Requêtes ciblées sur les VRAIS lieux (anglais : billetteries internationales).
  // Par GROUPES de 6 noms : une requête unique diluée sur 12 lieux rate trop de
  // pages — 2 requêtes ciblées doublent la couverture d'URLs candidates.
  const TAILLE_GROUPE = 6;
  const groupes: string[][] = [];
  for (let i = 0; i < noms.length; i += TAILLE_GROUPE) groupes.push(noms.slice(i, i + TAILLE_GROUPE));
  const contextes = await Promise.all(
    groupes.map(g => searchWeb(`${destination} ${g.join(', ')} official site tickets booking reservation`, 8).catch(() => '')),
  );
  const contexteWeb = contextes.filter(Boolean).join('\n');

  const liens = await resoudreLiensReservation(noms, contexteWeb);

  for (const e of pack.events ?? [])     e.reservation_url = liens.get(e.title) ?? null;
  for (const a of pack.activities ?? []) a.reservation_url = liens.get(a.name) ?? null;

  const nbTrouves = [...liens.values()].filter(Boolean).length;
  console.log(`Liens réservation : ${nbTrouves}/${noms.length} vraie(s) URL(s) trouvée(s)`);
}
