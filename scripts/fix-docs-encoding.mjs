/**
 * docs-stubs altındaki md dosyalarındaki UTF-8 → CP1252 çift kodlama bozukluğunu (mojibake) düzeltir.
 *
 * Örnek: "KullanÄ±m" (bozuk) → "Kullanım" (doğru)
 * Kural: TECHNICAL_SPEC §3 — "Hiçbir katmanda mojibake kabul edilmez."
 *
 * Kullanım: node scripts/fix-docs-encoding.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Windows-1252'in 0x80-0x9F aralığındaki özel karakterleri (latin1'de control olanlar)
const CP1252_HIGH = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

const charToByte = new Map();
for (let b = 0x80; b <= 0x9f; b++) {
  charToByte.set(CP1252_HIGH[b], b); // CP1252 yorumu (€, ", " vb.)
  charToByte.set(b, b); // latin1 yorumu (C1 kontrol karakterleri)
}
for (let b = 0xa0; b <= 0xff; b++) charToByte.set(b, b);

/** CP1252 benzeri geri dönüşüm: string → orijinal (bozuk) UTF-8 byte'ları */
function decodeMojibake(str) {
  const bytes = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp <= 0x7f) {
      bytes.push(cp);
      continue;
    }
    const b = charToByte.get(cp);
    if (b === undefined) return null; // bu karakter geri çevrilemiyor → dosya bozuk değil
    bytes.push(b);
  }
  return Buffer.from(bytes);
}

/** string'in çift kodlanmış olup olmadığını tespit et */
function isDoubleEncoded(str) {
  if (!/(?:Ä±|Ä§|ÅŸ|Åž|Ã¼|Ã¶|Ã§|â€|Ã‡|Ã–|Åž|Ã¼|Â)/.test(str)) return false;
  const raw = decodeMojibake(str);
  if (!raw) return false;
  try {
    const fixed = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    return fixed !== str;
  } catch {
    return false;
  }
}

function fixString(str) {
  const raw = decodeMojibake(str);
  return raw ? new TextDecoder('utf-8').decode(raw) : null;
}

const dryRun = process.argv.includes('--dry-run');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// UTF-8 zorunlu tüm metin katmanları: md (doküman) + yaml (API sözleşmesi) — SPEC §3
const files = [
  ...globSync('docs/**/*.md', { cwd: root }),
  ...globSync('docs/**/*.yaml', { cwd: root }),
];

let fixedCount = 0;
for (const rel of files) {
  const abs = path.join(root, rel);
  const raw = readFileSync(abs, 'utf8');
  // BOM varsa her durumda temizle (SPEC §3)
  const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const hadBom = content !== raw;
  if (!isDoubleEncoded(content)) {
    if (hadBom) {
      if (dryRun) console.log(` düz! ${rel} (BOM)`);
      else {
        writeFileSync(abs, content, 'utf8');
        console.log(`düzeltildi ${rel} (BOM)`);
      }
      fixedCount++;
    } else {
      console.log(`atla  ${rel} (bozuk değil)`);
    }
    continue;
  }
  const fixed = fixString(content);
  if (fixed === null) {
    console.log(`atla  ${rel} (geri çevrilemedi)`);
    continue;
  }
  if (dryRun) {
    console.log(` düz! ${rel}`);
  } else {
    const withoutBom = fixed.charCodeAt(0) === 0xfeff ? fixed.slice(1) : fixed;
    writeFileSync(abs, withoutBom, 'utf8');
    console.log(`düzeltildi ${rel}`);
  }
  fixedCount++;
}
console.log(`${fixedCount} dosya ${dryRun ? 'tespit edildi (dry-run)' : 'düzeltildi'}.`);
