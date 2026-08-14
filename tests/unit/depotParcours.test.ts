import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  parcours: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
};
vi.mock('../../server/db/prisma.js', () => ({ default: prismaMock }));

const {
  sauvegarderParcours,
  chargerParcours,
  listerParcours,
  supprimerParcours,
} = await import('../../server/depots/depotParcours.js');
const { ParcoursSchema } = await import('../../server/domaine/parcours/index.js');
const { AppError } = await import('../../server/lib/AppError.js');

const PROPRIETAIRE = 'user-1';
const parcoursValide = ParcoursSchema.parse({
  id: 'p1',
  intention: { texte: 'vivre la NBA' },
  contexte: { avecQui: 'solo', duree: { valeur: 21, unite: 'jours' } },
  participants: [{ id: 'u1', nom: 'Thomas', role: 'organisateur' }],
  budget: { mode: 'individuel' },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sauvegarderParcours — l’écriture dérive les projections', () => {
  it('crée le parcours avec les colonnes dérivées du contenu (ADR-0007)', async () => {
    prismaMock.parcours.findUnique.mockResolvedValue(null);
    await sauvegarderParcours(PROPRIETAIRE, parcoursValide);

    const appel = prismaMock.parcours.upsert.mock.calls[0][0];
    expect(appel.create).toMatchObject({
      id: 'p1',
      user_id: PROPRIETAIRE,
      intention: 'vivre la NBA',
      visibilite: 'prive',
    });
    expect(appel.create.contenu).toEqual(parcoursValide);
  });

  it('refuse d’écraser le parcours d’un autre utilisateur', async () => {
    prismaMock.parcours.findUnique.mockResolvedValue({ user_id: 'quelqu-un-d-autre' });
    await expect(sauvegarderParcours(PROPRIETAIRE, parcoursValide)).rejects.toThrow(AppError);
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });

  it('persiste un lien sécurisé dans le contenu sans table séparée', async () => {
    const parcoursAvecLien = ParcoursSchema.parse({
      ...parcoursValide,
      timeline: [
        {
          id: 'm-lien',
          titre: 'Soirée',
          elements: [
            {
              id: 'e-lien',
              type: 'restaurant',
              nom: 'Le Point Rouge',
              justification: 'une table cohérente avec le parcours',
              confiance: {
                niveau: 'verifie',
                source:
                  'https://places-api.foursquare.com/places/search',
                fournisseur: 'Foursquare',
                recupereLe: '2026-07-28T08:15:00.000Z',
                identifiantExterne: 'fsq-point-rouge',
              },
              lienExterne: {
                url:
                  'https://www.thefork.fr/restaurant/le-point-rouge-r12345',
                fournisseur: 'Tavily',
                typeLien: 'reservation',
              },
            },
          ],
        },
      ],
    });
    prismaMock.parcours.findUnique.mockResolvedValue(null);

    await sauvegarderParcours(PROPRIETAIRE, parcoursAvecLien);

    const contenu =
      prismaMock.parcours.upsert.mock.calls[0][0].create.contenu;
    expect(contenu).toEqual(parcoursAvecLien);
  });

  it('persiste occupation et séjour hôtelier dans le JSON existant sans projection séparée', async () => {
    const parcoursHotelier = ParcoursSchema.parse({
      ...parcoursValide,
      contexte: {
        ...parcoursValide.contexte,
        occupationHebergement: {
          statut: 'declaree',
          adultes: 2,
          enfants: 0,
          chambres: 1,
        },
      },
      timeline: [
        {
          id: 'm-hotel',
          titre: 'Nuit à Bordeaux',
          elements: [
            {
              id: 'e-hotel',
              type: 'hebergement',
              nom: 'Hôtel Burdigala',
              justification: 'dormir sur place',
              sejourHebergement: {
                ville: 'Bordeaux',
                arrivee: '2026-08-10',
                depart: '2026-08-12',
              },
              lienRechercheHebergement: {
                type: 'recherche',
                fournisseur: 'Booking',
                url:
                  'https://www.booking.com/searchresults.html?' +
                  'ss=H%C3%B4tel+Burdigala+Bordeaux&' +
                  'checkin=2026-08-10&checkout=2026-08-12&' +
                  'group_adults=2&group_children=0&no_rooms=1',
                libelle:
                  'Rechercher des hébergements sur Booking',
                genereLe: '2026-07-29T12:00:00.000Z',
              },
            },
          ],
        },
      ],
    });
    prismaMock.parcours.findUnique.mockResolvedValue(null);

    await sauvegarderParcours(PROPRIETAIRE, parcoursHotelier);

    const appel = prismaMock.parcours.upsert.mock.calls[0][0];
    expect(appel.create.contenu).toEqual(parcoursHotelier);
    expect(appel.create).not.toHaveProperty('occupationHebergement');
    expect(appel.create).not.toHaveProperty('sejourHebergement');
    expect(appel.create).not.toHaveProperty('lienRechercheHebergement');
    expect(
      appel.create.contenu.timeline[0].elements[0]
        .lienRechercheHebergement
    ).toEqual(parcoursHotelier.timeline[0].elements[0].lienRechercheHebergement);
  });

  it('persiste la demande transport utilisateur dans le JSON existant', async () => {
    const demandeTransport = {
      troncons: [
        {
          origine: { ville: 'Bordeaux' },
          destination: { ville: 'Paris' },
          depart: { date: '2026-09-10', creneau: 'matin' },
          modeSouhaite: 'train',
        },
      ],
      occupation: {
        statut: 'declaree',
        adultes: 2,
        enfants: 0,
      },
    };
    const parcoursTransport = ParcoursSchema.parse({
      ...parcoursValide,
      contexte: {
        ...parcoursValide.contexte,
        demandeTransport,
      },
      timeline: [
        {
          id: 'm-transport',
          titre: 'Transport à organiser de Bordeaux vers Paris',
          elements: [
            {
              id: 'e-transport',
              type: 'transport',
              nom: 'Transport à organiser de Bordeaux vers Paris',
              justification:
                'Prévoir un transport entre Bordeaux et Paris selon les dates et préférences déclarées.',
            },
          ],
        },
      ],
    });
    prismaMock.parcours.findUnique.mockResolvedValue(null);

    await sauvegarderParcours(PROPRIETAIRE, parcoursTransport);

    const appel = prismaMock.parcours.upsert.mock.calls[0][0];
    expect(appel.create.contenu.contexte.demandeTransport).toEqual(
      demandeTransport
    );
    expect(appel.create).not.toHaveProperty('demandeTransport');
  });
});

