import type { Request, Response, NextFunction } from 'express';

/**
 * F6-C — sous-code interne stable pour l'observabilité (benchmark inclus).
 * Jamais exposé au client : `gestionnairreErreurGlobal` ne le lit pas, il ne
 * sert qu'à distinguer, en interne, les causes aujourd'hui regroupées sous un
 * même statusCode 502 « sortie inexploitable ».
 */
export type CodeInterneEchec =
  | 'json_invalide'
  | 'schema_generation_invalide'
  | 'ref_dupliquee'
  | 'dependance_hors_lot'
  | 'ville_hors_lot'
  | 'plage_hors_lot'
  | 'validation_parcours_invalide'
  | 'autre_sortie_inexploitable';

export class AppError extends Error {
  statusCode: number;
  status: string;
  isOperational: boolean;
  codeInterne?: CodeInterneEchec;

  constructor(message: string, statusCode: number, codeInterne?: CodeInterneEchec) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.codeInterne = codeInterne;

    Error.captureStackTrace(this, this.constructor);
  }
}

export const gestionnairreErreurGlobal = (
  err: AppError & { stack?: string },
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    res.status(err.statusCode).json({
      status: err.status,
      error: err.message,
      message: err.message,
      stack: err.stack,
    });
  } else {
    // Mode Production : ne pas exposer les détails techniques
    if (err.isOperational) {
      res.status(err.statusCode).json({
        status: err.status,
        error: err.message,
        message: err.message,
      });
    } else {
      // Erreur inconnue (ex: crash programmation)
      console.error('Erreur :', err);
      res.status(500).json({
        status: 'error',
        message: 'Une erreur interne est survenue. Réessayez plus tard.',
      });
    }
  }
};
