import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../lib/AppError.js';
import { callAI, parseJSON, sanitizeInput } from '../services/claude/core.js';
import {
  appliquerModification,
  estDemandeModificationHotelClient,
  estDemandeModificationTransportClient,
  preparerDemandeSurElementClient,
  validerParcours,
  type ContexteModification,
  type DemandeSurElementClient,
  type Element,
  type Parcours,
} from '../domaine/parcours/index.js';
import { appliquerModificationHotel } from '../services/modificationHotel.js';
import { appliquerModificationTransport } from '../services/modificationTransport.js';
import {
  determinerImpactModification,
  type ChangementContexteParcours,
  type ChangementParcours,
} from './impactModification.js';
import { nomSuggestion } from './generation.js';
import type { Brief } from './brief.js';

// F8-B — la régénération ciblée EN MÉMOIRE (invariant 3 + F8-A), sur une
// COPIE de travail complète du parcours. Aucune écriture DB ici : le contrat
// d'F8-A dit quoi régénérer, ce module l'exécute et rend soit une copie
// entièrement valide prête à être persistée par F8-C, soit une erreur
// structurée. Le parcours d'entrée n'est jamais muté (`structuredClone`
// avant toute application).
//
// Aucun faux parcours présenté comme réel (loi produit) : un dépendant
// marqué à régénérer est reconstruit — jamais un libellé maquillé — et
// redevient systématiquement `suggestion` (jamais `verifie` sans preuve).
// Un élément non dépendant reste identique, y compris son niveau de
// confiance.

const TYPES_CONTEXTE = new Set<ChangementContexteParcours['type']>([
  'changer_dates',
  'changer_duree',
  'changer_composition',
  'changer_destination',
]);

function estChangementContexte(
  modification: ChangementParcours
): modification is ChangementContexteParcours {
  return TYPES_CONTEXTE.has(modification.type as ChangementContexteParcours['type']);
}

function trouverElement(parcours: Parcours, elementId: string): Element | undefined {
  return parcours.timeline.flatMap((moment) => moment.elements).find((e) => e.id === elementId);
}

function remplacerElementDansParcours(parcours: Parcours, element: Element): Parcours {
  return {
    ...parcours,
    timeline: parcours.timeline.map((moment) => ({
      ...moment,
      elements: moment.elements.map((e) => (e.id === element.id ? element : e)),
    })),
  };
}

/**
 * Ordonne les dépendants à régénérer pour qu'un parent soit TOUJOURS
 * régénéré avant ses propres dépendants (A → B → C : B voit le nouveau A,
 * C voit le nouveau B, jamais l'ancien). `elementsDependants` (F8-A) rend
 * déjà cet ordre par construction (BFS par profondeur de dépendance) pour
 * une cible unique, mais une fusion de plusieurs cibles
 * (`impactParType` — occupation hôtelière, demande de transport) concatène
 * plusieurs listes bout à bout : rien ne garantit alors l'ordre global. On
 * ne fait donc jamais confiance à l'ordre reçu : un tri topologique explicite,
 * restreint au sous-graphe des ids à régénérer, est recalculé ici. Un cycle
 * (normalement impossible, `validerParcours` le refuse déjà) est détecté
 * plutôt que de boucler ou de régénérer avec des données obsolètes.
 */
function ordonnerParDependance(parcours: Parcours, ids: string[]): string[] | null {
  const ensemble = new Set(ids);
  const dependDePar = new Map(
    parcours.timeline
      .flatMap((moment) => moment.elements)
      .map((e) => [e.id, e.dependDe.filter((id) => ensemble.has(id))] as const)
  );

  const ordre: string[] = [];
  const acheves = new Set<string>();
  const enCours = new Set<string>();

  function visiter(id: string): boolean {
    if (acheves.has(id)) return true;
    if (enCours.has(id)) return false;
    enCours.add(id);
    for (const dependance of dependDePar.get(id) ?? []) {
      if (!visiter(dependance)) return false;
    }
    enCours.delete(id);
    acheves.add(id);
    ordre.push(id);
    return true;
  }

  for (const id of ids) {
    if (!visiter(id)) return null;
  }
  return ordre;
}

