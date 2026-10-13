/**
 * E-posta şablon motoru (saf) — ROADMAP Faz 1/2 (docs/product/email-templates.md).
 *
 * Paylaşılan kernel (ADR-0020): hem API (`queueEmailTemplate`) hem worker (günlük/
 * haftalık özet e-postası) aynı şablonları üretir. Bu modül saf'tır — veritabanı
 * erişimi `queueEmailTemplate` (API tarafı) içinde yapılır.
 *
 * Güvenlik (SPEC §27.4): tüm değişkenler HTML-kaçışlı basılır — şablon girdileri
 * (firma adı, red gerekçesi, görev başlığı) kullanıcı verisidir.
 */

/** Envanterdeki şablon anahtarları — docs/product/email-templates.md ile birebir. */
export const EMAIL_TEMPLATES = [
  'auth.verify_email',
  'auth.reset_password',
  'core.invitation',
  'core.tenant_approved',
  'core.tenant_rejected',
  'core.welcome',
  'legal.terms_updated',
  'subscription.payment_failed',
  'subscription.expiring',
  'billing.invoice',
  'management.daily_digest',
  'management.weekly_digest',
  'management.task_reminder',
  'platform.support_access_granted',
  'legal.pilot_dpa_signed',
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATES)[number];

export type TemplateVars = Record<string, string>;

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND = 'Kuleplus';
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';

/** HTML kaçışı — tüm değişkenler bu fonksiyondan geçer (SPEC §27.4). */
function esc(value: string | undefined): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plain(value: string | undefined): string {
  return value ?? '';
}

/** Tek CTA bloğu — HTML butonu ve text düz karşılığı birlikte üretilir. */
function cta(url: string, label: string): { html: string; text: string } {
  return {
    html: `<p style="margin:28px 0"><a href="${esc(url)}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${esc(label)}</a></p>`,
    text: `${label}: ${url}`,
  };
}

/** Ortak gövde sarmalayıcısı (inline CSS — istemci uyumu). */
function layout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">
    <tr><td style="padding:20px 28px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#1d4ed8">&#9650; ${BRAND}</td></tr>
    <tr><td style="padding:28px;line-height:1.55">${bodyHtml}</td></tr>
    <tr><td style="padding:18px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">
      Bu mesaj ${BRAND} tarafından gönderildi. Bu işlemi siz yapmadıysanız bu e-postayı yok sayın.
    </td></tr>
  </table>
</body></html>`;
}

type Builder = (v: TemplateVars) => RenderedEmail;

/** Konu + gövde üreteçleri — envanterdeki "Değişkenler" kolonuyla birebir. */
const BUILDERS: Record<EmailTemplateKey, Builder> = {
  'auth.verify_email': (v) => {
    const link = cta(plain(v.verify_url), 'E-postamı doğrula');
    return {
      subject: `Kaydınızı tamamlayın — ${BRAND}`,
      html: layout(
        'E-posta doğrulama',
        `<p>Merhaba <strong>${esc(v.user_name)}</strong>,</p>
<p>${BRAND} hesabınızı aktive etmek için aşağıdaki bağlantıyı onaylayın. Bağlantı <strong>24 saat</strong> geçerlidir.</p>${link.html}`,
      ),
      text: `Merhaba ${plain(v.user_name)},\n\n${BRAND} hesabınızı aktive edin (bağlantı 24 saat geçerli).\n${link.text}`,
    };
  },

  'auth.reset_password': (v) => {
    const link = cta(plain(v.reset_url), 'Şifremi sıfırla');
    return {
      subject: `Şifre sıfırlama bağlantısı — ${BRAND}`,
      html: layout(
        'Şifre sıfırlama',
        `<p>Merhaba <strong>${esc(v.user_name)}</strong>,</p>
<p>Şifre sıfırlama talebi aldık. Bağlantı <strong>24 saat</strong> geçerlidir; talebi siz yapmadıysanız bu e-postayı yok sayın.</p>${link.html}`,
      ),
      text: `Merhaba ${plain(v.user_name)},\n\nŞifre sıfırlama talebiniz alındı (bağlantı 24 saat geçerli).\n${link.text}`,
    };
  },

  'core.invitation': (v) => {
    const link = cta(plain(v.invite_url), 'Daveti kabul et');
    return {
      subject: `${plain(v.tenant_name)} sizi ${BRAND} çalışma alanına davet etti`,
      html: layout(
        'Ekip daveti',
        `<p>Merhaba,</p>
