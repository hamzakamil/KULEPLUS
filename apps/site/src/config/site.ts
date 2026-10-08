import type { MessageKey } from '../i18n';

/**
 * Site/marka konfigürasyonu — tek doğruluk kaynağı.
 * Not: brand.md henüz placeholder; domain/e-posta değerleri Faz 0'da güncellenecek.
 */
export const SITE = {
  name: 'Kuleplus',
  tagline: 'Patron için sade, muhasebeci için derin.',
  description:
    'Türkiye mevzuatına (e-Fatura, KDV, Tek Düzen Hesap Planı, KVKK) uyumlu, modüler bulut ön muhasebe ve ERP platformu. Ücretsiz çekirdek ile başlayın, modülleri ihtiyacınız kadar satın alın.',
  // Astro config'teki `site` değeri (canonical/sitemap için)
  url: import.meta.env.SITE ?? 'http://localhost:4321',
  appUrl: (import.meta.env.PUBLIC_APP_URL ?? 'http://localhost:5173').replace(/\/$/, ''),
  signupUrl: (import.meta.env.PUBLIC_SIGNUP_URL ?? 'http://localhost:5173/kayit').replace(
    /\/$/,
    '',
  ),
  apiUrl: (import.meta.env.PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  plausibleDomain: import.meta.env.PUBLIC_PLAUSIBLE_DOMAIN ?? '',
  // TODO(Faz 0): brand.md doldurulunca gerçek destek adresi ile değiştirilecek
  supportEmail: 'destek@kuleplus.com',
} as const;

export interface NavLink {
  href: string;
  labelKey: MessageKey;
}

export const NAV: NavLink[] = [
  { href: '/', labelKey: 'site.nav.home' },
  { href: '/ozellikler', labelKey: 'site.nav.features' },
  { href: '/fiyatlandirma', labelKey: 'site.nav.pricing' },
  { href: '/mali-musavirler-icin', labelKey: 'site.nav.accountants' },
  { href: '/yardim', labelKey: 'site.nav.help' },
  { href: '/blog', labelKey: 'site.nav.blog' },
  { href: '/iletisim', labelKey: 'site.nav.contact' },
];
