// Résolution déterministe de candidats Web pour les lieux et événements.
//
// Tavily propose des pages structurées ; la sélection pure exige ensuite des
// preuves observables. Aucun LLM ne choisit l'URL et le rang Tavily ne départage
// jamais plusieurs candidats admissibles.

import { parse as analyserDomaine } from 'tldts';
import type {
  DemandeResolutionLien,
  ResultatResolutionLien,
} from './liens/contrat.js';
import { controlerAccessibiliteLien } from './liens/controleRedirections.js';
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

export function domaineEnregistrableLien(
  valeur: string,
): string | null {
  try {
    const hote = new URL(valeur).hostname;
    const analyse = analyserDomaine(hote, {
      allowPrivateDomains: true,
    });
    if (
      !analyse.domain ||
      (analyse.isIcann !== true && analyse.isPrivate !== true)
    ) {
      return null;
    }
    return analyse.domain.toLowerCase();
  } catch {
    return null;
  }
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
): Promise<ResultatResolutionLien> {
  const recherche = await rechercherWeb(
    construireRequeteResolution(demande),
    8,
  );
  const selection = selectionnerLien(demande, recherche);
  if (selection.statut !== 'resolu') {
    return selection;
  }

  const controle = await controlerAccessibiliteLien(selection.url);
  if (controle.statut === 'refuse') {
    return {
      statut: 'refuse',
      cleDemande: selection.cleDemande,
      raison: controle.raison,
      constateLe: controle.constateLe,
    };
  }
  if (controle.statut === 'indisponible') {
    return {
      statut: 'indisponible',
      cleDemande: selection.cleDemande,
      origine: 'controle_reseau',
      raison: controle.raison,
      constateLe: controle.constateLe,
    };
  }

  const domaineInitial = domaineEnregistrableLien(selection.url);
  const domaineFinal = domaineEnregistrableLien(
    controle.urlFinale,
  );
  if (
    !domaineInitial ||
    !domaineFinal ||
    domaineInitial !== domaineFinal
  ) {
    return {
      statut: 'refuse',
      cleDemande: selection.cleDemande,
      raison: 'changement_domaine_enregistrable',
      constateLe: controle.controleLe,
    };
  }

  return {
    ...selection,
    urlInitiale: controle.urlInitiale,
    url: controle.urlFinale,
    domaine: new URL(controle.urlFinale).hostname,
    redirections: controle.redirections,
    controleLe: controle.controleLe,
    statutHttp: controle.statutHttp,
  };
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
