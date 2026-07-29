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
const { champsManquants, reformulerBrief, BriefSchema } = await import('../../server/agents/brief.js');
const { avancerDialogue } = await import('../../server/agents/intake.js');
const { normaliserDatesBrief } = await import('../../server/agents/brief.js');
const { genererParcours } = await import('../../server/agents/generation.js');
const { interpreterDemande } = await import('../../server/agents/modification.js');
const { ParcoursSchema } = await import('../../server/domaine/parcours/index.js');

const briefComplet = BriefSchema.parse({
  intention: 'vivre la NBA',
  avecQui: 'solo',
  duree: { valeur: 21, unite: 'jours' },
  lieux: ['Boston'],
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

describe('intake (IA de dialogue) — extraction validée, jamais de confiance aveugle', () => {
  it('fusionne l’extraction et pose la question suivante tant que le brief est incomplet', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'Avec qui partez-vous ?', brief: { intention: 'vivre la NBA' } })
    );
    const etape = await avancerDialogue({}, 'je rêve de vivre la NBA');
    expect(etape.estComplet).toBe(false);
    expect(etape.brief.intention).toBe('vivre la NBA');
    expect(etape.reponse).toBe('Avec qui partez-vous ?');
  });

  it('reformule pour validation dès que le brief est complet (doc 05, étape 4)', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'ok',
        brief: { duree: { valeur: 21, unite: 'jours' }, dateDebut: '2026-08-15T00:00:00Z' },
      })
    );
    const etape = await avancerDialogue(
      { intention: 'vivre la NBA', avecQui: 'solo' },
      'trois semaines, à partir du 15 août'
    );
    expect(etape.estComplet).toBe(true);
    expect(etape.reponse).toContain('C’est bien ça ?'.replace('’', "'"));
    expect(etape.brief.dates?.debut).toBe('2026-08-15T00:00:00.000Z');
  });

  it('calcule la fin depuis le point de départ + la durée, sans jamais la confier au LLM', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({ reponse: 'ok', brief: { dateDebut: '2026-08-15T00:00:00Z' } })
    );
    const etape = await avancerDialogue(
      { intention: 'vivre la NBA', avecQui: 'solo', duree: { valeur: 2, unite: 'semaines' } },
      'à partir du 15 août'
    );
    expect(etape.estComplet).toBe(true);
    expect(etape.brief.dates).toEqual({
      debut: '2026-08-15T00:00:00.000Z',
      fin: '2026-08-29T00:00:00.000Z',
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

describe('intake hôtelier F3-C1 — questions explicites sans déduction', () => {
  const baseDialogue = {
    intention: 'un séjour culturel',
    avecQui: 'famille' as const,
    duree: { valeur: 3, unite: 'jours' as const },
    dates: {
      debut: '2026-08-10T00:00:00.000Z',
      fin: '2026-08-13T23:59:59.999Z',
    },
    lieux: ['Bordeaux'],
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
            dependDe: ['hotel-boston', 'ref-inventee'],
          },
        ],
      },
    ],
  };

  it('construit un parcours valide, remappe les refs en ids et écarte les refs inventées', async () => {
    vi.mocked(callAIAvecOutils).mockResolvedValue(JSON.stringify(sortieLLM));
    const parcours = await genererParcours(briefComplet);

    expect(() => ParcoursSchema.parse(parcours)).not.toThrow();
    expect(parcours.intention.texte).toBe('vivre la NBA');
    const [hotel, resto] = parcours.timeline[0].elements;
    expect(hotel.id).not.toBe('hotel-boston');
    expect(resto.dependDe).toEqual([hotel.id]);
  });

  it('rejette une sortie inexploitable avec une erreur actionnable', async () => {
    vi.mocked(callAIAvecOutils).mockResolvedValue('{"moments": []}');
    await expect(genererParcours(briefComplet)).rejects.toThrow('inexploitable');
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

  it('réattribue l’id d’un élément ajouté (jamais celui du modèle)', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        type: 'ajouter_element',
        momentId: 'm1',
        element: { id: 'id-du-llm', type: 'activite', nom: 'Playground', justification: 'mythique' },
      })
    );
    const demande = await interpreterDemande(parcours, 'ajoute un playground');
    if (demande.type !== 'ajouter_element') throw new Error('mauvais type');
    expect(demande.element.id).not.toBe('id-du-llm');
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
          intention: 'organiser l’EVG de Max',
          avecQui: 'groupe de 8', // invalide : l'enum attend "amis"/"groupe"…
          lieux: ['Bordeaux'],
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
    expect(etape.brief.lieux).toEqual(['Bordeaux']);
    expect(etape.brief.budgetTotal).toBe(2800);
    expect(etape.brief.dates?.debut).toBe('2026-09-04T00:00:00Z');
  });

  it('ignore un champ que le modèle a inventé', async () => {
    vi.mocked(callAI).mockResolvedValue(
      JSON.stringify({
        reponse: 'Avec qui partez-vous ?',
        brief: { intention: 'une soirée', meteo: 'ensoleillé' },
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
      { intention: 'vivre la NBA', lieux: ['Boston'] },
      'peu importe'
    );

    expect(etape.brief.intention).toBe('vivre la NBA');
    expect(etape.brief.lieux).toEqual(['Boston']);
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
