// =============================================
// EXPERIENCE AI — tests/unit/parcoursGenerationRoute.test.ts
// PR1 : POST /api/parcours ne persiste QUE si le cadrage est planifiable puis
// si genererParcours réussit.
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
  return { aiGenerateLimiter: p, aiChatLimiter: p, authLimiter: p, partageLimiter: p, photosLimiter: p };
});

const { genererParcours } = vi.hoisted(() => ({ genererParcours: vi.fn() }));
vi.mock('../../server/agents/generation.js', () => ({ genererParcours }));

const { preparerGeneration } = vi.hoisted(() => ({ preparerGeneration: vi.fn() }));
vi.mock('../../server/agents/generation/preparation.js', () => ({ preparerGeneration }));

const { avancerDialogue } = vi.hoisted(() => ({ avancerDialogue: vi.fn() }));
vi.mock('../../server/agents/intake.js', () => ({ avancerDialogue }));

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

const CONTEXTE_SANS_LOCALISATION = {
  strategie: 'compatibilite_sans_localisation' as const,
  etapes: [{ ancres: [] }],
  contraintesConservees: {},
};

describe('POST /api/parcours — F9, aucune écriture sans génération réussie', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    preparerGeneration.mockReturnValue({
      type: 'planifiable',
      contexte: CONTEXTE_SANS_LOCALISATION,
    });
    prismaMock.preferenceParcours.findUnique.mockResolvedValue(null);
    prismaMock.parcours.findUnique.mockResolvedValue(null);
  });

  it('génération réussie : une seule écriture, 201', async () => {
    genererParcours.mockResolvedValue(parcoursDeTest());
    prismaMock.parcours.upsert.mockResolvedValue({});

    const res = await auth(request(app).post('/api/parcours')).send({ brief: BRIEF });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe('parcours_cree');
    expect(genererParcours).toHaveBeenCalledWith(
      expect.any(Object),
      null,
      {},
      CONTEXTE_SANS_LOCALISATION
    );
    expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(1);
  });

  it('clarification requise : 200 structuré, sans lot ni persistance', async () => {
    preparerGeneration.mockReturnValue({
      type: 'clarification_requise',
      clarification: {
        code: 'zone_geographique_requise',
        question: 'Tu préfères rester en Europe ou aller plus loin ?',
        champCible: 'lieux',
      },
      etatDialogue: {
        champ: 'preparation_generation',
        code: 'zone_geographique_requise',
        champCible: 'lieux',
      },
    });

    const res = await auth(request(app).post('/api/parcours')).send({ brief: BRIEF });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      type: 'clarification_requise',
      clarification: { code: 'zone_geographique_requise', champCible: 'lieux' },
      etatDialogue: { champ: 'preparation_generation' },
    });
    expect(genererParcours).not.toHaveBeenCalled();
    expect(prismaMock.preferenceParcours.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });

  it('refus du cadrage : 422, sans lot ni persistance', async () => {
    preparerGeneration.mockReturnValue({
      type: 'refus',
      refus: {
        code: 'hors_perimetre_produit',
        message: 'Cette demande dépasse le périmètre du produit.',
      },
    });

    const res = await auth(request(app).post('/api/parcours')).send({ brief: BRIEF });

    expect(res.status).toBe(422);
    expect(genererParcours).not.toHaveBeenCalled();
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
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

  it('prose LLM hors contrat : 502, jamais une clarification, aucune écriture', async () => {
    genererParcours.mockRejectedValue(new AppError('Sortie inexploitable', 502));

    const res = await auth(request(app).post('/api/parcours')).send({ brief: BRIEF });

    expect(res.status).toBe(502);
    expect(res.body.type).toBeUndefined();
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });

  it('parcours généré mais invalide au schéma final : aucune écriture, jamais un succès masqué', async () => {
    genererParcours.mockResolvedValue({ id: 'x' } as unknown as Parcours);

    const res = await auth(request(app).post('/api/parcours')).send({ brief: BRIEF });

    expect(res.status).not.toBe(201);
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });

  it('ignore un état de dialogue envoyé par erreur : il n’atteint pas la préparation ni la génération', async () => {
    genererParcours.mockResolvedValue(parcoursDeTest());
    prismaMock.parcours.upsert.mockResolvedValue({});
    const res = await auth(request(app).post('/api/parcours')).send({
      brief: BRIEF,
      etatDialogue: { champ: 'preparation_generation', code: 'zone_geographique_requise', champCible: 'lieux' },
    });

    expect(res.status).toBe(201);
    expect(preparerGeneration.mock.calls[0][0]).not.toHaveProperty('etatDialogue');
    expect(genererParcours.mock.calls[0][0]).not.toHaveProperty('etatDialogue');
  });
});

describe('POST /api/parcours/dialogue — clarification de préparation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepte l’état de préparation et le transmet à l’intake, qui le consomme', async () => {
    const etatDialogue = {
      champ: 'preparation_generation',
      code: 'zone_geographique_requise',
      champCible: 'lieux',
    };
    avancerDialogue.mockResolvedValue({
      brief: { ...BRIEF, lieux: ['Paris'] },
      reponse: 'Parfait, Paris est noté.',
      estComplet: true,
    });

    const res = await auth(request(app).post('/api/parcours/dialogue')).send({
      brief: BRIEF,
      message: 'Paris',
      etatDialogue,
    });

    expect(res.status).toBe(200);
    expect(avancerDialogue).toHaveBeenCalledWith(
      expect.objectContaining(BRIEF),
      'Paris',
      etatDialogue
    );
    expect(res.body.etatDialogue).toBeUndefined();
    expect(res.body.brief.lieux).toEqual(['Paris']);
  });

  it('rejette un état de préparation invalide avant tout appel intake', async () => {
    const res = await auth(request(app).post('/api/parcours/dialogue')).send({
      brief: BRIEF,
      message: 'Paris',
      etatDialogue: {
        champ: 'preparation_generation',
        code: 'zone_geographique_requise',
        champCible: 'dates',
      },
    });

    expect(res.status).toBe(400);
    expect(avancerDialogue).not.toHaveBeenCalled();
  });
});
