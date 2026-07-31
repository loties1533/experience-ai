import { z } from 'zod';
import {
  AvisSchema,
  DemandeTransportParcoursSchema,
  ElementSchema,
  OccupationHebergementDeclareeSchema,
  ParticipantSchema,
  PlageHoraireSchema,
  SejourHebergementSchema,
  StatutElementSchema,
  TypeElementSchema,
  VisibiliteSchema,
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

/**
 * Frontière HTTP : une proposition client décrit une intention éditoriale,
 * jamais un élément persistant complet. Les preuves, identifiants externes,
 * liens, statuts de confiance et dérivés restent donc impossibles à exprimer.
 *
 * L'hébergement et le transport sont volontairement exclus de ce chemin
 * générique : leur identité doit passer par un contrat dédié — `remplacer_hotel`
 * (Foursquare) pour l'hébergement, `modifier_demande_transport` (F4-E) pour le
 * transport — plutôt que par un libellé libre que le client pourrait forger.
 * Sans cette exclusion, un `ajouter_element`/`remplacer_element` de type
 * `transport` pourrait désynchroniser la correspondance positionnelle entre
 * tronçons de la demande et éléments transport de la timeline, sur laquelle
 * `modifier_demande_transport` s'appuie.
 */
export const PropositionElementClientSchema = z
  .object({
    type: TypeElementSchema.exclude(['hebergement', 'transport']),
    nom: z.string().trim().min(1).max(200),
    lieu: z.string().trim().min(1).max(300).optional(),
    plage: PlageHoraireSchema.strict().optional(),
    prix: z.number().nonnegative().optional(),
    justification: z.string().trim().min(1).max(1000),
  })
  .strict();

export const DemandeModificationHotelClientSchema = z.discriminatedUnion(
  'type',
  [
    z
      .object({
        type: z.literal('modifier_sejour_hebergement'),
        elementId: z.string().min(1),
        sejour: SejourHebergementSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal('modifier_occupation_hebergement'),
        occupation: OccupationHebergementDeclareeSchema,
      })
      .strict(),
    z
      .object({
        type: z.literal('remplacer_hotel'),
        elementId: z.string().min(1),
        villeDemandee: z.string().trim().min(1).max(120),
        requete: z.string().trim().min(1).max(200),
        sejour: SejourHebergementSchema.optional(),
      })
      .strict()
      .superRefine((demande, contexte) => {
        if (
          demande.sejour &&
          demande.sejour.ville.localeCompare(
            demande.villeDemandee,
            'fr',
            { sensitivity: 'base' }
          ) !== 0
        ) {
          contexte.addIssue({
            code: 'custom',
            path: ['sejour', 'ville'],
            message:
              'la ville du séjour doit correspondre à la ville demandée',
          });
        }
      }),
  ]
);

/**
 * Frontière HTTP transport : le client ne peut décrire qu'une intention de
 * trajet — villes, dates civiles, modes souhaités et occupation déclarée. Le
 * schéma persistant refuse déjà toute gare, aéroport, terminal ou code
 * fournisseur (villes prudentes uniquement) : aucune identité IATA ou UIC ne
 * peut donc être forgée côté client. La reconstruction des liens reste au
 * serveur, via la résolution prudente Amadeus/Navitia (F4-D2).
 */
export const DemandeModificationTransportClientSchema = z
  .object({
    type: z.literal('modifier_demande_transport'),
    demandeTransport: DemandeTransportParcoursSchema,
  })
  .strict();

const DemandeSurElementClientPureSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('remplacer_element'),
      elementId: z.string().min(1),
      remplacement: PropositionElementClientSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('supprimer_element'),
      elementId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('ajouter_element'),
      momentId: z.string().min(1),
      element: PropositionElementClientSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('modifier_justification'),
      elementId: z.string().min(1),
      justification: z.string().trim().min(1).max(1000),
    })
    .strict(),
  z
    .object({
      type: z.literal('changer_statut'),
      elementId: z.string().min(1),
      statut: StatutElementSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('ecarter_alternative'),
      elementId: z.string().min(1),
      alternativeId: z.string().min(1),
    })
    .strict(),
]);

/** Contrat public strict de la route de modification. */
export const DemandeSurElementClientSchema = z.discriminatedUnion('type', [
  ...DemandeSurElementClientPureSchema.options,
  ...DemandeModificationHotelClientSchema.options,
  DemandeModificationTransportClientSchema,
]);

// Un remplacement ne porte pas d'id : il hérite de celui de l'élément remplacé.
const RemplacementSchema = ElementSchema.omit({ id: true });

