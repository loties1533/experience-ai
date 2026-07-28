// Résolution déterministe de candidats Web pour les lieux et événements.
//
// Tavily propose des pages structurées ; la sélection pure exige ensuite des
// preuves observables. Aucun LLM ne choisit l'URL et le rang Tavily ne départage
// jamais plusieurs candidats admissibles.

import type {
  DemandeResolutionLien,
  LienResolu,
} from './liens/contrat.js';
import {
  classifierCandidatLien,
  comparerVilleEtAdresse,
  DemandeResolutionLienInvalide,
  estPageGenerique,
  estSourceExclue,
  cleDemandeResolutionLien,
  nomsCorrespondent,
  normaliserNomLien,
  selectionnerLien,
} from './liens/selection.js';
import { rechercherWeb } from './tools/webSearch.js';

export {
  classifierCandidatLien,
  comparerVilleEtAdresse,
  DemandeResolutionLienInvalide,
  estPageGenerique,
  estSourceExclue,
  cleDemandeResolutionLien,
  nomsCorrespondent,
  normaliserNomLien,
  selectionnerLien,
};

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

function construireRequeteResolution(
  demande: Pick<
    DemandeResolutionLien,
    'nom' | 'villeDemandee' | 'adresseOuSalle' | 'dateDebut'
  >,
): string {
  return [
    `"${demande.nom}"`,
    demande.villeDemandee,
    demande.adresseOuSalle,
    demande.dateDebut?.slice(0, 10),
    'site officiel réservation billetterie',
  ]
    .filter(Boolean)
    .join(' ');
}

export async function resoudreLien(
  demande: DemandeResolutionLien,
): Promise<LienResolu> {
  const recherche = await rechercherWeb(
    construireRequeteResolution(demande),
    8,
  );
  return selectionnerLien(demande, recherche);
}

/**
 * Compatibilité temporaire : la résolution par nom seul est désactivée jusqu'à
 * la migration structurée F2-B5.
 */
export async function resoudreLiensReels(
  noms: string[],
  _destination: string
): Promise<Map<string, string | null>> {
  return new Map<string, string | null>(
    noms.map((nom) => [nom, null]),
  );
}
