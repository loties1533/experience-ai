import { callAI, parseJSON, sanitizeInput } from './core.js';
import { MODES, BUDGET_RATIOS, PLAFONDS, DEFAULT_VALUES } from '../../lib/constants.js';
import type { Pack, TravelMode, Profile } from '../../lib/types.js';
import type { FlightSearchResult, EventSearchResult, HotelSearchResult } from '../smartSearch.js';
import type { WeatherData } from '../weather.js';

// ---- Types internes ----

export interface ParamsAssemblagePack {
  destination: string;
  origin?: string;
  flights?: FlightSearchResult[];
  events?: EventSearchResult[];
  hotels?: HotelSearchResult[];
  mode: TravelMode;
  premium?: boolean;
  profile?: string;
  interests?: string[];
  travelers: number;
  budget: number;
  departure?: string;
  return_date?: string;
  duration?: number;
  realWeather?: WeatherData | null;
  realPhoto?: string | null;
}

export interface ResultatTexteIA {
  country?: string;
  airport_code?: string;
  origin_airport_code?: string;
  tagline?: string;
  overview?: string;
  weather?: { temp?: string; conditions?: string };
  hotels?: Array<{ name?: string; quartier?: string; point_fort?: string; stars?: number; price_per_night?: number }>;
  itinerary?: Array<{ day: number; title?: string; matin?: string; soir?: string }>;
  activities?: Array<{ name?: string; description?: string; type?: string }>;
  conseil1?: string;
  conseil2?: string;
}

// 1. calculerNuits — calcul du nombre de nuits du séjour

export function calculerNuits(
  departure: string | undefined,
  return_date: string | undefined,
  duration: number | undefined,
  budget: number,
): number {
  if (departure && return_date) {
    return Math.max(
      Math.round((new Date(return_date).getTime() - new Date(departure).getTime()) / 86_400_000),
      1,
    );
  }
  if (duration) return parseInt(String(duration));
  return Math.min(Math.max(Math.round(budget / 500), 2), 14);
}

// 2. construirePromptPack — construction du prompt LLM

