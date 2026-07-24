import express from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validation.js';
import { aiChatLimiter, aiGenerateLimiter } from '../middleware/limiter.js';
import { AppError } from '../lib/AppError.js';
import {
  sauvegarderParcours,
  chargerParcours,
  listerParcours,
  supprimerParcours,
} from '../depots/depotParcours.js';
import { chargerPreferences, sauvegarderPreferences } from '../depots/depotPreferences.js';
import { PreferencesParcoursSchema } from '../domaine/preferences.js';
import { BriefSchema, BriefPartielSchema } from '../agents/brief.js';
import { avancerDialogue } from '../agents/intake.js';
import { genererParcours } from '../agents/generation.js';
import { interpreterDemande } from '../agents/modification.js';
import {
  DemandeModificationSchema,
  appliquerModification,
  type Parcours,
} from '../domaine/parcours/index.js';

// Routes de la refonte (montées sur /api/parcours). Cycle de vie du doc 05 :
// dialogue (intake) → brief confirmé → génération → restitution → modification
// ciblée → sauvegarde. Authz sur chaque route ; toute entrée passe par Zod.

const router = express.Router();

const ParamsIdSchema = z.object({ id: z.uuid() });

/** Après validateParams, l'id est garanti string (uuid) — Express 5 le type trop large. */
function idValide(req: Request): string {
  return req.params.id as string;
}

/**
 * Qui signe la modification (invariant 8). L'auteur, c'est l'utilisateur du JWT.
 * `chargerParcours` ne rend que les parcours de cet utilisateur : il en est donc
 * le propriétaire. S'il ne figure pas dans les participants — un parcours généré
 * porte un participant « Organisateur » d'id aléatoire, sans lien avec le compte
 * tant que le partage n'existe pas — on le rattache à cet organisateur : celui
 * qui a créé le parcours en est le responsable. Le jour où un parcours sera
 * partagé, chaque invité aura son propre participant et son propre rôle.
 */
function auteurDe(parcours: Parcours, userId: string): string {
  if (parcours.participants.some((p) => p.id === userId)) return userId;
  return parcours.participants.find((p) => p.role === 'organisateur')?.id ?? userId;
}

// ---- POST /api/parcours/dialogue — cadrage : une réponse, une question ----
const CorpsDialogueSchema = z.object({
  brief: BriefPartielSchema.default({}),
  message: z.string().min(1).max(500),
});
router.post(
  '/dialogue',
  requireAuth,
  aiChatLimiter,
  validateBody(CorpsDialogueSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { brief, message } = req.body as z.infer<typeof CorpsDialogueSchema>;
      res.json(await avancerDialogue(brief, message));
    } catch (err) {
      next(err);
    }
  }
);

// ---- POST /api/parcours — génération depuis un brief CONFIRMÉ (doc 05, étape 4) ----
const CorpsGenerationSchema = z.object({ brief: BriefSchema });
router.post(
  '/',
  requireAuth,
  aiGenerateLimiter,
  validateBody(CorpsGenerationSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { brief } = req.body as z.infer<typeof CorpsGenerationSchema>;
      const parcours = await genererParcours(brief, await chargerPreferences(req.user!.id));
      await sauvegarderParcours(req.user!.id, parcours);
      res.status(201).json({ parcours });
    } catch (err) {
      next(err);
    }
  }
);

// ---- GET /api/parcours — mes parcours (résumés) ----
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ parcours: await listerParcours(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

// ---- Préférences (mémoire simple, sprint R5) ----
// Déclarées AVANT /:id pour que « preferences » ne soit pas lu comme un id.
router.get('/preferences', requireAuth, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ preferences: await chargerPreferences(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

router.put(
  '/preferences',
  requireAuth,
  validateBody(PreferencesParcoursSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json({ preferences: await sauvegarderPreferences(req.user!.id, req.body) });
    } catch (err) {
      next(err);
    }
  }
);

// ---- GET /api/parcours/:id ----
router.get(
  '/:id',
  requireAuth,
  validateParams(ParamsIdSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parcours = await chargerParcours(req.user!.id, idValide(req));
      if (!parcours) throw new AppError('Parcours introuvable', 404);
      res.json({ parcours });
    } catch (err) {
      next(err);
    }
  }
);

// ---- POST /api/parcours/:id/modifications ----
// Deux entrées possibles : une demande structurée (le front sait déjà quoi),
// ou une phrase que l'agent Modification traduit. Dans les deux cas, c'est le
// domaine qui applique ou refuse — l'IA ne touche jamais l'état directement.
const CorpsModificationSchema = z.union([
  z.object({ demande: DemandeModificationSchema }),
  z.object({ phrase: z.string().min(1).max(500) }),
]);
router.post(
  '/:id/modifications',
  requireAuth,
  aiChatLimiter,
  validateParams(ParamsIdSchema),
  validateBody(CorpsModificationSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parcours = await chargerParcours(req.user!.id, idValide(req));
      if (!parcours) throw new AppError('Parcours introuvable', 404);

      const corps = req.body as z.infer<typeof CorpsModificationSchema>;
      const demande =
        'demande' in corps ? corps.demande : await interpreterDemande(parcours, corps.phrase);

      const resultat = appliquerModification(parcours, demande, {
        auteurId: auteurDe(parcours, req.user!.id),
        horodatage: new Date().toISOString(),
      });
      if (!resultat.ok) throw new AppError(resultat.erreur, 422);

      await sauvegarderParcours(req.user!.id, resultat.parcours);
      res.json({
        parcours: resultat.parcours,
        elementsARegenerer: resultat.elementsARegenerer,
        description: resultat.description,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---- DELETE /api/parcours/:id ----
router.delete(
  '/:id',
  requireAuth,
  validateParams(ParamsIdSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const supprime = await supprimerParcours(req.user!.id, idValide(req));
      if (!supprime) throw new AppError('Parcours introuvable', 404);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  }
);

export default router;
