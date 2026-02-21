import { Response } from 'express';

/**
 * Standart API yanıt formatı
 */
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
  };
}

export function sendSuccess<T>(res: Response, data: T, message?: string, statusCode = 200): void {
  const response: ApiResponse<T> = {
    success: true,
    data,
    message,
  };
  res.status(statusCode).json(response);
}

export function sendError(res: Response, error: string, statusCode = 500, details?: string): void {
  const response: ApiResponse = {
    success: false,
    error,
    message: details,
  };
  res.status(statusCode).json(response);
}

export function sendPaginated<T>(
  res: Response,
  data: T[],
  total: number,
  page: number,
  limit: number
): void {
  const response: ApiResponse<T[]> = {
    success: true,
    data,
    meta: { page, limit, total },
  };
  res.status(200).json(response);
}
