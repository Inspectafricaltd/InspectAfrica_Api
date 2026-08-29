import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drizzle chained builder mocks. Each db.select() pops the next result off
// mockState.selectResults so tests can script consecutive queries.
const mockState = {
  selectResults: [] as any[][],
  updateRows: [] as any[],
  updateThrows: false,
  // What was handed to .set(), so tests can assert on the update payload.
  setArgs: [] as Record<string, any>[],
};

function mockChainable(): any {
  const c: any = {};
  c.from      = () => c;
  c.leftJoin  = () => c;
  c.where     = () => c;
  c.orderBy   = () => c;
  c.limit     = () => Promise.resolve(mockState.selectResults.shift() ?? []);
  return c;
}

const mockUpdate = vi.fn(() => ({
  set: (values: Record<string, any>) => (mockState.setArgs.push(values), {
    where: () => ({
      returning: () => {
        if (mockState.updateThrows) return Promise.reject(new Error('db down'));
        return Promise.resolve(mockState.updateRows);
      },
    }),
  }),
}));

vi.mock('../db/index.js', () => ({
  db: {
    select: () => mockChainable(),
    update: () => mockUpdate(),
  },
}));

const mockNotificationSend = vi.fn().mockResolvedValue(undefined);
vi.mock('./NotificationService.js', () => ({
  NotificationService: {
    send: (...args: unknown[]) => mockNotificationSend(...args),
  },
}));

vi.mock('./RevisionService.js', () => ({
  RevisionService: { log: vi.fn().mockResolvedValue(undefined) },
}));

const mockGenerateInBackground = vi.fn();
vi.mock('./ReportService.js', () => ({
  ReportService: {
    generateInBackground: (...args: unknown[]) => mockGenerateInBackground(...args),
  },
}));

vi.mock('./CertService.js', () => ({ CertService: {} }));
vi.mock('../lib/storage.js', () => ({ listFiles: vi.fn() }));

const { AdminService } = await import('./AdminService.js');

const ADMIN_ID = 'admin-uuid';
const INSPECTION_ID = 'inspection-uuid';

const flaggedRow = (overrides: Record<string, any> = {}) => ({
  id: INSPECTION_ID,
  status: 'flagged',
  inspectorId: 'inspector-uuid',
  isSolo: false,
  propertyAddress: '12 Adeola Odeku St',
  bookingClientId: 'client-uuid',
  bookingPropAddr: '12 Adeola Odeku St',
  clientUserId: 'client-uuid',
  clientEmail: 'client@example.com',
  clientFullName: 'Chidi Okafor',
  ...overrides,
});

