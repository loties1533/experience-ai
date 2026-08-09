// F6-B — logique pure du benchmark manuel de modèles Anthropic.
//
// Aucun appel réseau ici : scénarios fixes, parsing d'arguments, évaluation
// déterministe d'un parcours produit, agrégation de métriques et
// construction du rapport JSON. La seule partie qui parle au réseau vit dans
// benchmarker-modeles.ts ; ses tests injectent des dépendances simulées.

import { AppError, type CodeInterneEchec } from '../lib/AppError.js';
import { MODELE_CLAUDE } from '../services/providers.js';
import { villesDeclarees, type Brief } from '../agents/brief.js';
import type { Parcours } from '../domaine/parcours/index.js';

// ---------------------------------------------------------------------------
// SCÉNARIOS — fixes et fictifs, partagés à l'identique par chaque modèle.
// ---------------------------------------------------------------------------

export interface ScenarioBenchmark {
  id: string;
  nom: string;
  brief: Brief;
}

export const SCENARIOS_BENCHMARK: ScenarioBenchmark[] = [
  {
    id: 'soiree-bordeaux',
    nom: 'Soirée à Bordeaux',
    brief: {
      intention: 'passer une bonne soirée entre amis à Bordeaux',
      avecQui: 'amis',
      duree: { valeur: 5, unite: 'heures' },
      dates: { debut: '2026-09-12T18:00:00.000Z', fin: '2026-09-12T23:59:00.000Z' },
      lieux: [{ nom: 'Bordeaux', type: 'ville' }],
      contraintes: [],
    },
  },
  {
    id: 'evg-deux-jours',
    nom: 'EVG de deux jours',
    brief: {
      intention: "organiser l'EVG de Max",
      avecQui: 'groupe',
      duree: { valeur: 2, unite: 'jours' },
      dates: { debut: '2026-10-03T00:00:00.000Z', fin: '2026-10-04T23:59:59.999Z' },
      lieux: [{ nom: 'Bordeaux', type: 'ville' }],
      contraintes: [],
    },
  },
  {
    id: 'nba-multi-villes',
    nom: 'Parcours NBA multi-villes de trois semaines',
    brief: {
      intention: 'suivre plusieurs matchs NBA en tournée',
      avecQui: 'amis',
      duree: { valeur: 3, unite: 'semaines' },
      dates: { debut: '2026-11-02T00:00:00.000Z', fin: '2026-11-22T23:59:59.999Z' },
      lieux: [
        { nom: 'New York', type: 'ville', codePays: 'US' },
        { nom: 'Los Angeles', type: 'ville', codePays: 'US' },
        { nom: 'Chicago', type: 'ville', codePays: 'US' },
      ],
      contraintes: [],
      // Hors périmètre du scénario : on ne benchmarke pas la génération de
      // demande de transport, seulement les moments par ville.
      transport: { necessaire: false },
    },
  },
];

// ---------------------------------------------------------------------------
// ARGUMENTS CLI
// ---------------------------------------------------------------------------

export interface CoupleCible {
  modele: string;
  scenarioId: string;
}

export interface OptionsBenchmark {
  modeles: string[];
  repetitions: number;
  /** F6-D — couples explicites modèle/scénario ; prime sur le produit modeles × scénarios. */
  essaisCibles?: CoupleCible[];
}

function extraireValeurArgument(argv: string[], nom: string): string | undefined {
  const prefixe = `--${nom}=`;
  return argv.find((argument) => argument.startsWith(prefixe))?.slice(prefixe.length);
}

/** Séparateur modèle/scénario dans --essais : aucun des deux identifiants ne contient ':'. */
const SEPARATEUR_COUPLE = ':';

/**
 * F6-D — parse "MODELE:SCENARIO,MODELE:SCENARIO,..." en couples validés.
 * Refuse tout couple mal formé, tout scénario inconnu, tout modèle vide et
 * tout doublon : --essais sert à isoler des combinaisons précises, une
 * ambiguïté silencieuse romprait cette garantie.
 */
