import { describe, it, expect, vi, beforeEach } from 'vitest';

// On ne mocke QUE les appels LLM : parseJSON et sanitizeInput restent réels,
// puisque c'est justement la frontière de méfiance qu'on teste. L'orchestrateur
// passe par la voie OUTILLÉE (callAIAvecOutils) depuis qu'il cherche de vrais
// lieux ; l'intake et la modification, eux, n'ont rien à chercher.
vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/claude/core.js')>();
  return { ...reel, callAI: vi.fn(), callAIAvecOutils: vi.fn() };
});

const { callAI, callAIAvecOutils } = await import('../../server/services/claude/core.js');
const { champsManquants, reformulerBrief, BriefSchema, prochainChampBase } = await import('../../server/agents/brief.js');
const { avancerDialogue } = await import('../../server/agents/intake.js');
const { normaliserDatesBrief } = await import('../../server/agents/brief.js');
const { genererParcours } = await import('../../server/agents/generation.js');
const { interpreterDemande } = await import('../../server/agents/modification.js');
const { ParcoursSchema } = await import('../../server/domaine/parcours/index.js');

const briefComplet = BriefSchema.parse({
  intention: 'vivre la NBA',
  avecQui: 'solo',
  duree: { valeur: 21, unite: 'jours' },
  lieux: [{ nom: 'Boston', type: 'ville' }],
  budgetTotal: 5000,
});

beforeEach(() => {
  vi.mocked(callAI).mockReset();
  vi.mocked(callAIAvecOutils).mockReset();
});

describe('brief — cadrage (doc 05, étape 3)', () => {
  it('ne réclame que les champs requis manquants', () => {
    expect(champsManquants({})).toHaveLength(4);
    expect(champsManquants({ intention: 'vivre la NBA', avecQui: 'solo' }))
      .toEqual(['la durée', 'une date de départ, même approximative (à quel moment, pas d’où)']);
    // briefComplet n'a pas de dates : valide pour le domaine (BriefSchema), mais
    // le dialogue les réclame quand même avant de considérer la conversation close.
    expect(champsManquants(briefComplet)).toEqual(['une date de départ, même approximative (à quel moment, pas d’où)']);
  });

  it('reformule le brief en phrase affichable', () => {
    const phrase = reformulerBrief(briefComplet);
    expect(phrase).toContain('vivre la NBA');
    expect(phrase).toContain('en solo');
    expect(phrase).toContain('21 jours');
    // Sans dates arrêtées, la reformulation n'en invente aucune.
    expect(phrase).not.toContain('du 1');
  });

  it('tutoie l’utilisateur, jamais de vouvoiement', () => {
    const phrase = reformulerBrief(briefComplet);
    expect(phrase).toMatch(/^Tu veux/);
    expect(phrase).not.toMatch(/\bvous\b/i);
  });

  it('accorde la durée au singulier sous 2 (« 1 jour », pas « 1 jours »)', () => {
    const unJour = reformulerBrief(
      BriefSchema.parse({
        intention: 'organiser une journée surprise',
        avecQui: 'couple',
        duree: { valeur: 1, unite: 'jours' },
      })
    );
    expect(unJour).toContain('sur 1 jour');
    expect(unJour).not.toContain('sur 1 jours');
  });

  it('accepte les semaines comme unité de durée (« Vivre la NBA pendant 3 semaines »)', () => {
    const troisSemaines = reformulerBrief(
      BriefSchema.parse({
        intention: 'vivre la NBA',
        avecQui: 'solo',
        duree: { valeur: 3, unite: 'semaines' },
      })
    );
    expect(troisSemaines).toContain('sur 3 semaines');
  });

  it('annonce les dates quand le brief en porte (le festival d’Inès)', () => {
    const phrase = reformulerBrief(
      BriefSchema.parse({
        intention: 'vivre le festival sans rater mes artistes',
        avecQui: 'amis',
        duree: { valeur: 3, unite: 'jours' },
        dates: { debut: '2026-07-12T00:00:00Z', fin: '2026-07-14T23:00:00Z' },
      })
    );
    expect(phrase).toContain('12 juillet 2026');
    expect(phrase).toContain('14 juillet 2026');
  });
});

describe('brief F7-B — état déterministe du dialogue de base', () => {
  it('brief vide : réclame d’abord l’intention', () => {
    expect(prochainChampBase({})).toBe('intention');
  });

  it('intention présente : réclame avecQui', () => {
    expect(prochainChampBase({ intention: 'vivre la NBA' })).toBe('avecQui');
  });

  it('intention + avecQui : réclame la durée', () => {
    expect(prochainChampBase({ intention: 'vivre la NBA', avecQui: 'solo' })).toBe('duree');
  });

  it('intention + avecQui + durée : réclame les dates', () => {
    expect(
      prochainChampBase({
        intention: 'vivre la NBA',
        avecQui: 'solo',
        duree: { valeur: 3, unite: 'jours' },
      })
    ).toBe('dates');
  });

  it('les 4 champs présents : aucun champ de base à réclamer', () => {
    expect(
      prochainChampBase({
        ...briefComplet,
        dates: { debut: '2026-08-15T00:00:00.000Z', fin: '2026-08-29T00:00:00.000Z' },
      })
    ).toBeUndefined();
  });

  it('ordre stable même si les champs sont fournis dans un ordre différent', () => {
    expect(
      prochainChampBase({
        duree: { valeur: 3, unite: 'jours' },
        avecQui: 'solo',
      })
    ).toBe('intention');
  });

  it('les dates résolues déterministement par F7-A comptent comme dates valides', () => {
    const brief = normaliserDatesBrief({
      intention: 'vivre la NBA',
      avecQui: 'solo' as const,
      duree: { valeur: 1, unite: 'jours' as const },
      dates: { debut: '2026-08-15T00:00:00.000Z', fin: '2026-08-15T00:00:00.000Z' },
    });
    expect(prochainChampBase(brief)).toBeUndefined();
  });
});

