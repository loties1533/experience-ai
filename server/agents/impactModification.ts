import {
  elementsDependants,
  type DemandeSurElementClient,
  type Element,
  type Parcours,
} from '../domaine/parcours/index.js';
import type { Brief } from './brief.js';

// F8-A — le contrat de dépendances (invariant 3) qui précède toute
// modification ciblée : dire CE QUI doit être régénéré avant de le faire.
// Logique pure et immuable, sans appel réseau ni IA — testable seule.
//
// N'invente pas de catégorie : réutilise le vocabulaire de modification déjà
// validé (`DemandeSurElementClient`, qui couvre déjà élément, hébergement et
// transport) et n'ajoute que ce qu'aucune route ne sait exprimer aujourd'hui —
// dates, durée, composition du groupe, destination. Ces quatre changements
// n'ont aucune mutation associée dans ce lot : le contrat dit seulement leur
// impact, en préparation de F8-B/C.

/**
 * Changements de CONTEXTE sans mutation existante à ce jour (aucune route,
 * aucun agent ne sait aujourd'hui les appliquer) : le contrat d'impact les
 * couvre par anticipation du produit (doc 06), pas par un mécanisme déjà
 * câblé.
 */
export type ChangementContexteParcours =
  | { type: 'changer_dates' }
  | { type: 'changer_duree' }
  | { type: 'changer_composition' }
  | { type: 'changer_destination' };

export type ChangementParcours = DemandeSurElementClient | ChangementContexteParcours;

export interface ImpactModification {
  /**
   * Portée ciblée (invariant 3) : ids des DÉPENDANTS existants à régénérer.
   * N'inclut jamais la cible elle-même de la modification (élément remplacé,
   * supprimé, ou hôtel dont le séjour change) — celle-ci est produite
   * directement par l'opération, exactement comme `appliquerModification`
   * le fait déjà aujourd'hui pour `remplacer_element`/`supprimer_element`.
   */
  elementsARegenerer: string[];
  /**
   * Le changement dépasse tout recalcul ciblé connu : aucune dépendance
   * partielle fiable n'existe pour lui aujourd'hui, la seule portée sûre est
   * le parcours entier.
   */
  regenererIntegralement: boolean;
  invaliderHebergement: boolean;
  invaliderTransport: boolean;
  invaliderBudget: boolean;
  /** Pourquoi cette portée a été retenue — affichable tel quel. */
  motif: string;
}

const IMPACT_NEUTRE: ImpactModification = {
  elementsARegenerer: [],
  regenererIntegralement: false,
  invaliderHebergement: false,
  invaliderTransport: false,
  invaliderBudget: false,
  motif: 'Aucun changement fourni',
};

function tousLesElements(parcours: Parcours): Element[] {
  return parcours.timeline.flatMap((moment) => moment.elements);
}

function impactSansDependance(motif: string): ImpactModification {
  return { ...IMPACT_NEUTRE, motif };
}

function impactIntegral(motif: string): ImpactModification {
  return {
    elementsARegenerer: [],
    regenererIntegralement: true,
    invaliderHebergement: true,
    invaliderTransport: true,
    invaliderBudget: true,
    motif,
  };
}

/**
 * Portée d'un changement rattaché à un élément EXISTANT précis (remplacer,
 * supprimer, remplacer_hotel, modifier_sejour_hebergement…) : ses dépendants
 * directs et par ricochet (invariant 3, `elementsDependants`), déjà le
 * mécanisme qu'`appliquerModification` utilise pour ce même calcul.
 */
function impactElementExistant(
  parcours: Parcours,
  elementId: string,
  invaliderBudget: boolean,
  motif: string
): ImpactModification {
  const elements = tousLesElements(parcours);
  const cible = elements.find((e) => e.id === elementId);
  const dependants = elementsDependants(parcours, elementId);
  const typesConcernes = new Set(
    [cible?.type, ...dependants.map((id) => elements.find((e) => e.id === id)?.type)].filter(
      (type): type is Element['type'] => type !== undefined
    )
  );
  return {
    elementsARegenerer: dependants,
    regenererIntegralement: false,
    invaliderHebergement: typesConcernes.has('hebergement'),
    invaliderTransport: typesConcernes.has('transport'),
    invaliderBudget,
    motif,
  };
}

