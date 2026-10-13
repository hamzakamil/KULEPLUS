// İndirilen ham TR verilerinin kapsamını doğrular (geçici analiz).
import fs from 'node:fs';

const ilIlce = JSON.parse(fs.readFileSync('tmp-illce.json', 'utf8'));
const tax = JSON.parse(fs.readFileSync('tmp-tax.json', 'utf8'));

const provinces = ilIlce.data;
console.log('İl sayısı:', provinces.length);
const plateSet = new Set(provinces.map((p) => p.plaka_kodu.trim()));
console.log('Farklı plaka sayısı:', plateSet.size);

let distCount = 0;
const maxD = { name: '', n: 0 };
for (const p of provinces) {
  distCount += p.ilceler.length;
  if (p.ilceler.length > maxD.n) { maxD.n = p.ilceler.length; maxD.name = p.il_adi; }
}
console.log('Toplam ilçe (merkez dahil):', distCount, '| en çok ilçeli:', JSON.stringify(maxD));

const taxProvinceSet = new Set(tax.map((t) => t.il.replace(/^\d+\s*/, '').trim().toLocaleUpperCase('tr-TR')));
console.log('Vergi dairesi olan il sayısı:', taxProvinceSet.size);
console.log('Vergi dairesi kayıt sayısı:', tax.length);

// Her il için vergi dairesi yok mu?
const missing = provinces.filter((p) => !taxProvinceSet.has(p.il_adi.toLocaleUpperCase('tr-TR'))).map((p) => p.il_adi);
console.log('Vergi dairesi listesi eksik olan iller:', missing.length ? missing.join(', ') : '(yok)');

// Örnek: İstanbul vergi daireleri sayısı
const ist = tax.filter((t) => t.il.includes('İSTANBUL'));
console.log('İstanbul v.d. sayısı:', ist.length, '| örnekler:', ist.slice(0, 3).map((t) => t.isim).join(' | '));
