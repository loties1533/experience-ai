import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const reel = await importOriginal<
    typeof import('../../server/services/claude/core.js')
  >();
  return { ...reel, callAI: vi.fn() };
});

const { callAI } = await import('../../server/services/claude/core.js');
const { avancerDialogue } = await import('../../server/agents/intake.js');
const { BriefSchema, prochainChampBase } = await import(
  '../../server/agents/brief.js'
);
const { preparerGeneration } = await import(
  '../../server/agents/generation/preparation.js'
);
const { facettesObjectivablesDuBrief } = await import(
  '../../server/agents/generation/decouverteDestinations.js'
);

function sortie(brief: unknown = {}, reponse = 'Peux-tu préciser ta demande ?') {
  return JSON.stringify({ reponse, brief });
}

function nombreQuestions(reponse: string): number {
  return reponse.match(/\?/g)?.length ?? 0;
}

const BRIEF_COMPLET = {
  intention: 'gastronomie et culture',
  avecQui: 'solo' as const,
  duree: { valeur: 3, unite: 'jours' as const },
  dates: {
    debut: '2026-10-10T00:00:00.000Z',
    fin: '2026-10-12T23:59:59.999Z',
  },
  lieux: [{ nom: 'Paris', type: 'ville' as const }],
};

beforeEach(() => {
  vi.mocked(callAI).mockReset();
});

describe('PR7 — décision serveur du prochain champ', () => {
  it('suit intention → avecQui → durée → dates indépendamment de la prose du modèle', () => {
    expect(prochainChampBase({})).toBe('intention');
    expect(prochainChampBase({ intention: 'voir la mer' })).toBe('avecQui');
    expect(
      prochainChampBase({ intention: 'voir la mer', avecQui: 'solo' })
    ).toBe('duree');
    expect(
      prochainChampBase({
        intention: 'voir la mer',
        avecQui: 'solo',
        duree: { valeur: 3, unite: 'jours' },
      })
    ).toBe('dates');
  });

  it('remplace une double question LLM par l’unique champ essentiel suivant', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      sortie({}, 'Avec qui pars-tu et combien de temps souhaites-tu partir ?')
    );

    const resultat = await avancerDialogue(
      { intention: 'découvrir la culture locale' },
      'Je veux garder cette envie.'
    );

    expect(resultat.reponse).toBe(
      'Tu seras seul, en couple, en famille, entre amis ou en groupe ?'
    );
    expect(nombreQuestions(resultat.reponse)).toBe(1);
  });

  it('reste neutre pour une soirée improvisée', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      sortie({
        intention: {
          texte: 'une soirée improvisée',
          nature: 'remplacement',
        },
      })
    );

    const resultat = await avancerDialogue(
      {},
      'Je veux une soirée improvisée'
    );

    expect(resultat.reponse).toBe(
      'Tu seras seul, en couple, en famille, entre amis ou en groupe ?'
    );
    expect(resultat.reponse).not.toMatch(/voyage|voyager|partir/i);
    expect(nombreQuestions(resultat.reponse)).toBe(1);
  });

  it('confirme une date candidate de soirée improvisée sans vocabulaire de voyage', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(sortie({}));

    const resultat = await avancerDialogue(
      {
        intention: 'une soirée improvisée',
        avecQui: 'amis',
        duree: { valeur: 1, unite: 'jours' },
      },
      'Le 20 novembre 2026.'
    );

    expect(resultat.etatDialogue).toMatchObject({
      champ: 'dates',
      valeurCandidate: {
        debut: '2026-11-20T00:00:00.000Z',
      },
    });
    expect(resultat.reponse).toBe(
      'Tu confirmes donc le 20 novembre 2026 ? Réponds « oui » pour confirmer, ou donne une autre date.'
    );
    expect(resultat.reponse).not.toMatch(/voyage|voyager|partir/i);
    expect(nombreQuestions(resultat.reponse)).toBe(1);
  });

  it('reste neutre pour un EVG local', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      sortie({
        intention: {
          texte: 'organiser un EVG local',
          nature: 'remplacement',
        },
      })
    );

    const resultat = await avancerDialogue({}, 'Je veux organiser un EVG local');

    expect(resultat.reponse).toBe(
      'Tu seras seul, en couple, en famille, entre amis ou en groupe ?'
    );
    expect(resultat.reponse).not.toMatch(/voyage|voyager|partir/i);
    expect(nombreQuestions(resultat.reponse)).toBe(1);
  });

  it('conserve l’intention explicite verbatim quand le fournisseur l’omet', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(sortie({}));

    const resultat = await avancerDialogue({}, 'Je veux un week-end romantique');

    expect(resultat.brief.intention).toBe('Je veux un week-end romantique');
    expect(resultat.reponse).toContain('seul, en couple');
  });

  it.each([
    ['absente', {}],
    [
      'malformée',
      {
        intention: 'Je veux aller 3 jours à Paris en octobre avec ma femme',
        duree: { valeur: 3, unite: 'jours' },
        lieux: [{ nom: 'Paris', type: 'ville' }],
      },
    ],
  ])(
    'n’utilise pas le message mixte comme intention verbatim quand l’intention LLM est %s',
    async (_cas, briefExtrait) => {
      vi.mocked(callAI).mockResolvedValueOnce(sortie(briefExtrait));

      const resultat = await avancerDialogue(
        {},
        'Je veux aller 3 jours à Paris en octobre avec ma femme'
      );

      expect(resultat.brief.intention).toBeUndefined();
      expect(resultat.reponse).toBe('Qu’as-tu envie de vivre ?');
      expect(resultat.reponse).not.toMatch(/Paris|3 jours|octobre|femme/i);
      expect(nombreQuestions(resultat.reponse)).toBe(1);
    }
  );

  it('priorise la durée essentielle sur une préférence facultative proposée par le modèle', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      sortie({}, 'Quel type de musée et quel type de restaurant préfères-tu ?')
    );

    const resultat = await avancerDialogue(
      { intention: 'gastronomie et culture', avecQui: 'couple' },
      'Je n’ai pas de préférence particulière.'
    );

    expect(resultat.reponse).toBe('Sur combien de temps veux-tu organiser ça ?');
    expect(nombreQuestions(resultat.reponse)).toBe(1);
  });

  it('remplace un tour générique vide par la question de dates ciblée', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(sortie());

    const resultat = await avancerDialogue(
      {
        intention: 'plage et gastronomie',
        avecQui: 'amis',
        duree: { valeur: 5, unite: 'jours' },
      },
      'Je veux conserver exactement cette envie.'
    );

    expect(resultat.reponse).toBe(
      'À quelle date souhaites-tu le faire, même approximativement ?'
    );
    expect(resultat.reponse).not.toContain('préciser ta demande');
  });

  it('ne crée aucune question facultative quand tous les champs essentiels sont présents', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      sortie({}, 'Quel restaurant préfères-tu ? Et quel musée veux-tu voir ?')
    );

    const resultat = await avancerDialogue(
      BRIEF_COMPLET,
      'Je confirme ce cadrage.'
    );

    expect(resultat.estComplet).toBe(true);
    expect(resultat.reponse).toBe(
      'Je n’ai pas pu appliquer ce changement ; le cadrage confirmé reste inchangé.'
    );
    expect(nombreQuestions(resultat.reponse)).toBe(0);
  });
});

