import { AppError } from '../../lib/AppError.js';
import { callAI, parseJSON, sanitizeInput } from '../../services/claude/core.js';
import type { Brief } from '../brief.js';
import {
  PropositionDecouverteDestinationsSchema,
  type PropositionDecouverteDestinations,
} from './contratDecouverteDestinations.js';
import {
  ContextePlanifiableSchema,
  ResultatCadrageGenerationSchema,
  type ResultatCadrageGeneration,
} from './contratPreparation.js';
import {
  analyserContraintesGeographiques,
  resoudreDestinationsProposees,
  type ResultatResolutionDestinations,
} from './resolutionDestinations.js';

const SYSTEME_DECOUVERTE_DESTINATIONS = `Tu proposes des noms de destinations à vérifier pour une envie de voyage.
Réponds UNIQUEMENT avec un objet JSON strict de cette forme :
{"format":"sejour"|"itineraire","facettesObligatoires":[],"facettesSouples":[],"candidats":[{"nom":string,"codePaysSuggere"?:string}]}

Règles absolues :
- 1 à 5 candidats, sans doublon de nom ;
- facettes autorisées uniquement : sports_hiver, nature, plage, gastronomie, culture, detente ;
- au moins une facette obligatoire ;
- codePaysSuggere est un code ISO alpha-2 majuscule, seulement si pertinent ;
- aucune justification, preuve, note, score, prix, disponibilité ou affirmation marketing ;
- ne prétends jamais qu'une destination est supérieure, ensoleillée ou adaptée au budget ;
- "itineraire" uniquement si l'intention exprime réellement une tournée ou plusieurs étapes.`;

