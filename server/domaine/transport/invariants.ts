import type {
  PreuveTrajet,
  SegmentTransportExterne,
} from './schema.js';

/**
 * Normalisation réservée aux comparaisons métier. La valeur exprimée par
 * l'utilisateur reste conservée par le schéma, à l'exception des espaces en
 * bordure.
 */
export function normaliserVillePourComparaison(ville: string): string {
  return ville
    .trim()
    .toLocaleLowerCase('fr')
    .normalize('NFD')
    .replace(/(?<=\p{Script=Latin})\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .trim()
    .normalize('NFC');
}

/**
 * Compare deux dates civiles ISO sans créer de Date ni appliquer de fuseau.
 * Les chaînes sont supposées déjà validées au format AAAA-MM-JJ.
 */
export function comparerDatesCiviles(
  premiere: string,
  seconde: string
): -1 | 0 | 1 {
  if (premiere === seconde) return 0;
  return premiere < seconde ? -1 : 1;
}

/**
 * Compare deux horaires observés en tenant compte de leur décalage explicite.
 * Les chaînes sont supposées déjà validées comme dates-heures ISO.
 */
export function comparerInstants(
  premier: string,
  second: string
): -1 | 0 | 1 {
  const premierInstant = Date.parse(premier);
  const secondInstant = Date.parse(second);
  if (premierInstant === secondInstant) return 0;
  return premierInstant < secondInstant ? -1 : 1;
}

function cleLieuConfirme(
  lieu: SegmentTransportExterne['origine']
): string {
  return `${lieu.fournisseur.trim()}\u0000${lieu.identifiantExterne.trim()}`;
}

/**
 * Un changement de segment est continu uniquement lorsque le lieu confirmé
 * précédent et le suivant partagent la même identité fournisseur. Les noms
 * affichés ne servent jamais de rapprochement de secours.
 */
export function verifierContinuiteSegments(
  segments: readonly SegmentTransportExterne[]
): boolean {
  for (let index = 1; index < segments.length; index += 1) {
    const precedent = segments[index - 1];
    const courant = segments[index];
    if (
      cleLieuConfirme(precedent.destination) !==
        cleLieuConfirme(courant.origine) ||
      comparerInstants(
        courant.depart.horodatage,
        precedent.arrivee.horodatage
      ) < 0
    ) {
      return false;
    }
  }
  return true;
}

const CHAMPS_IDENTITE_COMPLETE = [
  'mode',
  'origine',
  'destination',
  'depart',
  'arrivee',
] as const;

/**
 * Une preuve peut être partielle. Ce helper ne fabrique ni preuve ni niveau
 * de confiance : il vérifie seulement la couverture des champs structurants.
 */
export function couvreIdentiteCompleteTrajet(
  preuve: PreuveTrajet
): boolean {
  const champs = new Set(preuve.champsVerifies);
  return CHAMPS_IDENTITE_COMPLETE.every((champ) => champs.has(champ));
}
