import { describe, expect, it } from 'vitest';
import {
  BriefSchema,
  demandeTransportComplete,
  estParcoursMultiVille,
  prochainChampTransport,
} from '../../server/agents/brief.js';
import { nettoyerMomentsTransport } from '../../server/agents/generation.js';
import {
  DemandeSurElementClientSchema,
  ParcoursLectureSchema,
  ParcoursSchema,
  preparerDemandeSurElementClient,
  validerParcours,
  type Parcours,
} from '../../server/domaine/parcours/index.js';
import { estVilleTransportDemandeePrudente } from '../../server/domaine/transport/index.js';

const DEMANDE_TRANSPORT = {
  troncons: [
    {
      origine: { ville: 'Bordeaux' },
      destination: { ville: 'Paris' },
      depart: { date: '2026-09-10', creneau: 'matin' as const },
      modeSouhaite: 'train' as const,
    },
  ],
  occupation: {
    statut: 'declaree' as const,
    adultes: 2,
    enfants: 0,
  },
};

const BASE_BRIEF = {
  intention: 'relier Bordeaux et Paris',
  avecQui: 'amis' as const,
  duree: { valeur: 4, unite: 'jours' as const },
  lieux: [
    { nom: 'Bordeaux', type: 'ville' as const },
    { nom: 'Paris', type: 'ville' as const },
  ],
};

function parcoursTransport(): Parcours {
  return ParcoursSchema.parse({
    id: 'p-transport',
    intention: { texte: 'relier Bordeaux et Paris' },
    contexte: {
      avecQui: 'amis',
      duree: { valeur: 4, unite: 'jours' },
      lieux: ['Bordeaux', 'Paris'],
      demandeTransport: DEMANDE_TRANSPORT,
    },
    participants: [
      { id: 'u1', nom: 'Alexis', role: 'organisateur' },
    ],
    budget: { mode: 'individuel' },
    timeline: [
      {
        id: 'm-transport',
        titre: 'Transport à organiser de Bordeaux vers Paris',
        elements: [
          {
            id: 'e-transport',
            type: 'transport',
            nom: 'Transport à organiser de Bordeaux vers Paris',
            prix: 80,
            prixEstime: true,
            confiance: { niveau: 'suggestion' },
            justification:
              'Prévoir un transport entre Bordeaux et Paris selon les dates et préférences déclarées.',
            estAncre: false,
          },
        ],
      },
    ],
  });
}

