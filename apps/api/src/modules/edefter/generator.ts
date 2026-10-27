/**
 * GİB e-Defter (XBRL GL 2006-10-25) yevmiye (Y) ve büyük defter / kebir (K) XML üretici.
 *
 * Kaynak: edefter.gov.tr e-Defter Paketi (06.05.2026) — Yevmiye Defteri Kılavuzu v1.5, Büyük
 * Defter Kılavuzu, Teknik Kılavuz v1.7, e-Defter Uygulama Kılavuzu v1.12 ve schematron kuralları.
 * Eleman sırası XSD'deki (plt/case-c-b) sıraya uyar. İmza (ds:Signature) eklenmez; mali mühür ile
 * entegratör imzalar. Saf fonksiyon: veritabanına erişmez (bkz. service.ts).
 */

export type GibDocumentType =
  | 'invoice'
  | 'check'
  | 'voucher'
  | 'receipt'
  | 'shipment'
  | 'order-customer'
  | 'order-vendor'
  | 'other';

export interface BookDocument {
  type: GibDocumentType;
  description?: string | null;
  number?: string | null;
  date?: string | null;
}

export interface BookLine {
  /** Yevmiye satır numarası (hesap dönemi boyunca müteselsil). */
  lineNumber: number;
  accountMainId: string;
  accountMainDescription: string;
  /** Alt hesap (yoksa satır doğrudan ana hesaba kayıtlıdır). */
  accountSubId?: string | null;
  accountSubDescription?: string | null;
  debitCredit: 'D' | 'C';
  /** Kuruş cinsinden, > 0. */
  amountK: number;
  document?: BookDocument | null;
  paymentMethod?: string | null;
  comment?: string | null;
}

export interface BookEntry {
  /** Yevmiye madde numarası (hesap dönemi başında 1). */
  counter: number;
  /** Muhasebe fiş numarası (entryNumber = documentReference). */
  entryNumber: string;
  date: string;
  enteredBy: string;
  comment: string;
  lines: BookLine[];
}

export interface BookProfile {
  vkn: string;
  /** Tüzel kişide unvan, gerçek kişide adı soyadı. */
  title: string;
  branch?: { no: string; name: string } | null;
  nace: string;
  phone: string;
  fax?: string | null;
  email: string;
  website: string;
  address: {
    buildingNumber: string;
    street: string;
    street2?: string | null;
    city: string;
    postalCode: string;
    country: string;
  };
  accountants: Array<{
    name: string;
    engagementDescription: string;
    address?: {
      buildingNumber?: string;
      street?: string;
      city?: string;
      postalCode?: string;
      country?: string;
    } | null;
    phone?: string | null;
    email?: string | null;
  }>;
  sourceApplication: string;
}

export interface BookPart {
  book: 'Y' | 'K';
  /** 0 = tek parça; bölünmüşse 1'den başlar. */
  partNo: number;
  uniqueId: string;
  fileName: string;
  periodStart: string;
  periodEnd: string;
  xml: string;
  firstCounter: number | null;
  lastCounter: number | null;
  firstLine: number | null;
  lastLine: number | null;
  entryCount: number;
  lineCount: number;
  totalDebitK: number;
  totalCreditK: number;
}

export interface BuildInput {
  profile: BookProfile;
  /** YYYY-MM-01 */
  monthStart: string;
  /** Ayın son günü */
  monthEnd: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  creationDate: string;
  entries: BookEntry[];
  /** Hesap dönemi içindeki bir sonraki uniqueID sırası (önceki ayların parçalarından sonra). */
  nextUniqueSeq: number;
  /** Parça üst sınırı (bayt). GİB: 200 MB; imza payı bırakılır. */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 195 * 1024 * 1024;
const MONTHS_TR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];

