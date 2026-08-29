import { describe, it, expect, vi } from 'vitest';

// pdf.ts pulls in puppeteer at module load for generatePdfFromHtml; the HTML
// builder under test needs none of it.
vi.mock('puppeteer', () => ({ default: { launch: vi.fn() } }));

const { buildInspectionReportHtml } = await import('./pdf.js');

const baseInspector = { full_name: 'Ada Certified', achi_number: 'ACHI-123', achi_status: 'certified' };

function buildFor(inspectionConstraints: string[] | null): string {
  const { html } = buildInspectionReportHtml({
    inspection: { status: 'pending_review', submitted_at: '2026-08-12T09:00:00.000Z' },
    booking: { inspection_type: 'shi', property_address: '12 Upper Iweka', property_city: 'Onitsha' },
    inspector: baseInspector,
    sections: [],
    certificateNumber: 'IA-2026-0001',
    generatedAt: '2026-08-14T09:00:00.000Z',
    inspectionConstraints,
  });
  return html;
}

const LIMITATIONS_HEADING = '<h2 style="font-size:20px;font-weight:700;color:#1A4731;margin-bottom:20px;">LIMITATIONS</h2>';
const DISCLAIMER_HEADING = '<h2 style="font-size:20px;font-weight:700;color:#1A4731;margin-bottom:20px;">STANDARD INSPECTION DISCLAIMER</h2>';

// "Limitations" is the official term the client uses for this document —
// the underlying data/field is still called inspectionConstraints
// (unchanged), but nothing printed on the document should say "Inspection
// Constraints" any more. It also has to be its own section/page, not a box
// tacked onto the Disclaimer page.
describe('buildInspectionReportHtml — Limitations is its own section, not smushed under Disclaimer', () => {
  it('prints a standalone "LIMITATIONS" section, never "Inspection Constraints"', () => {
    const html = buildFor(['restricted_access']);

    expect(html).toContain(LIMITATIONS_HEADING);
    expect(html).not.toContain('Inspection Constraints');
  });

  it('renders Limitations and the Disclaimer as two separate pages, in that order', () => {
    const html = buildFor(['restricted_access']);

    const limitationsIdx = html.indexOf(LIMITATIONS_HEADING);
    const disclaimerIdx = html.indexOf(DISCLAIMER_HEADING);

    expect(limitationsIdx).toBeGreaterThan(-1);
    expect(disclaimerIdx).toBeGreaterThan(limitationsIdx);

    // Each section starts its own <section class="page pb"> — Limitations
    // isn't nested inside the Disclaimer's page.
    const betweenSections = html.slice(limitationsIdx, disclaimerIdx);
    expect(betweenSections).toContain('class="page pb"');
  });

  it('both are collated at the end — nothing else renders after the Disclaimer page', () => {
    const html = buildFor(['restricted_access']);

    const disclaimerIdx = html.indexOf(DISCLAIMER_HEADING);
    const bodyCloseIdx = html.lastIndexOf('</body>');
    const after = html.slice(disclaimerIdx, bodyCloseIdx);

    // Only the one Disclaimer page's own opening tag should appear from here on.
    expect((after.match(/class="page pb"/g) ?? []).length).toBe(0);
  });

  it('omits the Limitations page entirely when none were recorded — no blank page, and the Disclaimer still renders', () => {
    const html = buildFor(null);

    expect(html).not.toContain(LIMITATIONS_HEADING);
    expect(html).not.toContain('Inspection Constraints');
    expect(html).toContain(DISCLAIMER_HEADING);
  });
});
