import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES } from '../src/errors/codes';

describe('hata kodları (SPEC §22 — docs/api/error-codes.md ile eşleşir)', () => {
  it('katalog md dosyasındaki satırlarla birebir aynıdır', () => {
    expect(ERROR_CODES.PERIOD_LOCKED).toEqual({
      httpStatus: 409,
      module: 'accounting',
      message: 'Bu dönem işlem girişine kapalıdır.',
    });
    expect(ERROR_CODES.MODULE_NOT_ENTITLED.httpStatus).toBe(403);
    expect(ERROR_CODES.LIMIT_EXCEEDED.module).toBe('subscription');
    expect(ERROR_CODES.VERSION_MISMATCH.httpStatus).toBe(409);
    expect(ERROR_CODES.TENANT_FORBIDDEN.module).toBe('core');
    expect(ERROR_CODES.SUPPORT_ACCESS_REQUIRED.module).toBe('platform');
  });

  it('AppError sözleşme gövdesi üretir', () => {
    const err = new AppError('MODULE_NOT_ENTITLED');
    expect(err.httpStatus).toBe(403);
    expect(err.toJSON()).toEqual({
      error: { code: 'MODULE_NOT_ENTITLED', message: 'Bu modül paketinizde yok.' },
    });
  });
});
