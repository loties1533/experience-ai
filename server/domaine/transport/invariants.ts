import type {
  PreuveTrajet,
  SegmentTransportExterne,
  TronconTransportDemande,
} from './schema.js';

export const LIBELLE_TRANSPORT_GENERIQUE = 'Transport à organiser';
export const JUSTIFICATION_TRANSPORT_GENERIQUE =
  'Prévoir un transport selon les informations déclarées.';

export function libelleTransportDemande(
  troncon: TronconTransportDemande
): string {
  return `${LIBELLE_TRANSPORT_GENERIQUE} de ${troncon.origine.ville} vers ${troncon.destination.ville}`;
}

export function justificationTransportDemande(
  troncon: TronconTransportDemande
): string {
  return `Prévoir un transport entre ${troncon.origine.ville} et ${troncon.destination.ville} selon les dates et préférences déclarées.`;
}

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
 * F4-B2 ne résout encore aucun lieu de transport. Une valeur qui ressemble à
 * une gare, un aéroport, un terminal ou un code fournisseur n'est donc pas une
 * ville persistable. Le refus est volontairement conservateur.
 */
export function estVilleTransportDemandeePrudente(
  ville: string
): boolean {
  const valeur = ville.trim();
  const contientCaractereControle = [...valeur].some((caractere) => {
    const code = caractere.codePointAt(0);
    return code !== undefined && (code <= 31 || code === 127);
  });
  return (
    valeur.length > 0 &&
    valeur.length <= 120 &&
    !contientCaractereControle &&
    !/[<>]/u.test(valeur) &&
    !/\b(?:https?:\/\/|r[ée]servation|billet|disponibilit[ée]|confirm[ée]e?)\b/i.test(
      valeur
    ) &&
    !/\b\d{1,2}:\d{2}\b/.test(valeur) &&
    !/\b(?:a[ée]roport|gare|station|terminal|quai|porte)\b/i.test(
      valeur
    ) &&
    !/(?:^|\s)[A-Z0-9]{3,4}(?=$|\s)/.test(valeur)
  );
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
