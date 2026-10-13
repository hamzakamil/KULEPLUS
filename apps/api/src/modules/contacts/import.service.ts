import { getPool } from '@kuleplus/db';
import { AppError, isValidTCKN, isValidVKN, normalizePhoneTR, toE164TR } from '@kuleplus/shared';
import type { Pool } from 'pg';
import { parseCsv, suggestFieldMapping } from '../../services/csv.js';
import { checkLimit, incrementUsage } from '../entitlement/service.js';
import { ContactService } from './service.js';
import type { CreateContactInput } from './schemas.js';

/** Ayrıştırıcı yeniden dışa aktarılır (testler + diğer modüller buradan kullanır). */
export { parseCsv };

/** K-02 limit anahtarı (seed: free=100/ay, sınırsız: null) */
export const IMPORT_LIMIT_KEY = 'max_import_rows_monthly';
/** T-2.1: ≤1000 satır senkron batch; üstü kuyruk (Faz 3) */
export const IMPORT_SYNC_MAX_ROWS = 1000;

/** Şablon hedef alanları — docs/product/import-templates/contacts.md */
export const IMPORT_TARGET_FIELDS = [
  'contact_type',
  'company_name',
  'first_name',
  'last_name',
  'tax_number',
  'identity_number',
  'phone',
  'email',
  'address_line1',
  'city',
  'district',
  // Ek (opsiyonel) alanlar: şablon dışı ama desteklenir
  'code',
  'tax_office',
  'type',
] as const;
export type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];

/** Başlık → hedef alan eşleştirme önerisi (TR/EN takma adlar) */
const FIELD_ALIASES: Record<ImportTargetField, string[]> = {
  contact_type: ['contact_type', 'cari_tipi', 'tip', 'kisi_tipi', 'kisi tipi'],
  company_name: [
    'company_name',
    'sirket_adi',
    'şirket adı',
    'unvan',
    'firma_adi',
    'firma adı',
    'firma',
  ],
  first_name: ['first_name', 'ad', 'isim'],
  last_name: ['last_name', 'soyad', 'soyisim', 'soy ad'],
  tax_number: ['tax_number', 'vkn', 'vergi_no', 'vergi numarası', 'vergi numarasi'],
  identity_number: ['identity_number', 'tckn', 'tc_kimlik', 'tc kimlik', 'kimlik_no'],
  phone: ['phone', 'telefon', 'tel', 'gsm'],
  email: ['email', 'eposta', 'e-posta', 'mail'],
  address_line1: ['address_line1', 'adres', 'adres1', 'adres 1'],
  city: ['city', 'il'],
  district: ['district', 'ilce', 'ilçe'],
  code: ['code', 'kod', 'cari_kod', 'cari kod'],
  tax_office: ['tax_office', 'vergi_dairesi', 'vergi dairesi'],
  type: ['type', 'kategori', 'rol'],
};

/** Başlıklardan hedef alan eşleştirme önerisi üret (takma adlar FIELD_ALIASES'te) */
export function suggestMapping(headers: string[]): Record<string, ImportTargetField | null> {
  return suggestFieldMapping(headers, FIELD_ALIASES);
}

export type ImportRowIssue = { field: string; message: string };

export type ImportRowReport = {
  line: number; // CSV veri satırı (1 = ilk veri satırı; başlık hariç)
  name: string | null;
  status: 'valid' | 'invalid' | 'duplicate' | 'created' | 'failed';
  issues: ImportRowIssue[];
  duplicateOf?: string;
  id?: string;
  code?: string;
};

export type ImportLimitInfo = {
  current: number;
  limit: number | null;
  remaining: number | null;
  resetAt: string;
};

export type ImportReport = {
  headers: string[];
  suggestedMapping: Record<string, ImportTargetField | null>;
  mapping: Record<string, ImportTargetField | null>;
  summary: { total: number; valid: number; duplicates: number; invalid: number; toImport: number };
  limit: ImportLimitInfo;
  rows: ImportRowReport[];
};