export function xmlEscape(value: unknown): string {
  return (
    String(value ?? '')
      // XML 1.0'da geçersiz kontrol karakterleri (açıklamalara yapıştırılan metinlerden) boşluğa çevrilir.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  );
}

/** Kuruş → "1234.5" biçimi (GİB: en çok 2 ondalık, nokta ayraç). */
export function money(k: number): string {
  const sign = k < 0 ? '-' : '';
  const abs = Math.abs(Math.round(k));
  const lira = Math.floor(abs / 100);
  const kurus = abs % 100;
  return `${sign}${lira}${kurus === 0 ? '' : `.${String(kurus).padStart(2, '0')}`}`;
}

const dayAfter = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const trDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS_TR[m - 1]} ${y}`;
};

function el(prefix: 'cor' | 'bus', name: string, ctx: string, value: unknown, attrs = ''): string {
  return `<gl-${prefix}:${name} contextRef="${ctx}"${attrs}>${xmlEscape(value)}</gl-${prefix}:${name}>`;
}

function header(
  book: 'Y' | 'K',
  input: BuildInput,
  part: { uniqueId: string; start: string; end: string },
) {
  const ctx = book === 'Y' ? 'journal_context' : 'ledger_context';
  const p = input.profile;
  const kind = book === 'Y' ? 'Yevmiye defteri' : 'Büyük defter';
  const owner = p.branch ? `${p.title}'nin ${p.branch.name}` : p.title;
  const isPerson = p.vkn.length === 11;
  const orgIds = [
    `<gl-bus:organizationIdentifiers>${el('bus', 'organizationIdentifier', ctx, p.title)}${el('bus', 'organizationDescription', ctx, isPerson ? 'Adı Soyadı' : 'Kurum Unvanı')}</gl-bus:organizationIdentifiers>`,
  ];
  if (p.branch) {
    orgIds.push(
      `<gl-bus:organizationIdentifiers>${el('bus', 'organizationIdentifier', ctx, p.branch.name)}${el('bus', 'organizationDescription', ctx, 'Şube Adı')}</gl-bus:organizationIdentifiers>`,
      `<gl-bus:organizationIdentifiers>${el('bus', 'organizationIdentifier', ctx, p.branch.no)}${el('bus', 'organizationDescription', ctx, 'Şube No')}</gl-bus:organizationIdentifiers>`,
    );
  }
  const a = p.address;
  const accountants = p.accountants
    .map((acc) => {
      const ad = acc.address ?? {};
      const addr =
        ad.street || ad.city
          ? `<gl-bus:accountantAddress>${ad.buildingNumber ? el('bus', 'accountantBuildingNumber', ctx, ad.buildingNumber) : ''}${ad.street ? el('bus', 'accountantStreet', ctx, ad.street) : ''}${ad.city ? el('bus', 'accountantCity', ctx, ad.city) : ''}${el('bus', 'accountantCountry', ctx, ad.country || 'Türkiye')}${ad.postalCode ? el('bus', 'accountantZipOrPostalCode', ctx, ad.postalCode) : ''}</gl-bus:accountantAddress>`
          : '';
      const contact =
        acc.phone || acc.email
          ? `<gl-bus:accountantContactInformation>${acc.phone ? `<gl-bus:accountantContactPhone>${el('bus', 'accountantContactPhoneNumberDescription', ctx, 'bookkeeper')}${el('bus', 'accountantContactPhoneNumber', ctx, acc.phone)}</gl-bus:accountantContactPhone>` : ''}${acc.email ? `<gl-bus:accountantContactEmail>${el('bus', 'accountantContactEmailAddress', ctx, acc.email)}</gl-bus:accountantContactEmail>` : ''}</gl-bus:accountantContactInformation>`
          : '';
      return `<gl-bus:accountantInformation>${el('bus', 'accountantName', ctx, acc.name)}${addr}${el('bus', 'accountantEngagementTypeDescription', ctx, acc.engagementDescription)}${contact}</gl-bus:accountantInformation>`;
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<?xml-stylesheet type="text/xsl" href="${book === 'Y' ? 'yevmiye' : 'kebir'}.xslt"?>\n` +
    `<edefter:defter xmlns:edefter="http://www.edefter.gov.tr" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.edefter.gov.tr ../xsd/edefter.xsd">` +
    `<xbrli:xbrl xmlns:gl-bus="http://www.xbrl.org/int/gl/bus/2006-10-25" xmlns:gl-cor="http://www.xbrl.org/int/gl/cor/2006-10-25" xmlns:gl-muc="http://www.xbrl.org/int/gl/muc/2006-10-25" xmlns:gl-plt="http://www.xbrl.org/int/gl/plt/2006-10-25" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:iso639="http://www.xbrl.org/2005/iso639" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xlink="http://www.w3.org/1999/xlink" xsi:schemaLocation="http://www.xbrl.org/int/gl/plt/2006-10-25 ../xsd/2006-10-25/plt/case-c-b/gl-plt-2006-10-25.xsd">` +
    `<link:schemaRef xlink:href="../xsd/2006-10-25/plt/case-c-b/gl-plt-2006-10-25.xsd" xlink:type="simple"/>` +
    `<xbrli:context id="${ctx}"><xbrli:entity><xbrli:identifier scheme="http://www.gib.gov.tr">${xmlEscape(p.vkn)}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${input.creationDate}</xbrli:instant></xbrli:period></xbrli:context>` +
    `<xbrli:unit id="try"><xbrli:measure>iso4217:TRY</xbrli:measure></xbrli:unit>` +
    `<xbrli:unit id="countable"><xbrli:measure>xbrli:pure</xbrli:measure></xbrli:unit>` +
    `<gl-cor:accountingEntries>` +
    `<gl-cor:documentInfo>${el('cor', 'entriesType', ctx, book === 'Y' ? 'journal' : 'ledger')}${el('cor', 'uniqueID', ctx, part.uniqueId)}${el('cor', 'language', ctx, 'iso639:tr')}${el('cor', 'creationDate', ctx, input.creationDate)}${el('cor', 'entriesComment', ctx, `${trDate(part.start)} - ${trDate(part.end)} arası ${owner} ait ${kind}.`)}${el('cor', 'periodCoveredStart', ctx, part.start)}${el('cor', 'periodCoveredEnd', ctx, part.end)}${el('bus', 'sourceApplication', ctx, p.sourceApplication)}</gl-cor:documentInfo>` +
    `<gl-cor:entityInformation>` +
    `<gl-bus:entityPhoneNumber>${el('bus', 'phoneNumberDescription', ctx, 'main')}${el('bus', 'phoneNumber', ctx, p.phone)}</gl-bus:entityPhoneNumber>` +
    (p.fax
      ? `<gl-bus:entityFaxNumberStructure>${el('bus', 'entityFaxNumber', ctx, p.fax)}</gl-bus:entityFaxNumberStructure>`
      : '') +
    `<gl-bus:entityEmailAddressStructure>${el('bus', 'entityEmailAddress', ctx, p.email)}</gl-bus:entityEmailAddressStructure>` +
    orgIds.join('') +
    `<gl-bus:organizationAddress>${el('bus', 'organizationBuildingNumber', ctx, a.buildingNumber)}${el('bus', 'organizationAddressStreet', ctx, a.street)}${a.street2 ? el('bus', 'organizationAddressStreet2', ctx, a.street2) : ''}${el('bus', 'organizationAddressCity', ctx, a.city)}${el('bus', 'organizationAddressZipOrPostalCode', ctx, a.postalCode)}${el('bus', 'organizationAddressCountry', ctx, a.country)}</gl-bus:organizationAddress>` +
    `<gl-bus:entityWebSite>${el('bus', 'webSiteURL', ctx, p.website)}</gl-bus:entityWebSite>` +
    el('bus', 'businessDescription', ctx, p.nace) +
    el('bus', 'fiscalYearStart', ctx, input.fiscalYearStart) +
    el('bus', 'fiscalYearEnd', ctx, input.fiscalYearEnd) +
    accountants +
    `</gl-cor:entityInformation>`
  );
}

