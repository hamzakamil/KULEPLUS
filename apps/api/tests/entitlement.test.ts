import { describe, expect, it, vi, beforeEach } from 'vitest';
import { requireModule, checkLimit, incrementUsage } from '../src/modules/entitlement/service';
import { getPool } from '@kuleplus/db';

vi.mock('@kuleplus/db', () => ({
  getPool: vi.fn(() => ({
    query: vi.fn(),
  })),
}));

describe('Entitlement Service - Unit Tests', () => {
  const mockQuery = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    const mockPool = { query: mockQuery };
    vi.mocked(getPool).mockReturnValue(mockPool as unknown as ReturnType<typeof getPool>);
  });

  describe('requireModule', () => {
    it('should return entitled true for active module', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            module_code: 'contacts',
            status: 'active',
            granted_at: new Date('2026-01-01'),
            expires_at: null,
          },
        ],
      });

      const result = await requireModule('tenant-123', 'contacts');

      expect(result.entitled).toBe(true);
      expect(result.status).toBe('active');
      expect(result.reason).toBeNull();
    });

    it('should return not entitled for non-existent module', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await requireModule('tenant-123', 'stock');

      expect(result.entitled).toBe(false);
      expect(result.reason).toBe('MODULE_NOT_ENTITLED');
    });
  });

  describe('checkLimit', () => {
    it('should allow usage when under limit', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              count: '50',
              plan_version_id: 'pv-1',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ value: '100' }] });

      const result = await checkLimit('tenant-123', 'max_contacts');

      expect(result.allowed).toBe(true);
      expect(result.current).toBe(50);
      expect(result.limit).toBe(100);
    });

    it('should deny usage when at limit', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              count: '100',
              plan_version_id: 'pv-1',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ value: '100' }] });

      const result = await checkLimit('tenant-123', 'max_contacts');

      expect(result.allowed).toBe(false);
      expect(result.current).toBe(100);
      expect(result.limit).toBe(100);
    });
  });

  describe('incrementUsage', () => {
    it('should call query with correct SQL structure', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await incrementUsage('tenant-123', 'max_contacts');

      expect(mockQuery).toHaveBeenCalled();
      const callArgs = mockQuery.mock.calls[0];
      expect(callArgs[0]).toContain('INSERT INTO usage_counters');
      expect(callArgs[0]).toContain('VALUES ($1, $2, $3, $4, $5)');
      expect(callArgs[0]).toContain('ON CONFLICT');
      expect(callArgs[0]).toContain('DO UPDATE SET count');
      // Parametre dizisi: tenantId, limitKey, periodStart, by, now
      expect(callArgs[1]).toHaveLength(5);
    });
  });
});
