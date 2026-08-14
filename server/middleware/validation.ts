import type { Request, Response, NextFunction } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { AppError } from '../lib/AppError.js';

function formaterErreurZod(error: ZodError) {
  return error.issues.map((issue) => {
    if (issue.path.length > 0) {
      return `${issue.path.join('.')} : ${issue.message}`;
    }
    return issue.message;
  }).join(', ');
}

export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new AppError(formaterErreurZod(result.error), 400));
      return;
    }
    req.body = result.data;
    next();
  };
}

export function validateParams<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(new AppError(formaterErreurZod(result.error), 400));
      return;
    }
    req.params = result.data as Request['params'];
    next();
  };
}