describe('Brief transport actif F4-B2', () => {
  it('garde les anciens briefs et un transport absent valides', () => {
    expect(
      BriefSchema.safeParse({
        intention: 'une journée à Bordeaux',
        avecQui: 'solo',
        duree: { valeur: 1, unite: 'jours' },
        lieux: [{ nom: 'Bordeaux', type: 'ville' }],
      }).success
    ).toBe(true);
    expect(
      estParcoursMultiVille({
        lieux: [
          { nom: ' Paris ', type: 'ville' },
          { nom: 'paris', type: 'ville' },
        ],
      })
    ).toBe(false);
    expect(
      estParcoursMultiVille({
        lieux: [
          { nom: 'Alpes', type: 'zone' },
          { nom: 'France', type: 'pays', codePays: 'FR' },
        ],
      })
    ).toBe(false);
  });

  it('rend les deux branches strictes et exige le brouillon explicite', () => {
    expect(
      BriefSchema.safeParse({
        ...BASE_BRIEF,
        transport: {
          necessaire: false,
          troncons: [],
        },
      }).success
    ).toBe(false);
    expect(
      BriefSchema.safeParse({
        ...BASE_BRIEF,
        transport: { necessaire: true },
      }).success
    ).toBe(false);
    expect(
      BriefSchema.safeParse({
        ...BASE_BRIEF,
        transport: {
          necessaire: true,
          troncons: [],
          occupation: { statut: 'a_confirmer' },
        },
      }).success
    ).toBe(false);
  });

  it('refuse les injections profondément imbriquées au lieu de les supprimer', () => {
    expect(
      BriefSchema.safeParse({
        ...BASE_BRIEF,
        transport: {
          necessaire: true,
          troncons: [
            {
              origine: {
                ville: 'Bordeaux',
                identifiantExterne: 'fake',
              },
              destination: { ville: 'Paris' },
              depart: { date: '2026-08-10' },
            },
          ],
          occupation: {
            statut: 'declaree',
            adultes: 2,
            enfants: 0,
            provenance: 'fake',
          },
        },
      }).success
    ).toBe(false);
  });

  it('valide une demande aller simple complète', () => {
    const brief = BriefSchema.parse({
      ...BASE_BRIEF,
      transport: {
        necessaire: true,
        ...DEMANDE_TRANSPORT,
      },
    });
    expect(demandeTransportComplete(brief)).toEqual(
      DEMANDE_TRANSPORT
    );
  });

  it('valide un aller-retour seulement avec deux tronçons explicites', () => {
    const brief = BriefSchema.parse({
      ...BASE_BRIEF,
      transport: {
        necessaire: true,
        troncons: [
          DEMANDE_TRANSPORT.troncons[0],
          {
            origine: { ville: 'Paris' },
            destination: { ville: 'Bordeaux' },
            depart: { date: '2026-09-13' },
          },
        ],
        occupation: DEMANDE_TRANSPORT.occupation,
      },
    });
    expect(demandeTransportComplete(brief)?.troncons).toHaveLength(2);
  });

  it('conserve a_confirmer dans le brouillon sans produire de demande persistable', () => {
    const brief = BriefSchema.parse({
      ...BASE_BRIEF,
      transport: {
        necessaire: true,
        troncons: DEMANDE_TRANSPORT.troncons,
        occupation: {
          statut: 'a_confirmer',
          adultes: 2,
        },
      },
    });
    expect(demandeTransportComplete(brief)).toBeUndefined();
  });

  it('ne présente jamais comme complète une demande métier incohérente', () => {
    const brief = BriefSchema.parse({
      ...BASE_BRIEF,
      transport: {
        necessaire: true,
        troncons: [
          {
            origine: { ville: 'Paris' },
            destination: { ville: 'Paris' },
            depart: { date: '2026-09-10' },
          },
        ],
        occupation: DEMANDE_TRANSPORT.occupation,
      },
    });
    expect(prochainChampTransport(brief)?.champ).toBe('demande');
    expect(demandeTransportComplete(brief)).toBeUndefined();
  });

  it.each([
    ['fournisseur', { fournisseur: 'Amadeus' }],
    ['horaire observé', { horaireObserve: '2026-09-10T09:42:00Z' }],
    ['lien', { lien: 'https://example.test/billet' }],
    ['prix observé', { prixObserve: 80 }],
    ['disponibilité', { disponibilite: true }],
    [
      'préférence de gare encore hors périmètre',
      {
        origine: {
          ville: 'Bordeaux',
          preference: {
            type: 'gare',
            libelle: 'Bordeaux Saint-Jean',
          },
        },
      },
    ],
  ])('refuse un champ serveur injecté : %s', (_libelle, injection) => {
    expect(
      BriefSchema.safeParse({
        ...BASE_BRIEF,
        transport: {
          necessaire: true,
          troncons: [
            {
              ...DEMANDE_TRANSPORT.troncons[0],
              ...injection,
            },
          ],
          occupation: DEMANDE_TRANSPORT.occupation,
        },
      }).success
    ).toBe(false);
  });

  it.each([
    'Paris<script>',
    'AF123 à 09:42',
    'Bordeaux\nRéservation confirmée',
  ])('refuse une ville transport non affichable sans ambiguïté : %s', (ville) => {
    expect(estVilleTransportDemandeePrudente(ville)).toBe(false);
  });
});

