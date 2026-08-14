import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// F7-C : intégration du dialogue de bout en bout, sur plusieurs tours.
// Chaque tour simule un échange réel : le brief renvoyé par `avancerDialogue`
// devient le `briefActuel` du tour suivant, exactement comme le fait le
// serveur HTTP entre deux requêtes (aucune mémoire parallèle au brief).
vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/claude/core.js')>();
  return { ...reel, callAI: vi.fn() };
});

const { callAI } = await import('../../server/services/claude/core.js');
const { avancerDialogue } = await import('../../server/agents/intake.js');
const { BriefSchema, champsManquants } = await import('../../server/agents/brief.js');

// Horloge fixe et fuseau explicite (F7-A) : 2026-08-01 est un samedi (déjà
// vérifié via Intl dans resolutionDatesRelatives.test.ts). "ce week-end"
// couvre donc le 01 et 02 août, "le week-end prochain" le 08 et 09 août.
const MAINTENANT = '2026-08-01T10:00:00.000Z';

function reponseIntake(brief: unknown = {}, reponse = 'ok'): string {
  return JSON.stringify({ reponse, brief });
}

beforeEach(() => {
  vi.mocked(callAI).mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(MAINTENANT));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('F7-C — scénario 1 : parcours progressif simple, un champ de base par tour', () => {
  it('mène le dialogue de intention → avecQui → durée → dates sans jamais répéter une question', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      reponseIntake(
        { intention: { texte: 'un week-end détente', nature: 'remplacement' } },
        'Avec qui pars-tu ?'
      )
    );
    const tour1 = await avancerDialogue({}, 'Je veux organiser un week-end détente');
    expect(tour1.estComplet).toBe(false);
    expect(tour1.reponse).toBe(
      'Tu seras seul, en couple, en famille, entre amis ou en groupe ?'
    );
    expect(tour1.brief).toEqual({ intention: 'un week-end détente' });

    vi.mocked(callAI).mockResolvedValueOnce(
      reponseIntake({ avecQui: 'couple' }, 'Combien de temps ?')
    );
    const promptTour1 = vi.mocked(callAI).mock.calls[0][0];
    expect(promptTour1).toContain('Champ de base attendu maintenant pour interpréter une réponse courte : l’intention.');

    const tour2 = await avancerDialogue(tour1.brief, 'en couple');
    expect(tour2.estComplet).toBe(false);
    expect(tour2.reponse).toBe('Sur combien de temps veux-tu organiser ça ?');
    expect(tour2.brief).toEqual({ intention: 'un week-end détente', avecQui: 'couple' });
    const promptTour2 = vi.mocked(callAI).mock.calls[1][0];
    expect(promptTour2).toContain('Champ de base attendu maintenant pour interpréter une réponse courte : avec qui il part.');
    expect(promptTour2).toContain('Champs de base déjà validés (ne jamais les redemander) : l’intention');

    vi.mocked(callAI).mockResolvedValueOnce(
      reponseIntake({ duree: { valeur: 2, unite: 'jours' } }, 'Et pour quand ?')
    );
    const tour3 = await avancerDialogue(tour2.brief, '2 jours');
    expect(tour3.estComplet).toBe(false);
    expect(tour3.reponse).toBe(
      'À quelle date souhaites-tu le faire, même approximativement ?'
    );
    expect(tour3.brief.duree).toEqual({ valeur: 2, unite: 'jours' });
    const promptTour3 = vi.mocked(callAI).mock.calls[2][0];
    expect(promptTour3).toContain('Champ de base attendu maintenant pour interpréter une réponse courte : la durée.');
    expect(promptTour3).toContain('Champs de base déjà validés (ne jamais les redemander) : l’intention, avec qui il part');

    // F7-A : "le week-end prochain" est résolu déterministement, jamais par le LLM.
    vi.mocked(callAI).mockResolvedValueOnce(reponseIntake({}));
    const tour4 = await avancerDialogue(tour3.brief, 'le week-end prochain');
    const promptTour4 = vi.mocked(callAI).mock.calls[3][0];
    expect(promptTour4).toContain('Champ de base attendu maintenant pour interpréter une réponse courte : les dates.');
    expect(tour4.estComplet).toBe(true);
    expect(tour4.brief.dates).toEqual({
      debut: '2026-08-07T22:00:00.000Z',
      fin: '2026-08-09T21:59:59.999Z',
    });
    expect(champsManquants(tour4.brief)).toEqual([]);
    expect(BriefSchema.safeParse(tour4.brief).success).toBe(true);

    // Les 4 réponses successives portaient chacune sur un champ différent :
    // aucune question de base n'a été reposée.
    const questions = [tour1.reponse, tour2.reponse, tour3.reponse];
    expect(new Set(questions).size).toBe(questions.length);
  });
});

