import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drizzle chained builder mocks. `mock*` prefix so they can be referenced from
// inside the hoisted vi.mock factory below.
const mockState = {
  existing: [] as any[],
  insertThrows: null as any,
  inserted: [{ id: 'booking-1', status: 'open' }] as any[],
  selectWhere: [] as any[],
};

function selectChain(): any {
  const c: any = {};
  c.from = () => c;
  c.where = (e: any) => { mockState.selectWhere.push(e); return c; };
  c.limit = () => Promise.resolve(mockState.existing);
  return c;
}

const mockInsert = vi.fn(() => ({
  values: () => ({
    returning: () => {
      if (mockState.insertThrows) return Promise.reject(mockState.insertThrows);
      return Promise.resolve(mockState.inserted);
    },
  }),
}));

vi.mock('../db/index.js', () => ({
  db: { select: () => selectChain(), insert: () => mockInsert() },
}));
vi.mock('./NotificationService.js', () => ({ NotificationService: { send: vi.fn() } }));
vi.mock('./RevisionService.js', () => ({ RevisionService: { log: vi.fn() } }));
vi.mock('../lib/eventBus.js', () => ({ broadcastToRole: vi.fn(), broadcast: vi.fn() }));

const { BookingService, ACTIVE_BOOKING_STATUSES } = await import('./BookingService.js');

const DATA = {
  propertyAddress: '91 Race Condition Road, Ikeja',
  propertyCity: 'Lagos',
  propertyType: 'residential',
  inspectionType: 'shi',
  requestedDate: '2026-09-20',
} as any;

// Regression coverage for #97 and #19. The duplicate guard read before it wrote,
// so concurrent submits — three taps on Confirm Booking — all passed the check
// and all inserted, producing three real bookings a millisecond apart. And the
// statuses it checked were wrong: 'pending' and 'accepted' are never written,
// while 'confirmed' (an inspector has claimed it) was missing entirely.
describe('BookingService.create — duplicate guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.existing = [];
    mockState.insertThrows = null;
    mockState.inserted = [{ id: 'booking-1', status: 'open' }];
    mockState.selectWhere = [];
  });

  it('treats exactly the statuses a booking is actually live in as blocking', () => {
    // 'confirmed' — an inspector has claimed it — was missing, which is the one
    // that matters most. 'pending' and 'accepted' are never written by this
    // application, so checking for them matched nothing.
    expect([...ACTIVE_BOOKING_STATUSES]).toEqual(['open', 'confirmed', 'in_progress']);
    // A finished or cancelled booking must not block rebooking the same property.
    expect(ACTIVE_BOOKING_STATUSES).not.toContain('completed' as never);
    expect(ACTIVE_BOOKING_STATUSES).not.toContain('cancelled' as never);
  });

  it('rejects a duplicate it can see, without inserting', async () => {
    mockState.existing = [{ id: 'existing-booking' }];

    const res = await BookingService.create('client-1', DATA);

    expect(res.booking).toBeNull();
    expect(res.error).toMatch(/already exists/i);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('turns the unique-index violation into the same duplicate message', async () => {
    // What the loser of a race actually gets back: the pre-check found nothing,
    // then the database refused the insert.
    mockState.insertThrows = Object.assign(new Error('duplicate key value violates unique constraint "bookings_active_client_property_date_unique"'), { code: '23505' });

    const res = await BookingService.create('client-1', DATA);

    expect(res.booking).toBeNull();
    expect(res.error).toMatch(/already exists/i);
    // Crucially not a generic failure — the client can act on this.
    expect(res.error).not.toMatch(/failed to create/i);
  });

  it('still reports an unrelated database failure as a failure', async () => {
    mockState.insertThrows = Object.assign(new Error('connection terminated'), { code: '08006' });

    const res = await BookingService.create('client-1', DATA);

    expect(res.booking).toBeNull();
    expect(res.error).toMatch(/failed to create/i);
  });

  it('creates the booking when there is no duplicate', async () => {
    const res = await BookingService.create('client-1', DATA);

    expect(res.error).toBeNull();
    expect(res.booking).toBeTruthy();
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });
});
