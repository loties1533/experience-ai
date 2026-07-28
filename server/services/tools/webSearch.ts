import 'dotenv/config';
import { z } from 'zod';
import {
  causeErreurHttp,
  estTimeout,
  type CauseIndisponibilite,
} from '../rechercheExterne.js';
import { validerUrlLien } from '../liens/validationUrl.js';

const URL_RECHERCHE_TAVILY = 'https://api.tavily.com/search';
const DELAI_RECHERCHE_TAVILY_MS = 8_000;
const FOURNISSEUR_TAVILY = 'Tavily' as const;

const ReponseTavilySchema = z.object({
  results: z.array(z.unknown()),
});

const ResultatTavilySchema = z.object({
  title: z.string().trim().min(1),
  url: z.string().trim().url(),
  content: z.string().trim().optional(),
});

export interface ResultatWeb {
  titre: string;
  url: string;
  extrait?: string;
  rang: number;
}

export type ResultatRechercheWeb =
  | {
      statut: 'ok';
      resultats: ResultatWeb[];
      fournisseur: 'Tavily';
      recupereLe: string;
    }
  | {
      statut: 'vide';
      resultats: [];
      fournisseur: 'Tavily';
      recupereLe: string;
    }
  | {
      statut: 'indisponible';
      fournisseur: 'Tavily';
      raison: CauseIndisponibilite;
      constateLe: string;
    };

function rechercheWebIndisponible(
  raison: CauseIndisponibilite,
): ResultatRechercheWeb {
  return {
    statut: 'indisponible',
    fournisseur: FOURNISSEUR_TAVILY,
    raison,
    constateLe: new Date().toISOString(),
  };
}

function normaliserNombreResultats(nombreMaxResultats: number): number {
  if (!Number.isFinite(nombreMaxResultats)) return 3;
  return Math.min(Math.max(Math.trunc(nombreMaxResultats), 1), 10);
}

function convertirResultatsTavily(
  resultats: unknown[],
): { resultats: ResultatWeb[]; nombreInvalides: number } {
  const resultatsWeb: ResultatWeb[] = [];
  let nombreInvalides = 0;

  resultats.forEach((resultat, index) => {
    const validation = ResultatTavilySchema.safeParse(resultat);
    if (!validation.success) {
      nombreInvalides += 1;
      return;
    }

    const validationUrl = validerUrlLien(validation.data.url);
    if (validationUrl.statut === 'invalide') {
      nombreInvalides += 1;
      return;
    }

    const extrait = validation.data.content?.trim();
    resultatsWeb.push({
      titre: validation.data.title,
      url: validationUrl.url,
      ...(extrait ? { extrait } : {}),
      rang: index + 1,
    });
  });

  return { resultats: resultatsWeb, nombreInvalides };
}

/**
 * Recherche des candidats Web avec Tavily sans décider de leur caractère
 * officiel, de réservation ou de billetterie.
 */
export async function rechercherWeb(
  requete: string,
  nombreMaxResultats = 3,
): Promise<ResultatRechercheWeb> {
  // Lecture à chaque appel : les tests et les rotations de configuration ne
  // dépendent pas de l'ordre de chargement du module.
  const cleTavily = process.env.TAVILY_API_KEY?.trim();
  if (!cleTavily) {
    console.warn('Recherche Web Tavily indisponible : configuration absente.');
    return rechercheWebIndisponible('configuration_absente');
  }

  let reponse: Response;
  try {
    reponse = await fetch(URL_RECHERCHE_TAVILY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(DELAI_RECHERCHE_TAVILY_MS),
      body: JSON.stringify({
        api_key: cleTavily,
        query: requete.trim(),
        search_depth: 'basic',
        include_answer: false,
        include_images: false,
        include_raw_content: false,
        max_results: normaliserNombreResultats(nombreMaxResultats),
        include_domains: [],
        exclude_domains: [],
      }),
    });
  } catch (erreur) {
    const raison = estTimeout(erreur) ? 'timeout' : 'reseau';
    console.warn(`Recherche Web Tavily indisponible : ${raison}.`);
    return rechercheWebIndisponible(raison);
  }

  if (!reponse.ok) {
    const raison = causeErreurHttp(reponse.status);
    console.warn(
      `Recherche Web Tavily indisponible : HTTP ${reponse.status} (${raison}).`,
    );
    return rechercheWebIndisponible(raison);
  }

  let contenu: unknown;
  try {
    contenu = await reponse.json();
  } catch {
    console.warn('Recherche Web Tavily indisponible : JSON illisible.');
    return rechercheWebIndisponible('reponse_invalide');
  }

  const validationReponse = ReponseTavilySchema.safeParse(contenu);
  if (!validationReponse.success) {
    console.warn('Recherche Web Tavily indisponible : structure invalide.');
    return rechercheWebIndisponible('reponse_invalide');
  }

  const recupereLe = new Date().toISOString();
  if (validationReponse.data.results.length === 0) {
    return {
      statut: 'vide',
      resultats: [],
      fournisseur: FOURNISSEUR_TAVILY,
      recupereLe,
    };
  }

  const { resultats, nombreInvalides } = convertirResultatsTavily(
    validationReponse.data.results,
  );
  if (resultats.length === 0) {
    console.warn(
      'Recherche Web Tavily indisponible : tous les résultats sont invalides.',
    );
    return rechercheWebIndisponible('reponse_invalide');
  }
  if (nombreInvalides > 0) {
    console.warn(
      `Recherche Web Tavily : ${nombreInvalides} résultat(s) incomplet(s) ignoré(s).`,
    );
  }

  return {
    statut: 'ok',
    resultats,
    fournisseur: FOURNISSEUR_TAVILY,
    recupereLe,
  };
}

/**
 * Adaptateur historique conservé jusqu'à la migration de `resoudreLiensReels`.
 * Il reformate le contrat structuré sans masquer une vraie recherche vide.
 */
export async function searchWeb(
  query: string,
  maxResults = 3,
): Promise<string> {
  const recherche = await rechercherWeb(query, maxResults);
  if (recherche.statut === 'indisponible') return '';

  let contexteWeb = '==== CONTEXTE WEB RECENT ====\n';
  if (recherche.statut === 'vide') {
    contexteWeb += 'Pas de résultats récents.\n';
  } else {
    recherche.resultats.forEach((resultat) => {
      contexteWeb +=
        `[Source ${resultat.rang}: ${resultat.titre}] ` +
        `(URL: ${resultat.url}) : ${resultat.extrait ?? ''}\n`;
    });
  }
  contexteWeb += '=============================\n';
  return contexteWeb;
}
