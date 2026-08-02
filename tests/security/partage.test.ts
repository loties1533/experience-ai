// =============================================
// EXPERIENCE AI — tests/security/partage.test.ts
// Ce qu'un LIEN donne, et surtout ce qu'il ne donne pas.
//   - consulter selon la visibilité (privé / partagé / surprise) ;
//   - réagir en tant que participant désigné par le jeton ;
//   - REFUS : modifier, changer la visibilité, convier — tout cela exige un
//     compte ET le rôle qui l'autorise. Un jeton n'est pas un compte.
// =============================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../server/index.js';
import { ParcoursSchema, type Parcours } from '../../server/domaine/parcours/index.js';

process.env.JWT_SECRET = 'test-secret-for-vitest';

const PROPRIETAIRE = { id: '11111111-1111-4111-8111-111111111111', email: 'hugo@test.com', name: 'Hugo' };
const TOKEN = jwt.sign(PROPRIETAIRE, process.env.JWT_SECRET, { expiresIn: '1d' });
const AUTRE_TOKEN = jwt.sign(
  { id: '22222222-2222-4222-8222-222222222222', email: 'curieux@test.com', name: 'Curieux' },
  process.env.JWT_SECRET,
  { expiresIn: '1d' }
);
const PARCOURS_ID = '44444444-4444-4444-8444-444444444444';

const JETON_HUGO = 'A'.repeat(43);
const JETON_LEO = 'B'.repeat(43);
const JETON_MAX = 'C'.repeat(43);

const auth = (r: request.Test, token = TOKEN) => r.set('Authorization', `Bearer ${token}`);

vi.mock('express-rate-limit', () => ({
  default:   () => (_: any, __: any, next: any) => next(),
  rateLimit: () => (_: any, __: any, next: any) => next()
}));
vi.mock('../../server/middleware/limiter.js', () => {
  const p = (_: any, __: any, n: any) => n();
  return { aiGenerateLimiter: p, aiChatLimiter: p, authLimiter: p, partageLimiter: p, photosLimiter: p };
});
vi.mock('../../server/agents/modification.js', () => ({
  interpreterDemande: vi.fn().mockResolvedValue({ type: 'supprimer_element', elementId: 'e1' }),
}));

function evg(visibilite: 'prive' | 'partage' | 'surprise'): Parcours {
  return ParcoursSchema.parse({
    id: PARCOURS_ID,
    intention: { texte: "fêter l'EVG de Max" },
    contexte: { avecQui: 'amis', duree: { valeur: 2, unite: 'jours' } },
    participants: [
      { id: 'p-hugo', nom: 'Hugo', role: 'organisateur' },
      { id: 'p-max', nom: 'Max', role: 'heros' },
      { id: 'p-leo', nom: 'Léo', role: 'participant' },
    ],
    budget: { mode: 'partage', montantTotal: 1600 },
    visibilite,
    timeline: [
      {
        id: 'm1',
        titre: 'Samedi',
        elements: [{ id: 'e1', type: 'activite', nom: 'Karting', justification: 'Max adore la vitesse' }],
      },
    ],
  });
}

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    parcours: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    partageParcours: { findMany: vi.fn(), findUnique: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
  } as any,
}));
vi.mock('../../server/db/prisma.js', () => ({ default: prismaMock }));

/** Le jeton `jeton` ouvre le parcours `parcours` au nom de `participantId`. */
function lienValide(jeton: string, participantId: string, parcours: Parcours) {
  prismaMock.partageParcours.findUnique.mockImplementation(async ({ where }: any) =>
    where.jeton === jeton
      ? { participant_id: participantId, parcours: { user_id: PROPRIETAIRE.id, contenu: parcours } }
      : null
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.parcours.findUnique.mockResolvedValue(null);
  prismaMock.parcours.upsert.mockResolvedValue({});
  prismaMock.partageParcours.findMany.mockResolvedValue([]);
  prismaMock.partageParcours.createMany.mockResolvedValue({ count: 0 });
  prismaMock.partageParcours.deleteMany.mockResolvedValue({ count: 0 });
});

