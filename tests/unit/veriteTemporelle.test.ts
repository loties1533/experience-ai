import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const reel = await importOriginal<
    typeof import('../../server/services/claude/core.js')
  >();
  return { ...reel, callAI: vi.fn(), callAIAvecOutils: vi.fn() };
});

const { rechercherEvenementsPredictHQEventFirst } = vi.hoisted(() => ({
  rechercherEvenementsPredictHQEventFirst: vi.fn(),
}));
vi.mock('../../server/services/predictHQ.js', () => ({
  rechercherEvenementsPredictHQEventFirst,
}));

const { callAI } = await import('../../server/services/claude/core.js');
const {
  BriefSchema,
  calculerDates,
  normaliserDatesBrief,
} = await import('../../server/agents/brief.js');
const { avancerDialogue } = await import('../../server/agents/intake.js');
const { preparerGeneration } = await import(
  '../../server/agents/generation/preparation.js'
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-11T10:00:00.000Z'));
  vi.mocked(callAI).mockResolvedValue(
    JSON.stringify({ reponse: 'Parfait.', brief: {} })
  );
});

afterEach(() => {
  vi.useRealTimers();
});

function datesCalculees(
  debut: string,
  duree: { valeur: number; unite: 'jours' | 'semaines' }
) {
  return normaliserDatesBrief({ dates: calculerDates(debut, duree) }).dates;
}

async function datesDepuisMessage(message: string, dureeJours = 11) {
  const etape = await avancerDialogue(
    {
      intention: 'un voyage daté',
      avecQui: 'solo',
      duree: { valeur: dureeJours, unite: 'jours' },
      lieux: [{ nom: 'Paris', type: 'ville' }],
    },
    message
  );
  return etape.brief.dates;
}

describe('PR6 — nombre exact de dates civiles', () => {
  it('3 jours à partir du 10 octobre couvrent les 10, 11 et 12', () => {
    expect(
      datesCalculees('2026-10-10T00:00:00.000Z', {
        valeur: 3,
        unite: 'jours',
      })
    ).toEqual({
      debut: '2026-10-10T00:00:00.000Z',
      fin: '2026-10-12T23:59:59.999Z',
    });
  });

  it('1 semaine à partir du 5 octobre couvre exactement le 5 au 11', () => {
    expect(
      datesCalculees('2026-10-05T00:00:00.000Z', {
        valeur: 1,
        unite: 'semaines',
      })
    ).toEqual({
      debut: '2026-10-05T00:00:00.000Z',
      fin: '2026-10-11T23:59:59.999Z',
    });
  });

  it('5 jours à partir du 20 septembre couvrent exactement le 20 au 24', () => {
    expect(
      datesCalculees('2026-09-20T00:00:00.000Z', {
        valeur: 5,
        unite: 'jours',
      })
    ).toEqual({
      debut: '2026-09-20T00:00:00.000Z',
      fin: '2026-09-24T23:59:59.999Z',
    });
  });
});

