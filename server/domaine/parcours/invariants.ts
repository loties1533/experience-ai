import type { Alternative, Element, Parcours, PlageHoraire, Role } from './schema.js';

// Invariants 3 à 8 de docs/06-modele-conceptuel.md : logique pure, testable,
// indépendante du stockage. Retourne des erreurs lisibles, ne lève jamais.

export interface ConflitHoraire {
  elementA: string;
  elementB: string;
  description: string;
}

/**
 * Invariant 8 — ce qu'un rôle a le droit de faire, dit en responsabilités
 * métier (doc 06) et non en permissions techniques.
 */
export type ActionParcours = 'proposer' | 'ajuster' | 'supprimer' | 'arbitrer';

const RESPONSABILITES: Record<Role, ActionParcours[]> = {
  // Responsable du parcours : décide, modifie, supprime.
  organisateur: ['proposer', 'ajuster', 'supprimer', 'arbitrer'],
  // Contribue : propose et ajuste. Ne supprime pas, et ne tranche pas un
  // arbitrage — écarter une option engage le parcours entier, c'est décider.
  participant: ['proposer', 'ajuster'],
  // Celui pour qui le parcours existe : il ne décide pas (l'EVG de Max).
  heros: [],
};

const LIBELLES_ACTION: Record<ActionParcours, string> = {
  proposer: 'ajouter un élément',
  ajuster: 'ajuster un élément',
  supprimer: 'supprimer un élément',
  arbitrer: 'écarter une option',
};

function tousLesElements(parcours: Parcours): Element[] {
  return parcours.timeline.flatMap((moment) => moment.elements);
}

function plagesSeChevauchent(a: PlageHoraire, b: PlageHoraire): boolean {
  return Date.parse(a.debut) < Date.parse(b.fin) && Date.parse(b.debut) < Date.parse(a.fin);
}

/** `interieure` tient-elle entièrement dans `englobante` (bornes comprises) ? */
function plageContenue(interieure: PlageHoraire, englobante: PlageHoraire): boolean {
  return (
    Date.parse(interieure.debut) >= Date.parse(englobante.debut) &&
    Date.parse(interieure.fin) <= Date.parse(englobante.fin)
  );
}

/** Tout ce dont un élément dépend, directement ou par ricochet. */
function dependancesTransitives(elements: Element[], elementId: string): Set<string> {
  const parId = new Map(elements.map((e) => [e.id, e]));
  const vues = new Set<string>();
  const aExplorer = [...(parId.get(elementId)?.dependDe ?? [])];
  while (aExplorer.length > 0) {
    const courant = aExplorer.pop() as string;
    if (vues.has(courant)) continue;
    vues.add(courant);
    aExplorer.push(...(parId.get(courant)?.dependDe ?? []));
  }
  return vues;
}

/** Plages non négociables d'un élément : la sienne + ses contraintes dures. */
function plagesDures(element: Element): PlageHoraire[] {
  const plages = element.contraintes
    .filter((c) => c.nature === 'dure')
    .map((c) => c.plage);
  if (element.plage && (element.estAncre || element.type === 'evenement')) {
    plages.push(element.plage);
  }
  return plages;
}

/**
 * Invariant 3 : modifier un élément ne recalcule que ses dépendances.
 * Retourne les ids des éléments qui dépendent (directement ou transitivement)
 * de l'élément donné — le périmètre exact d'un recalcul ciblé.
 */
export function elementsDependants(parcours: Parcours, elementId: string): string[] {
  const elements = tousLesElements(parcours);
  const dependants = new Set<string>();
  let taillePrecedente = -1;
  while (dependants.size > taillePrecedente) {
    taillePrecedente = dependants.size;
    for (const element of elements) {
      if (element.id === elementId) continue;
      if (element.dependDe.some((id) => id === elementId || dependants.has(id))) {
        dependants.add(element.id);
      }
    }
  }
  return [...dependants];
}

/**
 * Invariant 7 : les alternatives encore proposables d'un élément — c'est-à-dire
 * toutes SAUF celles que l'utilisateur a déjà écartées. Le produit (front comme
 * agent IA) ne doit jamais offrir autre chose que ça : un arbitrage est définitif.
 */
export function alternativesProposables(element: Element): Alternative[] {
  return element.alternatives.filter((alternative) => !alternative.ecartee);
}

