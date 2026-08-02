// =============================================
// EXPERIENCE AI — tests/unit/parcoursGenerationRoute.test.ts
// F9 : POST /api/parcours ne doit persister QUE si genererParcours réussit.
// Un refus (422), une panne technique (503) ou une sortie inexploitable (502)
// ne doivent produire aucune écriture — vérifié ici au niveau de la route
// HTTP, pas seulement par construction du code. On mocke genererParcours et
// le dépôt Prisma ; aucun réseau réel, aucun appel IA ou fournisseur.
// =============================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../server/index.js';
import { AppError } from '../../server/lib/AppError.js';
import { ParcoursSchema, type Parcours } from '../../server/domaine/parcours/index.js';

process.env.JWT_SECRET = 'test-secret-for-vitest';

const UTILISATEUR = { id: '11111111-1111-4111-8111-111111111111', email: 'hugo@test.com', name: 'Hugo' };
const TOKEN = jwt.sign(UTILISATEUR, process.env.JWT_SECRET, { expiresIn: '1d' });
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${TOKEN}`);

vi.mock('express-rate-limit', () => ({
  default: () => (_: any, __: any, next: any) => next(),
  rateLimit: () => (_: any, __: any, next: any) => next(),
}));
vi.mock('../../server/middleware/limiter.js', () => {
  const p = (_: any, __: any, n: any) => n();
  return { aiGenerateLimiter: p, aiChatLimiter: p, authLimiter: p, partageLimiter: p };
});

const { genererParcours } = vi.hoisted(() => ({ genererParcours: vi.fn() }));
vi.mock('../../server/agents/generation.js', () => ({ genererParcours }));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    parcours: { upsert: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    preferenceParcours: { findUnique: vi.fn().mockResolvedValue(null) },
  } as any,
}));
vi.mock('../../server/db/prisma.js', () => ({ default: prismaMock }));

function parcoursDeTest(): Parcours {
  return ParcoursSchema.parse({
    id: '44444444-4444-4444-8444-444444444444',
    intention: { texte: "fêter l'EVG de Max" },
    contexte: { avecQui: 'amis', duree: { valeur: 2, unite: 'jours' } },
    participants: [{ id: UTILISATEUR.id, nom: 'Hugo', role: 'organisateur' }],
    budget: { mode: 'individuel' },
    timeline: [
      {
        id: 'm1',
        titre: 'Samedi',
        elements: [{ id: 'e1', type: 'activite', nom: 'Karting', justification: 'Max adore la vitesse' }],
      },
    ],
  });
}

const BRIEF = {
  intention: "fêter l'EVG de Max",
  avecQui: 'amis',
  duree: { valeur: 2, unite: 'jours' },
};

describe('POST /api/parcours — F9, aucune écriture sans génération réussie', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.preferenceParcours.findUnique.mockResolvedValue(null);
    prismaMock.parcours.findUnique.mockResolvedValue(null);
  });

  it('génération réussie : une seule écriture, 201', async () => {
    genererParcours.mockResolvedValue(parcoursDeTest());
    prismaMock.parcours.upsert.mockResolvedValue({});

    const res = await auth(request(app).post('/api/parcours')).send({ brief: BRIEF });

    expect(res.status).toBe(201);
    expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(1);
  });

  it('refus métier (donnée essentielle manquante) : 422, aucune écriture', async () => {
    genererParcours.mockRejectedValue(new AppError('Impossible sans dates fermes', 422));

    const res = await auth(request(app).post('/api/parcours')).send({ brief: BRIEF });

    expect(res.status).toBe(422);
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });

  it('panne technique (fournisseur essentiel indisponible) : 503, aucune écriture', async () => {
    genererParcours.mockRejectedValue(new AppError('Recherche essentielle indisponible', 503));

    const res = await auth(request(app).post('/api/parcours')).send({ brief: BRIEF });

    expect(res.status).toBe(503);
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });

  it('sortie IA inexploitable : 502, aucune écriture', async () => {
    genererParcours.mockRejectedValue(new AppError('Sortie inexploitable', 502));

    const res = await auth(request(app).post('/api/parcours')).send({ brief: BRIEF });

    expect(res.status).toBe(502);
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });

  it('parcours généré mais invalide au schéma final : aucune écriture, jamais un succès masqué', async () => {
    genererParcours.mockResolvedValue({ id: 'x' } as unknown as Parcours);

    const res = await auth(request(app).post('/api/parcours')).send({ brief: BRIEF });

    expect(res.status).not.toBe(201);
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });
});