export function parserEssaisCibles(brut: string, scenarios: ScenarioBenchmark[]): CoupleCible[] {
  const idsConnus = scenarios.map((scenario) => scenario.id);
  const items = brut.split(',').map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) {
    throw new Error('--essais ne contient aucun couple exploitable.');
  }

  const couples: CoupleCible[] = [];
  const vus = new Set<string>();
  for (const item of items) {
    const parties = item.split(SEPARATEUR_COUPLE);
    if (parties.length !== 2) {
      throw new Error(
        `Couple --essais mal formé : "${item}" (attendu MODELE${SEPARATEUR_COUPLE}SCENARIO).`
      );
    }
    const [modele, scenarioId] = parties.map((partie) => partie.trim());
    if (!modele) {
      throw new Error(`Couple --essais mal formé : modèle vide dans "${item}".`);
    }
    if (!idsConnus.includes(scenarioId)) {
      throw new Error(
        `Scénario inconnu dans --essais : "${scenarioId}" (attendu l'un de ${idsConnus.join(', ')}).`
      );
    }
    const cle = `${modele}${SEPARATEUR_COUPLE}${scenarioId}`;
    if (vus.has(cle)) {
      throw new Error(`Couple --essais dupliqué : "${cle}".`);
    }
    vus.add(cle);
    couples.push({ modele, scenarioId });
  }
  return couples;
}

/**
 * Contrat retenu : un modèle par défaut (MODELE_CLAUDE) est utilisé quand
 * rien n'est précisé — le script entier n'est de toute façon lancé que
 * volontairement, jamais par la CI. En revanche, une liste explicitement
 * vide (ex. --modeles=,) est un refus : l'appelant a voulu préciser quelque
 * chose et s'est trompé, on ne masque pas l'erreur derrière le défaut.
 */
export function parserArguments(
  argv: string[],
  env: Record<string, string | undefined>
): OptionsBenchmark {
  const modelesBruts = extraireValeurArgument(argv, 'modeles') ?? env.BENCHMARK_MODELES;
  const modeles = modelesBruts
    ? modelesBruts.split(',').map((modele) => modele.trim()).filter(Boolean)
    : [MODELE_CLAUDE];
  if (modeles.length === 0) {
    throw new Error('Aucun modèle fourni : passe --modeles=... ou BENCHMARK_MODELES.');
  }

  const repetitionsBrutes = extraireValeurArgument(argv, 'repetitions') ?? env.BENCHMARK_REPETITIONS;
  const repetitions = repetitionsBrutes === undefined ? 1 : Number(repetitionsBrutes);
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error('Le nombre de répétitions doit être un entier positif.');
  }

  const essaisBruts = extraireValeurArgument(argv, 'essais') ?? env.BENCHMARK_ESSAIS;
  const essaisCibles = essaisBruts ? parserEssaisCibles(essaisBruts, SCENARIOS_BENCHMARK) : undefined;

  return { modeles, repetitions, essaisCibles };
}

export function verifierCleAnthropic(env: Record<string, string | undefined>): string {
  const cle = env.ANTHROPIC_API_KEY?.trim();
  if (!cle) {
    throw new Error('ANTHROPIC_API_KEY est requise pour lancer le benchmark.');
  }
  return cle;
}

// ---------------------------------------------------------------------------
// TARIFS — jamais hardcodés : seulement si l'appelant les fournit.
// ---------------------------------------------------------------------------

export interface TarifModele {
  /** Prix pour 1 million de tokens d'entrée, dans la devise de l'appelant. */
  entree: number;
  /** Prix pour 1 million de tokens de sortie, dans la devise de l'appelant. */
  sortie: number;
}

function estTarifModeleValide(valeur: unknown): valeur is TarifModele {
  return (
    typeof valeur === 'object' &&
    valeur !== null &&
    typeof (valeur as TarifModele).entree === 'number' &&
    typeof (valeur as TarifModele).sortie === 'number'
  );
}

export function parserTarifs(brut: string | undefined): Record<string, TarifModele> {
  if (!brut) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(brut);
  } catch {
    throw new Error('BENCHMARK_TARIFS_JSON doit être un JSON valide.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('BENCHMARK_TARIFS_JSON doit être un objet { modele: { entree, sortie } }.');
  }
  const tarifs: Record<string, TarifModele> = {};
  for (const [modele, tarif] of Object.entries(parsed as Record<string, unknown>)) {
    if (!estTarifModeleValide(tarif)) {
      throw new Error(`Tarif invalide pour "${modele}" : attend { entree: number, sortie: number }.`);
    }
    tarifs[modele] = tarif;
  }
  return tarifs;
}

