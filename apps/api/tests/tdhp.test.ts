import { describe, expect, it } from 'vitest';
import { TDHP_ACCOUNTS } from '../src/modules/accounting/tdhp';

/**
 * Resmî Tek Düzen Hesap Planı kod/ad doğruluğu (A10).
 * Kaynak: resmî TDHP. Liste SMMM tarafından teyit edilmelidir (Faz 6).
 */
describe('TDHP şablonu', () => {
  const byCode = new Map(TDHP_ACCOUNTS.map(([code, name]) => [code, name]));

  it('kambiyo kârı 646, kambiyo zararı 656 olmalı', () => {
    expect(byCode.get('646')).toMatch(/KAMB[İI]YO K[ÂA]RLARI/);
    expect(byCode.get('656')).toMatch(/KAMB[İI]YO ZARARLARI/);
  });

  it('645/655 menkul kıymet satış kâr/zararı, 647/657 reeskont faizi olmalı', () => {
    expect(byCode.get('645')).toMatch(/MENKUL KIYMET SATIŞ KÂRLARI/);
    expect(byCode.get('655')).toMatch(/MENKUL KIYMET SATIŞ ZARARLARI/);
    expect(byCode.get('647')).toMatch(/REESKONT FAİZ GELİRLERİ/);
    expect(byCode.get('657')).toMatch(/REESKONT FAİZ GİDERLERİ/);
  });

  it('36x: 362/363 resmî planda yok; 368 vadesi geçmiş, 369 ödenecek diğer yükümlülükler', () => {
    expect(byCode.has('362')).toBe(false);
    expect(byCode.has('363')).toBe(false);
    expect(byCode.get('368')).toMatch(/^VADESİ GEÇMİŞ/);
    expect(byCode.get('369')).toBe('ÖDENECEK DİĞER YÜKÜMLÜLÜKLER');
  });

  it('37x: 370 dönem kârı vergi karşılığı, 372 kıdem tazminatı karşılığı', () => {
    expect(byCode.get('370')).toMatch(/^DÖNEM KÂRI VERGİ/);
    expect(byCode.get('372')).toBe('KIDEM TAZMİNATI KARŞILIĞI');
  });

  it('580 geçmiş yıllar zararları 58 grubunda', () => {
    expect(byCode.get('58')).toMatch(/GEÇMİŞ YILLAR ZARARLARI/);
  });

  it('fatura/değerleme kodları şablonda bulunur: 100, 102, 120, 153, 191, 320, 391, 600, 646, 656', () => {
    for (const c of ['100', '102', '120', '153', '191', '320', '391', '600', '646', '656']) {
      expect(byCode.has(c), c).toBe(true);
    }
  });

  it('645/655 kambiyo hesabı olarak tanımlı olmamalı', () => {
    expect(byCode.get('645') ?? '').not.toMatch(/KAMB[İI]YO/);
    expect(byCode.get('655') ?? '').not.toMatch(/KAMB[İI]YO/);
  });

  it('hesap kodları tekil, "308" mükerrer banka kredisi olmamalı', () => {
    const codes = TDHP_ACCOUNTS.map(([c]) => c);
    expect(new Set(codes).size).toBe(codes.length);
    expect(byCode.get('308') ?? '').not.toMatch(/BANKA KREDİLERİ/);
  });
});
