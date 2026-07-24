import express from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';
import { validateBody, validateParams } from '../middleware/validation.js';
import { partageLimiter } from '../middleware/limiter.js';
import { AppError } from '../lib/AppError.js';
import { chargerParcoursParJeton, type AccesParJeton } from '../depots/depotPartage.js';
import { sauvegarderParcours } from '../depots/depotParcours.js';
import {
  AvisSchema,
  appliquerModification,
  verifierAccesPartage,
} from '../domaine/parcours/index.js';

// Routes du lien de partage (montées sur /api/partage) — les SEULES routes du
// produit ouvertes sans compte.
//
// Ce qu'un jeton donne : consulter le parcours, et donner son avis sur ses
// éléments. Rien d'autre. Il ne donne JAMAIS les droits d'un compte : ni
// modifier le parcours, ni changer sa visibilité, ni émettre d'autres liens —
// ces gestes-là ne vivent que sur /api/parcours, derrière `requireAuth`.
//
// Le jeton désigne un participant : c'est de LUI que vient le rôle, jamais du
// client. Le domaine tranche ensuite (verifierAccesPartage + invariant 8).

const router = express.Router();

// 32 octets en base64url font 43 caractères ; la borne large couvre une
// éventuelle évolution de la longueur sans rien laisser passer d'exotique.
const ParamsJetonSchema = z.object({
  jeton: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, 'lien de partage invalide'),
});

/**
 * Reconnaît le porteur du lien, puis laisse le domaine dire s'il a le droit de
 * voir. Un refus et un jeton inconnu rendent la MÊME chose (404) : on ne
 * confirme jamais l'existence d'un parcours à qui n'y a pas accès — et le
 * héros d'une surprise ne doit pas apprendre qu'une surprise se prépare.
 */
async function acces(req: Request): Promise<AccesParJeton> {
  const jeton = req.params.jeton as string;
  const trouve = await chargerParcoursParJeton(jeton);
  if (!trouve) throw new AppError("Ce lien n'est plus valide", 404);

  const refus = verifierAccesPartage(trouve.parcours, trouve.participantId);
  if (refus) throw new AppError("Ce lien n'est plus valide", 404);
  return trouve;
}

// ---- GET /api/partage/:jeton — consulter le parcours partagé ----
router.get(
  '/:jeton',
  partageLimiter,
  validateParams(ParamsJetonSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { parcours, participantId } = await acces(req);
      res.json({
        parcours,
        // Le porteur voit sous quelle identité il consulte : c'est ce qui rend
        // sa réaction signée sans qu'il ait à taper son nom.
        participant: parcours.participants.find((p) => p.id === participantId),
      });
    } catch (err) {
      next(err);
    }
  }
);

// ---- POST /api/partage/:jeton/reactions — l'avis qui éclaire ----
// PAS un vote qui décide : l'organisateur tranche (invariant 8, doc 07).
const CorpsReactionSchema = z.object({
  elementId: z.string().min(1).max(100),
  avis: AvisSchema,
});
router.post(
  '/:jeton/reactions',
  partageLimiter,
  validateParams(ParamsJetonSchema),
  validateBody(CorpsReactionSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { parcours, participantId, proprietaireId } = await acces(req);
      const { elementId, avis } = req.body as z.infer<typeof CorpsReactionSchema>;

      // Même porte que toutes les autres modifications : le domaine applique
      // ou refuse, en fonction du rôle du participant que le jeton désigne.
      const resultat = appliquerModification(
        parcours,
        { type: 'reagir_element', elementId, avis },
        { auteurId: participantId, horodatage: new Date().toISOString() }
      );
      if (!resultat.ok) throw new AppError(resultat.erreur, 422);

      // Le propriétaire vient de la ligne de partage, jamais du client : un
      // jeton ne permet donc pas d'écrire dans le parcours de quelqu'un d'autre.
      await sauvegarderParcours(proprietaireId, resultat.parcours);
      res.json({ parcours: resultat.parcours, description: resultat.description });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
