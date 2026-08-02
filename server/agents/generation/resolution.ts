import { z } from 'zod';
import {
  cleDemandeResolutionLien,
  estNomTropGenerique,
  resoudreLien,
} from '../../services/liens.js';
import type {
  BoiteAOutils,
  CandidatJournal,
} from '../../services/claude/outils.js';
import type {
  DemandeResolutionLien,
  ResultatResolutionLien,
} from '../../services/liens/contrat.js';
import type { TypeElement } from '../../domaine/parcours/index.js';
import type { TypeMetierRecherche } from '../../services/rechercheExterne.js';
import type { ElementGenere, SortieGenerationSchema } from './contratLLM.js';

// CHERCHER / RAPPROCHER DES PREUVES : ce module rapproche ce que le modèle a
// proposé d'un candidat réellement rendu par un connecteur, puis prépare et
// exécute les demandes de résolution de liens. Il cherche des preuves ; il ne
// décide pas ce qu'on a le droit d'affirmer — cette décision revient à
// `confiance.ts`.
//
// Dette connue M1 (hors périmètre de ce refactor) : les noms de fournisseurs
// concrets (Foursquare, PredictHQ) restent lus ici, sans abstraction.

const CONCURRENCE_MAX_RESOLUTION_LIENS = 3;

export interface ElementPrepare {
  element: ElementGenere;
  candidat?: CandidatJournal;
  cleDemandeLien?: string;
}

export interface MomentPrepare {
  moment: z.infer<typeof SortieGenerationSchema>['moments'][number];
  ville?: string;
  elements: ElementPrepare[];
}

export function cleTexte(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function villeDuMoment(villeProposee: string | undefined, villesDuBrief: string[]): string | undefined {
  if (villeProposee) {
    const cleVille = cleTexte(villeProposee);
    const villeValidee = villesDuBrief.find((ville) => cleTexte(ville) === cleVille);
    if (villeValidee) return villeValidee;
  }
  return villesDuBrief.length === 1 ? villesDuBrief[0] : undefined;
}

function typeRecherchePour(typeElement: TypeElement): TypeMetierRecherche | undefined {
  if (
    typeElement === 'restaurant' ||
    typeElement === 'activite' ||
    typeElement === 'sortie' ||
    typeElement === 'hebergement' ||
    typeElement === 'evenement'
  ) {
    return typeElement;
  }
  return undefined;
}

export function texteNonVide(valeur: unknown): valeur is string {
  return typeof valeur === 'string' && valeur.trim().length > 0;
}

function construireDemandeResolutionLien(
  candidat: CandidatJournal,
): DemandeResolutionLien | undefined {
  if (
    !texteNonVide(candidat.identifiantExterne) ||
    !texteNonVide(candidat.nom) ||
    !texteNonVide(candidat.villeDemandee) ||
    !texteNonVide(candidat.source) ||
    !texteNonVide(candidat.recupereLe) ||
    Number.isNaN(Date.parse(candidat.recupereLe))
  ) {
    return undefined;
  }

  // Le chemin hôtelier F3-C2 reste local. Un hôtel Foursquare vérifié ne doit
  // jamais déclencher Tavily ni produire une réservation.
  if (candidat.typeMetierRecherche === 'hebergement') {
    return undefined;
  }

  const adresseOuSalle =
    candidat.typeMetierRecherche === 'evenement'
      ? candidat.salle
      : candidat.adresse;
  const commun = {
    identifiantExterne: candidat.identifiantExterne.trim(),
    nom: candidat.nom.trim(),
    villeDemandee: candidat.villeDemandee.trim(),
    adresseOuSalle: texteNonVide(adresseOuSalle)
      ? adresseOuSalle.trim()
      : undefined,
    sourceMetier: candidat.source.trim(),
  };

  if (candidat.typeMetierRecherche === 'evenement') {
    if (
      candidat.fournisseur !== 'PredictHQ' ||
      !texteNonVide(candidat.dateDebut)
    ) {
      return undefined;
    }
    return {
      ...commun,
      typeMetierRecherche: 'evenement',
      fournisseurMetier: 'PredictHQ',
      dateDebut: candidat.dateDebut.trim(),
      dateFin: texteNonVide(candidat.dateFin)
        ? candidat.dateFin.trim()
        : undefined,
    };
  }

  if (candidat.fournisseur !== 'Foursquare') {
    return undefined;
  }
  return {
    ...commun,
    typeMetierRecherche: candidat.typeMetierRecherche,
    fournisseurMetier: 'Foursquare',
  };
}

export function preparerMomentsPourResolution(
  moments: z.infer<typeof SortieGenerationSchema>['moments'],
  boite: BoiteAOutils,
  villesDuBrief: string[],
): {
  moments: MomentPrepare[];
  demandes: Map<string, DemandeResolutionLien>;
} {
  const demandes = new Map<string, DemandeResolutionLien>();
  const momentsPrepares = moments.map((moment) => {
    const ville = villeDuMoment(moment.ville, villesDuBrief);
    const elements = moment.elements.map((element): ElementPrepare => {
      const typeMetierRecherche = typeRecherchePour(element.type);
      const candidat =
        typeMetierRecherche && ville
          ? boite.rapprocherCandidat({
              identifiantExterne: element.identifiantExterne,
              nom: element.nom,
              villeDemandee: ville,
              typeMetierRecherche,
              adresse:
                typeMetierRecherche === 'hebergement'
                  ? element.lieu
                  : undefined,
            })
          : undefined;
      if (!candidat) return { element };

      if (candidat.typeMetierRecherche === 'hebergement') {
        return { element, candidat };
      }

      const demande = construireDemandeResolutionLien(candidat);
      if (!demande) return { element };
      if (estNomTropGenerique(candidat.nom)) {
        return { element, candidat };
      }

      const cleDemandeLien = cleDemandeResolutionLien(demande);
      if (!demandes.has(cleDemandeLien)) {
        demandes.set(cleDemandeLien, demande);
      }
      return { element, candidat, cleDemandeLien };
    });
    return { moment, ville, elements };
  });

  return { moments: momentsPrepares, demandes };
}

export async function resoudreDemandesLien(
  demandes: Map<string, DemandeResolutionLien>,
): Promise<Map<string, ResultatResolutionLien>> {
  const entrees = [...demandes.entries()];
  const resultats = new Map<string, ResultatResolutionLien>();
  let prochainIndex = 0;

  async function executerFile(): Promise<void> {
    while (prochainIndex < entrees.length) {
      const index = prochainIndex;
      prochainIndex += 1;
      const [cleDemande, demande] = entrees[index];
      try {
        const resultat = await resoudreLien(demande);
        resultats.set(cleDemande, resultat);
      } catch {
        // Le lien est facultatif : une exception inattendue reste une
        // indisponibilité technique locale, sans interrompre les autres
        // résolutions et sans produire de repli.
        console.warn(
          'Résolution facultative de lien indisponible après une erreur technique inattendue.',
        );
      }
    }
  }

  const nombreExecutants = Math.min(
    CONCURRENCE_MAX_RESOLUTION_LIENS,
    entrees.length,
  );
  await Promise.all(
    Array.from({ length: nombreExecutants }, () => executerFile()),
  );
  return resultats;
}
