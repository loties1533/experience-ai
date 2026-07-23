import type { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  status: string;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

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