export type ImportCommitResult = {
  summary: { total: number; created: number; duplicates: number; failed: number };
  limit: ImportLimitInfo;
  rows: ImportRowReport[];
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ParsedRow = {
  line: number;
  input: CreateContactInput | null;
  issues: ImportRowIssue[];
  duplicateOf?: string;
  name: string | null;
};

export class ContactImportService {
  private poolInstance: Pool | null = null;
  private readonly providedPool: Pool | null;
  private readonly contacts: ContactService;

  constructor(pool?: Pool) {
    this.providedPool = pool ?? null;
    this.contacts = new ContactService(pool);
  }

  /**
   * Pool'u ilk erişimde oluştur (lazy). Diğer servislerle (ContactService,
   * CashBankAccountService) aynı desen — DATABASE_URL tanımsız testlerde
   * routes.ts modül yüklenirken erken patlamasın diye constructor'da
   * getPool çağrılmaz.
   */
  private get pool(): Pool {
    if (!this.poolInstance) this.poolInstance = this.providedPool ?? getPool('app');
    return this.poolInstance;
  }

  /** Tenant bağlamı (limit + kod üretimi için) */
  private async requireTenantId(): Promise<string> {
    const result = await this.pool.query<{ tenant_id: string | null }>(
      'SELECT current_tenant_id() AS tenant_id',
    );
    const tenantId = result.rows[0]?.tenant_id;
    if (!tenantId) throw new AppError('UNAUTHENTICATED', 'Tenant bağlamı yok');
    return tenantId;
  }

  /** CSV'yi ayrıştır, eşleştir, satır bazlı doğrula ve mükerrerleri işaretle */
  private async parseAndValidate(
    csv: string,
    mapping: Record<string, string | null> | undefined,
  ): Promise<{
    parsed: ParsedRow[];
    headers: string[];
    suggestedMapping: Record<string, ImportTargetField | null>;
    appliedMapping: Record<string, ImportTargetField | null>;
  }> {
    const { headers, rows } = parseCsv(csv);
    const suggestedMapping = suggestMapping(headers);

    // Uygulanan eşleştirme: kullanıcı verdiyse onu doğrula, yoksa öneriyi kullan
    const appliedMapping: Record<string, ImportTargetField | null> = {};
    for (const header of headers) {
      const requested = mapping ? (mapping[header] ?? null) : suggestedMapping[header];
      if (requested !== null && requested !== undefined) {
        if (!IMPORT_TARGET_FIELDS.includes(requested as ImportTargetField)) {
          throw new AppError('VALIDATION_ERROR', `Bilinmeyen hedef alan: ${String(requested)}`);
        }
        appliedMapping[header] = requested as ImportTargetField;
      } else {
        appliedMapping[header] = null;
      }
    }

    // Tekrarlanan hedef alan kontrolü (iki kolon aynı alna eşlenemez)
    const seen = new Set<string>();
    for (const field of Object.values(appliedMapping)) {
      if (field) {
        if (seen.has(field)) {
          throw new AppError(
            'VALIDATION_ERROR',
            `Hedef alan birden fazla kolona eşlenmiş: ${field}`,
          );
        }
        seen.add(field);
      }
    }

    // İsim + telefon mükerrerleri için DB taraması (tek sorgu)
    const namesInFile = new Set<string>();
    const prelim: { line: number; values: Record<string, string> }[] = rows.map((cells, idx) => {
      const values: Record<string, string> = {};
      headers.forEach((header, colIdx) => {
        const target = appliedMapping[header];
        if (target) values[target] = (cells[colIdx] ?? '').trim();
      });
      const name =
        values.company_name ||
        [values.first_name, values.last_name].filter(Boolean).join(' ') ||
        '';
      if (name) namesInFile.add(name);
      return { line: idx + 1, values };
    });

    const dbTaxResult = await this.pool.query<{ tax_number: string }>(
      `SELECT tax_number FROM contacts
       WHERE tenant_id = current_tenant_id() AND tax_number IS NOT NULL`,
    );
    const dbTaxNumbers = new Set(dbTaxResult.rows.map((r) => r.tax_number));

    const dbPhoneResult = await this.pool.query<{ name: string; number: string }>(
      `SELECT c.name, ph.number FROM contacts c
       JOIN contact_phones ph ON ph.contact_id = c.id
       WHERE c.tenant_id = current_tenant_id()
         AND c.name = ANY($1::text[])`,
      [Array.from(namesInFile)],
    );
    const dbNamePhone = new Set(
      dbPhoneResult.rows.map((r) => `${r.name}|${normalizePhoneTR(r.number) ?? r.number}`),
    );

    // Satır bazlı doğrulama + dosya içi mükerrer tespiti
    const seenTax = new Map<string, number>();
    const seenNamePhone = new Map<string, number>();
    const parsed: ParsedRow[] = prelim.map(({ line, values }) => {
      const issues: ImportRowIssue[] = [];
      const contactType = (values.contact_type ?? '').toLocaleLowerCase('tr').trim();
      const isCompany = ['company', 'firma', 'şirket', 'sirket'].includes(contactType);
      const isPerson = ['person', 'kisi', 'kişi', 'şahıs', 'sahis'].includes(contactType);

      if (contactType && !isCompany && !isPerson) {
        issues.push({
          field: 'contact_type',
          message: 'contact_type "person" veya "company" olmalı',
        });
      }

      let name: string | null = null;
      if (isCompany) {
        if (!values.company_name) {
          issues.push({ field: 'company_name', message: 'company türünde company_name zorunlu' });
        } else {
          name = values.company_name;
        }
      } else if (isPerson) {
        if (!values.first_name && !values.last_name) {
          issues.push({ field: 'first_name', message: 'person türünde first_name zorunlu' });
        } else {
          name = [values.first_name, values.last_name].filter(Boolean).join(' ');
        }
      } else {
        if (!contactType) {
          issues.push({ field: 'contact_type', message: 'contact_type zorunlu (person/company)' });
        }
        name =
          values.company_name ||
          [values.first_name, values.last_name].filter(Boolean).join(' ') ||
          null;
      }

      // VKN / TCKN
      if (values.tax_number && !isValidVKN(values.tax_number)) {
        issues.push({ field: 'tax_number', message: 'VKN 10 hane olmalı (rakam, 0 ile başlamaz)' });
      }
      if (values.identity_number && !isValidTCKN(values.identity_number)) {
        issues.push({
          field: 'identity_number',
          message: 'TCKN 11 hane ve geçerli kontrol basamakları içermeli',
        });
      }

      // E-posta
      if (values.email && !EMAIL_RE.test(values.email)) {
        issues.push({ field: 'email', message: 'Geçersiz e-posta formatı' });
      }

      // Telefon: normalize edilemezse satır hatası (şablon: E.164)
      let phoneNormalized: string | null = null;
      if (values.phone) {
        phoneNormalized = normalizePhoneTR(values.phone);
        if (!phoneNormalized) {
          issues.push({ field: 'phone', message: 'Telefon tanınamadı (örn: 05xx…, +90 5xx…)' });
        }
      }

      // Cari tipi (customer/supplier; opsiyonel kolon)
      const contactRole = (values.type ?? '').toLocaleLowerCase('tr').trim();
      if (contactRole && contactRole !== 'customer' && contactRole !== 'supplier') {
        issues.push({ field: 'type', message: 'type "customer" veya "supplier" olmalı' });
      }

      // Mükerrer: aynı VKN veya (isim + telefon) — şablon kuralı
      let duplicateOf: string | undefined;
      if (values.tax_number && dbTaxNumbers.has(values.tax_number)) {
        duplicateOf = `mevcut kayıt (VKN ${values.tax_number})`;
      } else if (values.tax_number && seenTax.has(values.tax_number)) {
        duplicateOf = `dosya içi ${seenTax.get(values.tax_number)}. satır (VKN ${values.tax_number})`;
      } else if (name && phoneNormalized) {
        const key = `${name}|${phoneNormalized}`;
        if (dbNamePhone.has(key)) duplicateOf = `mevcut kayıt (${name} + telefon)`;
        else if (seenNamePhone.has(key))
          duplicateOf = `dosya içi ${seenNamePhone.get(key)}. satır (${name} + telefon)`;
      }
      if (values.tax_number && !seenTax.has(values.tax_number))
        seenTax.set(values.tax_number, line);
      if (name && phoneNormalized) {
        const key = `${name}|${phoneNormalized}`;
        if (!seenNamePhone.has(key)) seenNamePhone.set(key, line);
      }

      let input: CreateContactInput | null = null;
      if (issues.length === 0 && !duplicateOf && name) {
        input = {
          code: values.code || '', // commit'te üretilir
          name,
          type: contactRole === 'supplier' ? 'supplier' : 'customer',
          tax_number: values.tax_number || null,
          tax_office: values.tax_office || null,
          settings:
            isPerson && values.identity_number ? { identity_number: values.identity_number } : {},
          addresses:
            values.address_line1 || values.city || values.district
              ? [
                  {
                    is_primary: true,
                    type: 'default' as const,
                    street: values.address_line1 || undefined,
                    province: values.city || undefined,
                    district: values.district || undefined,
                    parsed: {},
                  },
                ]
              : [],
          phones: values.phone
            ? [
                {
                  is_primary: true,
                  type: 'mobile' as const,
                  number: phoneNormalized ?? values.phone,
                  formatted: toE164TR(values.phone) ?? undefined,
                  parsed: {},
                },
              ]
            : [],
          emails: values.email
            ? [
                {
                  is_primary: true,
                  type: 'default' as const,
                  email: values.email,
                  validated: false,
                },
              ]
            : [],
          relations: [],
        };
      }

      return { line, input, issues, duplicateOf, name };
    });

    return { parsed, headers, suggestedMapping, appliedMapping };
  }

  /** Kotası bilgisi (dry-run raporunda kullanıcıya gösterilir) */
  private async limitInfo(): Promise<ImportLimitInfo> {
    const tenantId = await this.requireTenantId();
    const result = await checkLimit(tenantId, IMPORT_LIMIT_KEY);
    return {
      current: result.current,
      limit: result.limit,
      remaining: result.remaining,
      resetAt: result.resetAt.toISOString(),
    };
  }

  /** Dry-run: doğrulama + rapor; yazma yapmaz (SPEC §23.1) */
  async dryRun(csv: string, mapping?: Record<string, string | null>): Promise<ImportReport> {
    const limit = await this.limitInfo();
    const { parsed, headers, suggestedMapping, appliedMapping } = await this.parseAndValidate(
      csv,
      mapping,
    );

    const valid = parsed.filter((p) => p.input).length;
    const duplicates = parsed.filter((p) => p.duplicateOf && p.issues.length === 0).length;
    const invalid = parsed.filter((p) => p.issues.length > 0).length;

    return {
      headers,
      suggestedMapping,
      mapping: appliedMapping,
      summary: { total: parsed.length, valid, duplicates, invalid, toImport: valid },
      limit,
      rows: parsed.map((p) => ({
        line: p.line,
        name: p.name,
        status: p.issues.length > 0 ? 'invalid' : p.duplicateOf ? 'duplicate' : 'valid',
        issues: p.issues,
        duplicateOf: p.duplicateOf,
      })),
    };
  }

  /** Commit: geçerli satırları aktar — her satır kendi transaction'ı (SPEC §23.1) */
  async commit(csv: string, mapping?: Record<string, string | null>): Promise<ImportCommitResult> {
    if (csv.length > 2_000_000) {
      throw new AppError('VALIDATION_ERROR', 'CSV boyutu 2 MB sınırını aşıyor');
    }
    const { parsed } = await this.parseAndValidate(csv, mapping);

    if (parsed.length > IMPORT_SYNC_MAX_ROWS) {
      throw new AppError(
        'VALIDATION_ERROR',
        `${IMPORT_SYNC_MAX_ROWS} satır üstü içe aktarma kuyruğa alınır (Faz 3)`,
      );
    }

    // K-02: aylık import satırı kotası — aktarılacak satır kadar yer olmalı
    const limit = await this.limitInfo();
    const validRows = parsed.filter((p) => p.input);
    if (limit.remaining !== null && validRows.length > limit.remaining) {
      throw new AppError(
        'LIMIT_EXCEEDED',
        `Aylık import kotası yetersiz: kalan ${limit.remaining}, aktarılacak ${validRows.length}`,
      );
    }

    // Kod üretimi: mevcut IMP- serisinin devamı (contacts_tenant_code_unique)
    let codeSeq = 0;
    const seqResult = await this.pool.query<{ max_code: string | null }>(
      `SELECT MAX(code) AS max_code FROM contacts
       WHERE tenant_id = current_tenant_id() AND code ~ '^IMP-[0-9]{6}$'`,
    );
    const maxCode = seqResult.rows[0]?.max_code;
    if (maxCode) codeSeq = parseInt(maxCode.slice(4), 10) || 0;

    const rows: ImportRowReport[] = [];
    let created = 0;
    for (const p of parsed) {
      if (p.issues.length > 0) {
        rows.push({ line: p.line, name: p.name, status: 'invalid', issues: p.issues });
        continue;
      }
      if (p.duplicateOf) {
        rows.push({
          line: p.line,
          name: p.name,
          status: 'duplicate',
          issues: [],
          duplicateOf: p.duplicateOf,
        });
        continue;
      }
      const input = p.input!;
      if (!input.code) {
        codeSeq += 1;
        input.code = `IMP-${String(codeSeq).padStart(6, '0')}`;
      }
      try {
        const contact = await this.contacts.createContact(input);
        created += 1;
        rows.push({
          line: p.line,
          name: p.name,
          status: 'created',
          issues: [],
          id: contact?.id,
          code: contact?.code ?? input.code,
        });
      } catch (err) {
        rows.push({
          line: p.line,
          name: p.name,
          status: 'failed',
          issues: [
            { field: '_', message: err instanceof AppError ? err.message : 'Kayıt oluşturulamadı' },
          ],
        });
      }
    }

    // Kullanım sayacı: yalnızca başarılı aktarımlar sayılır (K-02)
    if (created > 0) {
      const tenantId = await this.requireTenantId();
      await incrementUsage(tenantId, IMPORT_LIMIT_KEY, undefined, created);
    }

    const newLimit = await this.limitInfo();
    return {
      summary: {
        total: parsed.length,
        created,
        duplicates: rows.filter((r) => r.status === 'duplicate').length,
        failed: rows.filter((r) => r.status === 'failed' || r.status === 'invalid').length,
      },
      limit: newLimit,
      rows,
    };
  }

  /** Dışa aktarma: UTF-8 BOM + RFC4180 kaçışlı CSV */
  async exportCsv(): Promise<string> {
    const result = await this.pool.query<{
      code: string;
      name: string;
      type: string;
      tax_number: string | null;
      tax_office: string | null;
      phone: string | null;
      email: string | null;
      address_line1: string | null;
      city: string | null;
      district: string | null;
    }>(
      `SELECT c.code, c.name, c.type, c.tax_number, c.tax_office,
              ph.number AS phone, em.email AS email,
              ad.street AS address_line1, ad.province AS city, ad.district AS district
       FROM contacts c
       LEFT JOIN LATERAL (
         SELECT number FROM contact_phones WHERE contact_id = c.id AND is_primary = true
         UNION ALL
         SELECT number FROM contact_phones WHERE contact_id = c.id AND is_primary = false
         LIMIT 1
       ) ph ON true
       LEFT JOIN LATERAL (
         SELECT email FROM contact_emails WHERE contact_id = c.id AND is_primary = true
         UNION ALL
         SELECT email FROM contact_emails WHERE contact_id = c.id AND is_primary = false
         LIMIT 1
       ) em ON true
       LEFT JOIN LATERAL (
         SELECT street, province, district FROM contact_addresses WHERE contact_id = c.id AND is_primary = true
         UNION ALL
         SELECT street, province, district FROM contact_addresses WHERE contact_id = c.id AND is_primary = false
         LIMIT 1
       ) ad ON true
       WHERE c.tenant_id = current_tenant_id()
       ORDER BY c.code`,
    );

    const escape = (v: string | null): string => {
      const s = v ?? '';
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = 'code,name,type,tax_number,tax_office,phone,email,address_line1,city,district';
    const lines = result.rows.map((r) =>
      [
        r.code,
        r.name,
        r.type,
        r.tax_number,
        r.tax_office,
        r.phone,
        r.email,
        r.address_line1,
        r.city,
        r.district,
      ]
        .map(escape)
        .join(','),
    );
    // UTF-8 BOM zorunlu
    const BOM = String.fromCharCode(0xfeff);
    return BOM + [header, ...lines].join(String.fromCharCode(13, 10)) + String.fromCharCode(13, 10);
  }
}
