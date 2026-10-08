import { type Request, type Response, type NextFunction } from 'express';
import { type ZodSchema, type ZodError } from 'zod';
import { AppError } from '@kuleplus/shared';

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof Error && 'issues' in error) {
        const zodError = error as ZodError;
        const messages = zodError.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new AppError('VALIDATION_ERROR', messages);
      }
      throw error;
    }
  };
}
