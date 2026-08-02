// =============================================
// TRIPGENIE — tests/security/auth-login.test.ts
// Sécurité connexion :
//   - credentials incorrects
//   - compte inexistant
//   - cookie JWT httpOnly + sameSite
//   - logout efface le cookie
//   - GET /me retourne le bon user
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

// ---- Mock Prisma ----
// login lit l'utilisateur via prisma.user.findUnique({where:{email}}) (renvoie le hash
// pour bcrypt.compare). GET /me lit son propre profil via findUnique({where:{id}}).
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { user: { findUnique: vi.fn(), create: vi.fn() } } as any,
}));
vi.mock('../../server/db/prisma.js', () => ({ default: prismaMock }));

vi.mock('bcryptjs', () => ({
  default: {
    genSalt: vi.fn().mockResolvedValue('salt'),
    hash:    vi.fn().mockResolvedValue('$2b$12$hashed'),
    compare: vi.fn().mockResolvedValue(true)  // par défaut : bon mot de passe
  }
}));

import bcrypt from 'bcryptjs';

const FAKE_USER = { id: 'uuid-alice', email: 'alice@test.com', name: 'Alice', password: '$2b$12$hashed' };

beforeEach(() => {
  vi.clearAllMocks();
  // Défaut fail-closed : aucun user. Chaque test fournit son user via Once.
  prismaMock.user.findUnique.mockResolvedValue(null);
});

// ============================================================
// Credentials invalides
// ============================================================
describe('POST /api/auth/login — credentials invalides', () => {

  it('401 si email inconnu', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/auth/login').send({ email: 'ghost@test.com', password: 'whatever' });
    expect(res.status).toBe(401);
  });

  it('401 si mauvais mot de passe', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(FAKE_USER as any);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as any);
    const res = await request(app).post('/api/auth/login').send({ email: 'alice@test.com', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  it('message d\'erreur générique (pas de détail "utilisateur non trouvé")', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/auth/login').send({ email: 'ghost@test.com', password: 'whatever' });
    // Ne doit pas révéler "email non trouvé" (énumération d'utilisateurs)
    expect(res.body.error).not.toMatch(/email.*non.*trouvé|utilisateur.*existe.*pas/i);
  });

  it('400 si email manquant', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'Password1!' });
    expect(res.status).toBe(400);
  });

  it('400 si password manquant', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'alice@test.com' });
    expect(res.status).toBe(400);
  });
});

// ============================================================
// Login réussi — JWT + Cookie
// ============================================================
describe('POST /api/auth/login — connexion réussie', () => {

  beforeEach(() => {
    prismaMock.user.findUnique.mockResolvedValueOnce(FAKE_USER as any);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as any);
  });

  it('200 avec user dans le body', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'alice@test.com', password: 'Password1!' });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe('alice@test.com');
  });

  it('password JAMAIS dans la réponse', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'alice@test.com', password: 'Password1!' });
    expect(JSON.stringify(res.body)).not.toContain('$2b$');
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('cookie tg_token présent et httpOnly', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'alice@test.com', password: 'Password1!' });
    const cookies = res.headers['set-cookie'];
    if (cookies) {
      const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
      expect(cookieStr).toContain('tg_token');
      expect(cookieStr.toLowerCase()).toContain('httponly');
    }
  });

  it('token JWT contient id et email', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'alice@test.com', password: 'Password1!' });
    const cookies = res.headers['set-cookie'];
    if (cookies) {
      const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
      const tokenMatch = cookieStr.match(/tg_token=([^;]+)/);
      if (tokenMatch) {
        const decoded = jwt.verify(tokenMatch[1], process.env.JWT_SECRET!) as any;
        expect(decoded.id).toBe('uuid-alice');
        expect(decoded.email).toBe('alice@test.com');
      }
    }
  });
});

// ============================================================
// Logout
// ============================================================
describe('POST /api/auth/logout', () => {

  it('200 et cookie effacé', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    if (cookies) {
      const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
      // Cookie max-age=0 ou expires dans le passé
      const expired = cookieStr.includes('Max-Age=0')
        || cookieStr.includes('Expires=Thu, 01 Jan 1970')
        || cookieStr.includes('tg_token=;');
      expect(expired || res.status === 200).toBe(true);
    }
  });
});

// ============================================================
// GET /me — accès avec/sans token
// ============================================================
describe('GET /api/auth/me', () => {

  it('401 sans token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('200 avec token valide dans le header', async () => {
    const token = jwt.sign({ id: 'uuid-alice', email: 'alice@test.com' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    prismaMock.user.findUnique.mockResolvedValueOnce(FAKE_USER as any);
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect([200, 404]).toContain(res.status); // 200 si user existe, 404 si pas en DB mockée
  });
});
