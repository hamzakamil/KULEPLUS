/**
 * Bundle bütçesi kontrolü — ROADMAP Faz 0/2:
 * "Initial JS < 250 KB gzip, route chunk < 100 KB gzip"
 *
 * Kullanım: node scripts/bundle-budget.mjs [distDir]
 * Varsayılan: apps/site/dist
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = process.argv[2] ?? path.join(root, 'apps', 'site', 'dist');

const TOTAL_BUDGET_KB = 250;
const CHUNK_BUDGET_KB = 100;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const jsFiles = walk(distDir).filter((f) => f.endsWith('.js'));
let total = 0;
let failed = false;
const rows = [];

for (const file of jsFiles) {
  const gz = gzipSync(readFileSync(file)).length;
  total += gz;
  const kb = Math.round((gz / 1024) * 10) / 10;
  const over = kb > CHUNK_BUDGET_KB;
  if (over) failed = true;
  rows.push({ file: path.relative(distDir, file), kb, over });
}

rows.sort((a, b) => b.kb - a.kb);
for (const r of rows) {
  console.log(`  ${r.over ? '✗' : '✓'} ${r.kb} KB gzip  ${r.file}`);
}

const totalKb = Math.round((total / 1024) * 10) / 10;
console.log(`Toplam JS: ${totalKb} KB gzip (bütçe: ${TOTAL_BUDGET_KB} KB)`);
if (totalKb > TOTAL_BUDGET_KB) {
  console.error(`✗ Toplam bundle bütçesi aşıldı: ${totalKb} KB > ${TOTAL_BUDGET_KB} KB`);
  failed = true;
}
if (failed) process.exit(1);
console.log('✓ Bundle bütçesi uygun.');
