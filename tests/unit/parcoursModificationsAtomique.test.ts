// =============================================
// EXPERIENCE AI — tests/unit/parcoursModificationsAtomique.test.ts
// F8-C : POST /:id/modifications doit préparer entièrement en mémoire
// (F8-B, mocké ici) puis persister en UNE SEULE écriture — ou zéro si la
// préparation échoue à n'importe quelle étape. On mocke le dépôt Prisma
// (pour compter les écritures réelles) et F8-B (pour piloter chaque cas),
// jamais de réseau réel.
// =============================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../server/index.js';
import { ParcoursSchema, type Parcours } from '../../server/domaine/parcours/index.js';

process.env.JWT_SECRET = 'test-secret-for-vitest';

const PROPRIETAIRE = { id: '11111111-1111-4111-8111-111111111111', email: 'hugo@test.com', name: 'Hugo' };
const AUTRE = { id: '22222222-2222-4222-8222-222222222222', email: 'curieux@test.com', name: 'Curieux' };
const TOKEN = jwt.sign(PROPRIETAIRE, process.env.JWT_SECRET, { expiresIn: '1d' });
const AUTRE_TOKEN = jwt.sign(AUTRE, process.env.JWT_SECRET, { expiresIn: '1d' });
const PARCOURS_ID = '44444444-4444-4444-8444-444444444444';

const auth = (r: request.Test, token = TOKEN) => r.set('Authorization', `Bearer ${token}`);

vi.mock('express-rate-limit', () => ({
  default: () => (_: any, __: any, next: any) => next(),
  rateLimit: () => (_: any, __: any, next: any) => next(),
}));
vi.mock('../../server/middleware/limiter.js', () => {
  const p = (_: any, __: any, n: any) => n();
  return { aiGenerateLimiter: p, aiChatLimiter: p, authLimiter: p, partageLimiter: p, photosLimiter: p };
});

// F8-B est mocké : ce test vérifie l'orchestration (F8-C), pas la
// régénération elle-même (déjà couverte par regenerationModification.test.ts).
const { regenererModificationSurCopie } = vi.hoisted(() => ({
  regenererModificationSurCopie: vi.fn(),
}));
vi.mock('../../server/agents/regenerationModification.js', () => ({
  regenererModificationSurCopie,
}));

// interpreterDemande n'est jamais exercé ici (tous les corps de requête
// portent `demande`), mais on le mocke par prudence : aucun réseau réel.
vi.mock('../../server/agents/modification.js', () => ({
  interpreterDemande: vi.fn().mockResolvedValue({ type: 'supprimer_element', elementId: 'e1' }),
}));

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    parcours: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  } as any,
}));
vi.mock('../../server/db/prisma.js', () => ({ default: prismaMock }));

function parcoursDeTest(): Parcours {
  return ParcoursSchema.parse({
    id: PARCOURS_ID,
    intention: { texte: "fêter l'EVG de Max" },
    contexte: { avecQui: 'amis', duree: { valeur: 2, unite: 'jours' } },
    participants: [{ id: PROPRIETAIRE.id, nom: 'Hugo', role: 'organisateur' }],
    budget: { mode: 'individuel' },
    timeline: [
      {
        id: 'm1',
        titre: 'Samedi',
        elements: [
          { id: 'e1', type: 'activite', nom: 'Karting', justification: 'Max adore la vitesse' },
          { id: 'e2', type: 'restaurant', nom: 'Bistrot', justification: 'proche', dependDe: ['e1'] },
        ],
      },
    ],
  });
}

/** Copie distincte du parcours d'entrée : preuve que la réponse renvoie
 * bien l'objet validé par F8-B, jamais une reconstruction côté route. */
