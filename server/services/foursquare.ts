import 'dotenv/config';
import { z } from 'zod';
import type { Activite, TravelMode } from '../lib/types.js';
import { lienGoogleMaps } from '../lib/url.js';
import {
  causeErreurHttp,
  estTimeout,
  rechercheIndisponible,
  resultatVide,
  type CandidatLieuExterne,
  type ResultatRecherche,
  type TypeLieuRecherche,
} from './rechercheExterne.js';

// Nouvelle API Places (FSQ OS Places) — l'ancienne (api.foursquare.com/v3) est
// décommissionnée depuis le 15 mai 2026. Auth = Service Key en Bearer + header de version.
const URL_BASE_FOURSQUARE = 'https://places-api.foursquare.com';
const VERSION_API_PLACES = '2025-06-17';
const SOURCE_FOURSQUARE = `${URL_BASE_FOURSQUARE}/places/search`;

const REQUETES_PAR_MODE: Record<TravelMode, string> = {
  party:    'bar,nightclub,lounge',
  student:  'restaurant,cafe,street food',
  group:    'restaurant,brasserie,buffet',
  relax:    'cafe,restaurant,tea room',
  surprise: 'restaurant,bistro,fusion',
};

// Niveau de prix premium (indépendant du mode) → catégories haut de gamme,
// quelle que soit la vibe. (Ancienne requête du mode « luxury ».)
const REQUETE_PREMIUM = 'fine dining,restaurant,wine bar';

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

const TERMES_CATEGORIES: Record<TypeLieuRecherche, string[]> = {
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

function categorieCorrespondante(
  lieu: LieuFoursquare,
  typeMetierRecherche: TypeLieuRecherche
): LieuFoursquare['categories'][number] | undefined {
  return lieu.categories.find((categorie) => {
    const categorieNormalisee = normaliserCategorie(categorie.name);
    return TERMES_CATEGORIES[typeMetierRecherche].some((terme) => {
      const termeNormalise = normaliserCategorie(terme);
      return (
        categorieNormalisee === termeNormalise ||
        categorieNormalisee.startsWith(`${termeNormalise} `) ||
        categorieNormalisee.endsWith(` ${termeNormalise}`) ||
        categorieNormalisee.includes(` ${termeNormalise} `)
      );
    });
  });
}

// Un lieu réel, dit dans le vocabulaire du domaine (nom, adresse, lien carte).
// C'est ce que l'orchestrateur reçoit quand il cherche où poser un moment.
export interface LieuReel {
  identifiantExterne: string;
  nom: string;
  categorie: string;
  adresse?: string;
  lienCarte: string;
}


function etiquettePrix(price?: number): string {
  return ['', '$', '$$', '$$$', '$$$$'][price ?? 2] ?? '$$';
}

function prixNumerique(price?: number): number {
  return [0, 15, 35, 65, 120][price ?? 2] ?? 35;
}


/**
 * L'appel brut à Places, partagé par les deux usages du connecteur.
 *
 * Il ne confond plus une vraie recherche vide avec une indisponibilité :
 * l'appelant peut ainsi dégrader honnêtement le parcours et appliquer une
 * politique de cache différente selon le statut.
 */
async function rechercherLieuxBruts(
  villeDemandee: string,
  requete: string,
  limite: number
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

export async function foursquareRestaurantSearch(
  city: string,
  mode: TravelMode,
  premium = false,
): Promise<Activite[]> {
  const recherche = await rechercherLieuxBruts(
    city,
    premium ? REQUETE_PREMIUM : (REQUETES_PAR_MODE[mode] ?? 'restaurant'),
    3,
  );
  const lieux = recherche.statut === 'ok' ? recherche.resultats : [];

  return lieux.map(p => ({
    name:        p.name,
    category:    p.categories[0]?.name ?? 'Restaurant',
    description: [
      p.categories[0]?.name ?? 'Restaurant',
      p.location?.locality,
      p.rating ? `note ${p.rating}/10` : null,   // affiché seulement si dispo (premium)
    ].filter(Boolean).join(' · '),
    duration:    '1h30',
    price:       prixNumerique(p.price),
    price_range: etiquettePrix(p.price),
    booking_url: lienGoogleMaps(p.name, city),   // bouton « Carte » (Google Maps)
  }));
}

/**
 * Recherche libre : c'est ce que l'orchestrateur appelle quand il cherche « un
 * bar à cocktails », « un escape game » ou « une brasserie ». Les catégories
 * figées par mode ne suffisaient pas — elles ne connaissent que le repas et la
 * fête, et le modèle a besoin de chercher ce que l'intention réclame.
 */
export async function rechercherLieuxFoursquare(
  villeDemandee: string,
  requete: string,
  typeMetierRecherche: TypeLieuRecherche,
  limite = 4,
): Promise<ResultatRecherche<CandidatLieuExterne>> {
  const recherche = await rechercherLieuxBruts(
    villeDemandee,
    requete,
    Math.min(Math.max(limite, 1), 8)
  );
  if (recherche.statut !== 'ok') return recherche;
  const lieuxCompatibles = recherche.resultats.flatMap((lieu) => {
    const categorie = categorieCorrespondante(lieu, typeMetierRecherche);
    return categorie ? [{ lieu, categorie }] : [];
  });
  if (lieuxCompatibles.length === 0) return resultatVide(recherche.recupereLe);

  return {
    statut: 'ok',
    recupereLe: recherche.recupereLe,
    resultats: lieuxCompatibles.map(({ lieu, categorie }) => ({
      identifiantExterne: lieu.fsq_place_id,
      nom: lieu.name,
      villeDemandee,
      categorieFournisseur: categorie.name,
      typeMetierRecherche,
      adresse:
        [lieu.location.address, lieu.location.locality].filter(Boolean).join(', ') || undefined,
      lienCarte: lienGoogleMaps(lieu.name, villeDemandee),
      fournisseur: 'Foursquare',
      source: SOURCE_FOURSQUARE,
      recupereLe: recherche.recupereLe,
    })),
  };
}

/**
 * Export public historique conservé pendant la migration F2. Le nouveau chemin
 * de génération utilise `rechercherLieuxFoursquare`, qui expose les statuts.
 */
export async function foursquareRechercheLieux(
  ville: string,
  requete: string,
  limite = 4,
): Promise<LieuReel[]> {
  // Compatibilité de l'export historique : cette recherche est volontairement
  // générique et ne connaît pas le type métier F2-A. Le filtre conservateur
  // reste réservé à `rechercherLieuxFoursquare`.
  const recherche = await rechercherLieuxBruts(
    ville,
    requete,
    Math.min(Math.max(limite, 1), 8)
  );
  if (recherche.statut !== 'ok') return [];
  return recherche.resultats.map((lieu) => ({
    identifiantExterne: lieu.fsq_place_id,
    nom: lieu.name,
    categorie: lieu.categories[0]?.name ?? 'Lieu',
    adresse:
      [lieu.location.address, lieu.location.locality].filter(Boolean).join(', ') || undefined,
    lienCarte: lienGoogleMaps(lieu.name, ville),
  }));
}
