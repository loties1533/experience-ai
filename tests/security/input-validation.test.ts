// =============================================
// TRIPGENIE — tests/security/input-validation.test.ts
// Validation des inputs sur toutes les routes IA :
//   - champs manquants
//   - types incorrects
//   - limites de longueur
//   - valeurs hors bornes (budget, travelers)
//   - injection dans les champs libres
// =============================================

import { describe, it, expect, vi } from 'vitest';
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
vi.mock('../../server/services/claude/index.js', () => ({
  analyzeRequest:      vi.fn().mockResolvedValue({}),
  suggestDestinations: vi.fn().mockResolvedValue({ destinations: [] }),
  chatIntake:          vi.fn().mockResolvedValue({ response: 'ok', isReady: false }),
  chatModify:          vi.fn().mockResolvedValue({ reply: 'ok', modifications: {} }),
  assemblerPack:        vi.fn().mockResolvedValue({
    destination: 'Paris', country: 'France', tagline: 'Test', overview: '',
    summary: { total_budget: '1000€', nights: 3, activities_count: 2 },
    flights: [], hotels: [], itinerary: [], activities: [], events: [],
    budget_breakdown: { total: '1000€' }, weather: null
  })
}));
vi.mock('../../server/services/smartSearch.js', () => ({
  smartFlightSearch: vi.fn().mockResolvedValue(null),
  smartEventsSearch: vi.fn().mockResolvedValue([]),
  smartHotelSearch:  vi.fn().mockResolvedValue([])
}));
vi.mock('../../server/services/weather.js',      () => ({ getRealWeather:      vi.fn().mockResolvedValue(null) }));
vi.mock('../../server/services/photo.js',         () => ({ getDestinationPhoto: vi.fn().mockResolvedValue(null) }));
vi.mock('../../server/services/foursquare.js',    () => ({ foursquareRestaurantSearch: vi.fn().mockResolvedValue([]) }));
vi.mock('../../server/services/yelp.js',          () => ({ yelpRestaurantSearch: vi.fn().mockResolvedValue([]) }));
// (couche DB = Prisma, mockée au niveau des routes si nécessaire)

// ============================================================
// POST /api/ai/generate — validation des inputs
// ============================================================
describe('POST /api/ai/generate — champs requis et bornes', () => {

  const VALID_BODY = {
    destination: 'Barcelone',
    departure:   '2025-08-01',
    return_date: '2025-08-08',
    travelers:   2,
    budget:      3000,
    mode:        'party'
  };

  it('400 si destination manquante', async () => {
    const { destination, ...body } = VALID_BODY;
    const res = await request(app).post('/api/ai/generate').send(body);
    expect(res.status).toBe(400);
  });

  it('400 si destination vide (whitespace)', async () => {
    const res = await request(app).post('/api/ai/generate').send({ ...VALID_BODY, destination: '   ' });
    expect(res.status).toBe(400);
  });

  it('400 si departure manquant', async () => {
    const { departure, ...body } = VALID_BODY;
    const res = await request(app).post('/api/ai/generate').send(body);
    expect(res.status).toBe(400);
  });

  it('400 si budget = 0', async () => {
    const res = await request(app).post('/api/ai/generate').send({ ...VALID_BODY, budget: 0 });
    expect(res.status).toBe(400);
  });

  it('400 si budget négatif', async () => {
    const res = await request(app).post('/api/ai/generate').send({ ...VALID_BODY, budget: -500 });
    expect(res.status).toBe(400);
  });

  it('400 si budget > 50 000', async () => {
    const res = await request(app).post('/api/ai/generate').send({ ...VALID_BODY, budget: 99999 });
    expect(res.status).toBe(400);
  });

  it('400 si travelers = 0', async () => {
    const res = await request(app).post('/api/ai/generate').send({ ...VALID_BODY, travelers: 0 });
    expect(res.status).toBe(400);
  });

  it('400 si travelers > 20', async () => {
    const res = await request(app).post('/api/ai/generate').send({ ...VALID_BODY, travelers: 25 });
    expect(res.status).toBe(400);
  });

  it('200 avec inputs valides', async () => {
    const res = await request(app).post('/api/ai/generate').send(VALID_BODY);
    expect(res.status).toBe(200);
  });

  it('destination avec injection JSON ne plante pas le serveur', async () => {
    const res = await request(app).post('/api/ai/generate').send({
      ...VALID_BODY,
      destination: '{"$gt": ""}' // NoSQL injection style
    });
    expect(res.status).not.toBe(500);
  });

  it('destination avec balises HTML ne plante pas', async () => {
    const res = await request(app).post('/api/ai/generate').send({
      ...VALID_BODY,
      destination: '<img src=x onerror=alert(1)>'
    });
    // Peut réussir (la destination est passée à l'IA) ou échouer, mais jamais 500
    expect(res.status).not.toBe(500);
  });
});

// ============================================================
// POST /api/ai/chat — validation du message
// ============================================================
describe('POST /api/ai/chat — validation message', () => {

  it('400 si message manquant', async () => {
    const res = await request(app).post('/api/ai/chat').send({ current_pack: {}, mode: 'party' });
    expect(res.status).toBe(400);
  });

  it('400 si message vide', async () => {
    const res = await request(app).post('/api/ai/chat').send({ message: '', current_pack: {}, mode: 'party' });
    expect(res.status).toBe(400);
  });

  it('400 si message > 1000 caractères', async () => {
    const res = await request(app).post('/api/ai/chat').send({
      message:      'A'.repeat(1001),
      current_pack: {},
      mode:         'party'
    });
    expect(res.status).toBe(400);
  });

  it('200 avec message valide', async () => {
    const res = await request(app).post('/api/ai/chat').send({
      message:      'Change l\'hôtel',
      current_pack: { destination: 'Paris' },
      mode:         'party'
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================
// POST /api/ai/onboarding — validation
// ============================================================
describe('POST /api/ai/onboarding — validation', () => {

  it('400 si userMessage manquant', async () => {
    const res = await request(app).post('/api/ai/onboarding').send({ currentData: {} });
    expect(res.status).toBe(400);
  });

  it('400 si userMessage > 1000 caractères', async () => {
    const res = await request(app).post('/api/ai/onboarding').send({
      userMessage: 'B'.repeat(1001),
      currentData: {}
    });
    expect(res.status).toBe(400);
  });

  it('200 avec message valide', async () => {
    const res = await request(app).post('/api/ai/onboarding').send({
      userMessage: '2 amis, fête, budget 5000€',
      currentData: {}
    });
    expect(res.status).toBe(200);
  });
});

// ============================================================
// POST /api/ai/analyze — validation
// ============================================================
describe('POST /api/ai/analyze — validation', () => {

  it('400 si input manquant', async () => {
    const res = await request(app).post('/api/ai/analyze').send({});
    expect(res.status).toBe(400);
  });

  it('400 si input > 1000 caractères', async () => {
    const res = await request(app).post('/api/ai/analyze').send({ input: 'C'.repeat(1001) });
    expect(res.status).toBe(400);
  });
});
