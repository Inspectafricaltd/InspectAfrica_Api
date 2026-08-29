import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drizzle chained builder mocks. Each db.select() pops the next result off
// mockState.selectResults so tests can script consecutive queries.
const mockState = {
  selectResults: [] as any[][],
  // Rows handed back by the profile update's .returning() inside the transaction.
  updateReturning: [] as any[],
  transactionRan: false,
  transactionThrows: false,
  // What was handed to each .set(), in call order, so tests can assert on the
  // update payloads: [0] is the profile write, [1] is the users write.
  setArgs: [] as Record<string, any>[],
  // What was handed to tx.insert(...).values() — the audit rows.
  insertArgs: [] as Record<string, any>[],
};

function mockChainable(): any {
  const c: any = {};
  c.from     = () => c;
  c.leftJoin = () => c;
  c.where    = () => c;
  c.orderBy  = () => c;
  c.limit    = () => Promise.resolve(mockState.selectResults.shift() ?? []);
  return c;
}

// The profile update ends in .returning(); the users update is awaited directly.
// A thenable carrying a .returning() method satisfies both shapes.
const mockTx = {
  update: () => ({
    set: (values: Record<string, any>) => {
      mockState.setArgs.push(values);
      return {
        where: () => {
          const p: any = Promise.resolve(mockState.updateReturning);
          p.returning = () => Promise.resolve(mockState.updateReturning);
          return p;
        },
      };
    },
  }),
  insert: () => ({
    values: (v: Record<string, any>) => {
      mockState.insertArgs.push(v);
      return Promise.resolve(v);
    },
  }),
};

