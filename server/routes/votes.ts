
import express from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import prisma from '../db/prisma.js';
import type { Request, Response, NextFunction } from 'express';

const schemaVote = z.object({
  pack_id:    z.string().uuid('pack_id invalide'),
  item_id:    z.string().min(1, 'item_id requis'),
  vote_type:  z.boolean(),
  voter_name: z.string().max(50).optional()
});

const router = express.Router();

// Max 10 votes par minute par IP
const voteLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: { error: 'Trop de votes, réessaie dans une minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(voteLimiter);

// ---- POST /api/votes ----
// Permet de voter pour un élément du pack (public via lien)
router.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const donneesValidees = schemaVote.safeParse(req.body);
    if (!donneesValidees.success) {
      res.status(400).json({ error: donneesValidees.error.issues?.[0]?.message ?? 'Données invalides' });
      return;
    }
    const { pack_id, item_id, voter_name, vote_type } = donneesValidees.data;

    // trip_votes est PUBLIC : les amis votent via le lien de partage, sans compte.
    const vote = await prisma.tripVote.create({
      data: { pack_id, item_id, voter_name: voter_name || 'Anonyme', vote_type },
    });

    res.status(201).json({ message: 'Vote enregistré !', vote });

  } catch (err) {
    console.error('Erreur vote :', err);
    next(err);
  }
});

// ---- GET /api/votes/:pack_id ----
// Récupérer tous les votes pour un pack donné
router.get('/:pack_id', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const votes = await prisma.tripVote.findMany({
      where:   { pack_id: String(req.params.pack_id) },
      orderBy: { created_at: 'asc' },
    });

    res.json({ votes });

  } catch (err) {
    console.error('Erreur récupération votes :', err);
    next(err);
  }
});

export default router;
