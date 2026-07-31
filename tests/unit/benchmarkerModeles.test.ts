import { describe, it, expect } from 'vitest';
import { AppError } from '../../server/lib/AppError.js';
import { MODELE_CLAUDE } from '../../server/services/providers.js';
import type { Parcours } from '../../server/domaine/parcours/index.js';
import type { Brief } from '../../server/agents/brief.js';
import {
  CHAMPS_EXECUTION_AUTORISES,
  SCENARIOS_BENCHMARK,
  agregerParModele,
  aucuneJourneeManquante,
  categoriserEchec,
  construireRapport,
  construireStatistiquesEnsemble,
  coutEstime,
  executerTousLesEssais,
  mediane,
  minMax,
  moyenne,
  parserArguments,
  parserTarifs,
  variance,
  verifierCleAnthropic,
  villesAttenduesPresentes,
  type ResultatExecution,
  type ScenarioBenchmark,
} from '../../server/benchmark/logique.js';

// LE BENCHMARK LUI-MÊME N'EST JAMAIS LANCÉ ICI.
//
// Ce fichier ne teste que server/benchmark/logique.ts, qui n'importe aucun
// module réseau. server/benchmark/benchmarker-modeles.ts (l'exécution réelle,
// avec appel à genererParcours) n'est jamais importé par cette suite.

function fauxParcours(timeline: Parcours['timeline']): Parcours {
  return { timeline } as unknown as Parcours;
}

describe('scénarios fixes', () => {
  it('couvre les trois scénarios de la mission F6-B', () => {
    const ids = SCENARIOS_BENCHMARK.map((s) => s.id);
    expect(ids).toEqual(['soiree-bordeaux', 'evg-deux-jours', 'nba-multi-villes']);
  });

  it("propose une demande de transport explicite pour le scénario multi-villes", () => {
    const nba = SCENARIOS_BENCHMARK.find((s) => s.id === 'nba-multi-villes')!;
    expect(nba.brief.lieux.length).toBeGreaterThan(1);
    expect(nba.brief.transport).toEqual({ necessaire: false });
  });
});

describe('parserArguments', () => {
  it('utilise le modèle par défaut sans argument ni variable d’environnement', () => {
    expect(parserArguments([], {})).toEqual({ modeles: [MODELE_CLAUDE], repetitions: 1 });
  });

  it('lit une liste de modèles depuis --modeles', () => {
    const options = parserArguments(['--modeles=claude-haiku-4-5-20251001,claude-sonnet-5'], {});
    expect(options.modeles).toEqual(['claude-haiku-4-5-20251001', 'claude-sonnet-5']);
  });

  it('lit une liste de modèles depuis BENCHMARK_MODELES si aucun argument n’est fourni', () => {
    const options = parserArguments([], { BENCHMARK_MODELES: 'modele-a, modele-b' });
    expect(options.modeles).toEqual(['modele-a', 'modele-b']);
  });

  it('l’argument --modeles prime sur la variable d’environnement', () => {
    const options = parserArguments(['--modeles=modele-c'], { BENCHMARK_MODELES: 'modele-a' });
    expect(options.modeles).toEqual(['modele-c']);
  });

  it('refuse une liste de modèles explicitement vide', () => {
    expect(() => parserArguments(['--modeles=, ,'], {})).toThrow(/aucun modèle/i);
  });

  it('lit le nombre de répétitions depuis --repetitions', () => {
    expect(parserArguments(['--repetitions=5'], {}).repetitions).toBe(5);
  });

  it.each(['0', '-1', 'x', '1.5'])('refuse un nombre de répétitions invalide (%s)', (valeur) => {
    expect(() => parserArguments([`--repetitions=${valeur}`], {})).toThrow(/répétitions/i);
  });
});