<p><strong>${esc(v.inviter_name)}</strong> sizi <strong>${esc(v.tenant_name)}</strong> şirketinin ${BRAND} çalışma alanına davet etti. Davet <strong>7 gün</strong> geçerlidir.</p>${link.html}`,
      ),
      text: `Merhaba,\n\n${plain(v.inviter_name)} sizi ${plain(v.tenant_name)} çalışma alanına davet etti (davet 7 gün geçerli).\n${link.text}`,
    };
  },

  'core.tenant_approved': (v) => {
    const link = cta(`${APP_URL}/dashboard`, 'Panele git');
    return {
      subject: `Başvurunuz onaylandı — ${plain(v.tenant_name)}`,
      html: layout(
        'Başvuru onaylandı',
        `<p>Merhaba <strong>${esc(v.user_name)}</strong>,</p>
<p><strong>${esc(v.tenant_name)}</strong> şirketinin ${BRAND} hesabı aktif. Giriş yapıp ekip üyelerinizi davet edebilirsiniz.</p>${link.html}`,
      ),
      text: `Merhaba ${plain(v.user_name)},\n\n${plain(v.tenant_name)} hesabı aktif.\n${link.text}`,
    };
  },

  'core.tenant_rejected': (v) => ({
    subject: `Başvurunuz hakkında — ${BRAND}`,
    html: layout(
      'Başvuru reddedildi',
      `<p>Merhaba <strong>${esc(v.user_name)}</strong>,</p>
<p>Başvurunuz şu gerekçeyle tamamlanamadı:</p>
<blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #dc2626;background:#fef2f2">${esc(v.reason)}</blockquote>
<p>İtiraz veya ek bilgi için bu e-postayı yanıtlayabilirsiniz.</p>`,
    ),
    text: `Merhaba ${plain(v.user_name)},\n\nBaşvurunuz tamamlanamadı.\nGerekçe: ${plain(v.reason)}\nİtiraz için bu e-postayı yanıtlayın.`,
  }),

  'core.welcome': (v) => {
    const link = cta(plain(v.checklist_url) || `${APP_URL}/dashboard`, 'Kurulum adımlarını gör');
    return {
      subject: `${plain(v.tenant_name)} ile başlıyoruz — ${BRAND}`,
      html: layout(
        'Hoş geldiniz',
        `<p>Merhaba <strong>${esc(v.user_name)}</strong>,</p>
<p><strong>${esc(v.tenant_name)}</strong> hesabınız hazır. Cari ve stok kartlarını içe aktararak aynı gün kullanmaya başlayabilirsiniz.</p>${link.html}`,
      ),
      text: `Merhaba ${plain(v.user_name)},\n\n${plain(v.tenant_name)} hesabınız hazır.\n${link.text}`,
    };
  },
  'legal.terms_updated': (v) => ({
    subject: `Sözleşme güncellemesi (sürüm ${plain(v.version)}) — ${BRAND}`,
    html: layout(
      'Yasal metin güncellemesi',
      `<p>Merhaba <strong>${esc(v.user_name)}</strong>,</p>
<p>Yasal metinlerin <strong>${esc(v.version)}</strong> numaralı sürümü <strong>${esc(v.effective_date)}</strong> tarihinde yürürlüğe giriyor. Bir sonraki girişinizde onayınız istenecektir.</p>`,
    ),
    text: `Merhaba ${plain(v.user_name)},\n\nYasal metin sürüm ${plain(v.version)} — yürürlük: ${plain(v.effective_date)}.`,
  }),

  'subscription.payment_failed': (v) => {
    const link = cta(plain(v.retry_url), 'Ödeme yöntemini güncelle');
    return {
      subject: `Abonelik ödemeniz alınemedi — ${BRAND}`,
      html: layout(
        'Ödeme başarısız',
        `<p>Merhaba <strong>${esc(v.user_name)}</strong>,</p>
<p>Denenen tutar: <strong>${esc(v.amount)}</strong>. Modüllerin kapanmaması için ödeme yönteminizi güncelleyin.</p>${link.html}`,
      ),
      text: `Merhaba ${plain(v.user_name)},\n\nÖdeme alınamadı (tutar: ${plain(v.amount)}).\n${link.text}`,
    };
  },

  'subscription.expiring': (v) => {
    const link = cta(`${APP_URL}/dashboard`, 'Aboneliği yenile');
    return {
      subject: `Aboneliğiniz ${plain(v.days_left)} gün içinde bitiyor — ${BRAND}`,
      html: layout(
        'Abonelik uyarısı',
        `<p>Merhaba <strong>${esc(v.user_name)}</strong>,</p>
