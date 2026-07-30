import type { CodeLieuTransport } from '../../domaine/transport/index.js';
import { CodeLieuTransportSchema } from '../../domaine/transport/index.js';
import {
  CandidatGareNavitiaSchema,
  FOURNISSEUR_NAVITIA,
  PlaceNavitiaSchema,
  ProvenanceGareNavitiaSchema,
  TYPE_LIEU_STOP_AREA_NAVITIA,
  type CandidatGareNavitia,
  type CodeNavitia,
  type ProvenanceGareNavitia,
  type StopAreaNavitia,
} from './schema.js';

const TYPE_CODE_UIC_NAVITIA = 'uic';

/**
 * Navitia rend ses coordonnées en texte. Une chaîne vide ou non numérique n'est
 * jamais convertie en zéro : elle rend la gare inexploitable.
 */
function nombreDepuisCoordonneeNavitia(valeur: number | string): number | null {
  if (typeof valeur === 'number') {
    return Number.isFinite(valeur) ? valeur : null;
  }
  const texte = valeur.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(texte)) return null;
  const nombre = Number(texte);
  return Number.isFinite(nombre) ? nombre : null;
}

/**
 * Codes UIC déclarés par Navitia que le domaine sait représenter. Le type est
 * une étiquette fournisseur, pas du texte utilisateur : sa comparaison reste
 * insensible à la locale du serveur.
 *
 * Une valeur UIC illisible est écartée ici, jamais renumérotée ni reformatée —
 * et elle ne masque donc pas un UIC valide déclaré à côté d'elle.
 */
function codesUicExploitables(
  codes: readonly CodeNavitia[]
): CodeLieuTransport[] {
  return codes
    .filter((code) => code.type.toLowerCase() === TYPE_CODE_UIC_NAVITIA)
    .flatMap((code) => {
      const validation = CodeLieuTransportSchema.safeParse({
        systeme: 'UIC',
        valeur: code.value,
      });
      return validation.success ? [validation.data] : [];
    });
}

/**
 * Un code métier est préféré dans cet ordre : le code UIC exploitable déclaré
 * par Navitia, puis l'identifiant Navitia réel — toujours disponible, donc
 * l'absence d'UIC n'empêche jamais d'identifier la gare.
 *
 * Deux codes UIC exploitables et contradictoires restent en revanche une
 * ambiguïté d'identité : aucun des deux n'est choisi arbitrairement.
 */
function codeMetierDepuisStopArea(
  stopArea: StopAreaNavitia
): CodeLieuTransport | null {
  const codesUic = codesUicExploitables(stopArea.codes ?? []);
  if (new Set(codesUic.map((code) => code.valeur)).size > 1) return null;
  if (codesUic.length > 0) return codesUic[0];

  const repli = CodeLieuTransportSchema.safeParse({
    systeme: 'NAVITIA',
    valeur: stopArea.id,
  });
  return repli.success ? repli.data : null;
}

/**
 * Normalise un seul objet d'autocomplétion Navitia en candidat de gare.
 *
 * Cette fonction ne choisit jamais entre plusieurs gares et ne consulte ni le
 * réseau, ni l'environnement, ni l'heure courante : la provenance entière
 * (source exacte et date de récupération) est fournie par l'appelant, sans
 * valeur par défaut. Elle rend `null` dès qu'un fait consommé manque ou ne peut
 * pas être représenté prudemment.
 */
export function candidatDepuisStopArea(
  placeBrute: unknown,
  provenance: ProvenanceGareNavitia
): CandidatGareNavitia | null {
  // La provenance est validée en frontière : une source non HTTPS, une date
  // sans décalage ou un champ inconnu écarte la gare avant toute lecture.
  const provenanceValidee = ProvenanceGareNavitiaSchema.safeParse(provenance);
  if (!provenanceValidee.success) return null;

  const place = PlaceNavitiaSchema.safeParse(placeBrute);
  if (!place.success) return null;
  if (place.data.embedded_type !== TYPE_LIEU_STOP_AREA_NAVITIA) return null;

  const stopArea = place.data.stop_area;
  if (!stopArea) return null;

  const latitude = nombreDepuisCoordonneeNavitia(stopArea.coord.lat);
  const longitude = nombreDepuisCoordonneeNavitia(stopArea.coord.lon);
  if (latitude === null || longitude === null) return null;

  const code = codeMetierDepuisStopArea(stopArea);
  if (!code) return null;

  const validation = CandidatGareNavitiaSchema.safeParse({
    fournisseur: FOURNISSEUR_NAVITIA,
    identifiantExterne: stopArea.id,
    nom: stopArea.name,
    coordonnees: { latitude, longitude },
    fuseauIana: stopArea.timezone,
    code,
    source: provenanceValidee.data.source,
    recupereLe: provenanceValidee.data.recupereLe,
  });
  return validation.success ? validation.data : null;
}
