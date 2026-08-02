// =============================================
// EXPERIENCE AI — tests/unit/photosLimiter.test.ts
// GET /api/photos/:city déclenche un appel fournisseur externe (Unsplash/
// Pexels) : sans limiteur, un client peut vider les quotas en balayant des
// villes distinctes (jamais en cache). On vérifie ici que le limiteur est
// bien branché sur la route, pas le comportement d'express-rate-limit
// lui-même (déjà testé par la librairie).
// =============================================

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../server/services/photo.js', () => ({
  getDestinationPhoto: vi.fn().mockResolvedValue('https://example.com/photo.jpg'),
}));

import photosRouter from '../../server/routes/photos.js';
import { photosLimiter } from '../../server/middleware/limiter.js';

describe('GET /api/photos/:city — limiteur de débit', () => {
  it('le limiteur de photos plafonne à 60 requêtes par fenêtre', async () => {
    const app = express();
    app.use('/api/photos', photosRouter);

    for (let i = 0; i < 60; i++) {
      const res = await request(app).get(`/api/photos/ville-${i}`);
      expect(res.status).toBe(200);
    }

    const res = await request(app).get('/api/photos/ville-au-dela');
    expect(res.status).toBe(429);
  });

  it('photosLimiter est bien la fonction montée sur la route', () => {
    const couche = (photosRouter as any).stack.find((c: any) => c.route?.path === '/:city');
    const middlewares = couche.route.stack.map((s: any) => s.handle);
    expect(middlewares).toContain(photosLimiter);
  });
});