describe('nettoyage fail-closed des sorties transport', () => {
  const hallucination = {
    titre: 'Vol AF123 à 09:42 depuis CDG terminal 2',
    plage: {
      debut: '2026-09-10T09:42:00Z',
      fin: '2026-09-10T11:18:00Z',
    },
    elements: [
      {
        ref: 'vol-1',
        type: 'transport' as const,
        identifiantExterne: 'AF123',
        nom: 'Air France AF123',
        lieu: 'CDG terminal 2',
        plage: {
          debut: '2026-09-10T09:42:00Z',
          fin: '2026-09-10T11:18:00Z',
        },
        prix: 145,
        justification:
          'Billet disponible sur https://example.test',
        dependDe: [],
        estAncre: true,
      },
    ],
  };

  it('supprime un transport que l’utilisateur n’a pas demandé', () => {
    expect(
      nettoyerMomentsTransport([hallucination], undefined)
    ).toEqual([]);
  });

  it('supprime les dépendances vers un transport retiré sans laisser de moment vide', () => {
    const resultat = nettoyerMomentsTransport(
      [
        hallucination,
        {
          titre: 'Visite',
          elements: [
            {
              ref: 'visite',
              type: 'activite',
              nom: 'Une visite',
              justification: 'activité conservée',
              dependDe: ['vol-1'],
              estAncre: false,
            },
          ],
        },
      ],
      undefined
    );

    expect(resultat).toHaveLength(1);
    expect(resultat[0].titre).toBe('Visite');
    expect(resultat[0].elements[0].dependDe).toEqual([]);
  });

  it('synthétise le transport depuis la demande sans reprendre le placeholder', () => {
    const [moment] = nettoyerMomentsTransport(
      [hallucination],
      DEMANDE_TRANSPORT
    );
    const [element] = moment.elements;

    expect(moment.titre).toBe(
      'Transport à organiser de Bordeaux vers Paris'
    );
    expect(moment).not.toHaveProperty('plage');
    // Ni la référence, ni le prix (145) du placeholder LLM ne survivent : le
    // transport est intégralement dérivé de la demande. Un prix absent de la
    // demande reste absent plutôt que d'être inventé.
    expect(element).toEqual({
      ref: 'transport-troncon-0',
      type: 'transport',
      nom: 'Transport à organiser de Bordeaux vers Paris',
      justification:
        'Prévoir un transport entre Bordeaux et Paris selon les dates et préférences déclarées.',
      dependDe: [],
      estAncre: false,
    });
    expect(element).not.toHaveProperty('prix');
    const serialise = JSON.stringify(moment);
    expect(serialise).not.toMatch(
      /Air France|AF123|CDG|09:42|11:18|Billet|example\.test/
    );
  });

  it('sépare un transport d’un moment mixte sans effacer l’horaire de l’activité', () => {
    const moments = nettoyerMomentsTransport(
      [
        {
          ...hallucination,
          titre: 'Matinée culturelle',
          elements: [
            {
              ref: 'musee',
              type: 'activite',
              nom: 'Musée',
              plage: hallucination.plage,
              justification: 'visite',
              dependDe: [],
              estAncre: false,
            },
            ...hallucination.elements,
          ],
        },
      ],
      DEMANDE_TRANSPORT
    );

    expect(moments).toHaveLength(2);
    expect(moments[0]).toMatchObject({
      titre: 'Musée',
      plage: hallucination.plage,
    });
    expect(moments[0].elements[0].type).toBe('activite');
    expect(moments[1]).not.toHaveProperty('plage');
    expect(moments[1].elements[0].type).toBe('transport');
  });

  it('ne conserve aucun détail transport dans le titre d’un moment mixte', () => {
    const [momentActivite, momentTransport] =
      nettoyerMomentsTransport(
        [
          {
            ...hallucination,
            titre: 'Départ AF123 à 09:42',
            elements: [
              {
                ref: 'visite',
                type: 'activite',
                nom: 'Visite du musée',
                justification: 'activité conservée',
                dependDe: ['vol-1'],
                estAncre: false,
              },
              ...hallucination.elements,
            ],
          },
        ],
        DEMANDE_TRANSPORT
      );

    expect(momentActivite.titre).toBe('Visite du musée');
    expect(momentActivite.elements[0].dependDe).toEqual([]);
    expect(momentTransport.titre).toBe(
      'Transport à organiser de Bordeaux vers Paris'
    );
    expect(JSON.stringify(momentTransport)).not.toMatch(
      /AF123|09:42/
    );
    expect(momentActivite.titre).not.toMatch(/AF123|09:42/);
  });

  it('produit exactement un transport par tronçon, dans l’ordre, quel que soit le placeholder', () => {
    const demande = {
      troncons: [
        {
          origine: { ville: 'Bordeaux' },
          destination: { ville: 'Paris' },
          depart: { date: '2026-09-10' },
        },
        {
          origine: { ville: 'Paris' },
          destination: { ville: 'Lyon' },
          depart: { date: '2026-09-11' },
        },
        {
          origine: { ville: 'Lyon' },
          destination: { ville: 'Marseille' },
          depart: { date: '2026-09-12' },
        },
      ],
      occupation: DEMANDE_TRANSPORT.occupation,
    };
    const cinqTransports = Array.from({ length: 5 }, (_, index) => ({
      ...hallucination.elements[0],
      ref: `transport-${index + 1}`,
      nom: `Invention ${5 - index}`,
    }));

    const resultat = nettoyerMomentsTransport(
      [{ ...hallucination, elements: cinqTransports }],
      demande
    );
    const elements = resultat.flatMap((moment) => moment.elements);

    expect(elements).toHaveLength(3);
    expect(elements.map((element) => element.nom)).toEqual([
      'Transport à organiser de Bordeaux vers Paris',
      'Transport à organiser de Paris vers Lyon',
      'Transport à organiser de Lyon vers Marseille',
    ]);
    expect(
      elements.every((element) => element.dependDe.length === 0)
    ).toBe(true);

    expect(
      nettoyerMomentsTransport(
        [{ ...hallucination, elements: cinqTransports }],
        DEMANDE_TRANSPORT
      ).flatMap((moment) => moment.elements)
    ).toHaveLength(1);
    // Le nombre de transports suit les tronçons, jamais les placeholders :
    // aucun placeholder (moments vides) ou un seul produisent malgré tout un
    // transport par tronçon de la demande.
    expect(
      nettoyerMomentsTransport([], demande).flatMap(
        (moment) => moment.elements
      )
    ).toHaveLength(3);
    expect(
      nettoyerMomentsTransport([hallucination], demande).flatMap(
        (moment) => moment.elements
      )
    ).toHaveLength(3);
  });

  it('place chaque transport avant les moments de sa destination, jamais regroupé en fin de parcours', () => {
    const demande = {
      troncons: [
        {
          origine: { ville: 'Paris' },
          destination: { ville: 'Lyon' },
          depart: { date: '2026-09-11' },
        },
        {
          origine: { ville: 'Lyon' },
          destination: { ville: 'Marseille' },
          depart: { date: '2026-09-13' },
        },
      ],
      occupation: DEMANDE_TRANSPORT.occupation,
    };
    const placeholderTransport = (ref: string) => ({
      ...hallucination.elements[0],
      ref,
    });
    const activite = (ref: string, nom: string) => ({
      ref,
      type: 'activite' as const,
      nom,
      justification: 'étape du parcours',
      dependDe: [],
      estAncre: false,
    });

    const resultat = nettoyerMomentsTransport(
      [
        { titre: 'Visite parisienne', elements: [activite('paris', 'Louvre')] },
        { titre: 'Départ', elements: [placeholderTransport('t1')] },
        { titre: 'Visite lyonnaise', elements: [activite('lyon', 'Vieux Lyon')] },
        { titre: 'Départ', elements: [placeholderTransport('t2')] },
        {
          titre: 'Visite marseillaise',
          elements: [activite('marseille', 'Vieux-Port')],
        },
      ],
      demande
    );

    expect(resultat.map((moment) => moment.elements[0].nom)).toEqual([
      'Louvre',
      'Transport à organiser de Paris vers Lyon',
      'Vieux Lyon',
      'Transport à organiser de Lyon vers Marseille',
      'Vieux-Port',
    ]);
  });

  it('ne mute profondément ni les moments ni la demande reçus', () => {
    const moments = [
      {
        ...hallucination,
        elements: hallucination.elements.map((element) => ({
          ...element,
          dependDe: ['autre'],
        })),
      },
    ];
    const demande = structuredClone(DEMANDE_TRANSPORT);
    const copieMoments = structuredClone(moments);
    const copieDemande = structuredClone(demande);

    nettoyerMomentsTransport(moments, demande);

    expect(moments).toEqual(copieMoments);
    expect(demande).toEqual(copieDemande);
  });
});