// ============================================================
// 1 — CONSULTER PAR LE LIEN : la visibilité décide
// ============================================================
describe('GET /api/partage/:jeton — la visibilité décide', () => {

  it('400 si le jeton n’a pas la forme attendue', async () => {
    const res = await request(app).get('/api/partage/trop-court');
    expect(res.status).toBe(400);
  });

  it('404 sur un jeton inconnu — on ne renseigne pas le curieux', async () => {
    prismaMock.partageParcours.findUnique.mockResolvedValue(null);
    const res = await request(app).get(`/api/partage/${'Z'.repeat(43)}`);
    expect(res.status).toBe(404);
  });

  it('« partagé » : le porteur voit le parcours et sait qui il est', async () => {
    lienValide(JETON_LEO, 'p-leo', evg('partage'));
    const res = await request(app).get(`/api/partage/${JETON_LEO}`);
    expect(res.status).toBe(200);
    expect(res.body.parcours.intention.texte).toMatch(/EVG/);
    expect(res.body.participant).toMatchObject({ id: 'p-leo', nom: 'Léo', role: 'participant' });
  });

  it('« privé » : même un lien émis avant ne donne plus rien', async () => {
    lienValide(JETON_LEO, 'p-leo', evg('prive'));
    const res = await request(app).get(`/api/partage/${JETON_LEO}`);
    expect(res.status).toBe(404);
  });

  it('« surprise » : le héros n’entre pas, même avec un jeton en base (histoire de Max)', async () => {
    lienValide(JETON_MAX, 'p-max', evg('surprise'));
    const res = await request(app).get(`/api/partage/${JETON_MAX}`);
    expect(res.status).toBe(404);
    // Le message ne trahit pas l'existence de la surprise.
    expect(res.body.error).not.toMatch(/surprise/i);
  });

  it('« surprise » : les autres participants entrent normalement', async () => {
    lienValide(JETON_LEO, 'p-leo', evg('surprise'));
    const res = await request(app).get(`/api/partage/${JETON_LEO}`);
    expect(res.status).toBe(200);
  });

  it('un participant retiré du parcours n’entre plus, même avec son ancien jeton', async () => {
    lienValide(JETON_LEO, 'p-parti-depuis', evg('partage'));
    const res = await request(app).get(`/api/partage/${JETON_LEO}`);
    expect(res.status).toBe(404);
  });
});

// ============================================================
// 2 — RÉAGIR PAR LE LIEN : l'avis qui éclaire
// ============================================================
describe('POST /api/partage/:jeton/reactions — donner son avis', () => {

  it('200 : l’avis est enregistré au nom du participant que le jeton désigne', async () => {
    lienValide(JETON_LEO, 'p-leo', evg('partage'));
    const res = await request(app)
      .post(`/api/partage/${JETON_LEO}/reactions`)
      .send({ elementId: 'e1', avis: 'contre' });

    expect(res.status).toBe(200);
    expect(res.body.parcours.timeline[0].elements[0].reactions).toEqual([
      { participantId: 'p-leo', avis: 'contre', le: expect.any(String) },
    ]);
  });

  it('l’écriture se fait au nom du PROPRIÉTAIRE du parcours, jamais du porteur', async () => {
    lienValide(JETON_LEO, 'p-leo', evg('partage'));
    await request(app).post(`/api/partage/${JETON_LEO}/reactions`).send({ elementId: 'e1', avis: 'pour' });

    expect(prismaMock.parcours.upsert.mock.calls[0][0].create.user_id).toBe(PROPRIETAIRE.id);
  });

  it('un avis ne change pas le statut de l’élément : il éclaire, il ne décide pas', async () => {
    lienValide(JETON_LEO, 'p-leo', evg('partage'));
    const res = await request(app)
      .post(`/api/partage/${JETON_LEO}/reactions`)
      .send({ elementId: 'e1', avis: 'contre' });

    expect(res.body.parcours.timeline[0].elements[0].statut).toBe('propose');
    expect(res.body.parcours.historique).toEqual([]);
  });

  it('400 si l’avis n’est ni « pour » ni « contre »', async () => {
    lienValide(JETON_LEO, 'p-leo', evg('partage'));
    const res = await request(app)
      .post(`/api/partage/${JETON_LEO}/reactions`)
      .send({ elementId: 'e1', avis: 'bof' });
    expect(res.status).toBe(400);
  });

  it('422 sur un élément qui n’existe pas', async () => {
    lienValide(JETON_LEO, 'p-leo', evg('partage'));
    const res = await request(app)
      .post(`/api/partage/${JETON_LEO}/reactions`)
      .send({ elementId: 'fantome', avis: 'pour' });
    expect(res.status).toBe(422);
  });

  it('404 : le héros d’une surprise ne réagit pas non plus', async () => {
    lienValide(JETON_MAX, 'p-max', evg('surprise'));
    const res = await request(app)
      .post(`/api/partage/${JETON_MAX}/reactions`)
      .send({ elementId: 'e1', avis: 'pour' });
    expect(res.status).toBe(404);
    expect(prismaMock.parcours.upsert).not.toHaveBeenCalled();
  });
});

