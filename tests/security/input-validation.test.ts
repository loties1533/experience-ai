// =============================================
// EXPERIENCE AI — tests/security/input-validation.test.ts
// Validation des entrées sur les routes parcours :
//   - champs manquants
//   - limites de longueur
//   - identifiants malformés
//   - corps qui ne correspond à aucune forme attendue
// Rien n'atteint le domaine ni le LLM sans passer par Zod.
// =============================================

import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../server/index.js';
import { ParcoursSchema, type Parcours } from '../../server/domaine/parcours/index.js';
import { AppError } from '../../server/lib/AppError.js';
import { creerLienRechercheHebergement } from '../../server/lib/url.js';

process.env.JWT_SECRET = 'test-secret-for-vitest';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'a@test.com', name: 'User A' };
const TOKEN = jwt.sign(USER, process.env.JWT_SECRET, { expiresIn: '1d' });
const PARCOURS_ID = '44444444-4444-4444-8444-444444444444';

const auth = (r: request.Test) => r.set('Authorization', `Bearer ${TOKEN}`);

vi.mock('express-rate-limit', () => ({
  default:   () => (_: any, __: any, next: any) => next(),
  rateLimit: () => (_: any, __: any, next: any) => next()
}));
vi.mock('../../server/middleware/limiter.js', () => {
  const p = (_: any, __: any, n: any) => n();
  return { aiGenerateLimiter: p, aiChatLimiter: p, authLimiter: p, partageLimiter: p };
});

// Les agents (donc les appels LLM) sont mockés : ce qu'on teste ici, c'est la
// frontière de validation en amont, pas le modèle.
vi.mock('../../server/agents/intake.js', () => ({
  avancerDialogue: vi.fn().mockResolvedValue({ termine: false, question: 'Avec qui partez-vous ?' }),
}));
vi.mock('../../server/agents/modification.js', () => ({
  interpreterDemande: vi.fn().mockResolvedValue({ type: 'supprimer_element', elementId: 'e1' }),
}));

const { rechercherLieuxFoursquareMock } = vi.hoisted(() => ({
  rechercherLieuxFoursquareMock: vi.fn(),
}));
vi.mock('../../server/services/foursquare.js', () => ({
  rechercherLieuxFoursquare: rechercherLieuxFoursquareMock,
}));

const PARCOURS: Parcours = ParcoursSchema.parse({
  id: PARCOURS_ID,
  intention: { texte: 'fêter le départ de Hugo' },
  contexte: { avecQui: 'amis', duree: { valeur: 2, unite: 'jours' } },
  // Hugo est le héros (invariant 8 : il ne décide pas) ; Sam organise.
  participants: [
    { id: 'u1', nom: 'Hugo', role: 'heros' },
    { id: 'u2', nom: 'Sam', role: 'organisateur' },
  ],
  budget: { mode: 'partage', montantTotal: 1200 },
  timeline: [
    {
      id: 'm1',
      titre: 'Samedi soir',
      elements: [
        { id: 'e1', type: 'restaurant', nom: 'Chez Rose', justification: 'la table qu\'Hugo adore' },
      ],
    },
  ],
});

vi.mock('../../server/agents/generation.js', () => ({
  genererParcours: vi.fn(async () => PARCOURS),
}));
const { genererParcours } = await import('../../server/agents/generation.js');

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    parcours: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    preferenceParcours: { findUnique: vi.fn(), upsert: vi.fn() },
  } as any,
}));
vi.mock('../../server/db/prisma.js', () => ({ default: prismaMock }));

prismaMock.parcours.findFirst.mockResolvedValue({ contenu: PARCOURS });
prismaMock.parcours.findUnique.mockResolvedValue(null);
prismaMock.parcours.upsert.mockResolvedValue({});
prismaMock.preferenceParcours.findUnique.mockResolvedValue(null);
prismaMock.preferenceParcours.upsert.mockResolvedValue({});