export function coutEstime(
  tarif: TarifModele | undefined,
  tokensEntree: number,
  tokensSortie: number
): number | undefined {
  if (!tarif) return undefined;
  return (tokensEntree / 1_000_000) * tarif.entree + (tokensSortie / 1_000_000) * tarif.sortie;
}

// ---------------------------------------------------------------------------
// CATÉGORISATION DES ÉCHECS — reprend les codes déjà posés par genererParcours.
// ---------------------------------------------------------------------------

export type CategorieEchec =
  | 'clarification_requise'
  | 'refus_metier'
  | 'sortie_inexploitable'
  | 'service_indisponible'
  | 'erreur_inattendue';

export function categoriserEchec(erreur: unknown): CategorieEchec {
  if (erreur instanceof AppError) {
    if (erreur.statusCode === 422) return 'refus_metier';
    if (erreur.statusCode === 502) return 'sortie_inexploitable';
    if (erreur.statusCode === 503) return 'service_indisponible';
  }
  return 'erreur_inattendue';
}

/**
 * F6-C — sous-code interne, uniquement pour une « sortie_inexploitable »
 * (502) : cette seule catégorie regroupait jusqu'ici plusieurs causes
 * distinctes (JSON invalide, schéma invalide, scope de lot violé, parcours
 * incohérent...). Un 502 posé sans sous-code (autre point du pipeline, hors
 * périmètre de cette mission) retombe sur `autre_sortie_inexploitable` plutôt
 * que de disparaître silencieusement.
 */
export function sousCodeEchec(erreur: unknown): CodeInterneEchec | undefined {
  if (!(erreur instanceof AppError) || erreur.statusCode !== 502) return undefined;
  return erreur.codeInterne ?? 'autre_sortie_inexploitable';
}

// ---------------------------------------------------------------------------
// ÉVALUATION DÉTERMINISTE D'UN PARCOURS PRODUIT
//
// Un parcours qui sort de genererParcours a déjà traversé ParcoursSchema et
// validerParcours (dépendances, invariants du domaine) : on ne les rejoue pas
// ici. Restent deux règles que genererParcours ne garantit PAS lui-même —
// que TOUTES les villes demandées sont couvertes (il valide juste qu'aucun
// moment ne déborde de la sienne), et qu'aucun jour du scénario n'est vide.
// ---------------------------------------------------------------------------