describe('F7-C — scénario 2 : plusieurs champs de base dans un seul message', () => {
  it('conserve tous les champs extraits et ne pose plus aucune question de base', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      reponseIntake({
        intention: { texte: 'organiser l’EVG de Max', nature: 'remplacement' },
        avecQui: 'amis',
        duree: { valeur: 2, unite: 'jours' },
        lieux: [{ nom: 'Bordeaux', type: 'ville' }],
      })
    );

    const tour = await avancerDialogue(
      {},
      'Je veux un EVG à Bordeaux pour 8 amis, pendant 2 jours, le week-end prochain'
    );

    expect(tour.brief.intention).toBe('organiser l’EVG de Max');
    expect(tour.brief.avecQui).toBe('amis');
    expect(tour.brief.duree).toEqual({ valeur: 2, unite: 'jours' });
    expect(tour.brief.lieux).toEqual([{ nom: 'Bordeaux', type: 'ville' }]);
    // "le week-end prochain" résolu par F7-A sans dépendre du LLM.
    expect(tour.brief.dates).toEqual({
      debut: '2026-08-07T22:00:00.000Z',
      fin: '2026-08-09T21:59:59.999Z',
    });
    // Un seul lieu : aucun besoin de confirmation transport ne se déclenche.
    expect(tour.brief.transport).toBeUndefined();
    expect(tour.estComplet).toBe(true);
    expect(tour.reponse).toContain('organiser l’EVG de Max');
  });
});

describe('F7-C — scénario 3 : corrections successives, un seul champ remplacé à la fois', () => {
  it('chaque correction remplace uniquement le champ visé, sans faire réapparaître une ancienne valeur', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      reponseIntake({
        intention: { texte: 'organiser un EVG', nature: 'remplacement' },
        avecQui: 'amis',
        duree: { valeur: 2, unite: 'jours' },
      })
    );
    const base = await avancerDialogue({}, 'un EVG entre amis, 2 jours');
    expect(base.brief.avecQui).toBe('amis');

    // Correction 1 : avecQui — "finalement on sera 6" ne change pas l'enum,
    // seule une reformulation explicite du modèle sur ce champ le fait.
    vi.mocked(callAI).mockResolvedValueOnce(reponseIntake({ avecQui: 'groupe' }));
    const correctionAvecQui = await avancerDialogue(base.brief, 'finalement on sera 6, en groupe');
    expect(correctionAvecQui.brief.avecQui).toBe('groupe');
    expect(correctionAvecQui.brief.intention).toBe('organiser un EVG');
    expect(correctionAvecQui.brief.duree).toEqual({ valeur: 2, unite: 'jours' });

    // Correction 2 : durée.
    vi.mocked(callAI).mockResolvedValueOnce(
      reponseIntake({ duree: { valeur: 3, unite: 'jours' } })
    );
    const correctionDuree = await avancerDialogue(correctionAvecQui.brief, 'plutôt 3 jours');
    expect(correctionDuree.brief.duree).toEqual({ valeur: 3, unite: 'jours' });
    expect(correctionDuree.brief.avecQui).toBe('groupe'); // pas écrasé

    // Première date posée : "demain" (F7-A).
    vi.mocked(callAI).mockResolvedValueOnce(reponseIntake({}));
    const premiereDate = await avancerDialogue(correctionDuree.brief, 'demain');
    expect(premiereDate.brief.dates).toEqual({
      debut: '2026-08-01T22:00:00.000Z',
      fin: '2026-08-02T21:59:59.999Z',
    });
    expect(premiereDate.estComplet).toBe(true);

    // Correction 3 : "pas demain, le week-end prochain" doit remplacer la
    // date précédente — jamais la faire cohabiter ni la laisser réapparaître.
    // Le brief porte déjà des dates ("demain") : F7-A ne retente pas de
    // résolution automatique dans ce cas (elle ne s'applique que quand aucune
    // date n'est encore arrêtée) — c'est le LLM qui structure la correction,
    // comme observé et déjà couvert dans agents.test.ts.
    vi.mocked(callAI).mockResolvedValueOnce(
      reponseIntake({
        dates: { debut: '2026-08-07T22:00:00.000Z', fin: '2026-08-09T21:59:59.999Z' },
      })
    );
    const correctionDate = await avancerDialogue(premiereDate.brief, 'pas demain, le week-end prochain');
    expect(correctionDate.brief.dates).toEqual({
      debut: '2026-08-07T22:00:00.000Z',
      fin: '2026-08-09T21:59:59.999Z',
    });
    expect(correctionDate.brief.avecQui).toBe('groupe');
    expect(correctionDate.brief.duree).toEqual({ valeur: 3, unite: 'jours' });
    expect(correctionDate.estComplet).toBe(true);
  });
});