describe('verifierCleAnthropic', () => {
  it('refuse quand la clé est absente', () => {
    expect(() => verifierCleAnthropic({})).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('refuse quand la clé est vide', () => {
    expect(() => verifierCleAnthropic({ ANTHROPIC_API_KEY: '   ' })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('rend la clé nettoyée quand elle est présente', () => {
    expect(verifierCleAnthropic({ ANTHROPIC_API_KEY: '  sk-ant-test  ' })).toBe('sk-ant-test');
  });
});

describe('parserTarifs / coutEstime', () => {
  it('ne calcule aucun coût sans tarif fourni', () => {
    expect(parserTarifs(undefined)).toEqual({});
    expect(coutEstime(undefined, 1000, 1000)).toBeUndefined();
  });

  it('calcule un coût uniquement à partir des tarifs explicitement fournis', () => {
    const tarifs = parserTarifs('{"modele-x":{"entree":3,"sortie":15}}');
    expect(tarifs).toEqual({ 'modele-x': { entree: 3, sortie: 15 } });
    const cout = coutEstime(tarifs['modele-x'], 1_000_000, 1_000_000);
    expect(cout).toBeCloseTo(18);
  });

  it('refuse un JSON de tarifs invalide', () => {
    expect(() => parserTarifs('pas-du-json')).toThrow();
  });

  it('refuse un tarif dont la forme est incorrecte', () => {
    expect(() => parserTarifs('{"modele-x":{"entree":"trois"}}')).toThrow();
  });
});

describe('statistiques : moyenne, médiane, min/max, variance', () => {
  it('moyenne', () => {
    expect(moyenne([1, 2, 3])).toBe(2);
    expect(moyenne([])).toBe(0);
  });

  it('médiane pair et impair', () => {
    expect(mediane([1, 3, 2])).toBe(2);
    expect(mediane([1, 2, 3, 4])).toBe(2.5);
    expect(mediane([])).toBe(0);
  });

  it('min/max', () => {
    expect(minMax([5, 1, 3])).toEqual({ min: 1, max: 5 });
    expect(minMax([])).toEqual({ min: 0, max: 0 });
  });

  it('variance nulle sur des valeurs identiques', () => {
    expect(variance([4, 4, 4])).toBe(0);
    expect(variance([2, 4, 6])).toBeCloseTo(2.6666, 3);
  });
});

describe('categoriserEchec', () => {
  it.each([
    [422, 'refus_metier'],
    [502, 'sortie_inexploitable'],
    [503, 'service_indisponible'],
  ] as const)('AppError %i → %s', (statusCode, categorie) => {
    expect(categoriserEchec(new AppError('message', statusCode))).toBe(categorie);
  });

  it('une erreur non métier devient erreur_inattendue', () => {
    expect(categoriserEchec(new Error('boom'))).toBe('erreur_inattendue');
    expect(categoriserEchec('pas une erreur')).toBe('erreur_inattendue');
  });
});

describe('villesAttenduesPresentes', () => {
  const brief = { lieux: ['Bordeaux', 'Lyon'] } as Brief;

  it('vrai quand chaque ville attendue apparaît dans la timeline', () => {
    const parcours = fauxParcours([
      { id: '1', titre: 'Soirée', elements: [{ id: 'a', type: 'sortie', nom: 'Un bar à Bordeaux', justification: 'x', dependDe: [], estAncre: false, confiance: { niveau: 'suggestion' }, reactions: [] } as never] } as never,
      { id: '2', titre: 'Visite', elements: [{ id: 'b', type: 'activite', nom: 'Une activité à Lyon', justification: 'x', dependDe: [], estAncre: false, confiance: { niveau: 'suggestion' }, reactions: [] } as never] } as never,
    ]);
    expect(villesAttenduesPresentes(brief, parcours)).toBe(true);
  });

  it('faux quand une ville attendue est absente, y compris avec accents différents', () => {
    const parcours = fauxParcours([
      { id: '1', titre: 'Soirée', elements: [{ id: 'a', type: 'sortie', nom: 'Un bar à Bordeaux', justification: 'x', dependDe: [], estAncre: false, confiance: { niveau: 'suggestion' }, reactions: [] } as never] } as never,
    ]);
    expect(villesAttenduesPresentes(brief, parcours)).toBe(false);
  });
});

describe('aucuneJourneeManquante', () => {
  const brief = {
    dates: { debut: '2026-10-03T00:00:00.000Z', fin: '2026-10-04T23:59:59.999Z' },
  } as Brief;

  it('vrai sans dates dans le brief (rien à vérifier)', () => {
    expect(aucuneJourneeManquante({} as Brief, fauxParcours([]))).toBe(true);
  });

  it('vrai quand chaque jour civil de la plage a au moins un élément', () => {
    const parcours = fauxParcours([
      {
        id: '1',
        titre: 'Jour 1',
        plage: { debut: '2026-10-03T10:00:00.000Z', fin: '2026-10-03T12:00:00.000Z' },
        elements: [],
      } as never,
      {
        id: '2',
        titre: 'Jour 2',
        elements: [
          {
            id: 'a',
            type: 'activite',
            nom: 'x',
            justification: 'x',
            dependDe: [],
            estAncre: false,
            confiance: { niveau: 'suggestion' },
            reactions: [],
            plage: { debut: '2026-10-04T10:00:00.000Z', fin: '2026-10-04T12:00:00.000Z' },
          } as never,
        ],
      } as never,
    ]);
    expect(aucuneJourneeManquante(brief, parcours)).toBe(true);
  });

  it('faux quand un jour civil de la plage n’a aucun élément', () => {
    const parcours = fauxParcours([
      {
        id: '1',
        titre: 'Jour 1 seulement',
        plage: { debut: '2026-10-03T10:00:00.000Z', fin: '2026-10-03T12:00:00.000Z' },
        elements: [],
      } as never,
    ]);
    expect(aucuneJourneeManquante(brief, parcours)).toBe(false);
  });
});

function resultat(partiel: Partial<ResultatExecution> & Pick<ResultatExecution, 'scenarioId' | 'modele' | 'succes'>): ResultatExecution {
  return {
    scenarioNom: partiel.scenarioId,
    repetition: 1,
    dureeMs: 0,
    tokensEntree: 0,
    tokensSortie: 0,
    tours: 0,
    jsonValide: partiel.succes,
    lotsPrevus: 1,
    lotsGeneres: partiel.succes ? 1 : 0,
    reprises: 0,
    ...partiel,
  };
}

describe('construireStatistiquesEnsemble / agregerParModele', () => {
  it('calcule le taux de succès et la répartition des échecs', () => {
    const executions = [
      resultat({ scenarioId: 's1', modele: 'm1', succes: true, dureeMs: 100, tokensEntree: 10, tokensSortie: 20, tours: 1 }),
      resultat({ scenarioId: 's1', modele: 'm1', succes: false, categorieEchec: 'refus_metier', dureeMs: 200, tours: 1 }),
      resultat({ scenarioId: 's1', modele: 'm1', succes: false, categorieEchec: 'refus_metier', dureeMs: 300, tours: 1 }),
    ];
    const stats = construireStatistiquesEnsemble(executions);
    expect(stats.nombreEssais).toBe(3);
    expect(stats.tauxSucces).toBeCloseTo(1 / 3);
    expect(stats.duree.mediane).toBe(200);
    expect(stats.repartitionEchecs).toEqual({ refus_metier: 2 });
  });

  it('agrège séparément par modèle puis par scénario', () => {
    const executions = [
      resultat({ scenarioId: 'scenario-a', modele: 'modele-1', succes: true, dureeMs: 100 }),
      resultat({ scenarioId: 'scenario-b', modele: 'modele-1', succes: true, dureeMs: 200 }),
      resultat({ scenarioId: 'scenario-a', modele: 'modele-2', succes: false, categorieEchec: 'service_indisponible' }),
    ];
    const agregat = agregerParModele(executions);
    expect(agregat.map((a) => a.modele).sort()).toEqual(['modele-1', 'modele-2']);
    const modele1 = agregat.find((a) => a.modele === 'modele-1')!;
    expect(modele1.global.nombreEssais).toBe(2);
    expect(Object.keys(modele1.parScenario).sort()).toEqual(['scenario-a', 'scenario-b']);
  });
});

describe('construireRapport', () => {
  it('produit un rapport avec les exécutions et les agrégats par modèle', () => {
    const executions = [resultat({ scenarioId: 's1', modele: 'm1', succes: true })];
    const rapport = construireRapport(executions, '2026-07-31T00:00:00.000Z');
    expect(rapport.genereLe).toBe('2026-07-31T00:00:00.000Z');
    expect(rapport.executions).toBe(executions);
    expect(rapport.parModele).toHaveLength(1);
  });
});

describe('absence de contenu brut dans les résultats', () => {
  it('un ResultatExecution ne porte que des champs de la liste autorisée', () => {
    const execution = resultat({
      scenarioId: 's1',
      modele: 'm1',
      succes: true,
      villesAttenduesPresentes: true,
      aucuneJourneeManquante: true,
    });
    const champsInattendus = Object.keys(execution).filter(
      (champ) => !(CHAMPS_EXECUTION_AUTORISES as readonly string[]).includes(champ)
    );
    expect(champsInattendus).toEqual([]);
  });

  it('la liste autorisée ne contient aucun champ de contenu brut ou de secret', () => {
    for (const champ of CHAMPS_EXECUTION_AUTORISES) {
      expect(champ).not.toMatch(/prompt|reponse|response|brut|raw|cle|secret|token(?!s)/i);
    }
  });
});

describe('executerTousLesEssais — poursuite après l’échec d’un essai', () => {
  it('continue les essais suivants quand un essai isolé échoue', async () => {
    const scenarios: ScenarioBenchmark[] = [
      { id: 's1', nom: 'Scénario 1', brief: {} as Brief },
      { id: 's2', nom: 'Scénario 2', brief: {} as Brief },
    ];
    const appels: string[] = [];
    const resultats = await executerTousLesEssais(['m1'], scenarios, 1, async (scenario, modele, repetition) => {
      appels.push(scenario.id);
      if (scenario.id === 's1') {
        throw new Error('panne réseau simulée');
      }
      return resultat({ scenarioId: scenario.id, modele, succes: true, repetition });
    });

    expect(appels).toEqual(['s1', 's2']);
    expect(resultats).toHaveLength(2);
    expect(resultats[0]).toMatchObject({ scenarioId: 's1', succes: false, categorieEchec: 'erreur_inattendue' });
    expect(resultats[1]).toMatchObject({ scenarioId: 's2', succes: true });
  });

  it('exécute chaque combinaison modèle × scénario × répétition', async () => {
    const scenarios: ScenarioBenchmark[] = [{ id: 's1', nom: 'Scénario 1', brief: {} as Brief }];
    const resultats = await executerTousLesEssais(['m1', 'm2'], scenarios, 2, async (scenario, modele, repetition) =>
      resultat({ scenarioId: scenario.id, modele, succes: true, repetition })
    );
    expect(resultats).toHaveLength(4);
  });
});