/**
 * Impact d'un changement qui porte sur TOUS les éléments d'un type donné
 * (occupation hôtelière déclarée, demande de transport) : union des
 * dépendants de chacun — le mécanisme ciblé reste le même, juste appliqué à
 * plusieurs points d'entrée à la fois.
 */
function impactParType(
  parcours: Parcours,
  type: Element['type'],
  args: { invaliderHebergement: boolean; invaliderTransport: boolean; invaliderBudget: boolean; motif: string }
): ImpactModification {
  const idsConcernes = tousLesElements(parcours)
    .filter((e) => e.type === type)
    .map((e) => e.id);
  const dependants = new Set<string>();
  for (const id of idsConcernes) {
    for (const dependantId of elementsDependants(parcours, id)) {
      dependants.add(dependantId);
    }
  }
  return {
    elementsARegenerer: [...dependants],
    regenererIntegralement: false,
    invaliderHebergement: args.invaliderHebergement,
    invaliderTransport: args.invaliderTransport,
    invaliderBudget: args.invaliderBudget,
    motif: args.motif,
  };
}

/**
 * Détermine ce qu'un changement impacte, sans rien modifier, sans appel
 * réseau ni IA. `brief` n'apporte aujourd'hui aucune information que
 * `parcours.contexte` ne porte déjà — il n'est ni lu ni persisté avec le
 * parcours une fois généré — et reste accepté sans être utilisé, pour le jour
 * où un champ que seul le brief porte (ex. les contraintes libres) devra
 * peser sur l'impact.
 */
