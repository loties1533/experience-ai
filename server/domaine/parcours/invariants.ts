import type { Element, Parcours, PlageHoraire } from './schema.js';

// Invariants 3 à 6 de docs/06-modele-conceptuel.md : logique pure, testable,
// indépendante du stockage. Retourne des erreurs lisibles, ne lève jamais.

export interface ConflitHoraire {
  elementA: string;
  elementB: string;
  description: string;
}

function tousLesElements(parcours: Parcours): Element[] {
  return parcours.timeline.flatMap((moment) => moment.elements);
}

function plagesSeChevauchent(a: PlageHoraire, b: PlageHoraire): boolean {
  return Date.parse(a.debut) < Date.parse(b.fin) && Date.parse(b.debut) < Date.parse(a.fin);
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
