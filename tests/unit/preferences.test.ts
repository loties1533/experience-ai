import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = {
  preferenceParcours: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
};
vi.mock('../../server/db/prisma.js', () => ({ default: prismaMock }));

vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/claude/core.js')>();
  return { ...reel, callAI: vi.fn(), callAIAvecOutils: vi.fn() };
});

const { chargerPreferences, sauvegarderPreferences } = await import('../../server/depots/depotPreferences.js');
const { genererParcours } = await import('../../server/agents/generation.js');
const { BriefSchema } = await import('../../server/agents/brief.js');
const { callAIAvecOutils } = await import('../../server/services/claude/core.js');

const PROPRIETAIRE = 'user-1';
const preferencesValides = {
  ambiances: ['festif'],
  rythme: 'detendu' as const,
  contraintes: ['végétarien'],
  lieuxFavoris: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('depotPreferences — mémoire simple (doc 07)', () => {
  it('rend null quand rien n’est encore renseigné', async () => {
    prismaMock.preferenceParcours.findUnique.mockResolvedValue(null);
    await expect(chargerPreferences(PROPRIETAIRE)).resolves.toBeNull();
  });

  it('repart de zéro (null) sur un contenu illisible au lieu de bloquer', async () => {
    prismaMock.preferenceParcours.findUnique.mockResolvedValue({ contenu: { rythme: 'frénétique' } });
    await expect(chargerPreferences(PROPRIETAIRE)).resolves.toBeNull();
  });

  it('sauvegarde en revalidant le contenu', async () => {
    prismaMock.preferenceParcours.upsert.mockResolvedValue({});
    const rendu = await sauvegarderPreferences(PROPRIETAIRE, preferencesValides);
    expect(rendu.contraintes).toEqual(['végétarien']);
    expect(prismaMock.preferenceParcours.upsert).toHaveBeenCalledOnce();
  });
});

describe('génération — les préférences orientent, le brief prime', () => {
  const brief = BriefSchema.parse({
    intention: 'vivre la NBA',
    avecQui: 'solo',
    duree: { valeur: 3, unite: 'jours' },
    lieux: [{ nom: 'Boston', type: 'ville', codePays: 'US' }],
  });
  const sortieMinimale = JSON.stringify({
    moments: [
      {
        titre: 'Soirée',
        elements: [{ ref: 'e1', type: 'activite', nom: 'Match', justification: 'le cœur de l’intention' }],
      },
    ],
  });

  it('injecte les préférences dans le prompt quand elles existent', async () => {
    vi.mocked(callAIAvecOutils).mockResolvedValue(sortieMinimale);
    await genererParcours(brief, preferencesValides);
    const prompt = vi.mocked(callAIAvecOutils).mock.calls[0][0];
    expect(prompt).toContain('végétarien');
    expect(prompt).toContain('le brief prime');
  });

  it('fonctionne sans préférences (aucune mention dans le prompt)', async () => {
    vi.mocked(callAIAvecOutils).mockResolvedValue(sortieMinimale);
    await genererParcours(brief, null);
    expect(vi.mocked(callAIAvecOutils).mock.calls[0][0]).not.toContain('Préférences');
  });
});
