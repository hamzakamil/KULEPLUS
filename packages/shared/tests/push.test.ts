import { describe, it, expect } from 'vitest';
import { buildPushPayload, entityPath, isWithinQuietHours } from '../src/management/push';

/** Yerel saatli Date üretir (getHours/getMinutes yerel saati kullanır). */
function at(hours: number, minutes = 0): Date {
  return new Date(2026, 0, 15, hours, minutes, 0, 0);
}

describe('isWithinQuietHours', () => {
  const overnight = { quietHoursStart: '22:00', quietHoursEnd: '08:00' };

  it('gece yarısını aşan aralığı işler (22:00–08:00)', () => {
    expect(isWithinQuietHours(at(22, 0), overnight)).toBe(true); // başlangıç dahil
    expect(isWithinQuietHours(at(23, 30), overnight)).toBe(true);
    expect(isWithinQuietHours(at(0, 0), overnight)).toBe(true);
    expect(isWithinQuietHours(at(7, 59), overnight)).toBe(true);
    expect(isWithinQuietHours(at(8, 0), overnight)).toBe(false); // bitiş hariç
    expect(isWithinQuietHours(at(12, 0), overnight)).toBe(false);
  });

  it('gündüz aralığını işler (09:00–17:00)', () => {
    const day = { quietHoursStart: '09:00', quietHoursEnd: '17:00' };
    expect(isWithinQuietHours(at(8, 59), day)).toBe(false);
    expect(isWithinQuietHours(at(12, 0), day)).toBe(true);
    expect(isWithinQuietHours(at(17, 0), day)).toBe(false);
  });

  it('"HH:MM:SS" biçimini kabul eder', () => {
    expect(isWithinQuietHours(at(23, 0), { quietHoursStart: '22:00:00', quietHoursEnd: '08:00:00' })).toBe(
      true,
    );
  });

  it('eksik/boş/geçersiz değerlerde sessiz saat uygulanmaz', () => {
    expect(isWithinQuietHours(at(23, 0), { quietHoursStart: null, quietHoursEnd: null })).toBe(false);
    expect(isWithinQuietHours(at(23, 0), { quietHoursStart: '22:00', quietHoursEnd: null })).toBe(false);
    expect(isWithinQuietHours(at(23, 0), { quietHoursStart: 'bad', quietHoursEnd: '08:00' })).toBe(false);
    expect(isWithinQuietHours(at(23, 0), { quietHoursStart: '22:00', quietHoursEnd: '22:00' })).toBe(
      false,
    );
  });
});

describe('entityPath', () => {
  it('bilinen varlık türlerini yola çevirir', () => {
    expect(entityPath('invoice', 'abc')).toBe('/invoices/abc');
    expect(entityPath('contact', 'abc')).toBe('/contacts/abc');
    expect(entityPath('task', 'abc')).toBe('/management/tasks');
    expect(entityPath('appointment', 'abc')).toBe('/management/appointments');
  });

  it('eksik/ürüntü değerlerde köke döner', () => {
    expect(entityPath(null, null)).toBe('/');
    expect(entityPath('invoice', null)).toBe('/');
    expect(entityPath('unknown', 'abc')).toBe('/');
  });
});

describe('buildPushPayload', () => {
  it('bildirim türünü tag, varlığı url yapar', () => {
    const payload = buildPushPayload({
      title: 'Fatura gecikti',
      body: 'FTR-001 vadesi geçti',
      notificationType: 'invoice.overdue',
      entityType: 'invoice',
      entityId: 'inv-1',
    });
    expect(payload).toEqual({
      title: 'Fatura gecikti',
      body: 'FTR-001 vadesi geçti',
      url: '/invoices/inv-1',
      tag: 'invoice.overdue',
    });
  });

  it('boş gövdeyi boş dizgeye çevirir', () => {
    const payload = buildPushPayload({
      title: 'Test',
      body: null,
      notificationType: 'system.announcement',
      entityType: null,
      entityId: null,
    });
    expect(payload.body).toBe('');
    expect(payload.url).toBe('/');
  });
});
