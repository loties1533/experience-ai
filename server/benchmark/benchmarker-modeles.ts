// =============================================================================
// F6-B — BENCHMARK MANUEL DE MODÈLES ANTHROPIC
//
// Lancement volontaire uniquement :
//   npm run benchmark:modeles
//   npx tsx server/benchmark/benchmarker-modeles.ts --modeles=claude-haiku-4-5-20251001,claude-sonnet-5 --repetitions=3
//
// Jamais lancé par Vitest ni par la CI. Ne modifie ni ne persiste aucun
// parcours utilisateur réel : chaque appel passe par genererParcours() sur
// un brief fictif, exactement comme un vrai parcours, mais rien n'est écrit
// en base (aucun dépôt n'est appelé ici).
// =============================================================================

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deriverPlan, genererParcours } from '../agents/generation.js';
import type { MetriquesAppelOutils } from '../services/claude/core.js';
import {
  CHAMPS_EXECUTION_AUTORISES,
  SCENARIOS_BENCHMARK,
  aucuneJourneeManquante,
  categoriserEchec,
  construireRapport,
  coutEstime,
  executerTousLesEssais,
  parserArguments,
  parserTarifs,
  verifierCleAnthropic,
  villesAttenduesPresentes,
  type RapportBenchmark,
  type ResultatExecution,
  type ScenarioBenchmark,
  type StatistiquesEnsemble,
} from './logique.js';

/**
 * Un essai complet pour un scénario et un modèle donnés. Les mêmes scénario,
 * prompt système, outils et paramètres que la production (genererParcours) :
 * seul le modèle Anthropic interrogé varie, via l'injection posée par F6-A.
 */
async function executerUnEssai(
  scenario: ScenarioBenchmark,
  modele: string,
  repetition: number
): Promise<ResultatExecution> {
  const lotsPrevus = deriverPlan(scenario.brief).lots.length;
  const evenements: MetriquesAppelOutils[] = [];
  const debut = Date.now();

  const base = {
    scenarioId: scenario.id,
    scenarioNom: scenario.nom,
    modele,
    repetition,
    lotsPrevus,
  };

  try {
    const parcours = await genererParcours(scenario.brief, null, {
      modele,
      onMetriques: (metriques) => evenements.push(metriques),
    });
    const lotsGeneres = evenements.filter((evenement) => evenement.succes).length;
    return {
      ...base,
      succes: true,
      dureeMs: Date.now() - debut,
      tokensEntree: evenements.reduce((somme, e) => somme + e.tokensEntree, 0),
      tokensSortie: evenements.reduce((somme, e) => somme + e.tokensSortie, 0),
      tours: evenements.reduce((somme, e) => somme + e.tours, 0),
      jsonValide: true,
      lotsGeneres,
      reprises: Math.max(0, evenements.length - lotsGeneres),
      villesAttenduesPresentes: villesAttenduesPresentes(scenario.brief, parcours),
      aucuneJourneeManquante: aucuneJourneeManquante(scenario.brief, parcours),
    };
  } catch (erreur) {
    const lotsGeneres = evenements.filter((evenement) => evenement.succes).length;
    return {
      ...base,
      succes: false,
      categorieEchec: categoriserEchec(erreur),
      dureeMs: Date.now() - debut,
      tokensEntree: evenements.reduce((somme, e) => somme + e.tokensEntree, 0),
      tokensSortie: evenements.reduce((somme, e) => somme + e.tokensSortie, 0),
      tours: evenements.reduce((somme, e) => somme + e.tours, 0),
      jsonValide: false,
      lotsGeneres,
      // Le dernier événement d'un essai en échec est la panne TERMINALE (non
      // rejouable, ou budget de reprises épuisé) : elle n'a jamais déclenché
      // de nouvelle tentative, contrairement aux échecs qui la précèdent.
      reprises: Math.max(0, evenements.length - lotsGeneres - 1),
    };
  }
}

