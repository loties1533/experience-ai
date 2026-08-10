import { AppError } from '../../lib/AppError.js';
import { rechercherEvenementsPredictHQEventFirst } from '../../services/predictHQ.js';
import {
  estPlageEvenementiellePlanifiable,
  type CandidatEvenementEventFirst,
} from '../../services/rechercheExterne.js';
import type { Brief } from '../brief.js';
import { paysDeclares, villesDeclarees } from '../localisationDeclaree.js';
import {
  ContextePlanifiableSchema,
  ResultatCadrageGenerationSchema,
  type ContextePlanifiable,
  type ResultatCadrageGeneration,
} from './contratPreparation.js';
import {
  estDemandeNBAEvenementielle,
  normaliserTexteNBA as normaliserTexte,
  villesExplicitesNBA,
} from './demandeNBA.js';
import { decouvrirDestinations } from './decouverteDestinations.js';
import { destinationsAResoudreApresIntake } from './resolutionDestinations.js';

export { estDemandeNBAEvenementielle } from './demandeNBA.js';

const NOMBRE_MAX_ANCRES_EVENEMENTIELLES = 3;

function paysNBAConfirme(brief: Brief): 'US' | undefined {
  const texte = normaliserTexte(
    [brief.intention, ...brief.contraintes].join(' ')
  );
  return paysDeclares(brief).some(
    (pays) =>
      pays.codePays === 'US' ||
      /^(?:etats unis|usa|us)$/.test(normaliserTexte(pays.nom))
  ) || /\b(etats unis|usa|us)\b/.test(texte)
    ? 'US'
    : undefined;
}

function nombreJoursInclus(debut: string, fin: string): number {
  const premier = Date.parse(`${debut}T00:00:00.000Z`);
  const dernier = Date.parse(`${fin}T00:00:00.000Z`);
  return Math.floor((dernier - premier) / 86_400_000) + 1;
}

function dateCivilePrecedente(date: string): string {
  const precedente = new Date(`${date}T00:00:00.000Z`);
  precedente.setUTCDate(precedente.getUTCDate() - 1);
  return precedente.toISOString().slice(0, 10);
}

/**
 * Trois ancres au plus, environ une par tranche de dix jours : cela laisse du
 * temps au séjour et évite de transformer une envie de plusieurs semaines en
 * calendrier de matchs. La première passe privilégie des villes différentes,
 * puis complète chronologiquement si nécessaire.
 */
export function selectionnerEvenementsEventFirst(
  candidats: CandidatEvenementEventFirst[],
  dateDebut: string,
  dateFin: string
): CandidatEvenementEventFirst[] {
  const candidatsPlanifiables = candidats.filter((candidat) =>
    estPlageEvenementiellePlanifiable(candidat.dateDebut, candidat.dateFin)
  );
  const uniques = [
    ...new Map(
      candidatsPlanifiables.map((candidat) => [candidat.identifiantExterne, candidat])
    ).values(),
  ]
    .sort(
      (gauche, droite) =>
        gauche.dateDebut.localeCompare(droite.dateDebut) ||
        gauche.identifiantExterne.localeCompare(droite.identifiantExterne)
    );
  const limite = Math.min(
    NOMBRE_MAX_ANCRES_EVENEMENTIELLES,
    Math.max(1, Math.ceil(nombreJoursInclus(dateDebut, dateFin) / 10))
  );
  const retenus: CandidatEvenementEventFirst[] = [];
  const villesRetenues = new Set<string>();

  function peutRetenir(candidat: CandidatEvenementEventFirst): boolean {
    const precedent = retenus.at(-1);
    return (
      precedent === undefined ||
      precedent.ville === candidat.ville ||
      candidat.dateDebut.slice(0, 10) > precedent.dateDebut.slice(0, 10)
    );
  }

  for (const candidat of uniques) {
    if (retenus.length === limite) break;
    if (villesRetenues.has(normaliserTexte(candidat.ville)) || !peutRetenir(candidat)) continue;
    retenus.push(candidat);
    villesRetenues.add(normaliserTexte(candidat.ville));
  }
  for (const candidat of uniques) {
    if (retenus.length === limite) break;
    if (retenus.some((retenu) => retenu.identifiantExterne === candidat.identifiantExterne)) continue;
    if (peutRetenir(candidat)) retenus.push(candidat);
  }
  return retenus.sort(
    (gauche, droite) =>
      gauche.dateDebut.localeCompare(droite.dateDebut) ||
      gauche.identifiantExterne.localeCompare(droite.identifiantExterne)
  );
}

/** Transforme uniquement les candidats sélectionnés en étapes fournisseur. */
export function construireEtapesEvenementielles(
  evenements: CandidatEvenementEventFirst[],
  dateDebut: string,
  dateFin: string
): ContextePlanifiable['etapes'] {
  const groupes: CandidatEvenementEventFirst[][] = [];
  for (const evenement of evenements) {
    const groupe = groupes.at(-1);
    if (groupe && groupe[0].ville === evenement.ville) groupe.push(evenement);
    else groupes.push([evenement]);
  }
  return groupes.map((ancres, index) => {
    const suivante = groupes[index + 1];
    const debut = index === 0 ? dateDebut : ancres[0].dateDebut.slice(0, 10);
    const fin = suivante
      ? dateCivilePrecedente(suivante[0].dateDebut.slice(0, 10))
      : dateFin;
    return {
      ville: { nom: ancres[0].ville, origine: 'fournisseur' as const },
      plage: { debut, fin },
      ancres,
    };
  });
}

