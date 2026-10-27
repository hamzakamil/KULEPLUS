import type { PoolClient } from 'pg';
import type { BookProfile } from './generator';

/**
 * e-Defter şirket/SMMM bilgileri. Ayarlar → Firma Profili'nde girilir ve
 * `tenant_settings(key='company_profile').settings.edefter` altında saklanır; VKN ve unvan
 * `tenants` tablosundan gelir (ticaret unvanı yoksa şirket adı).
 */
export interface EdefterSettings {
  /** Unvanı ticaret sicilindeki gibi, kısaltmasız (boşsa tenants.trade_name / name). */
  title?: string;
  nace?: string;
  phone?: string;
  fax?: string;
  email?: string;
  website?: string;
  address?: {
    buildingNumber?: string;
    street?: string;
    street2?: string;
    city?: string;
    postalCode?: string;
    country?: string;
  };
  accountants?: Array<{
    name?: string;
    /** SMMM sözleşmesi / Tam Tasdik sözleşmesi … */
    contractType?: string;
    contractDate?: string;
    contractNo?: string;
    phone?: string;
    email?: string;
    address?: {
      buildingNumber?: string;
      street?: string;
      city?: string;
      postalCode?: string;
      country?: string;
    };
  }>;
  /** Defterler işletme bünyesinde tutuluyorsa muhasebe yetkilisi; sözleşme alanı "-" olur. */
  inHouse?: boolean;
  branch?: { no?: string; name?: string } | null;
  /** Entegratörün GİB onaylı yazılımı: "VKN##Unvan##Program##Sürüm" (Uygulama Kılavuzu §14). */
  sourceApplication?: string;
  /** e-Defter'e hesap dönemi içinde geçildiyse ilk e-Defter ayı (YYYY-MM); numaralar bu aydan 1'e döner. */
  startMonth?: string;
  /** Kayıt girenin adı bulunamazsa yazılacak ad (en az 2 karakter). */
  enteredBy?: string;
}

export interface ProfileIssue {
  field: string;
  message: string;
}

export interface LoadedProfile {
  settings: EdefterSettings;
  profile: BookProfile;
  issues: ProfileIssue[];
}

const blank = (v: unknown) => !String(v ?? '').trim();

export async function loadProfile(client: PoolClient): Promise<LoadedProfile> {
  const t = await client.query(
    `SELECT name, trade_name, tax_number FROM tenants WHERE id = current_tenant_id()`,
  );
  const s = await client.query(
    `SELECT settings FROM tenant_settings WHERE tenant_id = current_tenant_id() AND key = 'company_profile'`,
  );
  const tenant = t.rows[0] ?? {};
  const all = (s.rows[0]?.settings ?? {}) as Record<string, unknown>;
  const settings = (all.edefter ?? {}) as EdefterSettings;
  const issues: ProfileIssue[] = [];
  const need = (cond: boolean, field: string, message: string) => {
    if (cond) issues.push({ field, message });
  };

  const vkn = String(tenant.tax_number ?? '').replace(/\D/g, '');
  need(
    !/^\d{10,11}$/.test(vkn),
    'taxNumber',
    'Vergi kimlik numarası (10 hane) veya TC kimlik numarası (11 hane) girilmeli.',
  );
  const title = String(settings.title || tenant.trade_name || tenant.name || '').trim();
  need(
    title.length < 2,
    'title',
    vkn.length === 11 ? 'Adı soyadı girilmeli.' : 'Ticaret unvanı (kısaltmasız) girilmeli.',
  );
  need(blank(settings.nace), 'nace', 'Faaliyet kodu (NACE) girilmeli.');
  need(blank(settings.phone), 'phone', 'Telefon girilmeli.');
  need(blank(settings.email), 'email', 'E-posta girilmeli.');
  const a = settings.address ?? {};
  need(blank(a.buildingNumber), 'address.buildingNumber', 'Adres: bina/kapı no girilmeli.');
  need(blank(a.street), 'address.street', 'Adres: cadde/sokak girilmeli.');
  need(blank(a.city), 'address.city', 'Adres: il girilmeli.');
  need(blank(a.postalCode), 'address.postalCode', 'Adres: posta kodu girilmeli.');
  const accountants = (settings.accountants ?? []).filter((x) => !blank(x.name));
  need(
    accountants.length === 0,
    'accountants',
    'Defteri tutan SMMM (veya muhasebe yetkilisi) girilmeli.',
  );
  accountants.forEach((acc, i) => {
    need(
      !settings.inHouse &&
        (blank(acc.contractType) || blank(acc.contractDate) || blank(acc.contractNo)),
      `accountants.${i}.contract`,
      `${acc.name}: sözleşme türü, tarihi ve numarası girilmeli.`,
    );
  });
  const branch =
    settings.branch && !blank(settings.branch.no)
      ? {
          no: String(settings.branch.no).padStart(4, '0'),
          name: String(settings.branch.name ?? '').trim(),
        }
      : null;
  need(
    branch !== null &&
      (!/^\d{4}$/.test(branch.no) || branch.no === '0000' || branch.name.length < 2),
    'branch',
    'Şube no 0001–9999 arası 4 hane, şube adı "… Şubesi" biçiminde olmalı.',
  );
  need(
    blank(settings.sourceApplication) ||
      String(settings.sourceApplication).split('##').length !== 4,
    'sourceApplication',
    'Entegratörün GİB onaylı yazılım bilgisi "VKN##Unvan##Program adı##Sürüm" biçiminde girilmeli (entegratörden alınır).',
  );

  const profile: BookProfile = {
    vkn,
    title,
    branch,
    nace: String(settings.nace ?? '').trim(),
    phone: String(settings.phone ?? '').trim(),
    fax: settings.fax?.trim() || null,
    email: String(settings.email ?? '').trim(),
    website: String(settings.website ?? '').trim() || '-',
    address: {
      buildingNumber: String(a.buildingNumber ?? '').trim(),
      street: String(a.street ?? '').trim(),
      street2: a.street2?.trim() || null,
      city: String(a.city ?? '').trim(),
      postalCode: String(a.postalCode ?? '').trim(),
      country: String(a.country ?? '').trim() || 'Türkiye',
    },
    accountants: accountants.map((acc) => ({
      name: String(acc.name).trim(),
      engagementDescription: settings.inHouse
        ? '-'
        : [acc.contractType, acc.contractDate, acc.contractNo]
            .map((x) => String(x ?? '').trim())
            .join(', '),
      address: acc.address ?? null,
      phone: acc.phone?.trim() || null,
      email: acc.email?.trim() || null,
    })),
    sourceApplication: String(settings.sourceApplication ?? '').trim(),
  };
  return { settings, profile, issues };
}