function afficherLigneStatistiques(nom: string, stats: StatistiquesEnsemble): void {
  console.log(
    `    ${nom} — succès ${(stats.tauxSucces * 100).toFixed(0)}% ` +
      `(${stats.nombreEssais} essai(s)), durée moy. ${Math.round(stats.duree.moyenne)} ms ` +
      `/ méd. ${Math.round(stats.duree.mediane)} ms, ` +
      `tokens entrée moy. ${Math.round(stats.tokensEntreeMoyen)}, ` +
      `tokens sortie moy. ${Math.round(stats.tokensSortieMoyen)}, ` +
      `tours moy. ${stats.toursMoyen.toFixed(1)}`
  );
  const echecs = Object.entries(stats.repartitionEchecs);
  if (echecs.length > 0) {
    console.log(`      échecs : ${echecs.map(([cle, n]) => `${cle}=${n}`).join(', ')}`);
  }
}

function afficherResume(rapport: RapportBenchmark, tarifs: ReturnType<typeof parserTarifs>): void {
  console.log('\n=== Résumé du benchmark F6-B ===');
  for (const { modele, global, parScenario } of rapport.parModele) {
    console.log(`\nModèle : ${modele}`);
    afficherLigneStatistiques('Global', global);
    const cout = coutEstime(tarifs[modele], global.tokensEntreeMoyen, global.tokensSortieMoyen);
    if (cout !== undefined) {
      console.log(`    coût moyen estimé par essai : ${cout.toFixed(4)} (unité des tarifs fournis)`);
    }
    for (const scenario of SCENARIOS_BENCHMARK) {
      const stats = parScenario[scenario.id];
      if (stats) afficherLigneStatistiques(`  ${scenario.nom}`, stats);
    }
  }
}

function ecrireRapport(rapport: RapportBenchmark): string {
  const dossier = path.join(process.cwd(), 'server/benchmark/resultats');
  mkdirSync(dossier, { recursive: true });
  const chemin = path.join(dossier, `benchmark-${rapport.genereLe.replace(/[:.]/g, '-')}.json`);
  writeFileSync(chemin, JSON.stringify(rapport, null, 2), 'utf-8');
  return chemin;
}

async function main(): Promise<void> {
  verifierCleAnthropic(process.env);
  const { modeles, repetitions } = parserArguments(process.argv.slice(2), process.env);
  const tarifs = parserTarifs(process.env.BENCHMARK_TARIFS_JSON);

  console.log(
    `Benchmark F6-B — ${modeles.length} modèle(s), ${SCENARIOS_BENCHMARK.length} scénario(s), ` +
      `${repetitions} répétition(s) chacun.`
  );

  const executions = await executerTousLesEssais(
    modeles,
    SCENARIOS_BENCHMARK,
    repetitions,
    async (scenario, modele, repetition) => {
      console.log(`→ ${modele} / ${scenario.nom} / essai ${repetition}/${repetitions}`);
      const resultat = await executerUnEssai(scenario, modele, repetition);
      console.log(
        resultat.succes
          ? `  OK — ${resultat.dureeMs} ms, ${resultat.tokensEntree}+${resultat.tokensSortie} tokens`
          : `  ÉCHEC (${resultat.categorieEchec}) — ${resultat.dureeMs} ms`
      );
      return resultat;
    }
  );

  // Garde-fou : n'importe quel champ hors de cette liste indiquerait une
  // fuite de contenu (prompt, réponse, clé). Vérifié AVANT d'écrire quoi que
  // ce soit sur disque, pas après.
  for (const execution of executions) {
    const champsInattendus = Object.keys(execution).filter(
      (champ) => !(CHAMPS_EXECUTION_AUTORISES as readonly string[]).includes(champ)
    );
    if (champsInattendus.length > 0) {
      throw new Error(`Champ(s) inattendu(s) dans le résultat : ${champsInattendus.join(', ')}`);
    }
  }

  const rapport = construireRapport(executions, new Date().toISOString());
  afficherResume(rapport, tarifs);
  const chemin = ecrireRapport(rapport);
  console.log(`\nRapport JSON (tokens et métriques uniquement, jamais de contenu brut) : ${chemin}`);
}

main().catch((erreur) => {
  console.error('Benchmark interrompu :', (erreur as Error).message);
  process.exitCode = 1;
});
