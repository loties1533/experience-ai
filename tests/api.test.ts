// =============================================
// EXPERIENCE AI — tests/api.test.ts
// Tests des routes transverses : santé, authentification, photos, 404.
// Le parcours a ses propres suites (unit/ et security/input-validation).
// =============================================

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../server/index.js';

// ============================================================
// SETUP — variables d'environnement de test
// ============================================================

process.env.JWT_SECRET = 'test-jwt-secret-for-vitest';

const TEST_USER = { id: 'aabbccdd-0000-0000-0000-aabbccddee00', email: 'pilot@experience.test', name: 'Test Pilot' };
const TEST_TOKEN = jwt.sign(TEST_USER, process.env.JWT_SECRET, { expiresIn: '1d' });

// ============================================================
// MOCKS GLOBAUX
// ============================================================

vi.mock('express-rate-limit', () => ({
  default:   () => (_req: any, _res: any, next: any) => next(),
  rateLimit: () => (_req: any, _res: any, next: any) => next()
}));

vi.mock('../server/middleware/limiter.js', () => {
  const passthrough = (_req: any, _res: any, next: any) => next();
  return { aiGenerateLimiter: passthrough, aiChatLimiter: passthrough, authLimiter: passthrough };
});

vi.mock('bcryptjs', () => ({
  default: {
    genSalt:  vi.fn().mockResolvedValue('salt'),
    hash:     vi.fn().mockResolvedValue('$2b$hashed_password'),
    compare:  vi.fn().mockResolvedValue(true)
  }
}));

// ---- Mock Prisma ----
// Seuls les modèles encore existants : users, parcours, preferences_parcours.
const { prismaMock } = vi.hoisted(() => {
  const model = () => ({
    findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
    create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    delete: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn(),
  });
  const prismaMock: any = { user: model(), parcours: model(), preferenceParcours: model() };
  prismaMock.$transaction = vi.fn(async (fn: any) => fn(prismaMock));
  return { prismaMock };
});
vi.mock('../server/db/prisma.js', () => ({ default: prismaMock }));

const USER_ROW = {
  id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name,
  password: '$2b$hashed_password', avatar_url: null, created_at: new Date(), updated_at: new Date(),
};

// Défauts (clearAllMocks ne réinitialise PAS les implémentations → ils tiennent).
prismaMock.user.findUnique.mockResolvedValue(USER_ROW);
prismaMock.user.create.mockResolvedValue({ id: USER_ROW.id, email: USER_ROW.email, name: USER_ROW.name, avatar_url: null, created_at: new Date() });

vi.mock('../server/services/photo.js', () => ({
  getDestinationPhoto: vi.fn().mockResolvedValue('https://example.com/photo.jpg')
}));

// ============================================================
// 1 — HEALTH CHECK
// ============================================================

describe('GET /api/health', () => {
  it('renvoie status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

// ============================================================
// 2 — AUTH — Validation
// ============================================================

describe('Auth — validation des entrées', () => {

  it('POST /signup — 400 si email invalide', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'pas-un-email', password: 'Password123!', name: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  it('POST /signup — 400 si mot de passe trop court', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'ok@test.com', password: '123', name: 'Test' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/passe/i);
  });

  it('POST /signup — 201 avec utilisateur créé (mock)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'pilot@experience.test', password: 'Password123!', name: 'Test Pilot' });

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
  });

  it('POST /login — 200, user dans le body et token en cookie httpOnly (mock)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pilot@experience.test', password: 'Password123!' });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    // Le token ne doit PAS fuiter dans le body — il vit dans un cookie httpOnly
    expect(res.body.token).toBeUndefined();
    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.some(c => c.startsWith('tg_token=') && /HttpOnly/i.test(c))).toBe(true);
  });

  it('GET /me — 401 sans token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /me — 200 avec Bearer token valide', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name, avatar_url: null, created_at: new Date() } as any);
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${TEST_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(TEST_USER.email);
  });

  it('POST /logout — 200 et efface le cookie', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
  });
});

// ============================================================
// 3 — AUTH — cas limites
// ============================================================

describe('Auth — cas limites', () => {

  it('POST /login — 401 si mot de passe incorrect (mock bcrypt false)', async () => {
    const { default: bcrypt } = await import('bcryptjs');
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'pilot@experience.test', password: 'mauvais_mdp' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  it('POST /signup — 409 si email déjà utilisé', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'existing-id' } as any);

    const res = await request(app)
      .post('/api/auth/signup')
      .send({ email: 'existant@test.com', password: 'Password123!', name: 'Déjà là' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/déjà utilisé/i);
  });

  it('POST /logout — efface le cookie tg_token', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'];
    expect(setCookie?.toString()).toMatch(/tg_token/);
  });
});

// ============================================================
// 4 — PHOTOS (proxy)
// ============================================================

describe('GET /api/photos/:city', () => {

  it('renvoie 200 avec une URL de photo', async () => {
    const res = await request(app).get('/api/photos/Lisbonne');
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('https://example.com/photo.jpg');
  });

  it('fonctionne avec un nom de ville encodé (accents)', async () => {
    const res = await request(app).get(`/api/photos/${encodeURIComponent('São Paulo')}`);
    expect(res.status).toBe(200);
    expect(res.body.url).toBeDefined();
  });
});

// ============================================================
// 5 — ROUTES DISPARUES ET ERREURS
// ============================================================

describe('Gestion des erreurs', () => {

  it('route inconnue — 404', async () => {
    const res = await request(app).get('/api/cette-route-nexiste-pas');
    expect(res.status).toBe(404);
  });

  it('POST /auth/signup — 400 Zod si payload vide', async () => {
    const res = await request(app).post('/api/auth/signup').send({});
    expect(res.status).toBe(400);
  });

  // Le modèle Pack a été supprimé au sprint R6b : ses routes ne doivent plus
  // répondre, même à un utilisateur authentifié.
  it.each(['/api/trips', '/api/votes', '/api/ai/generate', '/api/preferences'])(
    'ancienne route %s — 404',
    async (chemin) => {
      const res = await request(app).get(chemin).set('Authorization', `Bearer ${TEST_TOKEN}`);
      expect(res.status).toBe(404);
    }
  );
});
