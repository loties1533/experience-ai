import 'dotenv/config';
import { z } from 'zod';
import { estCategorieFoursquareHebergementCompatible } from '../domaine/parcours/index.js';
import { lienGoogleMaps } from '../lib/url.js';
import {
  causeErreurHttp,
  estTimeout,
  rechercheIndisponible,
  resultatVide,
  type CandidatFoursquareExterne,
  type ResultatRecherche,
  type TypeLieuRecherche,
} from './rechercheExterne.js';

// Nouvelle API Places (FSQ OS Places) — l'ancienne (api.foursquare.com/v3) est
// décommissionnée depuis le 15 mai 2026. Auth = Service Key en Bearer + header de version.
const URL_BASE_FOURSQUARE = 'https://places-api.foursquare.com';
const VERSION_API_PLACES = '2025-06-17';
const SOURCE_FOURSQUARE = `${URL_BASE_FOURSQUARE}/places/search`;
// Catégorie parente officielle « Travel and Transportation > Lodging ».
// La recherche distante est filtrée, puis chaque résultat est encore contrôlé
// localement : le filtre fournisseur ne remplace jamais notre frontière de
// confiance.
const CATEGORIE_FOURSQUARE_HEBERGEMENT = '19009';

const LieuFoursquareSchema = z.object({
  fsq_place_id: z.string().min(1),
  name: z.string().min(1),
  rating: z.number().optional(),
  price: z.number().optional(),
  categories: z
    .array(z.object({ fsq_category_id: z.string().optional(), name: z.string().min(1) }))
    .default([]),
  location: z
    .object({
      locality: z.string().optional(),
      address: z.string().optional(),
    })
    .default({}),
});

const ReponseFoursquareSchema = z.object({
  results: z.array(LieuFoursquareSchema),
});

type LieuFoursquare = z.infer<typeof LieuFoursquareSchema>;

const TERMES_CATEGORIES: Record<
  Exclude<TypeLieuRecherche, 'hebergement'>,
  string[]
> = {
  restaurant: [
    'restaurant',
    'bistro',
    'bistrot',
    'brasserie',
    'dining',
    'food',
    'cafe',
    'café',
    'pizzeria',
    'traiteur',
  ],
  activite: [
    'activity',
    'attraction',
    'bowling',
    'escape',
    'game',
    'gallery',
    'galerie',
    'museum',
    'musee',
    'musée',
    'park',
    'parc',
    'spa',
    'sport',
    'theater',
    'theatre',
    'théâtre',
  ],
  sortie: [
    'bar',
    'club',
    'cocktail',
    'karaoke',
    'lounge',
    'nightclub',
    'night club',
    'pub',
  ],
};

