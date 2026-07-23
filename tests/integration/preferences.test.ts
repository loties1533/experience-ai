// =============================================
// TRIPGENIE — tests/integration/preferences.test.ts
// Route préférences utilisateur (relation 1-1 avec users) :
//   - auth requise (401 sans token)
//   - GET : null si aucune préférence (PGRST116), sinon l'objet stocké
//   - PUT : validation Zod (mode, devise, nb d'intérêts) + upsert
// Prisma et rate-limiters mockés — seul le middleware auth tourne réellement.
// =============================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
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

// Mock Prisma : GET → userPreference.findUnique, PUT → userPreference.upsert.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { userPreference: { findUnique: vi.fn(), upsert: vi.fn() } } as any,
}));
vi.mock('../../server/db/prisma.js', () => ({ default: prismaMock }));

const USER  = { id: 'user-uuid', email: 'u@test.com', name: 'User' };
const token = jwt.sign(USER, process.env.JWT_SECRET!, { expiresIn: '1d' });
const auth  = (r: any) => r.set('Authorization', `Bearer ${token}`);

beforeEach(() => {
  vi.clearAllMocks();
  // Défaut : aucune préférence. Chaque test fournit ses données via Once.
  prismaMock.userPreference.findUnique.mockResolvedValue(null);
});

// ============================================================
// GET /api/preferences
// ============================================================
describe('GET /api/preferences', () => {

  it('401 sans token', async () => {
    const res = await request(app).get('/api/preferences');
    expect(res.status).toBe(401);
  });

  it('preferences = null si aucune ligne', async () => {
    prismaMock.userPreference.findUnique.mockResolvedValueOnce(null);
    const res = await auth(request(app).get('/api/preferences'));
    expect(res.status).toBe(200);
    expect(res.body.preferences).toBeNull();
  });

  it('retourne les préférences existantes', async () => {
    const prefs = { user_id: USER.id, default_mode: 'relax', default_premium: true, currency: 'EUR', home_city: 'Lyon', preferred_prefs: ['culture'] };
    prismaMock.userPreference.findUnique.mockResolvedValueOnce(prefs as any);
    const res = await auth(request(app).get('/api/preferences'));
    expect(res.status).toBe(200);
    expect(res.body.preferences.default_mode).toBe('relax');
    expect(res.body.preferences.default_premium).toBe(true);
    expect(res.body.preferences.home_city).toBe('Lyon');
  });

  it('500 si une vraie erreur DB', async () => {
    // La requête SQL rejette (ex: table absente) → next(err) → handler global 500
    prismaMock.userPreference.findUnique.mockRejectedValueOnce(new Error('table absente'));
    const res = await auth(request(app).get('/api/preferences'));
    expect(res.status).toBe(500);
  });
});

// ============================================================
// PUT /api/preferences
// ============================================================
describe('PUT /api/preferences', () => {

  it('401 sans token', async () => {
    const res = await request(app).put('/api/preferences').send({ default_mode: 'relax' });
    expect(res.status).toBe(401);
  });

  it('400 si default_mode hors énumération', async () => {
    const res = await auth(request(app).put('/api/preferences')).send({ default_mode: 'casino' });
    expect(res.status).toBe(400);
  });

  it('400 si devise != 3 caractères', async () => {
    const res = await auth(request(app).put('/api/preferences')).send({ currency: 'EURO' });
    expect(res.status).toBe(400);
  });

  it('400 si plus de 10 centres d\'intérêt', async () => {
    const res = await auth(request(app).put('/api/preferences'))
      .send({ preferred_prefs: Array.from({ length: 11 }, (_, i) => `p${i}`) });
    expect(res.status).toBe(400);
  });

  it('200 + upsert avec des données valides', async () => {
    const prefs = { user_id: USER.id, default_mode: 'relax', currency: 'USD', home_city: 'Nice', preferred_prefs: ['plage', 'nature'] };
    prismaMock.userPreference.upsert.mockResolvedValueOnce(prefs as any);
    const res = await auth(request(app).put('/api/preferences'))
      .send({ default_mode: 'relax', currency: 'USD', home_city: 'Nice', preferred_prefs: ['plage', 'nature'] });
    expect(res.status).toBe(200);
    expect(res.body.preferences.default_mode).toBe('relax');
    // L'upsert est un INSERT ... ON CONFLICT (user_id) DO UPDATE en SQL paramétré
    expect(prismaMock.userPreference.upsert).toHaveBeenCalled();
  });

  it('accepte un body partiel (tous les champs sont optionnels)', async () => {
    prismaMock.userPreference.upsert.mockResolvedValueOnce({ user_id: USER.id, home_city: 'Bordeaux' } as any);
    const res = await auth(request(app).put('/api/preferences')).send({ home_city: 'Bordeaux' });
    expect(res.status).toBe(200);
    expect(res.body.preferences.home_city).toBe('Bordeaux');
  });
});