describe('intake (IA de dialogue) — extraction validée, jamais de confiance aveugle', () => {
  it('consomme une clarification de préparation dans l’intake sans la faire entrer dans le Brief', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({
        reponse: 'Parfait, je note Paris.',
        brief: { lieux: [{ nom: 'Paris', type: 'ville' }] },
      })
    );
    const etape = await avancerDialogue(
      {
        intention: 'vivre la NBA',
        avecQui: 'solo',
        duree: { valeur: 3, unite: 'semaines' },
        dates: { debut: '2026-10-01T00:00:00.000Z', fin: '2026-10-21T23:59:59.999Z' },
      },
      'Paris',
      {
        champ: 'preparation_generation',
        code: 'zone_geographique_requise',
        champCible: 'lieux',
      }
    );

    expect(vi.mocked(callAI).mock.calls[0][0]).toContain('champ lieux demandé');
    expect(etape.brief.lieux).toEqual([{ nom: 'Paris', type: 'ville' }]);
    expect(etape.etatDialogue).toBeUndefined();
    expect(BriefSchema.safeParse(etape.brief).success).toBe(true);
  });

  it('consomme une clarification de période dans le champ dates', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({
        reponse: 'Parfait.',
        brief: {
          dates: {
            debut: '2027-01-05T00:00:00.000Z',
            fin: '2027-01-25T23:59:59.999Z',
          },
        },
      })
    );
    const etape = await avancerDialogue(
      {
        intention: 'faire un trek',
        avecQui: 'solo',
        duree: { valeur: 3, unite: 'semaines' },
      },
      'en janvier 2027',
      {
        champ: 'preparation_generation',
        code: 'periode_requise',
        champCible: 'dates',
      }
    );

    expect(vi.mocked(callAI).mock.calls[0][0]).toContain('champ dates demandé');
    expect(etape.brief.dates).toEqual({
      debut: '2027-01-05T00:00:00.000Z',
      fin: '2027-01-25T23:59:59.999Z',
    });
    expect(etape.etatDialogue).toBeUndefined();
  });

  it('consomme une clarification d’intention sans état résiduel', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({
        reponse: 'Parfait.',
        brief: {
          intention: {
            texte: 'la nature et le trek',
            nature: 'remplacement',
          },
        },
      })
    );
    const etape = await avancerDialogue(
      {
        intention: 'partir quelque part',
        avecQui: 'solo',
        duree: { valeur: 1, unite: 'semaines' },
        dates: {
          debut: '2027-01-05T00:00:00.000Z',
          fin: '2027-01-11T23:59:59.999Z',
        },
      },
      'plutôt la nature et le trek',
      {
        champ: 'preparation_generation',
        code: 'intention_a_preciser',
        champCible: 'intention',
      }
    );

    expect(vi.mocked(callAI).mock.calls[0][0]).toContain(
      'champ intention demandé'
    );
    expect(etape.brief.intention).toBe('la nature et le trek');
    expect(etape.etatDialogue).toBeUndefined();
  });

  it('fusionne l’extraction et pose la question suivante tant que le brief est incomplet', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'Avec qui partez-vous ?',
        brief: { intention: { texte: 'vivre la NBA', nature: 'remplacement' } },
      })
    );
    const etape = await avancerDialogue({}, 'je rêve de vivre la NBA');
    expect(etape.estComplet).toBe(false);
    expect(etape.brief.intention).toBe('vivre la NBA');
    expect(etape.reponse).toBe('Avec qui partez-vous ?');
  });

  it('propose une date candidate en attente de confirmation, puis la commet sur "oui" (doc 05, étape 4)', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({
        reponse: 'ok',
        brief: { duree: { valeur: 21, unite: 'jours' }, dateDebut: '2026-08-15T00:00:00Z' },
      })
    );
    const propose = await avancerDialogue(
      { intention: 'vivre la NBA', avecQui: 'solo' },
      'trois semaines, à partir du 15 août'
    );
    expect(propose.estComplet).toBe(false);
    expect(propose.brief.dates).toBeUndefined();
    expect(propose.etatDialogue).toEqual({
      champ: 'dates',
      valeurCandidate: { debut: '2026-08-15T00:00:00.000Z', fin: '2026-09-05T00:00:00.000Z' },
    });
    expect(propose.reponse).toContain('15 août');

    const confirme = await avancerDialogue(propose.brief, 'oui', propose.etatDialogue);
    expect(confirme.estComplet).toBe(true);
    expect(confirme.reponse).toContain('C’est bien ça ?'.replace('’', "'"));
    expect(confirme.brief.dates?.debut).toBe('2026-08-15T00:00:00.000Z');
    expect(confirme.etatDialogue).toBeUndefined();
  });

  it('rejette la candidate sur "non" et redemande la date, sans toucher au brief', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({ reponse: 'ok', brief: { dateDebut: '2026-08-15T00:00:00Z' } })
    );
    const propose = await avancerDialogue(
      { intention: 'vivre la NBA', avecQui: 'solo', duree: { valeur: 2, unite: 'semaines' } },
      'à partir du 15 août'
    );
    expect(propose.etatDialogue?.champ).toBe('dates');

    const rejette = await avancerDialogue(propose.brief, 'non', propose.etatDialogue);
    expect(rejette.brief.dates).toBeUndefined();
    expect(rejette.estComplet).toBe(false);
    expect(rejette.etatDialogue).toBeUndefined();
    expect(callAI).toHaveBeenCalledTimes(1); // "non" ne déclenche aucun appel LLM
  });

  it('remplace la candidate quand l’utilisateur donne une autre date pendant la clarification', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({ reponse: 'ok', brief: { dateDebut: '2026-08-15T00:00:00Z' } })
    );
    const propose = await avancerDialogue(
      { intention: 'vivre la NBA', avecQui: 'solo', duree: { valeur: 2, unite: 'semaines' } },
      'à partir du 15 août'
    );

    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({ reponse: 'ok', brief: { dateDebut: '2026-09-01T00:00:00Z' } })
    );
    const remplace = await avancerDialogue(propose.brief, 'plutôt le 1er septembre', propose.etatDialogue);
    expect(remplace.etatDialogue?.valeurCandidate.debut).toBe('2026-09-01T00:00:00.000Z');
    expect(remplace.brief.dates).toBeUndefined();
  });

  it('calcule la fin depuis le point de départ + la durée, sans jamais la confier au LLM', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({ reponse: 'ok', brief: { dateDebut: '2026-08-15T00:00:00Z' } })
    );
    const propose = await avancerDialogue(
      { intention: 'vivre la NBA', avecQui: 'solo', duree: { valeur: 2, unite: 'semaines' } },
      'à partir du 15 août'
    );
    expect(propose.etatDialogue?.valeurCandidate).toEqual({
      debut: '2026-08-15T00:00:00.000Z',
      fin: '2026-08-29T00:00:00.000Z',
    });

    const confirme = await avancerDialogue(propose.brief, 'oui', propose.etatDialogue);
    expect(confirme.estComplet).toBe(true);
    // La fin posée à minuit est étendue à la fin de sa journée par
    // `normaliserDatesBrief`, appliquée à la confirmation.
    expect(confirme.brief.dates).toEqual({
      debut: '2026-08-15T00:00:00.000Z',
      fin: '2026-08-29T23:59:59.999Z',
    });
  });

  it('structure une plage explicite ("du JJ/MM au JJ/MM") même si le LLM l’a comprise sans la mettre dans le JSON', async () => {
    // Constaté en recette live : le modèle reformule correctement les dates
    // dans "reponse" ("...tu pars du 15 août au 10 septembre...") sans jamais
    // les mettre dans "brief". Le filet déterministe ne dépend pas de lui.
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'Parfait ! Tu pars du 15 août au 10 septembre avec 8000 euros.',
        brief: { avecQui: 'solo', budgetTotal: 8000 },
      })
    );
    const etape = await avancerDialogue(
      { intention: 'vivre la NBA', duree: { valeur: 3, unite: 'semaines' } },
      'solo du 15/08/2026 au 10/09/2026 avec un budget de 8000 euros'
    );
    expect(etape.brief.dates).toEqual({
      debut: '2026-08-15T00:00:00.000Z',
      fin: '2026-09-10T00:00:00.000Z',
    });
    expect(etape.estComplet).toBe(true);
  });

  it('ignore une plage inversée ou absurde plutôt que de la structurer telle quelle', async () => {
    vi.mocked(callAI).mockResolvedValue(JSON.stringify({ reponse: 'ok', brief: {} }));
    const etape = await avancerDialogue(
      { intention: 'vivre la NBA', avecQui: 'solo', duree: { valeur: 1, unite: 'semaines' } },
      'du 10/09/2026 au 15/08/2026' // fin avant début
    );
    expect(etape.brief.dates).toBeUndefined();
    expect(etape.estComplet).toBe(false);
  });

  it('signale franchement quand une correction n’a rien changé, sans rejouer la même confirmation', async () => {
    const briefDejaComplet = {
      intention: 'vivre la NBA',
      avecQui: 'solo' as const,
      duree: { valeur: 2, unite: 'semaines' as const },
      dates: { debut: '2026-08-15T00:00:00.000Z', fin: '2026-08-29T00:00:00.000Z' },
    };
    vi.mocked(callAI).mockResolvedValue(JSON.stringify({ reponse: 'ok', brief: {} }));
    const etape = await avancerDialogue(briefDejaComplet, 'oui');
    expect(etape.estComplet).toBe(true);
    expect(etape.reponse).toContain('Je n’ai pas compris ce changement'.replace('’', "'"));
  });

  it('ignore une extraction invalide au lieu de la propager', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'Et la durée ?', brief: { avecQui: 'en jet privé', duree: 'longtemps' } })
    );
    const etape = await avancerDialogue({ intention: 'vivre la NBA' }, 'peu importe');
    expect(etape.brief).toEqual({ intention: 'vivre la NBA' });
    expect(etape.estComplet).toBe(false);
  });
});

