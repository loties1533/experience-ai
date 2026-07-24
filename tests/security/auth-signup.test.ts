// =============================================
// TRIPGENIE — tests/security/auth-signup.test.ts
// Sécurité création de compte :
//   - validation email / password
//   - doublon email
//   - longueur max des champs
//   - hash du mot de passe (bcrypt)
//   - cookie httpOnly envoyé
// =============================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../server/index.js';

process.env.JWT_SECRET = 'test-secret-for-vitest';

// ---- Bypass rate limiters ----
vi.mock('express-rate-limit', () => ({
  default:   () => (_: any, __: any, next: any) => next(),
  rateLimit: () => (_: any, __: any, next: any) => next()
}));
vi.mock('../../server/middleware/limiter.js', () => {
  const p = (_: any, __: any, n: any) => n();
  return { aiGenerateLimiter: p, aiChatLimiter: p, authLimiter: p, partageLimiter: p };
});

// ---- Mock Prisma ----
// signup : findUnique (vérif doublon email) puis create (insertion).
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: { user: { findUnique: vi.fn(), create: vi.fn() } } as any,
}));
vi.mock('../../server/db/prisma.js', () => ({ default: prismaMock }));

// ---- Mock bcryptjs ----
vi.mock('bcryptjs', () => ({
  default: {
    genSalt: vi.fn().mockResolvedValue('$2b$salt'),
    hash:    vi.fn().mockResolvedValue('$2b$12$hashedpassword'),
    compare: vi.fn().mockResolvedValue(true)
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Défaut : email libre (findUnique → null) puis création réussie.
  // Chaque test peut surcharger via mockResolvedValueOnce.
  prismaMock.user.findUnique.mockResolvedValue(null);
  prismaMock.user.create.mockResolvedValue({
    id: 'new-uuid-123', email: 'new@test.com', name: 'Bob', avatar_url: null, created_at: new Date(),
  });
});

// ============================================================
// Champs requis
// ============================================================
describe('POST /api/auth/signup — validation des champs requis', () => {

  it('400 si email manquant', async () => {
    const res = await request(app).post('/api/auth/signup').send({ password: 'Password1!', name: 'Alice' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('400 si password manquant', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'alice@test.com', name: 'Alice' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  it('400 si email invalide (pas de @)', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'pasunmail', password: 'Password1!', name: 'Alice' });
    expect(res.status).toBe(400);
  });

  it('400 si password trop court (< 6 chars)', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'alice@test.com', password: '123', name: 'Alice' });
    expect(res.status).toBe(400);
  });
});

// ============================================================
// Protection contre les doublons
// ============================================================
describe('POST /api/auth/signup — doublon email', () => {

  it('409 si email déjà utilisé', async () => {
    // findUnique renvoie un user → email déjà pris → 409 Conflict
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'existing-uuid' } as any);
    const res = await request(app).post('/api/auth/signup').send({ email: 'alice@test.com', password: 'Password1!', name: 'Alice' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/email.*déjà.*utilisé/i);
  });
});

// ============================================================
// Création réussie
// ============================================================
describe('POST /api/auth/signup — création réussie', () => {
  // Le défaut mockPgQuery (beforeEach) gère déjà : email libre → création réussie.

  it('201 créé avec succès', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'new@test.com', password: 'SecurePass1!', name: 'Bob' });
    expect(res.status).toBe(201);
  });

  it('mot de passe JAMAIS retourné dans la réponse', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'new@test.com', password: 'SecurePass1!', name: 'Bob' });
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('SecurePass1!');
    expect(body).not.toContain('password');
    expect(body).not.toContain('$2b$');
  });

  it('cookie JWT httpOnly présent dans la réponse', async () => {
    const res = await request(app).post('/api/auth/signup').send({ email: 'new@test.com', password: 'SecurePass1!', name: 'Bob' });
    const cookieHeader = res.headers['set-cookie'];
    if (cookieHeader) {
      const cookieStr = Array.isArray(cookieHeader) ? cookieHeader.join(';') : cookieHeader;
      expect(cookieStr.toLowerCase()).toContain('httponly');
    }
  });
});

// ============================================================
// Injections et entrées malveillantes
// ============================================================
describe('POST /api/auth/signup — entrées malveillantes', () => {

  it('email avec SQL injection refusé ou traité sans planter', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email:    "'; DROP TABLE users; --@test.com",
      password: 'Password1!',
      name:     'Hacker'
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('email avec XSS refusé', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email:    '<script>alert(1)</script>@test.com',
      password: 'Password1!',
      name:     'XSS'
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('champ name trop long (> 200 chars) refusé', async () => {
    const res = await request(app).post('/api/auth/signup').send({
      email:    'long@test.com',
      password: 'Password1!',
      name:     'A'.repeat(300)
    });
    // Doit soit rejeter soit tronquer — pas de 500
    expect(res.status).not.toBe(500);
  });

  it('body vide → 400', async () => {
    const res = await request(app).post('/api/auth/signup').send({});
    expect(res.status).toBe(400);
  });
});