describe('invariants actifs du parcours transport', () => {
  it('accepte uniquement une suggestion générique sans fait externe', () => {
    const parcours = parcoursTransport();
    expect(ParcoursSchema.safeParse(parcours).success).toBe(true);
    expect(validerParcours(parcours)).toEqual([]);
  });

  it('refuse de persister une occupation transport à confirmer', () => {
    const parcours = parcoursTransport();
    expect(
      ParcoursSchema.safeParse({
        ...parcours,
        contexte: {
          ...parcours.contexte,
          demandeTransport: {
            ...DEMANDE_TRANSPORT,
            occupation: { statut: 'a_confirmer' },
          },
        },
      }).success
    ).toBe(false);
  });

  it.each([
    [
      'une confiance vérifiée',
      {
        confiance: {
          niveau: 'verifie',
          source: 'https://example.test',
          fournisseur: 'Faux',
          recupereLe: '2026-09-01T10:00:00Z',
        },
      },
    ],
    [
      'un lien externe',
      {
        lienExterne: {
          url: 'https://example.test',
          fournisseur: 'Faux',
          typeLien: 'reservation',
        },
      },
    ],
    [
      'une plage exacte',
      {
        plage: {
          debut: '2026-09-10T09:42:00Z',
          fin: '2026-09-10T11:18:00Z',
        },
      },
    ],
    ['un lieu précis', { lieu: 'CDG terminal 2' }],
    ['une ancre', { estAncre: true }],
    ['un prix observé', { prix: 80, prixEstime: false }],
    [
      'un nom détaillé après un préfixe générique',
      { nom: 'Transport à organiser avec Air France AF123' },
    ],
    [
      'une justification libre détaillée',
      { justification: 'Prendre le TGV 8421 au quai 4' },
    ],
    [
      'une alternative commerciale',
      {
        alternatives: [
          {
            id: 'offre-tgv',
            nom: 'TGV 8421',
            prix: 80,
          },
        ],
      },
    ],
    [
      'une contrainte horaire observée',
      {
        contraintes: [
          {
            nature: 'souple',
            description: 'Départ TGV à 09:42',
          },
        ],
      },
    ],
  ])('refuse %s', (_libelle, modification) => {
    const parcours = parcoursTransport();
    const element = parcours.timeline[0].elements[0];
    expect(
      ParcoursSchema.safeParse({
        ...parcours,
        timeline: [
          {
            ...parcours.timeline[0],
            elements: [{ ...element, ...modification }],
          },
        ],
      }).success
    ).toBe(false);
  });

  it('refuse aussi une plage exacte portée par le moment', () => {
    const parcours = parcoursTransport();
    expect(
      ParcoursSchema.safeParse({
        ...parcours,
        timeline: [
          {
            ...parcours.timeline[0],
            plage: {
              debut: '2026-09-10T09:42:00Z',
              fin: '2026-09-10T11:18:00Z',
            },
          },
        ],
      }).success
    ).toBe(false);
  });

  it('refuse un titre détaillé sur un moment exclusivement transport', () => {
    const parcours = parcoursTransport();
    expect(
      ParcoursSchema.safeParse({
        ...parcours,
        timeline: [
          {
            ...parcours.timeline[0],
            titre: 'TGV 8421 à 09:42 depuis Montparnasse',
          },
        ],
      }).success
    ).toBe(false);
  });

  it('refuse un transport mélangé à un autre élément dans le même moment', () => {
    const parcours = parcoursTransport();
    expect(
      ParcoursSchema.safeParse({
        ...parcours,
        timeline: [
          {
            ...parcours.timeline[0],
            elements: [
              ...parcours.timeline[0].elements,
              {
                id: 'activite',
                type: 'activite',
                nom: 'Une activité',
                justification: 'une activité distincte',
              },
            ],
          },
        ],
      }).success
    ).toBe(false);
  });
});

