// =============================================
// TRIPGENIE — tests/integration/generate-restaurants.test.ts
// Tests d'intégration du pipeline /api/ai/generate :
//   - restaurants Foursquare mergés dans activities
//   - fallback Yelp si Foursquare vide
//   - pas de restaurants si les deux APIs vides
//   - activités existantes conservées
// =============================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../server/index.js';

process.env.JWT_SECRET = 'test-secret-for-vitest';

vi.mock('express-rate-limit', () => ({
  default:   () => (_: any, __: any, next: any) => next(),
  rateLimit: () => (_: any, __: any, next: any) => next()
}));
vi.mock('../../server/middleware/limiter.js', () => {
  const p = (_: any, __: any, n: any) => n();
  return { aiGenerateLimiter: p, aiChatLimiter: p, authLimiter: p };
});

// ---- Mocks des services externes ----
// Inline dans la factory (vi.mock est hoisté → les const externes ne sont pas encore initialisées)
vi.mock('../../server/services/smartSearch.js', () => ({
  smartFlightSearch: vi.fn().mockResolvedValue(null),
  smartEventsSearch: vi.fn().mockResolvedValue([]),
  smartHotelSearch:  vi.fn().mockResolvedValue([])
}));
vi.mock('../../server/services/weather.js', () => ({ getRealWeather: vi.fn().mockResolvedValue(null) }));
vi.mock('../../server/services/photo.js',   () => ({ getDestinationPhoto: vi.fn().mockResolvedValue(null) }));
// (couche DB = Prisma, mockée au niveau des routes si nécessaire)

// ---- Restaurants mock — vi.hoisted() car vi.mock est hoisté avant les const ----
const { mockFSQ, mockYelp } = vi.hoisted(() => {
  const mockFSQ  = vi.fn();
  const mockYelp = vi.fn();
  return { mockFSQ, mockYelp };
});
vi.mock('../../server/services/foursquare.js', () => ({ foursquareRestaurantSearch: mockFSQ }));
vi.mock('../../server/services/yelp.js',       () => ({ yelpRestaurantSearch:        mockYelp }));

// ---- IA mock — retourne un pack avec 1 activité de base ----
vi.mock('../../server/services/claude/index.js', () => ({
  analyzeRequest:      vi.fn(),
  suggestDestinations: vi.fn(),
  chatIntake:          vi.fn(),
  chatModify:          vi.fn(),
  assemblerPack:        vi.fn()
}));

import { assemblerPack as _assemblePack } from '../../server/services/claude/index.js';
const mockAssemblePack = vi.mocked(_assemblePack);

const VALID_BODY = {
  destination: 'Ibiza',
  departure:   '2025-07-15',
  return_date: '2025-07-22',
  travelers:   4,
  budget:      12000,
  mode:        'party'
};

const BASE_PACK = {
  destination:      'Ibiza',
  country:          'Spain',
  tagline:          'La fête de l\'été',
  overview:         'Ibiza, île de la fête.',
  summary:          { total_budget: '12000€', nights: 7, activities_count: 1 },
  flights:          [],
  hotels:           [{ name: 'Ushuaia Hotel', location: 'Playa d\'en Bossa', stars: 5, price_per_night: '300€' }],
  itinerary:        [],
  activities:       [{ name: 'Plage Salines', category: 'nature', description: 'Magnifique.', duration: '3h', price: 0 }],
  events:           [],
  budget_breakdown: { total: '12000€' },
  weather:          null
};

const FSQ_RESTAURANTS = [
  { name: 'El Chiringuito', category: 'Fine Dining', description: 'Top resto.', duration: '1h30', price: 65, booking_url: 'https://thefork.fr/recherche?q=El+Chiringuito', price_range: '$$$' },
  { name: 'Lio Restaurant',  category: 'Spanish', description: 'Vue marina.', duration: '2h',   price: 80, booking_url: 'https://thefork.fr/recherche?q=Lio+Restaurant',  price_range: '$$$' }
];

const YELP_RESTAURANTS = [
  { name: 'Nobu Ibiza', category: 'Japanese', description: 'Célèbre.', duration: '1h30', price: 90, booking_url: 'https://yelp.com/biz/nobu-ibiza', price_range: '$$$$' }
];

