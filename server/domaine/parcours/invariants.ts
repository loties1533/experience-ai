import type { Alternative, Element, Parcours, Participant, PlageHoraire, Role } from './schema.js';

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
export type ActionParcours =
  | 'proposer'
  | 'ajuster'
  | 'supprimer'
  | 'arbitrer'
  | 'convier'
  | 'reagir';

const RESPONSABILITES: Record<Role, ActionParcours[]> = {
  // Responsable du parcours : décide, modifie, supprime, et constitue le groupe.
  organisateur: ['proposer', 'ajuster', 'supprimer', 'arbitrer', 'convier', 'reagir'],
  // Contribue : propose et ajuste. Ne supprime pas, et ne tranche pas un
  // arbitrage — écarter une option engage le parcours entier, c'est décider.
  // Ne convie pas non plus : décider qui voit le parcours, c'est décider.
  participant: ['proposer', 'ajuster', 'reagir'],
  // Celui pour qui le parcours existe : il ne décide pas (l'EVG de Max). Il
  // peut néanmoins réagir quand il voit le parcours — donner son avis n'est
  // pas décider, et l'invariant 8 protège la décision, pas l'expression.
  heros: ['reagir'],
};

const LIBELLES_ACTION: Record<ActionParcours, string> = {
  proposer: 'ajouter un élément',
  ajuster: 'ajuster un élément',
  supprimer: 'supprimer un élément',
  arbitrer: 'écarter une option',
  convier: 'décider qui voit ce parcours',
  reagir: 'donner son avis',
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
 * La **Visibilité** dit qui, en dehors du propriétaire, peut consulter le
 * parcours. C'est la règle du domaine ; la technique du lien (un jeton par
 * participant, ADR-0008) ne fait que l'appliquer.
 *
 * Rend un message affichable en cas de refus, `null` si l'accès est légitime.
 * Une seule et même fonction sert aux deux moments où la question se pose :
 * quand on **émet** un lien pour un participant, et à **chaque consultation**
 * — impossible qu'un lien émis hier survive à un changement de visibilité.
 */
export function verifierAccesPartage(parcours: Parcours, participantId: string): string | null {
  if (parcours.visibilite === 'prive') {
    return "Ce parcours n'est pas partagé";
  }
  const participant = parcours.participants.find((p) => p.id === participantId);
  if (!participant) {
    return 'Vous ne faites pas partie de ce parcours';
  }
  // L'histoire de Max (EVG) et celle de Léa : le héros ne voit pas la surprise
  // qu'on lui prépare.
  if (parcours.visibilite === 'surprise' && participant.role === 'heros') {
    return "Ce parcours est une surprise : celui pour qui elle est préparée n'y a pas accès";
  }
  return null;
}

/** Les participants à qui un lien de partage peut être remis, en l'état actuel. */
export function participantsPartageables(parcours: Parcours): Participant[] {
  return parcours.participants.filter((p) => verifierAccesPartage(parcours, p.id) === null);
}

/**
 * Ce que le groupe pense d'un élément — l'avis qui éclaire, pas le vote qui
 * décide (invariant 8 : l'organisateur tranche). Les noms sont résolus ici,
 * contre les participants du parcours : un participant retiré disparaît.
 */
export interface AvisDuGroupe {
  pour: string[];
  contre: string[];
}

export function avisDuGroupe(parcours: Parcours, element: Element): AvisDuGroupe {
  const nomParId = new Map(parcours.participants.map((p) => [p.id, p.nom]));
  const avis: AvisDuGroupe = { pour: [], contre: [] };
  for (const reaction of element.reactions) {
    const nom = nomParId.get(reaction.participantId);
    if (nom) avis[reaction.avis].push(nom);
  }
  return avis;
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
  const idsParticipants = new Set(parcours.participants.map((p) => p.id));

  if (ids.size !== elements.length) {
    erreurs.push('les ids des éléments doivent être uniques dans le parcours');
  }
  if (idsParticipants.size !== parcours.participants.length) {
    erreurs.push('les participants doivent avoir des ids distincts');
  }

  for (const element of elements) {
    // Une réaction est l'avis d'un participant DU parcours, et un participant
    // n'a qu'un avis par élément (changer d'avis remplace, ne s'empile pas).
    const auteursReactions = new Set<string>();
    for (const reaction of element.reactions) {
      if (!idsParticipants.has(reaction.participantId)) {
        erreurs.push(`une réaction sur « ${element.nom} » vient de quelqu'un qui n'est pas dans le parcours`);
      }
      if (auteursReactions.has(reaction.participantId)) {
        erreurs.push(`un participant a plusieurs avis sur « ${element.nom} »`);
      }
      auteursReactions.add(reaction.participantId);
    }

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

  // Quand le parcours porte de vraies dates, rien ne COMMENCE en dehors.
  //
  // On ne contrôle que le début, jamais la fin : un hébergement se rend le
  // lendemain matin du dernier jour, et un club ferme après minuit. Exiger que
  // la fin tombe aussi dans les bornes rendait ces deux cas impossibles — la
  // génération échouait alors sur trois parcours sur quatre en « parcours
  // incohérent », alors que le parcours était juste (constaté en recette).
  const dates = parcours.contexte.dates;
  if (dates) {
    const commenceDansLesBornes = (plage: PlageHoraire): boolean =>
      Date.parse(plage.debut) >= Date.parse(dates.debut) &&
      Date.parse(plage.debut) <= Date.parse(dates.fin);

    for (const moment of parcours.timeline) {
      if (moment.plage && !commenceDansLesBornes(moment.plage)) {
        erreurs.push(`le moment « ${moment.titre} » commence hors des dates du parcours`);
      }
      for (const element of moment.elements) {
        if (element.plage && !commenceDansLesBornes(element.plage)) {
          erreurs.push(`« ${element.nom} » commence hors des dates du parcours`);
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
