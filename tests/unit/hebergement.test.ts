import { describe, expect, it } from 'vitest';
import {
  LienRechercheHebergementSchema,
  OccupationHebergementSchema,
  ParcoursLectureSchema,
  ParcoursSchema,
  SejourHebergementSchema,
  validerParcours,
} from '../../server/domaine/parcours/index.js';
import {
  BriefSchema,
  OccupationHebergementBriefSchema,
} from '../../server/agents/brief.js';

describe('OccupationHebergementSchema — aucune occupation inventée', () => {
  it.each([
    { adultes: 1, enfants: 0, chambres: 1 },
    { adultes: 2, enfants: 2, chambres: 2 },
    { adultes: 20, enfants: 20, chambres: 10 },
  ])('accepte une occupation explicitement déclarée : %o', (occupation) => {
    expect(
      OccupationHebergementSchema.parse({
        statut: 'declaree',
        ...occupation,
      })
    ).toEqual({ statut: 'declaree', ...occupation });
  });

  it.each([
    ['0 adulte', { adultes: 0, enfants: 0, chambres: 1 }],
    ['nombre négatif', { adultes: -1, enfants: 0, chambres: 1 }],
    ['adulte décimal', { adultes: 1.5, enfants: 0, chambres: 1 }],
    ['plus de 20 adultes', { adultes: 21, enfants: 0, chambres: 1 }],
    ['plus de 20 enfants', { adultes: 2, enfants: 21, chambres: 1 }],
    ['enfant décimal', { adultes: 2, enfants: 0.5, chambres: 1 }],
    ['0 chambre', { adultes: 2, enfants: 0, chambres: 0 }],
    ['plus de 10 chambres', { adultes: 2, enfants: 0, chambres: 11 }],
    ['chambre décimale', { adultes: 2, enfants: 0, chambres: 1.5 }],
    ['valeur texte', { adultes: 'deux', enfants: 0, chambres: 1 }],
    ['chaîne numérique', { adultes: '2', enfants: 0, chambres: 1 }],
    ['NaN', { adultes: Number.NaN, enfants: 0, chambres: 1 }],
    ['Infinity', { adultes: Number.POSITIVE_INFINITY, enfants: 0, chambres: 1 }],
  ])('refuse %s', (_libelle, occupation) => {
    expect(
      OccupationHebergementSchema.safeParse({
        statut: 'declaree',
        ...occupation,
      }).success
    ).toBe(false);
  });

  it('refuse un objet partiel présenté comme déclaré', () => {
    expect(
      OccupationHebergementSchema.safeParse({
        statut: 'declaree',
        adultes: 2,
        chambres: 1,
      }).success
    ).toBe(false);
  });

  it('ne persiste aucune valeur partielle sous a_confirmer', () => {
    expect(
      OccupationHebergementSchema.safeParse({
        statut: 'a_confirmer',
        adultes: 2,
      }).success
    ).toBe(false);
  });

  it('autorise une saisie partielle uniquement dans le brief de dialogue', () => {
    expect(
      OccupationHebergementBriefSchema.parse({
        statut: 'a_confirmer',
        adultes: 2,
      })
    ).toEqual({ statut: 'a_confirmer', adultes: 2 });
  });
});

describe('SejourHebergementSchema — dates civiles propres à chaque hôtel', () => {
  it('accepte une arrivée et un départ ISO avec un départ postérieur', () => {
    expect(
      SejourHebergementSchema.parse({
        ville: ' Bordeaux ',
        arrivee: '2026-08-10',
        depart: '2026-08-12',
      })
    ).toEqual({
      ville: 'Bordeaux',
      arrivee: '2026-08-10',
      depart: '2026-08-12',
    });
  });

  it.each([
    ['même date', '2026-08-10', '2026-08-10'],
    ['départ antérieur', '2026-08-10', '2026-08-09'],
    ['format français', '10/08/2026', '12/08/2026'],
    ['date impossible', '2026-02-30', '2026-03-01'],
    ['mois impossible', '2026-13-01', '2027-01-02'],
    ['jour bissextile inexistant', '2026-02-29', '2026-03-01'],
    ['heure interdite', '2026-08-10T14:00:00Z', '2026-08-12'],
  ])('refuse %s', (_libelle, arrivee, depart) => {
    expect(
      SejourHebergementSchema.safeParse({
        ville: 'Bordeaux',
        arrivee,
        depart,
      }).success
    ).toBe(false);
  });

  it('accepte le 29 février d’une année bissextile', () => {
    expect(
      SejourHebergementSchema.safeParse({
        ville: 'Bordeaux',
        arrivee: '2028-02-29',
        depart: '2028-03-01',
      }).success
    ).toBe(true);
  });

  it('refuse une ville vide', () => {
    expect(
      SejourHebergementSchema.safeParse({
        ville: '   ',
        arrivee: '2026-08-10',
        depart: '2026-08-12',
      }).success
    ).toBe(false);
  });
});

