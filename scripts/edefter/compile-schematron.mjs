#!/usr/bin/env node
/**
 * GİB e-Defter schematron kurallarını (apps/api/assets/edefter/sch/*.sch) SaxonJS'in çalıştırdığı
 * derlenmiş stylesheet'e (SEF, *.sef.json) çevirir. GİB e-Defter Paketi güncellendiğinde:
 *   1. edefter.gov.tr → e-Defter_Paketi.zip içindeki sch/xsd/xslt dosyalarını assets'e kopyalayın,
 *   2. `node scripts/edefter/compile-schematron.mjs` çalıştırın,
 *   3. `INTEGRATION_DB=1 npm run test:integration -w apps/api` ile örnek defterleri doğrulayın.
 *
 * Dönüştürme ISO Schematron iskeletiyle (XSLT 2, MIT lisanslı — scripts/edefter/iso-schematron)
 * yapılır; xslt3 (SaxonJS derleyicisi) yalnızca geliştirme bağımlılığıdır.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const assets = join(root, 'apps', 'api', 'assets', 'edefter');
const skeleton = join(root, 'scripts', 'edefter', 'iso-schematron', 'iso_svrl_for_xslt2.xsl');
const xslt3 = join(root, 'node_modules', 'xslt3', 'xslt3.js');
const out = join(assets, 'sef');
const tmp = join(assets, '.tmp');
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });

for (const file of readdirSync(join(assets, 'sch')).filter((f) => f.endsWith('.sch'))) {
  const name = file.replace(/^edefter_/, '').replace(/\.sch$/, '');
  const xsl = join(tmp, `${name}.xsl`);
  execFileSync(
    process.execPath,
    [xslt3, `-xsl:${skeleton}`, `-s:${join(assets, 'sch', file)}`, `-o:${xsl}`],
    {
      stdio: 'inherit',
    },
  );
  execFileSync(
    process.execPath,
    [xslt3, `-xsl:${xsl}`, `-export:${join(out, `${name}.sef.json`)}`, '-nogo'],
    {
      stdio: 'inherit',
    },
  );
  console.log(`✓ ${file} → sef/${name}.sef.json`);
}
rmSync(tmp, { recursive: true, force: true });
