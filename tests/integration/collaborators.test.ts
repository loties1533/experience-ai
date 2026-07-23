// =============================================
// TRIPGENIE — tests/integration/collaborators.test.ts
// Route collaborateurs (relation many-to-many trips ↔ users) :
//   - auth requise (401 sans token)
//   - propriété du voyage vérifiée avant toute action (404 sinon)
//   - POST : email valide, utilisateur existant, pas d'auto-invitation
//   - DELETE : retrait d'un collaborateur
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

// Mock Prisma : propriété via trip.findFirst, recherche cible via user.findUnique,
// liste/ajout/retrait via tripCollaborator.{findMany,upsert,deleteMany}.
// findMany renvoie le user imbriqué (relation), ré-emboîté en users:{} par la route.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    trip: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    tripCollaborator: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  } as any,
}));
vi.mock('../../server/db/prisma.js', () => ({ default: prismaMock }));

const OWNER = { id: 'owner-uuid', email: 'owner@test.com', name: 'Owner' };
const token = jwt.sign(OWNER, process.env.JWT_SECRET!, { expiresIn: '1d' });
const auth  = (r: any) => r.set('Authorization', `Bearer ${token}`);
const TRIP  = 'trip-123';

beforeEach(() => {
  vi.clearAllMocks();
  // Défaut fail-closed : voyage non possédé (→ 404). Chaque test fournit ses données via Once.
  prismaMock.trip.findFirst.mockResolvedValue(null);
});

// ============================================================
// GET /api/trips/:id/collaborators
// ============================================================
describe('GET /api/trips/:id/collaborators', () => {

  it('401 sans token', async () => {
    const res = await request(app).get(`/api/trips/${TRIP}/collaborators`);
    expect(res.status).toBe(401);
  });

  it('404 si le voyage n\'appartient pas à l\'utilisateur', async () => {
    prismaMock.trip.findFirst.mockResolvedValueOnce(null); // propriété : null → 404
    const res = await auth(request(app).get(`/api/trips/${TRIP}/collaborators`));
    expect(res.status).toBe(404);
  });

  it('liste les collaborateurs du voyage', async () => {
    prismaMock.trip.findFirst.mockResolvedValueOnce({ id: TRIP } as any);  // 1) propriété OK
    // 2) findMany renvoie le user imbriqué (relation Prisma), ré-emboîté sous users:{}
    prismaMock.tripCollaborator.findMany.mockResolvedValueOnce([
      { user_id: 'u2', role: 'viewer', invited_at: '2026-01-01', user: { name: 'Bob', email: 'bob@test.com' } },
    ] as any);
    const res = await auth(request(app).get(`/api/trips/${TRIP}/collaborators`));
    expect(res.status).toBe(200);
    expect(res.body.collaborators).toHaveLength(1);
    expect(res.body.collaborators[0].role).toBe('viewer');
    expect(res.body.collaborators[0].users.email).toBe('bob@test.com');
  });
});

// ============================================================
// POST /api/trips/:id/collaborators
// ============================================================
describe('POST /api/trips/:id/collaborators', () => {

  it('401 sans token', async () => {
    const res = await request(app).post(`/api/trips/${TRIP}/collaborators`).send({ email: 'bob@test.com' });
    expect(res.status).toBe(401);
  });

  it('400 si email invalide', async () => {
    const res = await auth(request(app).post(`/api/trips/${TRIP}/collaborators`)).send({ email: 'pas-un-email' });
    expect(res.status).toBe(400);
  });

  it('404 si le voyage n\'appartient pas à l\'utilisateur', async () => {
    prismaMock.trip.findFirst.mockResolvedValueOnce(null); // propriété : null → 404
    const res = await auth(request(app).post(`/api/trips/${TRIP}/collaborators`)).send({ email: 'bob@test.com' });
    expect(res.status).toBe(404);
  });

  it('404 si l\'utilisateur invité n\'existe pas', async () => {
    prismaMock.trip.findFirst.mockResolvedValueOnce({ id: TRIP } as any);  // 1) propriété OK
    prismaMock.user.findUnique.mockResolvedValueOnce(null);               // 2) cible inexistante → 404
    const res = await auth(request(app).post(`/api/trips/${TRIP}/collaborators`)).send({ email: 'ghost@test.com' });
    expect(res.status).toBe(404);
  });

  it('400 si l\'on tente de s\'inviter soi-même', async () => {
    prismaMock.trip.findFirst.mockResolvedValueOnce({ id: TRIP } as any);                                       // 1) propriété OK
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: OWNER.id, name: OWNER.name, email: OWNER.email } as any); // 2) cible = soi-même
    const res = await auth(request(app).post(`/api/trips/${TRIP}/collaborators`)).send({ email: OWNER.email });
    expect(res.status).toBe(400);
  });

  it('201 invite un collaborateur valide (rôle editor)', async () => {
    prismaMock.trip.findFirst.mockResolvedValueOnce({ id: TRIP } as any);                                            // 1) propriété OK
    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'bob-uuid', name: 'Bob', email: 'bob@test.com' } as any); // 2) user trouvé
    prismaMock.tripCollaborator.upsert.mockResolvedValueOnce({ trip_id: TRIP, user_id: 'bob-uuid', role: 'editor' } as any); // 3) upsert
    const res = await auth(request(app).post(`/api/trips/${TRIP}/collaborators`)).send({ email: 'bob@test.com', role: 'editor' });
    expect(res.status).toBe(201);
    expect(res.body.collaborator.role).toBe('editor');
    expect(res.body.user.email).toBe('bob@test.com');
    expect(prismaMock.tripCollaborator.upsert).toHaveBeenCalled();
  });
});

// ============================================================
// DELETE /api/trips/:id/collaborators/:user_id
// ============================================================
describe('DELETE /api/trips/:id/collaborators/:user_id', () => {

  it('401 sans token', async () => {
    const res = await request(app).delete(`/api/trips/${TRIP}/collaborators/bob-uuid`);
    expect(res.status).toBe(401);
  });

  it('404 si le voyage n\'appartient pas à l\'utilisateur', async () => {
    prismaMock.trip.findFirst.mockResolvedValueOnce(null); // propriété : null → 404
    const res = await auth(request(app).delete(`/api/trips/${TRIP}/collaborators/bob-uuid`));
    expect(res.status).toBe(404);
  });

  it('200 retire le collaborateur', async () => {
    // Transaction : propriété OK → DELETE du collaborateur
    prismaMock.trip.findFirst.mockResolvedValueOnce({ id: TRIP } as any);   // 1) propriété OK
    prismaMock.tripCollaborator.deleteMany.mockResolvedValueOnce({ count: 1 } as any); // 2) DELETE
    const res = await auth(request(app).delete(`/api/trips/${TRIP}/collaborators/bob-uuid`));
    expect(res.status).toBe(200);
    expect(prismaMock.tripCollaborator.deleteMany).toHaveBeenCalled();
  });
});