describe('modifications génériques et compatibilité legacy', () => {
  // F4-E — le transport ne passe plus par le chemin générique : il est refusé
  // au contrat, comme l'hébergement. Sa seule voie client est
  // `modifier_demande_transport`, qui préserve la correspondance positionnelle
  // tronçon ↔ élément. On ne peut donc plus forger ni désynchroniser un
  // transport via ajouter_element / remplacer_element.
  it('refuse un ajout transport précis par le chemin générique', () => {
    expect(
      DemandeSurElementClientSchema.safeParse({
        type: 'ajouter_element',
        momentId: 'm-transport',
        element: {
          type: 'transport',
          nom: 'Vol AF123',
          lieu: 'CDG terminal 2',
          plage: {
            debut: '2026-09-10T09:42:00Z',
            fin: '2026-09-10T11:18:00Z',
          },
          prix: 145,
          justification: 'Billet disponible',
        },
      }).success
    ).toBe(false);
  });

  it('refuse un remplacement transport sans gêner les autres types', () => {
    expect(
      DemandeSurElementClientSchema.safeParse({
        type: 'remplacer_element',
        elementId: 'e-transport',
        remplacement: {
          type: 'transport',
          nom: 'TGV 8421',
          lieu: 'Gare Montparnasse',
          justification: 'Train confirmé',
        },
      }).success
    ).toBe(false);

    const restaurant = DemandeSurElementClientSchema.parse({
      type: 'ajouter_element',
      momentId: 'm-transport',
      element: {
        type: 'restaurant',
        nom: 'Chez Rose',
        lieu: 'Bordeaux',
        justification: 'une table choisie',
      },
    });
    if (restaurant.type !== 'ajouter_element') {
      throw new Error('ajout restaurant attendu');
    }
    const restaurantInterne = preparerDemandeSurElementClient(
      restaurant,
      () => 'restaurant-serveur'
    );
    if (restaurantInterne.type !== 'ajouter_element') {
      throw new Error('ajout restaurant interne attendu');
    }
    expect(restaurantInterne.element).toMatchObject({
      nom: 'Chez Rose',
      lieu: 'Bordeaux',
    });
  });

  it('dégrade un transport legacy sans toucher aux voisins non transport', () => {
    const base = parcoursTransport();
    const lu = ParcoursLectureSchema.parse({
      ...base,
      timeline: [
        {
          id: 'm-mixte',
          titre: 'Concert confirmé à 20 h',
          plage: {
            debut: '2026-09-10T20:00:00Z',
            fin: '2026-09-10T22:00:00Z',
          },
          elements: [
            {
              id: 'evenement',
              type: 'evenement',
              nom: 'Concert confirmé',
              justification: 'événement conservé',
            },
            {
              id: 'transport-legacy',
              type: 'transport',
              nom: 'TGV 8421',
              lieu: 'Gare Montparnasse',
              plage: {
                debut: '2026-09-10T09:42:00Z',
                fin: '2026-09-10T11:18:00Z',
              },
              prix: 80,
              prixEstime: false,
              justification: 'Train confirmé quai 4',
              confiance: {
                niveau: 'verifie',
                source: 'https://example.test',
                fournisseur: 'Faux',
                recupereLe: '2026-09-01T10:00:00Z',
              },
              reservation: {
                lienExterne: 'https://example.test/billet',
                fournisseur: 'Faux',
                typeLien: 'reservation',
              },
              estAncre: true,
            },
          ],
        },
      ],
    });

    expect(lu.timeline).toHaveLength(2);
    expect(lu.timeline[0]).toMatchObject({
      id: 'm-mixte',
      titre: 'Concert confirmé à 20 h',
      plage: {
        debut: '2026-09-10T20:00:00Z',
        fin: '2026-09-10T22:00:00Z',
      },
    });
    expect(lu.timeline[0].elements[0].nom).toBe('Concert confirmé');
    const transport = lu.timeline[1].elements[0];
    expect(lu.timeline[1]).not.toHaveProperty('plage');
    expect(transport).toMatchObject({
      nom: 'Transport à organiser',
      confiance: { niveau: 'suggestion' },
      prix: 80,
      prixEstime: true,
      estAncre: false,
    });
    expect(transport).not.toHaveProperty('reservation');
    expect(transport).not.toHaveProperty('lienExterne');
    expect(transport).not.toHaveProperty('lieu');
    expect(transport).not.toHaveProperty('plage');
    expect(ParcoursSchema.safeParse(lu).success).toBe(true);
  });

  it.each(['Foursquare', 'PredictHQ'])(
    'ne conserve aucune fausse preuve transport legacy %s',
    (fournisseur) => {
      const base = parcoursTransport();
      const lu = ParcoursLectureSchema.parse({
        ...base,
        timeline: [
          {
            id: `m-${fournisseur}`,
            titre: 'Trajet prétendument réel',
            elements: [
              {
                id: `e-${fournisseur}`,
                type: 'transport',
                nom: 'Trajet prétendument confirmé',
                justification: 'preuve prétendue',
                confiance: {
                  niveau: 'verifie',
                  source: 'https://example.test',
                  fournisseur,
                  recupereLe: '2026-09-01T10:00:00Z',
                },
                reservation: {
                  lienExterne: 'https://example.test/billet',
                  fournisseur,
                  typeLien: 'reservation',
                },
                lienRechercheHebergement: {
                  type: 'recherche',
                  fournisseur: 'Booking',
                  url: 'https://www.booking.com/searchresults.html',
                  libelle:
                    'Rechercher des hébergements sur Booking',
                  genereLe: '2026-09-01T10:00:00Z',
                },
                alternatives: [
                  {
                    id: 'alternative',
                    nom: 'Autre trajet précis',
                  },
                ],
              },
            ],
          },
        ],
      });
      const transport = lu.timeline[0].elements[0];

      expect(transport.confiance).toEqual({
        niveau: 'suggestion',
      });
      expect(transport.alternatives).toEqual([]);
      expect(transport).not.toHaveProperty('reservation');
      expect(transport).not.toHaveProperty('lienExterne');
      expect(transport).not.toHaveProperty(
        'lienRechercheHebergement'
      );
    }
  );

  it('sépare un moment legacy sans collision et reste idempotent', () => {
    const base = parcoursTransport();
    const brut = {
      ...base,
      timeline: [
        {
          id: 'm-mixte-transport',
          titre: 'Activité déjà existante',
          elements: [
            {
              id: 'activite-existante',
              type: 'activite',
              nom: 'Une activité',
              justification: 'activité conservée',
            },
          ],
        },
        {
          id: 'm-mixte',
          titre: 'Moment mixte',
          elements: [
            {
              id: 'restaurant',
              type: 'restaurant',
              nom: 'Un restaurant',
              justification: 'restaurant conservé',
            },
            {
              id: 'transport-legacy',
              type: 'transport',
              nom: 'Train prétendument confirmé',
              justification: 'horaire prétendument observé',
              confiance: {
                niveau: 'verifie',
                source: 'https://example.test',
                fournisseur: 'PredictHQ',
                recupereLe: '2026-09-01T10:00:00Z',
              },
            },
          ],
        },
      ],
    };

    const premiereLecture = ParcoursLectureSchema.parse(brut);
    const secondeLecture =
      ParcoursLectureSchema.parse(premiereLecture);
    const idsMoments = premiereLecture.timeline.map(
      (moment) => moment.id
    );

    expect(idsMoments).toEqual([
      'm-mixte-transport',
      'm-mixte',
      'm-mixte-transport-2',
    ]);
    expect(new Set(idsMoments).size).toBe(idsMoments.length);
    expect(secondeLecture).toEqual(premiereLecture);
    expect(
      premiereLecture.timeline.flatMap((moment) => moment.elements)
    ).toHaveLength(3);
  });
});
