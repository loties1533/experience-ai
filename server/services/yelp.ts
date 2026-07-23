import 'dotenv/config';
import type { Activite, TravelMode } from '../lib/types.js';
import { lienGoogleMaps } from '../lib/url.js';

const CLE_YELP = process.env.YELP_API_KEY;
const URL_BASE_YELP = 'https://api.yelp.com/v3';

// Catégories Yelp selon le mode
const CATEGORIES_YELP_PAR_MODE: Record<TravelMode, string> = {
  party:    'bars,nightlife,cocktailbars',
  student:  'restaurants,streetfood,cafes',
  group:    'restaurants,brasseries,buffets',
  relax:    'restaurants,cafes,tea',
  surprise: 'restaurants,newamerican,fusion',
};

// Niveau de prix premium (indépendant du mode) → catégories haut de gamme,
// quelle que soit la vibe. (Ancienne catégorie du mode « luxury ».)
const CATEGORIES_YELP_PREMIUM = 'restaurants,frenchrestaurants,wine_bars';

interface EtablissementYelp {
  id: string;
  name: string;
  rating: number;
  price?: string;         // "$" | "$$" | "$$$" | "$$$$"
  categories: Array<{ alias: string; title: string }>;
  location: { city: string; address1?: string };
  url: string;
  image_url?: string;
}

interface ReponseYelp {
  businesses: EtablissementYelp[];
  total: number;
}


function prixDepuisSymbole(price?: string): number {
  const map: Record<string, number> = { '$': 15, '$$': 35, '$$$': 65, '$$$$': 120 };
  return price ? (map[price] ?? 30) : 30;
}


export async function yelpRestaurantSearch(
  city: string,
  mode: TravelMode,
  premium = false,
): Promise<Activite[]> {
  if (!CLE_YELP) {
    console.warn('Yelp ignoré (YELP_API_KEY manquante).');
    return [];
  }

  try {
    const categories = premium ? CATEGORIES_YELP_PREMIUM : (CATEGORIES_YELP_PAR_MODE[mode] ?? 'restaurants');

    const parametresRequete = new URLSearchParams({
      location:   city,
      categories,
      sort_by:    'rating',
      limit:      '3',
    });

    const res = await fetch(`${URL_BASE_YELP}/businesses/search?${parametresRequete}`, {
      headers: {
        Authorization: `Bearer ${CLE_YELP}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Yelp ${res.status}: ${await res.text()}`);

    const donneesYelp = await res.json() as ReponseYelp;

    if (!donneesYelp.businesses?.length) {
      console.warn(`Yelp: 0 restaurant trouvé pour ${city}`);
      return [];
    }

    console.log(`Yelp: ${donneesYelp.businesses.length} restaurants trouvés pour ${city}`);

    return donneesYelp.businesses.map(b => ({
      name:        b.name,
      category:    b.categories[0]?.title ?? 'Restaurant',
      description: `${b.categories[0]?.title ?? 'Restaurant'} · ${b.price ?? '$$'} · note ${b.rating}/5`,
      duration:    '1h30',
      price:       prixDepuisSymbole(b.price),
      price_range: b.price ?? '$$',
      booking_url: lienGoogleMaps(b.name, city),   // bouton « Carte » (Google Maps)
    }));

  } catch (err) {
    console.error('Erreur Yelp :', (err as Error).message);
    return [];
  }
}