describe('intégration domaine et compatibilité legacy', () => {
  const base = {
    id: 'p-hotel',
    intention: { texte: 'visiter Bordeaux et Lyon' },
    contexte: {
      avecQui: 'famille' as const,
      duree: { valeur: 4, unite: 'jours' as const },
    },
    participants: [
      { id: 'organisateur', nom: 'Alex', role: 'organisateur' as const },
      { id: 'invite-1', nom: 'Sam', role: 'participant' as const },
      { id: 'invite-2', nom: 'Jo', role: 'participant' as const },
    ],
    budget: { mode: 'individuel' as const },
  };
  const lienRechercheHebergement = {
    type: 'recherche' as const,
    fournisseur: 'Booking' as const,
    url:
      'https://www.booking.com/searchresults.html?' +
      'ss=Bordeaux&checkin=2026-08-10&checkout=2026-08-12&' +
      'group_adults=2&group_children=0&no_rooms=1',
    libelle: 'Rechercher des hébergements sur Booking' as const,
    genereLe: '2026-07-29T12:00:00.000Z',
  };

  it('accepte un lien de recherche séparé sur une suggestion hôtelière complète', () => {
    const parcours = ParcoursSchema.parse({
      ...base,
      contexte: {
        ...base.contexte,
        occupationHebergement: {
          statut: 'declaree',
          adultes: 2,
          enfants: 0,
          chambres: 1,
        },
      },
      timeline: [
        {
          id: 'bordeaux',
          titre: 'Bordeaux',
          elements: [
            {
              id: 'hotel-bordeaux',
              type: 'hebergement',
              nom: 'Un hébergement à choisir à Bordeaux',
              justification: 'dormir sur place',
              confiance: { niveau: 'suggestion' },
              sejourHebergement: {
                ville: 'Bordeaux',
                arrivee: '2026-08-10',
                depart: '2026-08-12',
              },
              lienRechercheHebergement,
            },
          ],
        },
      ],
    });

    const hotel = parcours.timeline[0].elements[0];
    expect(hotel.lienRechercheHebergement).toEqual(
      lienRechercheHebergement
    );
    expect(hotel.reservation).toBeUndefined();
    expect(hotel.confiance).toEqual({ niveau: 'suggestion' });
    expect(validerParcours(parcours)).toEqual([]);

    if (!hotel.lienRechercheHebergement) {
      throw new Error('lien de recherche attendu');
    }
    hotel.lienRechercheHebergement.url =
      hotel.lienRechercheHebergement.url.replace(
        'group_adults=2',
        'group_adults=3'
      );
    expect(
      validerParcours(parcours).some((erreur) =>
        erreur.includes('contredit le séjour ou l’occupation')
      )
    ).toBe(true);
  });

  it('refuse un lien hôtelier hors de Booking HTTPS', () => {
    expect(
      LienRechercheHebergementSchema.safeParse({
        ...lienRechercheHebergement,
        url: 'http://www.booking.com/searchresults.html?ss=Bordeaux',
      }).success
    ).toBe(false);
    expect(
      LienRechercheHebergementSchema.safeParse({
        ...lienRechercheHebergement,
        url: 'https://evil.test/searchresults.html?ss=Bordeaux',
      }).success
    ).toBe(false);
    expect(
      LienRechercheHebergementSchema.safeParse({
        ...lienRechercheHebergement,
        url: `${lienRechercheHebergement.url}&no_rooms=2`,
      }).success
    ).toBe(false);
    expect(
      LienRechercheHebergementSchema.safeParse({
        ...lienRechercheHebergement,
        url: `${lienRechercheHebergement.url}#reservation`,
      }).success
    ).toBe(false);
    expect(
      LienRechercheHebergementSchema.safeParse({
        ...lienRechercheHebergement,
        url: lienRechercheHebergement.url.replace(
          'https://',
          'https://utilisateur:secret@'
        ),
      }).success
    ).toBe(false);
  });

  it.each([
    ['un restaurant', 'restaurant', true, 'declaree'],
    ['un hôtel sans séjour', 'hebergement', false, 'declaree'],
    ['une occupation à confirmer', 'hebergement', true, 'a_confirmer'],
  ] as const)(
    'refuse un lien de recherche attaché à %s',
    (_cas, type, avecSejour, statutOccupation) => {
      expect(
        ParcoursSchema.safeParse({
          ...base,
          contexte: {
            ...base.contexte,
            occupationHebergement:
              statutOccupation === 'declaree'
                ? {
                    statut: 'declaree',
                    adultes: 2,
                    enfants: 0,
                    chambres: 1,
                  }
                : { statut: 'a_confirmer' },
          },
          timeline: [
            {
              id: 'moment',
              titre: 'Nuit',
              elements: [
                {
                  id: 'element',
                  type,
                  nom: 'Élément',
                  justification: 'étape du parcours',
                  sejourHebergement: avecSejour
                    ? {
                        ville: 'Bordeaux',
                        arrivee: '2026-08-10',
                        depart: '2026-08-12',
                      }
                    : undefined,
                  lienRechercheHebergement,
                },
              ],
            },
          ],
        }).success
      ).toBe(false);
    }
  );

  it('refuse un lien dont les paramètres contredisent le séjour ou l’occupation', () => {
    expect(
      ParcoursSchema.safeParse({
        ...base,
        contexte: {
          ...base.contexte,
          occupationHebergement: {
            statut: 'declaree',
            adultes: 2,
            enfants: 0,
            chambres: 1,
          },
        },
        timeline: [
          {
            id: 'moment',
            titre: 'Nuit',
            elements: [
              {
                id: 'hotel',
                type: 'hebergement',
                nom: 'Hôtel',
                justification: 'dormir sur place',
                sejourHebergement: {
                  ville: 'Bordeaux',
                  arrivee: '2026-08-10',
                  depart: '2026-08-12',
                },
                lienRechercheHebergement: {
                  ...lienRechercheHebergement,
                  url: lienRechercheHebergement.url.replace(
                    'group_adults=2',
                    'group_adults=3'
                  ),
                },
              },
            ],
          },
        ],
      }).success
    ).toBe(false);
  });

  it('porte une occupation générale et deux séjours multi-ville distincts', () => {
    const parcours = ParcoursSchema.parse({
      ...base,
      contexte: {
        ...base.contexte,
        occupationHebergement: {
          statut: 'declaree',
          adultes: 2,
          enfants: 1,
          chambres: 2,
        },
      },
      timeline: [
        {
          id: 'bordeaux',
          titre: 'Bordeaux',
          elements: [
            {
              id: 'hotel-bordeaux',
              type: 'hebergement',
              nom: 'Hôtel Bordeaux',
              justification: 'première étape',
              sejourHebergement: {
                ville: 'Bordeaux',
                arrivee: '2026-08-10',
                depart: '2026-08-12',
              },
            },
          ],
        },
        {
          id: 'lyon',
          titre: 'Lyon',
          elements: [
            {
              id: 'hotel-lyon',
              type: 'hebergement',
              nom: 'Hôtel Lyon',
              justification: 'seconde étape',
              // Une fin le lendemain de la dernière journée concernée reste valide.
              sejourHebergement: {
                ville: 'Lyon',
                arrivee: '2026-08-12',
                depart: '2026-08-15',
              },
            },
          ],
        },
      ],
    });

    expect(
      parcours.timeline.map(
        (moment) => moment.elements[0].sejourHebergement
      )
    ).toEqual([
      { ville: 'Bordeaux', arrivee: '2026-08-10', depart: '2026-08-12' },
      { ville: 'Lyon', arrivee: '2026-08-12', depart: '2026-08-15' },
    ]);
  });

  it('refuse de rattacher un séjour hôtelier à un autre type d’élément', () => {
    expect(
      ParcoursSchema.safeParse({
        ...base,
        timeline: [
          {
            id: 'm1',
            titre: 'Repas',
            elements: [
              {
                id: 'restaurant',
                type: 'restaurant',
                nom: 'Restaurant',
                justification: 'un dîner',
                sejourHebergement: {
                  ville: 'Bordeaux',
                  arrivee: '2026-08-10',
                  depart: '2026-08-12',
                },
              },
            ],
          },
        ],
      }).success
    ).toBe(false);
  });

  it('refuse un séjour totalement hors des dates globales du parcours', () => {
    expect(
      ParcoursSchema.safeParse({
        ...base,
        contexte: {
          ...base.contexte,
          dates: {
            debut: '2026-08-10T00:00:00Z',
            fin: '2026-08-12T23:59:59Z',
          },
        },
        timeline: [
          {
            id: 'm-hors-dates',
            titre: 'Nuit hors parcours',
            elements: [
              {
                id: 'hotel-hors-dates',
                type: 'hebergement',
                nom: 'Hôtel',
                justification: 'dormir sur place',
                sejourHebergement: {
                  ville: 'Bordeaux',
                  arrivee: '2026-08-20',
                  depart: '2026-08-21',
                },
              },
            ],
          },
        ],
      }).success
    ).toBe(false);
  });

  it('refuse un départ plus tardif que le lendemain du dernier jour', () => {
    expect(
      ParcoursSchema.safeParse({
        ...base,
        contexte: {
          ...base.contexte,
          dates: {
            debut: '2026-08-10T00:00:00Z',
            fin: '2026-08-12T23:59:59Z',
          },
        },
        timeline: [
          {
            id: 'm-depart-tardif',
            titre: 'Nuit',
            elements: [
              {
                id: 'hotel-depart-tardif',
                type: 'hebergement',
                nom: 'Hôtel',
                justification: 'dormir sur place',
                sejourHebergement: {
                  ville: 'Bordeaux',
                  arrivee: '2026-08-12',
                  depart: '2026-08-14',
                },
              },
            ],
          },
        ],
      }).success
    ).toBe(false);
  });

  it('autorise un départ le lendemain du dernier jour, y compris au changement d’année', () => {
    const parcours = ParcoursSchema.parse({
      ...base,
      contexte: {
        ...base.contexte,
        dates: {
          debut: '2028-12-30T00:00:00Z',
          fin: '2028-12-31T23:59:59Z',
        },
      },
      timeline: [
        {
          id: 'm-nouvel-an',
          titre: 'Nuit du réveillon',
          elements: [
            {
              id: 'hotel-nouvel-an',
              type: 'hebergement',
              nom: 'Hôtel',
              justification: 'dormir sur place',
              sejourHebergement: {
                ville: 'Bordeaux',
                arrivee: '2028-12-31',
                depart: '2029-01-01',
              },
            },
          ],
        },
      ],
    });

    expect(validerParcours(parcours)).toEqual([]);
  });

  it('signale aussi dans les invariants un séjour devenu hors dates après validation', () => {
    const parcours = ParcoursSchema.parse({
      ...base,
      contexte: {
        ...base.contexte,
        dates: {
          debut: '2026-08-10T00:00:00Z',
          fin: '2026-08-12T23:59:59Z',
        },
      },
      timeline: [
        {
          id: 'm-valide',
          titre: 'Nuit',
          elements: [
            {
              id: 'hotel-valide',
              type: 'hebergement',
              nom: 'Hôtel',
              justification: 'dormir sur place',
              sejourHebergement: {
                ville: 'Bordeaux',
                arrivee: '2026-08-10',
                depart: '2026-08-12',
              },
            },
          ],
        },
      ],
    });
    const sejour = parcours.timeline[0].elements[0].sejourHebergement;
    if (!sejour) throw new Error('séjour attendu');
    sejour.arrivee = '2026-08-20';
    sejour.depart = '2026-08-21';

    expect(
      validerParcours(parcours).some((erreur) =>
        erreur.includes('séjour hôtelier')
      )
    ).toBe(true);
  });

  it.each(['solo', 'couple', 'famille', 'amis', 'groupe'] as const)(
    'ne déduit aucune occupation de avecQui=%s',
    (avecQui) => {
      const brief = BriefSchema.parse({
        intention: 'partir quelques jours',
        avecQui,
        duree: { valeur: 3, unite: 'jours' },
      });
      expect(brief.hebergement).toBeUndefined();
    }
  );

  it('ne déduit aucune occupation du nombre de participants', () => {
    const parcours = ParcoursSchema.parse(base);
    expect(parcours.participants).toHaveLength(3);
    expect(parcours.contexte.occupationHebergement).toBeUndefined();
  });

  it('lit un ancien brief sans sous-objet hôtelier', () => {
    expect(
      BriefSchema.parse({
        intention: 'vivre la NBA',
        avecQui: 'solo',
        duree: { valeur: 3, unite: 'jours' },
      }).hebergement
    ).toBeUndefined();
  });

  it('lit un ancien parcours sans inventer a_confirmer', () => {
    const parcours = ParcoursLectureSchema.parse(base);
    expect(parcours.contexte.occupationHebergement).toBeUndefined();
  });
});
