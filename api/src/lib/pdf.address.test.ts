import { describe, it, expect, vi } from 'vitest';

// pdf.ts pulls in puppeteer at module load for generatePdfFromHtml; the HTML
// builder under test needs none of it.
vi.mock('puppeteer', () => ({ default: { launch: vi.fn() } }));

const { buildInspectionReportHtml } = await import('./pdf.js');

const baseInspector = { full_name: 'Ada Certified', achi_number: 'ACHI-123', achi_status: 'certified' };

// The report's address line was built from property_address + property_city
// only — country was captured on booking/inspection creation (the
// Pan-African location cascade) but never made it into the generated PDF, so
// a Ghana or Kenya property printed with no country at all on the document a
// client actually downloads.
describe('buildInspectionReportHtml — address line includes country', () => {
  it('includes the booking country for a client booking', () => {
    const { html } = buildInspectionReportHtml({
      inspection: { status: 'pending_review', submitted_at: '2026-08-12T09:00:00.000Z' },
      booking: {
        inspection_type: 'shi',
        property_address: '12 Airport Road',
        property_city: 'Accra',
        country: 'Ghana',
      },
      inspector: baseInspector,
      sections: [],
      certificateNumber: 'IA-2026-0001',
      generatedAt: '2026-08-14T09:00:00.000Z',
    });

    expect(html).toContain('12 Airport Road, Accra, Ghana');
  });

  it('includes the inspection country for a solo inspection (no booking)', () => {
    const { html } = buildInspectionReportHtml({
      inspection: {
        status: 'pending_review',
        submitted_at: '2026-08-12T09:00:00.000Z',
        property_address: '3 Solo Street, Yaba',
        state: 'Lagos',
        country: 'Nigeria',
      },
      booking: null,
      inspector: baseInspector,
      sections: [],
      certificateNumber: 'IA-2026-0002',
      generatedAt: '2026-08-14T09:00:00.000Z',
    });

    expect(html).toContain('3 Solo Street, Yaba, Lagos, Nigeria');
  });

  it('omits country cleanly when neither booking nor inspection has one', () => {
    const { html } = buildInspectionReportHtml({
      inspection: { status: 'pending_review', submitted_at: '2026-08-12T09:00:00.000Z' },
      booking: { inspection_type: 'shi', property_address: '12 Upper Iweka', property_city: 'Onitsha' },
      inspector: baseInspector,
      sections: [],
      certificateNumber: 'IA-2026-0003',
      generatedAt: '2026-08-14T09:00:00.000Z',
    });

    expect(html).toContain('12 Upper Iweka, Onitsha');
    expect(html).not.toMatch(/Onitsha,\s*,/);
  });
});
