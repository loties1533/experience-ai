// =============================================
// TRIPGENIE — tests/golden_path.test.ts
// Couverture des flux critiques : generate, chat, photos, votes
// =============================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../server/index.js';

// ============================================================
// MOCKS GLOBAUX (tous les services externes sont simulés)
// ============================================================

// Bypass TOUS les rate limiters (express-rate-limit partagé entre tests)
// Sans ça, les tests s'auto-bloquent après 5 requêtes IA/min
vi.mock('express-rate-limit', () => ({
  default:    () => (_req: any, _res: any, next: any) => next(),
  rateLimit:  () => (_req: any, _res: any, next: any) => next()
}));

// Bypass rate limiters du middleware dédié
vi.mock('../server/middleware/limiter.js', () => {
  const passthrough = (_req: any, _res: any, next: any) => next();
  return {
    aiGenerateLimiter: passthrough,
    aiChatLimiter:     passthrough,
    authLimiter:       passthrough
  };
});

vi.mock('../server/services/claude/index.js', () => ({
  analyzeRequest:      vi.fn(),
  suggestDestinations: vi.fn(),
  chatIntake:          vi.fn(),
  chatModify:          vi.fn().mockResolvedValue({
    reply:          'Voici les modifications demandées.',
    modifications:  { tagline: 'Nouvelle accroche' }
  }),
  assemblerPack: vi.fn().mockResolvedValue({
    destination: 'Paris',
    country:     'France',
    tagline:     'La ville lumière',
    overview:    'Une expérience inoubliable.',
    weather: {
      avg_temp:   '20°C',
      conditions: 'Soleil',
      tip:        'Léger'
    },
    summary: {
      total_budget:     '2000€',
      nights:           4,
      activities_count: 3
    },
    flights: [],
    hotels: [{
      name:            'Hôtel Ritz',
      location:        'Place Vendôme',
      stars:           5,
      price_per_night: '500€',
      highlights:      'Luxe'
    }],
    itinerary: [],
    activities: [{
      name:        'Tour Eiffel',
      category:    'Culture',
      description: 'Iconique',
      duration:    '2h',
      price:       '25€',
      best_time:   'Jour'
    }],
    events: [],
    budget_breakdown: {
      vols:         '500€',
      hebergement:  '1000€',
      activites:    '300€',
      restauration: '200€',
      transports:   '0€',
      divers:       '0€',
      total:        '2000€'
    },
    tips:          []
  })
}));

vi.mock('../server/services/smartSearch.js', () => ({
  smartFlightSearch: vi.fn().mockResolvedValue({
    price:        250,
    airline:      'Air France',
    outbound_time:'10:00',
    arrival_time: '12:00',
    duration:     '2',
    stops:        'Direct'
  }),
  smartEventsSearch: vi.fn().mockResolvedValue([]),
  smartHotelSearch:  vi.fn().mockResolvedValue([])
}));

vi.mock('../server/services/weather.js', () => ({
  getRealWeather: vi.fn().mockResolvedValue({
    temp:       '20°C',
    conditions: 'Ensoleillé'
  })
}));

vi.mock('../server/services/photo.js', () => ({
  getDestinationPhoto: vi.fn().mockResolvedValue('https://example.com/photo.jpg')
}));

// Restaurants : sans ces mocks, /generate fait de VRAIS appels réseau Foursquare/Yelp
// → latence aléatoire → timeout du test. On renvoie [] (dégradation gracieuse testée ailleurs).
vi.mock('../server/services/foursquare.js', () => ({
  foursquareRestaurantSearch: vi.fn().mockResolvedValue([])
}));
vi.mock('../server/services/yelp.js', () => ({
  yelpRestaurantSearch: vi.fn().mockResolvedValue([])
}));

// Mock Prisma : /api/votes utilise prisma.tripVote.create (table publique).
// /generate est envoyé SANS token → req.user absent → aucune écriture trip/pack.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    tripVote: { create: vi.fn(), findMany: vi.fn() },
    trip:     { create: vi.fn(), findMany: vi.fn() },
    pack:     { create: vi.fn() },
  } as any,
}));
vi.mock('../server/db/prisma.js', () => ({ default: prismaMock }));
prismaMock.tripVote.create.mockResolvedValue({ id: 'vote-uuid', pack_id: '550e8400-e29b-41d4-a716-446655440000', item_id: 'x', voter_name: 'Alice', vote_type: true, created_at: new Date() });
prismaMock.tripVote.findMany.mockResolvedValue([]);

// ============================================================
// 1 — ROUTE POST /api/ai/generate
// ============================================================

