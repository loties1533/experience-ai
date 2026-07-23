// =============================================
// TRIPGENIE — server/routes/ai.ts
// Routes du pipeline IA : génération de packs, chat de modification,
// onboarding conversationnel et suggestions de destinations.
// =============================================

import express from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { optionalAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validation.js';
import { aiGenerateLimiter, aiChatLimiter } from '../middleware/limiter.js';
import { analyzeRequest, suggestDestinations, assemblerPack, chatModify, chatIntake } from '../services/claude/index.js';
import { scorerPack } from '../services/scoring.js';
import { smartFlightSearch, smartEventsSearch, smartHotelSearch } from '../services/smartSearch.js';
import { appliquerLiensReservation } from '../services/liens.js';
import { yelpRestaurantSearch } from '../services/yelp.js';
import { foursquareRestaurantSearch } from '../services/foursquare.js';
import { getRealWeather } from '../services/weather.js';
import { getDestinationPhoto } from '../services/photo.js';
import prisma from '../db/prisma.js';
import type { Prisma } from '@prisma/client';
import { MODES, MODES_LIST, DEFAULT_VALUES } from '../lib/constants.js';
import type { TravelMode } from '../lib/types.js';
import { peutEditerVoyage } from '../lib/tripAccess.js';

const router = express.Router();

// Vol calculé pour le scoring et la réponse (données réelles ou estimées) —
// distinct de FlightSearchResult (brut de recherche) et de TronconVol (affichage).
interface TronconCalcule {
  from: string; to: string; airline: string;
  departure_time: string; arrival_time: string;
  duration_min: number; stops: number;
}
interface VolCalcule {
  id: string;
  price: number;
  price_per_person: number;
  outbound: TronconCalcule;
  return: TronconCalcule;
}

const schemaMode = z.enum(MODES_LIST as [TravelMode, ...TravelMode[]]);

// Normalisation du mode : on accepte les synonymes français d'une même orientation
// (fête→party, détente→relax…) et la casse, pour ne pas planter quand le LLM renvoie
// le mot saisi par l'utilisateur.
// On ne mappe QUE des synonymes de la même orientation. Un mot qui appartient à un
// autre critère n'a rien à faire ici : « couple », « amis », « famille » relèvent du
// profil (avec qui on part), « luxe » du niveau de prix (premium). Les rabattre sur un
// mode mélangeait deux critères ; on les laisse donc à leur critère respectif.
const MODE_ALIASES: Record<string, string> = {
  fete: 'party', 'fête': 'party', party: 'party', 'soirée': 'party', soiree: 'party',
  detente: 'relax', 'détente': 'relax', relax: 'relax', calme: 'relax', repos: 'relax',
  etudiant: 'student', 'étudiant': 'student', student: 'student',
  groupe: 'group', group: 'group',
  surprise: 'surprise',
};
function canonicalMode(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const k = v.trim().toLowerCase();
  return MODE_ALIASES[k] ?? ((MODES_LIST as string[]).includes(k) ? k : undefined);
}
// /destinations : garantit toujours un mode valide (défaut 'surprise' = l'app choisit) → jamais de 400 sur le mode.
const modeDestinations = z.preprocess((v) => canonicalMode(v) ?? 'surprise', schemaMode);
// /generate & /chat : tolérant mais optionnel (un mode inconnu est ignoré, pas rejeté).
const modeOptionnel = z.preprocess(
  (v) => (v === undefined || v === null ? undefined : canonicalMode(v)),
  schemaMode.optional(),
);
const chaineNonVide = z.string().trim().min(1);
const schemaPackActuel = z.any().optional().refine((value) => {
  return value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value));
}, { message: 'current_pack invalide' }).superRefine((value, ctx) => {
  if (value !== undefined) {
    const size = JSON.stringify(value).length;
    if (size > 50000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'current_pack trop volumineux (max 50ko)' });
    }
  }
});

const schemaAnalyse = z.object({
  input: chaineNonVide.max(1000, 'Message trop long (max 1000 caractères)'),
});