/** Qui prépare la modification, et quand — repris tel quel côté application. */
export interface ContexteRegeneration extends ContexteModification {
  /** Injectable pour les tests : par défaut `randomUUID` (comme la route). */
  creerId?: () => string;
}

/**
 * Points d'injection : permettent de prouver en test qu'aucun réseau ni DB
 * n'est sollicité, et laissent à un appelant futur (F8-C ou au-delà) la
 * possibilité de brancher une vraie régénération intégrale le jour où une
 * catégorie de contexte (dates, durée, composition, destination) aura enfin
 * une mutation réelle — sans que ce module ait besoin d'être repensé.
 */
export interface DependancesRegeneration {
  regenererElement?: (
    parcours: Parcours,
    elementId: string,
    contexte: ContexteRegeneration
  ) => Promise<Element>;
  regenererIntegralement?: (
    parcours: Parcours,
    modification: ChangementParcours,
    brief: Brief | undefined,
    contexte: ContexteRegeneration
  ) => Promise<Parcours>;
}

type StatutHttpEchec = 403 | 404 | 422 | 502 | 503;

export type ResultatRegeneration =
  | {
      ok: true;
      /** Copie de travail complète, déjà validée — rien n'est persisté ici. */
      parcours: Parcours;
      description: string;
      /** Ids réellement reconstruits (sous-ensemble de l'impact F8-A encore présents). */
      elementsRegeneres: string[];
    }
  | { ok: false; erreur: string; statutHttp?: StatutHttpEchec };

const STATUTS_HTTP_ECHEC = new Set<StatutHttpEchec>([403, 404, 422, 502, 503]);

function echecDepuisErreur(erreur: unknown): { erreur: string; statutHttp?: StatutHttpEchec } {
  if (erreur instanceof AppError) {
    const statutHttp = erreur.statusCode;
    return {
      erreur: erreur.message,
      ...(STATUTS_HTTP_ECHEC.has(statutHttp as StatutHttpEchec) ? { statutHttp: statutHttp as StatutHttpEchec } : {}),
    };
  }
  return { erreur: 'La régénération a échoué', statutHttp: 502 };
}

// Pas de `.strict()` : un modèle qui ajoute malgré tout une clé ignorée par
// le prompt (ex. un `nom` non demandé) ne doit pas faire échouer la
// régénération, elle est simplement écartée par zod.
const RegenerationElementSchema = z.object({
  prix: z.number().nonnegative().optional(),
  justification: z.string().trim().min(1).max(1000),
});

const SYSTEM_REGENERATION = `Tu justifies UN élément d'un parcours devenu incohérent après la modification d'un élément dont il dépend.
Réponds UNIQUEMENT en JSON valide de cette forme :
{"prix"?: number, "justification": string}
Le type, le nom et la place de l'élément dans le parcours ne changent pas : seule sa justification doit rester cohérente avec ce dont il dépend désormais.
N'invente jamais de nom d'établissement, d'adresse, de confiance, de provenance, de fournisseur, de source, de disponibilité ni de lien : ce ne sont pas des informations que tu possèdes.
Si l'élément porte déjà un prix, donne un prix du même ordre de grandeur, sauf si le changement l'implique clairement.`;

/**
 * Régénération PAR DÉFAUT d'un dépendant : jamais un nom propre ni une
 * adresse inventés (loi produit — « un résultat sans preuve reste une idée
 * générique, jamais un faux nom propre », déjà le principe de
 * `nomSuggestion` en génération). Le LLM ne fournit QUE la justification (et
 * éventuellement un prix) ; le nom reste la même formule générique que la
 * génération utilise pour tout ce qui n'a aucune preuve fournisseur.
 *
 * Un hébergement ou un transport ne passe JAMAIS par ce mécanisme : leur
 * identité doit passer par un contrat dédié (`remplacer_hotel`,
 * `modifier_demande_transport`), exactement comme au premier remplacement —
 * inventer un hôtel ou un trajet ici romprait la loi produit.
 *
 * Aucune preuve de l'ancien contenu ne survit : `lieu`, `lienExterne`,
 * `contraintes` et `reactions` de l'ancien élément décrivaient un contenu
 * qui n'existe plus. `statut` et `alternatives` repartent aussi de zéro —
 * une suggestion reconstruite n'a pas hérité de l'arbitrage rendu sur
 * l'ancien contenu.
 */
