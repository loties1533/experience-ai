// Résolveur de vrais liens (site officiel / billetterie) — repris de
// TripGenie (services/liens.ts), jamais porté lors de la réécriture du
// domaine alors que rien dans sa logique ne dépend de Pack ni de Parcours.
//
// Rôle : associer à un nom de lieu réel (restaurant, activité, sortie,
// événement) la VRAIE URL de sa page, trouvée par une recherche web ciblée.
// Repli existant (carte Google Maps, posée par tracerLieuReel) si rien n'est
// trouvé : jamais un lien cassé, jamais un lien inventé.
//
// Garantit :
// - anti-hallucination : une URL n'est retenue QUE si elle existe littéralement
//   (comparaison normalisée) dans les résultats de recherche fournis ;
// - dégradation propre : toute erreur (recherche indisponible, LLM down, JSON
//   invalide) renvoie une Map à null pour tous les noms → repli Maps en aval.

import { callAI, parseJSON } from './claude/core.js';
import { searchWeb } from './tools/webSearch.js';

/** Extrait toutes les URLs présentes dans un contexte web (dédupliquées). */
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
 * contexte web. Renvoie l'URL ORIGINALE du contexte, pas la variante du LLM.
 */
export function validerUrlReelle(
  urlProposee: string | null | undefined,
  urlsContexte: string[]
): string | null {
  if (!urlProposee || typeof urlProposee !== 'string') return null;
  const cible = normaliserUrl(urlProposee);
  return urlsContexte.find((u) => normaliserUrl(u) === cible) ?? null;
}

const TAILLE_GROUPE = 6;

/**
 * Associe chaque nom de lieu à sa vraie URL (site officiel ou billetterie),
 * ou null si rien de fiable n'a été trouvé. Une recherche web ciblée par
 * groupe de noms, puis un appel LLM par groupe pour l'association.
 */
export async function resoudreLiensReels(
  noms: string[],
  destination: string
): Promise<Map<string, string | null>> {
  const liens = new Map<string, string | null>(noms.map((n) => [n, null]));
  if (noms.length === 0) return liens;

  const groupes: string[][] = [];
  for (let i = 0; i < noms.length; i += TAILLE_GROUPE) groupes.push(noms.slice(i, i + TAILLE_GROUPE));

  await Promise.all(
    groupes.map(async (groupe) => {
      const contexteWeb = await searchWeb(
        `${destination} ${groupe.join(', ')} official site tickets booking reservation`,
        8
      ).catch(() => '');
      if (!contexteWeb) return;

      const urlsContexte = extraireUrlsContexte(contexteWeb);
      if (urlsContexte.length === 0) return;

      const prompt = `Voici des résultats web (chacun avec son URL) pour des lieux et sorties :
${contexteWeb}

Voici des lieux à associer :
${groupe.map((n) => `- ${n}`).join('\n')}

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
          for (const nom of groupe) {
            liens.set(nom, validerUrlReelle(associations[nom], urlsContexte));
          }
        }
      } catch (err) {
        console.warn('Résolveur de liens indisponible (repli Maps) :', (err as Error).message);
      }
    })
  );

  return liens;
}
