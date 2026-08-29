import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockState = {
  selectResults: [] as any[][],
};

function mockSelectChain(): any {
  const c: any = {};
  c.from = () => c;
  c.leftJoin = () => c;
  c.where = () => c;
  c.limit = () => Promise.resolve(mockState.selectResults.shift() ?? []);
  c.then = (resolve: any, reject: any) =>
    Promise.resolve(mockState.selectResults.shift() ?? []).then(resolve, reject);
  return c;
}

vi.mock('../db/index.js', () => ({
  db: { select: () => mockSelectChain() },
}));

const mockNotificationSend = vi.fn().mockResolvedValue(undefined);
vi.mock('./NotificationService.js', () => ({
  NotificationService: { send: (...args: unknown[]) => mockNotificationSend(...args) },
}));

const mockBroadcastToRole = vi.fn();
vi.mock('../lib/eventBus.js', () => ({
  broadcast: vi.fn(),
  broadcastToRole: (...args: unknown[]) => mockBroadcastToRole(...args),
}));

vi.mock('./RevisionService.js', () => ({ RevisionService: { log: vi.fn() } }));
vi.mock('../lib/pdf.js', () => ({
  generatePdfFromHtml: vi.fn(),
  buildInspectionReportHtml: vi.fn(),
  resolveInspectionTypeAbbr: vi.fn(),
}));
vi.mock('../lib/reportFilename.js', () => ({ buildReportFilename: vi.fn() }));
vi.mock('../lib/storage.js', () => ({
  uploadFile: vi.fn(),
  deleteFiles: vi.fn(),
  downloadFile: vi.fn(),
  getSignedDownloadUrl: vi.fn(),
}));
vi.mock('../lib/imageProcessing.js', () => ({
  processCoverPhoto: vi.fn(),
  processFindingPhoto: vi.fn(),
  processSignature: vi.fn(),
}));

const { ReportService } = await import('./ReportService.js');

const INSPECTION_ID = 'inspection-uuid';
const ADMIN_ID = 'admin-uuid';

const flushBackground = async () => {
  // generateInBackground defers via setImmediate; retries via setTimeout.
  await vi.runAllTimersAsync();
};

// Regression coverage for issue #8: report generation ran in a detached
// setImmediate whose only failure handling was a log line, while the client
// had already been emailed "approved" — leaving an approved inspection with
// no report, no retry, and nothing visible to admins.
describe('ReportService.generateInBackground — failure handling (issues #7/#8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockState.selectResults = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing extra when generation succeeds', async () => {
    const generate = vi.spyOn(ReportService, 'generate').mockResolvedValue({ report: {}, error: null } as any);

    ReportService.generateInBackground(INSPECTION_ID, ADMIN_ID);
    await flushBackground();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(mockNotificationSend).not.toHaveBeenCalled();
    expect(mockBroadcastToRole).not.toHaveBeenCalled();
  });

  it('retries once, then succeeds silently', async () => {
    const generate = vi.spyOn(ReportService, 'generate')
      .mockResolvedValueOnce({ report: null, error: 'puppeteer crashed' } as any)
      .mockResolvedValueOnce({ report: {}, error: null } as any);

    ReportService.generateInBackground(INSPECTION_ID, ADMIN_ID);
    await flushBackground();

    expect(generate).toHaveBeenCalledTimes(2);
    expect(mockNotificationSend).not.toHaveBeenCalled();
    expect(mockBroadcastToRole).not.toHaveBeenCalled();
  });

  it('alerts admins by SSE and email after the retry also fails', async () => {
    vi.spyOn(ReportService, 'generate').mockResolvedValue({ report: null, error: 'R2 upload failed' } as any);
    mockState.selectResults = [
      [{ propertyAddress: '12 Adeola Odeku St', bookingPropAddr: null }], // inspection lookup
      [
        { id: 'admin-1', email: 'admin1@example.com', fullName: 'Ada Obi' },
        { id: 'admin-2', email: 'admin2@example.com', fullName: 'Tunde Musa' },
      ], // admin list
    ];

    ReportService.generateInBackground(INSPECTION_ID, ADMIN_ID);
    await flushBackground();

    expect(mockBroadcastToRole).toHaveBeenCalledWith('admin', 'report.generation_failed', expect.objectContaining({
      inspectionId: INSPECTION_ID,
      error: 'R2 upload failed',
    }));
    expect(mockNotificationSend).toHaveBeenCalledTimes(2);
    expect(mockNotificationSend).toHaveBeenCalledWith('report_generation_failed', expect.objectContaining({
      recipientEmail: 'admin1@example.com',
      data: expect.objectContaining({ inspectionId: INSPECTION_ID, errorMessage: 'R2 upload failed' }),
    }));
  });

  it('treats a thrown generate() the same as a returned error', async () => {
    vi.spyOn(ReportService, 'generate').mockRejectedValue(new Error('browser died'));
    mockState.selectResults = [
      [{ propertyAddress: 'X', bookingPropAddr: null }],
      [{ id: 'admin-1', email: 'admin1@example.com', fullName: 'Ada Obi' }],
    ];

    ReportService.generateInBackground(INSPECTION_ID, ADMIN_ID);
    await flushBackground();

    expect(mockBroadcastToRole).toHaveBeenCalledTimes(1);
    expect(mockNotificationSend).toHaveBeenCalledWith('report_generation_failed', expect.objectContaining({
      data: expect.objectContaining({ errorMessage: 'browser died' }),
    }));
  });
});
