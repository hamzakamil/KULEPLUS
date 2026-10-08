/**
 * axe-core a11y kontrolü — WCAG 2.1 AA hedefi (SPEC §24, ROADMAP Faz 0).
 *
 * Kullanım:
 *   node scripts/a11y-check.mjs            # dist yoksa atlar (exit 0)
 *   node scripts/a11y-check.mjs --strict   # ihlal varsa exit 1 (CI)
 *
 * Bağımlılıklar (devDependencies): axe-core, puppeteer-core (veya @playwright/test).
 * Chrome yoksa adım "skipped" olarak geçer (CI'da Chrome ayrıca kurulur).
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'apps', 'site', 'dist');
const strict = process.argv.includes('--strict');

function collectHtml(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectHtml(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

if (!existsSync(distDir)) {
  console.log('atla  apps/site/dist yok — önce `npm run build:site` çalıştırın.');
  process.exit(0);
}

const pages = collectHtml(distDir);
console.log(`axe-core: ${pages.length} HTML sayfası taranacak (hedef: WCAG 2.1 AA).`);

let puppeteer;
try {
  puppeteer = (await import('puppeteer-core')).default;
} catch {
  console.log('atla  puppeteer-core kurulu değil — axe adımı atlandı.');
  process.exit(0);
}

const browserCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
].filter(Boolean);

const executablePath = browserCandidates.find((p) => existsSync(p));
if (!executablePath) {
  console.log('atla  Chrome bulunamadı (CHROME_PATH ile belirtin) — axe adımı atlandı.');
  process.exit(0);
}

const axeModule = await import('axe-core');
const axeSource = axeModule.default?.source ?? axeModule.source;
if (!axeSource) {
  console.log('atla  axe-core kaynağı okunamadı — adım atlandı.');
  process.exit(0);
}
const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

let totalViolations = 0;
try {
  for (const page of pages) {
    const tab = await browser.newPage();
    await tab.goto(pathToFileURL(page).href, { waitUntil: 'networkidle0' });
    await tab.evaluate(axeSource);
    const results = await tab.evaluate(() =>
      globalThis.axe.run(document, {
        runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'],
      }),
    );
    const rel = path.relative(distDir, page);
    if (results.violations.length > 0) {
      totalViolations += results.violations.length;
      console.error(`✗ ${rel} — ${results.violations.length} ihlal`);
      for (const v of results.violations) {
        console.error(`    [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} düğüm)`);
      }
    } else {
      console.log(`✓ ${rel}`);
    }
    await tab.close();
  }
} finally {
  await browser.close();
}

if (totalViolations > 0) {
  console.error(`\n✗ axe-core: ${totalViolations} WCAG 2.1 AA ihlali (SPEC §24).`);
  process.exit(strict ? 1 : 0);
}
console.log('\n✓ axe-core: ihlal yok — WCAG 2.1 AA temiz.');