async function regenererElementParDefaut(
  parcours: Parcours,
  elementId: string
): Promise<Element> {
  const cible = trouverElement(parcours, elementId);
  if (!cible) {
    throw new AppError(`Aucun élément « ${elementId} » à régénérer`, 404);
  }
  if (cible.type === 'hebergement' || cible.type === 'transport') {
    throw new AppError(
      `« ${cible.nom} » ne peut pas être régénéré automatiquement : son identité doit passer par une modification dédiée`,
      422
    );
  }

  const dependances = cible.dependDe
    .map((id) => trouverElement(parcours, id))
    .filter((e): e is Element => e !== undefined);
  const prompt = `Intention du parcours : ${parcours.intention.texte}
Élément à régénérer (générique, sans identité réelle) : « ${cible.nom} » [${cible.type}]${cible.prix !== undefined ? `, prix actuel : ${cible.prix} €` : ''}
Justification actuelle : ${sanitizeInput(cible.justification)}
Ce dont il dépend désormais :
${
  dependances.length > 0
    ? dependances.map((d) => `- « ${d.nom} » [${d.type}]${d.lieu ? `, ${d.lieu}` : ''}`).join('\n')
    : '- (aucune dépendance restante)'
}`;

  let sortie: z.infer<typeof RegenerationElementSchema>;
  try {
    const brut = await callAI(prompt, SYSTEM_REGENERATION, 'onboarding');
    const parsed = RegenerationElementSchema.safeParse(parseJSON(brut));
    if (!parsed.success) {
      throw new AppError(`La régénération de « ${cible.nom} » a produit un résultat inexploitable`, 502);
    }
    sortie = parsed.data;
  } catch (erreur) {
    if (erreur instanceof AppError) throw erreur;
    throw new AppError(`La régénération de « ${cible.nom} » a produit un résultat inexploitable`, 502);
  }

  return {
    ...cible,
    nom: nomSuggestion(cible.type),
    lieu: undefined,
    prix: sortie.prix ?? cible.prix,
    prixEstime: true,
    // Jamais `verifie` sans preuve fournisseur : un contenu réécrit redevient
    // toujours une suggestion, quel que soit le niveau de confiance d'avant.
    confiance: { niveau: 'suggestion' },
    justification: sortie.justification,
    statut: 'propose',
    estAncre: cible.estAncre,
    alternatives: [],
    contraintes: [],
    lienExterne: undefined,
    reactions: [],
  };
}

/**
 * Prépare une modification sur une COPIE de travail du parcours :
 * applique la modification, régénère les dépendants marqués par le contrat
 * F8-A, valide le tout, et rend le résultat EN MÉMOIRE. Ne persiste rien.
 *
 * Le parcours reçu n'est jamais muté (`structuredClone` avant toute
 * application) : en cas d'échec à n'importe quelle étape, l'appelant peut
 * toujours se rabattre dessus tel quel.
 */
