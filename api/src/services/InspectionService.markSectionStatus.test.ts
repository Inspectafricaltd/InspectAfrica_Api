import { describe, it, expect, vi, beforeEach } from 'vitest';

// Drizzle chained builder mocks. Names are `mock*`-prefixed so they can be
// referenced inside the hoisted vi.mock factory below.
const mockState = { updateRows: [] as { id: string }[] };

const mockDeleteWhere = vi.fn(() => Promise.resolve());
const mockDelete = vi.fn(() => ({ where: mockDeleteWhere }));

const mockUpdate = vi.fn(() => ({
  set: () => ({
    where: () => ({
      returning: () => Promise.resolve(mockState.updateRows),
    }),
  }),
}));

vi.mock('../db/index.js', () => ({
  db: {
    update: () => mockUpdate(),
    delete: () => mockDelete(),
  },
}));

import { InspectionService } from './InspectionService.js';

// Regression coverage for issue #1: marking a section `pass` deleted
// conditions scoped only by section_id, with no inspection_id filter, and the
// section update silently no-op'd for a foreign section — so an inspector
// could wipe another inspection's conditions by passing a sibling section id.
describe('InspectionService.markSectionStatus — cross-inspection scoping (issue #1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.updateRows = [];
    vi.spyOn(InspectionService, 'checkInspectorAccess').mockResolvedValue({ ok: true, error: null } as any);
  });

  it('errors and does NOT delete conditions when the section is not in this inspection', async () => {
    // Update matched no rows → the section id does not belong to this inspection.
    mockState.updateRows = [];

    const res = await InspectionService.markSectionStatus(
      'inspector-1', 'inspection-A', 'foreign-section-id', 'pass',
    );

    expect(res.error).toBe('Section not found in this inspection');
    // The delete must never run for a section outside the caller's inspection.
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes conditions when marking a section that belongs to the inspection as pass', async () => {
    mockState.updateRows = [{ id: 'section-1' }];

    const res = await InspectionService.markSectionStatus(
      'inspector-1', 'inspection-A', 'section-1', 'pass',
    );

    expect(res.error).toBeNull();
    expect(mockDelete).toHaveBeenCalledTimes(1);
    // The scoping clause (section_id AND inspection_id) is passed to where().
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
  });

  it('does not delete conditions when marking observations', async () => {
    mockState.updateRows = [{ id: 'section-1' }];

    const res = await InspectionService.markSectionStatus(
      'inspector-1', 'inspection-A', 'section-1', 'observations',
    );

    expect(res.error).toBeNull();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
