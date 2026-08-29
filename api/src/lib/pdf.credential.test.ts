import { describe, it, expect, vi } from 'vitest';

// pdf.ts pulls in puppeteer at module load for generatePdfFromHtml; the HTML
// builder under test needs none of it.
vi.mock('puppeteer', () => ({ default: { launch: vi.fn() } }));

const { buildInspectionReportHtml } = await import('./pdf.js');

function buildFor(inspector: Record<string, unknown>): string {
  const { html } = buildInspectionReportHtml({
    inspection: { status: 'pending_review', submitted_at: '2026-08-12T09:00:00.000Z' },
    booking: { inspection_type: 'shi', property_address: '12 Upper Iweka', property_city: 'Onitsha' },
    inspector,
    sections: [],
    certificateNumber: 'IA-2026-0001',
    generatedAt: '2026-08-14T09:00:00.000Z',
  });
  return html;
}

describe('buildInspectionReportHtml — inspector credential', () => {
  it('prints the ACHI number for a certified inspector', () => {
    const html = buildFor({ full_name: 'Ada Certified', achi_number: 'ACHI-123', achi_status: 'certified' });

    expect(html).toContain('ACHI-123');
    expect(html).toContain('Ada Certified');
  });

  it('falls back to the certified label only when the status backs it up', () => {
    const html = buildFor({ full_name: 'Ada Certified', achi_number: null, achi_status: 'certified' });

    expect(html).toContain('HINL Certified Inspector');
  });

  // The reported defect: a candidate with no ACHI number was printed as
  // "HINL Certified Inspector", because the label was the fallback for a
  // missing number rather than a statement about the status.
  it('makes no credential claim for a candidate with no ACHI number', () => {
    const html = buildFor({ full_name: 'Neo Jnr Jnr', achi_number: null, achi_status: 'candidate' });

    expect(html).toContain('Neo Jnr Jnr');
    expect(html).not.toContain('Certified Inspector');
  });

  it('does not present a lapsed number as a live certification', () => {
    const html = buildFor({ full_name: 'Ada Lapsed', achi_number: 'ACHI-999', achi_status: 'expired' });

    expect(html).not.toContain('ACHI-999');
    expect(html).not.toContain('Certified Inspector');
  });

  it('makes no credential claim when the status is missing entirely', () => {
    const html = buildFor({ full_name: 'Ada Unknown', achi_number: null, achi_status: null });

    expect(html).not.toContain('Certified Inspector');
  });

  it('does not present a suspended inspector as certified', () => {
    const html = buildFor({ full_name: 'Ada Suspended', achi_number: 'ACHI-777', achi_status: 'suspended' });

    expect(html).not.toContain('ACHI-777');
    expect(html).not.toContain('Certified Inspector');
  });
});
