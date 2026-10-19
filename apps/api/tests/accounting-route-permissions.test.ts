import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PERMISSION_BY_CODE } from '@kuleplus/shared';

/**
 * A4 regresyon bekçisi: muhasebe rotalarının TAMAMI `requirePermission` ile korunmalı
 * ve kullanılan her izin kodu katalogda tanımlı olmalı. Yeni bir uç eklenip yetkisi
 * unutulursa bu test kırılır.
 */
const source = readFileSync(
  fileURLToPath(new URL('../src/modules/accounting/routes.ts', import.meta.url)),
  'utf8',
);

// router.<yöntem>( ... ) çağrılarını sonraki router. çağrısına kadar blok olarak ayır.
const blocks = source
  .split(/\n(?=router\.(?:get|post|patch|delete)\()/)
  .filter((b) => /^router\.(get|post|patch|delete)\(/.test(b));

describe('muhasebe rotaları yetki kapısı (A4)', () => {
  it('rota blokları bulundu', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(40);
  });

  it.each(blocks.map((b) => [b.split('\n').slice(0, 2).join(' ').replace(/\s+/g, ' '), b]))(
    '%s requirePermission içerir',
    (_label, block) => {
      expect(block).toMatch(/requirePermission\('accounting\.[a-z_]+\.[a-z_]+'\)/);
    },
  );

  it('kullanılan tüm izin kodları katalogda tanımlı', () => {
    const codes = [...source.matchAll(/requirePermission\('([^']+)'\)/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThan(40);
    for (const code of new Set(codes)) {
      expect(PERMISSION_BY_CODE.has(code), `${code} katalogda yok`).toBe(true);
    }
  });

  it('dönem kilidi koymak/kaldırmak period.close, devredilemez', () => {
    expect(PERMISSION_BY_CODE.get('accounting.period.close')?.delegatable).toBe(false);
    const lockBlocks = blocks.filter((b) => b.includes("'/period-locks"));
    const mutating = lockBlocks.filter((b) => !b.startsWith('router.get('));
    expect(mutating.length).toBe(3);
    for (const b of mutating) expect(b).toContain("'accounting.period.close'");
  });
});
