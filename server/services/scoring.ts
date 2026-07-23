import type { TravelMode, ResultatScore, Activite, Evenement } from '../lib/types.js';

interface DonneesVol {
  price?: number;
  duration_min?: number;
  stops?: number;
}

interface DonneesHotel {
  stars?: number;
  price_per_night?: number | string;
  max_guests?: number;
  rating?: number;
  price?: number;
}

export interface PackPourScore {
  vol?: DonneesVol | null;
  hotel?: DonneesHotel | null;
  events?: Evenement[];
  activities?: Activite[];
  totalPrice?: number;
}

interface PoidsMode {
  [key: string]: number;
}

type ScoreKey =
  | 'events' | 'prix' | 'hotel' | 'vol'
  | 'activities_free' | 'activities' | 'calme'
  | 'global' | 'originalite';

type ScoreValues = Record<ScoreKey, number>;

const POIDS_PAR_MODE: Record<TravelMode, PoidsMode> = {
  party:    { activities: 0.35, hotel: 0.25, prix: 0.20, vol: 0.10, events: 0.10 },
  student:  { prix: 0.45, activities_free: 0.25, hotel: 0.20, events: 0.10 },
  group:    { hotel: 0.35, activities: 0.30, prix: 0.20, vol: 0.15 },
  relax:    { calme: 0.35, hotel: 0.30, activities: 0.25, prix: 0.10 },
  surprise: { global: 0.60, originalite: 0.40 },
};