export function construirePromptPack({
  dest, originCity, travelers, profile, interests, mode, premium, budgetPerPers, nights, events,
}: {
  dest: string;
  originCity: string;
  travelers: number;
  profile: string | undefined;
  interests?: string[];
  mode: TravelMode;
  premium?: boolean;
  budgetPerPers: number;
  nights: number;
  events?: EventSearchResult[];
}): string {
  const budgetTone = budgetPerPers >= 2000
    ? 'Budget élevé : hôtels haut de gamme, bonnes tables, prestations soignées.'
    : budgetPerPers >= 1000
    ? 'Budget confortable : hôtels 4 étoiles, restaurants de qualité.'
    : budgetPerPers >= 500
    ? 'Budget moyen : bon rapport qualité/prix.'
    : 'Petit budget : adresses locales abordables.';

  const modePersona = mode === MODES.PARTY
    ? 'Mode fête : concentre-toi sur la vie nocturne réelle (clubs, bars, soirées).'
    : mode === MODES.RELAX
    ? 'Mode détente : rythme calme, nature, expériences posées.'
    : mode === MODES.GROUP
    ? 'Mode groupe : activités qui conviennent à plusieurs personnes.'
    : mode === MODES.STUDENT
    ? 'Mode étudiant : adresses abordables et connues.'
    : 'Combine les centres d\'intérêt du voyageur avec les incontournables locaux.';

  // Niveau de prix (indépendant du mode) : monte en gamme sans changer le mode.
  const premiumModifier = premium
    ? 'Gamme premium : privilégie le haut de gamme (hôtels 5 étoiles ou boutique-hôtels, bonnes tables), tout en respectant le mode ci-dessus.'
    : '';

  // Profil = « avec qui » (critère distinct du mode et du prix) : oriente le TON et le
  // type d'expériences, sans imposer une ambiance (celle-ci vient du mode).
  const PROFIL_MODIFIERS: Record<Profile, string> = {
    couple:  'expériences intimes à deux — tables romantiques, moments en tête-à-tête, hébergement pour 2.',
    famille: 'activités adaptées aux enfants, hôtels familiaux, rythme accessible à tous les âges.',
    amis:    'expériences conviviales et partagées, propices à la bonne humeur du groupe.',
    solo:    'expériences favorisant les rencontres et la liberté de mouvement, en toute sécurité.',
  };
  const modifierProfil = profile ? PROFIL_MODIFIERS[profile as Profile] : undefined;
  const profilModifier = modifierProfil
    ? `PROFIL ${profile!.toUpperCase()} : privilégie des ${modifierProfil}`
    : '';

  const activityTypes = mode === MODES.PARTY
    ? 'club|bar|discothèque|beach-club|festival|restaurant-lounge'
    : mode === MODES.STUDENT
    ? 'bar-incontournable|street-food|marché-local|concert|activité-outdoor|visite-gratuite'
    : mode === MODES.RELAX
    ? 'spa|plage-privée|restaurant-vue|yoga|croisière|nature'
    : 'restaurant|activité-phare|visite-emblématique|bateau|spa|expérience-locale';

  const activityInstruction = mode === MODES.PARTY
    ? 'MODE PARTY — OBLIGATOIRE : 6 vrais lieux nightlife (boîtes, beach clubs, bars, festivals, restos lounge). AUCUN musée ni site culturel. Exemples réels : Pacha, Ushuaïa, Hi Ibiza, Amnesia, Destino.'
    : mode === MODES.STUDENT
    ? 'MODE STUDENT — OBLIGATOIRE : 6 adresses connues et accessibles (bars étudiants, marchés, street food, activités outdoor gratuites ou pas chères). Noms réels uniquement.'
    : mode === MODES.RELAX
    ? 'MODE RELAX — OBLIGATOIRE : 6 adresses zen et authentiques (spas, plages calmes, restos vue mer, activités nature). Noms réels uniquement.'
    : 'OBLIGATOIRE : 6 adresses incontournables, réelles et variées adaptées au groupe. Noms exacts uniquement, pas de descriptions génériques.';

  const realVenuesContext = events?.length
    ? `\nÉVÉNEMENTS RÉELS :\n${events.slice(0, 4).map(e => `- ${e.title} @ ${e.venue}`).join('\n')}`
    : '';

  // Centres d'intérêt du voyageur : orientent le choix des activités (en plus du mode).
  const interetsContext = interests?.length
    ? `\nCENTRES D'INTÉRÊT DU VOYAGEUR (à privilégier fortement dans le choix des activités, tout en respectant le mode) : ${interests.join(', ')}.`
    : '';

  return `Tu prépares un pack de voyage TripGenie. Destination : ${dest}. Ville de départ : ${originCity}.
    VOYAGEURS : ${travelers} personne(s). PROFIL : ${profile ?? mode}. VIBE : ${mode}. BUDGET : ${budgetPerPers}€/pers. DURÉE : ${nights} nuits.

    ${modePersona}
    ${premiumModifier}
    ${profilModifier}
    ${budgetTone}
    ${activityInstruction}${interetsContext}
    ${realVenuesContext}

    Génère ce JSON COMPACT (itinerary = 3 jours, activities = 6) :
    {"country":"Pays","airport_code":"IBZ","origin_airport_code":"BOD","tagline":"description factuelle courte (6-10 mots, sans superlatif ni langage publicitaire)","overview":"1 phrase","weather":{"temp":"22°C","conditions":"Soleil"},"hotels":[{"name":"Vrai hôtel","quartier":"Quartier","point_fort":"Point fort"},{"name":"Alternative","quartier":"Quartier","point_fort":"Point fort"}],"itinerary":[{"day":1,"title":"Titre","matin":"Activité réelle","soir":"Club/resto réel"},{"day":2,"title":"Titre","matin":"Activité réelle","soir":"Soirée réelle"},{"day":3,"title":"Titre","matin":"Activité réelle","soir":"Soirée réelle"}],"activities":[{"name":"LIEU RÉEL","description":"50 chars max","type":"${activityTypes}"},{"name":"LIEU RÉEL","description":"50 chars max","type":"${activityTypes}"},{"name":"LIEU RÉEL","description":"50 chars max","type":"${activityTypes}"},{"name":"LIEU RÉEL","description":"50 chars max","type":"${activityTypes}"},{"name":"LIEU RÉEL","description":"50 chars max","type":"${activityTypes}"},{"name":"LIEU RÉEL","description":"50 chars max","type":"${activityTypes}"}],"conseil1":"Conseil","conseil2":"Adresse food"}
    STYLE : tagline, overview et conseils factuels, sans superlatif ni langage publicitaire (évite « rêve », « légendaire », « VIP », « incontournable », « électrisant », « capitale mondiale »).
    LANGUE : rédige TOUS les textes EN FRANÇAIS (tagline, overview, conditions, point_fort, title, matin, soir, description, conseil1, conseil2). Seuls les noms propres de lieux/hôtels/clubs restent dans leur langue d'origine.
    VRAIS noms uniquement. Pas de "Gastronomie locale" ou "Découverte de ${dest}".
    airport_code = code IATA de l'aéroport de ${dest}. origin_airport_code = code IATA de l'aéroport de ${originCity} (ville de départ).`;
}