describe('PR6 — plages françaises explicites autoritatives', () => {
  it('conserve « du 10 au 20 novembre » comme plage complète', async () => {
    await expect(datesDepuisMessage('du 10 au 20 novembre')).resolves.toEqual({
      debut: '2026-11-10T00:00:00.000Z',
      fin: '2026-11-20T23:59:59.999Z',
    });
  });

  it('conserve l’année explicite de « du 10 au 20 novembre 2026 »', async () => {
    await expect(
      datesDepuisMessage('du 10 au 20 novembre 2026')
    ).resolves.toEqual({
      debut: '2026-11-10T00:00:00.000Z',
      fin: '2026-11-20T23:59:59.999Z',
    });
  });

  it('traite le passage octobre → novembre', async () => {
    await expect(
      datesDepuisMessage('du 28 octobre au 3 novembre', 7)
    ).resolves.toEqual({
      debut: '2026-10-28T00:00:00.000Z',
      fin: '2026-11-03T23:59:59.999Z',
    });
  });

  it('traite le passage décembre → janvier sans inverser la plage', async () => {
    await expect(
      datesDepuisMessage('du 28 décembre au 3 janvier', 7)
    ).resolves.toEqual({
      debut: '2026-12-28T00:00:00.000Z',
      fin: '2027-01-03T23:59:59.999Z',
    });
  });

  it('la plage déterministe prime sur une date isolée erronée du LLM', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({
        reponse: 'Tu pars donc le 20 novembre ?',
        brief: {
          dates: {
            debut: '2026-11-20T00:00:00.000Z',
            fin: '2026-12-01T00:00:00.000Z',
          },
        },
      })
    );
    await expect(
      datesDepuisMessage('du 10 au 20 novembre 2026')
    ).resolves.toEqual({
      debut: '2026-11-10T00:00:00.000Z',
      fin: '2026-11-20T23:59:59.999Z',
    });
  });

  it('une réponse ultérieure sans nouvelle date ne détruit pas la plage acquise', async () => {
    const premier = await avancerDialogue(
      {
        intention: 'un voyage daté',
        avecQui: 'solo',
        duree: { valeur: 11, unite: 'jours' },
        lieux: [{ nom: 'Paris', type: 'ville' }],
      },
      'du 10 au 20 novembre 2026'
    );
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({ reponse: 'Bien noté.', brief: {} })
    );
    const confirme = await avancerDialogue(premier.brief, 'Oui, je confirme.');
    expect(confirme.brief.dates).toEqual(premier.brief.dates);
  });

  it('clarifie une vraie contradiction durée/plage avant la génération', async () => {
    const contradiction = await avancerDialogue(
      {
        intention: 'un voyage daté',
        avecQui: 'solo',
        duree: { valeur: 5, unite: 'jours' },
        lieux: [{ nom: 'Paris', type: 'ville' }],
      },
      'du 10 au 20 novembre 2026'
    );
    expect(contradiction.estComplet).toBe(false);
    expect(contradiction.brief.dates).toBeUndefined();
    expect(contradiction.etatDialogue).toEqual({
      champ: 'dates',
      valeurCandidate: {
        debut: '2026-11-10T00:00:00.000Z',
        fin: '2026-11-20T23:59:59.999Z',
      },
      dureeCandidate: { valeur: 11, unite: 'jours' },
    });

    const confirme = await avancerDialogue(
      contradiction.brief,
      'Oui.',
      contradiction.etatDialogue
    );
    expect(confirme.estComplet).toBe(true);
    expect(confirme.brief.duree).toEqual({ valeur: 11, unite: 'jours' });
    expect(confirme.brief.dates).toEqual({
      debut: '2026-11-10T00:00:00.000Z',
      fin: '2026-11-20T23:59:59.999Z',
    });
  });
});

describe('PR6 — NBA event-first reçoit la plage utilisateur exacte', () => {
  it('préserve 10..20 novembre du dialogue jusqu’à PredictHQ', async () => {
    vi.mocked(callAI)
      .mockResolvedValueOnce(
        JSON.stringify({
          reponse: 'Avec qui pars-tu ?',
          brief: {
            intention: {
              texte: 'voir des matchs NBA',
              nature: 'remplacement',
            },
            lieux: [{ nom: 'États-Unis', type: 'pays', codePays: 'US' }],
          },
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          reponse: 'Combien de temps ?',
          brief: { avecQui: 'solo' },
        })
      )
      .mockResolvedValueOnce(
        JSON.stringify({
          reponse: 'Parfait.',
          brief: { duree: { valeur: 11, unite: 'jours' } },
        })
      );

    const dates = await avancerDialogue(
      {},
      'Je veux voir des matchs NBA du 10 au 20 novembre aux États-Unis'
    );
    const accompagnement = await avancerDialogue(dates.brief, 'Je pars seul.');
    const complet = await avancerDialogue(accompagnement.brief, '11 jours.');
    const brief = BriefSchema.parse(complet.brief);

    vi.mocked(rechercherEvenementsPredictHQEventFirst).mockResolvedValueOnce({
      statut: 'vide',
      resultats: [],
      recupereLe: '2026-08-11T10:00:00.000Z',
    });
    await preparerGeneration(brief);

    expect(brief.dates).toEqual({
      debut: '2026-11-10T00:00:00.000Z',
      fin: '2026-11-20T23:59:59.999Z',
    });
    expect(rechercherEvenementsPredictHQEventFirst).toHaveBeenCalledWith({
      requete: 'NBA',
      categorie: 'sports',
      dateDebut: '2026-11-10',
      dateFin: '2026-11-20',
      pays: 'US',
    });
  });
});