describe('🏆 GOLDEN PATH — POST /api/ai/generate', () => {

  const validPayload = {
    destination: 'Paris',
    origin:      'Bordeaux',
    departure:   '2025-06-01',
    return_date: '2025-06-05',
    travelers:   2,
    budget:      2000,
    mode:        'relax',
    premium:     true
  };

  it('renvoie 200 avec la structure de pack complète (flux nominal)', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .send(validPayload);

    expect(res.status).toBe(200);

    const { pack, score, flights_found, events_found } = res.body;

    // Structure pack
    expect(pack).toBeDefined();
    expect(pack.destination).toBe('Paris');
    expect(pack.hotels).toHaveLength(1);
    expect(pack.budget_breakdown).toBeDefined();
    expect(pack.activities.length).toBeGreaterThan(0);

    // Champs méta
    expect(typeof flights_found).toBe('number');
    expect(typeof events_found).toBe('number');
    expect(flights_found).toBeGreaterThanOrEqual(0);
    expect(events_found).toBeGreaterThanOrEqual(0);
  });

  it('le score total est un nombre compris entre 0 et 1', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .send(validPayload);

    expect(res.status).toBe(200);
    const { score } = res.body;
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it('le pack intègre les données du vol trouvé', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.flights_found).toBe(1);

    const vol = res.body.pack.flights_data?.[0];
    expect(vol).toBeDefined();
    expect(vol.outbound.airline).toBe('Air France');
    expect(vol.price_per_person).toBe(250);
    expect(vol.price).toBe(500); // 250 × 2 voyageurs
  });

  it('retourne 400 si destination manquante', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .send({ origin: 'Bordeaux', departure: '2025-06-01', budget: 2000 });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('fail');
    expect(res.body.message).toMatch(/destination/i);
  });

  it('retourne 400 si budget manquant ou nul', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .send({ destination: 'Paris', departure: '2025-06-01', budget: 0 });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('fail');
    expect(res.body.message).toMatch(/budget/i);
  });

  it('retourne 400 si date de départ manquante', async () => {
    const res = await request(app)
      .post('/api/ai/generate')
      .send({ destination: 'Paris', budget: 1000 });

    expect(res.status).toBe(400);
    expect(res.body.status).toBe('fail');
    expect(res.body.message).toMatch(/d.part/i);
  });
});

// ============================================================
// 2 — ROUTE POST /api/ai/chat
// ============================================================

describe('💬 POST /api/ai/chat', () => {

  const fakePack = {
    destination: 'Paris',
    tagline:     'La ville lumière'
  };

  it('renvoie 200 avec une réponse IA et des modifications', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .send({
        message:      'Ajoute une activité bien-être',
        current_pack: fakePack,
        mode:         'relax'
      });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBeDefined();
    expect(typeof res.body.reply).toBe('string');
  });

  it('retourne 400 si message vide', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .send({ message: '', current_pack: fakePack });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/i);
  });

  it('retourne 400 si message trop long (> 1000 car.)', async () => {
    const res = await request(app)
      .post('/api/ai/chat')
      .send({ message: 'A'.repeat(1001), current_pack: fakePack });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/long/i);
  });
});

// ============================================================
// 3 — ROUTE GET /api/photos/:city (proxy Unsplash)
// ============================================================

describe('📸 GET /api/photos/:city', () => {

  it('renvoie 200 avec une URL de photo', async () => {
    const res = await request(app)
      .get('/api/photos/Paris');

    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://example.com/photo.jpg');
  });

  it('fonctionne avec un nom de ville encodé (accents)', async () => {
    const res = await request(app)
      .get(`/api/photos/${encodeURIComponent('São Paulo')}`);

    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
  });
});

// ============================================================
// 4 — ROUTES /api/votes (POST & GET)
// ============================================================

describe('🗳️ POST /api/votes', () => {

  it('enregistre un vote positif (flux nominal)', async () => {
    const res = await request(app)
      .post('/api/votes')
      .send({
        pack_id:    '550e8400-e29b-41d4-a716-446655440000',
        item_id:    'activity-tour-eiffel',
        vote_type:  true,
        voter_name: 'Alice'
      });

    // Le mock pg (mockPgQuery) renvoie une ligne de vote → 200/201
    expect([200, 201]).toContain(res.status);
  });

  it('retourne 400 si pack_id n\'est pas un UUID valide', async () => {
    const res = await request(app)
      .post('/api/votes')
      .send({
        pack_id:   'pas-un-uuid',
        item_id:   'activity-tour-eiffel',
        vote_type: true
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide/i);
  });

  it('retourne 400 si item_id est absent', async () => {
    const res = await request(app)
      .post('/api/votes')
      .send({
        pack_id:   '550e8400-e29b-41d4-a716-446655440000',
        vote_type: false
      });

    expect(res.status).toBe(400);
  });
});

// ============================================================
// 5 — ROUTE GET /api/health
// ============================================================

describe('❤️ GET /api/health', () => {
  it('renvoie status ok', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