// 3. parserReponsePack — parsing JSON + fallback structuré

export function parserReponsePack(raw: string, dest: string, nights: number): ResultatTexteIA {
  try {
    return parseJSON(raw) as ResultatTexteIA;
  } catch (err) {
    console.error('Repli générique activé — JSON malformé reçu du LLM. Raison :', (err as Error).message);
    console.error('Réponse brute du LLM (200 premiers caractères) :', raw.slice(0, 200));
    return {
      country:  'Destination',
      tagline:  `Séjour à ${dest}`,
      overview: `Un voyage sur-mesure à ${dest}.`,
      weather:  { temp: '22°C', conditions: 'Ensoleillé' },
      hotels: [
        { name: `Grand Hôtel ${dest}`,    quartier: 'Centre-ville', point_fort: 'Vue panoramique' },
        { name: `Boutique Hôtel ${dest}`, quartier: 'Vieille ville', point_fort: 'Charme local' },
      ],
      itinerary: Array.from({ length: Math.min(nights, 3) }).map((_, i) => ({
        day:   i + 1,
        title: i === 0 ? 'Arrivée et découverte' : i === 1 ? 'Exploration locale' : 'Détente et gastronomie',
        matin: i === 0 ? 'Installation et première balade' : 'Visite des incontournables',
        soir:  i === 0 ? 'Dîner dans le quartier' : 'Soirée en ville',
      })),
      activities: [
        { name: `Découverte de ${dest}`, description: 'Exploration des quartiers emblématiques.' },
        { name: 'Gastronomie locale',    description: 'Les meilleures adresses culinaires.' },
        { name: 'Expérience culturelle', description: 'Musées, architecture et vie locale.' },
      ],
      conseil1:  "Réservez vos activités à l'avance.",
      conseil2:  'Goûtez aux spécialités locales.',
    };
  }
}

// ============================================================
// Helpers — liens de réservation PRÉ-REMPLIS avec les vraies données du voyage
// (villes, codes IATA, dates, voyageurs). Construits à partir de la DEMANDE, pas
// de la sortie du LLM : les liens restent corrects même si le LLM se trompe de ville.
// ============================================================

// "YYYY-MM-DD" depuis une date ISO, "" si absente
function versFormatISO(date?: string): string {
  return date ? date.slice(0, 10) : '';
}

// format Skyscanner : 2026-07-15 → 260715
function versFormatCourt(date?: string): string {
  return date ? date.slice(2, 10).replace(/-/g, '') : '';
}

// code IATA valide (3 lettres, rejette le placeholder XXX)
function estCodeIATAValide(code?: string): boolean {
  return !!code && /^[A-Za-z]{3}$/.test(code) && code.toUpperCase() !== 'XXX';
}

export function construireLiensVol(params: {
  originCity: string; destCity: string;
  originIATA?: string; destIATA?: string;
  departure?: string; return_date?: string; travelers: number;
}): { google: string; skyscanner: string; kayak: string } {
  const { originCity, destCity, originIATA, destIATA, departure, return_date } = params;
  const adults = Math.max(1, params.travelers || 1);
  const dateDepart = versFormatISO(departure);
  const dateRetour = versFormatISO(return_date);

  const iataOk = estCodeIATAValide(originIATA) && estCodeIATAValide(destIATA);

  // Google : l'ancien format google.com/flights#flt=... n'est plus honoré par
  // Google (ouvre une page vide, ni dates ni trajet) → recherche Google fiable
  // (villes + date + pax en clair). Sert aussi de repli à Skyscanner/Kayak.
  const google = `https://www.google.com/search?q=${encodeURIComponent(`vols ${originCity} ${destCity}${dateDepart ? ' ' + dateDepart : ''}${adults > 1 ? ' ' + adults + ' personnes' : ''}`)}`;

  const skyscanner = iataOk && dateDepart
    ? `https://www.skyscanner.fr/transport/flights/${originIATA!.toLowerCase()}/${destIATA!.toLowerCase()}/${versFormatCourt(departure)}/${dateRetour ? versFormatCourt(return_date) + '/' : ''}?adults=${adults}`
    : google;
  const kayak = iataOk && dateDepart
    ? `https://www.kayak.fr/flights/${originIATA!.toUpperCase()}-${destIATA!.toUpperCase()}/${dateDepart}${dateRetour ? '/' + dateRetour : ''}/${adults}adults`
    : google;

  return { google, skyscanner, kayak };
}