function normaliserTexte(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Un moment ne porte pas sa ville dans le schéma final (cf. ADR sur le
 * modèle conceptuel) : on ne peut donc que chercher le nom de la ville dans
 * les textes réellement écrits par le pipeline (titres, noms, adresses) —
 * une approximation textuelle assumée, pas une lecture d'un champ dédié.
 */
export function villesAttenduesPresentes(brief: Brief, parcours: Parcours): boolean {
  const texteComplet = normaliserTexte(
    parcours.timeline
      .flatMap((moment) => [
        moment.titre,
        ...moment.elements.flatMap((element) => [element.nom, element.lieu ?? '']),
      ])
      .join(' ')
  );
  return villesDeclarees(brief)
    .every((ville) => texteComplet.includes(normaliserTexte(ville.nom)));
}

function joursCivils(debut: string, fin: string): string[] {
  const jours: string[] = [];
  let curseur = new Date(`${debut.slice(0, 10)}T00:00:00.000Z`).getTime();
  const dernier = new Date(`${fin.slice(0, 10)}T00:00:00.000Z`).getTime();
  while (curseur <= dernier) {
    jours.push(new Date(curseur).toISOString().slice(0, 10));
    curseur += 86_400_000;
  }
  return jours;
}

export function aucuneJourneeManquante(brief: Brief, parcours: Parcours): boolean {
  if (!brief.dates) return true;
  const joursAttendus = joursCivils(brief.dates.debut, brief.dates.fin);
  const joursCouverts = new Set<string>();
  for (const moment of parcours.timeline) {
    if (moment.plage) joursCouverts.add(moment.plage.debut.slice(0, 10));
    for (const element of moment.elements) {
      if (element.plage) joursCouverts.add(element.plage.debut.slice(0, 10));
    }
  }
  return joursAttendus.every((jour) => joursCouverts.has(jour));
}

// ---------------------------------------------------------------------------
// RÉSULTAT D'UN ESSAI — jamais de prompt, de réponse ni de secret dedans.
// ---------------------------------------------------------------------------

export interface ResultatExecution {
  scenarioId: string;
  scenarioNom: string;
  modele: string;
  repetition: number;
  succes: boolean;
  categorieEchec?: CategorieEchec;
  sousCodeEchec?: CodeInterneEchec;
  dureeMs: number;
  tokensEntree: number;
  tokensSortie: number;
  tours: number;
  jsonValide: boolean;
  lotsPrevus: number;
  lotsGeneres: number;
  reprises: number;
  villesAttenduesPresentes?: boolean;
  aucuneJourneeManquante?: boolean;
}

/** Garde-fou de non-régression : la liste exhaustive des champs autorisés. */
export const CHAMPS_EXECUTION_AUTORISES = [
  'scenarioId',
  'scenarioNom',
  'modele',
  'repetition',
  'succes',
  'categorieEchec',
  'sousCodeEchec',
  'dureeMs',
  'tokensEntree',
  'tokensSortie',
  'tours',
  'jsonValide',
  'lotsPrevus',
  'lotsGeneres',
  'reprises',
  'villesAttenduesPresentes',
  'aucuneJourneeManquante',
] as const;

/**
 * Répète un couple (scénario, modèle) `repetitions` fois. Chaque essai est
 * isolé : si `executerUnEssai` échoue de façon inattendue (il ne le devrait
 * pas — il capture déjà ses propres erreurs), l'essai devient un résultat
 * d'échec au lieu d'arrêter les répétitions ou couples restants.
 */
async function executerRepetitions(
  scenario: ScenarioBenchmark,
  modele: string,
  repetitions: number,
  executerUnEssai: (
    scenario: ScenarioBenchmark,
    modele: string,
    repetition: number
  ) => Promise<ResultatExecution>
): Promise<ResultatExecution[]> {
  const resultats: ResultatExecution[] = [];
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    try {
      resultats.push(await executerUnEssai(scenario, modele, repetition));
    } catch (erreur) {
      resultats.push({
        scenarioId: scenario.id,
        scenarioNom: scenario.nom,
        modele,
        repetition,
        succes: false,
        categorieEchec: categoriserEchec(erreur),
        sousCodeEchec: sousCodeEchec(erreur),
        dureeMs: 0,
        tokensEntree: 0,
        tokensSortie: 0,
        tours: 0,
        jsonValide: false,
        lotsPrevus: 0,
        lotsGeneres: 0,
        reprises: 0,
      });
    }
  }
  return resultats;
}

/** Comportement historique : produit cartésien modèles × scénarios × répétitions. */
export async function executerTousLesEssais(
  modeles: string[],
  scenarios: ScenarioBenchmark[],
  repetitions: number,
  executerUnEssai: (
    scenario: ScenarioBenchmark,
    modele: string,
    repetition: number
  ) => Promise<ResultatExecution>
): Promise<ResultatExecution[]> {
  const executions: ResultatExecution[] = [];
  for (const modele of modeles) {
    for (const scenario of scenarios) {
      executions.push(...(await executerRepetitions(scenario, modele, repetitions, executerUnEssai)));
    }
  }
  return executions;
}

/**
 * F6-D — n'exécute que les couples modèle/scénario explicitement demandés
 * (déjà validés par `parserEssaisCibles`), au lieu du produit cartésien
 * complet. Chaque couple est répété `repetitions` fois.
 */
export async function executerCouplesCibles(
  couples: CoupleCible[],
  scenarios: ScenarioBenchmark[],
  repetitions: number,
  executerUnEssai: (
    scenario: ScenarioBenchmark,
    modele: string,
    repetition: number
  ) => Promise<ResultatExecution>
): Promise<ResultatExecution[]> {
  const executions: ResultatExecution[] = [];
  for (const couple of couples) {
    const scenario = scenarios.find((candidat) => candidat.id === couple.scenarioId);
    if (!scenario) {
      throw new Error(`Scénario inconnu dans un couple ciblé : "${couple.scenarioId}".`);
    }
    executions.push(...(await executerRepetitions(scenario, couple.modele, repetitions, executerUnEssai)));
  }
  return executions;
}

