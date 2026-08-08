import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret-for-vitest';

vi.mock('express-rate-limit', () => ({
  default: () => (_: unknown, __: unknown, next: () => void) => next(),
  rateLimit: () => (_: unknown, __: unknown, next: () => void) => next(),
}));
vi.mock('../../server/middleware/limiter.js', () => {
  const passer = (_: unknown, __: unknown, next: () => void) => next();
  return { aiGenerateLimiter: passer, aiChatLimiter: passer, authLimiter: passer, partageLimiter: passer, photosLimiter: passer };
});

const { rechercherEvenementsPredictHQEventFirst } = vi.hoisted(() => ({
  rechercherEvenementsPredictHQEventFirst: vi.fn(),
}));
vi.mock('../../server/services/predictHQ.js', () => ({
  rechercherEvenementsPredictHQEventFirst,
}));
vi.mock('../../server/services/claude/core.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/claude/core.js')>();
  return { ...reel, callAI: vi.fn(), callAIAvecOutils: vi.fn() };
});
vi.mock('../../server/services/liens.js', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../../server/services/liens.js')>();
  return { ...reel, resoudreLien: vi.fn(), resoudreLiensReels: vi.fn() };
});

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    parcours: { upsert: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    preferenceParcours: { findUnique: vi.fn().mockResolvedValue(null) },
  } as any,
}));
vi.mock('../../server/db/prisma.js', () => ({ default: prismaMock }));

const app = (await import('../../server/index.js')).default;
const { callAIAvecOutils } = await import('../../server/services/claude/core.js');
const { resoudreLien } = await import('../../server/services/liens.js');

const UTILISATEUR = { id: '11111111-1111-4111-8111-111111111111', email: 'hugo@test.com', name: 'Hugo' };
const TOKEN = jwt.sign(UTILISATEUR, process.env.JWT_SECRET, { expiresIn: '1d' });

function evenement(identifiantExterne: string, ville: string, dateDebut: string) {
  return {
    identifiantExterne,
    nom: `Match réel ${identifiantExterne}`,
    ville,
    codePays: 'US',
    dateDebut,
    dateFin: dateDebut.replace('00:30:00.000Z', '03:00:00.000Z'),
    salle: `Salle ${ville}`,
    categorieFournisseur: 'sports',
    fournisseur: 'PredictHQ' as const,
    source: 'https://api.predicthq.com/v1/events/',
    recupereLe: '2026-08-08T12:00:00.000Z',
  };
}

describe('POST /api/parcours — NBA event-first de bout en bout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.preferenceParcours.findUnique.mockResolvedValue(null);
    prismaMock.parcours.upsert.mockResolvedValue({});
    rechercherEvenementsPredictHQEventFirst.mockResolvedValue({
      statut: 'ok',
      recupereLe: '2026-08-08T12:00:00.000Z',
      resultats: [
        evenement('evt-boston', 'Boston', '2027-01-18T00:30:00.000Z'),
        evenement('evt-new-york', 'New York', '2027-01-25T00:30:00.000Z'),
        evenement('evt-chicago', 'Chicago', '2027-02-02T00:30:00.000Z'),
      ],
    });
    vi.mocked(callAIAvecOutils).mockResolvedValue(JSON.stringify({
      moments: [{
        titre: 'Temps libre',
        elements: [{
          ref: 'temps-libre',
          type: 'temps_libre',
          nom: 'Temps libre',
          justification: 'Respirer entre les matchs.',
        }],
      }],
    }));
    vi.mocked(resoudreLien).mockResolvedValue({ statut: 'vide' } as never);
  });

  it('persiste une seule fois un parcours multi-ville avec les trois ancres réelles', async () => {
    const res = await request(app)
      .post('/api/parcours')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        brief: {
          intention: 'Vivre la NBA et voir des matchs en direct',
          avecQui: 'amis',
          duree: { valeur: 3, unite: 'semaines' },
          dates: { debut: '2027-01-15T00:00:00.000Z', fin: '2027-02-10T23:59:59.999Z' },
          contraintes: ['aux États-Unis'],
          lieux: [],
        },
      });

    expect(res.status).toBe(201);
    expect(rechercherEvenementsPredictHQEventFirst).toHaveBeenCalledOnce();
    expect(res.body.parcours.contexte.lieux).toEqual(['Boston', 'New York', 'Chicago']);
    const evenements = res.body.parcours.timeline.flatMap((moment: { elements: unknown[] }) =>
      moment.elements.filter((element: { type: string }) => element.type === 'evenement')
    );
    expect(evenements.map((element: { nom: string }) => element.nom)).toEqual([
      'Match réel evt-boston',
      'Match réel evt-new-york',
      'Match réel evt-chicago',
    ]);
    expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(1);
  });

  it('refuse le benchmark NBA septembre/octobre vide sans générer ni persister', async () => {
    rechercherEvenementsPredictHQEventFirst.mockResolvedValueOnce({
      statut: 'vide', resultats: [], recupereLe: '2026-08-08T12:00:00.000Z',
    });

    const res = await request(app)
      .post('/api/parcours')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        brief: {
          intention: 'Voir des matchs NBA en direct',
          avecQui: 'amis',
          duree: { valeur: 3, unite: 'semaines' },
          dates: { debut: '2026-09-15T00:00:00.000Z', fin: '2026-10-11T23:59:59.999Z' },
          lieux: [],
        },
      });

    expect(res.status).toBe(422);
    expect(callAIAvecOutils).not.toHaveBeenCalled();
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });

  it('propage l’indisponibilité PredictHQ en 503 sans générer ni persister', async () => {
    rechercherEvenementsPredictHQEventFirst.mockResolvedValueOnce({
      statut: 'indisponible', fournisseur: 'PredictHQ', raison: 'reseau',
    });

    const res = await request(app)
      .post('/api/parcours')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        brief: {
          intention: 'Vivre la NBA',
          avecQui: 'amis',
          duree: { valeur: 3, unite: 'semaines' },
          dates: { debut: '2027-01-15T00:00:00.000Z', fin: '2027-02-10T23:59:59.999Z' },
          lieux: [],
        },
      });

    expect(res.status).toBe(503);
    expect(callAIAvecOutils).not.toHaveBeenCalled();
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });

  it('conserve 502 pour une prose LLM hors contrat, sans la convertir en clarification', async () => {
    vi.mocked(callAIAvecOutils).mockResolvedValueOnce('Je dois connaître une ville avant de continuer.');

    const res = await request(app)
      .post('/api/parcours')
      .set('Authorization', `Bearer ${TOKEN}`)
      .send({
        brief: {
          intention: 'Vivre la NBA',
          avecQui: 'amis',
          duree: { valeur: 3, unite: 'semaines' },
          dates: { debut: '2027-01-15T00:00:00.000Z', fin: '2027-02-10T23:59:59.999Z' },
          lieux: [],
        },
      });

    expect(res.status).toBe(502);
    expect(res.body.type).toBeUndefined();
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });
});