describe('F7-C — scénario 4 : message sans information nouvelle', () => {
  it('ne supprime aucun champ acquis et ne redemande que le prochain champ réellement manquant', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      reponseIntake({}, 'Et la durée ?')
    );
    const etape = await avancerDialogue(
      { intention: 'un séjour détente', avecQui: 'solo' },
      'd’accord'
    );
    expect(etape.brief).toEqual({ intention: 'un séjour détente', avecQui: 'solo' });
    expect(etape.reponse).toBe('Sur combien de temps veux-tu organiser ça ?');
    expect(etape.estComplet).toBe(false);
  });

  it('une confirmation neutre sur un brief déjà complet ne relance pas la même reformulation', async () => {
    const briefComplet = {
      intention: 'un séjour détente',
      avecQui: 'solo' as const,
      duree: { valeur: 2, unite: 'jours' as const },
      dates: { debut: '2026-08-07T22:00:00.000Z', fin: '2026-08-09T21:59:59.999Z' },
    };
    vi.mocked(callAI).mockResolvedValueOnce(reponseIntake({}));
    const etape = await avancerDialogue(briefComplet, 'oui');
    expect(etape.estComplet).toBe(true);
    expect(etape.brief).toEqual(briefComplet);
    expect(etape.reponse).toBe(
      'Je n’ai pas pu appliquer ce changement ; le cadrage confirmé reste inchangé.'
    );
  });
});

describe('F7-C — scénario 5 : transition déterministe vers hébergement/transport', () => {
  const briefBaseComplete = {
    intention: 'découvrir Bordeaux et Paris',
    avecQui: 'famille' as const,
    duree: { valeur: 4, unite: 'jours' as const },
    dates: { debut: '2026-09-10T00:00:00.000Z', fin: '2026-09-14T23:59:59.999Z' },
    lieux: [
      { nom: 'Bordeaux', type: 'ville' as const },
      { nom: 'Paris', type: 'ville' as const },
    ],
  };

  it('la question transport ne devient accessible qu’une fois les 4 champs de base complets', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(reponseIntake());
    const etape = await avancerDialogue(briefBaseComplete, 'Nous voulons visiter ces deux villes');
    expect(etape.reponse).toContain('Faut-il organiser un transport');
    expect(etape.brief.transport).toBeUndefined();
  });

  it('un champ transport déjà répondu n’est jamais reposé sur les tours suivants', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(reponseIntake());
    const besoin = await avancerDialogue(briefBaseComplete, 'oui');
    expect(besoin.reponse).toContain('ville d’origine');

    vi.mocked(callAI).mockResolvedValueOnce(reponseIntake());
    const origine = await avancerDialogue(besoin.brief, 'Bordeaux');
    expect(origine.reponse).toContain('ville de destination');
    expect(origine.reponse).not.toContain('ville d’origine');
    expect(
      origine.brief.transport?.necessaire === true
        ? origine.brief.transport.troncons[0].origine
        : undefined
    ).toEqual({ ville: 'Bordeaux' });

    // Un champ de base n'est jamais redemandé pendant la collecte transport.
    const promptOrigine = vi.mocked(callAI).mock.calls[1][0];
    expect(promptOrigine).not.toContain('Champ de base attendu maintenant');
  });

  it('reste déterministe : la même ville répétée ne fait pas régresser le tronçon en cours', async () => {
    const brouillonAvecOrigine = {
      ...briefBaseComplete,
      transport: {
        necessaire: true as const,
        troncons: [{ origine: { ville: 'Bordeaux' } }],
        occupation: { statut: 'a_confirmer' as const },
      },
    };
    vi.mocked(callAI).mockResolvedValueOnce(reponseIntake());
    const etape = await avancerDialogue(brouillonAvecOrigine, 'Paris');
    expect(etape.reponse).toContain('date de départ');
    expect(
      etape.brief.transport?.necessaire === true
        ? etape.brief.transport.troncons[0]
        : undefined
    ).toEqual({ origine: { ville: 'Bordeaux' }, destination: { ville: 'Paris' } });
  });
});