// lien Booking pré-rempli
export function construireUrlHotel(
  hotelName: string,
  city: string,
  opts?: { checkin?: string; checkout?: string; travelers?: number },
): string {
  const terme = hotelName.toLowerCase().includes(city.toLowerCase())
    ? hotelName
    : `${hotelName} ${city}`;
  const params = new URLSearchParams({ ss: terme });
  // Dates + voyageurs pré-remplis → Booking affiche le VRAI prix pour les vraies
  // chambres/suites (2 pers/chambre par défaut). C'est Booking, pas nous, qui
  // connaît les prix réels : on ne fait que l'ouvrir correctement configuré.
  const checkin  = opts?.checkin?.slice(0, 10);
  const checkout = opts?.checkout?.slice(0, 10);
  if (checkin)  params.set('checkin', checkin);
  if (checkout) params.set('checkout', checkout);
  if (opts?.travelers && opts.travelers > 0) {
    params.set('group_adults', String(opts.travelers));
    params.set('no_rooms', String(Math.max(1, Math.ceil(opts.travelers / 2))));
    params.set('group_children', '0');
  }
  return `https://www.booking.com/searchresults.html?${params.toString()}`;
}

// NB : plus de constructeur d'URL de réservation ici. Les vraies URLs sont
// posées par le résolveur unique (services/liens.ts) ; le repli Google est
// géré à UN seul endroit, côté front (lienReservation).

// 4. transformerVols — mapping vols réels → Pack['flights']

