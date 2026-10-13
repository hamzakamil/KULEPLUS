/**
 * Oturum saklama: "Beni hatırla" açıkken localStorage (kalıcı),
 * kapalıyken sessionStorage (sekme kapanınca silinir).
 */
const ACCESS_TOKEN_KEY = 'access_token';
const COMPANY_ID_KEY = 'company_id';
const REMEMBER_KEY = 'remember_me';

export function isRemembered(): boolean {
  return localStorage.getItem(REMEMBER_KEY) !== '0';
}

export function getAccessToken(): string | null {
  return (
    localStorage.getItem(ACCESS_TOKEN_KEY) ?? sessionStorage.getItem(ACCESS_TOKEN_KEY)
  );
}

export function getCompanyId(): string | null {
  return localStorage.getItem(COMPANY_ID_KEY) ?? sessionStorage.getItem(COMPANY_ID_KEY);
}

export function saveSession(accessToken: string, companyId: string, rememberMe: boolean): void {
  clearSession();
  const storage = rememberMe ? localStorage : sessionStorage;
  storage.setItem(ACCESS_TOKEN_KEY, accessToken);
  storage.setItem(COMPANY_ID_KEY, companyId);
  localStorage.setItem(REMEMBER_KEY, rememberMe ? '1' : '0');
}

export function saveAccessToken(accessToken: string): void {
  // Sessiz refresh sonrası: mevcut saklama yerine yaz (yer değiştirme yok)
  const storage = isRemembered() ? localStorage : sessionStorage;
  storage.setItem(ACCESS_TOKEN_KEY, accessToken);
}

export function clearSession(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(COMPANY_ID_KEY);
  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  sessionStorage.removeItem(COMPANY_ID_KEY);
}
