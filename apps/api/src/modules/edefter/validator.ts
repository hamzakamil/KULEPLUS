import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import SaxonJS from 'saxon-js';
import { validateXML } from 'xmllint-wasm';

/**
 * GİB e-Defter Paketi kurallarıyla yerel doğrulama:
 *  - XSD (xsd/edefter.xsd + XBRL GL 2006-10-25 + XAdES/xmldsig) — xmllint (wasm),
 *  - schematron iş kuralları (sef/*.sef.json; scripts/edefter/compile-schematron.mjs ile derlenir) — SaxonJS.
 * İmzayı entegratör atacağından imzaya ait kurallar ayrı listelenir (`signaturePending`); defter
 * ancak `errors` boşsa entegratöre verilebilir.
 */

export type BookType = 'Y' | 'K';

export interface ValidationResult {
  valid: boolean;
  /** Düzeltilmesi gereken hatalar (şema + iş kuralı). */
  errors: string[];
  /** İmza/mühür eksikliğinden doğan, entegratörün imzasıyla giderilecek kurallar. */
  signaturePending: string[];
}

let assetsDir: string | null = null;
/** Varlık klasörü: EDEFTER_ASSETS_DIR > kaynak ağacı (apps/api/assets/edefter) > çalışma dizini. */
export function edefterAssetsDir(): string {
  if (assetsDir) return assetsDir;
  const candidates = [
    process.env.EDEFTER_ASSETS_DIR,
    fileURLToPath(new URL('../../../assets/edefter', import.meta.url)),
    // Vercel paketi: apps/api/api/generated.js → apps/api/assets/edefter (vercel.json includeFiles)
    fileURLToPath(new URL('../assets/edefter', import.meta.url)),
    join(process.cwd(), 'assets', 'edefter'),
    join(process.cwd(), 'apps', 'api', 'assets', 'edefter'),
  ].filter((c): c is string => Boolean(c));
  const found = candidates.find((c) => existsSync(join(c, 'xsd', 'edefter.xsd')));
  if (!found) throw new Error('e-Defter varlıkları (assets/edefter) bulunamadı');
  assetsDir = found;
  return found;
}

type SchemaFile = { fileName: string; contents: string };
let schemaFiles: { main: SchemaFile; preload: SchemaFile[] } | null = null;
function loadSchemas() {
  if (schemaFiles) return schemaFiles;
  const dir = join(edefterAssetsDir(), 'xsd');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.xsd')) files.push(p);
    }
  };
  walk(dir);
  const load = (p: string): SchemaFile => ({
    fileName: relative(dir, p).split(sep).join('/'),
    contents: readFileSync(p, 'utf8'),
  });
  const mainPath = files.find((f) => f.endsWith(`${sep}edefter.xsd`) || f.endsWith('/edefter.xsd'));
  if (!mainPath) throw new Error('edefter.xsd bulunamadı');
  schemaFiles = { main: load(mainPath), preload: files.filter((f) => f !== mainPath).map(load) };
  return schemaFiles;
}

const SIGNATURE_XSD = /HashValue|Signature/;
/** Schematron'da imza bölümüne ait kurallar (ds:Signature yokken entegratörde tamamlanır). */
const SIGNATURE_RULE =
  /ds:Signature|ds:KeyInfo|ds:X509|ds:Object|xades:|ds:SignedInfo|özet\(hash\)/;

async function xsdErrors(xml: string, fileName: string): Promise<string[]> {
  const { main, preload } = loadSchemas();
  const r = await validateXML({ xml: [{ fileName, contents: xml }], schema: [main], preload });
  return r.errors
    .map((e) => String((e as { rawMessage?: string }).rawMessage ?? e.message))
    .filter((m) => !/warning/i.test(m))
    .map((m) => m.replace(/^.*?:\d+:\s*/, '').trim());
}

const sefCache = new Map<BookType, unknown>();
function sef(book: BookType) {
  let s = sefCache.get(book);
  if (!s) {
    const file = join(edefterAssetsDir(), 'sef', `${book === 'Y' ? 'yevmiye' : 'kebir'}.sef.json`);
    s = JSON.parse(readFileSync(file, 'utf8'));
    sefCache.set(book, s);
  }
  return s;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

async function schematronFailures(
  xml: string,
  fileName: string,
  book: BookType,
): Promise<string[]> {
  const result = (await SaxonJS.transform(
    {
      stylesheetInternal: sef(book),
      sourceText: xml,
      // Dosya adı kuralları (VKN-YYYYAA-Y-...) base-uri() üzerinden kontrol edilir.
      sourceBaseURI: `file:///edefter/${fileName}`,
      destination: 'serialized',
    },
    'async',
  )) as { principalResult: string };
  const out = result.principalResult;
  const failures: string[] = [];
  for (const m of out.matchAll(
    /<svrl:failed-assert\b[^>]*>[\s\S]*?<svrl:text>([\s\S]*?)<\/svrl:text>[\s\S]*?<\/svrl:failed-assert>/g,
  )) {
    failures.push(decode(m[1].replace(/\s+/g, ' ').trim()));
  }
  return failures;
}

/** Defter XML'ini GİB şema + schematron kurallarıyla doğrular. `fileName`: VKN-YYYYAA-Y-000000.xml */
export async function validateBook(
  xml: string,
  fileName: string,
  book: BookType,
): Promise<ValidationResult> {
  const [schema, rules] = await Promise.all([
    xsdErrors(xml, fileName),
    schematronFailures(xml, fileName, book),
  ]);
  const errors: string[] = [];
  const signaturePending: string[] = [];
  for (const e of schema) {
    // İmza öğesi yoksa XSD "HashValue veya ds:Signature bekleniyor" der — imzayla giderilir.
    if (SIGNATURE_XSD.test(e) && /Missing child|Expected is/i.test(e)) signaturePending.push(e);
    else errors.push(`Şema: ${e}`);
  }
  for (const r of rules) (SIGNATURE_RULE.test(r) ? signaturePending : errors).push(r);
  return { valid: errors.length === 0, errors, signaturePending };
}