describe('intake — fusion de l’intention (complément vs remplacement, discriminant validé par Zod)', () => {
  it('A. une précision ("assister à des matchs en direct") enrichit l’intention sans effacer la NBA', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({
        reponse: 'Tu pars combien de temps ?',
        brief: {
          intention: { texte: 'vivre la NBA', nature: 'remplacement' },
          duree: { valeur: 3, unite: 'semaines' },
        },
      })
    );
    const tour1 = await avancerDialogue({}, 'Vivre la NBA pendant 3 semaines');
    expect(tour1.brief.intention).toBe('vivre la NBA');

    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({
        reponse: 'Avec qui pars-tu ?',
        brief: {
          intention: { texte: 'assister à des matchs en direct', nature: 'complement' },
        },
      })
    );
    const tour2 = await avancerDialogue(tour1.brief, 'assister à des matchs en direct');
    expect(tour2.brief.intention).toContain('vivre la NBA');
    expect(tour2.brief.intention).toContain('assister à des matchs en direct');
  });

  it('B. une correction explicite ("finalement... voyage gastronomie") remplace l’ancienne intention', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({
        reponse: 'Avec qui pars-tu ?',
        brief: { intention: { texte: 'suivre la NBA', nature: 'remplacement' } },
      })
    );
    const tour1 = await avancerDialogue({}, 'Je veux suivre la NBA');
    expect(tour1.brief.intention).toBe('suivre la NBA');

    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({
        reponse: 'ok',
        brief: { intention: { texte: 'un voyage gastronomie', nature: 'remplacement' } },
      })
    );
    const tour2 = await avancerDialogue(tour1.brief, 'Finalement je veux un voyage gastronomie');
    expect(tour2.brief.intention).toBe('un voyage gastronomie');
    expect(tour2.brief.intention).not.toContain('NBA');
  });

  it('C. un message sans nouvelle information d’intention conserve l’intention existante', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({ reponse: 'Combien de temps ?', brief: { avecQui: 'solo' } })
    );
    const etape = await avancerDialogue({ intention: 'vivre la NBA' }, 'je suis seul');
    expect(etape.brief.intention).toBe('vivre la NBA');
  });

  it('ignore un discriminant "nature" mal formé plutôt que de le propager', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({
        reponse: 'ok',
        brief: { intention: { texte: 'vivre la NBA', nature: 'peut-etre' } },
      })
    );
    const etape = await avancerDialogue({}, 'je rêve de vivre la NBA');
    expect(etape.brief.intention).toBeUndefined();
  });
});

describe('intake F7-A — résolution déterministe des dates relatives, injectée avant le LLM', () => {
  it('résout "demain" avant l’appel au LLM et l’injecte dans le prompt', async () => {
    vi.mocked(callAI).mockResolvedValue(JSON.stringify({ reponse: 'ok', brief: {} }));
    await avancerDialogue(
      { intention: 'vivre la NBA', avecQui: 'solo', duree: { valeur: 3, unite: 'jours' } },
      'on part demain'
    );
    const prompt = vi.mocked(callAI).mock.calls[0][0];
    expect(prompt).toContain('Repère temporel :');
    expect(prompt).toMatch(/Dates déjà résolues.*du .*Z au .*Z/);
  });

  it('injecte toujours le repère temporel, même sans expression relative reconnue', async () => {
    vi.mocked(callAI).mockResolvedValue(JSON.stringify({ reponse: 'ok', brief: {} }));
    await avancerDialogue({ intention: 'vivre la NBA' }, 'je ne sais pas encore quand');
    const prompt = vi.mocked(callAI).mock.calls[0][0];
    expect(prompt).toContain('Repère temporel :');
    expect(prompt).not.toContain('Dates déjà résolues');
  });

  it('le brief reçoit les dates absolues résolues quand le LLM ne les structure pas', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'ok', brief: {} }) // le LLM répond sans reprendre "dates"
    );
    const etape = await avancerDialogue(
      { intention: 'vivre la NBA', avecQui: 'solo', duree: { valeur: 3, unite: 'jours' } },
      'on part demain'
    );
    expect(etape.brief.dates?.debut).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(etape.brief.dates?.fin).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(etape.estComplet).toBe(true);
  });

  it('un message sans expression relative conserve le comportement existant (pas de dates inventées)', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'Et la durée ?', brief: { avecQui: 'solo' } })
    );
    const etape = await avancerDialogue({ intention: 'vivre la NBA' }, 'je suis seul');
    expect(etape.brief.dates).toBeUndefined();
  });

  it('n’écrase jamais une date déjà arrêtée dans le brief, même si le message contient "demain"', async () => {
    const briefAvecDates = {
      intention: 'vivre la NBA',
      avecQui: 'solo' as const,
      duree: { valeur: 3, unite: 'jours' as const },
      dates: { debut: '2026-08-15T00:00:00.000Z', fin: '2026-08-17T23:59:59.999Z' },
    };
    vi.mocked(callAI).mockResolvedValue(JSON.stringify({ reponse: 'ok', brief: {} }));
    const etape = await avancerDialogue(briefAvecDates, 'ah non plutôt demain finalement');
    expect(etape.brief.dates).toEqual(briefAvecDates.dates);
  });
});

describe('intake F7-B — état déterministe du dialogue de base', () => {
  it('cible exactement le prochain champ de base manquant, jamais un champ déjà validé', async () => {
    vi.mocked(callAI).mockResolvedValue(JSON.stringify({ reponse: 'ok', brief: {} }));
    await avancerDialogue({ intention: 'vivre la NBA', avecQui: 'solo' }, 'osef');
    const prompt = vi.mocked(callAI).mock.calls[0][0];
    expect(prompt).toContain('Champ de base à demander maintenant, et uniquement celui-ci : la durée.');
    expect(prompt).toContain('Champs de base déjà validés (ne jamais les redemander) : l’intention, avec qui il part');
  });

  it('n’indique plus aucun champ de base à cibler une fois les 4 validés', async () => {
    vi.mocked(callAI).mockResolvedValue(JSON.stringify({ reponse: 'ok', brief: {} }));
    const briefAvecDates = {
      ...briefComplet,
      dates: { debut: '2026-08-15T00:00:00.000Z', fin: '2026-08-29T00:00:00.000Z' },
    };
    await avancerDialogue(briefAvecDates, 'et pour la suite ?');
    const prompt = vi.mocked(callAI).mock.calls[0][0];
    expect(prompt).toContain('Tous les champs de base sont déjà validés');
    expect(prompt).not.toContain('Champ de base à demander maintenant');
  });

  it('une réponse donnée une fois n’est jamais redemandée (intention conservée sur les tours suivants)', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({
        reponse: 'Avec qui pars-tu ?',
        brief: { intention: { texte: 'vivre la NBA', nature: 'remplacement' } },
      })
    );
    const premierTour = await avancerDialogue({}, 'je rêve de vivre la NBA');
    expect(premierTour.brief.intention).toBe('vivre la NBA');

    vi.mocked(callAI).mockResolvedValueOnce(
      JSON.stringify({ reponse: 'Combien de temps ?', brief: { avecQui: 'solo' } })
    );
    const deuxiemeTour = await avancerDialogue(premierTour.brief, 'seul');
    expect(deuxiemeTour.brief.intention).toBe('vivre la NBA');
    const prompt = vi.mocked(callAI).mock.calls[1][0];
    expect(prompt).toContain('Champ de base à demander maintenant, et uniquement celui-ci : avec qui il part.');
    expect(prompt).toContain('Champs de base déjà validés (ne jamais les redemander) : l’intention');
  });

  it('plusieurs champs de base fournis dans un même message sont tous conservés', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'ok',
        brief: {
          intention: { texte: 'vivre la NBA', nature: 'remplacement' },
          avecQui: 'famille',
          duree: { valeur: 10, unite: 'jours' },
        },
      })
    );
    const etape = await avancerDialogue({}, 'On veut vivre la NBA en famille pendant 10 jours');
    expect(etape.brief.intention).toBe('vivre la NBA');
    expect(etape.brief.avecQui).toBe('famille');
    expect(etape.brief.duree).toEqual({ valeur: 10, unite: 'jours' });
  });

  it('une correction explicite de avecQui remplace l’ancienne valeur', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'ok', brief: { avecQui: 'groupe' } })
    );
    const etape = await avancerDialogue(briefComplet, 'finalement on part à 4, en groupe');
    expect(etape.brief.avecQui).toBe('groupe');
  });

  it('une correction explicite de la durée remplace l’ancienne valeur', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'ok', brief: { duree: { valeur: 5, unite: 'jours' } } })
    );
    const etape = await avancerDialogue(briefComplet, 'plutôt 5 jours');
    expect(etape.brief.duree).toEqual({ valeur: 5, unite: 'jours' });
  });

  it('une correction explicite des dates remplace l’ancienne valeur', async () => {
    const briefAvecDates = {
      ...briefComplet,
      dates: { debut: '2026-08-15T00:00:00.000Z', fin: '2026-08-29T00:00:00.000Z' },
    };
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'ok',
        brief: { dates: { debut: '2026-08-22T00:00:00Z', fin: '2026-09-05T00:00:00Z' } },
      })
    );
    const etape = await avancerDialogue(briefAvecDates, 'pas demain, le week-end prochain');
    expect(etape.brief.dates?.debut).toBe('2026-08-22T00:00:00Z');
  });

  it('un message sans nouvelle information ne supprime aucun champ de base déjà validé', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'Et la durée ?', brief: {} })
    );
    const etape = await avancerDialogue(
      { intention: 'vivre la NBA', avecQui: 'solo' },
      'je ne sais pas trop'
    );
    expect(etape.brief).toEqual({ intention: 'vivre la NBA', avecQui: 'solo' });
  });

  it('tant qu’un champ de base manque, l’hébergement/transport ne prend jamais la main sur la question', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'Et la durée ?', brief: {} })
    );
    const etape = await avancerDialogue(
      {
        intention: 'vivre la NBA',
        avecQui: 'solo',
        hebergement: {
          necessaire: true,
          occupation: { statut: 'a_confirmer' },
          sejours: [],
        },
      },
      'osef'
    );
    expect(etape.reponse).toBe('Et la durée ?');
    expect(etape.reponse).not.toContain('adultes');
  });

  it('hébergement et transport restent atteignables une fois les 4 champs de base complets', async () => {
    vi.mocked(callAI).mockResolvedValue(JSON.stringify({ reponse: 'ok', brief: {} }));
    const etape = await avancerDialogue(
      {
        ...briefComplet,
        dates: { debut: '2026-08-15T00:00:00.000Z', fin: '2026-08-29T00:00:00.000Z' },
        hebergement: {
          necessaire: true,
          occupation: { statut: 'a_confirmer' },
          sejours: [],
        },
      },
      'oui il nous faut un hôtel'
    );
    expect(etape.reponse).toBe('Combien d’adultes séjourneront à l’hôtel ?');
  });
});

