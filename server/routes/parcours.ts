import { randomUUID } from 'node:crypto';
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
import { synchroniserLiens, revoquerTousLesLiens } from '../depots/depotPartage.js';
import { chargerPreferences, sauvegarderPreferences } from '../depots/depotPreferences.js';
import { PreferencesParcoursSchema } from '../domaine/preferences.js';
import { BriefSchema, BriefPartielSchema, EtatDialogueSchema } from '../agents/brief.js';
import { avancerDialogue } from '../agents/intake.js';
import { genererParcours } from '../agents/generation.js';
import { interpreterDemande } from '../agents/modification.js';
import { regenererModificationSurCopie } from '../agents/regenerationModification.js';
import {
  DemandeSurElementClientSchema,
  type DemandeDePartage,
  ParticipantSchema,
  VisibiliteSchema,
  appliquerModification,
  participantsPartageables,
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
// `etatDialogue` est un contexte transitoire de clarification (ex. une date
// approximative en attente de "oui"/"non"), jamais une information acquise :
// il transite à côté du brief, jamais dedans, et n'atteint jamais la
// génération (CorpsGenerationSchema plus bas ne connaît que BriefSchema).
const CorpsDialogueSchema = z.object({
  brief: BriefPartielSchema.default({}),
  message: z.string().min(1).max(500),
  etatDialogue: EtatDialogueSchema.optional(),
});
router.post(
  '/dialogue',
  requireAuth,
  aiChatLimiter,
  validateBody(CorpsDialogueSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { brief, message, etatDialogue } = req.body as z.infer<typeof CorpsDialogueSchema>;
      res.json(await avancerDialogue(brief, message, etatDialogue));
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
// Seules les demandes qui portent sur un ÉLÉMENT passent ici : le partage a
// ses propres routes, plus bas. Une porte par intention.
const CorpsModificationSchema = z.union([
  z.object({ demande: DemandeSurElementClientSchema }).strict(),
  z.object({ phrase: z.string().min(1).max(500) }).strict(),
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
      const demandeClient =
        'demande' in corps ? corps.demande : await interpreterDemande(parcours, corps.phrase);

      const contexteModification = {
        auteurId: auteurDe(parcours, req.user!.id),
        horodatage: new Date().toISOString(),
        creerId: randomUUID,
      };

      // F8-C : toute la préparation (application + régénération ciblée des
      // dépendants + validation) se fait EN MÉMOIRE sur une copie (F8-B).
      // Rien n'est écrit avant que cette copie soit entièrement valide —
      // et une seule écriture la persiste ensuite, jamais deux.
      const resultat = await regenererModificationSurCopie(
        parcours,
        demandeClient,
        contexteModification
      );
      if (!resultat.ok) {
        throw new AppError(
          resultat.erreur,
          resultat.statutHttp ?? 422
        );
      }

      await sauvegarderParcours(req.user!.id, resultat.parcours);
      res.json({
        parcours: resultat.parcours,
        elementsARegenerer: resultat.elementsRegeneres,
        description: resultat.description,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================================
// PARTAGE AU GROUPE (sprint R8) — côté organisateur
// Ces routes exigent un compte ET le rôle qui les autorise : un porteur de
// lien n'y accède jamais (il n'a pas de compte du tout).
// ============================================================

/**
 * L'état de partage tel que l'organisateur le voit : la visibilité, et la
 * liste complète des participants avec le lien de chacun — `chemin: null`
 * quand le domaine refuse de lui en remettre un (le héros d'une surprise).
 * Le serveur ne rend qu'un chemin : c'est le navigateur qui connaît l'origine
 * exacte, pas une variable d'environnement à tenir à jour.
 *
 * Aligne les liens au passage — émettre ce qui manque, révoquer ce qui n'a
 * plus lieu d'être. L'opération est idempotente et ne régénère jamais un lien
 * déjà envoyé : la consulter ne casse rien, et l'état ne peut pas dériver.
 */
async function etatPartage(parcours: Parcours) {
  let liens: { participantId: string; jeton: string }[] = [];
  if (parcours.visibilite === 'prive') {
    await revoquerTousLesLiens(parcours.id);
  } else {
    liens = await synchroniserLiens(parcours.id, participantsPartageables(parcours).map((p) => p.id));
  }
  const jetonPar = new Map(liens.map((l) => [l.participantId, l.jeton]));

  return {
    visibilite: parcours.visibilite,
    liens: parcours.participants.map((p) => ({
      participantId: p.id,
      nom: p.nom,
      role: p.role,
      chemin: jetonPar.has(p.id) ? `/partage/${jetonPar.get(p.id)}` : null,
    })),
  };
}

/** Charge le parcours de l'utilisateur ou échoue — répété sur chaque route. */
async function parcoursDe(req: Request): Promise<Parcours> {
  const parcours = await chargerParcours(req.user!.id, idValide(req));
  if (!parcours) throw new AppError('Parcours introuvable', 404);
  return parcours;
}

/**
 * Applique une demande au nom de l'utilisateur connecté, sauvegarde, et rend
 * le nouvel état de partage. Le domaine reste seule autorité : c'est lui qui
 * refuse si le rôle de l'auteur ne couvre pas la responsabilité engagée.
 */
async function appliquerEtRendreLePartage(
  req: Request,
  parcours: Parcours,
  demande: DemandeDePartage
) {
  const resultat = appliquerModification(parcours, demande, {
    auteurId: auteurDe(parcours, req.user!.id),
    horodatage: new Date().toISOString(),
  });
  if (!resultat.ok) throw new AppError(resultat.erreur, 422);

  await sauvegarderParcours(req.user!.id, resultat.parcours);
  return { parcours: resultat.parcours, partage: await etatPartage(resultat.parcours) };
}

// ---- GET /api/parcours/:id/partage — l'état du partage ----
router.get(
  '/:id/partage',
  requireAuth,
  validateParams(ParamsIdSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      res.json(await etatPartage(await parcoursDe(req)));
    } catch (err) {
      next(err);
    }
  }
);

// ---- PUT /api/parcours/:id/partage — choisir la visibilité ----
const CorpsVisibiliteSchema = z.object({ visibilite: VisibiliteSchema });
router.put(
  '/:id/partage',
  requireAuth,
  validateParams(ParamsIdSchema),
  validateBody(CorpsVisibiliteSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { visibilite } = req.body as z.infer<typeof CorpsVisibiliteSchema>;
      const resultat = await appliquerEtRendreLePartage(req, await parcoursDe(req), {
        type: 'changer_visibilite',
        visibilite,
      });
      res.json(resultat);
    } catch (err) {
      next(err);
    }
  }
);

// ---- POST /api/parcours/:id/participants — constituer le groupe ----
// L'id est attribué ICI : le client ne choisit pas l'identité des gens.
const CorpsParticipantSchema = ParticipantSchema.omit({ id: true }).extend({
  nom: z.string().min(1).max(60),
});
router.post(
  '/:id/participants',
  requireAuth,
  validateParams(ParamsIdSchema),
  validateBody(CorpsParticipantSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { nom, role } = req.body as z.infer<typeof CorpsParticipantSchema>;
      const resultat = await appliquerEtRendreLePartage(req, await parcoursDe(req), {
        type: 'ajouter_participant',
        participant: { id: randomUUID(), nom, role },
      });
      res.status(201).json(resultat);
    } catch (err) {
      next(err);
    }
  }
);

// ---- DELETE /api/parcours/:id/participants/:participantId ----
const ParamsParticipantSchema = ParamsIdSchema.extend({ participantId: z.string().min(1).max(100) });
router.delete(
  '/:id/participants/:participantId',
  requireAuth,
  validateParams(ParamsParticipantSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const resultat = await appliquerEtRendreLePartage(req, await parcoursDe(req), {
        type: 'retirer_participant',
        participantId: req.params.participantId as string,
      });
      res.json(resultat);
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
