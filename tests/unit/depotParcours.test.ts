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
