import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Brief } from '../../server/agents/brief.js';
import type { ScenarioBenchmark } from '../../server/benchmark/logique.js';

const { deriverPlan, genererParcours, preparerGeneration } = vi.hoisted(() => ({
  deriverPlan: vi.fn(),
  genererParcours: vi.fn(),
  preparerGeneration: vi.fn(),
}));

vi.mock('../../server/agents/generation.js', () => ({ deriverPlan, genererParcours }));
vi.mock('../../server/agents/generation/preparation.js', () => ({ preparerGeneration }));

const { executerUnEssai } = await import(
  '../../server/benchmark/benchmarker-modeles.js'
);

const BRIEF = { lieux: [], contraintes: [] } as unknown as Brief;
const SCENARIO: ScenarioBenchmark = {
  id: 'scenario-test',
  nom: 'Scénario test',
  brief: BRIEF,
};
const CONTEXTE = {
  strategie: 'compatibilite_sans_localisation',
  etapes: [{ ancres: [] }],
  contraintesConservees: {},
} as const;

describe('benchmarker-modeles — préparation runtime', () => {
  beforeEach(() => vi.clearAllMocks());

  it('génère uniquement après un cadrage planifiable et transmet son contexte', async () => {
    preparerGeneration.mockResolvedValue({ type: 'planifiable', contexte: CONTEXTE });
    deriverPlan.mockReturnValue({ lots: [{ id: 'lot-1' }] });
    genererParcours.mockResolvedValue({ timeline: [] });

    const resultat = await executerUnEssai(SCENARIO, 'modele-test', 1);

    expect(preparerGeneration).toHaveBeenCalledWith(BRIEF);
    expect(deriverPlan).toHaveBeenCalledWith(CONTEXTE);
    expect(genererParcours).toHaveBeenCalledWith(
      BRIEF,
      null,
      { modele: 'modele-test', onMetriques: expect.any(Function) },
      CONTEXTE
    );
    expect(resultat).toMatchObject({ succes: true, lotsPrevus: 1 });
  });

  it('enregistre une clarification structurée sans appeler la génération', async () => {
    preparerGeneration.mockResolvedValue({
      type: 'clarification_requise',
      clarification: {
        code: 'zone_geographique_requise',
        question: 'Dans quelle zone souhaitez-vous partir ?',
        champCible: 'lieux',
      },
      etatDialogue: {
        champ: 'preparation_generation',
        code: 'zone_geographique_requise',
        champCible: 'lieux',
      },
    });

    await expect(executerUnEssai(SCENARIO, 'modele-test', 1)).resolves.toMatchObject({
      succes: false,
      categorieEchec: 'clarification_requise',
      jsonValide: true,
      lotsPrevus: 0,
      lotsGeneres: 0,
    });
    expect(deriverPlan).not.toHaveBeenCalled();
    expect(genererParcours).not.toHaveBeenCalled();
  });

  it('enregistre un refus métier structuré sans appeler la génération', async () => {
    preparerGeneration.mockResolvedValue({
      type: 'refus',
      refus: {
        code: 'donnees_essentielles_insuffisantes',
        message: 'Données insuffisantes.',
      },
    });

    await expect(executerUnEssai(SCENARIO, 'modele-test', 1)).resolves.toMatchObject({
      succes: false,
      categorieEchec: 'refus_metier',
      jsonValide: true,
      lotsPrevus: 0,
      lotsGeneres: 0,
    });
    expect(deriverPlan).not.toHaveBeenCalled();
    expect(genererParcours).not.toHaveBeenCalled();
  });
});
