import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drizzle chained builder mock. listInspectors fires three queries in one
// Promise.all — page rows, filtered total, unfiltered status breakdown — then a
// fourth grouped count for inspections-per-inspector. Each db.select() pops the
// next scripted result.
const mockState = {
  selectResults: [] as any[][],
  whereArgs: [] as unknown[],
};

// Every builder method returns the chain and only `.then` consumes a result, so
// the scripted results are handed out in await order rather than in whatever
// order the chains happen to be constructed.
function mockChainable(): any {
  const c: any = {};
  c.from     = () => c;
  c.leftJoin = () => c;
  c.where    = (arg: unknown) => { mockState.whereArgs.push(arg); return c; };
  c.orderBy  = () => c;
  c.groupBy  = () => c;
  c.limit    = () => c;
  c.offset   = () => c;
  c.then     = (resolve: any, reject: any) =>
    Promise.resolve(mockState.selectResults.shift() ?? []).then(resolve, reject);
  return c;
}

vi.mock('../db/index.js', () => ({
  db: { select: () => mockChainable() },
}));
vi.mock('../lib/logger.js', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('../lib/storage.js', () => ({ listFiles: vi.fn() }));
vi.mock('./NotificationService.js', () => ({ NotificationService: { send: vi.fn() } }));
vi.mock('./RevisionService.js', () => ({ RevisionService: { log: vi.fn() } }));

const { AdminService } = await import('./AdminService.js');

beforeEach(() => {
  mockState.selectResults = [];
  mockState.whereArgs = [];
});

describe('AdminService.listInspectors — status counts', () => {
  // The reported defect: the dashboard tile said 15 while the Certified,
  // Candidates and Suspended tabs added up to 14, and the screen offered no
  // way to tell which number was wrong.
  it('returns a breakdown that sums to the same total the dashboard counts', async () => {
    mockState.selectResults = [
      [],                                   // page rows
      [{ count: 15 }],                      // filtered total
      [                                     // unfiltered status breakdown
        { status: 'candidate', count: 10 },
        { status: 'certified', count: 3 },
        { status: 'suspended', count: 1 },
        { status: 'expired', count: 1 },
      ],
    ];

    const { counts } = await AdminService.listInspectors({});

    expect(counts).toEqual({ all: 15, certified: 3, candidate: 10, suspended: 1, expired: 1 });
    expect(counts.certified + counts.candidate + counts.suspended + counts.expired).toBe(counts.all);
  });

  // achi_status is nullable. Such a row used to appear under "All" and in no
  // status tab, so the tabs could not add up however carefully you counted.
  it('counts a null achi_status as a candidate, so no inspector falls outside a tab', async () => {
    mockState.selectResults = [
      [],
      [{ count: 3 }],
      [
        { status: null, count: 1 },
        { status: 'candidate', count: 1 },
        { status: 'certified', count: 1 },
      ],
    ];

    const { counts } = await AdminService.listInspectors({});

    expect(counts.all).toBe(3);
    expect(counts.candidate).toBe(2);
    expect(counts.certified + counts.candidate + counts.suspended + counts.expired).toBe(counts.all);
  });

  it('reports zeroed counts rather than throwing when the query fails', async () => {
    const { db } = await import('../db/index.js');
    vi.spyOn(db, 'select').mockImplementationOnce(() => { throw new Error('connection lost'); });

    const result = await AdminService.listInspectors({});

    expect(result.inspectors).toEqual([]);
    expect(result.counts).toEqual({ all: 0, certified: 0, candidate: 0, suspended: 0, expired: 0 });
  });
});