describe('intake hôtelier F3-C1 — questions explicites sans déduction', () => {
  const baseDialogue = {
    intention: 'un séjour culturel',
    avecQui: 'famille' as const,
    duree: { valeur: 3, unite: 'jours' as const },
    dates: {
      debut: '2026-08-10T00:00:00.000Z',
      fin: '2026-08-13T23:59:59.999Z',
    },
    lieux: [{ nom: 'Bordeaux', type: 'ville' }],
  };
  const sejour = {
    ville: 'Bordeaux',
    arrivee: '2026-08-10',
    depart: '2026-08-13',
  };

  it('demande les adultes en premier lorsque l’hébergement est nécessaire', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'Question du modèle', brief: {} })
    );

    const etape = await avancerDialogue(
      {
        ...baseDialogue,
        hebergement: {
          necessaire: true,
          occupation: { statut: 'a_confirmer' },
          sejours: [sejour],
        },
      },
      'oui, il nous faut un hôtel'
    );

    expect(etape.estComplet).toBe(false);
    expect(etape.reponse).toBe('Combien d’adultes séjourneront à l’hôtel ?');
  });

  it('conserve les adultes explicites puis demande les enfants', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'ok',
        brief: {
          hebergement: {
            necessaire: true,
            // Le modèle se trompe : seule la valeur réellement écrite dans
            // le message doit survivre.
            occupation: { statut: 'a_confirmer', adultes: 5 },
            sejours: [],
          },
        },
      })
    );

    const etape = await avancerDialogue(
      {
        ...baseDialogue,
        hebergement: {
          necessaire: true,
          occupation: { statut: 'a_confirmer' },
          sejours: [sejour],
        },
      },
      'Nous sommes 2 adultes'
    );

    expect(etape.brief.hebergement).toMatchObject({
      necessaire: true,
      occupation: { statut: 'a_confirmer', adultes: 2 },
      sejours: [sejour],
    });
    expect(etape.reponse).toContain('Combien d’enfants');
  });

  it('accepte une réponse numérique seule pour le champ hôtelier actuellement demandé', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'ok', brief: {} })
    );

    const etape = await avancerDialogue(
      {
        ...baseDialogue,
        hebergement: {
          necessaire: true,
          occupation: { statut: 'a_confirmer' },
          sejours: [sejour],
        },
      },
      '4'
    );

    expect(etape.brief.hebergement).toMatchObject({
      necessaire: true,
      occupation: { statut: 'a_confirmer', adultes: 4 },
    });
    expect(etape.reponse).toContain('Combien d’enfants');
  });

  it('ignore une réponse numérique seule quand aucune question hôtelière n’est active', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'Quel voyage imagines-tu ?',
        brief: {
          hebergement: {
            necessaire: true,
            occupation: { statut: 'a_confirmer', adultes: 2 },
          },
        },
      })
    );

    const etape = await avancerDialogue(baseDialogue, '2');

    expect(
      etape.brief.hebergement?.necessaire === true
        ? etape.brief.hebergement.occupation.adultes
        : undefined
    ).toBeUndefined();
  });

  it('redemande le nombre quand il est écrit en toutes lettres', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'ok',
        brief: {
          hebergement: {
            necessaire: true,
            occupation: { statut: 'a_confirmer', adultes: 4 },
          },
        },
      })
    );

    const etape = await avancerDialogue(
      {
        ...baseDialogue,
        hebergement: {
          necessaire: true,
          occupation: { statut: 'a_confirmer' },
          sejours: [sejour],
        },
      },
      'Nous sommes quatre adultes'
    );

    expect(
      etape.brief.hebergement?.necessaire === true
        ? etape.brief.hebergement.occupation.adultes
        : undefined
    ).toBeUndefined();
    expect(etape.reponse).toContain('Combien d’adultes');
  });

  it('conserve adultes et enfants puis demande les chambres', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'ok',
        brief: {
          hebergement: {
            necessaire: true,
            occupation: { statut: 'a_confirmer', enfants: 0 },
          },
        },
      })
    );

    const etape = await avancerDialogue(
      {
        ...baseDialogue,
        hebergement: {
          necessaire: true,
          occupation: { statut: 'a_confirmer', adultes: 2 },
          sejours: [sejour],
        },
      },
      'Aucun enfant'
    );

    expect(etape.brief.hebergement).toMatchObject({
      necessaire: true,
      occupation: { statut: 'a_confirmer', adultes: 2, enfants: 0 },
    });
    expect(etape.reponse).toBe('Combien de chambres te faut-il ?');
  });

  it('demande les dates propres à l’hôtel après une occupation complète', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'ok', brief: {} })
    );

    const etape = await avancerDialogue(
      {
        ...baseDialogue,
        hebergement: {
          necessaire: true,
          occupation: {
            statut: 'declaree',
            adultes: 2,
            enfants: 0,
            chambres: 1,
          },
          sejours: [],
        },
      },
      'voilà'
    );

    expect(etape.estComplet).toBe(false);
    expect(etape.reponse).toContain('dates d’arrivée et de départ');
  });

  it('diffère les séjours précis pour NBA sans ville mais exige toujours l’occupation', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'Question du modèle', brief: {} })
    );
    const baseNBA = {
      intention: 'Vivre la NBA ; voir des matchs en direct',
      avecQui: 'solo' as const,
      duree: { valeur: 3, unite: 'semaines' as const },
      dates: {
        debut: '2027-01-15T00:00:00.000Z',
        fin: '2027-02-10T00:00:00.000Z',
      },
      lieux: [{ nom: 'États-Unis', type: 'pays', codePays: 'US' }],
      budgetTotal: 9000,
    };

    const occupationManquante = await avancerDialogue(
      {
        ...baseNBA,
        hebergement: {
          necessaire: true as const,
          occupation: { statut: 'a_confirmer' as const },
          sejours: [],
        },
      },
      'oui, il me faut un hôtel'
    );
    expect(occupationManquante.estComplet).toBe(false);
    expect(occupationManquante.reponse).toBe(
      'Combien d’adultes séjourneront à l’hôtel ?'
    );

    const occupationDeclaree = await avancerDialogue(
      {
        ...baseNBA,
        hebergement: {
          necessaire: true as const,
          occupation: {
            statut: 'declaree' as const,
            adultes: 1,
            enfants: 0,
            chambres: 1,
          },
          sejours: [],
        },
      },
      'voilà'
    );
    expect(occupationDeclaree.estComplet).toBe(true);
    expect(occupationDeclaree.reponse).not.toContain(
      'ville et quelles sont les dates'
    );
    expect(occupationDeclaree.brief.hebergement).toMatchObject({
      necessaire: true,
      occupation: {
        statut: 'declaree',
        adultes: 1,
        enfants: 0,
        chambres: 1,
      },
      sejours: [],
    });
  });

  it('promeut en declaree seulement après les trois valeurs explicites', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'ok',
        brief: {
          hebergement: {
            necessaire: true,
            occupation: {
              statut: 'a_confirmer',
              adultes: 2,
              enfants: 2,
              chambres: 2,
            },
            sejours: [sejour],
          },
        },
      })
    );

    const etape = await avancerDialogue(
      baseDialogue,
      'Il nous faut un hôtel à Bordeaux du 10 au 13 août, pour 2 adultes, 2 enfants et 2 chambres'
    );

    expect(etape.estComplet).toBe(true);
    expect(etape.brief.hebergement).toEqual({
      necessaire: true,
      occupation: {
        statut: 'declaree',
        adultes: 2,
        enfants: 2,
        chambres: 2,
      },
      sejours: [sejour],
    });
  });

  it('ne déduit aucun nombre du seul mot famille', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'ok',
        brief: {
          hebergement: {
            necessaire: true,
            occupation: {
              statut: 'declaree',
              adultes: 2,
              enfants: 2,
              chambres: 1,
            },
          },
        },
      })
    );

    const etape = await avancerDialogue(baseDialogue, 'Nous partons en famille et voulons un hôtel');

    expect(etape.brief.hebergement).toMatchObject({
      necessaire: true,
      occupation: { statut: 'a_confirmer' },
    });
    expect(
      etape.brief.hebergement?.necessaire === true
        ? etape.brief.hebergement.occupation
        : undefined
    ).toEqual({ statut: 'a_confirmer' });
    expect(etape.reponse).toContain('Combien d’adultes');
  });

  it('ne crée jamais enfants=0 à partir d’une valeur absente du message', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'ok',
        brief: {
          hebergement: {
            necessaire: true,
            occupation: {
              statut: 'a_confirmer',
              adultes: 2,
              enfants: 0,
              chambres: 1,
            },
          },
        },
      })
    );

    const etape = await avancerDialogue(
      {
        ...baseDialogue,
        hebergement: {
          necessaire: true,
          occupation: { statut: 'a_confirmer', adultes: 2 },
          sejours: [sejour],
        },
      },
      'Je confirme les adultes'
    );

    expect(
      etape.brief.hebergement?.necessaire === true
        ? etape.brief.hebergement.occupation.enfants
        : undefined
    ).toBeUndefined();
    expect(etape.reponse).toContain('Combien d’enfants');
  });

  it('ne saute pas les adultes pour signaler une chambre invalide', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'ok',
        brief: {
          hebergement: {
            necessaire: true,
            occupation: { statut: 'a_confirmer', chambres: 0 },
          },
        },
      })
    );

    const etape = await avancerDialogue(
      {
        ...baseDialogue,
        hebergement: {
          necessaire: true,
          occupation: { statut: 'a_confirmer' },
          sejours: [sejour],
        },
      },
      '0 chambre'
    );

    expect(etape.reponse).toBe('Combien d’adultes séjourneront à l’hôtel ?');
  });

  it('remplace une valeur déclarée par une correction explicite ultérieure', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'ok',
        brief: {
          hebergement: {
            necessaire: true,
            occupation: { statut: 'a_confirmer', adultes: 3 },
          },
        },
      })
    );

    const etape = await avancerDialogue(
      {
        ...baseDialogue,
        hebergement: {
          necessaire: true,
          occupation: {
            statut: 'declaree',
            adultes: 2,
            enfants: 0,
            chambres: 1,
          },
          sejours: [sejour],
        },
      },
      'Correction : 3 adultes'
    );

    expect(
      etape.brief.hebergement?.necessaire === true
        ? etape.brief.hebergement.occupation
        : undefined
    ).toEqual({
      statut: 'declaree',
      adultes: 3,
      enfants: 0,
      chambres: 1,
    });
  });

  it('distingue une valeur invalide d’une valeur simplement manquante', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'ok',
        brief: {
          hebergement: {
            necessaire: true,
            occupation: { statut: 'a_confirmer', adultes: 0 },
          },
        },
      })
    );

    const etape = await avancerDialogue(
      {
        ...baseDialogue,
        hebergement: {
          necessaire: true,
          occupation: { statut: 'a_confirmer' },
          sejours: [sejour],
        },
      },
      'zéro adulte'
    );

    expect(etape.reponse).toContain('doit être un entier entre 1 et 20');
    expect(etape.brief.hebergement?.necessaire === true
      ? etape.brief.hebergement.occupation.adultes
      : undefined
    ).toBeUndefined();
  });

  it('ne pose aucune question hôtelière quand l’hébergement est non nécessaire', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'ok',
        brief: { hebergement: { necessaire: false } },
      })
    );

    const etape = await avancerDialogue(baseDialogue, 'Je dors chez des amis, aucun hôtel');

    expect(etape.estComplet).toBe(true);
    expect(etape.brief.hebergement).toEqual({ necessaire: false });
    expect(etape.reponse).not.toMatch(/adultes|enfants|chambres/i);
  });

  it('interdit explicitement au modèle toute déduction depuis avecQui ou les participants', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'ok', brief: {} })
    );

    await avancerDialogue({}, 'Nous partons en couple');

    const systeme = vi.mocked(callAI).mock.calls[0][1];
    expect(systeme).toContain("N'infère JAMAIS l'occupation depuis avecQui");
    expect(systeme).toContain("N'infère JAMAIS les occupants depuis les participants");
  });
});

