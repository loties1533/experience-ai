
import express from 'express';
import { z } from 'zod';
import prisma from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { MODES_LIST } from '../lib/constants.js';
import type { TravelMode } from '../lib/types.js';
import type { Request, Response, NextFunction } from 'express';

const router = express.Router();

const schemaPreferences = z.object({
  default_mode:    z.enum(MODES_LIST as [TravelMode, ...TravelMode[]]).optional(),
  default_premium: z.boolean().optional(),
  preferred_prefs: z.array(z.string().max(50)).max(10).optional(),
  home_city:       z.string().max(100).optional(),
  currency:        z.string().length(3).optional()
});

// ---- GET /api/preferences ----
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user!.id;

    const preferences = await prisma.userPreference.findUnique({ where: { user_id: userId } });

    // Aucune ligne → préférences pas encore créées
    res.json({ preferences: preferences ?? null });

  } catch (err) {
    next(err);
  }
});

// ---- PUT /api/preferences ----  (créer ou mettre à jour)
router.put('/', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const donneesValidees = schemaPreferences.safeParse(req.body);
    if (!donneesValidees.success) {
      res.status(400).json({ error: donneesValidees.error.issues?.[0]?.message ?? 'Données invalides' });
      return;
    }
    const userId = req.user!.id;

    // Allowlist : on n'écrit QUE les colonnes fournies.
    const champsModifies: Record<string, unknown> = {};
    if (donneesValidees.data.default_mode    !== undefined) champsModifies.default_mode    = donneesValidees.data.default_mode;
    if (donneesValidees.data.default_premium !== undefined) champsModifies.default_premium = donneesValidees.data.default_premium;
    if (donneesValidees.data.preferred_prefs !== undefined) champsModifies.preferred_prefs = donneesValidees.data.preferred_prefs;
    if (donneesValidees.data.home_city       !== undefined) champsModifies.home_city       = donneesValidees.data.home_city;
    if (donneesValidees.data.currency        !== undefined) champsModifies.currency        = donneesValidees.data.currency;

    // upsert natif Prisma : crée si absent (user_id = PK), met à jour sinon.
    const preferences = await prisma.userPreference.upsert({
      where:  { user_id: userId },
      create: { user_id: userId, ...champsModifies },
      update: champsModifies,
    });

    res.json({ preferences });

  } catch (err) {
    next(err);
  }
});

export default router;