export function determinerImpactModification(
  modification: ChangementParcours,
  parcours: Parcours,
  brief?: Brief
): ImpactModification {
  void brief;

  switch (modification.type) {
    case 'modifier_occupation_hebergement':
      return impactParType(parcours, 'hebergement', {
        invaliderHebergement: true,
        invaliderTransport: false,
        // L'occupation ne fait que reconstruire le lien de recherche
        // (`appliquerModificationHotel`) ; elle ne touche aucun prix.
        invaliderBudget: false,
        motif: "l'occupation hôtelière déclarée reconstruit le lien de recherche de chaque hébergement",
      });

    case 'remplacer_hotel':
    case 'modifier_sejour_hebergement':
      // `elementHotelRemplace`/`reconstruireLien` (modificationHotel.ts)
      // recopient TOUJOURS `cible.prix` tel quel — aucun champ prix n'existe
      // même côté client pour ces deux types : le budget ne peut pas changer
      // ici, seul le lien de recherche est reconstruit.
      return impactElementExistant(
        parcours,
        modification.elementId,
        false,
        'un séjour ou un hôtel remplacé reconstruit son lien de recherche ; son prix reste inchangé'
      );

    case 'modifier_demande_transport':
      return impactParType(parcours, 'transport', {
        invaliderHebergement: false,
        invaliderTransport: true,
        // `appliquerModificationTransport` redérive libellé et justification
        // sans jamais toucher au prix (toujours absent d'un transport suggéré).
        invaliderBudget: false,
        motif: 'la demande de transport redérive chaque élément transport et son lien de recherche',
      });
    case 'remplacer_element':
      return impactElementExistant(
        parcours,
        modification.elementId,
        true,
        'un élément remplacé peut changer de prix ; ses dépendants doivent être revus'
      );

    case 'supprimer_element':
      return impactElementExistant(
        parcours,
        modification.elementId,
        true,
        'un élément supprimé retire son prix du budget ; ses dépendants perdent leur dépendance'
      );

    case 'ajouter_element':
      // Un ajout ne dépend de rien d'existant et rien n'existant ne dépend de
      // lui (invariant 3) : aucun autre élément n'est marqué à régénérer.
      return {
        ...IMPACT_NEUTRE,
        invaliderBudget: true,
        motif: 'un élément ajouté peut porter un prix qui doit entrer dans le budget',
      };

    case 'modifier_justification':
    case 'changer_statut':
    case 'ecarter_alternative':
      // Ni le prix ni les dépendances ne changent (comportement déjà en
      // place dans `appliquerModification`, qui rend `elementsARegenerer: []`
      // pour ces trois cas).
      return impactSansDependance(
        "ce changement ne touche ni le prix ni les dépendances d'aucun élément"
      );

    case 'changer_dates':
      // Toutes les plages (moments et éléments) sont bornées par les dates du
      // parcours (`validerParcours`) : aucune dépendance ciblée ne peut
      // couvrir ça, l'impact certain est le parcours entier.
      return impactIntegral(
        'les dates bornent toutes les plages du parcours ; aucun recalcul ciblé ne peut le garantir'
      );

    case 'changer_duree':
      // Doc 06 / schema.ts : quand des dates réelles existent, ce sont ELLES
      // qui font foi pour la génération et les invariants du domaine
      // (`deriverPlan`, `validerParcours`) — la durée voulue ne les recalcule
      // jamais et ne déclenche donc aucune régénération ni invalidation.
      // Elle reste néanmoins affichée telle quelle à côté des dates
      // (`ParcoursDetail.tsx`, `ParcoursPartage.tsx`) : « aucun impact » porte
      // ici uniquement sur la régénération, pas sur la mise à jour directe du
      // champ par la modification elle-même. Sans dates, rien ne borne
      // aujourd'hui un changement de durée : dépendance non modélisée, impact
      // prudent et documenté (jamais deviné).
      return parcours.contexte.dates
        ? impactSansDependance(
            'les dates du parcours font foi pour la génération et les invariants ; la durée voulue ne les recalcule jamais et ne déclenche aucune régénération (elle reste seulement affichée)'
          )
        : impactIntegral(
            "sans dates, aucune dépendance n'est modélisée pour la durée voulue : impact prudent, à documenter"
          );

    case 'changer_composition':
      // `avecQui` oriente le ton de CHAQUE élément généré (system prompt de
      // `genererParcours`) sans qu'aucune dépendance ne relie un élément
      // particulier à ce champ : impact prudent, pas déduit au hasard.
      return impactIntegral(
        "la composition du groupe oriente l'ensemble des suggestions ; aucun recalcul ciblé n'est modélisé"
      );

    case 'changer_destination':
      // Chaque moment est rattaché à une ville du brief (génération par lot
      // ville × jours) ; aucune dépendance ne relie un élément à une ville en
      // particulier une fois le parcours assemblé : impact prudent.
      return impactIntegral(
        'chaque moment est rattaché à une ville du parcours ; aucune dépendance ciblée ne survit à un changement de destination'
      );

    default: {
      const exhaustif: never = modification;
      return exhaustif;
    }
  }
}

/**
 * Fusionne plusieurs impacts en un seul (union des régénérations, OR des
 * invalidations) — pour le cas de plusieurs changements simultanés, sans que
 * `determinerImpactModification` ait besoin de connaître la notion de lot.
 *
 * Dès qu'un seul impact est intégral, la liste ciblée de la fusion reste
 * TOUJOURS vide (même si d'autres impacts combinés en portaient une) : un
 * `regenererIntegralement: true` doit se suffire à lui-même, jamais laisser
 * croire qu'une liste partielle resterait pertinente à côté de lui.
 */
export function combinerImpacts(impacts: ImpactModification[]): ImpactModification {
  const fusion = impacts.reduce<ImpactModification>(
    (acc, impact) => ({
      elementsARegenerer: [
        ...new Set([...acc.elementsARegenerer, ...impact.elementsARegenerer]),
      ],
      regenererIntegralement: acc.regenererIntegralement || impact.regenererIntegralement,
      invaliderHebergement: acc.invaliderHebergement || impact.invaliderHebergement,
      invaliderTransport: acc.invaliderTransport || impact.invaliderTransport,
      invaliderBudget: acc.invaliderBudget || impact.invaliderBudget,
      motif: [...new Set([acc.motif, impact.motif].filter((m) => m.length > 0))].join(' — '),
    }),
    { ...IMPACT_NEUTRE, motif: '' }
  );
  return fusion.regenererIntegralement ? { ...fusion, elementsARegenerer: [] } : fusion;
}
