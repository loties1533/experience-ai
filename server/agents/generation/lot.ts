import { z } from 'zod';
import {
  callAIAvecOutils,
  parseJSON,
  type MetriquesAppelOutils,
} from '../../services/claude/core.js';
import type { BoiteAOutils } from '../../services/claude/outils.js';
import { AppError } from '../../lib/AppError.js';
import type { Brief } from '../brief.js';
import { numeroDeJour, type LotPrevu } from './plan.js';
import { cleTexte } from './resolution.js';
import {
  MESSAGE_PUBLIC_REFUS_HORS_PERIMETRE,
  RefusGenerationSchema,
  SortieGenerationSchema,
  SYSTEM_GENERATION,
  type MomentGenere,
} from './contratLLM.js';

// LE CYCLE DE VIE D'UN LOT : prépare le brief restreint, lance l'appel outillé,
// applique la frontière de méfiance (parse, refus, schéma), namespace les refs
// et valide le scope. Les erreurs propres à un lot (422/502/503) naissent ICI ;
// l'orchestration des tentatives et l'assemblage restent dans la façade.

// Un lot techniquement indisponible (503) est rejoué seul, sans toucher aux
// lots déjà validés. Au-delà de cette borne, la génération échoue sans exposer
// de parcours partiel. Un refus métier (422) ou une sortie inexploitable (502)
// ne se rejoue pas : ce ne sont pas des indisponibilités techniques.
export const TENTATIVES_MAX_PAR_LOT = 2;

/**
 * Le brief remis au modèle pour UN lot : restreint à sa ville et à sa plage de
 * jours. Le transport est retiré (il est synthétisé de façon déterministe après
 * assemblage, jamais par le LLM) et l'hébergement n'est transmis que pour les
 * séjours de cette ville. La durée globale est masquée dès qu'une plage précise
 * la remplace, pour ne pas inviter le modèle à couvrir tout le parcours.
 *
 * F6-F — un lot qui couvre À LUI SEUL tout le plan (mono-ville, mono-bloc)
 * garde les heures précises du brief (ex. une soirée 18h-23h59) plutôt que de
 * les reconstruire en jour civil plein (00:00-23:59:59.999) : cette fenêtre
 * plus large que celle demandée invitait le modèle à raisonner en heure
 * locale et à écrire une plage franchissant minuit UTC, hors du seul jour que
 * couvre le lot. Un plan à plusieurs lots garde la reconstruction : chaque
 * lot n'y couvre qu'une sous-plage de jours du brief, dont le brief ne porte
 * pas les heures.
 */
export function briefPourLot(brief: Brief, lot: LotPrevu, lotUniqueDuPlan: boolean): Record<string, unknown> {
  // La ville projetée ici vient du PlanGeneration, lui-même dérivé du
  // ContextePlanifiable. Le Brief reste la déclaration utilisateur intacte,
  // jamais une seconde source de vérité pour la géographie du lot.
  const lieux = lot.ville ? [lot.ville] : [];
  const dates =
    lot.plage && !lotUniqueDuPlan
      ? { debut: `${lot.plage.debut}T00:00:00.000Z`, fin: `${lot.plage.fin}T23:59:59.999Z` }
      : brief.dates;

  const sejoursDuLot =
    brief.hebergement?.necessaire === true && lot.ville
      ? brief.hebergement.sejours.filter(
          (sejour) => cleTexte(sejour.ville) === cleTexte(lot.ville as string)
        )
      : [];
  const hebergement =
    brief.hebergement?.necessaire === true && sejoursDuLot.length > 0
      ? { ...brief.hebergement, sejours: sejoursDuLot }
      : undefined;

  return {
    intention: brief.intention,
    avecQui: brief.avecQui,
    ...(lot.plage ? {} : { duree: brief.duree }),
    ...(dates ? { dates } : {}),
    lieux,
    ...(brief.budgetTotal === undefined ? {} : { budgetTotal: brief.budgetTotal }),
    ...(brief.ambiance ? { ambiance: brief.ambiance } : {}),
    contraintes: brief.contraintes,
    ...(hebergement ? { hebergement } : {}),
  };
}

/**
 * Génère un lot : un appel IA outillé, puis la même frontière de méfiance que
 * l'ancien appel unique. Rend les moments bruts validés, ou lève une AppError
 * dont le code porte la politique d'erreur existante (503 technique rejouable,
 * 422 refus métier, 502 sortie inexploitable).
 */
/**
 * F6-B : point d'injection du modèle Anthropic et de récupération des
 * métriques d'appel, réservé au benchmark manuel. Absent (comportement des
 * routes), le modèle par défaut de `callAIAvecOutils` reste inchangé.
 */
export interface OptionsGenerationParcours {
  modele?: string;
  onMetriques?: (metriques: MetriquesAppelOutils) => void;
}

