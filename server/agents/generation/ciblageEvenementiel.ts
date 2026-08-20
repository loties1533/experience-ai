import type { Brief } from '../brief.js';
import type { NatureEvenementielle } from '../../services/evenements/contrat.js';

function normaliserTexte(texte: string): string {
  return texte
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const DETERMINANT = String.raw`(?:(?:un|une|des|le|la|les|ce|cet|cette|ces|l)\s+)?`;
const CIBLE_AVEC_A = String.raw`(?:(?:a\s+${DETERMINANT})|au\s+|aux\s+)`;
const INTENSIFICATEUR_NEGATION = String.raw`(?:(?:surtout|vraiment|absolument)\s+)?`;
const MARQUEUR_NEGATION = String.raw`(?:pas|jamais|plus)`;
const NEGATION_DIRECTE_ACTION = String.raw`ne\s+${INTENSIFICATEUR_NEGATION}${MARQUEUR_NEGATION}`;
const NEGATION_MODALE_ACTION = String.raw`ne\s+(?:veux|souhaite|peux)\s+${INTENSIFICATEUR_NEGATION}${MARQUEUR_NEGATION}`;

function decouperPropositions(texte: string): string[] {
  return texte
    .split(/[,.!?;:]+/u)
    .flatMap((segment) =>
      normaliserTexte(segment).split(
        /\b(?:mais|puis|cependant|pourtant)\b/
      )
    )
    .map((proposition) => proposition.trim())
    .filter(Boolean);
}

function estMentionNiee(texte: string, objets: string): boolean {
  const negationDirecte = new RegExp(
    String.raw`\b(?:sans|pas de|aucun(?:e)?)\s+${DETERMINANT}${objets}\b`
  );
  const negationVerbale = new RegExp(
    String.raw`\b(?:je\s+)?${NEGATION_MODALE_ACTION}(?:\s+[a-z0-9]+){0,5}\s+${objets}\b`
  );
  return negationDirecte.test(texte) || negationVerbale.test(texte);
}

function estActionNiee(avantAction: string): boolean {
  return [
    new RegExp(String.raw`\b(?:${NEGATION_DIRECTE_ACTION}|sans)\s*$`),
    new RegExp(String.raw`\b${NEGATION_MODALE_ACTION}\s*$`),
    /\bimpossible\s+d\s*$/,
    /\bpas\s+envie\s+d\s*$/,
  ].some((negation) => negation.test(avantAction));
}

function contientPreuvePositive(
  proposition: string,
  preuves: readonly RegExp[]
): boolean {
  return preuves.some((preuve) => {
    const occurrences = proposition.matchAll(new RegExp(preuve.source, 'g'));
    return [...occurrences].some(
      (occurrence) =>
        occurrence.index !== undefined &&
        !estActionNiee(proposition.slice(0, occurrence.index))
    );
  });
}

/**
 * Ordre produit stable lorsqu'une intention démontre plusieurs besoins.
 * Les preuves sont des constructions positives bornées, jamais un nom seul :
 * une ambiance, la visite d'un lieu ou une mention niée ne suffisent pas.
 */
const REGLES_CIBLAGE_CITY_FIRST = [
  {
    nature: 'sport',
    objetsNies:
      String.raw`(?:matchs?|evenements? sportifs?|rencontres? sportives?|competitions? sportives?|tournois? sportifs?|nba)`,
    preuves: [
      new RegExp(
        String.raw`\b(?:assister\s+${CIBLE_AVEC_A}|(?:voir|aller voir|vivre)\s+${DETERMINANT})(?:matchs?|evenements? sportifs?|rencontres? sportives?|competitions? sportives?|tournois? sportifs?)\b`
      ),
      /\b(?:voir|vivre|suivre)\s+(?:(?:de la|la)\s+)?nba\b/,
    ],
  },
  {
    nature: 'concert',
    objetsNies: String.raw`concerts?`,
    preuves: [
      new RegExp(
        String.raw`\b(?:assister\s+${CIBLE_AVEC_A}|aller\s+${CIBLE_AVEC_A}|(?:aller voir|voir|vivre)\s+${DETERMINANT})concerts?\b`
      ),
      new RegExp(String.raw`\bbar\s+avec\s+${DETERMINANT}concert\b`),
      new RegExp(String.raw`\b${DETERMINANT}concert\s+me\s+plairait\b`),
    ],
  },
  {
    nature: 'festival',
    objetsNies: String.raw`festivals?`,
    preuves: [
      new RegExp(
        String.raw`\b(?:(?:assister|aller|participer)\s+${CIBLE_AVEC_A}|(?:rejoindre|vivre)\s+${DETERMINANT})festivals?\b`
      ),
    ],
  },
  {
    nature: 'arts_de_la_scene',
    objetsNies:
      String.raw`(?:pieces?(?: de theatre)?|theatres?|spectacles?|operas?|ballets?|stand up|comedies? musicales?)`,
    preuves: [
      new RegExp(
        String.raw`\b(?:assister\s+${CIBLE_AVEC_A}|(?:aller voir|voir)\s+${DETERMINANT})(?:pieces?(?: de theatre)?|spectacles?|operas?|ballets?|stand up|comedies? musicales?)\b`
      ),
    ],
  },
  {
    nature: 'communautaire',
    objetsNies:
      String.raw`(?:evenements? communautaires?|fetes? de quartier|rencontres? communautaires?)`,
    preuves: [
      new RegExp(
        String.raw`\b(?:participer\s+${CIBLE_AVEC_A}|(?:rejoindre|vivre)\s+${DETERMINANT})(?:evenements? communautaires?|fetes? de quartier|rencontres? communautaires?)\b`
      ),
    ],
  },
] as const satisfies readonly {
  nature: NatureEvenementielle;
  objetsNies: string;
  preuves: readonly RegExp[];
}[];

/**
 * Ciblage déterministe depuis l'intention confirmée, sans classification LLM.
 * Le tableau vide signifie qu'aucune recherche événementielle city-first ne
 * doit être proposée. Les contraintes ne sont pas analysées et les négations
 * présentes dans l'intention neutralisent uniquement la nature concernée.
 */
export function naturesEvenementiellesCityFirst(
  brief: Pick<Brief, 'intention'>
): NatureEvenementielle[] {
  const propositions = decouperPropositions(brief.intention);
  return REGLES_CIBLAGE_CITY_FIRST.flatMap(
    ({ nature, objetsNies, preuves }) =>
      propositions.some(
        (proposition) =>
          contientPreuvePositive(proposition, preuves) &&
          !estMentionNiee(proposition, objetsNies)
      )
        ? [nature]
        : []
  );
}
