// =============================================
// TRIPGENIE — tests/middleware.test.ts
// Tests du middleware d'authentification JWT
// requireAuth et optionalAuth
// =============================================

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../server/index.js';

process.env.JWT_SECRET = 'test-jwt-secret-for-vitest';

const TEST_USER = { id: 'aabbccdd-0000-0000-0000-aabbccddee00', email: 'pilot@tripgenie.test', name: 'Test Pilot' };
const TEST_TRIP_ID = '550e8400-e29b-41d4-a716-446655440000';

// ---- Mocks ----
vi.mock('express-rate-limit', () => ({
  default:   () => (_req: any, _res: any, next: any) => next(),
  rateLimit: () => (_req: any, _res: any, next: any) => next()
}));

vi.mock('../server/middleware/limiter.js', () => {
  const passthrough = (_req: any, _res: any, next: any) => next();
  return { aiGenerateLimiter: passthrough, aiChatLimiter: passthrough, authLimiter: passthrough };
});

// Mock Prisma : GET /api/trips utilise prisma.trip.findMany.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { trip: { findMany: vi.fn(), findFirst: vi.fn() } } as any,
}));
vi.mock('../server/db/prisma.js', () => ({ default: prismaMock }));
prismaMock.trip.findMany.mockResolvedValue([]);
prismaMock.trip.findFirst.mockResolvedValue(null);

// ============================================================
// requireAuth — routes protégées (/api/trips nécessite auth)
// ============================================================

describe('🔒 requireAuth middleware', () => {

  it('401 si aucun token fourni', async () => {
    const res = await request(app).get('/api/trips');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/manquant|invalide/i);
  });

  it('401 si token JWT expiré', async () => {
    // On signe un token avec une expiration passée (-1 seconde)
    const expiredToken = jwt.sign(TEST_USER, process.env.JWT_SECRET as string, { expiresIn: -1 });

    const res = await request(app)
      .get('/api/trips')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expir/i);
  });

  it('401 si token JWT malformé (string aléatoire)', async () => {
    const res = await request(app)
      .get('/api/trips')
      .set('Authorization', 'Bearer ceci.nest.pas.un.jwt');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalide/i);
  });

  it('401 si token signé avec le mauvais secret', async () => {
    const wrongToken = jwt.sign(TEST_USER, 'mauvais-secret', { expiresIn: '1d' });

    const res = await request(app)
      .get('/api/trips')
      .set('Authorization', `Bearer ${wrongToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalide/i);
  });

  it('200 si token Bearer valide', async () => {
    const validToken = jwt.sign(TEST_USER, process.env.JWT_SECRET as string, { expiresIn: '1d' });

    const res = await request(app)
      .get('/api/trips')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
  });
});

// ============================================================
// optionalAuth — routes IA accessibles sans auth
// (génération fonctionne connecté ET déconnecté)
// ============================================================

describe('🔓 optionalAuth middleware', () => {

  vi.mock('../server/services/claude/index.js', () => ({
    chatIntake:          vi.fn().mockResolvedValue({ response: 'OK', chips: [], extractedData: {}, isReady: false }),
    assemblerPack:        vi.fn(),
    analyzeRequest:      vi.fn(),
    suggestDestinations: vi.fn().mockResolvedValue({ destinations: [] }),
    chatModify:          vi.fn(),
  }));

  it('200 sur /api/ai/onboarding SANS token (optionalAuth ne bloque pas)', async () => {
    const res = await request(app)
      .post('/api/ai/onboarding')
      .send({ userMessage: 'Je veux aller à Lisbonne', currentData: {} });

    expect(res.status).toBe(200);
  });

  it('200 sur /api/ai/onboarding AVEC token valide', async () => {
    const validToken = jwt.sign(TEST_USER, process.env.JWT_SECRET as string, { expiresIn: '1d' });

    const res = await request(app)
      .post('/api/ai/onboarding')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ userMessage: 'Je veux aller à Lisbonne', currentData: {} });

    expect(res.status).toBe(200);
  });

  it('200 sur /api/ai/onboarding même avec token expiré (optionalAuth silencieux)', async () => {
    const expiredToken = jwt.sign(TEST_USER, process.env.JWT_SECRET as string, { expiresIn: -1 });

    const res = await request(app)
      .post('/api/ai/onboarding')
      .set('Authorization', `Bearer ${expiredToken}`)
      .send({ userMessage: 'Voyage à Rome', currentData: {} });

    // optionalAuth ignore les tokens invalides sans bloquer
    expect(res.status).toBe(200);
  });
});
