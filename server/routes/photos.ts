
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { getDestinationPhoto } from '../services/photo.js';
import { photosLimiter } from '../middleware/limiter.js';

const router = express.Router();

// ---- GET /api/photos/:city ----
router.get('/:city', photosLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const nomVille = req.params.city;
    if (typeof nomVille !== 'string' || !nomVille.trim()) {
      res.status(400).json({ error: 'city requis' });
      return;
    }

    const url = await getDestinationPhoto(nomVille.trim());
    res.json({ url });
  } catch (err) {
    next(err);
  }
});

export default router;