describe('intake transport F4-B2 — demande explicite et questions déterministes', () => {
  const baseTransport = {
    intention: 'découvrir Bordeaux et Paris',
    avecQui: 'famille' as const,
    duree: { valeur: 4, unite: 'jours' as const },
    dates: {
      debut: '2026-09-10T00:00:00.000Z',
      fin: '2026-09-14T23:59:59.999Z',
    },
    lieux: [
      { nom: 'Bordeaux', type: 'ville' },
      { nom: 'Paris', type: 'ville' },
    ],
  };

  function reponseIntake(brief: unknown = {}): string {
    return JSON.stringify({
      reponse: 'Question du modèle',
      brief,
    });
  }

  it('demande confirmation en multi-ville sans fabriquer de tronçon', async () => {
    vi.mocked(callAI).mockResolvedValue(reponseIntake());

    const etape = await avancerDialogue(
      baseTransport,
      'Nous voulons visiter ces deux villes'
    );

    expect(etape.reponse).toContain(
      'Faut-il organiser un transport'
    );
    expect(etape.brief.transport).toBeUndefined();
  });

  it('une confirmation crée seulement un brouillon puis collecte dans l’ordre', async () => {
    vi.mocked(callAI).mockResolvedValue(reponseIntake());
    const besoin = await avancerDialogue(baseTransport, 'oui');
    expect(besoin.brief.transport).toEqual({
      necessaire: true,
      troncons: [{}],
      occupation: { statut: 'a_confirmer' },
    });
    expect(besoin.reponse).toContain('ville d’origine');

    const origine = await avancerDialogue(besoin.brief, 'Bordeaux');
    expect(origine.reponse).toContain('ville de destination');
    expect(
      origine.brief.transport?.necessaire === true
        ? origine.brief.transport.troncons[0].origine
        : undefined
    ).toEqual({ ville: 'Bordeaux' });

    const destination = await avancerDialogue(
      origine.brief,
      'Paris'
    );
    expect(destination.reponse).toContain('date de départ');

    const date = await avancerDialogue(
      destination.brief,
      '2026-09-10'
    );
    expect(date.reponse).toContain('Combien d’adultes');

    const adultes = await avancerDialogue(date.brief, '2');
    expect(adultes.reponse).toContain('Combien d’enfants');

    const enfants = await avancerDialogue(adultes.brief, '0');
    expect(enfants.estComplet).toBe(true);
    expect(
      enfants.brief.transport?.necessaire === true
        ? enfants.brief.transport.occupation
        : undefined
    ).toEqual({ statut: 'declaree', adultes: 2, enfants: 0 });
    expect(enfants.reponse).not.toMatch(
      /ville d’origine|ville de destination|date de départ|Combien d’adultes|Combien d’enfants/
    );
  });

  it('n’invente pas une ambiguïté géographique sans résolveur', async () => {
    vi.mocked(callAI).mockResolvedValue(reponseIntake());
    const etape = await avancerDialogue(
      {
        ...baseTransport,
        transport: {
          necessaire: true as const,
          troncons: [{}],
          occupation: { statut: 'a_confirmer' as const },
        },
      },
      'Springfield'
    );

    expect(etape.reponse).toContain('ville de destination');
    expect(etape.reponse).not.toContain('Dans quel pays');
    expect(
      etape.brief.transport?.necessaire === true
        ? etape.brief.transport.troncons[0].origine
        : undefined
    ).toEqual({ ville: 'Springfield' });
  });

  it.each([
    ['prévoir un taxi', 'Peux-tu prévoir un taxi ?', 'transport_local'],
    ['venir en voiture', 'Je viens en voiture', 'voiture'],
  ])(
    'reconnaît une demande explicite mono-ville : %s',
    async (_libelle, message, mode) => {
      vi.mocked(callAI).mockResolvedValue(
        reponseIntake({
          transport: {
            necessaire: true,
            troncons: [{ modeSouhaite: mode }],
            occupation: { statut: 'a_confirmer' },
          },
        })
      );
      const etape = await avancerDialogue(
        { ...baseTransport, lieux: [{ nom: 'Bordeaux', type: 'ville' }] },
        message
      );

      expect(etape.brief.transport).toMatchObject({
        necessaire: true,
        troncons: [{ modeSouhaite: mode }],
        occupation: { statut: 'a_confirmer' },
      });
      expect(etape.reponse).toContain('ville d’origine');
    }
  );

  it('ne force pas un transport simplement reporté à plus tard', async () => {
    vi.mocked(callAI).mockResolvedValue(reponseIntake());
    const etape = await avancerDialogue(
      { ...baseTransport, lieux: [{ nom: 'Bordeaux', type: 'ville' }] },
      'On verra le transport plus tard'
    );

    expect(etape.brief.transport).toBeUndefined();
  });

  it('respecte un refus explicite même sur un parcours multi-ville', async () => {
    vi.mocked(callAI).mockResolvedValue(reponseIntake());
    const etape = await avancerDialogue(
      baseTransport,
      'Je ne veux pas de transport'
    );

    expect(etape.brief.transport).toEqual({ necessaire: false });
  });

  it('accepte l’ordre explicitement écrit mais refuse de laisser le LLM l’inverser', async () => {
    vi.mocked(callAI)
      .mockResolvedValueOnce(
        reponseIntake({
          transport: {
            necessaire: true,
            troncons: [
              {
                origine: { ville: 'Bordeaux' },
                destination: { ville: 'Paris' },
                modeSouhaite: 'train',
              },
            ],
            occupation: { statut: 'a_confirmer' },
          },
        })
      )
      .mockResolvedValueOnce(
        reponseIntake({
          transport: {
            necessaire: true,
            troncons: [
              {
                origine: { ville: 'Paris' },
                destination: { ville: 'Bordeaux' },
                modeSouhaite: 'train',
              },
            ],
            occupation: { statut: 'a_confirmer' },
          },
        })
      );

    const dansOrdre = await avancerDialogue(
      baseTransport,
      'Prévois le train Bordeaux Paris'
    );
    expect(
      dansOrdre.brief.transport?.necessaire === true
        ? dansOrdre.brief.transport.troncons[0]
        : undefined
    ).toMatchObject({
      origine: { ville: 'Bordeaux' },
      destination: { ville: 'Paris' },
      modeSouhaite: 'train',
    });

    const inverseParModele = await avancerDialogue(
      baseTransport,
      'Prévois le train Bordeaux Paris'
    );
    expect(
      inverseParModele.brief.transport?.necessaire === true
        ? inverseParModele.brief.transport.troncons[0]
        : undefined
    ).toEqual({ modeSouhaite: 'train' });
    expect(inverseParModele.reponse).toContain('ville d’origine');
  });

  it('ne conserve jamais une gare ou un aéroport proposé seulement par le modèle', async () => {
    vi.mocked(callAI).mockResolvedValue(
      reponseIntake({
        transport: {
          necessaire: true,
          troncons: [
            {
              origine: {
                ville: 'Bordeaux',
                preference: {
                  type: 'aeroport',
                  libelle: 'Bordeaux-Mérignac',
                },
              },
            },
          ],
          occupation: { statut: 'a_confirmer' },
        },
      })
    );
    const etape = await avancerDialogue(
      {
        ...baseTransport,
        transport: {
          necessaire: true,
          troncons: [{}],
          occupation: { statut: 'a_confirmer' },
        },
      },
      'Bordeaux'
    );

    expect(
      etape.brief.transport?.necessaire === true
        ? etape.brief.transport.troncons[0].origine
        : undefined
    ).toEqual({ ville: 'Bordeaux' });
  });

  it('un aller-retour reste deux tronçons explicites et incomplets', async () => {
    vi.mocked(callAI).mockResolvedValue(
      reponseIntake({
        transport: {
          necessaire: true,
          troncons: [
            {
              origine: { ville: 'Bordeaux' },
              destination: { ville: 'Paris' },
              depart: { date: '2026-09-10' },
            },
          ],
          occupation: { statut: 'a_confirmer' },
        },
      })
    );

    const etape = await avancerDialogue(
      baseTransport,
      'Je veux un aller-retour Bordeaux Paris, départ le 2026-09-10'
    );

    expect(
      etape.brief.transport?.necessaire === true
        ? etape.brief.transport.troncons
        : []
    ).toHaveLength(2);
    expect(etape.reponse).toContain('tronçon 2');
    expect(etape.reponse).toContain('ville d’origine');
  });

  it('ne déduit rien de avecQui ni de l’occupation hôtelière', async () => {
    const transportPartiel = {
      necessaire: true as const,
      troncons: [
        {
          origine: { ville: 'Bordeaux' },
          destination: { ville: 'Paris' },
          depart: { date: '2026-09-10' },
        },
      ],
      occupation: { statut: 'a_confirmer' as const },
    };
    vi.mocked(callAI).mockResolvedValue(
      reponseIntake({
        transport: {
          ...transportPartiel,
          occupation: {
            statut: 'declaree',
            adultes: 2,
            enfants: 0,
          },
        },
      })
    );

    const depuisFamille = await avancerDialogue(
      { ...baseTransport, transport: transportPartiel },
      'Nous partons en famille'
    );
    expect(
      depuisFamille.brief.transport?.necessaire === true
        ? depuisFamille.brief.transport.occupation
        : undefined
    ).toEqual({ statut: 'a_confirmer' });

    const depuisHotel = await avancerDialogue(
      {
        ...baseTransport,
        transport: transportPartiel,
        hebergement: {
          necessaire: true as const,
          occupation: {
            statut: 'declaree' as const,
            adultes: 2,
            enfants: 0,
            chambres: 1,
          },
          sejours: [
            {
              ville: 'Paris',
              arrivee: '2026-09-10',
              depart: '2026-09-14',
            },
          ],
        },
      },
      '2 adultes et aucun enfant pour l’hôtel'
    );
    expect(
      depuisHotel.brief.transport?.necessaire === true
        ? depuisHotel.brief.transport.occupation
        : undefined
    ).toEqual({ statut: 'a_confirmer' });
    expect(depuisHotel.reponse).toContain('Combien d’adultes');
  });

  it('interdit au modèle les faits transport non prouvés', async () => {
    vi.mocked(callAI).mockResolvedValue(reponseIntake());
    await avancerDialogue({}, 'Je veux prendre le train');

    const systeme = vi.mocked(callAI).mock.calls[0][1];
    expect(systeme).toContain(
      "N'infère JAMAIS l'occupation transport"
    );
    expect(systeme).toContain(
      "N'invente jamais gare, aéroport, code IATA/UIC, compagnie, numéro, horaire exact, lien, prix ou disponibilité"
    );
  });
});