function parcoursValideParF8B(): Parcours {
  const p = parcoursDeTest();
  return {
    ...p,
    timeline: [
      {
        ...p.timeline[0]!,
        elements: p.timeline[0]!.elements.map((e) =>
          e.id === 'e1' ? { ...e, statut: 'accepte' as const } : e
        ),
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.parcours.findFirst.mockImplementation(async ({ where }: any) =>
    where.id === PARCOURS_ID && where.user_id === PROPRIETAIRE.id ? { contenu: parcoursDeTest() } : null
  );
  prismaMock.parcours.findUnique.mockResolvedValue({ user_id: PROPRIETAIRE.id });
  prismaMock.parcours.upsert.mockResolvedValue({});
});

const CORPS_VALIDE = { demande: { type: 'changer_statut', elementId: 'e1', statut: 'accepte' } };

describe('POST /api/parcours/:id/modifications — F8-C, persistance atomique', () => {
  it('1. modification réussie sans dépendant → exactement une écriture, parcours persisté = parcours renvoyé par F8-B', async () => {
    const validee = parcoursValideParF8B();
    regenererModificationSurCopie.mockResolvedValue({
      ok: true,
      parcours: validee,
      description: 'Karting accepté',
      elementsRegeneres: [],
    });

    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`)).send(CORPS_VALIDE);

    expect(res.status).toBe(200);
    expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(1);
    expect(res.body.parcours).toEqual(validee);
    expect(res.body.elementsARegenerer).toEqual([]);
  });

  it('2. remplacement avec dépendants régénérés → une seule écriture finale, la même copie validée est persistée (pas de seconde application)', async () => {
    const validee = parcoursValideParF8B();
    regenererModificationSurCopie.mockResolvedValue({
      ok: true,
      parcours: validee,
      description: 'Karting remplacé, Bistrot régénéré',
      elementsRegeneres: ['e2'],
    });

    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`)).send(CORPS_VALIDE);

    expect(res.status).toBe(200);
    expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(1);
    const appelUpsert = prismaMock.parcours.upsert.mock.calls[0][0];
    expect(appelUpsert.update.contenu).toEqual(validee);
    expect(res.body.elementsARegenerer).toEqual(['e2']);
  });

  it.each([
    ['403 (auteur non autorisé par le domaine)', 403],
    ['404 (élément à régénérer introuvable)', 404],
    ['422 (rendrait le parcours incohérent)', 422],
    ['502 (sortie IA inexploitable)', 502],
    ['503 (dépendance externe indisponible)', 503],
  ])('3. échec F8-B %s → zéro écriture, la réponse porte le statut', async (_label, statutHttp) => {
    regenererModificationSurCopie.mockResolvedValue({
      ok: false,
      erreur: 'La préparation a échoué',
      statutHttp,
    });

    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`)).send(CORPS_VALIDE);

    expect(res.status).toBe(statutHttp);
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });

  it('4. modification non supportée (F8-B refuse sans statutHttp explicite) → 422 par défaut, zéro écriture', async () => {
    regenererModificationSurCopie.mockResolvedValue({ ok: false, erreur: 'Modification non supportée' });

    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`)).send(CORPS_VALIDE);

    expect(res.status).toBe(422);
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });

  it('5. parcours introuvable → 404, zéro écriture, F8-B jamais appelé', async () => {
    const res = await auth(
      request(app).post(`/api/parcours/55555555-5555-4555-8555-555555555555/modifications`)
    ).send(CORPS_VALIDE);

    expect(res.status).toBe(404);
    expect(regenererModificationSurCopie).not.toHaveBeenCalled();
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });

  it("6. utilisateur non propriétaire → 404 (chargerParcours filtre par user_id), zéro écriture, F8-B jamais appelé", async () => {
    const res = await auth(
      request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`),
      AUTRE_TOKEN
    ).send(CORPS_VALIDE);

    expect(res.status).toBe(404);
    expect(regenererModificationSurCopie).not.toHaveBeenCalled();
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });

  it('7. F8-B réussit mais la persistance finale échoue → réponse d’échec, jamais un faux succès', async () => {
    regenererModificationSurCopie.mockResolvedValue({
      ok: true,
      parcours: parcoursValideParF8B(),
      description: 'ok',
      elementsRegeneres: [],
    });
    prismaMock.parcours.upsert.mockRejectedValue(new Error('DB indisponible'));

    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`)).send(CORPS_VALIDE);

    expect(res.status).toBe(500);
    expect(res.body.parcours).toBeUndefined();
    expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(1);
  });

  it('8. modification hôtel/transport → passe intégralement par F8-B, la route ne rebranche plus sur un chemin dédié', async () => {
    const validee = parcoursValideParF8B();
    regenererModificationSurCopie.mockResolvedValue({
      ok: true,
      parcours: validee,
      description: 'Hôtel remplacé',
      elementsRegeneres: [],
    });

    const corpsHotel = {
      demande: { type: 'remplacer_hotel', elementId: 'e1', villeDemandee: 'Boston', requete: 'hôtel proche du centre' },
    };
    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`)).send(corpsHotel);

    expect(res.status).toBe(200);
    expect(regenererModificationSurCopie).toHaveBeenCalledTimes(1);
    expect(regenererModificationSurCopie.mock.calls[0][1]).toEqual(corpsHotel.demande);
    expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(1);
  });
});