// ============================================================
// 3 — CE QU'UN LIEN NE DONNE PAS
// Un jeton de partage ne donne jamais les droits d'un compte.
// ============================================================
describe('un porteur de lien ne peut RIEN modifier', () => {

  it('la route de modification n’existe pas sans compte (401)', async () => {
    const res = await request(app)
      .post(`/api/parcours/${PARCOURS_ID}/modifications`)
      .send({ demande: { type: 'supprimer_element', elementId: 'e1' } });
    expect(res.status).toBe(401);
  });

  it('présenter le jeton en Bearer ne vaut pas authentification (401)', async () => {
    const res = await request(app)
      .post(`/api/parcours/${PARCOURS_ID}/modifications`)
      .set('Authorization', `Bearer ${JETON_LEO}`)
      .send({ demande: { type: 'supprimer_element', elementId: 'e1' } });
    expect(res.status).toBe(401);
  });

  it('changer la visibilité exige un compte (401)', async () => {
    const res = await request(app).put(`/api/parcours/${PARCOURS_ID}/partage`).send({ visibilite: 'partage' });
    expect(res.status).toBe(401);
  });

  it('convier quelqu’un exige un compte (401)', async () => {
    const res = await request(app)
      .post(`/api/parcours/${PARCOURS_ID}/participants`)
      .send({ nom: 'Intrus', role: 'organisateur' });
    expect(res.status).toBe(401);
  });

  it('la route de partage n’accepte aucune demande de modification déguisée (400)', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({ contenu: evg('partage') });
    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`))
      .send({ demande: { type: 'changer_visibilite', visibilite: 'partage' } });
    expect(res.status).toBe(400);
  });

  it('un autre compte ne voit pas ce parcours et n’en change pas la visibilité (404)', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue(null);
    const res = await auth(request(app).put(`/api/parcours/${PARCOURS_ID}/partage`), AUTRE_TOKEN)
      .send({ visibilite: 'partage' });
    expect(res.status).toBe(404);
  });
});

// ============================================================
// 4 — CÔTÉ ORGANISATEUR : obtenir les liens, constituer le groupe
// ============================================================
describe('/api/parcours/:id/partage — l’organisateur pilote', () => {

  it('PUT « partagé » : un lien non devinable par participant', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({ contenu: evg('prive') });
    prismaMock.partageParcours.findMany.mockResolvedValue([
      { participant_id: 'p-hugo', jeton: JETON_HUGO, created_at: new Date() },
      { participant_id: 'p-max', jeton: JETON_MAX, created_at: new Date() },
      { participant_id: 'p-leo', jeton: JETON_LEO, created_at: new Date() },
    ]);

    const res = await auth(request(app).put(`/api/parcours/${PARCOURS_ID}/partage`)).send({ visibilite: 'partage' });

    expect(res.status).toBe(200);
    expect(res.body.partage.visibilite).toBe('partage');
    for (const lien of res.body.partage.liens) {
      expect(lien.chemin).toMatch(/^\/partage\/[A-Za-z0-9_-]+$/);
      // Le lien ne se déduit pas de l'id du parcours.
      expect(lien.chemin).not.toContain(PARCOURS_ID);
    }
  });

  it('PUT « surprise » : aucun lien pour le héros, et le sien est révoqué', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({ contenu: evg('partage') });
    // Avant synchronisation Max a un lien ; après, il ne doit plus en avoir.
    prismaMock.partageParcours.findMany
      .mockResolvedValueOnce([
        { participant_id: 'p-hugo', jeton: JETON_HUGO, created_at: new Date() },
        { participant_id: 'p-max', jeton: JETON_MAX, created_at: new Date() },
      ])
      .mockResolvedValueOnce([{ participant_id: 'p-hugo', jeton: JETON_HUGO, created_at: new Date() }]);

    const res = await auth(request(app).put(`/api/parcours/${PARCOURS_ID}/partage`)).send({ visibilite: 'surprise' });

    expect(res.status).toBe(200);
    expect(prismaMock.partageParcours.deleteMany).toHaveBeenCalledWith({ where: { jeton: { in: [JETON_MAX] } } });
    const max = res.body.partage.liens.find((l: any) => l.participantId === 'p-max');
    expect(max.chemin).toBeNull();
  });

  it('PUT « privé » : tous les liens sont coupés', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({ contenu: evg('partage') });
    const res = await auth(request(app).put(`/api/parcours/${PARCOURS_ID}/partage`)).send({ visibilite: 'prive' });

    expect(res.status).toBe(200);
    expect(prismaMock.partageParcours.deleteMany).toHaveBeenCalledWith({ where: { parcours_id: PARCOURS_ID } });
    expect(res.body.partage.liens.every((l: any) => l.chemin === null)).toBe(true);
  });

  it('PUT 400 si la visibilité n’est pas une valeur connue', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({ contenu: evg('prive') });
    const res = await auth(request(app).put(`/api/parcours/${PARCOURS_ID}/partage`)).send({ visibilite: 'public' });
    expect(res.status).toBe(400);
  });

  it('POST participants : l’id est attribué par le serveur, pas par le client', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({ contenu: evg('partage') });
    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/participants`))
      .send({ id: 'p-hugo', nom: 'Sam', role: 'participant' });

    expect(res.status).toBe(201);
    const sam = res.body.parcours.participants.find((p: any) => p.nom === 'Sam');
    expect(sam.id).not.toBe('p-hugo');
  });

  it('POST participants 400 si le rôle est inconnu', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({ contenu: evg('partage') });
    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/participants`))
      .send({ nom: 'Sam', role: 'admin' });
    expect(res.status).toBe(400);
  });

  it('DELETE participants 422 sur l’organisateur (le parcours resterait sans responsable)', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({ contenu: evg('partage') });
    const res = await auth(request(app).delete(`/api/parcours/${PARCOURS_ID}/participants/p-hugo`));
    expect(res.status).toBe(422);
  });

  it('DELETE participants : Léo part, son lien avec lui', async () => {
    prismaMock.parcours.findFirst.mockResolvedValue({ contenu: evg('partage') });
    prismaMock.partageParcours.findMany.mockResolvedValue([
      { participant_id: 'p-leo', jeton: JETON_LEO, created_at: new Date() },
    ]);

    const res = await auth(request(app).delete(`/api/parcours/${PARCOURS_ID}/participants/p-leo`));

    expect(res.status).toBe(200);
    expect(res.body.parcours.participants.map((p: any) => p.id)).not.toContain('p-leo');
    expect(prismaMock.partageParcours.deleteMany).toHaveBeenCalledWith({ where: { jeton: { in: [JETON_LEO] } } });
  });

  it('GET partage 401 sans compte', async () => {
    const res = await request(app).get(`/api/parcours/${PARCOURS_ID}/partage`);
    expect(res.status).toBe(401);
  });

  it('GET partage 400 si l’id du parcours n’est pas un uuid', async () => {
    const res = await auth(request(app).get('/api/parcours/pas-un-uuid/partage'));
    expect(res.status).toBe(400);
  });
});
