import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { sendError } from '../utils/api-response';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

/**
 * JWT kimlik doğrulama middleware'i
 */
export function authenticate(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    sendError(res, 'Yetkilendirme token\'ı bulunamadı', 401);
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      role: string;
    };
    req.userId = decoded.userId;
    req.userRole = decoded.role;
    next();
  } catch {
    sendError(res, 'Geçersiz veya süresi dolmuş token', 401);
  }
}

/**
 * Rol bazlı yetkilendirme
 */
export function authorize(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      sendError(res, 'Bu işlem için yetkiniz yok', 403);
      return;
    }
    next();
  };
}