/** Les demandes qui portent sur le CONTENU du parcours, élément par élément. */
export const DemandeSurElementSchema = z.discriminatedUnion('type', [
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
    type: z.literal('modifier_justification'),
    elementId: z.string().min(1),
    justification: z.string().trim().min(1).max(1000),
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

/**
 * Les demandes qui portent sur le GROUPE : qui en fait partie, ce qu'il voit,
 * ce qu'il en pense. Séparées des précédentes parce qu'elles ne s'interprètent
 * pas : partager est un geste délibéré, pas une phrase que l'IA traduit —
 * l'agent Modification ne connaît donc que `DemandeSurElementSchema`.
 * Elles passent en revanche par la MÊME porte d'application (le domaine reste
 * seule autorité, y compris sur qui a le droit de partager).
 */
export const DemandeDePartageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ajouter_participant'),
    participant: ParticipantSchema,
  }),
  z.object({
    type: z.literal('retirer_participant'),
    participantId: z.string().min(1),
  }),
  z.object({
    type: z.literal('changer_visibilite'),
    visibilite: VisibiliteSchema,
  }),
  z.object({
    type: z.literal('reagir_element'),
    elementId: z.string().min(1),
    avis: AvisSchema,
  }),
]);

export const DemandeModificationSchema = z.discriminatedUnion('type', [
  ...DemandeSurElementSchema.options,
  ...DemandeDePartageSchema.options,
]);

export type DemandeSurElement = z.infer<typeof DemandeSurElementSchema>;
export type DemandeSurElementClient = z.infer<
  typeof DemandeSurElementClientSchema
>;
export type DemandeModificationHotelClient = z.infer<
  typeof DemandeModificationHotelClientSchema
>;
export type DemandeModificationTransportClient = z.infer<
  typeof DemandeModificationTransportClientSchema
>;
export type DemandeDePartage = z.infer<typeof DemandeDePartageSchema>;
export type DemandeModification = z.infer<typeof DemandeModificationSchema>;

export function estDemandeModificationHotelClient(
  demande: DemandeSurElementClient
): demande is DemandeModificationHotelClient {
  return (
    demande.type === 'modifier_sejour_hebergement' ||
    demande.type === 'modifier_occupation_hebergement' ||
    demande.type === 'remplacer_hotel'
  );
}

export function estDemandeModificationTransportClient(
  demande: DemandeSurElementClient
): demande is DemandeModificationTransportClient {
  return demande.type === 'modifier_demande_transport';
}

/**
 * Transforme l'intention client déjà validée en commande interne. C'est ici,
 * côté serveur, que l'id d'un ajout et les valeurs de confiance minimales sont
 * attribués. Aucun champ de preuve ne provient de la charge HTTP.
 */
export function preparerDemandeSurElementClient(
  demande: Exclude<
    DemandeSurElementClient,
    DemandeModificationHotelClient | DemandeModificationTransportClient
  >,
  creerId: () => string
): DemandeSurElement {
  switch (demande.type) {
    case 'ajouter_element': {
      const proposition = demande.element;
      return {
        ...demande,
        element: ElementSchema.parse({
          id: creerId(),
          ...proposition,
          confiance: { niveau: 'suggestion' },
          prixEstime: proposition.prix !== undefined,
        }),
      };
    }
    case 'remplacer_element': {
      const proposition = demande.remplacement;
      const element = ElementSchema.parse({
        id: 'remplacement-interne',
        ...proposition,
        confiance: { niveau: 'suggestion' },
        prixEstime: proposition.prix !== undefined,
      });
      const { id: _id, ...remplacement } = element;
      return { ...demande, remplacement };
    }
    default:
      return demande;
  }
}

/**
 * Invariant 8 : chaque demande relève d'une responsabilité métier (doc 06).
 * Le Record est exhaustif — une nouvelle demande ne compile pas tant qu'on n'a
 * pas dit de quelle responsabilité elle relève.
 */
