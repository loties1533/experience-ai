import { z } from 'zod';
import { CodeLieuTransportSchema } from '../../domaine/transport/index.js';

export const FOURNISSEUR_NAVITIA = 'Navitia' as const;

/** Seul ce type d'objet Navitia peut décrire une gare. */
export const TYPE_LIEU_STOP_AREA_NAVITIA = 'stop_area' as const;

const LONGUEUR_MAX_IDENTIFIANT = 200;
const LONGUEUR_MAX_LIBELLE = 200;
const LONGUEUR_MAX_SOURCE = 2_048;
const LONGUEUR_MAX_FUSEAU = 100;
const LONGUEUR_MAX_TYPE_CODE = 100;
const NOMBRE_MAX_CODES_NAVITIA = 50;

const TexteCourtSchema = z.string().trim().min(1).max(LONGUEUR_MAX_LIBELLE);
const IdentifiantExterneSchema = z
  .string()
  .trim()
  .min(1)
  .max(LONGUEUR_MAX_IDENTIFIANT);

const SourceHttpsSchema = z
  .string()
  .trim()
  .max(LONGUEUR_MAX_SOURCE)
  .refine((source) => {
    try {
      return new URL(source).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'la source doit être une URL HTTPS valide');

/**
 * Navitia rend un vrai fuseau IANA (par exemple `Europe/Paris`). Le runtime
 * tranche seul ce qui existe, et rend au passage la forme canonique de la zone
 * (`europe/paris` devient `Europe/Paris`, `Etc/UTC` devient `UTC`).
 *
 * Un décalage seul est écarté avant cette lecture : `Intl` accepte pourtant
 * `+02:00` comme zone sur les runtimes récents, et un offset ne doit jamais
 * devenir un fuseau (F4-C1). Une zone doit donc commencer par une lettre.
 */
function fuseauIanaCanonique(valeur: string): string | null {
  if (!/^[A-Za-z]/u.test(valeur)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: valeur })
      .resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

const FuseauIanaNavitiaSchema = z
  .string()
  .trim()
  .min(1)
  .max(LONGUEUR_MAX_FUSEAU)
  .transform((valeur, contexte) => {
    const zone = fuseauIanaCanonique(valeur);
    if (zone === null) {
      contexte.addIssue({
        code: 'custom',
        message: 'le fuseau doit désigner une zone IANA connue',
      });
      return z.NEVER;
    }
    return zone;
  });

/**
 * Navitia exprime ses coordonnées en texte dans ses réponses JSON. Les deux
 * formes sont acceptées à la lecture ; leurs bornes sont contrôlées par le
 * contrat du candidat, jamais deux fois.
 */
const CoordonneeNavitiaSchema = z.union([z.number(), z.string()]);

const CoordNavitiaSchema = z.object({
  lat: CoordonneeNavitiaSchema,
  lon: CoordonneeNavitiaSchema,
});

export const CodeNavitiaSchema = z.object({
  type: z.string().trim().min(1).max(LONGUEUR_MAX_TYPE_CODE),
  value: z.string().trim().min(1).max(LONGUEUR_MAX_IDENTIFIANT),
});

/**
 * Sous-ensemble strictement consommé d'un `stop_area` Navitia.
 *
 * Les champs Navitia supplémentaires sont ignorés par Zod. En revanche, une
 * gare dont un champ consommé est invalide rend l'objet entier invalide : elle
 * ne peut pas être transformée silencieusement en candidat partiel.
 */
export const StopAreaNavitiaSchema = z.object({
  id: IdentifiantExterneSchema,
  name: TexteCourtSchema,
  coord: CoordNavitiaSchema,
  codes: z.array(CodeNavitiaSchema).max(NOMBRE_MAX_CODES_NAVITIA).optional(),
  timezone: FuseauIanaNavitiaSchema,
});

/**
 * Élément de liste rendu par l'autocomplétion Navitia. `embedded_type` désigne
 * la nature réelle de l'objet : une région administrative, un arrêt ou un point
 * d'intérêt ne devient jamais une gare.
 */
export const PlaceNavitiaSchema = z.object({
  embedded_type: z.string().trim().min(1),
  stop_area: StopAreaNavitiaSchema.optional(),
});

/**
 * Identité intermédiaire observée chez Navitia.
 *
 * Elle ne constitue pas un `LieuTransportConfirme` : ni ville, ni code pays, ni
 * niveau de confiance n'y figurent, car Navitia ne les garantit pas depuis ses
 * régions administratives. Elle ne prouve non plus aucune desserte
 * commerciale, disponibilité ni réservation.
 *
 * `code` est obligatoire : une gare sans code UIC exploitable garde toujours
 * son identifiant Navitia réel, sinon elle n'est pas normalisée du tout.
 */
export const CandidatGareNavitiaSchema = z
  .object({
    fournisseur: z.literal(FOURNISSEUR_NAVITIA),
    identifiantExterne: IdentifiantExterneSchema,
    nom: TexteCourtSchema,
    coordonnees: z
      .object({
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180),
      })
      .strict(),
    fuseauIana: FuseauIanaNavitiaSchema,
    code: CodeLieuTransportSchema,
    source: SourceHttpsSchema,
    recupereLe: z.iso.datetime({ offset: true }),
  })
  .strict();

/**
 * Provenance observée d'une gare, fournie par l'appelant. Aucune valeur par
 * défaut : ni configuration, ni environnement, ni horloge implicite.
 */
export const ProvenanceGareNavitiaSchema = z
  .object({
    source: SourceHttpsSchema,
    recupereLe: z.iso.datetime({ offset: true }),
  })
  .strict();

export type CodeNavitia = z.infer<typeof CodeNavitiaSchema>;
export type StopAreaNavitia = z.infer<typeof StopAreaNavitiaSchema>;
export type PlaceNavitia = z.infer<typeof PlaceNavitiaSchema>;
export type CandidatGareNavitia = z.infer<typeof CandidatGareNavitiaSchema>;
export type ProvenanceGareNavitia = z.infer<
  typeof ProvenanceGareNavitiaSchema
>;
