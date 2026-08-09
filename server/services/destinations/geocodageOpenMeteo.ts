import { z } from 'zod';
import {
  causeErreurHttp,
  estTimeout,
  type CauseIndisponibilite,
} from '../rechercheExterne.js';
import {
  DestinationGeographiqueSchema,
  DemandeGeocodageDestinationSchema,
  FOURNISSEUR_GEOCODAGE_DESTINATIONS,
  ResolutionDestinationSchema,
  type DestinationGeographique,
  type ResolutionDestination,
} from './contrat.js';

const SOURCE_GEOCODAGE_OPEN_METEO =
  'https://geocoding-api.open-meteo.com/v1/search';
const NOMBRE_RESULTATS_GEOCODAGE = 10;

const ResultatGeocodageOpenMeteoSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().trim().min(1),
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    feature_code: z.string().trim().min(1),
    country_code: z.string().regex(/^[A-Z]{2}$/),
  })
  .passthrough();

const ReponseGeocodageOpenMeteoSchema = z
  .object({
    results: z.array(z.unknown()).optional(),
  })
  .passthrough();

function normaliserNomGeographique(nom: string): string {
  return nom
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function resolutionIndisponible(
  raison: CauseIndisponibilite
): ResolutionDestination {
  return ResolutionDestinationSchema.parse({
    statut: 'indisponible',
    fournisseur: FOURNISSEUR_GEOCODAGE_DESTINATIONS,
    raison,
  });
}

function convertirDestination(
  resultat: z.infer<typeof ResultatGeocodageOpenMeteoSchema>,
  recupereLe: string
): DestinationGeographique | null {
  const validation = DestinationGeographiqueSchema.safeParse({
    identifiantGeoNames: resultat.id,
    nomCanonique: resultat.name,
    codePays: resultat.country_code,
    coordonnees: {
      latitude: resultat.latitude,
      longitude: resultat.longitude,
    },
    featureCode: resultat.feature_code,
    fournisseur: FOURNISSEUR_GEOCODAGE_DESTINATIONS,
    source: SOURCE_GEOCODAGE_OPEN_METEO,
    recupereLe,
  });
  return validation.success ? validation.data : null;
}

function destinationsDepuisResultats(
  resultats: unknown[],
  nomDemande: string,
  codePaysDemande: string | undefined,
  recupereLe: string
): {
  destinations: DestinationGeographique[];
  nombreResultatsValidesStructurellement: number;
} | null {
  const nomNormalise = normaliserNomGeographique(nomDemande);
  const parIdentifiant = new Map<number, DestinationGeographique>();
  let nombreResultatsValidesStructurellement = 0;

  for (const resultatBrut of resultats) {
    const resultat = ResultatGeocodageOpenMeteoSchema.safeParse(resultatBrut);
    if (!resultat.success) continue;
    nombreResultatsValidesStructurellement += 1;
    if (normaliserNomGeographique(resultat.data.name) !== nomNormalise) continue;
    if (
      codePaysDemande !== undefined &&
      resultat.data.country_code !== codePaysDemande
    ) {
      continue;
    }

    const destination = convertirDestination(resultat.data, recupereLe);
    if (!destination) continue;
    const connue = parIdentifiant.get(destination.identifiantGeoNames);
    if (connue && JSON.stringify(connue) !== JSON.stringify(destination)) {
      return null;
    }
    parIdentifiant.set(destination.identifiantGeoNames, destination);
  }

  return {
    destinations: [...parIdentifiant.values()].sort(
      (gauche, droite) =>
        gauche.codePays.localeCompare(droite.codePays) ||
        gauche.nomCanonique.localeCompare(droite.nomCanonique, 'fr') ||
        gauche.identifiantGeoNames - droite.identifiantGeoNames
    ),
    nombreResultatsValidesStructurellement,
  };
}

/**
 * Résout un nom sans jamais élire le premier résultat fuzzy du fournisseur.
 * Une destination n'est unique qu'après les filtres de nom exact, pays et
 * code GeoNames explicitement admissible ; sinon l'ambiguïté reste visible.
 */
export async function resoudreDestinationOpenMeteo(
  demandeRecue: unknown
): Promise<ResolutionDestination> {
  const demande = DemandeGeocodageDestinationSchema.parse(demandeRecue);
  const parametres = new URLSearchParams({
    name: demande.nom,
    count: String(NOMBRE_RESULTATS_GEOCODAGE),
    language: 'fr',
    format: 'json',
  });
  if (demande.codePays) {
    parametres.set('countryCode', demande.codePays);
  }

  let reponse: Response;
  try {
    reponse = await fetch(
      `${SOURCE_GEOCODAGE_OPEN_METEO}?${parametres.toString()}`,
      { signal: AbortSignal.timeout(5_000) }
    );
  } catch (erreur) {
    return resolutionIndisponible(estTimeout(erreur) ? 'timeout' : 'reseau');
  }

  if (!reponse.ok) {
    return resolutionIndisponible(causeErreurHttp(reponse.status));
  }

  let contenu: unknown;
  try {
    contenu = await reponse.json();
  } catch {
    return resolutionIndisponible('reponse_invalide');
  }

  const enveloppe = ReponseGeocodageOpenMeteoSchema.safeParse(contenu);
  if (!enveloppe.success) return resolutionIndisponible('reponse_invalide');

  const recupereLe = new Date().toISOString();
  const conversion = destinationsDepuisResultats(
    enveloppe.data.results ?? [],
    demande.nom,
    demande.codePays,
    recupereLe
  );
  if (!conversion) return resolutionIndisponible('reponse_invalide');
  if (
    (enveloppe.data.results?.length ?? 0) > 0 &&
    conversion.nombreResultatsValidesStructurellement === 0
  ) {
    return resolutionIndisponible('reponse_invalide');
  }
  const destinations = conversion.destinations;
  if (destinations.length === 0) {
    return ResolutionDestinationSchema.parse({
      statut: 'vide',
      destinations: [],
      recupereLe,
    });
  }
  if (destinations.length === 1) {
    return ResolutionDestinationSchema.parse({
      statut: 'unique',
      destination: destinations[0],
      recupereLe,
    });
  }
  return ResolutionDestinationSchema.parse({
    statut: 'ambigue',
    destinations,
    recupereLe,
  });
}
