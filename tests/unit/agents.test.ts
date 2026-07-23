import { describe, it, expect, vi, beforeEach } from 'vitest';

// On ne mocke QUE l'appel LLM : parseJSON et sanitizeInput restent réels,
// puisque c'est justement la frontière de méfiance qu'on teste.
vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/claude/core.js')>();
  return { ...reel, callAI: vi.fn() };
});

const { callAI } = await import('../../server/services/claude/core.js');
const { champsManquants, reformulerBrief, BriefSchema } = await import('../../server/agents/brief.js');
const { avancerDialogue } = await import('../../server/agents/intake.js');
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
});

describe('brief — cadrage (doc 05, étape 3)', () => {
  it('ne réclame que les champs requis manquants', () => {
    expect(champsManquants({})).toHaveLength(3);
    expect(champsManquants({ intention: 'vivre la NBA', avecQui: 'solo' })).toEqual(['la durée']);
    expect(champsManquants(briefComplet)).toEqual([]);
  });

  it('reformule le brief en phrase affichable', () => {
    const phrase = reformulerBrief(briefComplet);
    expect(phrase).toContain('vivre la NBA');
    expect(phrase).toContain('en solo');
    expect(phrase).toContain('21 jours');
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
      JSON.stringify({ reponse: 'ok', brief: { duree: { valeur: 21, unite: 'jours' } } })
    );
    const etape = await avancerDialogue(
      { intention: 'vivre la NBA', avecQui: 'solo' },
      'trois semaines'
    );
    expect(etape.estComplet).toBe(true);
    expect(etape.reponse).toContain('C’est bien ça ?'.replace('’', "'"));
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
    vi.mocked(callAI).mockResolvedValue(JSON.stringify(sortieLLM));
    const parcours = await genererParcours(briefComplet);

    expect(() => ParcoursSchema.parse(parcours)).not.toThrow();
    expect(parcours.intention.texte).toBe('vivre la NBA');
    const [hotel, resto] = parcours.timeline[0].elements;
    expect(hotel.id).not.toBe('hotel-boston');
    expect(resto.dependDe).toEqual([hotel.id]);
  });

  it('rejette une sortie inexploitable avec une erreur actionnable', async () => {
    vi.mocked(callAI).mockResolvedValue('{"moments": []}');
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