/** Villes planifiées, sans les réécrire dans le Brief utilisateur. */
export function villesPlanifiees(contexte: ContextePlanifiable): string[] {
  return contexte.etapes.map((etape) => etape.ville.nom);
}

/** Projection déterministe du brief confirmé hors stratégie événementielle. */
function construireContextePlanifiableDepuisVilles(
  brief: Brief,
  villes: string[]
): ContextePlanifiable {
  if (villes.length === 0) {
    throw new Error('Un contexte planifiable exige au moins une ville.');
  }
  const contraintesConservees = {
    ...(brief.dates ? { dates: brief.dates } : {}),
    ...(brief.budgetTotal === undefined ? {} : { budgetTotal: brief.budgetTotal }),
  };

  return ContextePlanifiableSchema.parse({
    strategie: 'villes_du_brief',
    etapes: villes.map((nom) => ({
      ville: { nom, origine: 'utilisateur' },
      ancres: [],
    })),
    contraintesConservees,
  });
}

export function construireContextePlanifiable(brief: Brief): ContextePlanifiable {
  return construireContextePlanifiableDepuisVilles(
    brief,
    villesDeclarees(brief).map((ville) => ville.nom)
  );
}

export interface DependancesPreparationGeneration {
  decouvrirDestinations: typeof decouvrirDestinations;
}

const DEPENDANCES_PREPARATION_PAR_DEFAUT: DependancesPreparationGeneration = {
  decouvrirDestinations,
};

/**
 * Oriente d'abord le vertical event-first NBA, puis la découverte générique
 * lorsqu'aucune vraie ville n'est déclarée. Une ville explicite conserve la
 * projection déterministe historique.
 */
export async function preparerGeneration(
  brief: Brief,
  dependances: DependancesPreparationGeneration =
    DEPENDANCES_PREPARATION_PAR_DEFAUT
): Promise<ResultatCadrageGeneration> {
  if (!estDemandeNBAEvenementielle(brief)) {
    if (destinationsAResoudreApresIntake(brief)) {
      return dependances.decouvrirDestinations(brief);
    }
    return ResultatCadrageGenerationSchema.parse({
      type: 'planifiable',
      contexte: construireContextePlanifiable(brief),
    });
  }

  const villesExplicites = villesExplicitesNBA(brief.lieux);
  if (villesExplicites.length > 0) {
    return ResultatCadrageGenerationSchema.parse({
      type: 'planifiable',
      contexte: construireContextePlanifiableDepuisVilles(brief, villesExplicites),
    });
  }
  if (!brief.dates) {
    return ResultatCadrageGenerationSchema.parse({
      type: 'clarification_requise',
      clarification: {
        code: 'periode_requise',
        question: 'À quelle période souhaites-tu vivre ces matchs NBA ?',
        champCible: 'dates',
      },
      etatDialogue: {
        champ: 'preparation_generation',
        code: 'periode_requise',
        champCible: 'dates',
      },
    });
  }

  const dateDebut = brief.dates.debut.slice(0, 10);
  const dateFin = brief.dates.fin.slice(0, 10);
  const pays = paysNBAConfirme(brief);
  const recherche = await rechercherEvenementsPredictHQEventFirst({
    requete: 'NBA',
    dateDebut,
    dateFin,
    categorie: 'sports',
    ...(pays ? { pays } : {}),
  });
  if (recherche.statut === 'indisponible') {
    throw new AppError(
      'La recherche des événements nécessaires est momentanément indisponible.',
      503
    );
  }
  if (recherche.statut === 'vide') {
    return ResultatCadrageGenerationSchema.parse({
      type: 'refus',
      refus: {
        code: 'donnees_essentielles_insuffisantes',
        message: 'Aucun événement NBA vérifiable n’a été trouvé sur les dates et la zone demandées.',
      },
    });
  }

  const selection = selectionnerEvenementsEventFirst(recherche.resultats, dateDebut, dateFin);
  if (selection.length === 0) {
    return ResultatCadrageGenerationSchema.parse({
      type: 'refus',
      refus: {
        code: 'donnees_essentielles_insuffisantes',
        message: 'Aucun événement NBA vérifiable n’a été trouvé sur les dates et la zone demandées.',
      },
    });
  }
  const etapes = construireEtapesEvenementielles(selection, dateDebut, dateFin);
  console.info(
    `[generation.preparation.event] query=NBA candidates=${recherche.resultats.length} ` +
      `selected=${selection.length} cities=${[...new Set(etapes.map((etape) => etape.ville.nom))].join(',')}`
  );
  return ResultatCadrageGenerationSchema.parse({
    type: 'planifiable',
    contexte: {
      strategie: 'decouverte_evenementielle',
      etapes,
      contraintesConservees: { dates: brief.dates, ...(brief.budgetTotal === undefined ? {} : { budgetTotal: brief.budgetTotal }) },
    },
  });
}
