import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { sendError } from '../utils/api-response';

/**
 * Global hata yakalama middleware'i
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error('Hata:', { message: err.message, stack: err.stack });

  // Mongoose validation hatası
  if (err.name === 'ValidationError') {
    sendError(res, 'Doğrulama hatası', 400, err.message);
    return;
  }

  // Mongoose duplicate key hatası
  if (err.name === 'MongoServerError' && (err as any).code === 11000) {
    sendError(res, 'Bu kayıt zaten mevcut', 409, err.message);
    return;
  }

  // JWT hatası
  if (err.name === 'JsonWebTokenError') {
    sendError(res, 'Geçersiz token', 401);
    return;
  }

  if (err.name === 'TokenExpiredError') {
    sendError(res, 'Token süresi dolmuş', 401);
    return;
  }

  // İş mantığı hataları (throw new Error(...))
  if (err.message) {
    sendError(res, err.message, 400);
    return;
  }

  sendError(res, 'Sunucu hatası', 500);
}
