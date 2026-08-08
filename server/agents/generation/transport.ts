import {
  JUSTIFICATION_TRANSPORT_GENERIQUE,
  LIBELLE_TRANSPORT_GENERIQUE,
  justificationTransportDemande,
  libelleTransportDemande,
  type DemandeTransport,
} from '../../domaine/transport/index.js';
import type { MomentGenere } from './contratLLM.js';

// TRANSPORT DÉTERMINISTE : après l'assemblage des lots, le contenu transport
// écrit par le modèle est effacé et remplacé par des tronçons synthétisés à
// partir de la seule demande utilisateur. Aucun appel modèle, aucune boîte à
// outils, aucun réseau, aucune résolution fournisseur ici.

/**
 * Le prompt réduit les hallucinations ; cette frontière les rend inoffensives.
 *
 * Sans demande validée, un transport ajouté spontanément par le modèle
 * disparaît. Avec une demande validée, seuls le prix numérique (toujours
 * marqué estimé plus bas), les dépendances techniques et la référence locale
 * survivent. Toute phrase, identité, localisation ou heure vient du serveur et
 * de la demande utilisateur, jamais du modèle.
 *
 * Un moment mixte est séparé : les horaires légitimes de ses autres éléments
 * restent intacts, tandis que le transport rejoint un wrapper sans plage.
 */
function synthetiserTransport(
  troncon: DemandeTransport['troncons'][number],
  index: number
): MomentGenere {
  return {
    titre: libelleTransportDemande(troncon),
    elements: [
      {
        ref: `transport-troncon-${index}`,
        type: 'transport' as const,
        nom: libelleTransportDemande(troncon),
        justification: justificationTransportDemande(troncon),
        dependDe: [],
        estAncre: false,
      },
    ],
  };
}

export function nettoyerMomentsTransport(
  moments: MomentGenere[],
  demandeTransport: DemandeTransport | undefined
): MomentGenere[] {
  const troncons = demandeTransport?.troncons ?? [];
  let indexTroncon = 0;
  const nettoyes: MomentGenere[] = [];
  const refsTransport = new Set(
    moments.flatMap((moment) =>
      moment.elements
        .filter((element) => element.type === 'transport')
        .map((element) => element.ref)
    )
  );

  // Le LLM ne pose plus de placeholder de contenu, mais sa POSITION reste
  // une indication chronologique légitime (le transport Paris → Lyon doit
  // rester avant les moments lyonnais, pas relégué en fin de timeline). On
  // consomme donc les tronçons dans l'ordre, à l'endroit où le LLM a placé
  // ses éléments transport, en ne conservant du placeholder que sa place —
  // jamais son nom, son prix ou sa référence.
  for (const moment of moments) {
    const transitionGeneriqueServeur =
      !demandeTransport &&
      moment.elements.length === 1 &&
      moment.elements[0].ref.startsWith('__transition-generique-');
    if (transitionGeneriqueServeur) {
      nettoyes.push(moment);
      continue;
    }
    const autresElements = moment.elements
      .filter((element) => element.type !== 'transport')
      .map((element) => ({
        ...element,
        dependDe: element.dependDe.filter(
          (ref) => !refsTransport.has(ref)
        ),
      }));
    const nombreTransportsIci = moment.elements.filter(
      (element) => element.type === 'transport'
    ).length;

    if (autresElements.length > 0) {
      nettoyes.push({
        ...moment,
        // Dès qu'un wrapper contenait un transport, son titre libre peut
        // contenir un vol, une gare ou une heure. On le reconstruit depuis
        // les éléments non transport au lieu d'essayer de filtrer sa prose.
        titre:
          nombreTransportsIci > 0
            ? autresElements.length === 1
              ? autresElements[0].nom
              : 'Moment du parcours'
            : moment.titre,
        elements: autresElements,
      });
    }

    for (let i = 0; i < nombreTransportsIci; i += 1) {
      const troncon = troncons[indexTroncon];
      if (troncon) nettoyes.push(synthetiserTransport(troncon, indexTroncon));
      indexTroncon += 1;
    }
  }

  // Le LLM a émis moins de placeholders que de tronçons déclarés (voire
  // aucun) : les tronçons restants n'ont aucune position suggérée, on les
  // ajoute à la fin plutôt que de les faire disparaître silencieusement.
  while (indexTroncon < troncons.length) {
    nettoyes.push(synthetiserTransport(troncons[indexTroncon], indexTroncon));
    indexTroncon += 1;
  }

  return nettoyes;
}

/**
 * Un marqueur de position, sans contenu, injecté à chaque changement de ville
 * lors de l'assemblage. `nettoyerMomentsTransport` y consomme un tronçon dans
 * l'ordre, exactement comme un placeholder LLM : le transport reste ainsi entre
 * les villes, jamais relégué en fin de parcours. Son contenu est toujours
 * remplacé par le tronçon synthétisé, ou écarté s'il n'y a plus de tronçon.
 */
export function momentDeTransition(index: number): MomentGenere {
  return {
    titre: 'Transition',
    elements: [
      {
        ref: `__transition-${index}`,
        type: 'transport' as const,
        nom: 'Transition',
        justification: 'Transition entre deux villes du parcours.',
        dependDe: [],
        estAncre: false,
      },
    ],
  };
}

/**
 * Une ville découverte impose de signaler une transition, sans inventer de
 * tronçon, d'opérateur, d'horaire ou de réservation que l'utilisateur n'a pas
 * encore demandés.
 */
export function momentDeTransitionSansDemande(index: number): MomentGenere {
  return {
    titre: 'Transports à organiser',
    elements: [
      {
        ref: `__transition-generique-${index}`,
        type: 'transport' as const,
        nom: LIBELLE_TRANSPORT_GENERIQUE,
        justification: JUSTIFICATION_TRANSPORT_GENERIQUE,
        dependDe: [],
        estAncre: false,
      },
    ],
  };
}
