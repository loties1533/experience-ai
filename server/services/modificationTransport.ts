import {
  ParcoursSchema,
  validerParcours,
  verifierResponsabilite,
  type ContexteModification,
  type DemandeModificationTransportClient,
  type Element,
  type Parcours,
  type ResultatModification,
} from '../domaine/parcours/index.js';
import {
  justificationTransportDemande,
  libelleTransportDemande,
} from '../domaine/transport/index.js';
import { ajouterLiensRechercheTransport } from '../agents/enrichissementLiensTransport.js';

// F4-E — modifier honnêtement la demande de transport d'un parcours, puis
// reconstruire ses liens de recherche via la résolution prudente de F4-D2.
//
// Le client ne fournit qu'une intention (villes, dates civiles, modes souhaités
// et occupation déclarée), déjà verrouillée par `DemandeTransportParcours` :
// aucune gare, aéroport, terminal ni code fournisseur ne peut être forgé. La
// reconstruction des liens délègue entièrement à Amadeus/Navitia : toute
// résolution ambiguë, vide ou indisponible laisse l'élément transport sans
// lien, jamais une fausse promesse.

function erreur(
  message: string,
  statutHttp?: 403 | 404 | 422
): ResultatModification {
  return {
    ok: false,
    erreur: message,
    ...(statutHttp === undefined ? {} : { statutHttp }),
  };
}

function elementsTransport(parcours: Parcours): Element[] {
  return parcours.timeline
    .flatMap((moment) => moment.elements)
    .filter((element) => element.type === 'transport');
}

/**
 * Chaque élément transport de la timeline correspond, dans l'ordre, à un tronçon
 * de la demande. On réutilise ce contrat positionnel — le même que la génération
 * et l'enrichissement F4-D2 — pour redériver le libellé et la justification du
 * serveur, jamais du client, et retirer l'ancien lien avant reconstruction.
 */
function redigerElementsTransport(
  parcours: Parcours,
  demande: DemandeModificationTransportClient
): Parcours {
  let rangTransport = 0;
  return {
    ...parcours,
    contexte: {
      ...parcours.contexte,
      demandeTransport: demande.demandeTransport,
    },
    timeline: parcours.timeline.map((moment) => ({
      ...moment,
      elements: moment.elements.map((element) => {
        if (element.type !== 'transport') return element;
        const troncon = demande.demandeTransport.troncons[rangTransport];
        rangTransport += 1;
        const { lienRechercheTransport: _ancienLien, ...sansLien } = element;
        return {
          ...sansLien,
          nom: libelleTransportDemande(troncon),
          justification: justificationTransportDemande(troncon),
        };
      }),
    })),
  };
}

export async function appliquerModificationTransport(
  parcours: Parcours,
  demande: DemandeModificationTransportClient,
  contexte: ContexteModification
): Promise<ResultatModification> {
  const refus = verifierResponsabilite(
    parcours,
    contexte.auteurId,
    'ajuster'
  );
  if (refus) return erreur(refus, 403);

  if (!parcours.contexte.demandeTransport) {
    return erreur(
      'Aucune demande de transport à modifier dans ce parcours.',
      422
    );
  }

  const transports = elementsTransport(parcours);
  if (transports.length !== demande.demandeTransport.troncons.length) {
    return erreur(
      'Le nombre de trajets doit rester identique : ajouter ou retirer un transport passe par une autre modification.',
      422
    );
  }

  const redige = redigerElementsTransport(parcours, demande);
  // Reconstruit les liens uniquement là où les deux extrémités se résolvent en
  // une identité unique (F4-D2) ; ailleurs, absence prudente de lien.
  const avecLiens = await ajouterLiensRechercheTransport(
    redige,
    demande.demandeTransport
  );

  const avecHistorique: Parcours = {
    ...avecLiens,
    historique: [
      ...avecLiens.historique,
      {
        date: contexte.horodatage,
        description: 'Demande de transport mise à jour',
      },
    ],
  };

  const validation = ParcoursSchema.safeParse(avecHistorique);
  if (!validation.success) {
    return erreur(
      `Cette modification rendrait le parcours incohérent : ${validation.error.issues[0]?.message ?? 'contrat invalide'}`
    );
  }
  const erreurs = validerParcours(validation.data);
  if (erreurs.length > 0) {
    return erreur(
      `Cette modification rendrait le parcours incohérent : ${erreurs[0]}`
    );
  }

  return {
    ok: true,
    parcours: validation.data,
    elementsARegenerer: [],
    description: 'Demande de transport mise à jour',
  };
}