/**
 * Invariant 8 : une modification s'exerce dans le cadre des responsabilités du
 * rôle de son auteur. Rend un message affichable si l'auteur n'a pas la main,
 * `null` s'il l'a. Un auteur qui n'est pas dans le parcours n'a aucune main.
 */
export function verifierResponsabilite(
  parcours: Parcours,
  auteurId: string,
  action: ActionParcours
): string | null {
  const auteur = parcours.participants.find((p) => p.id === auteurId);
  if (!auteur) {
    return 'Vous ne faites pas partie de ce parcours';
  }
  if (RESPONSABILITES[auteur.role].includes(action)) {
    return null;
  }
  if (auteur.role === 'heros') {
    return `« ${auteur.nom} » est le héros de ce parcours : il n'en décide pas le contenu`;
  }
  return `« ${auteur.nom} » participe à ce parcours : ${LIBELLES_ACTION[action]} revient à l'organisateur`;
}

/**
 * Conflits entre contraintes dures / ancres datées (histoire d'Inès : deux sets
 * au même horaire). Le produit les signale, l'utilisateur arbitre (invariant 6).
 */
export function detecterConflits(parcours: Parcours): ConflitHoraire[] {
  const elements = tousLesElements(parcours);
  const conflits: ConflitHoraire[] = [];
  for (let i = 0; i < elements.length; i++) {
    for (let j = i + 1; j < elements.length; j++) {
      const chevauche = plagesDures(elements[i]).some((a) =>
        plagesDures(elements[j]).some((b) => plagesSeChevauchent(a, b))
      );
      if (chevauche) {
        conflits.push({
          elementA: elements[i].id,
          elementB: elements[j].id,
          description: `« ${elements[i].nom} » et « ${elements[j].nom} » ont des horaires non négociables qui se chevauchent`,
        });
      }
    }
  }
  return conflits;
}

/**
 * Cohérence structurelle au-delà des schémas Zod. Retourne la liste des
 * erreurs ; vide = parcours valide.
 */
export function validerParcours(parcours: Parcours): string[] {
  const erreurs: string[] = [];
  const elements = tousLesElements(parcours);
  const ids = new Set(elements.map((e) => e.id));

  if (ids.size !== elements.length) {
    erreurs.push('les ids des éléments doivent être uniques dans le parcours');
  }

  for (const element of elements) {
    for (const dependance of element.dependDe) {
      if (!ids.has(dependance)) {
        erreurs.push(`l'élément « ${element.nom} » dépend d'un élément inconnu (${dependance})`);
      }
    }
    // Une boucle (directe ou par ricochet) rendrait le recalcul ciblé sans fin.
    if (dependancesTransitives(elements, element.id).has(element.id)) {
      erreurs.push(`la chaîne de dépendances de « ${element.nom} » boucle sur elle-même`);
    }
    if (element.type === 'temps_libre' && element.reservation) {
      erreurs.push(`un temps libre ne se réserve pas (« ${element.nom} »)`);
    }
    // L'id d'une alternative porte la mémoire de l'arbitrage (invariant 7) :
    // deux options homonymes rendraient « écartée » ambigu.
    const idsAlternatives = new Set(element.alternatives.map((a) => a.id));
    if (idsAlternatives.size !== element.alternatives.length) {
      erreurs.push(`les alternatives de « ${element.nom} » doivent avoir des ids distincts`);
    }
  }

  // Quand le parcours porte de vraies dates, rien ne se passe en dehors.
  const dates = parcours.contexte.dates;
  if (dates) {
    for (const moment of parcours.timeline) {
      if (moment.plage && !plageContenue(moment.plage, dates)) {
        erreurs.push(`le moment « ${moment.titre} » se situe hors des dates du parcours`);
      }
      for (const element of moment.elements) {
        if (element.plage && !plageContenue(element.plage, dates)) {
          erreurs.push(`« ${element.nom} » se situe hors des dates du parcours`);
        }
      }
    }
  }

  if (parcours.visibilite === 'surprise') {
    if (parcours.participants.length < 2) {
      erreurs.push('un parcours surprise implique au moins deux participants');
    }
    if (!parcours.participants.some((p) => p.role === 'organisateur')) {
      erreurs.push('un parcours surprise exige un organisateur');
    }
  }

  return erreurs;
}
