// Ham TR verilerinden apps/web/src/data/tr-locations.ts modülü üretir.
// Kaynaklar (açık veri):
//  - il/ilçe: snrylmz/il-ilce-json (js/il-ilce.json)
//  - vergi daireleri: sadicann/turkiye-vergi-daireleri (vergi-daireleri.json)
import fs from 'node:fs';

const ilIlce = JSON.parse(fs.readFileSync('tmp-illce.json', 'utf8'));
const tax = JSON.parse(fs.readFileSync('tmp-tax.json', 'utf8'));

// Vergi dairesi: il (plaka önekli) -> isim listesi
const taxByProvince = new Map();
for (const t of tax) {
  const key = t.il.replace(/^\d+\s*/, '').trim().toLocaleUpperCase('tr-TR');
  if (!taxByProvince.has(key)) taxByProvince.set(key, new Set());
  taxByProvince.get(key).add(t.isim);
}

const lines = [];
lines.push(`// ⚠️ Bu dosya tools/gen-tr-data.mjs ile ÜRETİLMİŞTİR — elle düzenlemeyin.
// Kaynaklar: snrylmz/il-ilce-json + sadicann/turkiye-vergi-daireleri (açık veri).
// Tüm iller (81), ilçeler (973) ve resmî vergi daireleri (1042).`);

lines.push(`
export interface TrProvince {
  /** Plaka kodu, örn. '34' */
  plate: string;
  /** İl adı — TR kuralına göre büyük harf, örn. 'İSTANBUL' */
  name: string;
  /** Türkçe yol adı, örn. 'istanbul' */
  slug: string;
  /** İlçe adları (TR büyük harf) */
  districts: string[];
  /** Resmî vergi dairesi adları */
  taxOffices: string[];
}

export const TR_PROVINCES: TrProvince[] = [`);

for (const p of ilIlce.data) {
  const upper = p.il_adi.trim().toLocaleUpperCase('tr-TR');
  const slug = upper.toLocaleLowerCase('tr-TR').replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c]);
  const districts = p.ilceler.map((d) => d.ilce_adi.trim()).sort((a, b) => a.localeCompare(b, 'tr'));
  const taxOffices = [...(taxByProvince.get(upper) ?? [])].sort((a, b) => a.localeCompare(b, 'tr'));
  lines.push(`  {
    plate: '${p.plaka_kodu.trim().padStart(2, '0')}',
    name: '${upper}',
    slug: '${slug}',
    districts: ${JSON.stringify(districts)},
    taxOffices: ${JSON.stringify(taxOffices)},
  },`);
}

lines.push(`];

/** İl adına (büyük/küçük harf, TR duyarsız) göre il kaydını döndürür. */
export function findProvince(name: string | null | undefined): TrProvince | undefined {
  if (!name) return undefined;
  const key = name.trim().toLocaleUpperCase('tr-TR');
  return TR_PROVINCES.find((p) => p.name === key);
}

/** Seçili ilin ilçe adlarını döndürür (il boşsa tümü). */
export function districtsOf(provinceName: string | null | undefined): string[] {
  return findProvince(provinceName)?.districts ?? [];
}

/** Seçili ilin vergi dairelerini döndürür (il boşsa tüm vergi daireleri). */
export function taxOfficesOf(provinceName: string | null | undefined): string[] {
  const list = findProvince(provinceName)?.taxOffices ?? [];
  if (list.length) return list;
  return TR_PROVINCES.flatMap((p) => p.taxOffices);
}`);
process.stdout.write(lines.join('\n'));