const BRIEF_VALIDE = {
  intention: 'fêter le départ de Hugo',
  avecQui: 'amis',
  duree: { valeur: 2, unite: 'jours' },
  lieux: ['Lisbonne'],
  contraintes: [],
};

// ============================================================
// POST /api/parcours/dialogue — cadrage
// ============================================================
describe('POST /api/parcours/dialogue — validation du message', () => {

  it('401 sans token', async () => {
    const res = await request(app).post('/api/parcours/dialogue').send({ message: 'coucou' });
    expect(res.status).toBe(401);
  });

  it('400 si message manquant', async () => {
    const res = await auth(request(app).post('/api/parcours/dialogue')).send({ brief: {} });
    expect(res.status).toBe(400);
  });

  it('400 si message vide', async () => {
    const res = await auth(request(app).post('/api/parcours/dialogue')).send({ message: '' });
    expect(res.status).toBe(400);
  });

  it('400 si message > 500 caractères', async () => {
    const res = await auth(request(app).post('/api/parcours/dialogue')).send({ message: 'A'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('400 si le brief partiel est mal formé', async () => {
    const res = await auth(request(app).post('/api/parcours/dialogue'))
      .send({ brief: { avecQui: 'ma belle-mère' }, message: 'un week-end' });
    expect(res.status).toBe(400);
  });

  it('200 avec un message valide', async () => {
    const res = await auth(request(app).post('/api/parcours/dialogue'))
      .send({ message: 'Un EVG à Lisbonne pour six' });
    expect(res.status).toBe(200);
  });

  it('une injection dans le message ne fait pas planter le serveur', async () => {
    const res = await auth(request(app).post('/api/parcours/dialogue'))
      .send({ message: '{"$gt": ""} <img src=x onerror=alert(1)>' });
    expect(res.status).not.toBe(500);
  });
});

// ============================================================
// POST /api/parcours — génération
// ============================================================
describe('POST /api/parcours — validation du brief', () => {

  it('401 sans token', async () => {
    const res = await request(app).post('/api/parcours').send({ brief: BRIEF_VALIDE });
    expect(res.status).toBe(401);
  });

  it('400 si le brief est absent', async () => {
    const res = await auth(request(app).post('/api/parcours')).send({});
    expect(res.status).toBe(400);
  });

  it('400 si l\'intention est vide (invariant 1)', async () => {
    const res = await auth(request(app).post('/api/parcours')).send({ brief: { ...BRIEF_VALIDE, intention: '' } });
    expect(res.status).toBe(400);
  });

  it('400 si la durée n\'est pas positive', async () => {
    const res = await auth(request(app).post('/api/parcours'))
      .send({ brief: { ...BRIEF_VALIDE, duree: { valeur: 0, unite: 'jours' } } });
    expect(res.status).toBe(400);
  });

  it('400 si « avec qui » n\'est pas une valeur connue', async () => {
    const res = await auth(request(app).post('/api/parcours')).send({ brief: { ...BRIEF_VALIDE, avecQui: 'collègues' } });
    expect(res.status).toBe(400);
  });

  it('400 si une occupation incomplète est présentée comme déclarée', async () => {
    const res = await auth(request(app).post('/api/parcours')).send({
      brief: {
        ...BRIEF_VALIDE,
        hebergement: {
          necessaire: true,
          occupation: {
            statut: 'declaree',
            adultes: 2,
            chambres: 1,
          },
          sejours: [
            {
              ville: 'Lisbonne',
              arrivee: '2026-08-10',
              depart: '2026-08-12',
            },
          ],
        },
      },
    });
    expect(res.status).toBe(400);
  });

  it('400 si une valeur hôtelière est hors limites', async () => {
    const res = await auth(request(app).post('/api/parcours')).send({
      brief: {
        ...BRIEF_VALIDE,
        hebergement: {
          necessaire: true,
          occupation: {
            statut: 'declaree',
            adultes: 0,
            enfants: 0,
            chambres: 1,
          },
          sejours: [
            {
              ville: 'Lisbonne',
              arrivee: '2026-08-10',
              depart: '2026-08-12',
            },
          ],
        },
      },
    });
    expect(res.status).toBe(400);
  });

  it('201 avec un brief valide', async () => {
    const res = await auth(request(app).post('/api/parcours')).send({ brief: BRIEF_VALIDE });
    expect(res.status).toBe(201);
    expect(res.body.parcours.id).toBe(PARCOURS_ID);
  });

  it('422 quand la génération refuse faute de données essentielles fiables', async () => {
    vi.mocked(genererParcours).mockRejectedValueOnce(
      new AppError('Le match demandé ne peut pas être confirmé sur ces dates.', 422)
    );
    const res = await auth(request(app).post('/api/parcours')).send({ brief: BRIEF_VALIDE });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('ne peut pas être confirmé');
  });

  it('422 quand un hébergement essentiel garde une occupation à confirmer', async () => {
    vi.mocked(genererParcours).mockRejectedValueOnce(
      new AppError('L’occupation de l’hébergement doit être confirmée avant la génération.', 422)
    );
    const res = await auth(request(app).post('/api/parcours')).send({
      brief: {
        ...BRIEF_VALIDE,
        hebergement: {
          necessaire: true,
          occupation: {
            statut: 'a_confirmer',
            adultes: 2,
            chambres: 1,
          },
          sejours: [
            {
              ville: 'Lisbonne',
              arrivee: '2026-08-10',
              depart: '2026-08-12',
            },
          ],
        },
      },
    });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('occupation');
  });

  it('503 quand les sources de vérification sont techniquement indisponibles', async () => {
    vi.mocked(genererParcours).mockRejectedValueOnce(
      new AppError('Les sources de vérification sont momentanément indisponibles.', 503)
    );
    const res = await auth(request(app).post('/api/parcours')).send({ brief: BRIEF_VALIDE });
    expect(res.status).toBe(503);
  });
});

// ============================================================
// GET / DELETE /api/parcours/:id — identifiant
// ============================================================
describe('/api/parcours/:id — validation de l\'identifiant', () => {

  it('400 si l\'id n\'est pas un uuid', async () => {
    const res = await auth(request(app).get('/api/parcours/pas-un-uuid'));
    expect(res.status).toBe(400);
  });

  it('400 sur DELETE avec un id malformé', async () => {
    const res = await auth(request(app).delete('/api/parcours/../../etc/passwd'));
    expect([400, 404]).toContain(res.status);
  });

  it('200 avec un id valide', async () => {
    const res = await auth(request(app).get(`/api/parcours/${PARCOURS_ID}`));
    expect(res.status).toBe(200);
  });
});

// ============================================================
// POST /api/parcours/:id/modifications — demande ou phrase
// ============================================================
describe('POST /api/parcours/:id/modifications — validation de la demande', () => {

  it('400 si le corps ne contient ni demande ni phrase', async () => {
    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`)).send({});
    expect(res.status).toBe(400);
  });

  it('400 si la phrase est vide', async () => {
    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`)).send({ phrase: '' });
    expect(res.status).toBe(400);
  });

  it('400 si la phrase dépasse 500 caractères', async () => {
    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`)).send({ phrase: 'B'.repeat(501) });
    expect(res.status).toBe(400);
  });

  it('400 si le type de demande est inconnu', async () => {
    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`))
      .send({ demande: { type: 'tout_regenerer', elementId: 'e1' } });
    expect(res.status).toBe(400);
  });

  it('400 si un élément ajouté n\'a pas de justification (invariant 2)', async () => {
    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`))
      .send({ demande: { type: 'ajouter_element', momentId: 'm1', element: { id: 'e2', type: 'activite', nom: 'Karting', justification: '' } } });
    expect(res.status).toBe(400);
  });

  it.each([
    ['confiance vérifiée', { confiance: { niveau: 'verifie' } }],
    [
      'provenance Foursquare',
      {
        provenance: {
          fournisseur: 'Foursquare',
          source: 'https://places-api.foursquare.com/places/search',
        },
      },
    ],
    ['fournisseur', { fournisseur: 'Foursquare' }],
    ['source', { source: 'https://evil.test' }],
    ['identifiant externe', { identifiantExterne: 'fsq-forge' }],
    ['adresse fournisseur', { adresse: '1 rue inventée' }],
    [
      'date de récupération',
      { recupereLe: '2026-07-29T12:00:00.000Z' },
    ],
    [
      'lien Booking',
      {
        lienRechercheHebergement: {
          type: 'recherche',
          fournisseur: 'Booking',
          url: 'https://www.booking.com/searchresults.html',
          libelle: 'Rechercher des hébergements sur Booking',
          genereLe: '2026-07-29T12:00:00.000Z',
        },
      },
    ],
    [
      'réservation',
      {
        reservation: {
          lienExterne: 'https://evil.test/reserver',
          fournisseur: 'Faux',
          typeLien: 'reservation',
        },
      },
    ],
    ['disponibilité', { disponibilite: true }],
    ['prix observé', { prixObserve: 99 }],
  ])(
    '400 et aucun effet de bord pour une fausse %s',
    async (_libelle, champInterdit) => {
      const sauvegardesAvant =
        prismaMock.parcours.upsert.mock.calls.length;
      const recherchesAvant =
        rechercherLieuxFoursquareMock.mock.calls.length;
      const lecturesAvant =
        prismaMock.parcours.findFirst.mock.calls.length;
      const res = await auth(
        request(app).post(
          `/api/parcours/${PARCOURS_ID}/modifications`
        )
      ).send({
        demande: {
          type: 'ajouter_element',
          momentId: 'm1',
          element: {
            type: 'activite',
            nom: 'Élément forgé',
            justification: 'tentative de falsification',
            ...champInterdit,
          },
        },
      });

      expect(res.status).toBe(400);
      expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(
        sauvegardesAvant
      );
      expect(rechercherLieuxFoursquareMock).toHaveBeenCalledTimes(
        recherchesAvant
      );
      expect(prismaMock.parcours.findFirst).toHaveBeenCalledTimes(
        lecturesAvant
      );
    }
  );

  it('400 si un hôtel est injecté par le remplacement générique', async () => {
    const res = await auth(
      request(app).post(
        `/api/parcours/${PARCOURS_ID}/modifications`
      )
    ).send({
      demande: {
        type: 'remplacer_element',
        elementId: 'e1',
        remplacement: {
          type: 'hebergement',
          nom: 'Hôtel forgé',
          justification: 'faux hôtel',
        },
      },
    });
    expect(res.status).toBe(400);
  });

  it('400 si l’occupation hôtelière déclarée est partielle', async () => {
    const res = await auth(
      request(app).post(
        `/api/parcours/${PARCOURS_ID}/modifications`
      )
    ).send({
      demande: {
        type: 'modifier_occupation_hebergement',
        occupation: {
          statut: 'declaree',
          adultes: 2,
          chambres: 1,
        },
      },
    });
    expect(res.status).toBe(400);
  });

  it('400 pour un champ interdit profondément imbriqué', async () => {
    const lecturesAvant =
      prismaMock.parcours.findFirst.mock.calls.length;
    const res = await auth(
      request(app).post(
        `/api/parcours/${PARCOURS_ID}/modifications`
      )
    ).send({
      demande: {
        type: 'modifier_occupation_hebergement',
        occupation: {
          statut: 'declaree',
          adultes: 2,
          enfants: 0,
          chambres: 1,
          provenance: 'Foursquare',
        },
      },
    });
    expect(res.status).toBe(400);
    expect(prismaMock.parcours.findFirst).toHaveBeenCalledTimes(
      lecturesAvant
    );
  });

  it('200 avec une demande structurée valide', async () => {
    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`))
      .send({ demande: { type: 'changer_statut', elementId: 'e1', statut: 'accepte' } });
    expect(res.status).toBe(200);
    expect(res.body.description).toBeDefined();
  });

  it('attribue côté serveur l’identifiant d’un nouvel élément', async () => {
    const res = await auth(
      request(app).post(
        `/api/parcours/${PARCOURS_ID}/modifications`
      )
    ).send({
      demande: {
        type: 'ajouter_element',
        momentId: 'm1',
        element: {
          type: 'activite',
          nom: 'Visite guidée',
          justification: 'découvrir la ville',
        },
      },
    });
    expect(res.status).toBe(200);
    const ajout = res.body.parcours.timeline[0].elements.find(
      (element: { nom: string }) =>
        element.nom === 'Visite guidée'
    );
    expect(ajout.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(ajout.id).not.toBe('e1');
    expect(ajout.confiance).toEqual({ niveau: 'suggestion' });
  });

  it('200 avec une phrase (traduite par l\'agent)', async () => {
    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`))
      .send({ phrase: 'enlève le resto' });
    expect(res.status).toBe(200);
  });

  it('403 si l\'auteur n\'a la main sur rien (invariant 8)', async () => {
    // Parcours sans organisateur : le propriétaire n'est rattaché à personne,
    // le domaine refuse plutôt que de supposer un droit.
    prismaMock.parcours.findFirst.mockResolvedValueOnce({
      contenu: { ...PARCOURS, participants: [{ id: 'u1', nom: 'Hugo', role: 'heros' }] },
    });
    const sauvegardesAvant =
      prismaMock.parcours.upsert.mock.calls.length;
    const recherchesAvant =
      rechercherLieuxFoursquareMock.mock.calls.length;
    const res = await auth(request(app).post(`/api/parcours/${PARCOURS_ID}/modifications`))
      .send({
        demande: {
          type: 'remplacer_hotel',
          elementId: 'e1',
          villeDemandee: 'Bordeaux',
          requete: 'Hôtel Burdigala',
          sejour: {
            ville: 'Bordeaux',
            arrivee: '2026-08-10',
            depart: '2026-08-12',
          },
        },
      });
    expect(res.status).toBe(403);
    expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(
      sauvegardesAvant
    );
    expect(rechercherLieuxFoursquareMock).toHaveBeenCalledTimes(
      recherchesAvant
    );
  });

  it('404 sans effet de bord si le parcours est absent', async () => {
    prismaMock.parcours.findFirst.mockResolvedValueOnce(null);
    const sauvegardesAvant =
      prismaMock.parcours.upsert.mock.calls.length;
    const recherchesAvant =
      rechercherLieuxFoursquareMock.mock.calls.length;
    const res = await auth(
      request(app).post(
        `/api/parcours/${PARCOURS_ID}/modifications`
      )
    ).send({
      demande: {
        type: 'changer_statut',
        elementId: 'e1',
        statut: 'accepte',
      },
    });
    expect(res.status).toBe(404);
    expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(
      sauvegardesAvant
    );
    expect(rechercherLieuxFoursquareMock).toHaveBeenCalledTimes(
      recherchesAvant
    );
  });

  it('404 avant Foursquare si l’élément hôtelier ciblé est absent', async () => {
    const sauvegardesAvant =
      prismaMock.parcours.upsert.mock.calls.length;
    const recherchesAvant =
      rechercherLieuxFoursquareMock.mock.calls.length;
    const res = await auth(
      request(app).post(
        `/api/parcours/${PARCOURS_ID}/modifications`
      )
    ).send({
      demande: {
        type: 'remplacer_hotel',
        elementId: 'hotel-absent',
        villeDemandee: 'Bordeaux',
        requete: 'Hôtel Burdigala',
        sejour: {
          ville: 'Bordeaux',
          arrivee: '2026-08-10',
          depart: '2026-08-12',
        },
      },
    });
    expect(res.status).toBe(404);
    expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(
      sauvegardesAvant
    );
    expect(rechercherLieuxFoursquareMock).toHaveBeenCalledTimes(
      recherchesAvant
    );
  });

  it('applique puis persiste une occupation complète avec un lien reconstruit', async () => {
    const sejour = {
      ville: 'Bordeaux',
      arrivee: '2026-08-10',
      depart: '2026-08-12',
    };
    const occupation = {
      statut: 'declaree' as const,
      adultes: 2,
      enfants: 0,
      chambres: 1,
    };
    const parcoursHotelier = ParcoursSchema.parse({
      ...PARCOURS,
      contexte: {
        ...PARCOURS.contexte,
        occupationHebergement: occupation,
      },
      timeline: [
        {
          id: 'nuit',
          titre: 'Nuit',
          elements: [
            {
              id: 'hotel',
              type: 'hebergement',
              nom: 'Un hébergement à choisir à Bordeaux',
              justification: 'dormir sur place',
              sejourHebergement: sejour,
              lienRechercheHebergement:
                creerLienRechercheHebergement(
                  { sejour, occupation },
                  '2026-07-29T12:00:00.000Z'
                ),
            },
          ],
        },
      ],
    });
    prismaMock.parcours.findFirst.mockResolvedValueOnce({
      contenu: parcoursHotelier,
    });
    const sauvegardesAvant =
      prismaMock.parcours.upsert.mock.calls.length;

    const res = await auth(
      request(app).post(
        `/api/parcours/${PARCOURS_ID}/modifications`
      )
    ).send({
      demande: {
        type: 'modifier_occupation_hebergement',
        occupation: {
          statut: 'declaree',
          adultes: 3,
          enfants: 1,
          chambres: 2,
        },
      },
    });

    expect(res.status).toBe(200);
    expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(
      sauvegardesAvant + 1
    );
    const url =
      res.body.parcours.timeline[0].elements[0]
        .lienRechercheHebergement.url;
    const parametres = new URL(url).searchParams;
    expect(parametres.get('group_adults')).toBe('3');
    expect(parametres.get('group_children')).toBe('1');
    expect(parametres.get('no_rooms')).toBe('2');
  });

  it('modifie sûrement un ancien hôtel après neutralisation de ses fausses preuves', async () => {
    prismaMock.parcours.findFirst.mockResolvedValueOnce({
      contenu: {
        ...PARCOURS,
        timeline: [
          {
            id: 'ancienne-nuit',
            titre: 'Ancienne nuit',
            elements: [
              {
                id: 'hotel-legacy',
                type: 'hebergement',
                nom: 'Ancien hôtel',
                justification: 'ancienne justification',
                confiance: {
                  niveau: 'verifie',
                  fournisseur: 'FauxSquare',
                  source: 'https://evil.test',
                  recupereLe: '2025-01-01T10:00:00.000Z',
                  identifiantExterne: 'faux',
                },
                reservation: {
                  lienExterne: 'https://evil.test/reserver',
                },
              },
            ],
          },
        ],
      },
    });

    const res = await auth(
      request(app).post(
        `/api/parcours/${PARCOURS_ID}/modifications`
      )
    ).send({
      demande: {
        type: 'modifier_justification',
        elementId: 'hotel-legacy',
        justification: 'justification corrigée',
      },
    });

    expect(res.status).toBe(200);
    const hotel = res.body.parcours.timeline[0].elements[0];
    expect(hotel.justification).toBe('justification corrigée');
    expect(hotel.confiance).toEqual({ niveau: 'suggestion' });
    expect(hotel.reservation).toBeUndefined();
  });

  it('503 sans persistance si Foursquare est requis et indisponible', async () => {
    const parcoursHotelier = ParcoursSchema.parse({
      ...PARCOURS,
      contexte: {
        ...PARCOURS.contexte,
        dates: {
          debut: '2026-08-10T08:00:00.000Z',
          fin: '2026-08-12T20:00:00.000Z',
        },
        lieux: ['Bordeaux'],
      },
      timeline: [
        {
          id: 'nuit',
          titre: 'Nuit',
          elements: [
            {
              id: 'hotel',
              type: 'hebergement',
              nom: 'Un hébergement à choisir à Bordeaux',
              justification: 'dormir sur place',
              sejourHebergement: {
                ville: 'Bordeaux',
                arrivee: '2026-08-10',
                depart: '2026-08-12',
              },
            },
          ],
        },
      ],
    });
    prismaMock.parcours.findFirst.mockResolvedValueOnce({
      contenu: parcoursHotelier,
    });
    rechercherLieuxFoursquareMock.mockResolvedValueOnce({
      statut: 'indisponible',
      fournisseur: 'Foursquare',
      raison: 'timeout',
    });
    const sauvegardesAvant =
      prismaMock.parcours.upsert.mock.calls.length;

    const res = await auth(
      request(app).post(
        `/api/parcours/${PARCOURS_ID}/modifications`
      )
    ).send({
      demande: {
        type: 'remplacer_hotel',
        elementId: 'hotel',
        villeDemandee: 'Bordeaux',
        requete: 'Hôtel Burdigala',
      },
    });

    expect(res.status).toBe(503);
    expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(
      sauvegardesAvant
    );
  });

  it('422 sans appel externe ni persistance pour un séjour hors parcours', async () => {
    const parcoursHotelier = ParcoursSchema.parse({
      ...PARCOURS,
      contexte: {
        ...PARCOURS.contexte,
        dates: {
          debut: '2026-08-10T08:00:00.000Z',
          fin: '2026-08-12T20:00:00.000Z',
        },
        lieux: ['Bordeaux'],
      },
      timeline: [
        {
          id: 'nuit',
          titre: 'Nuit',
          elements: [
            {
              id: 'hotel',
              type: 'hebergement',
              nom: 'Un hébergement à choisir à Bordeaux',
              justification: 'dormir sur place',
              sejourHebergement: {
                ville: 'Bordeaux',
                arrivee: '2026-08-10',
                depart: '2026-08-12',
              },
            },
          ],
        },
      ],
    });
    prismaMock.parcours.findFirst.mockResolvedValueOnce({
      contenu: parcoursHotelier,
    });
    const sauvegardesAvant =
      prismaMock.parcours.upsert.mock.calls.length;
    const recherchesAvant =
      rechercherLieuxFoursquareMock.mock.calls.length;

    const res = await auth(
      request(app).post(
        `/api/parcours/${PARCOURS_ID}/modifications`
      )
    ).send({
      demande: {
        type: 'modifier_sejour_hebergement',
        elementId: 'hotel',
        sejour: {
          ville: 'Bordeaux',
          arrivee: '2026-09-01',
          depart: '2026-09-02',
        },
      },
    });

    expect(res.status).toBe(422);
    expect(prismaMock.parcours.upsert).toHaveBeenCalledTimes(
      sauvegardesAvant
    );
    expect(rechercherLieuxFoursquareMock).toHaveBeenCalledTimes(
      recherchesAvant
    );
  });
});

// ============================================================
// PUT /api/parcours/preferences — mémoire simple
// ============================================================
describe('PUT /api/parcours/preferences — validation', () => {

  it('401 sans token', async () => {
    const res = await request(app).put('/api/parcours/preferences').send({ ambiances: [] });
    expect(res.status).toBe(401);
  });

  it('400 si le rythme n\'est pas une valeur connue', async () => {
    const res = await auth(request(app).put('/api/parcours/preferences')).send({ rythme: 'frénétique' });
    expect(res.status).toBe(400);
  });

  it('400 si le budget habituel est négatif', async () => {
    const res = await auth(request(app).put('/api/parcours/preferences')).send({ budgetHabituel: -10 });
    expect(res.status).toBe(400);
  });

  it('400 si plus de 10 ambiances', async () => {
    const res = await auth(request(app).put('/api/parcours/preferences'))
      .send({ ambiances: Array.from({ length: 11 }, (_, i) => `ambiance ${i}`) });
    expect(res.status).toBe(400);
  });

  it('200 avec des préférences valides', async () => {
    const res = await auth(request(app).put('/api/parcours/preferences'))
      .send({ ambiances: ['gastronomie'], rythme: 'detendu', contraintes: [], lieuxFavoris: [] });
    expect(res.status).toBe(200);
  });
});