export async function genererLot(
  prompt: string,
  boite: BoiteAOutils,
  options: OptionsGenerationParcours = {}
): Promise<z.infer<typeof SortieGenerationSchema>> {
  const brut = await callAIAvecOutils(prompt, SYSTEM_GENERATION, boite, 'pack', options);
  let contenu: unknown;
  try {
    contenu = parseJSON(brut);
  } catch {
    throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'json_invalide');
  }
  if (
    typeof contenu === 'object' &&
    contenu !== null &&
    (contenu as { indisponible?: unknown }).indisponible === true
  ) {
    throw new AppError('Service IA momentanément indisponible, réessaie dans un instant', 503);
  }
  if (
    typeof contenu === 'object' &&
    contenu !== null &&
    (contenu as { outilsIndisponibles?: unknown }).outilsIndisponibles === true
  ) {
    throw new AppError(
      'Les sources nécessaires pour vérifier ce parcours sont momentanément indisponibles',
      503
    );
  }
  const refus = RefusGenerationSchema.safeParse(contenu);
  if (refus.success) {
    const { refus: donneesRefus } = refus.data;
    // Refus hors périmètre : aucune recherche associée, donc jamais
    // requalifiable en indisponibilité technique. Le message public est fixe
    // et choisi par le serveur — le contrat ne laisse même pas le modèle
    // fournir de champ "message" pour ce code (cf. RefusHorsPerimetreSchema).
    if (donneesRefus.code === 'hors_perimetre_produit') {
      throw new AppError(MESSAGE_PUBLIC_REFUS_HORS_PERIMETRE, 422);
    }
    // Donnée essentielle introuvable : une recherche vérifiable existe, une
    // panne technique déguisée en refus reste distinguée ici. Comportement
    // inchangé — le message public reste celui fourni par le modèle.
    const statutRecherche = donneesRefus.besoinEssentiel
      ? boite.statutRechercheEssentielle(donneesRefus.besoinEssentiel)
      : undefined;
    if (statutRecherche === 'indisponible') {
      throw new AppError(
        'Les sources nécessaires pour vérifier ce parcours sont momentanément indisponibles',
        503
      );
    }
    throw new AppError(donneesRefus.message, 422);
  }
  const sortie = SortieGenerationSchema.safeParse(contenu);
  if (!sortie.success) {
    throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'schema_generation_invalide');
  }
  return sortie.data;
}

/**
 * Namespace les refs d'un lot pour qu'elles ne puissent jamais entrer en
 * collision avec celles d'un autre lot, et réécrit simultanément tous les
 * `dependDe`. Un `dependDe` qui ne cible pas une ref du même lot fait échouer le
 * lot (jamais supprimé silencieusement) : une dépendance inter-lots ou inconnue
 * révèle une sortie incohérente, pas un manque à combler discrètement.
 */
export function namespacerLot(lot: LotPrevu, moments: MomentGenere[]): MomentGenere[] {
  const prefixe = `${lot.id}:`;
  const refs = moments.flatMap((moment) =>
    moment.elements.map((element) => element.ref)
  );
  const refsDuLot = new Set(refs);
  if (refsDuLot.size !== refs.length) {
    throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'ref_dupliquee');
  }
  for (const moment of moments) {
    for (const element of moment.elements) {
      for (const dependance of element.dependDe) {
        if (!refsDuLot.has(dependance)) {
          throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'dependance_hors_lot');
        }
      }
    }
  }
  return moments.map((moment) => ({
    ...moment,
    elements: moment.elements.map((element) => ({
      ...element,
      ref: prefixe + element.ref,
      dependDe: element.dependDe.map((dependance) => prefixe + dependance),
    })),
  }));
}

/**
 * Frontière technique, pas seulement textuelle : un moment qui déclare une
 * ville hors du lot, ou un élément dont la plage déborde de celle du lot, fait
 * échouer le lot. Peu importe que ce débordement vienne d'une recherche
 * cross-ville laissée passer ou d'une pure invention du modèle — ni le prompt
 * ni la restriction des outils ne suffisent seuls à le garantir.
 */
function villeHorsLot(ville: string | undefined, lot: LotPrevu): boolean {
  return (
    lot.ville !== undefined &&
    ville !== undefined &&
    cleTexte(ville) !== cleTexte(lot.ville)
  );
}

function plageHorsLot(
  plage: { debut: string; fin: string } | undefined,
  lot: LotPrevu
): boolean {
  if (!lot.plage || !plage) return false;
  const jourDebut = numeroDeJour(plage.debut.slice(0, 10));
  const jourFin = numeroDeJour(plage.fin.slice(0, 10));
  return (
    jourDebut < numeroDeJour(lot.plage.debut) ||
    jourFin > numeroDeJour(lot.plage.fin)
  );
}

export function validerScopeLot(lot: LotPrevu, moments: MomentGenere[]): void {
  for (const moment of moments) {
    // Un moment exclusivement transport est un placeholder synthétique dont
    // seule la POSITION compte : `nettoyerMomentsTransport` jette ensuite son
    // contenu (ville, plage, nom) pour le remplacer par le tronçon réel de la
    // demande. Le valider ici rejetterait un lot pour un contenu déjà destiné
    // à disparaître.
    const exclusivementTransport =
      moment.elements.length > 0 &&
      moment.elements.every((element) => element.type === 'transport');
    if (exclusivementTransport) continue;

    if (villeHorsLot(moment.ville, lot)) {
      throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'ville_hors_lot');
    }
    if (plageHorsLot(moment.plage, lot)) {
      throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'plage_hors_lot');
    }
    for (const element of moment.elements) {
      if (element.type === 'transport') continue;
      if (plageHorsLot(element.plage, lot)) {
        throw new AppError('La génération a produit un résultat inexploitable, réessaie', 502, 'plage_hors_lot');
      }
    }
  }
}
