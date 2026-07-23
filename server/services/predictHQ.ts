import 'dotenv/config';
import type { TravelMode } from '../lib/types.js';
import type { EventSearchResult } from './smartSearch.js';
import { encoderURL } from '../lib/url.js';

const CLE_PREDICTHQ = process.env.PREDICTHQ_API_KEY;
const URL_BASE_PREDICTHQ = 'https://api.predicthq.com/v1';

// Catégories PredictHQ selon le mode de voyage
const CATEGORIES_PAR_MODE: Record<TravelMode, string> = {
  party:    'concerts,festivals',
  student:  'concerts,festivals,community,sports',
  group:    'concerts,festivals,sports,community',
  relax:    'performing-arts,community',
  surprise: 'concerts,festivals,performing-arts,community',
};

interface LieuPredictHQ {
  id: string;
  name: string;
  type: string;
}

interface EvenementPredictHQ {
  id: string;
  title: string;
  category: string;
  start: string;
  description?: string;
  entities?: Array<{ name: string; type: string }>;
  local_rank?: number;
  rank?: number;
}


/** Étape 1 : récupère l'identifiant de lieu PredictHQ pour une ville */
async function obtenirIdLieu(city: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${URL_BASE_PREDICTHQ}/places/?q=${encoderURL(city)}&limit=1`,
      {
        headers: { Authorization: `Bearer ${CLE_PREDICTHQ}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json() as { results?: LieuPredictHQ[] };
    return data.results?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

export async function predictHQEventsSearch(
  city: string,
  dateFrom: string,
  dateTo: string,
  mode: TravelMode
): Promise<EventSearchResult[]> {
  if (!CLE_PREDICTHQ) {
    console.warn('PredictHQ ignoré (PREDICTHQ_API_KEY manquante).');
    return [];
  }

  try {
    const idLieu = await obtenirIdLieu(city);
    const categories = CATEGORIES_PAR_MODE[mode] ?? 'concerts,festivals';

    const parametresRequete = new URLSearchParams({
      'active.gte':   dateFrom,
      'active.lte':   dateTo || dateFrom,
      category:       categories,
      sort:           'local_rank',
      limit:          '6',
    });

    // Filtre par lieu si trouvé, sinon recherche texte sur la ville
    if (idLieu) {
      parametresRequete.set('place.scope', idLieu);
    } else {
      parametresRequete.set('q', city);
    }

    const res = await fetch(`${URL_BASE_PREDICTHQ}/events/?${parametresRequete}`, {
      headers: { Authorization: `Bearer ${CLE_PREDICTHQ}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      // 401 = clé invalide/expirée (PredictHQ est payant, essai limité). Non bloquant :
      // on log proprement et smartEventsSearch bascule sur Tavily pour les événements.
      if (res.status === 401) {
        console.warn('PredictHQ ignoré (clé invalide ou expirée) — repli événements via Tavily.');
        return [];
      }
      throw new Error(`PredictHQ ${res.status}: ${await res.text()}`);
    }

    const donneesPredictHQ = await res.json() as { count: number; results: EvenementPredictHQ[] };

    if (!donneesPredictHQ.results?.length) {
      console.warn(`PredictHQ: 0 événement pour ${city} (${dateFrom} → ${dateTo})`);
      return [];
    }

    console.log(`PredictHQ: ${donneesPredictHQ.results.length} événements trouvés pour ${city}`);

    return donneesPredictHQ.results.slice(0, 6).map(e => ({
      title:       e.title,
      category:    e.category.replace(/-/g, ' '),
      start:       e.start.slice(0, 10),
      venue:       e.entities?.find(en => en.type === 'venue')?.name ?? city,
      description: e.description ?? `${e.category} à ${city}`,
    }));

  } catch (err) {
    console.warn('PredictHQ indisponible (repli Tavily) :', (err as Error).message);
    return [];
  }
}
