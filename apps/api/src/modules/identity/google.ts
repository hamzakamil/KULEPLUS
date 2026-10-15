import { OAuth2Client } from 'google-auth-library';
import { AppError } from '@kuleplus/shared';

/**
 * Google ile giriş — ID token doğrulama (ADR-0023).
 *
 * Akış: Google Identity Services butonu tarayıcıda bir ID token (JWT) üretir ve
 * istemci bunu `POST /v1/auth/google` ile bize gönderir. Sunucu token'ı Google'ın
 * anahtarlarıyla doğrular (imza + `aud` = bizim client id + `iss` + süre), böylece
 * "bu e-posta adresi Google tarafından doğrulanmış" bilgisine güvenebiliriz.
 *
 * Neden klasik yönlendirmeli (authorization code) akış değil? Bu projede oturum
 * JWT + HttpOnly refresh çerezi ile zaten kendi token'larımızla kuruluyor; Google
 * tarafındaki refresh token'a (offline erişim) ihtiyacımız yok. ID token akışı
 * ek yönlendirme/state/PKCE durumu taşımaz, PWA + API ayrımında sorunsuz çalışır.
 *
 * Neden `google-auth-library`? Zaten bağımlılık (Gmail SMTP OAuth'u, SPEC §19) ve
 * JWKS önbellekleme + imza doğrulamasını kendi yürütür; elle JOSE kurulumu
 * gereksiz risk (anahtar rotasyonu) taşır.
 */

/** Doğrulanmış Google profilinden iç modelimize düşen alanlar. */
export interface GoogleClaims {
  /** Google hesabının değişmez kimliği (`sub`) — kimlik eşleştirmenin anahtarı. */
  providerAccountId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/** Doğrulayıcı sözleşmesi — testlerde sahte (mock) doğrulayıcı verilebilir. */
export interface GoogleCredentialVerifier {
  /** İmzası/süresi doğrulanmış claim'ler döner; doğrulanamazsa AppError fırlatır. */
  verify(credential: string): Promise<GoogleClaims>;
}

/** Google ile giriş etkin mi? Client id tanımlı değilse uçlar kapalı kalır. */
export function isGoogleLoginEnabled(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID);
}

/**
 * Ham ID token payload'ını iç modele çevirir (saf — birim testi buraya bakar).
 *
 * `email_verified` zorunludur: bu bayrak olmadan e-posta eşleştirmesi
 * (var olan hesabı devralma) mümkün olur — kabul edilemez bir hesap kaçırma riski.
 */
export function mapGoogleClaims(payload: {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}): GoogleClaims {
  const providerAccountId = payload.sub?.trim();
  const email = payload.email?.trim().toLowerCase();

  if (!providerAccountId || !email) {
    throw new AppError('UNAUTHENTICATED', 'Google hesabı doğrulanamadı');
  }
  if (payload.email_verified !== true) {
    throw new AppError(
      'UNAUTHENTICATED',
      'Google hesabınızın e-posta adresi doğrulanmamış. Lütfen e-posta + parola ile giriş yapın.',
    );
  }

  return {
    providerAccountId,
    email,
    displayName: payload.name?.trim() || null,
    avatarUrl: payload.picture?.trim() || null,
  };
}

/** Üretim doğrulayıcısı — Google'ın anahtarlarıyla imza/audience/iss denetimi yapar. */
export function createGoogleCredentialVerifier(
  clientId: string = process.env.GOOGLE_CLIENT_ID ?? '',
): GoogleCredentialVerifier {
  const oauth2Client = new OAuth2Client();

  return {
    async verify(credential: string): Promise<GoogleClaims> {
      if (!clientId) {
        throw new AppError('NOT_FOUND', 'Google ile giriş etkin değil');
      }

      let payload:
        | {
            sub?: string;
            email?: string;
            email_verified?: boolean;
            name?: string;
            picture?: string;
          }
        | undefined;
      try {
        const ticket = await oauth2Client.verifyIdToken({
          idToken: credential,
          audience: clientId,
        });
        payload = ticket.getPayload();
      } catch {
        // Google'a ulaşamamak da geçersiz imza da aynı şeyi söyler: kimlik doğrulanamadı.
        // Ayrıntı fırlatılmaz (SPEC §27.4 — loglama katmanı ayrıca sızdırmaz).
        throw new AppError(
          'UNAUTHENTICATED',
          'Google kimlik doğrulanamadı. Lütfen tekrar deneyin.',
        );
      }

      if (!payload) {
        throw new AppError('UNAUTHENTICATED', 'Google kimlik doğrulanamadı');
      }

      return mapGoogleClaims(payload);
    },
  };
}
