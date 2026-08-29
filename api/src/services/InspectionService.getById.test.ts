import { describe, it, expect, vi, beforeEach } from 'vitest';

// db.select() is called multiple times inside getById: the main inspection
// row (leftJoin + limit), then sections, conditions, photos, and additional
// observations. Only the first call should return real rows — everything
// after resolves empty so the function completes without extra fixtures.
let selectCallIndex = 0;
const mockState = { rows: [] as any[] };

function makeChain(result: any) {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: any) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

vi.mock('../db/index.js', () => ({
  db: {
    select: () => {
      selectCallIndex += 1;
      return selectCallIndex === 1 ? makeChain(mockState.rows) : makeChain([]);
    },
  },
}));

import { InspectionService } from './InspectionService.js';

const inspector = { id: 'inspector-1', role: 'inspector' };

// Regression coverage: booking-based inspections never copy property/state/
// country onto the inspection row (they live on the booking, joined by
// bookingId), but getById used to only select bookings.clientId — so the
// inspector's actual inspection-taking screens (SectionList, SectionDetail,
// ReviewScreen, all of which read via getById) showed no property address,
// state, or country at all for any inspection that came from a client
// booking. Only solo inspections, which store their own address, worked.
describe('InspectionService.getById — location resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallIndex = 0;
    mockState.rows = [];
  });

  it('falls back to the booking property/state/country for a booking-based inspection', async () => {
    mockState.rows = [{
      id: 'insp-1',
      bookingId: 'book-1',
      inspectorId: 'inspector-1',
      status: 'in_progress',
      propertyAddress: null,
      propertyType: null,
      inspectionType: null,
      state: null,
      lga: null,
      country: null,
      bookingClientId: 'client-1',
      bookingPropAddress: '12 Airport Road',
      bookingPropCity: 'Accra',
      bookingPropType: 'residential',
      bookingInspType: 'shi',
      bookingState: 'Greater Accra',
      bookingLga: 'Accra Metropolitan',
      bookingCountry: 'Ghana',
    }];

    const { inspection } = await InspectionService.getById(inspector, 'insp-1');

    expect((inspection as any)?.property_address).toBe('12 Airport Road');
    expect((inspection as any)?.state).toBe('Greater Accra');
    expect((inspection as any)?.lga).toBe('Accra Metropolitan');
    expect((inspection as any)?.country).toBe('Ghana');
    expect((inspection as any)?.bookings?.country).toBe('Ghana');
  });

  it('keeps a solo inspection its own state/country without a booking', async () => {
    mockState.rows = [{
      id: 'insp-2',
      bookingId: null,
      inspectorId: 'inspector-1',
      status: 'in_progress',
      isSolo: true,
      propertyAddress: '3 Solo Street, Yaba',
      propertyType: 'residential',
      inspectionType: 'hhc',
      state: 'Lagos',
      lga: 'Yaba',
      country: 'Nigeria',
      bookingClientId: null,
    }];

    const { inspection } = await InspectionService.getById(inspector, 'insp-2');

    expect((inspection as any)?.state).toBe('Lagos');
    expect((inspection as any)?.country).toBe('Nigeria');
    expect((inspection as any)?.bookings).toBeNull();
  });
});