vi.mock('../db/index.js', () => ({
  db: {
    select: () => mockChainable(),
    transaction: (cb: (tx: typeof mockTx) => Promise<unknown>) => {
      mockState.transactionRan = true;
      if (mockState.transactionThrows) return Promise.reject(new Error('db down'));
      return cb(mockTx);
    },
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

vi.mock('./ReportService.js', () => ({
  ReportService: { generateInBackground: vi.fn() },
}));

vi.mock('../lib/storage.js', () => ({ listFiles: vi.fn() }));

const { AdminService } = await import('./AdminService.js');

const ADMIN_ID = 'admin-uuid';
const INSPECTOR_ID = 'inspector-uuid';

const userRow = (overrides: Record<string, any> = {}) => ({
  id: INSPECTOR_ID,
  fullName: 'Casper Chidubem',
  email: 'inspector@example.com',
  status: 'suspended',
  ...overrides,
});

// The state suspendInspector leaves behind: achi_status flipped to 'suspended'.
const suspendedProfile = (overrides: Record<string, any> = {}) => ({
  achiNumber: 'ACHI-2026-63556',
  achiStatus: 'suspended',
  achiExpiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  ...overrides,
});

const resetState = () => {
  vi.clearAllMocks();
  mockState.selectResults = [];
  mockState.updateReturning = [{ id: 'profile-uuid', userId: INSPECTOR_ID, achiStatus: 'certified', isActive: true }];
  mockState.transactionRan = false;
  mockState.transactionThrows = false;
  mockState.setArgs = [];
  mockState.insertArgs = [];
};

// Regression coverage for the reinstatement deadlock. reinstateInspector gated on
// CertService.verify, which returns valid only when achi_status === 'certified'.
// suspendInspector sets that field to 'suspended', so the check could never pass:
// any inspector holding an ACHI number, once suspended, was permanently locked
// out and returned early before users.status was restored to 'active'.
describe('AdminService.reinstateInspector — suspended inspectors can be reinstated', () => {
  beforeEach(resetState);

  it('reinstates an inspector whose achi_status is suspended and cert is unexpired', async () => {
    mockState.selectResults = [[suspendedProfile()], [userRow()]];

    const result = await AdminService.reinstateInspector(ADMIN_ID, INSPECTOR_ID);

    expect(result.error).toBeNull();
    expect(result.inspector).not.toBeNull();

    // The users write is what the old early-return skipped entirely.
    const [profileSet, usersSet] = mockState.setArgs;
    expect(profileSet).toMatchObject({ achiStatus: 'certified', isActive: true });
    expect(usersSet).toMatchObject({ status: 'active' });
  });

  it('restores an unverified candidate to candidate, not certified', async () => {
    // Self-registered inspector who typed an ACHI number that was never verified:
    // there is no expiry date, so the number alone must not earn 'certified'.
    mockState.selectResults = [
      [suspendedProfile({ achiNumber: 'ACHI-2026-00001', achiExpiresAt: null })],
      [userRow()],
    ];

    const result = await AdminService.reinstateInspector(ADMIN_ID, INSPECTOR_ID);

    expect(result.error).toBeNull();
    const [profileSet, usersSet] = mockState.setArgs;
    expect(profileSet).toMatchObject({ achiStatus: 'candidate', isActive: true });
    expect(usersSet).toMatchObject({ status: 'active' });
  });

  it('reinstates an inspector who has no ACHI number at all', async () => {
    mockState.selectResults = [
      [suspendedProfile({ achiNumber: null, achiExpiresAt: null })],
      [userRow()],
    ];

    const result = await AdminService.reinstateInspector(ADMIN_ID, INSPECTOR_ID);

    expect(result.error).toBeNull();
    expect(mockState.setArgs[0]).toMatchObject({ achiStatus: 'candidate', isActive: true });
  });

  it('refuses to reinstate when the certificate has genuinely expired', async () => {
    mockState.selectResults = [
      [suspendedProfile({ achiExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000) })],
      [userRow()],
    ];

    const result = await AdminService.reinstateInspector(ADMIN_ID, INSPECTOR_ID);

    expect(result.inspector).toBeNull();
    expect(result.error).toMatch(/expired/i);
    // Nothing should have been written.
    expect(mockState.transactionRan).toBe(false);
    expect(mockState.setArgs).toHaveLength(0);
  });

  it('returns an error when the inspector profile does not exist', async () => {
    mockState.selectResults = [[]];

    const result = await AdminService.reinstateInspector(ADMIN_ID, INSPECTOR_ID);

    expect(result.inspector).toBeNull();
    expect(result.error).toBe('Inspector profile not found');
    expect(mockState.transactionRan).toBe(false);
  });

  it('writes an audit row naming the acting admin', async () => {
    mockState.selectResults = [[suspendedProfile()], [userRow()]];

    await AdminService.reinstateInspector(ADMIN_ID, INSPECTOR_ID, 'appeal upheld');

    expect(mockState.insertArgs).toHaveLength(1);
    expect(mockState.insertArgs[0]).toMatchObject({
      actorId: ADMIN_ID,
      targetUserId: INSPECTOR_ID,
      action: 'reinstate_inspector',
      previousStatus: 'suspended',
      newStatus: 'active',
      reason: 'appeal upheld',
    });
  });
});

// The profile and users writes were two separate statements, the second wrapped
// in a log-only try/catch. A partial failure locked the user out of login while
// listInspectors — which filters on achi_status, not users.status — still showed
// them as normal, making the breakage invisible to admins.
describe('AdminService.suspendInspector — writes land atomically and are audited', () => {
  beforeEach(() => {
    resetState();
    mockState.updateReturning = [{ id: 'profile-uuid', userId: INSPECTOR_ID, achiStatus: 'suspended', isActive: false }];
  });

  it('suspends the profile and the user account in one transaction', async () => {
    mockState.selectResults = [[{ id: 'profile-uuid', userId: INSPECTOR_ID }], [userRow({ status: 'active' })]];

    const result = await AdminService.suspendInspector(ADMIN_ID, INSPECTOR_ID, 'forged certificate');

    expect(result.error).toBeNull();
    expect(mockState.transactionRan).toBe(true);

    const [profileSet, usersSet] = mockState.setArgs;
    expect(profileSet).toMatchObject({ achiStatus: 'suspended', isActive: false });
    expect(usersSet).toMatchObject({ status: 'suspended' });
  });

  it('records who suspended the account and why', async () => {
    mockState.selectResults = [[{ id: 'profile-uuid', userId: INSPECTOR_ID }], [userRow({ status: 'active' })]];

    await AdminService.suspendInspector(ADMIN_ID, INSPECTOR_ID, 'forged certificate');

    expect(mockState.insertArgs[0]).toMatchObject({
      actorId: ADMIN_ID,
      targetUserId: INSPECTOR_ID,
      action: 'suspend_inspector',
      previousStatus: 'active',
      newStatus: 'suspended',
      reason: 'forged certificate',
    });
  });

  it('does not email the inspector when the transaction fails', async () => {
    mockState.selectResults = [[{ id: 'profile-uuid', userId: INSPECTOR_ID }], [userRow({ status: 'active' })]];
    mockState.transactionThrows = true;

    const result = await AdminService.suspendInspector(ADMIN_ID, INSPECTOR_ID);

    expect(result.inspector).toBeNull();
    expect(result.error).toBe('Failed to suspend inspector');
    expect(mockNotificationSend).not.toHaveBeenCalled();
  });
});
