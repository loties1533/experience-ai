import 'dotenv/config';
import type { Activite, TravelMode } from '../lib/types.js';
import { lienGoogleMaps } from '../lib/url.js';

const CLE_FOURSQUARE = process.env.FOURSQUARE_API_KEY;
// Nouvelle API Places (FSQ OS Places) — l'ancienne (api.foursquare.com/v3) est
// décommissionnée depuis le 15 mai 2026. Auth = Service Key en Bearer + header de version.
const URL_BASE_FOURSQUARE = 'https://places-api.foursquare.com';
const VERSION_API_PLACES = '2025-06-17';

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

interface LieuFoursquare {
  fsq_place_id: string;     // renommé (était fsq_id en v3)
  name: string;
  rating?: number;          // champ PREMIUM — absent en free tier
  price?: number;           // champ PREMIUM — absent en free tier
  categories: Array<{ fsq_category_id?: string; name: string }>;
  location: { locality?: string; address?: string };
}

interface ReponseFoursquare {
  results: LieuFoursquare[];
}


function etiquettePrix(price?: number): string {
  return ['', '$', '$$', '$$$', '$$$$'][price ?? 2] ?? '$$';
}

function prixNumerique(price?: number): number {
  return [0, 15, 35, 65, 120][price ?? 2] ?? 35;
}


export async function foursquareRestaurantSearch(
  city: string,
  mode: TravelMode,
  premium = false,
): Promise<Activite[]> {
  if (!CLE_FOURSQUARE) {
    console.warn('Foursquare ignoré (FOURSQUARE_API_KEY manquante).');
    return [];
  }

  try {
    // Free tier : on NE demande PAS rating/price ni sort=RATING (champs/tri premium
    // → HTTP 429). On garde les champs gratuits (nom, catégories, localisation).
    const parametresRequete = new URLSearchParams({
      near:  city,
      query: premium ? REQUETE_PREMIUM : (REQUETES_PAR_MODE[mode] ?? 'restaurant'),
      limit: '3',
    });

    const res = await fetch(`${URL_BASE_FOURSQUARE}/places/search?${parametresRequete}`, {
      headers: {
        Authorization:          `Bearer ${CLE_FOURSQUARE}`,
        'X-Places-Api-Version': VERSION_API_PLACES,
        Accept:                 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Foursquare ${res.status}`);

    const donneesFoursquare = await res.json() as ReponseFoursquare;
    if (!donneesFoursquare.results?.length) return [];

    console.log(`Foursquare: ${donneesFoursquare.results.length} lieux trouvés pour ${city}`);

    return donneesFoursquare.results.map(p => ({
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

  } catch (err) {
    console.error('Erreur Foursquare :', (err as Error).message);
    return [];
  }
}