function normaliserCategorie(categorie: string): string {
  return categorie
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function estCategorieFoursquareCompatible(
  categorie: { fsq_category_id?: string; name: string },
  typeMetierRecherche: TypeLieuRecherche
): boolean {
  const categorieNormalisee = normaliserCategorie(categorie.name);
  if (typeMetierRecherche === 'hebergement') {
    return estCategorieFoursquareHebergementCompatible({
      nom: categorie.name,
      ...(categorie.fsq_category_id
        ? { identifiant: categorie.fsq_category_id }
        : {}),
    });
  }

  return TERMES_CATEGORIES[typeMetierRecherche].some((terme) => {
    const termeNormalise = normaliserCategorie(terme);
    return (
      categorieNormalisee === termeNormalise ||
      categorieNormalisee.startsWith(`${termeNormalise} `) ||
      categorieNormalisee.endsWith(` ${termeNormalise}`) ||
      categorieNormalisee.includes(` ${termeNormalise} `)
    );
  });
}

function categorieCorrespondante(
  lieu: LieuFoursquare,
  typeMetierRecherche: TypeLieuRecherche
): LieuFoursquare['categories'][number] | undefined {
  if (typeMetierRecherche === 'hebergement') {
    const categorieIdentifiee = lieu.categories.find(
      (categorie) =>
        categorie.fsq_category_id !== undefined &&
        estCategorieFoursquareCompatible(categorie, 'hebergement')
    );
    if (categorieIdentifiee) return categorieIdentifiee;

    return lieu.categories.find(
      (categorie) =>
        categorie.fsq_category_id === undefined &&
        estCategorieFoursquareCompatible(categorie, 'hebergement')
    );
  }

  return lieu.categories.find((categorie) =>
    estCategorieFoursquareCompatible(categorie, typeMetierRecherche)
  );
}

/**
 * L'appel brut à Places utilisé par la recherche typée du connecteur.
 *
 * Il ne confond plus une vraie recherche vide avec une indisponibilité :
 * l'appelant peut ainsi dégrader honnêtement le parcours et appliquer une
 * politique de cache différente selon le statut.
 */
async function rechercherLieuxBruts(
  villeDemandee: string,
  requete: string,
  limite: number,
  typeMetierRecherche?: TypeLieuRecherche
): Promise<ResultatRecherche<LieuFoursquare>> {
  const cleFoursquare = process.env.FOURSQUARE_API_KEY;
  if (!cleFoursquare) {
    console.warn('Foursquare ignoré (FOURSQUARE_API_KEY manquante).');
    return rechercheIndisponible('Foursquare', 'configuration_absente');
  }

  try {
    // Free tier : on NE demande PAS rating/price ni sort=RATING (champs/tri premium
    // → HTTP 429). On garde les champs gratuits (nom, catégories, localisation).
    const parametresRequete = new URLSearchParams({
      near:  villeDemandee,
      query: requete,
      limit: String(limite),
    });
    if (typeMetierRecherche === 'hebergement') {
      parametresRequete.set(
        'fsq_category_ids',
        CATEGORIE_FOURSQUARE_HEBERGEMENT
      );
    }

    const reponse = await fetch(`${SOURCE_FOURSQUARE}?${parametresRequete}`, {
      headers: {
        Authorization:          `Bearer ${cleFoursquare}`,
        'X-Places-Api-Version': VERSION_API_PLACES,
        Accept:                 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!reponse.ok) {
      console.error(`Erreur Foursquare : HTTP ${reponse.status}`);
      return rechercheIndisponible('Foursquare', causeErreurHttp(reponse.status));
    }

    const recupereLe = new Date().toISOString();
    let contenu: unknown;
    try {
      contenu = await reponse.json();
    } catch {
      return rechercheIndisponible('Foursquare', 'reponse_invalide');
    }
    const validation = ReponseFoursquareSchema.safeParse(contenu);
    if (!validation.success) {
      console.error('Erreur Foursquare : réponse API invalide.');
      return rechercheIndisponible('Foursquare', 'reponse_invalide');
    }
    if (validation.data.results.length === 0) return resultatVide(recupereLe);

    console.log(
      `Foursquare: ${validation.data.results.length} lieux trouvés pour ${villeDemandee}`
    );
    return { statut: 'ok', resultats: validation.data.results, recupereLe };

  } catch (erreur) {
    const raison = estTimeout(erreur) ? 'timeout' : 'reseau';
    console.error('Erreur Foursquare :', (erreur as Error).message);
    return rechercheIndisponible('Foursquare', raison);
  }
}

/**
 * Recherche libre : c'est ce que l'orchestrateur appelle quand il cherche « un
 * bar à cocktails », « un escape game » ou « une brasserie ».
 */
export async function rechercherLieuxFoursquare(
  villeDemandee: string,
  requete: string,
  typeMetierRecherche: TypeLieuRecherche,
  limite = 4,
): Promise<ResultatRecherche<CandidatFoursquareExterne>> {
  const recherche = await rechercherLieuxBruts(
    villeDemandee,
    requete,
    Math.min(Math.max(limite, 1), 8),
    typeMetierRecherche
  );
  if (recherche.statut !== 'ok') return recherche;
  const lieuxCompatibles = recherche.resultats.flatMap((lieu) => {
    const categorie = categorieCorrespondante(lieu, typeMetierRecherche);
    if (!categorie) return [];
    const villeConfirmee = lieu.location.locality?.trim() || undefined;
    if (
      typeMetierRecherche === 'hebergement' &&
      villeConfirmee &&
      normaliserCategorie(villeConfirmee) !==
        normaliserCategorie(villeDemandee)
    ) {
      return [];
    }
    return [{ lieu, categorie, villeConfirmee }];
  });
  if (lieuxCompatibles.length === 0) return resultatVide(recherche.recupereLe);

  return {
    statut: 'ok',
    recupereLe: recherche.recupereLe,
    resultats: lieuxCompatibles.map(
      ({ lieu, categorie, villeConfirmee }): CandidatFoursquareExterne => {
        const commun = {
          identifiantExterne: lieu.fsq_place_id,
          nom: lieu.name,
          villeDemandee,
          categorieFournisseur: categorie.name,
          adresse:
            [lieu.location.address, lieu.location.locality]
              .filter(Boolean)
              .join(', ') || undefined,
          fournisseur: 'Foursquare' as const,
          source: SOURCE_FOURSQUARE,
          recupereLe: recherche.recupereLe,
        };
        if (typeMetierRecherche === 'hebergement') {
          return {
            ...commun,
            typeMetierRecherche,
            ...(villeConfirmee ? { villeConfirmee } : {}),
            ...(categorie.fsq_category_id
              ? {
                  identifiantCategorieFournisseur:
                    categorie.fsq_category_id,
                }
              : {}),
          };
        }
        return {
          ...commun,
          typeMetierRecherche,
          lienCarte: lienGoogleMaps(lieu.name, villeDemandee),
        };
      }
    ),
  };
}
