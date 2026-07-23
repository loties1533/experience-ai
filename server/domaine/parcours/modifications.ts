import { z } from 'zod';
import {
  ElementSchema,
  StatutElementSchema,
  type Element,
  type Parcours,
} from './schema.js';
import { elementsDependants, validerParcours } from './invariants.js';

// Le cœur du produit (invariant 3 + ADR-0004) : modifier un élément sans tout
// refaire. Logique pure et immuable — le parcours d'origine n'est jamais touché.
//
// Pensé pour le front : le résultat dit exactement quoi rafraîchir
// (elementsARegenerer), l'adressage reste stable (un remplacement garde l'id
// de l'élément remplacé) et chaque description est affichable telle quelle.

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
]);

export type DemandeModification = z.infer<typeof DemandeModificationSchema>;

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
 * Applique une demande déjà validée par DemandeModificationSchema.
 * Rend un nouveau parcours (jamais de mutation) ou une erreur affichable.
 */
export function appliquerModification(
  parcours: Parcours,
  demande: DemandeModification,
  horodatage: string
): ResultatModification {
  switch (demande.type) {
    case 'remplacer_element': {
      const cible = trouverElement(parcours, demande.elementId);
      if (!cible) return { ok: false, erreur: `Aucun élément « ${demande.elementId} » dans ce parcours` };

      const remplacant: Element = { ...demande.remplacement, id: cible.id };
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
