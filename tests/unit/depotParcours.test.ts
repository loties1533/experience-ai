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
              reservation: {
                lienExterne:
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
    expect(element?.reservation).toEqual({
      lienExterne: 'https://example.com/recherche',
      fournisseur: 'Inconnu (legacy)',
      typeLien: 'recherche',
    });
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
    expect(hotel.reservation).toBeUndefined();

    await sauvegarderParcours(PROPRIETAIRE, parcours);
    const contenu =
      prismaMock.parcours.upsert.mock.calls[0][0].update.contenu;
    expect(contenu.timeline[0].elements[0].confiance).toEqual({
      niveau: 'suggestion',
    });
    expect(
      contenu.timeline[0].elements[0].reservation
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