describe('F7-C — scénario 6 : brief prêt pour génération, sans génération réelle déclenchée', () => {
  it('atteint un brief complet après un dialogue en plusieurs tours avec correction, sans doublon de question', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(
      reponseIntake({ intention: { texte: 'vivre un festival', nature: 'remplacement' } }, 'Avec qui ?')
    );
    const tour1 = await avancerDialogue({}, 'je veux vivre un festival');

    vi.mocked(callAI).mockResolvedValueOnce(
      reponseIntake({ avecQui: 'amis' }, 'Combien de temps ?')
    );
    const tour2 = await avancerDialogue(tour1.brief, 'entre amis');

    vi.mocked(callAI).mockResolvedValueOnce(
      reponseIntake({ duree: { valeur: 4, unite: 'jours' } }, 'À quel moment ?')
    );
    const tour3 = await avancerDialogue(tour2.brief, '4 jours');

    // Première date, puis correction explicite.
    vi.mocked(callAI).mockResolvedValueOnce(reponseIntake({}));
    const tour4 = await avancerDialogue(tour3.brief, 'demain');
    expect(tour4.estComplet).toBe(true);

    vi.mocked(callAI).mockResolvedValueOnce(
      reponseIntake({
        dates: { debut: '2026-08-07T22:00:00.000Z', fin: '2026-08-09T21:59:59.999Z' },
      })
    );
    const tour5 = await avancerDialogue(tour4.brief, 'pas demain, le week-end prochain');

    expect(tour5.estComplet).toBe(true);
    expect(tour5.brief.dates).toEqual({
      debut: '2026-08-07T22:00:00.000Z',
      fin: '2026-08-09T21:59:59.999Z',
    });
    expect(champsManquants(tour5.brief)).toEqual([]);
    const brief = BriefSchema.safeParse(tour5.brief);
    expect(brief.success).toBe(true);

    // Aucune question de base répétée sur les 5 tours.
    const questionsBase = [tour1.reponse, tour2.reponse, tour3.reponse];
    expect(new Set(questionsBase).size).toBe(3);

    // Aucun faux "prêt" avant que les 4 champs de base soient réunis.
    expect(tour1.estComplet).toBe(false);
    expect(tour2.estComplet).toBe(false);
    expect(tour3.estComplet).toBe(false);

    // Aucune génération réelle n'est déclenchée par ce module : `genererParcours`
    // n'est ni importé ni appelé dans ce test.
  });

  it('n’annonce jamais un brief prêt tant qu’un champ de base essentiel manque', async () => {
    vi.mocked(callAI).mockResolvedValueOnce(reponseIntake({ intention: { texte: 'vivre un festival', nature: 'remplacement' } }));
    const etape = await avancerDialogue({}, 'je veux vivre un festival');
    expect(etape.estComplet).toBe(false);
    expect(BriefSchema.safeParse(etape.brief).success).toBe(false);
  });
});