const schemaDestinations = z.object({
  mode: modeDestinations,
  premium: z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean()).optional(),
  profile: z.string().trim().max(40).optional(),
  interests: z.array(z.string()).max(20).optional(),
  budget: z.preprocess((v) => typeof v === 'string' ? Number(v) : v, z.number().int().min(0)).optional(),
  travelers: z.preprocess((v) => typeof v === 'string' ? Number(v) : v, z.number().int().min(1).max(20)).optional(),
  duration: z.preprocess((v) => typeof v === 'string' ? Number(v) : v, z.number().int().min(1)).optional(),
  origin: z.string().trim().min(1).optional(),
  departure: z.string().trim().optional(),
});

const schemaOnboarding = z.object({
  currentData: z.record(z.string(), z.unknown()).optional(),
  userMessage: chaineNonVide.max(1000, 'Message trop long'),
});

const schemaGeneration = z.object({
  destination: chaineNonVide,
  origin: z.string().trim().optional(),
  departure: chaineNonVide,
  return_date: z.string().trim().optional().nullable(),
  travelers: z.preprocess((val) => typeof val === 'string' ? Number(val) : val, z.number().int().min(1).max(20)).optional(),
  budget: z.preprocess((val) => typeof val === 'string' ? Number(val) : val, z.number().int().min(1).max(50000)),
  mode: modeOptionnel,
  premium: z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean()).optional(),
  profile: z.string().trim().max(40).optional(),
  interests: z.array(z.string()).max(20).optional(),
});

const schemaChat = z.object({
  message: chaineNonVide.max(1000, 'Message trop long'),
  current_pack: schemaPackActuel.optional(),
  mode: modeOptionnel,
  trip_id: z.string().uuid('trip_id invalide').optional(),
});

// ---- POST /api/ai/analyze ----
router.post('/analyze', aiChatLimiter, optionalAuth, validateBody(schemaAnalyse), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { input } = req.body;
    if (!input?.trim()) {
      res.status(400).json({ error: 'input requis' });
      return;
    }
    if (input.length > 1000) {
      res.status(400).json({ error: 'Message trop long (max 1000 car.)' });
      return;
    }

    const analysis = await analyzeRequest(input);
    res.json({ analysis });

  } catch (err) {
    console.error('Erreur analyse IA :', (err as Error).message);
    next(err);
  }
});

// ---- POST /api/ai/destinations ----
router.post('/destinations', aiGenerateLimiter, optionalAuth, validateBody(schemaDestinations), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { mode, premium, profile, interests, budget, travelers, duration, origin, departure } = req.body;

    const resultat = await suggestDestinations({ mode, premium, profile, interests, budget, travelers, duration, origin, departure });
    res.json(resultat);

  } catch (err) {
    console.error('Erreur destinations IA :', (err as Error).message);
    next(err);
  }
});

// ---- POST /api/ai/onboarding ----
router.post('/onboarding', aiChatLimiter, optionalAuth, validateBody(schemaOnboarding), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { currentData, userMessage } = req.body;

    const resultat = await chatIntake({ currentData, userMessage });
    res.json(resultat);

  } catch (err) {
    console.error('Erreur onboarding IA :', (err as Error).message);
    next(err);
  }
});

/**
 * POST /api/ai/generate — Point d'entrée du pipeline de génération.
 *
 * Pipeline orchestré en 4 étapes séquentielles :
 *
 * 1. Validation des inputs (Zod-like, manuel)
 *
 * 2. Recherche web PARALLÈLE via Promise.allSettled :
 *    - smartFlightSearch  → Tavily : vols réels
 *    - smartEventsSearch  → Tavily : événements locaux
 *    - smartHotelSearch   → Tavily : hôtels
 *    - getRealWeather     → Open-Meteo
 *    - getDestinationPhoto → Unsplash (proxy)
 *
 *    Promise.allSettled est utilisé à la place de Promise.all pour que
 *    l'échec d'un service externe (ex: météo en panne) ne bloque pas
 *    toute la génération. Le pack est créé avec les données disponibles.
 *
 * 3. assemblerPack() → LLM (Gemini / OpenRouter / Claude en fallback)
 *    génère le pack JSON structuré avec les données réelles injectées.
 *
 * 4. scorerPack() → Algorithme déterministe (zéro IA) qui note le pack
 *    de 0 à 1 selon des poids définis par mode de voyage.
 *
 * @requires optionalAuth — le pack est sauvegardé si l'utilisateur est connecté
 * @requires aiGenerateLimiter — 10 générations/heure/IP (coût LLM)
 */