// Regression coverage for issue #2: resolving a flag with `approve` set the
// inspection to approved and emailed the client, but never generated the
// report — an inspection reaches `flagged` from pending_review, so no PDF
// exists at that point.
describe('AdminService.resolveFlag — approve generates the report (issue #2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.selectResults = [];
    mockState.updateRows = [{ id: INSPECTION_ID, status: 'approved' }];
    mockState.updateThrows = false;
    mockState.setArgs = [];
  });

  it('triggers background report generation on approve', async () => {
    mockState.selectResults = [[flaggedRow()]];

    const res = await AdminService.resolveFlag(ADMIN_ID, INSPECTION_ID, 'approve', 'looks good');

    expect(res.error).toBeNull();
    expect(mockGenerateInBackground).toHaveBeenCalledTimes(1);
    expect(mockGenerateInBackground).toHaveBeenCalledWith(INSPECTION_ID, ADMIN_ID);
  });

  it('does not email the client at approve time — report_ready is sent from the generation success path (issue #8)', async () => {
    mockState.selectResults = [[flaggedRow()]];

    await AdminService.resolveFlag(ADMIN_ID, INSPECTION_ID, 'approve');

    expect(mockNotificationSend).not.toHaveBeenCalled();
  });

  it('generates the report for solo inspections but sends no client email', async () => {
    mockState.selectResults = [[flaggedRow({
      isSolo: true, bookingClientId: null, clientUserId: null, clientEmail: null, clientFullName: null,
    })]];

    const res = await AdminService.resolveFlag(ADMIN_ID, INSPECTION_ID, 'approve');

    expect(res.error).toBeNull();
    expect(mockGenerateInBackground).toHaveBeenCalledTimes(1);
    expect(mockNotificationSend).not.toHaveBeenCalled();
  });

  it('does not generate a report or notify anyone when the status update fails', async () => {
    mockState.selectResults = [[flaggedRow()]];
    mockState.updateThrows = true;

    const res = await AdminService.resolveFlag(ADMIN_ID, INSPECTION_ID, 'approve');

    expect(res.error).toBe('Failed to resolve flag');
    expect(mockGenerateInBackground).not.toHaveBeenCalled();
    expect(mockNotificationSend).not.toHaveBeenCalled();
  });

  it('does not generate a report when the inspection is not flagged', async () => {
    mockState.selectResults = [[flaggedRow({ status: 'pending_review' })]];

    const res = await AdminService.resolveFlag(ADMIN_ID, INSPECTION_ID, 'approve');

    expect(res.error).toBe('Inspection is not flagged');
    expect(mockGenerateInBackground).not.toHaveBeenCalled();
  });

  it('does not generate a report on request_revision, and re-notifies the inspector', async () => {
    mockState.selectResults = [
      [flaggedRow()],
      [{ id: 'inspector-uuid', email: 'inspector@example.com', fullName: 'Amina Bello' }],
    ];
    mockState.updateRows = [{ id: INSPECTION_ID, status: 'flagged' }];

    const res = await AdminService.resolveFlag(ADMIN_ID, INSPECTION_ID, 'request_revision', 'fix photos');

    expect(res.error).toBeNull();
    expect(mockGenerateInBackground).not.toHaveBeenCalled();
    expect(mockNotificationSend).toHaveBeenCalledWith('report_flagged', expect.objectContaining({
      recipientId: 'inspector-uuid',
      recipientEmail: 'inspector@example.com',
    }));
  });
});

// Regression coverage for issues #79 and #41. `request_revision` overwrote
// flag_reason with the revision notes and refreshed flagged_at, so nothing
// distinguished "flagged, nobody has acted" from "revision requested, waiting
// on the inspector" — and the reason it was flagged in the first place was
// destroyed. `approve` left flagged_at/flagged_by set and stuffed the resolution
// notes into flag_reason, so an approved inspection still read as flagged.
describe('AdminService.resolveFlag — revision state and flag clearing (issues #79, #41)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.selectResults = [];
    mockState.updateRows = [{ id: INSPECTION_ID, status: 'flagged' }];
    mockState.updateThrows = false;
    mockState.setArgs = [];
  });

  it('records a revision request without touching the original flag', async () => {
    mockState.selectResults = [
      [flaggedRow()],
      [{ id: 'inspector-uuid', email: 'inspector@example.com', fullName: 'Amina Bello' }],
    ];

    await AdminService.resolveFlag(ADMIN_ID, INSPECTION_ID, 'request_revision', 'add roof photos');

    const [payload] = mockState.setArgs;
    expect(payload?.revisionRequestedAt).toBeInstanceOf(Date);
    expect(payload?.revisionNotes).toBe('add roof photos');
    // The flag itself is untouched — its reason and timestamp still describe
    // why the inspection was flagged.
    expect(payload).not.toHaveProperty('flagReason');
    expect(payload).not.toHaveProperty('flaggedAt');
    expect(payload).not.toHaveProperty('flaggedBy');
    // Status stays `flagged` so submit()'s allowlist still accepts a resubmit.
    expect(payload).not.toHaveProperty('status');
  });

  it('clears every flag field when approving, so an approved row does not read as flagged', async () => {
    mockState.selectResults = [[flaggedRow()]];
    mockState.updateRows = [{ id: INSPECTION_ID, status: 'approved' }];

    await AdminService.resolveFlag(ADMIN_ID, INSPECTION_ID, 'approve', 'acceptable after review');

    const [payload] = mockState.setArgs;
    expect(payload).toMatchObject({
      status: 'approved',
      approvedBy: ADMIN_ID,
      flaggedAt: null,
      flaggedBy: null,
      flagReason: null,
      revisionRequestedAt: null,
      revisionNotes: null,
    });
  });
});
