
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../db/prisma.js';
import { authLimiter } from '../middleware/limiter.js';
import { NOM_COOKIE_AUTH } from '../lib/constants.js';

// Schemas de validation
const schemaInscription = z.object({
  email:    z.string().email('Email invalide'),
  password: z.string().min(6, 'Mot de passe trop court (6 min)'),
  name:     z.string().min(2, 'Nom trop court').optional()
});

const schemaConnexion = z.object({
  email:    z.string().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis')
});

const router = express.Router();

const OPTIONS_COOKIE = {
  httpOnly: true,                                // inaccessible au JS du navigateur → protège du vol de token par XSS
  secure: process.env.NODE_ENV === 'production', // cookie envoyé uniquement en HTTPS en prod (http://localhost autorisé en dev)
  sameSite: 'strict' as const,                   // anti-CSRF maximal : le cookie n'est jamais envoyé par un autre site.
                                                 // Possible ici car le front React et l'API Express sont servis par le MÊME serveur (même origine).
  maxAge: 7 * 24 * 60 * 60 * 1000                // 7 jours
};

// ---- POST /api/auth/signup ----
router.post('/signup', authLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const donneesValidees = schemaInscription.safeParse(req.body);
    if (!donneesValidees.success) {
      res.status(400).json({ error: donneesValidees.error.issues[0].message });
      return;
    }
    const { email, password, name } = donneesValidees.data;

    // 1. Email déjà pris ?
    const emailDejaUtilise = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (emailDejaUtilise) {
      res.status(409).json({ error: 'Cet email est déjà utilisé' });
      return;
    }

    // 2. Hasher le mot de passe (le hash bcrypt est calculé ICI, côté serveur)
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    // 3. Insérer l'utilisateur (select explicite → le hash n'est jamais renvoyé)
    const user = await prisma.user.create({
      data:   { email, password: password_hash, name: name ?? null },
      select: { id: true, email: true, name: true, avatar_url: true, created_at: true },
    });

    // 4. Générer le JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );

    // 5. Envoyer le cookie httpOnly (le token n'est jamais renvoyé dans le body :
    //    le front s'appuie uniquement sur le cookie, inaccessible au JS)
    res.cookie(NOM_COOKIE_AUTH, token, OPTIONS_COOKIE);

    res.status(201).json({ user });

  } catch (err) {
    console.error('Erreur inscription :', err);
    next(err);
  }
});

// ---- POST /api/auth/login ----
router.post('/login', authLimiter, async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const donneesValidees = schemaConnexion.safeParse(req.body);
    if (!donneesValidees.success) {
      res.status(400).json({ error: donneesValidees.error.issues[0].message });
      return;
    }
    const { email, password } = donneesValidees.data;

    // 1. Chercher l'utilisateur (avec son hash, nécessaire pour bcrypt.compare).
    //    Même message d'erreur pour email inconnu ET mauvais mot de passe (anti-énumération).
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      return;
    }

    // 2. Vérifier le mot de passe
    const motDePasseValide = await bcrypt.compare(password, user.password);
    if (!motDePasseValide) {
      res.status(401).json({ error: 'Email ou mot de passe incorrect' });
      return;
    }

    // 3. Générer le token
    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      process.env.JWT_SECRET as string,
      { expiresIn: '7d' }
    );

    // 4. Cookie httpOnly uniquement — le token n'est pas exposé dans le body
    res.cookie(NOM_COOKIE_AUTH, token, OPTIONS_COOKIE);

    // On enlève le hash de la réponse
    const { password: _pw, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });

  } catch (err) {
    console.error('Erreur connexion :', err);
    next(err);
  }
});

// ---- POST /api/auth/logout ----
router.post('/logout', (req: Request, res: Response) => {
  res.clearCookie(NOM_COOKIE_AUTH, { ...OPTIONS_COOKIE, maxAge: 0 });
  res.json({ message: 'Déconnecté avec succès' });
});

// ---- GET /api/auth/me ----
router.get('/me', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = req.cookies?.[NOM_COOKIE_AUTH] || req.headers.authorization?.split(' ')[1];
    if (!token) {
      res.status(401).json({ error: 'Non authentifié' });
      return;
    }

    const tokenDecode = jwt.verify(token, process.env.JWT_SECRET as string) as jwt.JwtPayload;

    // Lecture de SON PROPRE profil : l'id vient du JWT déjà vérifié.
    const user = await prisma.user.findUnique({
      where:  { id: tokenDecode.id as string },
      select: { id: true, email: true, name: true, avatar_url: true, created_at: true },
    });
    if (!user) {
      res.status(401).json({ error: 'Utilisateur introuvable' });
      return;
    }

    res.json({ user });
  } catch {
    res.status(401).json({ error: 'Token invalide' });
  }
});

export default router;