describe('PR7 — protection des champs acquis', () => {
  it.each([
    ['avec ma femme', 'couple'],
    ['avec mon mari', 'couple'],
    ['avec mon épouse', 'couple'],
    ['avec mon époux', 'couple'],
    ['avec mes enfants', 'famille'],
    ['avec mon fils', 'famille'],
    ['avec ma fille', 'famille'],
  ] as const)(
    'reconnaît la preuve relationnelle explicite « %s » comme %s',
    async (message, avecQui) => {
      vi.mocked(callAI).mockResolvedValueOnce(sortie({ avecQui }));

      const resultat = await avancerDialogue(
        { intention: 'découvrir une nouvelle ville' },
        `Je souhaite le faire ${message}.`
      );

      expect(resultat.brief.avecQui).toBe(avecQui);
    }
  );

  it.each(['avec une copine', 'avec un copain'])(
    'ne transforme pas automatiquement « %s » en couple',
    async (message) => {
      vi.mocked(callAI).mockResolvedValueOnce(sortie({ avecQui: 'couple' }));

      const resultat = await avancerDialogue(
        { intention: 'découvrir une nouvelle ville' },
        `Je souhaite le faire ${message}.`
      );

      expect(resultat.brief.avecQui).not.toBe('couple');
    }
  );

  it('n’accepte aucune catégorie relationnelle sans preuve dans le message', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(sortie({ avecQui: 'famille' }));

    const resultat = await avancerDialogue(
      { intention: 'découvrir une nouvelle ville' },
      'Je préfère un rythme tranquille.'
    );

    expect(resultat.brief.avecQui).toBeUndefined();
  });

  it('ne rouvre pas un accompagnement déjà confirmé sans nouvelle preuve', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(sortie({ avecQui: 'couple' }));

    const resultat = await avancerDialogue(
      BRIEF_COMPLET,
      'Je préfère simplement un restaurant tranquille.'
    );

    expect(resultat.brief.avecQui).toBe('solo');
    expect(resultat.reponse).not.toMatch(/avec qui/i);
  });

  it('ignore avecQui, durée et dates réémis sans preuve dans le dernier message', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      sortie({
        avecQui: 'groupe',
        duree: { valeur: 7, unite: 'jours' },
        dates: {
          debut: '2027-01-01T00:00:00.000Z',
          fin: '2027-01-07T23:59:59.999Z',
        },
      })
    );

    const resultat = await avancerDialogue(
      BRIEF_COMPLET,
      'Je préfère simplement un restaurant tranquille.'
    );

    expect(resultat.brief.avecQui).toBe('solo');
    expect(resultat.brief.duree).toEqual({ valeur: 3, unite: 'jours' });
    expect(resultat.brief.dates).toEqual(BRIEF_COMPLET.dates);
    expect(resultat.reponse).not.toMatch(/avec qui|combien de temps|quelle date/i);
  });

  it('conserve les corrections explicitement déclarées', async () => {
    vi.mocked(callAI)
      .mockResolvedValueOnce(sortie({ avecQui: 'groupe' }))
      .mockResolvedValueOnce(
        sortie({ duree: { valeur: 5, unite: 'jours' } })
      );

    const groupe = await avancerDialogue(
      BRIEF_COMPLET,
      'Finalement, je pars en groupe.'
    );
    const cinqJours = await avancerDialogue(
      groupe.brief,
      'Finalement, je pars cinq jours.'
    );

    expect(groupe.brief.avecQui).toBe('groupe');
    expect(cinqJours.brief.duree).toEqual({ valeur: 5, unite: 'jours' });
  });

  it('interprète « dans 2 semaines » comme une correction de dates, pas de durée', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      sortie({
        duree: { valeur: 2, unite: 'semaines' },
        dates: {
          debut: '2026-10-25T00:00:00.000Z',
          fin: '2026-10-27T23:59:59.999Z',
        },
      })
    );

    const resultat = await avancerDialogue(
      BRIEF_COMPLET,
      'Finalement, je pars dans 2 semaines.'
    );

    expect(resultat.brief.duree).toEqual({ valeur: 3, unite: 'jours' });
    expect(resultat.brief.dates).toEqual({
      debut: '2026-10-25T00:00:00.000Z',
      fin: '2026-10-27T23:59:59.999Z',
    });
  });
});

