import { searchWeb } from './tools/webSearch.js';
import { callAI, parseJSON } from './claude/index.js';
import { predictHQEventsSearch } from './predictHQ.js';
import type { TravelMode, HotelLinks } from '../lib/types.js';
import { encoderURL } from '../lib/url.js';

// NB : les liens de VOL ne sont plus fabriqués ici — transformerVols (pack.ts)
// les reconstruit via construireLiensVol (IATA + dates + pax).

function liensHotel(hotelName: string, city: string): HotelLinks {
  // N'ajoute pas la ville si elle est déjà dans le nom (LLM inclut souvent "Mandarin Oriental, Miami")
  const termeRecherche = hotelName.toLowerCase().includes(city.toLowerCase())
    ? hotelName
    : `${hotelName} ${city}`;
  return {
    booking: `https://www.booking.com/searchresults.html?ss=${encoderURL(termeRecherche)}`,
    google:  `https://www.google.com/travel/hotels/${encoderURL(city)}?q=${encoderURL(hotelName)}`,
  };
}

// ---- Interfaces pour les résultats ----

export interface FlightSearchResult {
  price: number;
  airline: string;
  outbound_time: string;
  arrival_time: string;
  duration: string;
  stops: string;
  booking_url: string | null;
  // Pas de `links` ici : les liens de vol sont construits en aval par
  // transformerVols/construireLiensVol (IATA + dates + voyageurs).
}

export interface EventSearchResult {
  title: string;
  category: string;
  start: string;
  venue: string;
  description: string;
  // reservation_url renseigné en aval par le résolveur du pack (services/liens.ts).
}

export interface HotelSearchResult {
  name: string;
  quartier: string;
  point_fort: string;
  stars: number;
  price_per_night: number;
  booking_url: string | null;
  links: HotelLinks;
}

interface SmartFlightParams {
  origin: string;
  destination: string;
  departure: string;
  return_date?: string;
}

interface SmartEventsParams {
  location: string;
  dateFrom?: string;
  dateTo?: string;
  mode: TravelMode;
}

interface SmartHotelParams {
  location: string;
  mode: TravelMode;
}


export async function smartFlightSearch({
  origin, destination, departure,
}: SmartFlightParams): Promise<FlightSearchResult | null> {
  try {
    const query = `vols ${origin} ${destination} ${departure} prix compagnies aériennes`;
    const contexteWeb = await searchWeb(query);
    if (!contexteWeb) return null;

    const prompt = `
Voici des résultats web pour des vols de ${origin} à ${destination} :
${contexteWeb}

Extrais le meilleur vol trouvé. RÈGLES STRICTES :
- "price" = prix EN EUROS par personne pour UN billet aller simple. Minimum 50€.
- Si tu vois un prix < 50€, IGNORE-LE. Si aucun prix fiable, estime un prix réaliste.

Retourne UNIQUEMENT ce JSON :
{
  "price": 150,
  "airline": "Compagnie",
  "outbound_time": "10:30",
  "arrival_time": "14:00",
  "duration": "2h30",
  "stops": "Direct",
  "booking_url": null
}`;

    const reponseIABrute = await callAI(prompt, undefined, 'pack');
    // Pas de liens ici : ils sont posés par transformerVols (construireLiensVol).
    const donneesVol = parseJSON(reponseIABrute) as FlightSearchResult;
    return donneesVol;
  } catch (err) {
    console.error('Erreur recherche vol :', (err as Error).message);
    return null;
  }
}

export async function smartEventsSearch({
  location, dateFrom, dateTo, mode,
}: SmartEventsParams): Promise<EventSearchResult[]> {

  // ── 1. PredictHQ en priorité : données structurées réelles, pas de LLM parsing ──
  try {
    const phqEvents = await predictHQEventsSearch(
      location,
      dateFrom ?? new Date().toISOString().slice(0, 10),
      dateTo  ?? dateFrom ?? new Date().toISOString().slice(0, 10),
      mode
    );
    if (phqEvents.length > 0) return phqEvents;
  } catch (err) {
    console.warn('Repli PredictHQ :', (err as Error).message);
  }

  // ── 2. Fallback Tavily + LLM si PredictHQ ne retourne rien ──
  // Recherche PURE : on extrait des événements, pas des liens (résolus en aval).
  try {
    const query = mode === 'party'
      ? `exclusive VIP parties private clubs best nightlife ${location} ${dateFrom ?? ''}`
      : `événements spectacles concerts incontournables ${location} ${dateFrom ?? ''}`;

    const contexteWeb = await searchWeb(query);
    if (!contexteWeb) return [];

    const prompt = `
Voici des résultats web pour des événements à ${location} :
${contexteWeb}

Extrais les 3 meilleurs événements. "category" et "description" rédigés EN FRANÇAIS. Retourne UNIQUEMENT un tableau JSON :
[
  {
    "title": "Nom",
    "category": "Nightlife",
    "start": "${dateFrom ?? 'Pendant le séjour'}",
    "venue": "Lieu",
    "description": "Description courte."
  }
]`;

    const reponseIABrute = await callAI(prompt, undefined, 'destinations');
    const donneesParsees = parseJSON(reponseIABrute);
    return Array.isArray(donneesParsees) ? (donneesParsees as EventSearchResult[]) : [];
  } catch (err) {
    console.error('Erreur recherche événements :', (err as Error).message);
    return [];
  }
}

export async function smartHotelSearch({ location, mode }: SmartHotelParams): Promise<HotelSearchResult[]> {
  try {
    const query = mode === 'student'
      ? `best hostels affordable hotels ${location} booking price`
      : `best luxury 5 star hotels ${location} booking price`;

    const contexteWeb = await searchWeb(query);
    if (!contexteWeb) return [];

    const prompt = `
Voici des résultats web pour des hôtels à ${location} :
${contexteWeb}

Extrais les 2 meilleurs hôtels avec leur VRAI nom (ex: "Nobu Hotel Ibiza Bay", "Hard Rock Hotel Ibiza").
Le point fort "point_fort" rédigé EN FRANÇAIS.
Si tu ne trouves aucun vrai nom d'hôtel dans ce texte, retourne exactement [].
Ne jamais inventer ou mettre un placeholder. Retourne UNIQUEMENT un tableau JSON :
[
  {
    "name": "Vrai nom de l'hôtel",
    "quartier": "Quartier",
    "point_fort": "Point fort en français",
    "stars": 4,
    "price_per_night": 150,
    "booking_url": null
  }
]`;

    const reponseIABrute = await callAI(prompt, undefined, 'destinations');
    const donneesParsees = parseJSON(reponseIABrute);
    const hotelsBruts: Omit<HotelSearchResult, 'links'>[] = Array.isArray(donneesParsees) ? donneesParsees : [];

    const PLACEHOLDER = /données|disponible|n\/a|pas de|aucun|inconnu|unknown|placeholder/i;
    const hotels = hotelsBruts.filter(h => h.name && h.name.length > 3 && !PLACEHOLDER.test(h.name));

    if (hotels.length) console.log(`Hôtels: ${hotels.length} trouvés pour ${location}`);
    else console.warn(`Hôtels: aucun résultat valide pour ${location} — repli LLM`);

    return hotels.map(h => ({ ...h, links: liensHotel(h.name, location) }));
  } catch (err) {
    console.error('Erreur recherche hôtels :', (err as Error).message);
    return [];
  }
}