// Ajoute une durée "XhYY" / "Xh" à une heure "HH:MM" → "HH:MM" (même fuseau).
// Garantit la cohérence : heure d'arrivée = heure de départ + durée.
function ajouterDureeAHeure(time: string, duration: string): string {
  const [h, m] = time.split(':').map(Number);
  const match  = duration.toLowerCase().match(/(\d+)\s*h\s*(\d*)/);
  const dh     = match ? parseInt(match[1], 10) : 0;
  const dmin   = match && match[2] ? parseInt(match[2], 10) : 0;
  const total  = (((h || 0) * 60 + (m || 0) + dh * 60 + dmin) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export function resolveFlightPricePerPerson(
  flights: FlightSearchResult[] | undefined,
  budget: number,
  travelers: number,
): number {
  const volPriceEst = Math.round(budget * 0.15 / travelers);
  const rawPrice    = flights?.[0]?.price ?? 0;
  const priceCapped = rawPrice > 1800 ? volPriceEst : rawPrice;
  return priceCapped || volPriceEst;
}

export function transformerVols(
  flights: FlightSearchResult[] | undefined,
  airportCode: string,
  originCode: string,
  originCity: string,
  dest: string,
  budget: number,
  travelers: number,
  departure?: string,
  return_date?: string,
): Pack['flights'] {
  const volPriceEst    = Math.round(budget * 0.15 / travelers);
  // Liens pré-remplis avec la VRAIE demande (villes, IATA, dates, voyageurs) —
  // identiques sur l'aller et le retour : ils pointent vers la recherche A/R complète.
  const links = construireLiensVol({
    originCity, destCity: dest, originIATA: originCode, destIATA: airportCode,
    departure, return_date, travelers,
  });
  const finalPrice     = `${resolveFlightPricePerPerson(flights, budget, travelers)}€`;

  if (flights?.length) {
    const duree       = flights[0].duration   || null;
    const arrets      = flights[0].stops      || null;
    const heureDepart = flights[0].outbound_time || '10:30';
    return [
      {
        from:             originCode,
        from_city:        originCity,
        to:               airportCode,
        to_city:          dest,
        departure_time:   heureDepart,
        arrival_time:     duree ? ajouterDureeAHeure(heureDepart, duree) : '—',
        duration:         duree ?? '—',
        stops:            arrets ?? '—',
        airline:          flights[0].airline ?? 'À confirmer',
        price_per_person: finalPrice,
        type:             'outbound' as const,
        links,
      },
      {
        from:             airportCode,
        from_city:        dest,
        to:               originCode,
        to_city:          originCity,
        departure_time:   '—',
        arrival_time:     '—',
        duration:         duree ?? '—',
        stops:            arrets ?? '—',
        airline:          flights[0].airline ?? 'À confirmer',
        price_per_person: finalPrice,
        type:             'return' as const,
        links,
      },
    ];
  }

  // Fallback : aucune donnée Tavily — prix estimé, durée inconnue
  return [
    { from: originCode, from_city: originCity, to: airportCode, to_city: dest,
      departure_time: '—', arrival_time: '—', duration: '—',
      stops: '—', airline: 'À confirmer', price_per_person: `${volPriceEst}€`, type: 'outbound' as const, links },
    { from: airportCode, from_city: dest, to: originCode, to_city: originCity,
      departure_time: '—', arrival_time: '—', duration: '—',
      stops: '—', airline: 'À confirmer', price_per_person: `${volPriceEst}€`, type: 'return' as const, links },
  ];
}

// 5. transformerActivites — mapping activités LLM → Pack['activities']

// Classement d'une activité par mot-clé → catégorie affichée.
// L'ordre compte (premier mot-clé trouvé gagne) ; le défaut neutre « Expérience »
// évite d'étiqueter à tort « Culture » tout ce qui n'entre dans aucune case.
const CATEGORIES_ACTIVITE: { keys: string[]; category: string }[] = [
  { keys: ['club', 'bar', 'nightlife', 'soirée', 'discothèque'],       category: 'Nightlife' },
  { keys: ['restaurant', 'food', 'gastronomie', 'resto', 'table'],     category: 'Gastronomie' },
  { keys: ['bateau', 'yacht', 'boat', 'croisière', 'voile', 'nautique'], category: 'Nautique' },
  { keys: ['plage', 'beach', 'crique', 'baignade'],                    category: 'Plage' },
  { keys: ['spa', 'massage', 'yoga', 'bien-être', 'wellness', 'détente', 'thermes'], category: 'Bien-être' },
  { keys: ['rando', 'sentier', 'nature', 'trek', 'hike', 'parc', 'montagne'],        category: 'Nature' },
  { keys: ['culture', 'musée', 'monument', 'histoire', 'art', 'patrimoine', 'église'], category: 'Culture' },
];

export function transformerActivites(
  activities: ResultatTexteIA['activities'],
  dest: string,
): Pack['activities'] {
  return (activities ?? []).map(a => {
    const name = a.name ?? 'Activité';
    // On classe d'abord sur le `type` du LLM ; s'il est trop générique (aucun
    // mot-clé), on retombe sur le NOM de l'activité — c'est ce qui rattrape
    // « Yoga », « Sentier côtier », « Criques privées » que le LLM typait mal.
    const typeStr = (a.type ?? '').toLowerCase();
    const nameStr = name.toLowerCase();
    const match =
      CATEGORIES_ACTIVITE.find(c => c.keys.some(k => typeStr.includes(k))) ??
      CATEGORIES_ACTIVITE.find(c => c.keys.some(k => nameStr.includes(k)));
    const category = match?.category ?? 'Expérience';

    const requete = encodeURIComponent(`${name} ${dest}`);
    // Lien universel Google Maps : ouvre la fiche du lieu DANS LA BONNE VILLE,
    // partout dans le monde. TheFork (resto FR) renvoyait vers Paris pour une
    // ville hors France ; GetYourGuide/Viator ne couvrent pas tout non plus.
    const booking_url = `https://www.google.com/maps/search/?api=1&query=${requete}`;

    return {
      name,
      category,
      description: a.description ?? 'Incontournable',
      duration:    '2-3h',
      price:       'Variable',
      best_time:   category === 'Nightlife' ? 'Soir' : 'Journée',
      booking_url,   // bouton « Carte » (Google Maps) — « Réserver » posé plus tard par le résolveur
    };
  });
}

// 6. calculerRepartitionBudget — répartition budgétaire par mode

export function calculerRepartitionBudget(
  budget: number,
  mode: TravelMode,
  nights: number,
  travelers: number,
  realFlightTotal?: number,
  premium = false,
): Pack['budget_breakdown'] {
  const ratio  = BUDGET_RATIOS[mode] ?? BUDGET_RATIOS.party;
  const cap    = premium ? PLAFONDS.premium : PLAFONDS.classique;
  const maxPpn = cap.maxPpn;

  // ── Poste VOLS : vrai coût (plafonné à 60 % du budget) sinon estimation ratio.
  const vols = realFlightTotal && realFlightTotal > 0
    ? Math.min(Math.round(realFlightTotal), Math.round(budget * 0.60))
    : Math.round(budget * ratio.vols);

  // ── Budget restant réparti sur les postes hors-vols (ratios renormalisés).
  const remaining = Math.max(0, budget - vols);
  const otherSum  = ratio.hebergement + ratio.activites + ratio.restauration + ratio.transports;
  const part      = (r: number) => (otherSum > 0 ? remaining * (r / otherSum) : 0);

  // Hébergement plafonné à un prix/nuit/personne réaliste.
  const nominalHebergement = Math.round(part(ratio.hebergement));
  let   hebergement        = nominalHebergement;
  const prixParNuit        = hebergement / nights / travelers;
  if (prixParNuit > maxPpn) hebergement = maxPpn * nights * travelers;

  // Plafonds réalistes €/jour/personne sur les postes dépensables. Au-delà, il
  // est irréaliste de "dépenser" le budget sur un court séjour : le reliquat va
  // honnêtement dans « Divers » (Marge / imprévus) au lieu de gonfler resto ou
  // activités (ex. 1218€ de resto pour un week-end à 2). Le total reste = budget.
  // Valeurs ajustables ; on ne redistribue plus le surplus d'hébergement.
  const jours    = Math.max(1, nights);
  const capJour  = (parPersJour: number) => parPersJour * travelers * jours;
  const plafActivites = capJour(cap.activites);
  const plafResto     = capJour(cap.resto);
  const plafTransp    = capJour(cap.transp);

  const activites    = Math.min(Math.round(part(ratio.activites)),    plafActivites);
  const restauration = Math.min(Math.round(part(ratio.restauration)), plafResto);
  const transports   = Math.min(Math.round(part(ratio.transports)),   plafTransp);
  const divers       = Math.max(0, budget - vols - hebergement - activites - restauration - transports);

  return {
    vols:         `${vols}€`,
    hebergement:  `${hebergement}€`,
    activites:    `${activites}€`,
    restauration: `${restauration}€`,
    transports:   `${transports}€`,
    divers:       `${divers}€`,
    total:        `${budget}€`,
    // exposé pour le mapping hôtels (calcul prix/nuit)
    _hebergRaw:   hebergement,
  } as Pack['budget_breakdown'] & { _hebergRaw: number };
}

// 7. assemblerPack — orchestrateur principal

export async function assemblerPack({
  destination, origin, flights, events, hotels: realHotels, mode, premium = false, profile, interests, travelers, budget,
  departure, return_date, duration, realWeather, realPhoto,
}: ParamsAssemblagePack): Promise<Pack> {
  const dest       = sanitizeInput(destination);
  const originCity = sanitizeInput(origin ?? DEFAULT_VALUES.ORIGIN);
  const nights     = calculerNuits(departure, return_date, duration, budget);
  const budgetPerPers = Math.round(budget / travelers);

  // ── 1. Appel LLM ──────────────────────────────────────────────────────────
  const prompt = construirePromptPack({ dest, originCity, travelers, profile, interests, mode, premium, budgetPerPers, nights, events });
  const texteBrutIA = await callAI(prompt, undefined, 'pack');

  // ── 2. Parsing JSON (5 stratégies de récupération) ────────────────────────
  const texteIA = parserReponsePack(texteBrutIA, dest, nights);

  // ── 3. Codes IATA (fournis par le LLM) ────────────────────────────────────
  const airportCode = texteIA.airport_code?.toUpperCase() ?? 'XXX';
  const originCode  = texteIA.origin_airport_code?.toUpperCase() ?? 'XXX';

  // ── 4. Répartition budgétaire ─────────────────────────────────────────────
  // Vrai coût des vols = prix/pers résolu × 2 trajets (A/R) × voyageurs.
  const flightPricePerPerson = resolveFlightPricePerPerson(flights, budget, travelers);
  const realFlightTotal      = flightPricePerPerson * 2 * travelers;
  const budgetBreakdown = calculerRepartitionBudget(budget, mode, nights, travelers, realFlightTotal, premium);
  const hebergementBrut = (budgetBreakdown as Pack['budget_breakdown'] & { _hebergRaw: number })._hebergRaw;

  // ── 5. Mapping événements ─────────────────────────────────────────────────
  // Pas de lien ici : reservation_url est posé ensuite par le résolveur unique.
  const donneesEvenements = events?.length
    ? events.slice(0, 3).map(e => ({
        title:       e.title,
        category:    e.category,
        start:       e.start || 'Pendant votre séjour',
        venue:       e.venue || 'Centre ville',
        description: e.description || '',
      }))
    : [{ title: `Soirée à ${dest}`, category: 'Nightlife', start: 'Pendant votre séjour', venue: 'Centre ville', description: 'Animation locale' }];

  // ── 6. Assemblage du Pack final ───────────────────────────────────────────
  return {
    destination: dest,
    country:     texteIA.country  ?? 'Destination',
    tagline:     texteIA.tagline  ?? `Séjour à ${dest}`,
    overview:    texteIA.overview ?? `À la découverte de ${dest}.`,
    photo_url:   realPhoto ?? undefined,
    weather: realWeather
      ? { avg_temp: realWeather.temp, conditions: realWeather.conditions }
      : { avg_temp: texteIA.weather?.temp ?? '20°C', conditions: texteIA.weather?.conditions ?? 'Ensoleillé' },
    summary: { total_budget: `${budget}€`, nights, activities_count: (texteIA.activities ?? []).length },
    flights: transformerVols(flights, airportCode, originCode, originCity, dest, budget, travelers, departure, return_date),
    hotels: (realHotels?.length ? realHotels : texteIA.hotels ?? []).map((h, i) => ({
      name:            h.name ?? `Hôtel ${i + 1}`,
      location:        (h as { quartier?: string }).quartier ?? (h as { location?: string }).location ?? 'Centre',
      stars:           h.stars ?? (i === 0 && premium ? 5 : 4),
      // Prix par CHAMBRE/nuit (2 pers/chambre), pas le budget total du groupe :
      // sinon à 10 pers on affichait « 2500€/nuit » comme si c'était une chambre.
      // C'est une ESTIMATION indicative (on n'interroge aucun prix hôtel réel) —
      // le vrai prix vient du lien Booking pré-rempli ci-dessous.
      price_per_night: (h as { price_per_night?: number }).price_per_night
        ? `${(h as { price_per_night: number }).price_per_night}€`
        : `${Math.round(hebergementBrut / nights / Math.max(1, Math.ceil(travelers / 2)))}€`,
      highlights:      (h as { point_fort?: string; highlights?: string }).point_fort ?? (h as { highlights?: string }).highlights ?? 'Bon emplacement',
      // Lien Booking pré-rempli : ville + check-in/out + voyageurs + nb chambres.
      booking_url:     construireUrlHotel(h.name ?? `Hôtel ${i + 1}`, dest, { checkin: departure, checkout: return_date, travelers }),
    })),
    itinerary: (texteIA.itinerary ?? []).map(d => ({
      day:      d.day,
      title:    d.title ?? 'Journée découverte',
      subtitle: mode === MODES.PARTY ? 'Vie nocturne' : 'Découverte',
      items: [
        // Heures indicatives (matin/soir). On n'affiche PLUS de prix/durée inventés :
        // l'IA ne fournit que l'activité (matin/soir), donc tout chiffre serait du faux.
        { time: mode === MODES.PARTY ? '14:00' : '10:00', type: 'activity' as const, title: d.matin ?? 'Exploration', description: '' },
        { time: mode === MODES.PARTY ? '22:00' : '20:00', type: mode === MODES.PARTY ? 'event' as const : 'food' as const, title: d.soir ?? 'Soirée', description: '' },
      ],
    })),
    activities: transformerActivites(texteIA.activities, dest),
    events:     donneesEvenements,
    budget_breakdown: {
      vols:         budgetBreakdown.vols,
      hebergement:  budgetBreakdown.hebergement,
      activites:    budgetBreakdown.activites,
      restauration: budgetBreakdown.restauration,
      transports:   budgetBreakdown.transports,
      divers:       budgetBreakdown.divers,
      total:        budgetBreakdown.total,
    },
    tips: [
      { title: 'Conseil pratique', content: texteIA.conseil1 ?? "Réservez à l'avance" },
    ],
  };
}
