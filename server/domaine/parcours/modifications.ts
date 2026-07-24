import { z } from 'zod';
import {
  ElementSchema,
  StatutElementSchema,
  type Alternative,
  type Element,
  type Parcours,
} from './schema.js';
import {
  elementsDependants,
  validerParcours,
  verifierResponsabilite,
  type ActionParcours,
} from './invariants.js';

// Le cœur du produit (invariant 3 + ADR-0004) : modifier un élément sans tout
// refaire. Logique pure et immuable — le parcours d'origine n'est jamais touché.
//
// Pensé pour le front : le résultat dit exactement quoi rafraîchir
// (elementsARegenerer), l'adressage reste stable (un remplacement garde l'id
// de l'élément remplacé) et chaque description est affichable telle quelle.
//
// Toute demande est signée : le rôle de son auteur doit la couvrir (invariant 8).

// Un remplacement ne porte pas d'id : il hérite de celui de l'élément remplacé.
const RemplacementSchema = ElementSchema.omit({ id: true });

export const DemandeModificationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('remplacer_element'),
    elementId: z.string().min(1),
    remplacement: RemplacementSchema,
  }),
  z.object({
    type: z.literal('supprimer_element'),
    elementId: z.string().min(1),
  }),
  z.object({
    type: z.literal('ajouter_element'),
    momentId: z.string().min(1),
    element: ElementSchema,
  }),
  z.object({
    type: z.literal('changer_statut'),
    elementId: z.string().min(1),
    statut: StatutElementSchema,
  }),
  z.object({
    type: z.literal('ecarter_alternative'),
    elementId: z.string().min(1),
    alternativeId: z.string().min(1),
  }),
]);

export type DemandeModification = z.infer<typeof DemandeModificationSchema>;

/**
 * Invariant 8 : chaque demande relève d'une responsabilité métier (doc 06).
 * Le Record est exhaustif — une nouvelle demande ne compile pas tant qu'on n'a
 * pas dit de quelle responsabilité elle relève.
 */
const ACTION_PAR_DEMANDE: Record<DemandeModification['type'], ActionParcours> = {
  ajouter_element: 'proposer',
  remplacer_element: 'ajuster',
  changer_statut: 'ajuster',
  supprimer_element: 'supprimer',
  ecarter_alternative: 'arbitrer',
};

/** Qui modifie, et quand. L'auteur est un participant du parcours (invariant 8). */
export interface ContexteModification {
  auteurId: string;
  horodatage: string;
}

export type ResultatModification =
  | {
      ok: true;
      parcours: Parcours;
      /** Les dépendants (directs et par ricochet) que l'IA devra régénérer. */
      elementsARegenerer: string[];
      /** Phrase affichable telle quelle (toast front + historique). */
      description: string;
    }
  | { ok: false; erreur: string };

function trouverElement(parcours: Parcours, elementId: string): Element | undefined {
  return parcours.timeline.flatMap((m) => m.elements).find((e) => e.id === elementId);
}

function avecHistorique(parcours: Parcours, description: string, horodatage: string, elementId?: string): Parcours {
  return {
    ...parcours,
    historique: [...parcours.historique, { date: horodatage, description, elementId }],
  };
}

/**
 * Les arbitrages déjà rendus sur un élément survivent à son remplacement
 * (invariant 7) : une option écartée ne redevient pas proposable par la bande,
 * et celles que le remplaçant ne mentionne plus restent mémorisées.
 */
function reporterArbitrages(remplace: Element, alternatives: Alternative[]): Alternative[] {
  const ecartees = remplace.alternatives.filter((a) => a.ecartee);
  const idsEcartes = new Set(ecartees.map((a) => a.id));
  const reprises = alternatives.map((a) => (idsEcartes.has(a.id) ? { ...a, ecartee: true } : a));
  const idsRepris = new Set(reprises.map((a) => a.id));
  return [...reprises, ...ecartees.filter((a) => !idsRepris.has(a.id))];
}

/**
 * Applique une demande déjà validée par DemandeModificationSchema, au nom d'un
 * auteur dont le rôle doit l'autoriser (invariant 8).
 * Rend un nouveau parcours (jamais de mutation) ou une erreur affichable.
 */
