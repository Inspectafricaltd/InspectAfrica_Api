import { describe, it, expect, vi, beforeEach } from 'vitest';

// Records the order of operations inside the transaction so the tests can
// assert the advisory lock is taken before the balance is read.
const mockState = {
  balance: 0,
  calls: [] as string[],
};

const mockTx = {
  execute: vi.fn((query: unknown) => {
    mockState.calls.push('lock');
    return Promise.resolve({ rows: [], query });
  }),
  select: vi.fn(() => ({
    from: () => ({
      where: () => {
        mockState.calls.push('read-balance');
        return Promise.resolve([{ balance: mockState.balance }]);
      },
    }),
  })),
  insert: vi.fn(() => ({
    values: (v: unknown) => {
      mockState.calls.push('insert-consume');
      return Promise.resolve(v);
    },
  })),
};

vi.mock('../db/index.js', () => ({
  db: {
    transaction: (cb: (tx: typeof mockTx) => Promise<unknown>) => cb(mockTx),
  },
}));

vi.mock('./NotificationService.js', () => ({ NotificationService: { send: vi.fn() } }));
vi.mock('./RevisionService.js', () => ({ RevisionService: { log: vi.fn() } }));
vi.mock('./TemplateService.js', () => ({ TemplateService: {} }));
vi.mock('../lib/storage.js', () => ({ getSignedDownloadUrl: vi.fn() }));

const { InspectionService } = await import('./InspectionService.js');

const consumeSoloToken = (inspectorId: string, inspectionId: string) =>
  (InspectionService as any).consumeSoloToken(inspectorId, inspectionId) as Promise<string | null>;

// Regression coverage for issue #5: the balance was read via
// COALESCE(SUM(delta)) with no lock, so two concurrent solo creations at
// balance=1 both read 1 and both inserted -1 — two inspections on one token.
// The fix serializes check-and-insert with a per-inspector advisory xact lock.
describe('InspectionService.consumeSoloToken — double-spend race (issue #5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.balance = 1;
    mockState.calls = [];
  });

  it('takes the per-inspector advisory lock before reading the balance', async () => {
    const res = await consumeSoloToken('inspector-1', 'inspection-1');

    expect(res).toBeNull();
    expect(mockState.calls).toEqual(['lock', 'read-balance', 'insert-consume']);
    // The lock statement keys on the inspector so different inspectors don't
    // contend with each other.
    const lockSql = JSON.stringify((mockTx.execute.mock.calls[0] as any[])[0]);
    expect(lockSql).toContain('pg_advisory_xact_lock');
    expect(lockSql).toContain('inspector-1');
  });

  it('consumes exactly one token at balance 1', async () => {
    const res = await consumeSoloToken('inspector-1', 'inspection-1');

    expect(res).toBeNull();
    expect(mockState.calls.filter((c) => c === 'insert-consume')).toHaveLength(1);
  });

  it('returns insufficient_tokens at balance 0 and inserts nothing', async () => {
    mockState.balance = 0;

    const res = await consumeSoloToken('inspector-1', 'inspection-1');

    expect(res).toBe('insufficient_tokens');
    expect(mockState.calls).toEqual(['lock', 'read-balance']);
  });

  it('returns insufficient_tokens for a negative balance', async () => {
    mockState.balance = -1;

    const res = await consumeSoloToken('inspector-1', 'inspection-1');

    expect(res).toBe('insufficient_tokens');
    expect(mockState.calls).not.toContain('insert-consume');
  });
});