describe('chargerParcours — la lecture revalide le contenu', () => {
  it('rend le parcours quand le contenu est valide', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({ contenu: parcoursValide });
    await expect(chargerParcours(PROPRIETAIRE, 'p1')).resolves.toEqual(parcoursValide);
  });

  it('rend null quand le parcours n’existe pas (ou n’appartient pas à l’utilisateur)', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue(null);
    await expect(chargerParcours(PROPRIETAIRE, 'p1')).resolves.toBeNull();
  });

  it('rejette une ligne corrompue au lieu de la laisser passer', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({ contenu: { id: 'p1' } });
    await expect(chargerParcours(PROPRIETAIRE, 'p1')).rejects.toThrow('corrompu');
  });

  it('normalise une ancienne réservation sans lui accorder le niveau vérifié', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({
      contenu: {
        ...parcoursValide,
        timeline: [
          {
            id: 'm1',
            titre: 'Ancien parcours',
            elements: [
              {
                id: 'e1',
                type: 'activite',
                nom: 'Ancienne activité',
                justification: 'ancienne donnée persistée',
                reservation: { lienExterne: 'https://example.com/recherche' },
              },
            ],
          },
        ],
      },
    });

    const parcours = await chargerParcours(PROPRIETAIRE, 'p1');
    const element = parcours?.timeline[0].elements[0];
    expect(element?.confiance).toEqual({ niveau: 'suggestion' });
    expect(element?.lienExterne).toEqual({
      url: 'https://example.com/recherche',
      fournisseur: 'Inconnu (legacy)',
      typeLien: 'recherche',
    });
    expect(element).not.toHaveProperty('reservation');
  });

  it.each([
    'officiel',
    'billetterie',
    'reservation',
    'recherche',
    'carte',
  ] as const)(
    'conserve la nature legacy connue « %s » sous le nouveau contrat',
    async (typeLien) => {
      prismaMock.parcours.findFirst.mockResolvedValue({
        contenu: {
          ...parcoursValide,
          timeline: [
            {
              id: 'm-legacy-type',
              titre: 'Ancien parcours',
              elements: [
                {
                  id: 'e-legacy-type',
                  type: 'activite',
                  nom: 'Ancienne activité',
                  justification: 'ancienne donnée persistée',
                  reservation: {
                    lienExterne: 'https://example.test/action',
                    fournisseur: 'Ancien fournisseur',
                    typeLien,
                  },
                },
              ],
            },
          ],
        },
      });

      const parcours = await chargerParcours(PROPRIETAIRE, 'p1');
      const element = parcours?.timeline[0].elements[0];
      expect(element?.lienExterne).toEqual({
        url: 'https://example.test/action',
        fournisseur: 'Ancien fournisseur',
        typeLien,
      });
      expect(element).not.toHaveProperty('reservation');
    }
  );

  it('rabaisse un type de lien legacy inconnu vers recherche', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({
      contenu: {
        ...parcoursValide,
        timeline: [
          {
            id: 'm-legacy-inconnu',
            titre: 'Ancien parcours',
            elements: [
              {
                id: 'e-legacy-inconnu',
                type: 'activite',
                nom: 'Ancienne activité',
                justification: 'ancienne donnée persistée',
                reservation: {
                  lienExterne: 'https://example.test/action',
                  fournisseur: 'Ancien fournisseur',
                  typeLien: 'acheter',
                },
              },
            ],
          },
        ],
      },
    });

    const parcours = await chargerParcours(PROPRIETAIRE, 'p1');
    expect(parcours?.timeline[0].elements[0].lienExterne).toMatchObject({
      typeLien: 'recherche',
    });
  });

  it('neutralise un transport legacy avant de le rendre', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({
      contenu: {
        ...parcoursValide,
        timeline: [
          {
            id: 'm-transport-legacy',
            titre: 'TGV 8421 à 09:42',
            plage: {
              debut: '2026-09-10T09:42:00Z',
              fin: '2026-09-10T11:18:00Z',
            },
            elements: [
              {
                id: 'e-transport-legacy',
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
              },
            ],
          },
        ],
      },
    });

    const parcours = await chargerParcours(PROPRIETAIRE, 'p1');
    const moment = parcours?.timeline[0];
    const transport = moment?.elements[0];
    expect(moment).not.toHaveProperty('plage');
    expect(moment?.titre).toBe('Transport à organiser');
    expect(transport).toMatchObject({
      nom: 'Transport à organiser',
      confiance: { niveau: 'suggestion' },
      prix: 80,
      prixEstime: true,
      estAncre: false,
    });
    expect(transport).not.toHaveProperty('lieu');
    expect(transport).not.toHaveProperty('plage');
    expect(transport).not.toHaveProperty('reservation');
    expect(transport).not.toHaveProperty('lienExterne');
  });

  it('neutralise les preuves hôtelières legacy ambiguës avant toute réécriture', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({
      contenu: {
        ...parcoursValide,
        timeline: [
          {
            id: 'm-hotel-legacy',
            titre: 'Ancienne nuit',
            elements: [
              {
                id: 'hotel-legacy',
                type: 'hebergement',
                nom: 'Hôtel anciennement nommé',
                justification: 'ancienne donnée',
                confiance: {
                  niveau: 'verifie',
                  fournisseur: 'FauxSquare',
                  source: 'https://evil.test',
                  recupereLe: '2025-01-01T10:00:00.000Z',
                  identifiantExterne: 'faux',
                },
                reservation: {
                  lienExterne: 'https://evil.test/reserver',
                },
              },
            ],
          },
        ],
      },
    });
    prismaMock.parcours.findUnique.mockResolvedValue({
      user_id: PROPRIETAIRE,
    });

    const parcours = await chargerParcours(PROPRIETAIRE, 'p1');
    if (!parcours) throw new Error('parcours attendu');
    const hotel = parcours.timeline[0].elements[0];
    expect(hotel.confiance).toEqual({ niveau: 'suggestion' });
    expect(hotel.lienExterne).toBeUndefined();
    expect(hotel).not.toHaveProperty('reservation');

    await sauvegarderParcours(PROPRIETAIRE, parcours);
    const contenu =
      prismaMock.parcours.upsert.mock.calls[0][0].update.contenu;
    expect(contenu.timeline[0].elements[0].confiance).toEqual({
      niveau: 'suggestion',
    });
    expect(
      contenu.timeline[0].elements[0].lienExterne
    ).toBeUndefined();
  });

  it('lit un ancien parcours sans occupation ni séjour sans leur inventer de valeur', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({ contenu: parcoursValide });

    const parcours = await chargerParcours(PROPRIETAIRE, 'p1');

    expect(parcours?.contexte.occupationHebergement).toBeUndefined();
    expect(
      parcours?.timeline.flatMap((moment) => moment.elements)
        .some((element) => element.sejourHebergement !== undefined)
    ).toBe(false);
    expect(
      parcours?.timeline.flatMap((moment) => moment.elements)
        .some((element) => element.lienRechercheHebergement !== undefined)
    ).toBe(false);
  });

  it('relit puis réécrit un ancien parcours sans ajouter de données hôtelières', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({ contenu: parcoursValide });
    prismaMock.parcours.findUnique.mockResolvedValue({
      user_id: PROPRIETAIRE,
    });

    const parcours = await chargerParcours(PROPRIETAIRE, 'p1');
    if (!parcours) throw new Error('parcours attendu');
    await sauvegarderParcours(PROPRIETAIRE, parcours);

    const contenu =
      prismaMock.parcours.upsert.mock.calls[0][0].update.contenu;
    expect(contenu.contexte).not.toHaveProperty('occupationHebergement');
    expect(
      contenu.timeline.flatMap(
        (moment: {
          elements: Array<{
            sejourHebergement?: unknown;
            lienRechercheHebergement?: unknown;
          }>;
        }) =>
          moment.elements
      )
    ).not.toContainEqual(
      expect.objectContaining({ sejourHebergement: expect.anything() })
    );
    expect(
      contenu.timeline.flatMap(
        (moment: {
          elements: Array<{ lienRechercheHebergement?: unknown }>;
        }) => moment.elements
      )
    ).not.toContainEqual(
      expect.objectContaining({
        lienRechercheHebergement: expect.anything(),
      })
    );
  });
});

describe('listerParcours', () => {
  it('rend des résumés en français, du plus récent au plus ancien', async () => {
    const date = new Date('2026-07-23T12:00:00Z');
    prismaMock.parcours.findMany.mockResolvedValue([
      { id: 'p1', intention: 'vivre la NBA', visibilite: 'prive', updated_at: date },
    ]);
    await expect(listerParcours(PROPRIETAIRE)).resolves.toEqual([
      { id: 'p1', intention: 'vivre la NBA', visibilite: 'prive', misAJourLe: date },
    ]);
  });
});

describe('supprimerParcours', () => {
  it('rend true quand une ligne a été supprimée, false sinon', async () => {
    prismaMock.parcours.deleteMany.mockResolvedValueOnce({ count: 1 });
    await expect(supprimerParcours(PROPRIETAIRE, 'p1')).resolves.toBe(true);
    prismaMock.parcours.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(supprimerParcours(PROPRIETAIRE, 'absent')).resolves.toBe(false);
  });
});