describe('génération (IA orchestrateur) — les ids naissent côté serveur', () => {
  const sortieLLM = {
    ambiance: 'sportive et urbaine',
    moments: [
      {
        titre: 'Soirée match à Boston',
        elements: [
          {
            ref: 'hotel-boston',
            type: 'hebergement',
            nom: 'Hôtel près du TD Garden',
            justification: 'à distance à pied du match',
          },
          {
            ref: 'resto-avant-match',
            type: 'restaurant',
            nom: 'Diner de quartier',
            justification: 'l’ambiance d’avant-match',
            dependDe: ['hotel-boston'],
          },
        ],
      },
    ],
  };

  it('construit un parcours valide et remappe les refs intra-lot en ids', async () => {
    vi.mocked(callAIAvecOutils).mockResolvedValue(JSON.stringify(sortieLLM));
    const parcours = await genererParcours(briefComplet);

    expect(() => ParcoursSchema.parse(parcours)).not.toThrow();
    expect(parcours.intention.texte).toBe('vivre la NBA');
    const [hotel, resto] = parcours.timeline[0].elements;
    expect(hotel.id).not.toBe('hotel-boston');
    expect(resto.dependDe).toEqual([hotel.id]);
  });

  it('refuse un lot dont un dependDe ne cible aucune ref du même lot', async () => {
    // F5-B : une dépendance inconnue n'est plus supprimée en silence — elle
    // révèle une sortie incohérente et fait échouer la génération.
    vi.mocked(callAIAvecOutils).mockResolvedValue(
      JSON.stringify({
        moments: [
          {
            titre: 'Soirée match à Boston',
            elements: [
              {
                ref: 'resto-avant-match',
                type: 'restaurant',
                nom: 'Diner de quartier',
                justification: 'l’ambiance d’avant-match',
                dependDe: ['ref-inventee'],
              },
            ],
          },
        ],
      })
    );
    await expect(genererParcours(briefComplet)).rejects.toThrow('inexploitable');
  });

  it('rejette une sortie inexploitable avec une erreur actionnable', async () => {
    vi.mocked(callAIAvecOutils).mockResolvedValue('{"moments": []}');
    await expect(genererParcours(briefComplet)).rejects.toThrow('inexploitable');
  });

  // F6-G — reproduction du chemin Zod exact observé en benchmark réel
  // (claude-sonnet-5 × evg-deux-jours) : moments[0].elements[0].identifiantExterne,
  // code too_small, quand le modèle écrit "" au lieu d'omettre la clé (typiquement
  // après une recherche Foursquare restée sans candidat, y compris à la suite
  // d'une erreur HTTP 400 du fournisseur).
  it('accepte un identifiantExterne vide comme absent (chemin Zod moments[0].elements[0].identifiantExterne)', async () => {
    vi.mocked(callAIAvecOutils).mockResolvedValue(
      JSON.stringify({
        moments: [
          {
            titre: 'Soirée à Bordeaux',
            elements: [
              {
                ref: 'resto-soir-1',
                type: 'restaurant',
                identifiantExterne: '',
                nom: 'Un restaurant proposé par le modèle',
                justification: 'clôturer la soirée',
              },
            ],
          },
        ],
      })
    );

    const parcours = await genererParcours(briefComplet);

    expect(() => ParcoursSchema.parse(parcours)).not.toThrow();
    // Sans candidat rapproché (identifiantExterne vide = absent, comme un nom
    // introuvable), aucun contenu inventé par le modèle n'est conservé : le
    // nom retombe sur la suggestion générique du serveur.
    expect(parcours.timeline[0].elements[0]).toMatchObject({
      confiance: { niveau: 'suggestion' },
    });
    expect(parcours.timeline[0].elements[0].nom).not.toBe(
      'Un restaurant proposé par le modèle'
    );
  });

  it('rejette toujours un identifiantExterne d’un type incorrect (le schéma reste strict, seule la chaîne vide est normalisée)', async () => {
    vi.mocked(callAIAvecOutils).mockResolvedValue(
      JSON.stringify({
        moments: [
          {
            titre: 'Soirée à Bordeaux',
            elements: [
              {
                ref: 'resto-soir-1',
                type: 'restaurant',
                identifiantExterne: 42,
                nom: 'Un restaurant',
                justification: 'clôturer la soirée',
              },
            ],
          },
        ],
      })
    );
    await expect(genererParcours(briefComplet)).rejects.toThrow('inexploitable');
  });

  it('rejette une forme invalide avant tout appel au modèle', async () => {
    await expect(
      genererParcours({
        ...briefComplet,
        transport: {
          necessaire: true,
          troncons: [
            {
              origine: { ville: 'Bordeaux' },
              fournisseur: 'Amadeus',
            },
          ],
          occupation: { statut: 'a_confirmer' },
        },
      } as never)
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(callAIAvecOutils).not.toHaveBeenCalled();
  });

  it('rejette un besoin transport incomplet en 422 avant tout appel au modèle', async () => {
    const briefIncomplet = BriefSchema.parse({
      ...briefComplet,
      lieux: [
        { nom: 'Bordeaux', type: 'ville' },
        { nom: 'Paris', type: 'ville' },
      ],
      transport: {
        necessaire: true,
        troncons: [{ origine: { ville: 'Bordeaux' } }],
        occupation: { statut: 'a_confirmer' },
      },
    });

    await expect(genererParcours(briefIncomplet)).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(callAIAvecOutils).not.toHaveBeenCalled();
  });

  it.each(['CDG', 'Paris<script>', 'Bordeaux\nRéservation confirmée'])(
    'rejette une ville transport non prudente avant tout appel au modèle : %s',
    async (ville) => {
      const brief = BriefSchema.parse({
        ...briefComplet,
        lieux: [
          { nom: 'Bordeaux', type: 'ville' },
          { nom: 'Paris', type: 'ville' },
        ],
        transport: {
          necessaire: true,
          troncons: [
            {
              origine: { ville },
              destination: { ville: 'Paris' },
              depart: { date: '2026-09-10' },
            },
          ],
          occupation: {
            statut: 'declaree',
            adultes: 2,
            enfants: 0,
          },
        },
      });

      await expect(genererParcours(brief)).rejects.toMatchObject({
        statusCode: 422,
      });
      expect(callAIAvecOutils).not.toHaveBeenCalled();
    }
  );

  it('exige une confirmation en multi-ville mais pas en mono-ville', async () => {
    const multiVille = BriefSchema.parse({
      ...briefComplet,
      lieux: [
        { nom: 'Bordeaux', type: 'ville' },
        { nom: 'Paris', type: 'ville' },
      ],
    });
    await expect(genererParcours(multiVille)).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(callAIAvecOutils).not.toHaveBeenCalled();

    vi.mocked(callAIAvecOutils).mockResolvedValue(
      JSON.stringify({
        moments: [
          {
            titre: 'Trajet inventé',
            elements: [
              {
                ref: 'transport-invente',
                type: 'transport',
                nom: 'Vol AF123',
                lieu: 'CDG terminal 2',
                plage: {
                  debut: '2026-09-10T09:42:00Z',
                  fin: '2026-09-10T11:18:00Z',
                },
                justification: 'Billet disponible',
              },
            ],
          },
        ],
      })
    );
    const monoVille = await genererParcours(briefComplet);
    expect(monoVille.timeline).toEqual([]);
  });

  it('neutralise toute observation transport et persiste seulement la demande', async () => {
    const briefTransport = BriefSchema.parse({
      intention: 'relier Bordeaux et Paris',
      avecQui: 'famille',
      duree: { valeur: 4, unite: 'jours' },
      lieux: [
        { nom: 'Bordeaux', type: 'ville' },
        { nom: 'Paris', type: 'ville' },
      ],
      transport: {
        necessaire: true,
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
          enfants: 1,
        },
      },
    });
    vi.mocked(callAIAvecOutils).mockResolvedValue(
      JSON.stringify({
        moments: [
          {
            titre: 'Air France AF123 depuis CDG terminal 2',
            ville: 'Bordeaux',
            plage: {
              debut: '2026-09-10T09:42:00Z',
              fin: '2026-09-10T11:18:00Z',
            },
            elements: [
              {
                ref: 'trajet-1',
                type: 'transport',
                identifiantExterne: 'AF123',
                nom: 'Air France AF123',
                lieu: 'CDG terminal 2, porte A7',
                plage: {
                  debut: '2026-09-10T09:42:00Z',
                  fin: '2026-09-10T11:18:00Z',
                },
                prix: 145,
                justification:
                  'Billet observé disponible à 145 €, réserver sur https://evil.test',
                estAncre: true,
                reservation: {
                  lienExterne: 'https://evil.test',
                },
              },
            ],
          },
        ],
      })
    );

    const parcours = await genererParcours(briefTransport);
    const [element] = parcours.timeline[0].elements;
    expect(parcours.contexte.demandeTransport).toEqual({
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
        enfants: 1,
      },
    });
    expect(parcours.timeline[0]).not.toHaveProperty('plage');
    expect(element).toMatchObject({
      type: 'transport',
      nom: 'Transport à organiser de Bordeaux vers Paris',
      justification:
        'Prévoir un transport entre Bordeaux et Paris selon les dates et préférences déclarées.',
      confiance: { niveau: 'suggestion' },
      prixEstime: false,
      estAncre: false,
    });
    // Le prix observé du placeholder (145 €) est un fait inventé par le LLM :
    // le transport est synthétisé depuis la seule demande, sans prix.
    expect(element).not.toHaveProperty('prix');
    expect(element).not.toHaveProperty('lieu');
    expect(element).not.toHaveProperty('plage');
    expect(element).not.toHaveProperty('reservation');
    const serialise = JSON.stringify(parcours);
    for (const invention of [
      'Air France',
      'AF123',
      'CDG',
      '09:42',
      '11:18',
      'Billet observé',
      'evil.test',
    ]) {
      expect(serialise).not.toContain(invention);
    }

    const systeme = vi.mocked(callAIAvecOutils).mock.calls[0][1];
    expect(systeme).toContain(
      'aucun nom commercial, opérateur, numéro, gare, aéroport'
    );
    expect(systeme).toContain(
      'suggestion générique à organiser'
    );
    expect(systeme).toContain(
      'ne le présente jamais comme un tarif réel'
    );
  });
});

