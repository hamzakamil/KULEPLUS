import { type Request, type Response, type NextFunction } from 'express';
import { jwtVerify } from 'jose';
import { AppError } from '@kuleplus/shared';

export interface AuthenticatedRequest extends Request {
  user?: {
    sub: string;
    email: string;
    jti?: string;
    tenantId?: string;
    authVersion?: number;
  };
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('UNAUTHENTICATED', 'Yetkilendirme başlığı eksik');
    }

    const token = authHeader.slice(7);
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!),
    );

    (req as AuthenticatedRequest).user = {
      sub: payload.sub as string,
      email: payload.email as string,
      jti: payload.jti as string,
      tenantId: payload.tenantId as string | undefined,
      authVersion: payload.authVersion as number | undefined,
    };
    next();
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNAUTHENTICATED') {
      throw error;
    }
    if (error instanceof Error && error.message.startsWith('UNAUTHENTICATED')) {
      throw new AppError('UNAUTHENTICATED', error.message.slice('UNAUTHENTICATED: '.length));
    }
    throw new AppError('UNAUTHENTICATED', 'Geçersiz veya süresi dolmuş token');
  }
}

export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();

  try {
    const token = authHeader.slice(7);
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!),
    );
    (req as AuthenticatedRequest).user = {
      sub: payload.sub as string,
      email: payload.email as string,
      jti: payload.jti as string,
      tenantId: payload.tenantId as string | undefined,
      authVersion: payload.authVersion as number | undefined,
    };
  } catch {
    // Token geçersizse sessizce devam et
  }
  next();
}