export async function regenererModificationSurCopie(
  parcoursActuel: Parcours,
  modification: ChangementParcours,
  contexte: ContexteRegeneration,
  brief?: Brief,
  dependances: DependancesRegeneration = {}
): Promise<ResultatRegeneration> {
  const copie = structuredClone(parcoursActuel);
  const impact = determinerImpactModification(modification, copie, brief);

  // Les changements de contexte (F8-A) n'ont aujourd'hui aucune mutation
  // réelle câblée (aucune route ne sait changer dates/durée/composition/
  // destination) : refus explicite plutôt qu'une fausse régénération, même
  // si le contrat juge un cas particulier sans impact (`changer_duree` avec
  // dates déjà posées) — l'absence d'impact ne rend pas le champ mutable.
  // Un impact intégral (les quatre catégories ci-dessus, aujourd'hui) suit
  // la même règle : seul un `regenererIntegralement` explicitement injecté
  // peut le prendre en charge, jamais une régénération partielle déguisée.
  if (estChangementContexte(modification) || impact.regenererIntegralement) {
    if (dependances.regenererIntegralement) {
      return appliquerRegenerationIntegrale(copie, modification, brief, contexte, dependances);
    }
    return { ok: false, erreur: `Modification non supportée : ${impact.motif}`, statutHttp: 422 };
  }

  const resultatApplication = await appliquerDemandeSurElement(copie, modification, contexte);
  if (!resultatApplication.ok) {
    return { ok: false, erreur: resultatApplication.erreur, statutHttp: resultatApplication.statutHttp };
  }

  let parcoursTravail = resultatApplication.parcours;
  const regenererElement = dependances.regenererElement ?? regenererElementParDefaut;
  const elementsRegeneres: string[] = [];

  const idsARegenerer = [...new Set(impact.elementsARegenerer)];
  const ordre = ordonnerParDependance(parcoursTravail, idsARegenerer);
  if (ordre === null) {
    return {
      ok: false,
      erreur: 'La chaîne de dépendances des éléments à régénérer boucle sur elle-même',
      statutHttp: 422,
    };
  }

  for (const elementId of ordre) {
    // Un dépendant peut avoir déjà disparu par ricochet (ex. supprimé lui
    // aussi) : on ne régénère que ce qui existe encore dans la copie.
    if (!trouverElement(parcoursTravail, elementId)) continue;

    let regenere: Element;
    try {
      regenere = await regenererElement(parcoursTravail, elementId, contexte);
    } catch (erreur) {
      // Aucune dépendance technique en échec ne doit produire une copie
      // prétendument valide : toute la préparation est rejetée.
      return { ok: false, ...echecDepuisErreur(erreur) };
    }
    if (regenere.id !== elementId) {
      return { ok: false, erreur: 'La régénération a produit un identifiant incohérent', statutHttp: 502 };
    }

    parcoursTravail = remplacerElementDansParcours(parcoursTravail, regenere);
    elementsRegeneres.push(elementId);
  }

  const erreursValidation = validerParcours(parcoursTravail);
  if (erreursValidation.length > 0) {
    return {
      ok: false,
      erreur: `Cette modification rendrait le parcours incohérent : ${erreursValidation[0]}`,
      statutHttp: 422,
    };
  }

  return {
    ok: true,
    parcours: parcoursTravail,
    description: resultatApplication.description,
    elementsRegeneres,
  };
}

async function appliquerRegenerationIntegrale(
  copie: Parcours,
  modification: ChangementParcours,
  brief: Brief | undefined,
  contexte: ContexteRegeneration,
  dependances: DependancesRegeneration
): Promise<ResultatRegeneration> {
  try {
    // `dependances.regenererIntegralement` n'est jamais câblé par défaut :
    // aucune génération complète existante n'est aujourd'hui rebranchable
    // sur un parcours DÉJÀ persisté sans réinventer son brief d'origine.
    const regenere = await dependances.regenererIntegralement!(copie, modification, brief, contexte);
    const erreursValidation = validerParcours(regenere);
    if (erreursValidation.length > 0) {
      return {
        ok: false,
        erreur: `Cette régénération rendrait le parcours incohérent : ${erreursValidation[0]}`,
        statutHttp: 422,
      };
    }
    return {
      ok: true,
      parcours: regenere,
      description: 'Parcours régénéré intégralement',
      elementsRegeneres: [],
    };
  } catch (erreur) {
    return { ok: false, ...echecDepuisErreur(erreur) };
  }
}

async function appliquerDemandeSurElement(
  copie: Parcours,
  modification: DemandeSurElementClient,
  contexte: ContexteRegeneration
) {
  if (estDemandeModificationHotelClient(modification)) {
    return appliquerModificationHotel(copie, modification, contexte);
  }
  if (estDemandeModificationTransportClient(modification)) {
    return appliquerModificationTransport(copie, modification, contexte);
  }
  return appliquerModification(
    copie,
    preparerDemandeSurElementClient(modification, contexte.creerId ?? randomUUID),
    contexte
  );
}
