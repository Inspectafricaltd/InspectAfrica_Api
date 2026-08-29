import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drizzle chained builder mocks. Names are `mock*`-prefixed so they can be
// referenced inside the hoisted vi.mock factory below.
const mockState = {
  rows: [] as any[],
  whereArgs: [] as any[],
};

function selectBuilder() {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    where: (expr: any) => {
      mockState.whereArgs.push(expr);
      return chain;
    },
    orderBy: () => chain,
    limit: () => chain,
    offset: () => Promise.resolve(mockState.rows),
    then: (resolve: any) => Promise.resolve([{ count: mockState.rows.length }]).then(resolve),
  };
  return chain;
}

vi.mock('../db/index.js', () => ({
  db: { select: () => selectBuilder() },
}));

import { InspectionService } from './InspectionService.js';

// Collects the columns a drizzle SQL expression touches, so a test can assert on
// what the predicate searches without reproducing drizzle's internals.
function columnsIn(expr: any, acc: string[] = [], depth = 0): string[] {
  if (!expr || typeof expr !== 'object' || depth > 12) return acc;
  if (expr.name && expr.table) acc.push(expr.name);
  for (const key of ['queryChunks', 'chunks']) {
    const children = expr[key];
    if (Array.isArray(children)) for (const c of children) columnsIn(c, acc, depth + 1);
  }
  return acc;
}

const admin = { id: 'admin-1', role: 'admin' };

// Regression coverage for issues #77 and #30. The property address lives on the
// inspection for solo jobs and on the booking for everything else. The list
// endpoint returned the inspection's own (null) column at the top level and
// buried the real one under `bookings`, so the admin Approved tab rendered
// "N/A" for every booking-based inspection, and address search matched none of
// them.
describe('InspectionService.list — address resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.rows = [];
    mockState.whereArgs = [];
  });

  it('falls back to the booking address for a booking-based inspection', async () => {
    mockState.rows = [{
      id: 'insp-1',
      bookingId: 'book-1',
      inspectorId: 'inspector-1',
      status: 'approved',
      propertyAddress: null,
      propertyType: null,
      inspectionType: null,
      bookingId2: 'book-1',
      bookingPropAddress: '45 Admiralty Way, Lekki Phase 1',
      bookingPropCity: 'Lagos',
      bookingPropType: 'residential',
      bookingInspType: 'shi',
      bookingRequestedDate: '2026-08-15',
    }];

    const res = await InspectionService.list(admin, {});
    const [row] = res.inspections;

    expect(row?.property_address).toBe('45 Admiralty Way, Lekki Phase 1');
    expect(row?.property_type).toBe('residential');
    expect(row?.inspection_type).toBe('shi');
    // The nested booking is still there for anything that needs the rest of it.
    expect(row?.bookings?.property_address).toBe('45 Admiralty Way, Lekki Phase 1');
  });

  it('keeps a solo inspection its own address', async () => {
    mockState.rows = [{
      id: 'insp-2',
      bookingId: null,
      inspectorId: 'inspector-1',
      status: 'in_progress',
      isSolo: true,
      propertyAddress: '3 Solo Street, Yaba',
      propertyType: 'residential',
      inspectionType: 'hhc',
      bookingId2: null,
    }];

    const res = await InspectionService.list(admin, {});
    const [solo] = res.inspections;

    expect(solo?.property_address).toBe('3 Solo Street, Yaba');
    expect(solo?.bookings).toBeNull();
  });

  it('falls back to the booking state/lga/country for a booking-based inspection', async () => {
    mockState.rows = [{
      id: 'insp-3',
      bookingId: 'book-3',
      inspectorId: 'inspector-1',
      status: 'approved',
      state: null,
      lga: null,
      country: null,
      bookingId2: 'book-3',
      bookingState: 'Greater Accra',
      bookingLga: 'Accra Metropolitan',
      bookingCountry: 'Ghana',
    }];

    const res = await InspectionService.list(admin, {});
    const [row] = res.inspections;

    expect(row?.state).toBe('Greater Accra');
    expect(row?.lga).toBe('Accra Metropolitan');
    expect(row?.country).toBe('Ghana');
    expect(row?.bookings?.country).toBe('Ghana');
  });

  it('searches the booking address as well as the inspection address', async () => {
    await InspectionService.list(admin, { search: 'Admiralty' });

    // The rows query and the count query each get the same predicate; check one.
    const columns = columnsIn(mockState.whereArgs[0]);

    // Both address columns must appear in it. Searching only the inspection's
    // own column matched no booking-based inspection at all, which is every
    // inspection that came from a booking.
    expect(columns.filter((c) => c === 'property_address')).toHaveLength(2);
  });

  it('does not filter on address when no search term is given', async () => {
    await InspectionService.list(admin, {});

    const columns = mockState.whereArgs.flatMap((w) => columnsIn(w));
    expect(columns).not.toContain('property_address');
  });
});
