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

const ARTICLE = String.raw`(?:(?:un|une|des|le|la|les|l)\s+)?`;

function estMentionNiee(texte: string, objets: string): boolean {
  const negationDirecte = new RegExp(
    String.raw`\b(?:sans|pas de|aucun(?:e)?)\s+${ARTICLE}${objets}\b`
  );
  const negationVerbale = new RegExp(
    String.raw`\b(?:je\s+)?ne\s+(?:veux|souhaite)\s+pas(?:\s+[a-z0-9]+){0,5}\s+${objets}\b`
  );
  return negationDirecte.test(texte) || negationVerbale.test(texte);
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
      /\b(?:voir|assister a|aller voir|vivre)\s+(?:(?:un|une|des|le|la|les|l)\s+)?(?:matchs?|evenements? sportifs?|rencontres? sportives?|competitions? sportives?|tournois? sportifs?)\b/,
      /\b(?:voir|vivre|suivre)\s+(?:de la\s+|la\s+)?nba\b/,
    ],
  },
  {
    nature: 'concert',
    objetsNies: String.raw`concerts?`,
    preuves: [
      /\b(?:assister a|aller a|aller au|aller voir|voir|vivre)\s+(?:(?:un|une|des|le|la|les|l)\s+)?concerts?\b/,
      /\bbar\s+avec\s+(?:(?:un|le)\s+)?concert\b/,
      /\b(?:(?:un|le|ce)\s+)?concert\s+me\s+plairait\b/,
    ],
  },
  {
    nature: 'festival',
    objetsNies: String.raw`festivals?`,
    preuves: [
      /\b(?:assister a|aller a|aller au|participer a|rejoindre|vivre)\s+(?:(?:un|une|des|le|la|les|l)\s+)?festivals?\b/,
    ],
  },
  {
    nature: 'arts_de_la_scene',
    objetsNies:
      String.raw`(?:pieces?(?: de theatre)?|theatres?|spectacles?|operas?|ballets?|stand up|comedies? musicales?)`,
    preuves: [
      /\b(?:assister a|aller voir|voir)\s+(?:(?:un|une|des|le|la|les|l)\s+)?(?:pieces?(?: de theatre)?|spectacles?|operas?|ballets?|stand up|comedies? musicales?)\b/,
    ],
  },
  {
    nature: 'communautaire',
    objetsNies:
      String.raw`(?:evenements? communautaires?|fetes? de quartier|rencontres? communautaires?)`,
    preuves: [
      /\b(?:participer a|rejoindre|vivre)\s+(?:(?:un|une|des|le|la|les|l)\s+)?(?:evenements? communautaires?|fetes? de quartier|rencontres? communautaires?)\b/,
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
  const intention = normaliserTexte(brief.intention);
  return REGLES_CIBLAGE_CITY_FIRST.flatMap(
    ({ nature, objetsNies, preuves }) =>
      preuves.some((preuve) => preuve.test(intention)) &&
      !estMentionNiee(intention, objetsNies)
        ? [nature]
        : []
  );
}
