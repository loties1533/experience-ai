import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import type { JwtPayload } from '../lib/types.js';
import { NOM_COOKIE_AUTH } from '../lib/constants.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: JwtPayload;
  }
}

// Cookie en priorité (httpOnly = inaccessible JS = XSS proof), Bearer en fallback pour Supertest
function extraireToken(req: Request): string | null {
  if (req.cookies?.[NOM_COOKIE_AUTH]) return req.cookies[NOM_COOKIE_AUTH] as string;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.split(' ')[1];
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extraireToken(req);
  if (!token) {
    res.status(401).json({ error: 'Token manquant ou invalide' });
    return;
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
    next();
  } catch (err) {
    if ((err as Error).name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Session expirée, reconnecte-toi' });
      return;
    }
    res.status(401).json({ error: 'Token invalide' });
  }
}
