import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drizzle's chained query builder: .select().from().innerJoin().where().limit()
// We mock at the level of `db.select(...).from(...).innerJoin(...).where(...).limit(N)`,
// returning the test-configured rows.
const mockSelectChain = {
  rows: [] as any[],
};

function chainable(): any {
  const c: any = {};
  c.from        = () => c;
  c.innerJoin   = () => c;
  c.leftJoin    = () => c;
  c.where       = () => c;
  c.orderBy     = () => c;
  c.limit       = () => Promise.resolve(mockSelectChain.rows);
  c.offset      = () => Promise.resolve(mockSelectChain.rows);
  c.then        = (resolve: any) => Promise.resolve(mockSelectChain.rows).then(resolve);
  return c;
}

const mockInsert = vi.fn(() => {
  const chain: any = {};
  chain.values = () => chain;
  chain.returning = () => Promise.resolve([]);
  chain.onConflictDoNothing = () => chain;
  chain.onConflictDoUpdate = () => chain;
  chain.then = (resolve: any) => Promise.resolve().then(resolve);
  return chain;
});

const mockUpdate = vi.fn(() => ({
  set: () => ({
    where: () => ({
      returning: () => Promise.resolve([]),
    }),
  }),
}));

const mockGetSignedUploadUrl = vi.fn();

vi.mock('../db/index.js', () => ({
  db: {
    select: () => chainable(),
    insert: mockInsert,
    update: mockUpdate,
  },
}));

vi.mock('../lib/storage.js', () => ({
  getSignedUploadUrl: (...args: unknown[]) => mockGetSignedUploadUrl(...args),
}));

const { PhotoService } = await import('./PhotoService.js');

const INSPECTOR_ID = 'inspector-uuid';
const CONDITION_ID = 'condition-uuid';
const INSPECTION_ID = 'inspection-uuid';

function conditionRow(photoCount: number, overrides: Record<string, unknown> = {}) {
  return [{
    condId:       CONDITION_ID,
    inspectionId: INSPECTION_ID,
    photoCount,
    inspectorId:  INSPECTOR_ID,
    status:       'in_progress',
    ...overrides,
  }];
}

describe('PhotoService.getSignedUploadUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSignedUploadUrl.mockResolvedValue({
      signedUrl: 'https://r2.example.com/upload',
      path:      'placeholder',
      expiresIn: 300,
    });
  });

  it('rejects when photo_count is already 5', async () => {
    mockSelectChain.rows = conditionRow(5);
    const result = await PhotoService.getSignedUploadUrl(INSPECTOR_ID, { conditionId: CONDITION_ID });
    expect(result.error).toBe('Maximum 5 photos per item');
    expect(mockGetSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('rejects when photo_count exceeds 5', async () => {
    mockSelectChain.rows = conditionRow(7);
    const result = await PhotoService.getSignedUploadUrl(INSPECTOR_ID, { conditionId: CONDITION_ID });
    expect(result.error).toBe('Maximum 5 photos per item');
  });

  it('allows upload when photo_count is 4', async () => {
    mockSelectChain.rows = conditionRow(4);
    const result = await PhotoService.getSignedUploadUrl(INSPECTOR_ID, { conditionId: CONDITION_ID });
    expect(result.error).toBeNull();
    expect(result.uploadUrl).toBeTruthy();
  });

  it('allows upload when photo_count is 0', async () => {
    mockSelectChain.rows = conditionRow(0);
    const result = await PhotoService.getSignedUploadUrl(INSPECTOR_ID, { conditionId: CONDITION_ID });
    expect(result.error).toBeNull();
  });

  it('rejects when condition not found', async () => {
    mockSelectChain.rows = [];
    const result = await PhotoService.getSignedUploadUrl(INSPECTOR_ID, { conditionId: CONDITION_ID });
    expect(result.error).toBe('Condition not found');
  });

  it('rejects when inspection is in pending_review status', async () => {
    mockSelectChain.rows = conditionRow(0, { status: 'pending_review' });
    const result = await PhotoService.getSignedUploadUrl(INSPECTOR_ID, { conditionId: CONDITION_ID });
    expect(result.error).toBe('Cannot upload photo in current inspection status');
  });

  it('rejects when inspector does not own the condition', async () => {
    mockSelectChain.rows = conditionRow(0, { inspectorId: 'other-inspector' });
    const result = await PhotoService.getSignedUploadUrl(INSPECTOR_ID, { conditionId: CONDITION_ID });
    expect(result.error).toBe('You do not have access to this condition');
  });

  it('errors if both conditionId and observationId are provided', async () => {
    const result = await PhotoService.getSignedUploadUrl(INSPECTOR_ID, {
      conditionId: CONDITION_ID,
      observationId: 'obs-uuid',
    });
    expect(result.error).toBeTruthy();
  });
});
