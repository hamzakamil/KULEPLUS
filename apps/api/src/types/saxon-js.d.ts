/**
 * SaxonJS 2 (Saxonica) — paket tip tanımı içermez; e-Defter doğrulamasında kullanılan alt küme.
 * Lisans: Saxonica SaxonJS License (node_modules/saxon-js/LICENSE.txt) — uygulama içinde değiştirilmeden
 * dağıtıma izin verir; telif bildirimi docs/legal/THIRD-PARTY.md'de korunur.
 */
declare module 'saxon-js' {
  interface TransformOptions {
    stylesheetInternal?: unknown;
    stylesheetFileName?: string;
    sourceText?: string;
    sourceFileName?: string;
    sourceBaseURI?: string;
    destination?: 'serialized' | 'raw' | 'document';
    stylesheetParams?: Record<string, unknown>;
  }
  interface TransformResult {
    principalResult: unknown;
  }
  const SaxonJS: {
    transform(options: TransformOptions, mode: 'async'): Promise<TransformResult>;
    transform(options: TransformOptions): TransformResult;
  };
  export default SaxonJS;
}