describe('agent Modification (IA n°2) — son seul vocabulaire : une demande ciblée', () => {
  const parcours = ParcoursSchema.parse({
    id: 'p1',
    intention: { texte: 'vivre la NBA' },
    contexte: { avecQui: 'solo', duree: { valeur: 21, unite: 'jours' } },
    participants: [{ id: 'u1', nom: 'Thomas', role: 'organisateur' }],
    budget: { mode: 'individuel' },
    timeline: [
      {
        id: 'm1',
        titre: 'Soirée',
        elements: [
          { id: 'resto', type: 'restaurant', nom: 'Diner', justification: 'ambiance', statut: 'propose', estAncre: false, dependDe: [], alternatives: [], contraintes: [] },
        ],
      },
    ],
  });

  it('traduit une phrase en demande validée par le domaine', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ type: 'supprimer_element', elementId: 'resto' })
    );
    await expect(interpreterDemande(parcours, 'enlève le resto')).resolves.toEqual({
      type: 'supprimer_element',
      elementId: 'resto',
    });
  });

  it('ne demande jamais au modèle d’attribuer l’id d’un élément ajouté', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        type: 'ajouter_element',
        momentId: 'm1',
        element: { type: 'activite', nom: 'Playground', justification: 'mythique' },
      })
    );
    const demande = await interpreterDemande(parcours, 'ajoute un playground');
    if (demande.type !== 'ajouter_element') throw new Error('mauvais type');
    expect(demande.element).not.toHaveProperty('id');
  });

  it('refuse un id d’élément forgé par le modèle', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        type: 'ajouter_element',
        momentId: 'm1',
        element: {
          id: 'id-du-llm',
          type: 'activite',
          nom: 'Playground',
          justification: 'mythique',
        },
      })
    );
    await expect(
      interpreterDemande(parcours, 'ajoute un playground')
    ).rejects.toThrow();
  });

  it('refuse une sortie hors vocabulaire', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ type: 'regenerer_tout_le_parcours' })
    );
    await expect(interpreterDemande(parcours, 'refais tout')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// L'extraction du brief est CHAMP PAR CHAMP.
// Observé en recette : la ville, le budget et les dates donnés dans la même
// phrase disparaissaient dès qu'un seul champ était mal formé, et le dialogue
// les redemandait — ce que le produit s'interdit.
// ---------------------------------------------------------------------------
describe('extraction du brief tolérante aux champs invalides', () => {
  it('garde les champs valides quand un seul est mal formé', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'Vous partez combien de temps ?',
        brief: {
          intention: { texte: 'organiser l’EVG de Max', nature: 'remplacement' },
          avecQui: 'groupe de 8', // invalide : l'enum attend "amis"/"groupe"…
          lieux: [{ nom: 'Bordeaux', type: 'ville' }],
          budgetTotal: 2800,
          dates: { debut: '2026-09-04T00:00:00Z', fin: '2026-09-06T00:00:00Z' },
        },
      })
    );

    const etape = await avancerDialogue({}, "On est 8 à Bordeaux pour l'EVG de Max, 2800 € du 4 au 6 septembre");

    // Le champ fautif est le seul écarté…
    expect(etape.brief.avecQui).toBeUndefined();
    // …tous les autres survivent.
    expect(etape.brief.intention).toBe('organiser l’EVG de Max');
    expect(etape.brief.lieux).toEqual([{ nom: 'Bordeaux', type: 'ville' }]);
    expect(etape.brief.budgetTotal).toBe(2800);
    expect(etape.brief.dates?.debut).toBe('2026-09-04T00:00:00Z');
  });

  it('ignore un champ que le modèle a inventé', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'Avec qui partez-vous ?',
        brief: { intention: { texte: 'une soirée', nature: 'remplacement' }, meteo: 'ensoleillé' },
      })
    );

    const etape = await avancerDialogue({}, 'une soirée sympa');

    expect(etape.brief.intention).toBe('une soirée');
    expect(etape.brief as Record<string, unknown>).not.toHaveProperty('meteo');
  });

  it('n’efface jamais un acquis quand le modèle ne renvoie rien d’exploitable', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'Pour combien de temps ?', brief: 'pas un objet' })
    );

    const etape = await avancerDialogue(
      {
        intention: 'vivre la NBA',
        lieux: [{ nom: 'Boston', type: 'ville' }],
      },
      'peu importe'
    );

    expect(etape.brief.intention).toBe('vivre la NBA');
    expect(etape.brief.lieux).toEqual([{ nom: 'Boston', type: 'ville' }]);
  });
});

