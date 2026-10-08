import { describe, expect, it } from 'vitest';
import { idTimestamp, newId } from '../src/id';

describe('newId — UUID v7 (SPEC §0.1)', () => {
  it('üretilen her ID v7 sürümündedir (13. grup "7" ile başlar)', () => {
    for (let i = 0; i < 100; i++) {
      expect(newId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("zaman sıralıdır: ardışık iki ID'de ikincisi büyüktür (Faz 0 kabul kriteri)", () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]! > ids[i - 1]!).toBe(true);
    }
  });

  it('eşsizdir', () => {
    const set = new Set(Array.from({ length: 1000 }, () => newId()));
    expect(set.size).toBe(1000);
  });

  it('idTimestamp ilk 48 biti çözümler', () => {
    const before = Date.now();
    const id = newId();
    const ts = idTimestamp(id);
    expect(ts).not.toBeNull();
    expect(ts!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(ts!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('geçersiz ID için null döner', () => {
    expect(idTimestamp('not-a-uuid')).toBeNull();
    expect(idTimestamp('123e4567-e89b-12d3-a456-426614174000')).toBeNull(); // v4
  });
});