export function appliquerModification(
  parcours: Parcours,
  demande: DemandeModification,
  contexte: ContexteModification
): ResultatModification {
  const { auteurId, horodatage } = contexte;
  const refus = verifierResponsabilite(parcours, auteurId, ACTION_PAR_DEMANDE[demande.type]);
  if (refus) return { ok: false, erreur: refus };

  switch (demande.type) {
    case 'remplacer_element': {
      const cible = trouverElement(parcours, demande.elementId);
      if (!cible) return { ok: false, erreur: `Aucun élément « ${demande.elementId} » dans ce parcours` };

      // Le remplaçant hérite du prix de l'élément remplacé quand il n'en porte
      // pas : sinon le budget du parcours devient silencieusement faux dès
      // qu'une modification passe (l'élément vaut « — » au lieu de son coût).
      // Un prix explicitement proposé fait toujours foi.
      const remplacant: Element = {
        ...demande.remplacement,
        id: cible.id,
        prix: demande.remplacement.prix ?? cible.prix,
        alternatives: reporterArbitrages(cible, demande.remplacement.alternatives),
      };
      const nouveau: Parcours = {
        ...parcours,
        timeline: parcours.timeline.map((moment) => ({
          ...moment,
          elements: moment.elements.map((e) => (e.id === cible.id ? remplacant : e)),
        })),
      };
      return valider(nouveau, {
        description: `« ${cible.nom} » remplacé par « ${remplacant.nom} »`,
        elementsARegenerer: elementsDependants(nouveau, cible.id),
        horodatage,
        elementId: cible.id,
      });
    }

    case 'supprimer_element': {
      const cible = trouverElement(parcours, demande.elementId);
      if (!cible) return { ok: false, erreur: `Aucun élément « ${demande.elementId} » dans ce parcours` };

      // Les dépendants perdent leur dépendance et passent en régénération.
      const aRegenerer = elementsDependants(parcours, cible.id);
      const nouveau: Parcours = {
        ...parcours,
        timeline: parcours.timeline.map((moment) => ({
          ...moment,
          elements: moment.elements
            .filter((e) => e.id !== cible.id)
            .map((e) => ({ ...e, dependDe: e.dependDe.filter((id) => id !== cible.id) })),
        })),
      };
      return valider(nouveau, {
        description: `« ${cible.nom} » supprimé du parcours`,
        elementsARegenerer: aRegenerer,
        horodatage,
        elementId: cible.id,
      });
    }

    case 'ajouter_element': {
      const moment = parcours.timeline.find((m) => m.id === demande.momentId);
      if (!moment) return { ok: false, erreur: `Aucun moment « ${demande.momentId} » dans ce parcours` };
      if (trouverElement(parcours, demande.element.id)) {
        return { ok: false, erreur: `L'id « ${demande.element.id} » existe déjà dans ce parcours` };
      }

      const nouveau: Parcours = {
        ...parcours,
        timeline: parcours.timeline.map((m) =>
          m.id === moment.id ? { ...m, elements: [...m.elements, demande.element] } : m
        ),
      };
      return valider(nouveau, {
        description: `« ${demande.element.nom} » ajouté à « ${moment.titre} »`,
        elementsARegenerer: [],
        horodatage,
        elementId: demande.element.id,
      });
    }

    case 'changer_statut': {
      const cible = trouverElement(parcours, demande.elementId);
      if (!cible) return { ok: false, erreur: `Aucun élément « ${demande.elementId} » dans ce parcours` };

      const libelles = { propose: 'proposé', accepte: 'accepté', a_remplacer: 'à remplacer' } as const;
      const nouveau: Parcours = {
        ...parcours,
        timeline: parcours.timeline.map((moment) => ({
          ...moment,
          elements: moment.elements.map((e) =>
            e.id === cible.id ? { ...e, statut: demande.statut } : e
          ),
        })),
      };
      return valider(nouveau, {
        description: `« ${cible.nom} » marqué ${libelles[demande.statut]}`,
        elementsARegenerer: [],
        horodatage,
        elementId: cible.id,
      });
    }

    case 'ecarter_alternative': {
      const cible = trouverElement(parcours, demande.elementId);
      if (!cible) return { ok: false, erreur: `Aucun élément « ${demande.elementId} » dans ce parcours` };

      const option = cible.alternatives.find((a) => a.id === demande.alternativeId);
      if (!option) {
        return { ok: false, erreur: `Aucune option « ${demande.alternativeId} » pour « ${cible.nom} »` };
      }
      // Un arbitrage est définitif : le refaire n'a pas de sens, on le dit.
      if (option.ecartee) {
        return { ok: false, erreur: `« ${option.nom} » a déjà été écarté` };
      }

      const nouveau: Parcours = {
        ...parcours,
        timeline: parcours.timeline.map((moment) => ({
          ...moment,
          elements: moment.elements.map((e) =>
            e.id === cible.id
              ? {
                  ...e,
                  alternatives: e.alternatives.map((a) =>
                    a.id === option.id ? { ...a, ecartee: true } : a
                  ),
                }
              : e
          ),
        })),
      };
      return valider(nouveau, {
        description: `« ${option.nom} » écarté des options de « ${cible.nom} »`,
        elementsARegenerer: [],
        horodatage,
        elementId: cible.id,
      });
    }
  }
}

function valider(
  nouveau: Parcours,
  args: { description: string; elementsARegenerer: string[]; horodatage: string; elementId: string }
): ResultatModification {
  const erreurs = validerParcours(nouveau);
  if (erreurs.length > 0) {
    return { ok: false, erreur: `Cette modification rendrait le parcours incohérent : ${erreurs[0]}` };
  }
  return {
    ok: true,
    parcours: avecHistorique(nouveau, args.description, args.horodatage, args.elementId),
    elementsARegenerer: args.elementsARegenerer,
    description: args.description,
  };
}