beforeEach(() => {
  vi.clearAllMocks();
  mockAssemblePack.mockResolvedValue({ ...BASE_PACK });
  // Reset complet pour vider la queue des Once non consommés entre tests
  // (les tests FSQ ne consomment pas le mockYelp → accumulation)
  mockFSQ.mockReset().mockResolvedValue([]);
  mockYelp.mockReset().mockResolvedValue([]);
});

// ============================================================
// Foursquare → merge dans activities
// ============================================================
describe('Pipeline generate — restaurants Foursquare mergés', () => {

  it('restaurants Foursquare ajoutés aux activités existantes', async () => {
    mockFSQ.mockResolvedValueOnce(FSQ_RESTAURANTS);
    mockYelp.mockResolvedValueOnce([]);

    const res = await request(app).post('/api/ai/generate').send(VALID_BODY);
    expect(res.status).toBe(200);
    const activities: any[] = res.body.pack.activities;
    const restoNames = activities.map((a: any) => a.name);
    expect(restoNames).toContain('El Chiringuito');
    expect(restoNames).toContain('Lio Restaurant');
  });

  it('activités IA originales préservées après le merge', async () => {
    mockFSQ.mockResolvedValueOnce(FSQ_RESTAURANTS);
    mockYelp.mockResolvedValueOnce([]);

    const res = await request(app).post('/api/ai/generate').send(VALID_BODY);
    const activities: any[] = res.body.pack.activities;
    expect(activities.some((a: any) => a.name === 'Plage Salines')).toBe(true);
  });

  it('total activités = activités IA + restaurants Foursquare', async () => {
    mockFSQ.mockResolvedValueOnce(FSQ_RESTAURANTS);
    mockYelp.mockResolvedValueOnce([]);

    const res = await request(app).post('/api/ai/generate').send(VALID_BODY);
    const activities: any[] = res.body.pack.activities;
    // 1 activité IA + 2 FSQ = 3
    expect(activities).toHaveLength(3);
  });
});

// ============================================================
// Fallback Yelp si Foursquare vide
// ============================================================
describe('Pipeline generate — fallback Yelp', () => {

  it('Yelp utilisé si Foursquare retourne []', async () => {
    mockFSQ.mockResolvedValueOnce([]);
    mockYelp.mockResolvedValueOnce(YELP_RESTAURANTS);

    const res = await request(app).post('/api/ai/generate').send(VALID_BODY);
    expect(res.status).toBe(200);
    const activities: any[] = res.body.pack.activities;
    expect(activities.some((a: any) => a.name === 'Nobu Ibiza')).toBe(true);
  });

  it('Foursquare prioritaire sur Yelp', async () => {
    mockFSQ.mockResolvedValueOnce(FSQ_RESTAURANTS);
    mockYelp.mockResolvedValueOnce(YELP_RESTAURANTS);

    const res = await request(app).post('/api/ai/generate').send(VALID_BODY);
    const activities: any[] = res.body.pack.activities;
    // FSQ est utilisé → Nobu Ibiza (Yelp) ne doit pas être là
    expect(activities.some((a: any) => a.name === 'Nobu Ibiza')).toBe(false);
    expect(activities.some((a: any) => a.name === 'El Chiringuito')).toBe(true);
  });
});

// ============================================================
// Pas de restaurants si les deux APIs échouent
// ============================================================
describe('Pipeline generate — dégradation gracieuse', () => {

  it('pack généré même si Foursquare ET Yelp retournent []', async () => {
    mockFSQ.mockResolvedValueOnce([]);
    mockYelp.mockResolvedValueOnce([]);

    const res = await request(app).post('/api/ai/generate').send(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.body.pack).toBeDefined();
  });

  it('activités IA seules si les deux restaurants échouent', async () => {
    mockFSQ.mockRejectedValueOnce(new Error('FSQ down'));
    mockYelp.mockRejectedValueOnce(new Error('Yelp down'));

    const res = await request(app).post('/api/ai/generate').send(VALID_BODY);
    expect(res.status).toBe(200);
    const activities: any[] = res.body.pack.activities;
    expect(activities.some((a: any) => a.name === 'Plage Salines')).toBe(true);
  });

  it('réponse contient toujours score, flights_found, events_found', async () => {
    mockFSQ.mockResolvedValueOnce([]);
    mockYelp.mockResolvedValueOnce([]);

    const res = await request(app).post('/api/ai/generate').send(VALID_BODY);
    expect(res.body).toHaveProperty('score');
    expect(res.body).toHaveProperty('flights_found');
    expect(res.body).toHaveProperty('events_found');
  });
});
