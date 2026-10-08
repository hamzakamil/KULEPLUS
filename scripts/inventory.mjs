#!/usr/bin/env node
/**
 * Proje Envanteri — ROADMAP §4 "Mevcut kod/tablo/route/ekran envanteri"
 * Çıktı: JSON + Markdown rapor
 * Kullanım: node scripts/inventory.mjs [--json|--md]
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, extname, relative } from 'node:path';

const ROOT = resolve('./');
const IGNORE_DIRS = [
  'node_modules',
  '.git',
  '.astro',
  'dist',
  'coverage',
  '.kilo',
  'docs',
  'scripts',
];

function walk(dir, acc = []) {
  const entries = readdirSync(dir);
  for (const name of entries) {
    if (IGNORE_DIRS.includes(name)) continue;
    const full = resolve(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function classifyFile(file) {
  const rel = relative(ROOT, file);
  const ext = extname(file).toLowerCase();
  const parts = rel.split(/[/\\]/);
  const app = parts[1] || 'root';
  let type = 'other';
  if (ext === '.ts' || ext === '.tsx') type = 'typescript';
  else if (ext === '.js' || ext === '.mjs') type = 'javascript';
  else if (ext === '.vue') type = 'vue';
  else if (ext === '.astro') type = 'astro';
  else if (ext === '.sql') type = 'sql';
  else if (ext === '.md') type = 'markdown';
  else if (ext === '.json') type = 'json';
  else if (ext === '.css') type = 'css';
  else if (ext === '.yml' || ext === '.yaml') type = 'yaml';
  let category = 'other';
  if (rel.includes('/tests/') || rel.includes('.test.') || rel.includes('.spec.'))
    category = 'test';
  else if (rel.includes('/migrations/')) category = 'migration';
  else if (rel.includes('/seeds/')) category = 'seed';
  else if (rel.includes('/src/')) category = 'source';
  else if (
    rel.includes('/config/') ||
    rel.startsWith('astro.config') ||
    rel.startsWith('vite.config') ||
    rel.startsWith('tsconfig') ||
    rel.startsWith('eslint') ||
    rel.startsWith('prettier') ||
    rel.startsWith('.env')
  )
    category = 'config';
  else if (rel.includes('/scripts/')) category = 'script';
  return { rel, ext, app, type, category };
}
function extractRoutes(content, file) {
  const routes = [];
  if (file.endsWith('.astro') && file.includes('src/pages/')) {
    const route = file
      .replace(/.*src\/pages\//, '/')
      .replace(/\.astro$/, '')
      .replace(/\/index$/, '');
    routes.push({ file, route, method: 'GET', framework: 'astro' });
  }
  const expressMatches = content.matchAll(
    /(app|router)\.(get|post|put|patch|delete)\(['"`]([^'"`]+)['"`]/g,
  );
  for (const m of expressMatches) {
    routes.push({ file, route: m[3], method: m[2].toUpperCase(), framework: 'express' });
  }
  const vueRouteMatches = content.matchAll(/path:\s*['"`]([^'"`]+)['"`]/g);
  for (const m of vueRouteMatches) {
    routes.push({ file, route: m[1], method: 'GET', framework: 'vue-router' });
  }
  return routes;
}

function extractTables(content) {
  const tables = [];
  const sqlTables = content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi);
  for (const m of sqlTables) tables.push({ name: m[1], source: 'sql' });
  const drizzleTables = content.matchAll(/pgTable\(['"`](\w+)['"`]/g);
  for (const m of drizzleTables) tables.push({ name: m[1], source: 'drizzle' });
  return tables;
}

function extractScreens(content, file) {
  const screens = [];
  if (file.endsWith('.vue') && file.includes('/views/')) {
    const name = file.replace(/.*\/views\//, '').replace(/\.vue$/, '');
    screens.push({ file, name, framework: 'vue' });
  }
  if (file.endsWith('.astro') && file.includes('src/pages/')) {
    const name = file
      .replace(/.*src\/pages\//, '')
      .replace(/\.astro$/, '')
      .replace(/\/index$/, '');
    screens.push({ file, name, framework: 'astro' });
  }
  return screens;
}

function main() {
  const files = walk(ROOT);
  const report = {
    generatedAt: new Date().toISOString(),
    totals: { files: 0, lines: 0 },
    byApp: {},
    byType: {},
    byCategory: {},
    routes: [],
    tables: [],
    screens: [],
    files: [],
  };

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    const lines = content.split('\n').length;
    const info = classifyFile(file);

    report.totals.files++;
    report.totals.lines += lines;

    report.byApp[info.app] = (report.byApp[info.app] || 0) + 1;
    report.byType[info.type] = (report.byType[info.type] || 0) + 1;
    report.byCategory[info.category] = (report.byCategory[info.category] || 0) + 1;

    report.routes.push(...extractRoutes(content, file));
    report.tables.push(...extractTables(content));
    report.screens.push(...extractScreens(content, file));

    report.files.push({ ...info, lines });
  }

  const seenTables = new Set();
  report.tables = report.tables.filter((t) => {
    const key = t.name.toLowerCase();
    if (seenTables.has(key)) return false;
    seenTables.add(key);
    return true;
  });

  const args = process.argv.slice(2);
  if (args.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    let md = `# Proje Envanteri\n\n> Oluşturulma: ${report.generatedAt}\n\n`;
    md += `## Özet\n\n`;
    md += `| Metrik | Değer |\n|--------|-------|\n| Dosya sayısı | ${report.totals.files} |\n| Toplam satır | ${report.totals.lines} |\n| Rota sayısı | ${report.routes.length} |\n| Tablo sayısı | ${report.tables.length} |\n| Ekran sayısı | ${report.screens.length} |\n\n`;
    md += `## Uygulama Bazında\n\n`;
    for (const [app, count] of Object.entries(report.byApp).sort((a, b) => b[1] - a[1])) {
      md += `- **${app}**: ${count} dosya\n`;
    }
    md += `\n## Tür Bazında\n\n`;
    for (const [type, count] of Object.entries(report.byType).sort((a, b) => b[1] - a[1])) {
      md += `- **${type}**: ${count} dosya\n`;
    }
    md += `\n## Kategori Bazında\n\n`;
    for (const [cat, count] of Object.entries(report.byCategory).sort((a, b) => b[1] - a[1])) {
      md += `- **${cat}**: ${count} dosya\n`;
    }
    md += `\n## Rotalar (${report.routes.length})\n\n`;
    md += `| Dosya | Rota | Metod | Framework |\n|-------|------|-------|-----------|\n`;
    for (const r of report.routes.slice(0, 50)) {
      md += `| ${r.file} | ${r.route} | ${r.method} | ${r.framework} |\n`;
    }
    if (report.routes.length > 50) md += `\n... ve ${report.routes.length - 50} rota daha\n`;
    md += `\n## Tablolar (${report.tables.length})\n\n`;
    md += `| Tablo | Kaynak |\n|-------|--------|\n`;
    for (const t of report.tables.sort((a, b) => a.name.localeCompare(b.name))) {
      md += `| ${t.name} | ${t.source} |\n`;
    }
    md += `\n## Ekranlar (${report.screens.length})\n\n`;
    md += `| Dosya | Ekran | Framework |\n|-------|-------|-----------|\n`;
    for (const s of report.screens) {
      md += `| ${s.file} | ${s.name} | ${s.framework} |\n`;
    }

    writeFileSync('INVENTORY_REPORT.md', md, 'utf8');
    console.log('✓ INVENTORY_REPORT.md yazıldı');
  }
}

main();