router.post('/generate', aiGenerateLimiter, optionalAuth, validateBody(schemaGeneration), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      destination,
      origin      = DEFAULT_VALUES.ORIGIN,
      departure,
      return_date,
      travelers   = DEFAULT_VALUES.TRAVELERS,
      budget,
      mode        = MODES.PARTY,
      premium     = false,
      profile,
      interests,
    } = req.body;

    // ---- RECHERCHE WEB (Tavily + IA) avec Timeout de sécurité ----
    const avecTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms))
    ]);

    // Photo et météo : rapides → séparées du batch Tavily pour ne pas être
    // tuées par le timeout de 25s si Tavily est lent
    const promessePhoto   = getDestinationPhoto(destination).catch(() => null);
    const promesseMeteo = getRealWeather(destination, departure).catch(() => null);
    // Foursquare en premier (1000/jour), Yelp en fallback (500/jour) — les deux gardés
    const promesseRestaurants = foursquareRestaurantSearch(destination, mode as TravelMode, premium)
      .then(r => {
        if (r.length > 0) {
          console.log(`Foursquare: ${r.length} restaurant(s) trouvé(s) pour ${destination}`);
          return r;
        }
        console.log(`Foursquare: 0 résultat → repli Yelp...`);
        return yelpRestaurantSearch(destination, mode as TravelMode, premium)
          .then(yelpResults => {
            if (yelpResults.length > 0) {
              console.log(`Yelp: ${yelpResults.length} restaurant(s) trouvé(s) pour ${destination}`);
            } else {
              console.log(`Yelp: 0 résultat aussi`);
            }
            return yelpResults;
          });
      })
      .catch((err) => {
        console.error(`Erreur Foursquare + Yelp :`, (err as Error).message);
        return [];
      });

    // Timeout individuel par service : si un service (ex. événements) timeout,
    // vols + hôtels sont préservés (avant : un timeout global jetait TOUT).
    const [resVols, resEvenements, resHotels] = await Promise.allSettled([
      avecTimeout(smartFlightSearch({ origin, destination, departure, return_date }), 30000),
      avecTimeout(smartEventsSearch({ location: destination, dateFrom: departure, dateTo: return_date || departure, mode }), 30000),
      avecTimeout(smartHotelSearch({ location: destination, mode }), 30000),
    ]);

    // On attend photo, météo et Yelp indépendamment du timeout Tavily
    const photoDestination = await promessePhoto;
    const meteoDestination = await promesseMeteo;
    const restaurants      = await promesseRestaurants;

    const volIA = resVols.status === 'fulfilled' ? resVols.value : null;
    let flights: VolCalcule[] = [];

    if (volIA) {
      flights = [{
        id: 'AI-SEARCH',
        price: volIA.price * travelers,
        price_per_person: volIA.price,
        outbound: {
          from: origin, to: destination, airline: volIA.airline,
          departure_time: volIA.outbound_time, arrival_time: volIA.arrival_time,
          duration_min: (() => { const m = volIA.duration?.match(/(\d+)h(\d+)?/); return m ? (parseInt(m[1]||'0')*60 + parseInt(m[2]||'0')) : 180; })(),
          stops: volIA.stops === 'Direct' ? 0 : 1
        },
        return: {
          from: destination, to: origin, airline: volIA.airline,
          departure_time: '18:00', arrival_time: '20:00',
          duration_min: 120, stops: 0
        }
      }];
    }

    const events     = resEvenements.status === 'fulfilled' ? resEvenements.value : [];
    const realHotels = resHotels.status === 'fulfilled' ? resHotels.value : [];
    if (resEvenements.status === 'rejected') console.warn('Repli API événements :', resEvenements.reason);

    const pack = await assemblerPack({
      destination,
      origin,
      flights: volIA ? [volIA] : [],
      events,
      hotels: realHotels,
      mode: mode as TravelMode,
      premium,
      profile,
      interests,
      travelers,
      budget,
      departure,
      return_date,
      realWeather: meteoDestination,
      realPhoto:   photoDestination,
    });

    // Résolveur de liens AVANT la fusion des restaurants : un resto Foursquare
    // local n'a quasi jamais de billetterie en ligne (« Carte » Google Maps suffit),
    // le chercher diluait la recherche et faisait chuter le taux de vraies URLs.
    await appliquerLiensReservation(pack, destination);

    // Merge restaurants Yelp dans les activités (si Yelp a retourné des résultats)
    if (restaurants.length > 0) {
      pack.activities = [...(pack.activities ?? []), ...restaurants];
      console.log(`Restaurants: ${restaurants.length} lieux ajoutés aux activités`);
    }

    // ---- Scoring déterministe (services/scoring.js) ----
    const meilleurVol = flights[0] ?? null;
    const donneesHotel = pack.hotels?.[0] || null;

    // Faute de vol/hôtel réel, on estime à partir du budget pour ne pas fausser le score.
    const resultatScore = scorerPack(
      {
        vol: meilleurVol
          ? { price: meilleurVol.price, duration_min: meilleurVol.outbound?.duration_min, stops: meilleurVol.outbound?.stops }
          : { price: budget * 0.25, duration_min: 180, stops: 0 },
        hotel: donneesHotel
          ? { stars: donneesHotel.stars || 4, price_per_night: parseInt(donneesHotel.price_per_night?.replace('€','') || '150'), rating: 8.5 }
          : { stars: 4, price_per_night: 150, rating: 8 },
        events,
        activities: pack.activities ?? [],
        totalPrice: budget
      },
      mode as TravelMode,
      travelers,
      destination
    );

    const packNote = {
      ...pack,
      flights_data: flights,
      events_data:  events,
      score: resultatScore
    };

    // Sauvegarde si user connecté — trip + pack dans UNE transaction.
    // Si l'insert du pack échoue, ROLLBACK : pas de trip orphelin sans pack.
    let tripId: string | null = null;
    let packId: string | null = null;
    if (req.user) {
      const tripCree = await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.create({
          data: {
            user_id:     req.user!.id,
            title:       `Voyage à ${destination}`,
            destination,
            origin,
            departure:   new Date(departure),
            return_date: return_date ? new Date(return_date) : null,
            travelers,
            budget:      String(budget),
            mode,
            premium,
            status:      'draft',
            // cast structurel : le pack est JSON-sérialisable (champs optionnels → InputJsonValue)
            pack_data:   packNote as unknown as Prisma.InputJsonValue,
            score:       resultatScore.total,
          },
          select: { id: true },
        });
        const pack = await tx.pack.create({
          data: { trip_id: trip.id, rank: 1, score: resultatScore.total, pack_data: packNote as unknown as Prisma.InputJsonValue, selected: true },
          select: { id: true },
        });
        return { tripId: trip.id, packId: pack.id };
      });
      tripId = tripCree.tripId;
      packId = tripCree.packId;
    }

    res.json({
      pack:          packNote,
      trip_id:       tripId,
      pack_id:       packId,
      flights_found: flights.length,
      events_found:  events.length,
      score:         resultatScore.total
    });

  } catch (err) {
    console.error('Erreur génération IA :', (err as Error).message);
    next(err);
  }
});

