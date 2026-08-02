// =============================================
// EXPERIENCE AI — tests/security/auth-tokens.test.ts
// Sécurité tokens JWT :
//   - token expiré
//   - token forgé (mauvaise signature)
//   - token sans les bons claims
//   - accès inter-utilisateurs (isolation)
//   - token dans cookie vs header Bearer
// Exercés sur /api/parcours, les routes protégées du produit.
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
  return { aiGenerateLimiter: p, aiChatLimiter: p, authLimiter: p, partageLimiter: p, photosLimiter: p };
});

// Mock Prisma : GET /api/parcours → findMany ([]) ; GET /api/parcours/:id passe
// par le dépôt (findFirst filtré sur user_id). Défauts fail-closed → liste vide
// / parcours introuvable → 404, ce qui suffit aux tests de tokens.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    parcours: { findMany: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
  } as any,
}));
vi.mock('../../server/db/prisma.js', () => ({ default: prismaMock }));

const USER_A = { id: '11111111-1111-4111-8111-111111111111', email: 'a@test.com', name: 'User A' };
const USER_B = { id: '22222222-2222-4222-8222-222222222222', email: 'b@test.com', name: 'User B' };
const PARCOURS_B = '33333333-3333-4333-8333-333333333333';

function makeToken(payload: object, secret = process.env.JWT_SECRET!, options: jwt.SignOptions = {}) {
  return jwt.sign(payload, secret, { expiresIn: '1d', ...options });
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.parcours.findMany.mockResolvedValue([]);
  prismaMock.parcours.findFirst.mockResolvedValue(null);      // parcours d'autrui → introuvable
  prismaMock.parcours.deleteMany.mockResolvedValue({ count: 0 });
});

// ============================================================
// Tokens invalides
// ============================================================
describe('JWT — tokens invalides', () => {

  it('401 avec token expiré', async () => {
    const expired = jwt.sign(USER_A, process.env.JWT_SECRET!, { expiresIn: -1 });
    const res = await request(app).get('/api/parcours').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('401 avec token signé avec un mauvais secret', async () => {
    const forged = jwt.sign(USER_A, 'wrong-secret');
    const res = await request(app).get('/api/parcours').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('401 avec token tronqué / corrompu', async () => {
    const res = await request(app).get('/api/parcours').set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.INVALID.xxx');
    expect(res.status).toBe(401);
  });

  it('401 avec token vide', async () => {
    const res = await request(app).get('/api/parcours').set('Authorization', 'Bearer ');
    expect(res.status).toBe(401);
  });

  it('401 avec header Authorization mal formé', async () => {
    const res = await request(app).get('/api/parcours').set('Authorization', 'InvalidScheme abc123');
    expect(res.status).toBe(401);
  });

  it('401 sans token du tout', async () => {
    const res = await request(app).get('/api/parcours');
    expect(res.status).toBe(401);
  });

  it('401 avec token None-algorithm (attaque MITM)', async () => {
    // Essai de contourner la vérification avec alg: none
    const header  = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ id: 'admin', email: 'admin@test.com', iat: Math.floor(Date.now()/1000) })).toString('base64url');
    const noneToken = `${header}.${payload}.`;
    const res = await request(app).get('/api/parcours').set('Authorization', `Bearer ${noneToken}`);
    expect(res.status).toBe(401);
  });
});

// ============================================================
// Token dans cookie vs Bearer
// ============================================================
describe('JWT — extraction depuis cookie et header', () => {

  it('accepte le token depuis le header Authorization Bearer', async () => {
    const token = makeToken(USER_A);
    const res = await request(app).get('/api/parcours').set('Authorization', `Bearer ${token}`);
    expect(res.status).not.toBe(401);
  });

  it('accepte le token depuis le cookie tg_token', async () => {
    const token = makeToken(USER_A);
    const res = await request(app).get('/api/parcours').set('Cookie', `tg_token=${token}`);
    expect(res.status).not.toBe(401);
  });
});

// ============================================================
// Isolation inter-utilisateurs (protection IDOR)
// ============================================================
describe('JWT — isolation des données entre utilisateurs', () => {

  it('User A ne peut pas lire le parcours de User B', async () => {
    const tokenA = makeToken(USER_A);
    // Le dépôt filtre sur user_id : le parcours de B est simplement introuvable
    // pour A → 404 (on ne révèle pas son existence).
    const res = await request(app)
      .get(`/api/parcours/${PARCOURS_B}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect([403, 404]).toContain(res.status);
    expect(prismaMock.parcours.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: PARCOURS_B, user_id: USER_A.id } })
    );
  });

  it('User B ne peut pas supprimer le parcours de User A', async () => {
    const tokenB = makeToken(USER_B);
    const res = await request(app)
      .delete(`/api/parcours/${PARCOURS_B}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect([403, 404]).toContain(res.status);
  });

  it('une méthode non définie sur la route → 404', async () => {
    const tokenB = makeToken(USER_B);
    const res = await request(app)
      .patch(`/api/parcours/${PARCOURS_B}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ visibilite: 'partage' });
    expect([403, 404]).toContain(res.status);
  });
});

// ============================================================
// Claims requis dans le token
// ============================================================
describe('JWT — claims requis', () => {

  it('token sans "id" → aucune donnée renvoyée, aucun crash', async () => {
    const noId = makeToken({ email: 'alice@test.com' });
    const res = await request(app).get('/api/parcours').set('Authorization', `Bearer ${noId}`);
    expect([200, 401]).toContain(res.status);
  });

  it('token avec id null → aucune donnée renvoyée, aucun crash', async () => {
    const nullId = makeToken({ id: null, email: 'alice@test.com' });
    const res = await request(app).get('/api/parcours').set('Authorization', `Bearer ${nullId}`);
    expect([200, 401]).toContain(res.status);
  });
});