const ACTION_PAR_DEMANDE: Record<DemandeModification['type'], ActionParcours> = {
  ajouter_element: 'proposer',
  remplacer_element: 'ajuster',
  modifier_justification: 'ajuster',
  changer_statut: 'ajuster',
  supprimer_element: 'supprimer',
  ecarter_alternative: 'arbitrer',
  ajouter_participant: 'convier',
  retirer_participant: 'convier',
  changer_visibilite: 'convier',
  reagir_element: 'reagir',
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
  | { ok: false; erreur: string; statutHttp?: 403 | 404 | 422 };

function trouverElement(parcours: Parcours, elementId: string): Element | undefined {
  return parcours.timeline.flatMap((m) => m.elements).find((e) => e.id === elementId);
}

function avecHistorique(parcours: Parcours, description: string, horodatage: string, elementId?: string): Parcours {
  return {
    ...parcours,
    historique: [...parcours.historique, { date: horodatage, description, elementId }],
  };
}

function retirerOccupationSansHebergement(parcours: Parcours): Parcours {
  const contientHebergement = parcours.timeline.some((moment) =>
    moment.elements.some((element) => element.type === 'hebergement')
  );
  if (contientHebergement) return parcours;
  const { occupationHebergement: _occupation, ...contexte } =
    parcours.contexte;
  return { ...parcours, contexte };
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
  if (refus) return { ok: false, erreur: refus, statutHttp: 403 };

  switch (demande.type) {
    case 'remplacer_element': {
      const cible = trouverElement(parcours, demande.elementId);
      if (!cible) {
        return {
          ok: false,
          erreur: `Aucun élément « ${demande.elementId} » dans ce parcours`,
          statutHttp: 404,
        };
      }

      // Le remplaçant hérite du prix de l'élément remplacé quand il n'en porte
      // pas : sinon le budget du parcours devient silencieusement faux dès
      // qu'une modification passe (l'élément vaut « — » au lieu de son coût).
      // Un prix explicitement proposé fait toujours foi.
      const remplacant: Element = {
        ...demande.remplacement,
        id: cible.id,
        prix: demande.remplacement.prix ?? cible.prix,
        prixEstime:
          demande.remplacement.type === 'transport'
            ? (demande.remplacement.prix ?? cible.prix) !== undefined
            : demande.remplacement.prixEstime,
        alternatives: reporterArbitrages(cible, demande.remplacement.alternatives),
      };
      const nouveau = retirerOccupationSansHebergement({
        ...parcours,
        timeline: parcours.timeline.map((moment) => ({
          ...moment,
          elements: moment.elements.map((e) => (e.id === cible.id ? remplacant : e)),
        })),
      });
      return valider(nouveau, {
        description: `« ${cible.nom} » remplacé par « ${remplacant.nom} »`,
        elementsARegenerer: elementsDependants(nouveau, cible.id),
        horodatage,
        elementId: cible.id,
      });
    }

    case 'supprimer_element': {
      const cible = trouverElement(parcours, demande.elementId);
      if (!cible) {
        return {
          ok: false,
          erreur: `Aucun élément « ${demande.elementId} » dans ce parcours`,
          statutHttp: 404,
        };
      }

      // Les dépendants perdent leur dépendance et passent en régénération.
      const aRegenerer = elementsDependants(parcours, cible.id);
      const nouveau = retirerOccupationSansHebergement({
        ...parcours,
        timeline: parcours.timeline.map((moment) => ({
          ...moment,
          elements: moment.elements
            .filter((e) => e.id !== cible.id)
            .map((e) => ({ ...e, dependDe: e.dependDe.filter((id) => id !== cible.id) })),
        })),
      });
      return valider(nouveau, {
        description: `« ${cible.nom} » supprimé du parcours`,
        elementsARegenerer: aRegenerer,
        horodatage,
        elementId: cible.id,
      });
    }

    case 'ajouter_element': {
      const moment = parcours.timeline.find((m) => m.id === demande.momentId);
      if (!moment) {
        return {
          ok: false,
          erreur: `Aucun moment « ${demande.momentId} » dans ce parcours`,
          statutHttp: 404,
        };
      }
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

    case 'modifier_justification': {
      const cible = trouverElement(parcours, demande.elementId);
      if (!cible) {
        return {
          ok: false,
          erreur: `Aucun élément « ${demande.elementId} » dans ce parcours`,
          statutHttp: 404,
        };
      }
      const nouveau: Parcours = {
        ...parcours,
        timeline: parcours.timeline.map((moment) => ({
          ...moment,
          elements: moment.elements.map((element) =>
            element.id === cible.id
              ? { ...element, justification: demande.justification }
              : element
          ),
        })),
      };
      return valider(nouveau, {
        description: `Justification de « ${cible.nom} » mise à jour`,
        elementsARegenerer: [],
        horodatage,
        elementId: cible.id,
      });
    }

    case 'changer_statut': {
      const cible = trouverElement(parcours, demande.elementId);
      if (!cible) {
        return {
          ok: false,
          erreur: `Aucun élément « ${demande.elementId} » dans ce parcours`,
          statutHttp: 404,
        };
      }

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
      if (!cible) {
        return {
          ok: false,
          erreur: `Aucun élément « ${demande.elementId} » dans ce parcours`,
          statutHttp: 404,
        };
      }

      const option = cible.alternatives.find((a) => a.id === demande.alternativeId);
      if (!option) {
        return {
          ok: false,
          erreur: `Aucune option « ${demande.alternativeId} » pour « ${cible.nom} »`,
          statutHttp: 404,
        };
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

    case 'ajouter_participant': {
      if (parcours.participants.some((p) => p.id === demande.participant.id)) {
        return { ok: false, erreur: `« ${demande.participant.nom} » fait déjà partie de ce parcours` };
      }
      const nouveau: Parcours = {
        ...parcours,
        participants: [...parcours.participants, demande.participant],
      };
      return valider(nouveau, {
        description: `« ${demande.participant.nom} » rejoint le parcours (${demande.participant.role})`,
        elementsARegenerer: [],
        horodatage,
      });
    }

    case 'retirer_participant': {
      const partant = parcours.participants.find((p) => p.id === demande.participantId);
      if (!partant) {
        return { ok: false, erreur: `Aucun participant « ${demande.participantId} » dans ce parcours` };
      }
      // L'organisateur est le responsable du parcours : le retirer laisserait
      // le parcours sans personne pour décider (et casserait la surprise, qui
      // en exige un). Pour changer d'organisateur, il faudra un transfert.
      if (partant.role === 'organisateur') {
        return { ok: false, erreur: `« ${partant.nom} » organise ce parcours : il n'en sort pas` };
      }
      const nouveau: Parcours = {
        ...parcours,
        participants: parcours.participants.filter((p) => p.id !== partant.id),
        // Ses avis partent avec lui : un avis sans auteur dans le parcours ne
        // veut plus rien dire, et l'organisateur ne doit pas trancher dessus.
        timeline: parcours.timeline.map((moment) => ({
          ...moment,
          elements: moment.elements.map((e) => ({
            ...e,
            reactions: e.reactions.filter((r) => r.participantId !== partant.id),
          })),
        })),
      };
      return valider(nouveau, {
        description: `« ${partant.nom} » ne fait plus partie du parcours`,
        elementsARegenerer: [],
        horodatage,
      });
    }

    case 'changer_visibilite': {
      if (parcours.visibilite === demande.visibilite) {
        return { ok: false, erreur: `Ce parcours est déjà ${ETAT_VISIBILITE[demande.visibilite]}` };
      }
      const nouveau: Parcours = { ...parcours, visibilite: demande.visibilite };
      return valider(nouveau, {
        description: BASCULE_VISIBILITE[demande.visibilite],
        elementsARegenerer: [],
        horodatage,
      });
    }

    case 'reagir_element': {
      const cible = trouverElement(parcours, demande.elementId);
      if (!cible) {
        return {
          ok: false,
          erreur: `Aucun élément « ${demande.elementId} » dans ce parcours`,
          statutHttp: 404,
        };
      }

      // Changer d'avis remplace le précédent : on veut l'état du groupe, pas
      // l'historique de ses hésitations.
      const reactions = [
        ...cible.reactions.filter((r) => r.participantId !== auteurId),
        { participantId: auteurId, avis: demande.avis, le: horodatage },
      ];
      const nouveau: Parcours = {
        ...parcours,
        timeline: parcours.timeline.map((moment) => ({
          ...moment,
          elements: moment.elements.map((e) => (e.id === cible.id ? { ...e, reactions } : e)),
        })),
      };
      const nom = parcours.participants.find((p) => p.id === auteurId)?.nom ?? 'Un participant';
      return valider(nouveau, {
        description: `${nom} est ${demande.avis} « ${cible.nom} »`,
        elementsARegenerer: [],
        horodatage,
        elementId: cible.id,
        journaliser: false,
      });
    }
  }
}

const ETAT_VISIBILITE = {
  prive: 'privé',
  partage: 'partagé',
  surprise: 'une surprise',
} as const;

const BASCULE_VISIBILITE = {
  prive: 'Parcours repassé en privé — les liens de partage ne valent plus rien',
  partage: 'Parcours partagé au groupe',
  surprise: 'Parcours passé en surprise — son héros n\'y a plus accès',
} as const;

function valider(
  nouveau: Parcours,
  args: {
    description: string;
    elementsARegenerer: string[];
    horodatage: string;
    elementId?: string;
    /**
     * L'Historique est le journal des modifications du parcours (il fonde
     * l'annulation, prévue V2). Un avis n'en modifie pas le contenu : il vit
     * sur l'élément et ne s'y inscrit pas, sinon le journal devient un fil de
     * discussion et l'annulation n'a plus de sens.
     */
    journaliser?: boolean;
  }
): ResultatModification {
  const erreurs = validerParcours(nouveau);
  if (erreurs.length > 0) {
    return { ok: false, erreur: `Cette modification rendrait le parcours incohérent : ${erreurs[0]}` };
  }
  return {
    ok: true,
    parcours:
      args.journaliser === false
        ? nouveau
        : avecHistorique(nouveau, args.description, args.horodatage, args.elementId),
    elementsARegenerer: args.elementsARegenerer,
    description: args.description,
  };
}
