import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const reel = await importOriginal<
    typeof import('../../server/services/claude/core.js')
  >();
  return { ...reel, callAI: vi.fn() };
});

const { callAI } = await import('../../server/services/claude/core.js');
const { avancerDialogue } = await import('../../server/agents/intake.js');
const { BriefSchema } = await import('../../server/agents/brief.js');

const BRIEF_DE_BASE = {
  intention: 'prendre le temps de voyager',
  avecQui: 'solo' as const,
  duree: { valeur: 4, unite: 'jours' as const },
  dates: {
    debut: '2027-05-10T00:00:00.000Z',
    fin: '2027-05-13T23:59:59.999Z',
  },
  lieux: [],
};

function sortieLLM(lieux: unknown): string {
  return JSON.stringify({
    reponse: 'Très bien.',
    brief: { lieux },
  });
}

beforeEach(() => {
  vi.mocked(callAI).mockReset();
});

describe('intake — localisations declarees typees', () => {
  it.each([
    {
      message: 'Je veux passer 4 jours à Paris',
      llm: [{ nom: 'Paris', type: 'ville', codePays: 'FR' }],
      attendu: [{ nom: 'Paris', type: 'ville' }],
    },
    {
      message: 'Je veux skier dans les Alpes',
      llm: [{ nom: 'Alpes', type: 'zone' }],
      attendu: [{ nom: 'Alpes', type: 'zone' }],
    },
    {
      message: 'Une semaine en Toscane',
      llm: [{ nom: 'Toscane', type: 'zone' }],
      attendu: [{ nom: 'Toscane', type: 'zone' }],
    },
    {
      message: 'Je veux voyager en France',
      llm: [{ nom: 'France', type: 'pays' }],
      attendu: [{ nom: 'France', type: 'pays', codePays: 'FR' }],
    },
    {
      message: 'Je veux partir dans les Pyrénées',
      llm: [{ nom: 'Pyrénées', type: 'zone' }],
      attendu: [{ nom: 'Pyrénées', type: 'zone' }],
    },
    {
      message: 'Je veux aller à Springfield',
      llm: [{ nom: 'Springfield', type: 'ville' }],
      attendu: [{ nom: 'Springfield', type: 'ville' }],
    },
  ])('$message conserve uniquement la semantique du message', async ({ message, llm, attendu }) => {
    vi.mocked(callAI).mockResolvedValueOnce(sortieLLM(llm));

    const resultat = await avancerDialogue(BRIEF_DE_BASE, message);

    expect(resultat.brief.lieux).toEqual(attendu);
    expect(resultat.estComplet).toBe(true);
    expect(resultat.etatDialogue).toBeUndefined();
  });

  it('une nature incertaine reste en cours et declenche une clarification structuree', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      sortieLLM([{ nom: 'Centre', type: 'inconnue', codePays: 'FR' }])
    );

    const resultat = await avancerDialogue(
      BRIEF_DE_BASE,
      'Je veux aller dans le Centre'
    );

    expect(resultat.brief.lieux).toEqual([
      { nom: 'Centre', type: 'inconnue' },
    ]);
    expect(resultat.estComplet).toBe(false);
    expect(resultat.etatDialogue).toEqual({
      champ: 'localisation',
      code: 'localisation_a_preciser',
      champCible: 'lieux',
      index: 0,
      nom: 'Centre',
    });
    expect(resultat.reponse).toContain('ville, d’un pays ou d’une zone');
    expect(() => BriefSchema.parse(resultat.brief)).toThrow();
  });

  it('resout la clarification sans nouvel appel LLM et sans changer le nom', async () => {
    const resultat = await avancerDialogue(
      {
        ...BRIEF_DE_BASE,
        lieux: [{ nom: 'Springfield', type: 'inconnue' }],
      },
      'Je parle d’une ville',
      {
        champ: 'localisation',
        code: 'localisation_a_preciser',
        champCible: 'lieux',
        index: 0,
        nom: 'Springfield',
      }
    );

    expect(resultat.brief.lieux).toEqual([
      { nom: 'Springfield', type: 'ville' },
    ]);
    expect(resultat.estComplet).toBe(true);
    expect(resultat.etatDialogue).toBeUndefined();
    expect(callAI).not.toHaveBeenCalled();
  });

  it('ne désynchronise pas l’état quand un champ de base reste prioritaire', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      sortieLLM([{ nom: 'Centre', type: 'inconnue' }])
    );

    const resultat = await avancerDialogue(
      { intention: 'partir dans le Centre' },
      'Je veux aller dans le Centre'
    );

    expect(resultat.brief.lieux).toEqual([{ nom: 'Centre', type: 'inconnue' }]);
    expect(resultat.estComplet).toBe(false);
    expect(resultat.etatDialogue).toBeUndefined();
  });

  it('ignore un nom LLM absent du message sans effacer la ville acquise', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      sortieLLM([{ nom: 'Lyon', type: 'ville' }])
    );
    const briefActuel = {
      ...BRIEF_DE_BASE,
      lieux: [{ nom: 'Paris', type: 'ville' as const }],
    };

    const resultat = await avancerDialogue(
      briefActuel,
      'Je veux surtout prendre mon temps'
    );

    expect(resultat.brief.lieux).toEqual(briefActuel.lieux);
  });
});
