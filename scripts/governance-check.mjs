/**
 * CI GOVERNANCE kural kontrolü — ROADMAP Faz 0 (Süreç):
 * "yeni tablo adı modül koduyla eşleşmiyorsa, permission formatı bozuksa
 *  veya yeni FLOAT/DOUBLE tanımı varsa PR reddedilir."
 *
 * Kaynaklar: docs/GOVERNANCE.md §2 (modül kodu ↔ tablolar), SPEC §0.3 (para: FLOAT/DOUBLE yasak),
 *            SPEC §6.1 (permission formatı module.resource.action),
 *            SPEC §0.1 / ADR-0002 (birincil anahtar UUID v7; gen_random_uuid() v4 üretir → yasak).
 *
 * Kullanım: node scripts/governance-check.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

// ---------- 1) GOVERNANCE §2 tablosunu ayrıştır ----------
const governance = readFileSync(path.join(root, 'docs', 'GOVERNANCE.md'), 'utf8');
const section2 = governance.split(/^## 2\./m)[1]?.split(/^## 3\./m)[0] ?? '';

const modules = new Map(); // module_code -> Set(tablo adları)
const permissionPrefixes = [];
for (const line of section2.split('\n')) {
  if (!line.startsWith('| `')) continue;
  const cols = line.split('|').map((c) => c.trim());
  // ['', module, permission_prefix, klasör, faz, tablolar, ...]
  const moduleCode = (cols[1] ?? '').replace(/`/g, '');
  const prefix = (cols[2] ?? '').replace(/`/g, '');
  const tablesCell = cols[5] ?? '';
  if (!moduleCode) continue;
  const tables = [...tablesCell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  modules.set(moduleCode, new Set(tables));
  permissionPrefixes.push({ moduleCode, prefix });
}

if (modules.size === 0) {
  errors.push('GOVERNANCE §2 tablosu okunamadı (satırlar "| `" ile başlamalı).');
}

const allowedTables = new Set();
for (const set of modules.values()) for (const t of set) allowedTables.add(t);

// ---------- 2) Dosya tarama yardımcıları ----------
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (['node_modules', 'dist', '.git', '.astro', 'preview.log'].includes(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const allFiles = walk(root);

// ---------- 3) FLOAT/DOUBLE/REAL yasağı (finansal alanlar) ----------
const FLOAT_RE = /\b(float|double|real)(\s+precision)?\s*(\(\s*\d+(\.\d+)?\s*\))?/i;
for (const file of allFiles) {
  if (!/\.(sql|ts)$/.test(file)) continue;
  if (file.includes(`scripts${path.sep}governance-check`)) continue;
  const content = readFileSync(file, 'utf8');
  // SQL kolon tanımları ve Drizzle: float(), double(), real(), doublePrecision()
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    const isSqlColumn =
      file.endsWith('.sql') && /create\s+table|alter\s+table|^\s{2}\w+\s+/i.test(line);
    const isDrizzleColumn =
      /\.(ts)$/.test(file) && /\b(float|double|real|doublePrecision)\s*\(/.test(line);
    if ((isSqlColumn || isDrizzleColumn) && FLOAT_RE.test(line) && !/--.*float/i.test(line)) {
      errors.push(`FLOAT/DOUBLE/REAL yasak (SPEC §0.3): ${path.relative(root, file)}:${i + 1}`);
    }
  });
}

// ---------- 4) Tablo adları modül koduna bağlı olmalı (GOVERNANCE §2) ----------
for (const file of allFiles) {
  if (!file.endsWith('.sql')) continue;
  const content = readFileSync(file, 'utf8');
  const tableRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"|\[)?([a-z_][a-z0-9_]*)/gi;
  for (const m of content.matchAll(tableRe)) {
    const table = m[1];
    if (!allowedTables.has(table)) {
      errors.push(
        `Tablo GOVERNANCE §2'de yok: "${table}" (${path.relative(root, file)}). ` +
          `Yeni tablo için GOVERNANCE §2'ye satır ekleyin + ADR yazın.`,
      );
    }
  }
}

// ---------- 5) UUID v7 yasağı: gen_random_uuid() kullanılamaz (SPEC §0.1, ADR-0002) ----------
for (const file of allFiles) {
  if (!file.endsWith('.sql')) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Yalnızca çalıştırılabilir SQL taranır; satır içi ve tam-satır yorumlar atlanır.
    const code = line.split('--')[0] ?? '';
    if (/gen_random_uuid\s*\(/i.test(code)) {
      errors.push(
        `gen_random_uuid() yasak (SPEC §0.1 / ADR-0002): ${path.relative(root, file)}:${i + 1}. ` +
          `Birincil anahtar UUID v7 olmalı; DB default'ı kullanılmaz, uygulama newId() ile üretir.`,
      );
    }
  });
}

// ---------- 6) Permission formatı: module.resource.action ----------
const permFile = path.join(root, 'packages', 'shared', 'permissions.ts');
try {
  const content = readFileSync(permFile, 'utf8');
  const literals = [...content.matchAll(/['"]([a-z][a-z0-9_]*(?:\.[a-z_*][a-z0-9_*]*)+)['"]/g)];
  for (const [full, literal] of literals) {
    const parts = literal.split('.');
    if (parts.length !== 3 || parts.some((p) => p !== '*' && !/^[a-z][a-z0-9_]*$/.test(p))) {
      errors.push(
        `Permission formatı bozuk: "${full}" → module.resource.action olmalı (SPEC §6.1).`,
      );
      continue;
    }
    if (!modules.has(parts[0])) {
      errors.push(`Permission modülü GOVERNANCE §2'de yok: "${full}" (modül: ${parts[0]}).`);
    }
  }
} catch {
  // permissions.ts henüz yok (Faz 1) — bu adım atlanır.
}

// ---------- Sonuç ----------
if (errors.length > 0) {
  console.error(`✗ GOVERNANCE kontrolü başarısız (${errors.length} ihlal):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `✓ GOVERNANCE kontrolü temiz — ${modules.size} modül, ${allowedTables.size} izinli tablo tarandı.`,
);
