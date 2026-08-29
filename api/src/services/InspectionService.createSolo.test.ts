import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drizzle chained builder mocks. Insert results are consumed per-call from a
// queue: the first db.insert is the inspector_profiles upsert, the second is
// the inspections insert. Selects capture their where clause so tests can
// assert the replay lookup is ownership-scoped.
const mockState = {
  insertReturning: [] as any[][],
  selectResults: [] as any[][],
  selectWheres: [] as unknown[],
  transactionRan: false,
};

function mockInsertChain(): any {
  const c: any = {};
  c.values = () => c;
  c.onConflictDoNothing = () => c;
  c.returning = () => Promise.resolve(mockState.insertReturning.shift() ?? []);
  // The profile upsert awaits the chain without .returning()
  c.then = (resolve: any, reject: any) => Promise.resolve([]).then(resolve, reject);
  return c;
}

function mockSelectChain(): any {
  const c: any = {};
  c.from = () => c;
  c.leftJoin = () => c;
  c.where = (clause: unknown) => {
    mockState.selectWheres.push(clause);
    return c;
  };
  c.limit = () => Promise.resolve(mockState.selectResults.shift() ?? []);
  return c;
}

vi.mock('../db/index.js', () => ({
  db: {
    insert: () => mockInsertChain(),
    select: () => mockSelectChain(),
    delete: () => ({ where: () => Promise.resolve() }),
    transaction: (cb: any) => {
      mockState.transactionRan = true;
      return cb({
        execute: () => Promise.resolve({ rows: [] }),
        select: () => mockSelectChain(),
        insert: () => mockInsertChain(),
      });
    },
  },
}));

vi.mock('./NotificationService.js', () => ({ NotificationService: { send: vi.fn() } }));
vi.mock('./RevisionService.js', () => ({ RevisionService: { log: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('./TemplateService.js', () => ({ TemplateService: {} }));
vi.mock('../lib/storage.js', () => ({ getSignedDownloadUrl: vi.fn() }));

const { InspectionService } = await import('./InspectionService.js');

// Collect bound parameter values from a drizzle SQL/condition object by
// walking its queryChunks tree.
function extractParams(node: any, out: unknown[] = []): unknown[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => extractParams(n, out));
    return out;
  }
  if ('value' in node && node.constructor?.name === 'Param') {
    out.push(node.value);
    return out;
  }
  if (Array.isArray(node.queryChunks)) extractParams(node.queryChunks, out);
  return out;
}

const INSPECTOR_A = 'inspector-a-uuid';
const FOREIGN_INSPECTION_ID = 'inspector-b-inspection-uuid';

const soloData = {
  propertyAddress: '5 Awolowo Road, Ikoyi',
  propertyType: 'residential' as const,
  inspectionType: 'shi',
  state: 'Lagos',
  lga: 'Eti-Osa',
};

// Regression coverage for issue #6: createSolo used the client-supplied UUID
// as the primary key with onConflictDoNothing, and on conflict fetched and
// returned the existing row by id alone — before consumeSoloToken ran. An
// inspector passing another inspector's inspection id received that
// inspection's data and consumed no token.
describe('InspectionService.createSolo — idempotency conflict path (issue #6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.insertReturning = [];
    mockState.selectResults = [];
    mockState.selectWheres = [];
    mockState.transactionRan = false;
  });

  it("scopes the replay lookup to the caller's own solo inspections", async () => {
    mockState.insertReturning = [[]]; // inspections insert conflicts → no row
    mockState.selectResults = [[]];   // scoped lookup finds nothing

    await InspectionService.createSolo(INSPECTOR_A, soloData as any, FOREIGN_INSPECTION_ID);

    expect(mockState.selectWheres).toHaveLength(1);
    const params = extractParams(mockState.selectWheres[0]);
    expect(params).toContain(FOREIGN_INSPECTION_ID);
    expect(params).toContain(INSPECTOR_A);
    expect(params).toContain(true); // isSolo = true
  });

  it("errors instead of returning a foreign inspection, and consumes no token", async () => {
    mockState.insertReturning = [[]];
    mockState.selectResults = [[]]; // ownership-scoped lookup: not yours → empty

    const res = await InspectionService.createSolo(INSPECTOR_A, soloData as any, FOREIGN_INSPECTION_ID);

    expect(res.inspection).toBeNull();
    expect(res.error).toBe('Failed to create solo inspection');
    // consumeSoloToken runs inside db.transaction — it must never start
    expect(mockState.transactionRan).toBe(false);
  });

  it('returns the existing row on a genuine replay of our own create', async () => {
    const ownRow = {
      id: 'own-inspection-uuid',
      inspectorId: INSPECTOR_A,
      isSolo: true,
      status: 'in_progress',
    };
    mockState.insertReturning = [[]];
    mockState.selectResults = [[ownRow]];

    const res = await InspectionService.createSolo(INSPECTOR_A, soloData as any, 'own-inspection-uuid');

    expect(res.error).toBeNull();
    expect(res.inspection?.id).toBe('own-inspection-uuid');
    // Replay must not double-consume the token either
    expect(mockState.transactionRan).toBe(false);
  });
});