// Ramène n'importe quelle valeur dans [0,1] pour comparer prix/étoiles/durée sur la même échelle
function normaliser(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

// student ne regarde que le prix ; les autres pondèrent prix/direct/durée
function scoreVol(vol: DonneesVol | null | undefined, mode: TravelMode): number {
  if (!vol) return 0.5;
  const prixScore       = 1 - normaliser(vol.price ?? 0, 50, 2000);
  const dureeScore      = 1 - normaliser(vol.duration_min ?? 0, 60, 720);
  const scoreVolDirect  = vol.stops === 0 ? 1 : vol.stops === 1 ? 0.6 : 0.3;

  if (mode === 'student') return prixScore * 0.85 + scoreVolDirect * 0.15;
  return prixScore * 0.5 + scoreVolDirect * 0.3 + dureeScore * 0.2;
}

// group : la capacité pèse 50% ; student : le prix prime ; défaut : rating + étoiles
function scoreHotel(hotel: DonneesHotel | null | undefined, mode: TravelMode, travelers: number): number {
  if (!hotel) return 0.5;
  const scoreEtoiles   = normaliser(hotel.stars ?? 3, 1, 5);
  const prixNumerique  = typeof hotel.price_per_night === 'string'
    ? parseFloat(hotel.price_per_night)
    : (hotel.price_per_night ?? hotel.price ?? 150);
  const prixScore      = 1 - normaliser(prixNumerique, 20, 800);
  const capacityScore  = (hotel.max_guests ?? travelers) >= travelers ? 1 : 0.3;
  const ratingScore    = normaliser(hotel.rating ?? 7, 5, 10);

  if (mode === 'student') return prixScore * 0.6 + ratingScore * 0.3 + scoreEtoiles * 0.1;
  if (mode === 'group')   return capacityScore * 0.5 + prixScore * 0.3 + ratingScore * 0.2;
  return scoreEtoiles * 0.35 + ratingScore * 0.4 + prixScore * 0.25;
}

// relax : logique inversée — moins d'événements festifs = meilleur score
function scoreEvents(events: Evenement[] | undefined, mode: TravelMode, activities?: Activite[]): number {
  if (!events || events.length === 0) {
    if (mode === 'party' && activities?.length) {
      const nightlifeActs = activities.filter(a =>
        ['club', 'bar', 'nightlife', 'festival', 'soirée', 'party', 'concert', 'boite', 'beach club'].some(k =>
          (a.category ?? '').toLowerCase().includes(k) ||
          (a.name ?? '').toLowerCase().includes(k)
        )
      ).length;
      return Math.max(0.5, Math.min(1, nightlifeActs / 3) * 0.7 + Math.min(1, activities.length / 6) * 0.3);
    }
    return mode === 'relax' ? 0.7 : 0.4;
  }

  const countScore        = normaliser(events.length, 0, 20);
  const evenementsFestifs = events.filter(e =>
    ['concert', 'festival', 'nightlife', 'club', 'party'].some(k =>
      e.category?.toLowerCase().includes(k) ||
      e.title?.toLowerCase().includes(k)
    )
  ).length;

  const partyScore = normaliser(evenementsFestifs, 0, 10);

  if (mode === 'party')   return partyScore * 0.7 + countScore * 0.3;
  if (mode === 'student') return countScore * 0.6 + partyScore * 0.4;
  if (mode === 'relax')   return 1 - partyScore;
  return countScore;
}

// student : gratuites, relax : spa/nature/randonnée, défaut : quantité/variété
function scoreActivities(activities: Activite[] | undefined, mode: TravelMode): number {
  if (!activities || activities.length === 0) return 0;

  const total              = activities.length;
  const activitesGratuites = activities.filter(a => a.price === 0 || a.price_range === 'free').length;
  const activitesCalmes    = activities.filter(a =>
    ['spa', 'yoga', 'hiking', 'beach', 'nature'].some(k =>
      a.category?.toLowerCase().includes(k)
    )
  ).length;

  if (mode === 'student') return normaliser(activitesGratuites, 0, total);
  if (mode === 'relax')   return normaliser(activitesCalmes, 0, total) * 0.7 + normaliser(total, 0, 8) * 0.3;
  return Math.max(0.5, normaliser(total, 0, 8));
}

function scoreCalme(_destination: string, events: Evenement[] | undefined): number {
  const eventCount = events?.length ?? 0;
  return 1 - normaliser(eventCount, 0, 30);
}

const DESTINATIONS_COMMUNES = ['paris', 'london', 'rome', 'barcelona', 'amsterdam', 'new york', 'tokyo'];
function scoreOriginalite(destination: string): number {
  const dest = destination.toLowerCase();
  return DESTINATIONS_COMMUNES.some(d => dest.includes(d)) ? 0.3 : 0.9;
}

// Algo déterministe (zéro IA) : moyenne pondérée dont les poids varient selon le mode
// ex. relax → calme 35% + hotel 30% + activities 25% + prix 10%
export function scorerPack(
  pack: PackPourScore,
  mode: TravelMode,
  travelers = 2,
  destination = ''
): ResultatScore {
  const { vol, hotel, events, activities, totalPrice } = pack;
  const poidsMode = POIDS_PAR_MODE[mode] ?? POIDS_PAR_MODE.party;

  // Prix par personne : 30000€ pour 5 personnes = 6000€/pers (plus juste que le budget brut)
  const prixParPersonne = travelers > 1 ? (totalPrice ?? 0) / travelers : (totalPrice ?? 0);

  const scores: ScoreValues = {
    vol:             scoreVol(vol, mode),
    hotel:           scoreHotel(hotel, mode, travelers),
    events:          scoreEvents(events, mode, activities),
    activities:      scoreActivities(activities, mode),
    prix:            1 - normaliser(prixParPersonne, 100, 8000),
    activities_free: scoreActivities(activities, 'student'),
    calme:           scoreCalme(destination, events),
    global:          0,
    originalite:     scoreOriginalite(destination),
  };

  // Socle « qualité globale » = moyenne des sous-scores cœur. Le mode surprise
  // s'appuie dessus (poids { global: 0.60, originalite: 0.40 }) ; sans ce socle,
  // `global` vaudrait 0 et surprise plafonnerait à 40/100.
  scores.global = (scores.vol + scores.hotel + scores.events + scores.activities + scores.prix) / 5;

  // Score final = moyenne pondérée des sous-scores selon le mode.
  const total = Object.entries(poidsMode).reduce((somme, [cle, poids]) => {
    return somme + (scores[cle as ScoreKey] ?? 0) * poids;
  }, 0);

  return {
    total:   Math.round(total * 100) / 100,
    details: scores,
  };
}

export { POIDS_PAR_MODE };