const FOOTER = `</gl-cor:accountingEntries></xbrli:xbrl></edefter:defter>`;

function accountXml(ctx: string, l: BookLine): string {
  const sub =
    l.accountSubId && l.accountSubId !== l.accountMainId
      ? `<gl-cor:accountSub>${el('cor', 'accountSubDescription', ctx, l.accountSubDescription || l.accountSubId)}${el('cor', 'accountSubID', ctx, l.accountSubId)}</gl-cor:accountSub>`
      : '';
  return `<gl-cor:account>${el('cor', 'accountMainID', ctx, l.accountMainId)}${el('cor', 'accountMainDescription', ctx, l.accountMainDescription)}${sub}</gl-cor:account>`;
}

function detailXml(ctx: string, e: BookEntry, l: BookLine): string {
  const doc = l.document;
  const docXml = doc
    ? el('cor', 'documentType', ctx, doc.type) +
      (doc.type === 'other' && doc.description
        ? el('cor', 'documentTypeDescription', ctx, doc.description)
        : '') +
      (doc.number ? el('cor', 'documentNumber', ctx, doc.number) : '')
    : '';
  return (
    `<gl-cor:entryDetail>` +
    el('cor', 'lineNumber', ctx, l.lineNumber) +
    el('cor', 'lineNumberCounter', ctx, e.counter, ' decimals="INF" unitRef="countable"') +
    accountXml(ctx, l) +
    el('cor', 'amount', ctx, money(l.amountK), ' decimals="INF" unitRef="try"') +
    el('cor', 'debitCreditCode', ctx, l.debitCredit) +
    el('cor', 'postingDate', ctx, e.date) +
    docXml +
    el('cor', 'documentReference', ctx, e.entryNumber) +
    (doc?.date ? el('cor', 'documentDate', ctx, doc.date) : '') +
    (l.paymentMethod ? el('bus', 'paymentMethod', ctx, l.paymentMethod) : '') +
    (l.comment ? el('cor', 'detailComment', ctx, l.comment) : '') +
    `</gl-cor:entryDetail>`
  );
}

