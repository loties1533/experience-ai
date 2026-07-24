// =============================================
// EXPERIENCE AI — tests/unit/depotPartage.test.ts
// Le dépôt des liens de partage (ADR-0008) : émission, révocation, résolution
// d'un jeton. Prisma est mocké, comme dans les autres tests de dépôt.
// =============================================

import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  partageParcours: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    createMany: vi.fn(),
    deleteMany: vi.fn(),
  },
};
vi.mock('../../server/db/prisma.js', () => ({ default: prismaMock }));

const {
  listerLiens,
  synchroniserLiens,
  revoquerTousLesLiens,
  chargerParcoursParJeton,
} = await import('../../server/depots/depotPartage.js');
const { ParcoursSchema } = await import('../../server/domaine/parcours/index.js');

const PARCOURS = ParcoursSchema.parse({
  id: 'evg-max',
  intention: { texte: "fêter l'EVG de Max" },
  contexte: { avecQui: 'amis', duree: { valeur: 2, unite: 'jours' } },
  participants: [
    { id: 'p-hugo', nom: 'Hugo', role: 'organisateur' },
    { id: 'p-max', nom: 'Max', role: 'heros' },
  ],
  budget: { mode: 'partage' },
  visibilite: 'surprise',
});

const ligne = (participantId: string, jeton: string) => ({
  participant_id: participantId,
  jeton,
  created_at: new Date('2026-07-24T10:00:00Z'),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('synchroniserLiens — un jeton par participant autorisé', () => {

  it('émet un jeton pour qui n’en a pas encore', async () => {
    prismaMock.partageParcours.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([ligne('p-hugo', 'jeton-hugo')]);

    await synchroniserLiens('evg-max', ['p-hugo']);

    const cree = prismaMock.partageParcours.createMany.mock.calls[0][0].data;
    expect(cree).toHaveLength(1);
    expect(cree[0].participant_id).toBe('p-hugo');
    // 32 octets en base64url : long, sans caractère exotique, et pas l'id du parcours.
    expect(cree[0].jeton).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cree[0].jeton).not.toContain('evg-max');
  });

  it('ne régénère pas un lien déjà émis — celui qui l’a reçu doit continuer d’entrer', async () => {
    prismaMock.partageParcours.findMany.mockResolvedValue([ligne('p-hugo', 'jeton-hugo')]);

    await synchroniserLiens('evg-max', ['p-hugo']);

    expect(prismaMock.partageParcours.createMany).not.toHaveBeenCalled();
    expect(prismaMock.partageParcours.deleteMany).not.toHaveBeenCalled();
  });

  it('révoque le lien de qui n’y a plus droit (le héros quand on passe en surprise)', async () => {
    prismaMock.partageParcours.findMany.mockResolvedValue([
      ligne('p-hugo', 'jeton-hugo'),
      ligne('p-max', 'jeton-max'),
    ]);

    await synchroniserLiens('evg-max', ['p-hugo']);

    expect(prismaMock.partageParcours.deleteMany).toHaveBeenCalledWith({
      where: { jeton: { in: ['jeton-max'] } },
    });
  });

  it('deux jetons émis à la suite ne se ressemblent pas', async () => {
    prismaMock.partageParcours.findMany.mockResolvedValue([]);
    await synchroniserLiens('evg-max', ['p-hugo', 'p-leo']);

    const cree = prismaMock.partageParcours.createMany.mock.calls[0][0].data;
    expect(cree[0].jeton).not.toBe(cree[1].jeton);
  });
});

describe('revoquerTousLesLiens', () => {
  it('coupe tous les accès d’un coup', async () => {
    await revoquerTousLesLiens('evg-max');
    expect(prismaMock.partageParcours.deleteMany).toHaveBeenCalledWith({
      where: { parcours_id: 'evg-max' },
    });
  });
});

describe('chargerParcoursParJeton — reconnaître le porteur', () => {

  it('rend le parcours, son propriétaire et le participant désigné', async () => {
    prismaMock.partageParcours.findUnique.mockResolvedValue({
      participant_id: 'p-hugo',
      parcours: { user_id: 'user-1', contenu: PARCOURS },
    });

    await expect(chargerParcoursParJeton('jeton-hugo')).resolves.toEqual({
      parcours: PARCOURS,
      proprietaireId: 'user-1',
      participantId: 'p-hugo',
    });
  });

  it('rend null sur un jeton inconnu — révoqué et inventé sont indiscernables', async () => {
    prismaMock.partageParcours.findUnique.mockResolvedValue(null);
    await expect(chargerParcoursParJeton('jeton-inconnu')).resolves.toBeNull();
  });

  it('rejette un contenu corrompu au lieu de le laisser passer', async () => {
    prismaMock.partageParcours.findUnique.mockResolvedValue({
      participant_id: 'p-hugo',
      parcours: { user_id: 'user-1', contenu: { id: 'evg-max' } },
    });
    await expect(chargerParcoursParJeton('jeton-hugo')).rejects.toThrow('corrompu');
  });
});

describe('listerLiens', () => {
  it('rend les liens en français, prêts pour l’organisateur', async () => {
    prismaMock.partageParcours.findMany.mockResolvedValue([ligne('p-hugo', 'jeton-hugo')]);
    await expect(listerLiens('evg-max')).resolves.toEqual([
      { participantId: 'p-hugo', jeton: 'jeton-hugo', creeLe: new Date('2026-07-24T10:00:00Z') },
    ]);
  });
});
