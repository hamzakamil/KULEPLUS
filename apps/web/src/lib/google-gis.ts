/**
 * Google Identity Services (GIS) tarayıcı yükleyicisi — ADR-0023.
 *
 * Neden ayrı modül? Script etiketi TEK sefer yüklenmelidir (iki kez yüklemek GIS
 * tarafında çift buton / yeniden başlatma uyarıları üretir); hem giriş hem kayıt
 * ekranı butonu gösterdiği için tek (singleton) yükleme promise'ı burada durur.
 *
 * Gizlilik: Script YALNIZCA `GET /v1/auth/google/config` `enabled: true` dönerse
 * yüklenir — sosyal girişin kapalı olduğu kurulumlarda (ve yerel geliştirmede)
 * kullanıcıya üçüncü taraf kodu inmez.
 *
 * Akış: `renderButton` → Google popup'ı → `callback({ credential })` → istemci bu
 * ID token'ı `POST /v1/auth/google` ile gönderir → sunucu doğrular ve kendi
 * token'larımızı (access + HttpOnly refresh çerezi) kurar. Google refresh token'ı
 * hiçbir zaman saklanmaz; yalnızca kimlik kanıtı olarak kullanılır.
 */

const GSI_SRC = 'https://accounts.google.com/gsi/client';

/** GIS callback payload'ı — bizi yalnızca `credential` (ID token) ilgilendirir. */
export interface GoogleCredentialResponse {
  credential?: string;
}

interface GsiIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  /** Otomatik oturum açma denemesi kapalı: giriş YALNIZCA butona tıklayınca olur. */
  auto_select?: boolean;
  ux_mode?: 'popup' | 'redirect';
}

interface GsiButtonOptions {
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  shape?: 'rectangular' | 'pill' | 'circle';
  logo_alignment?: 'left' | 'center';
  width?: number;
}

interface GsiIdApi {
  initialize(config: GsiIdConfiguration): void;
  renderButton(element: HTMLElement, options?: GsiButtonOptions): void;
}

interface GsiNamespace {
  accounts: { id: GsiIdApi };
}

declare global {
  interface Window {
    google?: GsiNamespace;
  }
}

let loader: Promise<void> | null = null;

/** GIS script'ini bir kez yükler (sonraki çağrılar aynı promise'ı alır). */
export function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Google ile giriş yalnızca tarayıcıda çalışır'));
  }
  if (window.google?.accounts.id) return Promise.resolve();

  if (!loader) {
    loader = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        // Başarısız deneme önbellekte kalmasın — kullanıcı sayfayı yenileyince tekrar denenir
        loader = null;
        reject(new Error('Google giriş hizmeti yüklenemedi'));
      };
      document.head.appendChild(script);
    });
  }
  return loader;
}

/**
 * Google butonunu verilen öğeye basar.
 *
 * `onError` bilinçli olarak enjekte edilir: buton Google'da hata verirse formun
 * kendi hata kutusu göstermeli (sessiz ölü buton → kullanıcı "işlemiyor" sanır).
 */
export async function mountGoogleSignInButton(
  element: HTMLElement,
  options: {
    clientId: string;
    /** Kayıt ekranında "signup_with", girişte "signin_with" etiketi kullanılır. */
    text?: GsiButtonOptions['text'];
    onCredential: (credential: string) => void;
    onError?: (error: Error) => void;
  },
): Promise<void> {
  try {
    await loadGoogleIdentityScript();
    const id = window.google?.accounts.id;
    if (!id) throw new Error('Google giriş hizmeti hazır değil');

    id.initialize({
      client_id: options.clientId,
      auto_select: false,
      ux_mode: 'popup',
      callback: (response) => {
        if (!response.credential) {
          options.onError?.(new Error('Google kimlik belirteci alınamadı. Tekrar deneyin.'));
          return;
        }
        options.onCredential(response.credential);
      },
    });

    id.renderButton(element, {
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      logo_alignment: 'left',
      text: options.text ?? 'signin_with',
    });
  } catch (error) {
    options.onError?.(error instanceof Error ? error : new Error('Google ile giriş başlatılamadı'));
  }
}
