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
    expect(champsManquants({})).toHaveLength(3);
    expect(champsManquants({ intention: 'vivre la NBA', avecQui: 'solo' })).toEqual(['la durée']);
    expect(champsManquants(briefComplet)).toEqual([]);
  });

  it('reformule le brief en phrase affichable', () => {
    const phrase = reformulerBrief(briefComplet);
    expect(phrase).toContain('vivre la NBA');
    expect(phrase).toContain('en solo');
    expect(phrase).toContain('21 jours');
    // Sans dates arrêtées, la reformulation n'en invente aucune.
    expect(phrase).not.toContain('du 1');
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
