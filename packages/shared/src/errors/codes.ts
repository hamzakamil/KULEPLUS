/**
 * Hata kodu kataloğu — SPEC §22.1/§22.2 · docs/api/error-codes.md ile eşleşir.
 * Tek kaynak burasıdır; md katalog bu dosyadan üretilir (Faz 1 CI senkron kontrolü).
 * Frontend çevirisi: `t("errors." + code)` (docs/product/i18n.md).
 */
export const ERROR_CODES = {
  PERIOD_LOCKED: {
    httpStatus: 409,
    module: 'accounting',
    message: 'Bu dönem işlem girişine kapalıdır.',
  },
  MODULE_NOT_ENTITLED: {
    httpStatus: 403,
    module: 'subscription',
    message: 'Bu modül paketinizde yok.',
  },
  LIMIT_EXCEEDED: {
    httpStatus: 409,
    module: 'subscription',
    message: 'Kota aşıldı.',
  },
  VERSION_MISMATCH: {
    httpStatus: 409,
    module: 'core',
    message: 'Kayıt başkası tarafından güncellendi.',
  },
  IDEMPOTENCY_KEY_CONFLICT: {
    httpStatus: 409,
    module: 'core',
    message: 'Bu istek daha önce işlendi.',
  },
  CONFLICT: {
    httpStatus: 409,
    module: 'core',
    message: 'Bu kayıt zaten mevcut.',
  },
  TENANT_FORBIDDEN: {
    httpStatus: 403,
    module: 'core',
    message: "Bu tenant'a erişim yetkiniz yok.",
  },
  SUPPORT_ACCESS_REQUIRED: {
    httpStatus: 403,
    module: 'platform',
    message: 'Destek erişim grantı gerekli.',
  },
  NOT_FOUND: {
    httpStatus: 404,
    module: 'core',
    message: 'İstenen kaynak bulunamadı.',
  },
  INTERNAL_ERROR: {
    httpStatus: 500,
    module: 'core',
    message: 'Beklenmeyen bir hata oluştu.',
  },
  UNAUTHENTICATED: {
    httpStatus: 401,
    module: 'core',
    message: 'Kimlik doğrulama başarısız.',
  },
  FORBIDDEN: {
    httpStatus: 403,
    module: 'core',
    message: 'Bu işlem için yetkiniz yok.',
  },
  INSUFFICIENT_BALANCE: {
    httpStatus: 409,
    module: 'accounting',
    message: 'Yetersiz bakiye.',
  },
  VALIDATION_ERROR: {
    httpStatus: 400,
    module: 'core',
    message: 'Geçersiz istek verisi.',
  },
  EXTERNAL_SERVICE_ERROR: {
    httpStatus: 503,
    module: 'core',
    message: 'Harici servis erişilemiyor.',
  },
  RATE_LIMITED: {
    httpStatus: 429,
    module: 'core',
    message: 'Çok fazla deneme yaptınız. Lütfen biraz bekleyip tekrar deneyin.',
  },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** API hata sözleşmesi (SPEC §22.1): her yanıt `code` taşır. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly module: string;

  constructor(code: ErrorCode, detail?: string) {
    const spec = ERROR_CODES[code];
    super(detail ?? spec.message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = spec.httpStatus;
    this.module = spec.module;
  }

  /** JSON gövdesi — API tek biçimi bunu kullanır. */
  toJSON(): { error: { code: ErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}
