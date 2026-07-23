// =============================================
// EXPERIENCE AI — tests/middleware.test.ts
// Tests du middleware d'authentification JWT (requireAuth), exercé sur
// /api/parcours — les routes protégées du produit depuis la refonte.
// =============================================

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../server/index.js';

process.env.JWT_SECRET = 'test-jwt-secret-for-vitest';

const TEST_USER = { id: 'aabbccdd-0000-0000-0000-aabbccddee00', email: 'pilot@experience.test', name: 'Test Pilot' };

// ---- Mocks ----
vi.mock('express-rate-limit', () => ({
  default:   () => (_req: any, _res: any, next: any) => next(),
  rateLimit: () => (_req: any, _res: any, next: any) => next()
}));

vi.mock('../server/middleware/limiter.js', () => {
  const passthrough = (_req: any, _res: any, next: any) => next();
  return { aiGenerateLimiter: passthrough, aiChatLimiter: passthrough, authLimiter: passthrough };
});

// Mock Prisma : GET /api/parcours passe par le dépôt → prisma.parcours.findMany.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { parcours: { findMany: vi.fn(), findFirst: vi.fn() } } as any,
}));
vi.mock('../server/db/prisma.js', () => ({ default: prismaMock }));
prismaMock.parcours.findMany.mockResolvedValue([]);
prismaMock.parcours.findFirst.mockResolvedValue(null);

// ============================================================
// requireAuth — routes protégées (/api/parcours nécessite auth)
// ============================================================

describe('requireAuth — accès aux routes protégées', () => {

  it('401 si aucun token fourni', async () => {
    const res = await request(app).get('/api/parcours');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/manquant|invalide/i);
  });

  it('401 si token JWT expiré', async () => {
    const expiredToken = jwt.sign(TEST_USER, process.env.JWT_SECRET as string, { expiresIn: -1 });

    const res = await request(app)
      .get('/api/parcours')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expir/i);
  });

  it('401 si token JWT malformé (chaîne aléatoire)', async () => {
    const res = await request(app)
      .get('/api/parcours')
      .set('Authorization', 'Bearer ceci.nest.pas.un.jwt');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalide/i);
  });

  it('401 si token signé avec le mauvais secret', async () => {
    const wrongToken = jwt.sign(TEST_USER, 'mauvais-secret', { expiresIn: '1d' });

    const res = await request(app)
      .get('/api/parcours')
      .set('Authorization', `Bearer ${wrongToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalide/i);
  });

  it('200 si token Bearer valide', async () => {
    const validToken = jwt.sign(TEST_USER, process.env.JWT_SECRET as string, { expiresIn: '1d' });

    const res = await request(app)
      .get('/api/parcours')
      .set('Authorization', `Bearer ${validToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.parcours)).toBe(true);
  });

  it('200 si le token vient du cookie httpOnly', async () => {
    const validToken = jwt.sign(TEST_USER, process.env.JWT_SECRET as string, { expiresIn: '1d' });

    const res = await request(app)
      .get('/api/parcours')
      .set('Cookie', `tg_token=${validToken}`);

    expect(res.status).toBe(200);
  });

  it('le dépôt ne voit que l\'utilisateur du token (isolation)', async () => {
    const validToken = jwt.sign(TEST_USER, process.env.JWT_SECRET as string, { expiresIn: '1d' });
    prismaMock.parcours.findMany.mockClear();

    await request(app).get('/api/parcours').set('Authorization', `Bearer ${validToken}`);

    expect(prismaMock.parcours.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: TEST_USER.id } })
    );
  });
});