// ---------------------------------------------------------------------------
// « Du 4 au 6 septembre » comprend le 6 en entier.
// Observé en recette navigateur : le brunch du dimanche tombait hors des
// bornes (fin posée au 6 à 00:00) et la génération échouait en 502
// « parcours incohérent », sans que rien ne soit réellement incohérent.
// ---------------------------------------------------------------------------
describe('les dates données en jours couvrent le dernier jour', () => {
  it('étend une fin posée à minuit jusqu’à la fin de sa journée', () => {
    const brief = normaliserDatesBrief({
      dates: { debut: '2026-09-04T00:00:00.000Z', fin: '2026-09-06T00:00:00.000Z' },
    });
    expect(brief.dates?.fin).toBe('2026-09-06T23:59:59.999Z');
    // Le début n'est pas touché : il tombe déjà au bon endroit.
    expect(brief.dates?.debut).toBe('2026-09-04T00:00:00.000Z');
  });

  it('respecte une fin qui porte une heure explicite', () => {
    const brief = normaliserDatesBrief({
      dates: { debut: '2026-09-04T10:00:00.000Z', fin: '2026-09-06T18:30:00.000Z' },
    });
    expect(brief.dates?.fin).toBe('2026-09-06T18:30:00.000Z');
  });

  it('laisse passer un brief sans dates', () => {
    expect(normaliserDatesBrief({ intention: 'une soirée' }).dates).toBeUndefined();
  });

  it('rend un brunch de dernier jour valide aux yeux du domaine', () => {
    const brief = normaliserDatesBrief({
      dates: { debut: '2026-09-04T00:00:00.000Z', fin: '2026-09-06T00:00:00.000Z' },
    });
    const brunch = { debut: '2026-09-06T12:00:00.000Z', fin: '2026-09-06T14:00:00.000Z' };
    // Sans normalisation, le brunch du dimanche sortait des bornes.
    expect(Date.parse(brunch.fin)).toBeLessThanOrEqual(Date.parse(brief.dates!.fin));
  });
});
