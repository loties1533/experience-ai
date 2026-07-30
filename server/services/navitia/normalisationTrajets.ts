import type { ModeTransport } from '../../domaine/transport/index.js';
import {
  CandidatTrajetFerroviaireNavitiaSchema,
  FOURNISSEUR_NAVITIA,
  type CandidatTrajetFerroviaireNavitia,
  type FraicheurNavitia,
  type JourneyNavitia,
  type PointTrajetNavitia,
  type ProvenanceGareNavitia,
  type SectionNavitia,
  type SectionTrajetNavitia,
  type SectionTransportPublicNavitia,
} from './schema.js';

const TYPE_SECTION_TRANSPORT_PUBLIC = 'public_transport';

/**
 * Séparateur impossible à rencontrer dans une valeur Navitia : un nom de
 * gare ou un code de ligne peut contenir une espace, jamais ce caractère.
 * Même technique que le rapprochement de lieux du domaine.
 */
const SEPARATEUR_SIGNATURE = '\u0000';

/**
 * Modes physiques Navitia réellement rencontrés, mis en correspondance avec le
 * vocabulaire du domaine.
 *
 * La correspondance se fait sur l'identifiant exact publié par Navitia : jamais
 * par recherche de sous-chaîne, et jamais depuis le nom commercial d'une ligne.
 * Un mode inconnu devient `autre` — il ne peut donc pas se faire passer pour un
 * train, puisqu'un trajet exige au moins une section ferroviaire.
 */
const MODES_PHYSIQUES_NAVITIA: Readonly<Record<string, ModeTransport>> = {
  'physical_mode:Train': 'train',
  'physical_mode:LongDistanceTrain': 'train',
  'physical_mode:LocalTrain': 'train',
  'physical_mode:RailShuttle': 'train',
  'physical_mode:Bus': 'bus',
  'physical_mode:Ferry': 'ferry',
  'physical_mode:Metro': 'transport_local',
  'physical_mode:Tramway': 'transport_local',
  'physical_mode:RapidTransit': 'transport_local',
};

export function modeTransportDepuisModePhysiqueNavitia(
  modePhysique: string
): ModeTransport {
  return MODES_PHYSIQUES_NAVITIA[modePhysique] ?? 'autre';
}

/**
 * Le fuseau n'est lu que là où Navitia le publie : sur un `stop_area`, qu'il
 * soit l'extrémité elle-même ou celui rattaché au `stop_point`. Sans fuseau
 * fiable, l'extrémité n'est pas représentable et la section est refusée.
 */
function pointDepuisExtremite(
  extremite: SectionNavitia['from']
): PointTrajetNavitia | null {
  const stopArea = extremite?.stop_area ?? extremite?.stop_point?.stop_area;
  if (!stopArea) return null;
  return {
    identifiantExterne: stopArea.id,
    nom: stopArea.name,
    fuseauIana: stopArea.timezone,
  };
}

function sectionTransportPublic(
  section: SectionNavitia
): SectionTrajetNavitia | null {
  const modePhysique = section.display_informations?.physical_mode;
  const origine = pointDepuisExtremite(section.from);
  const destination = pointDepuisExtremite(section.to);
  if (
    !modePhysique ||
    !origine ||
    !destination ||
    !section.departure_date_time ||
    !section.arrival_date_time
  ) {
    return null;
  }

  return {
    nature: 'transport_public',
    mode: modeTransportDepuisModePhysiqueNavitia(modePhysique),
    modePhysique,
    ...(section.display_informations?.commercial_mode
      ? { modeCommercial: section.display_informations.commercial_mode }
      : {}),
    ...(section.display_informations?.network
      ? { reseau: section.display_informations.network }
      : {}),
    ...(section.display_informations?.code
      ? { codeLigne: section.display_informations.code }
      : {}),
    ...(section.display_informations?.direction
      ? { direction: section.display_informations.direction }
      : {}),
    origine,
    destination,
    departLocal: section.departure_date_time,
    arriveeLocale: section.arrival_date_time,
    dureeSecondes: section.duration,
  };
}

function estSectionTransportPublic(
  section: SectionTrajetNavitia
): section is SectionTransportPublicNavitia {
  return section.nature === 'transport_public';
}

function sectionNormalisee(
  section: SectionNavitia
): SectionTrajetNavitia | null {
  if (section.type === TYPE_SECTION_TRANSPORT_PUBLIC) {
    return sectionTransportPublic(section);
  }
  return {
    nature: 'hors_transport_public',
    typeNavitia: section.type,
    dureeSecondes: section.duration,
  };
}

/**
 * Signature déterministe d'un itinéraire : Navitia ne rend aucun identifiant
 * de journey stable. Elle n'est fondée que sur des faits fournisseur, et reste
 * lisible plutôt que hachée.
 */
function signatureTrajet(
  sections: readonly SectionTrajetNavitia[],
  fraicheur: FraicheurNavitia,
  departLocal: string,
  arriveeLocale: string
): string {
  const empreinteSections = sections.map((section) =>
    section.nature === 'transport_public'
      ? [
          section.modePhysique,
          section.codeLigne ?? '',
          section.origine.identifiantExterne,
          section.destination.identifiantExterne,
          section.departLocal,
          section.arriveeLocale,
        ].join('|')
      : `${section.typeNavitia}|${section.dureeSecondes}`
  );
  return [
    fraicheur,
    departLocal,
    arriveeLocale,
    ...empreinteSections,
  ].join(SEPARATEUR_SIGNATURE);
}

/**
 * Normalise un itinéraire Navitia en candidat ferroviaire.
 *
 * Fonction pure : ni réseau, ni environnement, ni horloge. Les heures restent
 * locales — aucune n'est interprétée par `Date`, et aucun fuseau n'est déduit.
 *
 * Rend `null` lorsque l'itinéraire n'est pas représentable prudemment, et
 * `undefined` lorsqu'il est valide mais hors cible (aucune section ferroviaire).
 */
export function candidatDepuisJourney(
  journey: JourneyNavitia,
  contexte: ProvenanceGareNavitia & { fraicheur: FraicheurNavitia }
): CandidatTrajetFerroviaireNavitia | null | undefined {
  const sections: SectionTrajetNavitia[] = [];
  for (const section of journey.sections) {
    const normalisee = sectionNormalisee(section);
    if (!normalisee) return null;
    sections.push(normalisee);
  }

  // Un itinéraire sans section ferroviaire est hors cible : un bus ou un métro
  // seul ne devient jamais un trajet en train.
  const sectionsTransportPublic = sections.filter(estSectionTransportPublic);
  if (!sectionsTransportPublic.some((section) => section.mode === 'train')) {
    return undefined;
  }

  const premiere = sectionsTransportPublic[0];
  const derniere =
    sectionsTransportPublic[sectionsTransportPublic.length - 1];

  const validation = CandidatTrajetFerroviaireNavitiaSchema.safeParse({
    fournisseur: FOURNISSEUR_NAVITIA,
    signature: signatureTrajet(
      sections,
      contexte.fraicheur,
      journey.departure_date_time,
      journey.arrival_date_time
    ),
    origine: premiere.origine,
    destination: derniere.destination,
    departLocal: journey.departure_date_time,
    arriveeLocale: journey.arrival_date_time,
    dureeSecondes: journey.duration,
    nombreCorrespondancesFournisseur: journey.nb_transfers,
    sections,
    fraicheur: contexte.fraicheur,
    source: contexte.source,
    recupereLe: contexte.recupereLe,
  });
  return validation.success ? validation.data : null;
}
