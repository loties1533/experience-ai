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

/**
 * Ordre produit stable lorsqu'une intention démontre plusieurs besoins.
 * Chaque motif exige un terme événementiel explicite : une ville, des dates,
 * « culture » ou « découvrir » ne suffisent jamais à ouvrir la recherche.
 */
const REGLES_CIBLAGE_CITY_FIRST = [
  {
    nature: 'sport',
    motif:
      /\b(match|matchs|evenement sportif|evenements sportifs|competition sportive|competitions sportives|tournoi sportif|tournois sportifs|nba)\b/,
  },
  { nature: 'concert', motif: /\bconcerts?\b/ },
  { nature: 'festival', motif: /\bfestivals?\b/ },
  {
    nature: 'arts_de_la_scene',
    motif:
      /\b(piece de theatre|pieces de theatre|theatre|spectacles?|operas?|ballets?|comedie musicale|comedies musicales)\b/,
  },
  {
    nature: 'communautaire',
    motif:
      /\b(evenement communautaire|evenements communautaires|fete de quartier|fetes de quartier|rencontre communautaire|rencontres communautaires)\b/,
  },
] as const satisfies readonly {
  nature: NatureEvenementielle;
  motif: RegExp;
}[];

/**
 * Ciblage déterministe depuis l'intention confirmée, sans classification LLM.
 * Le tableau vide signifie qu'aucune recherche événementielle city-first ne
 * doit être proposée. Les contraintes ne sont pas analysées afin qu'un terme
 * négatif comme « sans concert » ne devienne pas une fausse preuve positive.
 */
export function naturesEvenementiellesCityFirst(
  brief: Pick<Brief, 'intention'>
): NatureEvenementielle[] {
  const intention = normaliserTexte(brief.intention);
  return REGLES_CIBLAGE_CITY_FIRST.flatMap(({ nature, motif }) =>
    motif.test(intention) ? [nature] : []
  );
}