function normaliserTexte(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const MOTIFS_FACETTES = [
  /\b(ski|snowboard|neige|sport(?:s)? d hiver|montagne en hiver)\b/,
  /\b(nature|montagne|trek|randonnee|alpinisme|foret|parc)\b/,
  /\b(plage|mer|ocean|surf)\b/,
  /\b(gastronom|culinaire|cuisine|restaurant|vin|vignoble)\b/,
  /\b(culture|musee|patrimoine|histoire|architecture|musique|concert)\b/,
  /\b(detente|bien etre|spa|relax|repos|massage|sauna)\b/,
] as const;

function intentionTropVague(brief: Brief): boolean {
  const texte = normaliserTexte(
    [brief.intention, ...brief.contraintes].join(' ')
  );
  if (MOTIFS_FACETTES.some((motif) => motif.test(texte))) return false;
  return (
    texte.length < 24 ||
    /^(je veux |j aimerais )?(partir|voyager)( quelque part)?( de bien)?$/.test(
      texte
    ) ||
    /\b(quelque part|un endroit sympa|de bien)\b/.test(texte)
  );
}

type BesoinSoleil = 'absent' | 'souple' | 'a_clarifier' | 'indispensable';

function besoinSoleil(brief: Brief): BesoinSoleil {
  const texte = normaliserTexte(
    [brief.intention, ...brief.contraintes].join(' ')
  );
  if (!/\b(soleil|ensoleille|beau temps|meteo)\b/.test(texte)) return 'absent';
  if (
    /\b(pas indispensable|non indispensable|sans garantie meteo|peu importe la meteo|soleil facultatif)\b/.test(
      texte
    )
  ) {
    return 'souple';
  }
  if (
    /\b(soleil|ensoleille|beau temps|meteo)\b.{0,25}\b(indispensable|obligatoire|imperatif|non negociable)\b/.test(
      texte
    ) ||
    /\b(indispensable|obligatoire|imperatif|non negociable)\b.{0,25}\b(soleil|ensoleille|beau temps|meteo)\b/.test(
      texte
    )
  ) {
    return 'indispensable';
  }
  if (/\b(de preference|si possible|idealement|souhait|aimerais)\b/.test(texte)) {
    return 'souple';
  }
  return 'a_clarifier';
}

function clarification(
  code:
    | 'zone_geographique_requise'
    | 'periode_requise'
    | 'intention_a_preciser',
  question: string,
  champCible: 'lieux' | 'dates' | 'intention'
): ResultatCadrageGeneration {
  return ResultatCadrageGenerationSchema.parse({
    type: 'clarification_requise',
    clarification: { code, question, champCible },
    etatDialogue: {
      champ: 'preparation_generation',
      code,
      champCible,
    },
  });
}

export interface DependancesDecouverteDestinations {
  appelerIA: (
    prompt: string,
    systeme: string,
    contexte: 'destinations'
  ) => Promise<string>;
  resoudre: (
    brief: Brief,
    proposition: PropositionDecouverteDestinations
  ) => Promise<ResultatResolutionDestinations>;
}

const DEPENDANCES_PAR_DEFAUT: DependancesDecouverteDestinations = {
  appelerIA: callAI,
  resoudre: resoudreDestinationsProposees,
};

export async function proposerDestinations(
  brief: Brief,
  appelerIA: DependancesDecouverteDestinations['appelerIA'] = callAI
): Promise<PropositionDecouverteDestinations> {
  const prompt = `Brief confirmé, à interpréter sans le compléter :
${JSON.stringify({
  intention: sanitizeInput(brief.intention),
  duree: brief.duree,
  dates: brief.dates,
  lieux: brief.lieux.map(sanitizeInput),
  contraintes: brief.contraintes.map(sanitizeInput),
})}

Propose uniquement des localités peuplées plausibles à faire vérifier par le serveur. Le soleil n'est pas une facette disponible et ne doit produire aucune promesse météo.`;
  let contenu: unknown;
  try {
    contenu = parseJSON(
      await appelerIA(prompt, SYSTEME_DECOUVERTE_DESTINATIONS, 'destinations')
    );
  } catch {
    throw new AppError(
      'La proposition de destinations a produit une sortie inexploitable.',
      502
    );
  }
  const proposition = PropositionDecouverteDestinationsSchema.safeParse(contenu);
  if (!proposition.success) {
    throw new AppError(
      'La proposition de destinations a produit une sortie inexploitable.',
      502
    );
  }
  return proposition.data;
}

/**
 * Préconditions, proposition bornée, preuves externes puis décision serveur.
 * Le Brief n'est jamais réécrit et aucune proposition brute n'atteint le
 * ContextePlanifiable.
 */
export async function decouvrirDestinations(
  brief: Brief,
  dependances: DependancesDecouverteDestinations = DEPENDANCES_PAR_DEFAUT
): Promise<ResultatCadrageGeneration> {
  if (intentionTropVague(brief)) {
    return clarification(
      'intention_a_preciser',
      'Tu recherches plutôt nature, culture, gastronomie ou détente ?',
      'intention'
    );
  }
  if (!brief.dates) {
    return clarification(
      'periode_requise',
      'À quelle période souhaites-tu partir ?',
      'dates'
    );
  }

  const soleil = besoinSoleil(brief);
  const contraintes = analyserContraintesGeographiques(brief);
  if (
    soleil === 'a_clarifier' &&
    contraintes.codesPaysAutorises === undefined
  ) {
    return clarification(
      'zone_geographique_requise',
      'Tu préfères rester en Europe ou es-tu ouvert à plus loin ?',
      'lieux'
    );
  }
  if (soleil === 'a_clarifier') {
    return clarification(
      'intention_a_preciser',
      'Le soleil est-il indispensable, ou une destination plage/détente sans garantie météo te convient-elle ?',
      'intention'
    );
  }
  if (soleil === 'indispensable') {
    return ResultatCadrageGenerationSchema.parse({
      type: 'refus',
      refus: {
        code: 'hors_perimetre_produit',
        message:
          'Nous ne pouvons pas garantir l’ensoleillement d’une destination pour une période future.',
      },
    });
  }

  const proposition = await proposerDestinations(brief, dependances.appelerIA);
  const resolution = await dependances.resoudre(brief, proposition);
  if (resolution.statut === 'clarification_zone') {
    return clarification(
      'zone_geographique_requise',
      'Tu préfères rester en Europe ou es-tu ouvert à plus loin ?',
      'lieux'
    );
  }
  if (resolution.statut === 'vide') {
    return ResultatCadrageGenerationSchema.parse({
      type: 'refus',
      refus: {
        code: 'donnees_essentielles_insuffisantes',
        message:
          'Aucune destination suffisamment vérifiée n’a été trouvée pour cette envie.',
      },
    });
  }

  return ResultatCadrageGenerationSchema.parse({
    type: 'planifiable',
    contexte: ContextePlanifiableSchema.parse({
      strategie: 'decouverte_destinations',
      etapes: resolution.destinations.map(({ destination }) => ({
        ville: {
          nom: destination.nomCanonique,
          origine: 'selection_moteur',
        },
        ancres: [],
      })),
      contraintesConservees: {
        dates: brief.dates,
        ...(brief.budgetTotal === undefined
          ? {}
          : { budgetTotal: brief.budgetTotal }),
      },
    }),
  });
}