// ---------------------------------------------------------------------------
// AGRÉGATION — moyenne, médiane, min/max, variance, répartition des échecs.
// ---------------------------------------------------------------------------

export function moyenne(valeurs: number[]): number {
  if (valeurs.length === 0) return 0;
  return valeurs.reduce((somme, valeur) => somme + valeur, 0) / valeurs.length;
}

export function mediane(valeurs: number[]): number {
  if (valeurs.length === 0) return 0;
  const triees = [...valeurs].sort((a, b) => a - b);
  const milieu = Math.floor(triees.length / 2);
  return triees.length % 2 === 0 ? (triees[milieu - 1] + triees[milieu]) / 2 : triees[milieu];
}

export function variance(valeurs: number[]): number {
  if (valeurs.length === 0) return 0;
  const m = moyenne(valeurs);
  return moyenne(valeurs.map((valeur) => (valeur - m) ** 2));
}

export function minMax(valeurs: number[]): { min: number; max: number } {
  if (valeurs.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...valeurs), max: Math.max(...valeurs) };
}

export interface StatistiquesEnsemble {
  nombreEssais: number;
  tauxSucces: number;
  duree: { moyenne: number; mediane: number; min: number; max: number; variance: number };
  tokensEntreeMoyen: number;
  tokensSortieMoyen: number;
  toursMoyen: number;
  repartitionEchecs: Record<string, number>;
  /** F6-C — répartition des sous-codes, uniquement parmi les échecs 502. */
  repartitionSousCodesEchecs: Record<string, number>;
}

export function construireStatistiquesEnsemble(executions: ResultatExecution[]): StatistiquesEnsemble {
  const durees = executions.map((execution) => execution.dureeMs);
  const succes = executions.filter((execution) => execution.succes);
  const repartitionEchecs: Record<string, number> = {};
  const repartitionSousCodesEchecs: Record<string, number> = {};
  for (const execution of executions) {
    if (execution.succes) continue;
    const cle = execution.categorieEchec ?? 'erreur_inattendue';
    repartitionEchecs[cle] = (repartitionEchecs[cle] ?? 0) + 1;
    if (execution.sousCodeEchec) {
      repartitionSousCodesEchecs[execution.sousCodeEchec] =
        (repartitionSousCodesEchecs[execution.sousCodeEchec] ?? 0) + 1;
    }
  }
  const { min, max } = minMax(durees);
  return {
    nombreEssais: executions.length,
    tauxSucces: executions.length === 0 ? 0 : succes.length / executions.length,
    duree: { moyenne: moyenne(durees), mediane: mediane(durees), min, max, variance: variance(durees) },
    tokensEntreeMoyen: moyenne(executions.map((execution) => execution.tokensEntree)),
    tokensSortieMoyen: moyenne(executions.map((execution) => execution.tokensSortie)),
    toursMoyen: moyenne(executions.map((execution) => execution.tours)),
    repartitionEchecs,
    repartitionSousCodesEchecs,
  };
}

export interface StatistiquesModele {
  modele: string;
  global: StatistiquesEnsemble;
  parScenario: Record<string, StatistiquesEnsemble>;
}

export function agregerParModele(executions: ResultatExecution[]): StatistiquesModele[] {
  const modeles = [...new Set(executions.map((execution) => execution.modele))];
  return modeles.map((modele) => {
    const executionsDuModele = executions.filter((execution) => execution.modele === modele);
    const scenarios = [...new Set(executionsDuModele.map((execution) => execution.scenarioId))];
    const parScenario: Record<string, StatistiquesEnsemble> = {};
    for (const scenarioId of scenarios) {
      parScenario[scenarioId] = construireStatistiquesEnsemble(
        executionsDuModele.filter((execution) => execution.scenarioId === scenarioId)
      );
    }
    return { modele, global: construireStatistiquesEnsemble(executionsDuModele), parScenario };
  });
}

// ---------------------------------------------------------------------------
// RAPPORT JSON
// ---------------------------------------------------------------------------

export interface RapportBenchmark {
  genereLe: string;
  executions: ResultatExecution[];
  parModele: StatistiquesModele[];
}

export function construireRapport(executions: ResultatExecution[], genereLe: string): RapportBenchmark {
  return { genereLe, executions, parModele: agregerParModele(executions) };
}
