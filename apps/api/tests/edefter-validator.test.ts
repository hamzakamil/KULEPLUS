import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { edefterAssetsDir, validateBook } from '../src/modules/edefter/validator';

/**
 * GİB e-Defter Paketi'ndeki imzalı örnek yevmiye defteri bizim doğrulayıcımızdan hatasız geçmeli;
 * imza çıkarılınca yalnızca "imza bekleniyor" kuralları kalmalı; bozulan bir kural yakalanmalı.
 */
const sampleName = '1234567808-201804-Y-000000.xml';
const sample = () => readFileSync(join(edefterAssetsDir(), 'samples', sampleName), 'utf8');

describe('e-Defter doğrulayıcı (GİB şema + schematron)', () => {
  it('GİB örnek yevmiye defteri geçerli', async () => {
    const r = await validateBook(sample(), sampleName, 'Y');
    expect(r.errors).toEqual([]);
    expect(r.signaturePending).toEqual([]);
    expect(r.valid).toBe(true);
  }, 60_000);

  it('imzasız defter: yalnızca imza kuralları bekler, iş kuralları temiz', async () => {
    const unsigned = sample().replace(/<ds:Signature[\s\S]*?<\/ds:Signature>/, '');
    const r = await validateBook(unsigned, sampleName, 'Y');
    expect(r.errors).toEqual([]);
    expect(r.signaturePending.length).toBeGreaterThan(0);
    expect(r.valid).toBe(true);
  }, 60_000);

  it('dosya adı / dönem uyuşmazlığı ve dengesiz madde yakalanır', async () => {
    const broken = sample()
      .replace(/<ds:Signature[\s\S]*?<\/ds:Signature>/, '')
      .replace(/(<gl-bus:totalDebit[^>]*>)1003425(<\/gl-bus:totalDebit>)/, '$11003426$2');
    const r = await validateBook(broken, '1234567808-201805-Y-000000.xml', 'Y');
    expect(r.valid).toBe(false);
    expect(r.errors.join('\n')).toMatch(/Dosya adındaki dönem/);
    expect(r.errors.join('\n')).toMatch(/totalDebit/);
  }, 60_000);
});