/**
 * POST /api/ai/chat — Modification conversationnelle post-génération.
 *
 * C'est la seule partie vraiment "agentique" de TripGenie :
 * le LLM reçoit le pack actuel + le message utilisateur et décide
 * librement quels éléments modifier, sans étapes prédéfinies.
 *
 * Contrairement à /generate (pipeline fixe), ici le modèle
 * choisit lui-même ce qu'il modifie dans le pack.
 *
 * Si l'utilisateur est connecté et qu'un trip_id est fourni,
 * les modifications sont persistées en base de données.
 *
 * @requires aiChatLimiter — 30 messages/15min/IP
 */
router.post('/chat', aiChatLimiter, optionalAuth, validateBody(schemaChat), async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { message, current_pack, mode, trip_id } = req.body;

    const resultat = await chatModify({
      currentPack: current_pack,
      userMessage: message,
      mode: mode as TravelMode
    });

    // MAJ DB si l'utilisateur a le droit de modifier ce voyage : propriétaire
    // ou collaborateur « editor ». Un « viewer » (ou un tiers) est ignoré ici.
    if (req.user && trip_id && resultat.modifications && await peutEditerVoyage(req.user.id, trip_id)) {
      await prisma.trip.update({
        where: { id: trip_id },
        data:  { pack_data: { ...current_pack, ...resultat.modifications } as Prisma.InputJsonValue },
      });
    }

    res.json(resultat);

  } catch (err) {
    console.error('Erreur chat IA :', (err as Error).message);
    next(err);
  }
});

export default router;
