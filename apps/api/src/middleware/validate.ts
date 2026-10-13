import { type Request, type Response, type NextFunction } from 'express';
import { type ZodSchema, type ZodError } from 'zod';
import { AppError } from '@kuleplus/shared';

export function validate(schema: ZodSchema, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const data = source === 'body' ? req.body : source === 'query' ? req.query : req.params;
      const parsed = schema.parse(data);
      if (source === 'body') {
        req.body = parsed;
      } else if (source === 'query') {
        req.query = parsed as unknown as Record<string, string>;
      } else {
        req.params = parsed as unknown as Record<string, string>;
      }
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