function journalEntryXml(e: BookEntry, branch: BookProfile['branch']): string {
  const ctx = 'journal_context';
  const dK = e.lines.filter((l) => l.debitCredit === 'D').reduce((s, l) => s + l.amountK, 0);
  const cK = e.lines.filter((l) => l.debitCredit === 'C').reduce((s, l) => s + l.amountK, 0);
  return (
    `<gl-cor:entryHeader>` +
    el('cor', 'enteredBy', ctx, e.enteredBy) +
    el('cor', 'enteredDate', ctx, e.date) +
    el('cor', 'entryNumber', ctx, e.entryNumber) +
    el('cor', 'entryComment', ctx, e.comment) +
    (branch
      ? el('bus', 'batchID', ctx, branch.no) + el('bus', 'batchDescription', ctx, branch.name)
      : '') +
    el('bus', 'totalDebit', ctx, money(dK), ' decimals="INF" unitRef="try"') +
    el('bus', 'totalCredit', ctx, money(cK), ' decimals="INF" unitRef="try"') +
    el('cor', 'entryNumberCounter', ctx, e.counter, ' decimals="INF" unitRef="countable"') +
    e.lines.map((l) => detailXml(ctx, e, l)).join('') +
    `</gl-cor:entryHeader>`
  );
}

/** Kebir: her (ana hesap, alt hesap) için tek entryHeader; hesap koduna göre sıralı. */
function ledgerXml(entries: BookEntry[], branch: BookProfile['branch']): string {
  const ctx = 'ledger_context';
  type Group = {
    key: string;
    main: string;
    sub: string;
    rows: Array<{ e: BookEntry; l: BookLine }>;
  };
  const groups = new Map<string, Group>();
  for (const e of entries) {
    for (const l of e.lines) {
      const sub = l.accountSubId && l.accountSubId !== l.accountMainId ? l.accountSubId : '';
      const key = `${l.accountMainId}|${sub}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { key, main: l.accountMainId, sub, rows: [] }));
      g.rows.push({ e, l });
    }
  }
  const sorted = [...groups.values()].sort((a, b) =>
    a.main === b.main ? (a.sub < b.sub ? -1 : a.sub > b.sub ? 1 : 0) : a.main < b.main ? -1 : 1,
  );
  return sorted
    .map((g) => {
      g.rows.sort((x, y) => x.e.counter - y.e.counter || x.l.lineNumber - y.l.lineNumber);
      const net = g.rows.reduce(
        (s, r) => s + (r.l.debitCredit === 'D' ? r.l.amountK : -r.l.amountK),
        0,
      );
      return (
        `<gl-cor:entryHeader>` +
        (branch
          ? el('bus', 'batchID', ctx, branch.no) + el('bus', 'batchDescription', ctx, branch.name)
          : '') +
        el('bus', 'totalDebit', ctx, money(Math.max(net, 0)), ' decimals="INF" unitRef="try"') +
        el('bus', 'totalCredit', ctx, money(Math.max(-net, 0)), ' decimals="INF" unitRef="try"') +
        g.rows.map((r) => detailXml(ctx, r.e, r.l)).join('') +
        `</gl-cor:entryHeader>`
      );
    })
    .join('');
}

/** Maddeleri 200 MB sınırına göre parçalara ayırır (madde bölünmez). */
function splitEntries(input: BuildInput): BookEntry[][] {
  const max = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const parts: BookEntry[][] = [];
  let current: BookEntry[] = [];
  // Başlık + kebir tekrarları için güvenli pay: yevmiye boyutunun ~2 katı sınır olarak alınır.
  let size = 16 * 1024;
  for (const e of input.entries) {
    const s = Buffer.byteLength(journalEntryXml(e, input.profile.branch), 'utf8') * 2;
    if (current.length > 0 && size + s > max) {
      parts.push(current);
      current = [];
      size = 16 * 1024;
    }
    current.push(e);
    size += s;
  }
  parts.push(current);
  return parts;
}

/**
 * Bir ayın yevmiye ve kebir parçalarını üretir. Kebir parçaları yevmiye parçalarıyla aynı
 * maddeleri ve aynı dönemi kapsar (Uygulama Kılavuzu: mali kayıtlar birebir aynı olmalı).
 */
export function buildMonth(input: BuildInput): BookPart[] {
  const chunks = splitEntries(input);
  const multi = chunks.length > 1;
  const yyyymm = input.monthStart.slice(0, 4) + input.monthStart.slice(5, 7);
  const branchSuffix = input.profile.branch ? `-${input.profile.branch.no}` : '';
  const out: BookPart[] = [];
  let prevEnd: string | null = null;
  chunks.forEach((chunk, i) => {
    const first = chunk[0]?.date;
    const last = chunk[chunk.length - 1]?.date;
    // İlk parça ayın ilk günü, son parça ayın son günü; parçalar arasında gün boşluğu olmaz.
    const start = i === 0 ? input.monthStart : first === prevEnd ? prevEnd! : dayAfter(prevEnd!);
    const end = i === chunks.length - 1 ? input.monthEnd : (last ?? start);
    prevEnd = end;
    const partNo = multi ? i + 1 : 0;
    const seq = input.nextUniqueSeq + i;
    const lines = chunk.flatMap((e) => e.lines);
    const stats = {
      firstCounter: chunk[0]?.counter ?? null,
      lastCounter: chunk[chunk.length - 1]?.counter ?? null,
      firstLine: lines[0]?.lineNumber ?? null,
      lastLine: lines[lines.length - 1]?.lineNumber ?? null,
      entryCount: chunk.length,
      lineCount: lines.length,
      totalDebitK: lines.filter((l) => l.debitCredit === 'D').reduce((s, l) => s + l.amountK, 0),
      totalCreditK: lines.filter((l) => l.debitCredit === 'C').reduce((s, l) => s + l.amountK, 0),
    };
    for (const book of ['Y', 'K'] as const) {
      const uniqueId = `${book === 'Y' ? 'YEV' : 'KEB'}${yyyymm}${String(seq).padStart(6, '0')}`;
      const body =
        book === 'Y'
          ? chunk.map((e) => journalEntryXml(e, input.profile.branch)).join('')
          : ledgerXml(chunk, input.profile.branch);
      out.push({
        book,
        partNo,
        uniqueId,
        fileName: `${input.profile.vkn}-${yyyymm}-${book}-${String(partNo).padStart(6, '0')}${branchSuffix}.xml`,
        periodStart: start,
        periodEnd: end,
        xml: header(book, input, { uniqueId, start, end }) + body + FOOTER,
        ...stats,
      });
    }
  });
  return out;
}