<p>Aboneliğiniz <strong>${esc(v.days_left)}</strong> gün sonra sona erecek. Verileriniz saklı kalır; yenilediğinizde kaldığınız yerden devam edersiniz.</p>${link.html}`,
      ),
      text: `Merhaba ${plain(v.user_name)},\n\nAboneliğiniz ${plain(v.days_left)} gün içinde bitiyor.\n${link.text}`,
    };
  },

  'billing.invoice': (v) => {
    const link = cta(plain(v.invoice_pdf), 'Faturayı indir (PDF)');
    return {
      subject: `Platform faturanız hazır — ${BRAND}`,
      html: layout(
        'Platform faturası',
        `<p>Merhaba <strong>${esc(v.user_name)}</strong>,</p>
<p>Dönem faturanız oluştu. Aşağıdaki bağlantıdan PDF nüshasını indirebilirsiniz.</p>${link.html}`,
      ),
      text: `Merhaba ${plain(v.user_name)},\n\nPlatform faturanız hazır.\n${link.text}`,
    };
  },

  'management.daily_digest': (v) => {
    const link = cta(`${APP_URL}/dashboard`, 'Detaylı görüntüle');
    return {
      subject: `Günlük özet — ${plain(v.date)}`,
      html: layout(
        'Günlük özet',
        `<p>Merhaba <strong>${esc(v.user_name)}</strong>,</p>
<p>${esc(v.date)} günü özeti:</p>
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;white-space:pre-line">${esc(v.summary)}</div>
${link.html}`,
      ),
      text: `Merhaba ${plain(v.user_name)},\n\n${plain(v.date)} özeti:\n${plain(v.summary)}\n${link.text}`,
    };
  },

  'management.weekly_digest': (v) => {
    const link = cta(`${APP_URL}/reports`, 'Raporlara git');
    return {
      subject: `Haftalık özet — ${BRAND}`,
      html: layout(
        'Haftalık özet',
        `<p>Merhaba <strong>${esc(v.user_name)}</strong>,</p>
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;white-space:pre-line">${esc(v.week_summary)}</div>
${link.html}`,
      ),
      text: `Merhaba ${plain(v.user_name)},\n\n${plain(v.week_summary)}\n${link.text}`,
    };
  },

  'management.task_reminder': (v) => {
    const link = cta(`${APP_URL}/dashboard`, 'Görevi aç');
    return {
      subject: `Hatırlatma: ${plain(v.task_title)}`,
      html: layout(
        'Görev hatırlatması',
        `<p>Merhaba <strong>${esc(v.user_name)}</strong>,</p>
<p><strong>${esc(v.task_title)}</strong> başlıklı görevinizin son tarihi: <strong>${esc(v.due)}</strong>.</p>${link.html}`,
      ),
      text: `Merhaba ${plain(v.user_name)},\n\nGörev: ${plain(v.task_title)} — son tarih: ${plain(v.due)}\n${link.text}`,
    };
  },

  'platform.support_access_granted': (v) => ({
    subject: `Destek erişimi tanımlandı — ${plain(v.tenant_name)}`,
    html: layout(
      'Destek erişimi',
      `<p>Merhaba,</p>
<p><strong>${esc(v.tenant_name)}</strong> hesabı için süreli destek erişimi tanımlandı.</p>
<ul><li><strong>Gerekçe:</strong> ${esc(v.reason)}</li><li><strong>Süre:</strong> ${esc(v.duration)}</li></ul>
<p>Tüm erişimler denetim günlüğünde kayıt altındadır.</p>`,
    ),
    text: `${plain(v.tenant_name)} hesabı için destek erişimi.\nGerekçe: ${plain(v.reason)}\nSüre: ${plain(v.duration)}`,
  }),

  'legal.pilot_dpa_signed': (v) => {
    const link = cta(`${APP_URL}/dashboard`, 'Belgeleri gör');
    return {
      subject: `Veri işleme sözleşmesi imzalandı — ${plain(v.tenant_name)}`,
      html: layout(
        'DPA imzası',
        `<p>Merhaba <strong>${esc(v.user_name)}</strong>,</p>
<p><strong>${esc(v.tenant_name)}</strong> için kişisel veri işleme sözleşmesi imzalandı. İmzalı nüsha hesap belgelerinde saklanıyor.</p>${link.html}`,
      ),
      text: `Merhaba ${plain(v.user_name)},\n\n${plain(v.tenant_name)} veri işleme sözleşmesi imzalandı.\n${link.text}`,
    };
  },
};

/** Şablonlardaki buton bağlantılarının kökü (web uygulaması). */
export function appUrl(): string {
  return APP_URL;
}

/** Şablonu üretir. Bilinmeyen anahtar = program hatası (throw). */
export function renderEmailTemplate(key: EmailTemplateKey, vars: TemplateVars = {}): RenderedEmail {
  const builder = BUILDERS[key];
  if (!builder) throw new Error(`Bilinmeyen e-posta şablonu: ${String(key)}`);
  return builder(vars);
}