describe('PR7 — clarifications PR5 et PR6', () => {
  it('cadre « week-end romantique » sans déduire le couple puis clarifie l’intention sans facette', async () => {
    vi.mocked(callAI)
      .mockResolvedValueOnce(
        sortie({
          intention: { texte: 'un week-end romantique', nature: 'remplacement' },
          avecQui: 'couple',
          duree: { valeur: 2, unite: 'jours' },
        })
      )
      .mockResolvedValueOnce(sortie({ avecQui: 'couple' }))
      .mockResolvedValueOnce(
        sortie({ duree: { valeur: 2, unite: 'jours' } })
      )
      .mockResolvedValueOnce(sortie({}));

    const envie = await avancerDialogue({}, 'Je veux un week-end romantique');
    const accompagnement = await avancerDialogue(envie.brief, 'En couple.');
    const duree = await avancerDialogue(accompagnement.brief, 'Deux jours.');
    const dates = await avancerDialogue(
      duree.brief,
      'Du 24 au 25 octobre 2026.'
    );
    const brief = BriefSchema.parse(dates.brief);
    const cadrage = await preparerGeneration(brief);

    expect(envie.reponse).toContain('seul, en couple');
    expect(envie.brief.avecQui).toBeUndefined();
    expect(envie.brief.duree).toBeUndefined();
    expect(accompagnement.reponse).toBe(
      'Sur combien de temps veux-tu organiser ça ?'
    );
    expect(duree.reponse).toContain('À quelle date');
    expect(dates.estComplet).toBe(true);
    expect([envie.reponse, accompagnement.reponse, duree.reponse, dates.reponse].every(
      (reponse) => nombreQuestions(reponse) <= 1
    )).toBe(true);
    expect(facettesObjectivablesDuBrief(brief)).toEqual([]);
    expect(cadrage).toMatchObject({
      type: 'clarification_requise',
      clarification: { code: 'intention_a_preciser' },
    });
  });

  it('conserve la confirmation durée/plage PR6 sans appel LLM supplémentaire', async () => {
    const brief = {
      intention: 'gastronomie et culture',
      avecQui: 'solo' as const,
      duree: { valeur: 5, unite: 'jours' as const },
      lieux: [{ nom: 'Paris', type: 'ville' as const }],
    };
    vi.mocked(callAI).mockResolvedValueOnce(sortie({}));

    const contradiction = await avancerDialogue(
      brief,
      'Du 10 au 20 novembre 2026.'
    );
    const appelsAvantConfirmation = vi.mocked(callAI).mock.calls.length;
    const confirmation = await avancerDialogue(
      contradiction.brief,
      'Oui.',
      contradiction.etatDialogue
    );

    expect(contradiction.etatDialogue).toMatchObject({
      champ: 'dates',
      dureeCandidate: { valeur: 11, unite: 'jours' },
    });
    expect(confirmation.brief.duree).toEqual({ valeur: 11, unite: 'jours' });
    expect(confirmation.brief.dates).toEqual({
      debut: '2026-11-10T00:00:00.000Z',
      fin: '2026-11-20T23:59:59.999Z',
    });
    expect(vi.mocked(callAI).mock.calls).toHaveLength(appelsAvantConfirmation);
  });
});
