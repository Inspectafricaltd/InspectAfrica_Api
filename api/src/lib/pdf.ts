import puppeteer from 'puppeteer';

export interface PdfOptions {
  format?: 'A4' | 'Letter';
  printBackground?: boolean;
  margin?: { top?: string; bottom?: string; left?: string; right?: string };
  headerTemplate?: string;
}

const IA_FOOTER = `<div style="width:100%;padding:0 20mm;box-sizing:border-box;font-size:8pt;font-family:'Segoe UI',Arial,sans-serif;color:#6B7280;display:flex;justify-content:space-between;align-items:center;height:100%;"><span style="display:flex;align-items:center;gap:5px;"><span style="background:#1877F2;color:#fff;font-weight:800;font-size:7pt;padding:1px 4px;border-radius:2px;">f</span><span style="background:linear-gradient(45deg,#833AB4,#E1306C);color:#fff;font-weight:800;font-size:7pt;padding:1px 4px;border-radius:2px;">ig</span><span style="background:#0A66C2;color:#fff;font-weight:800;font-size:7pt;padding:1px 4px;border-radius:2px;">in</span><span style="background:#25D366;color:#fff;font-weight:800;font-size:7pt;padding:1px 4px;border-radius:2px;">w</span><b style="color:#374151;margin-left:3px;">@inspectafrica</b></span><span style="color:#374151;font-weight:600;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

export async function generatePdfFromHtml(html: string, options: PdfOptions = {}): Promise<Buffer> {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    // headerTemplate/footerTemplate render in Chromium's print-header layer,
    // which repeats identically on every physical page regardless of how
    // body content overflows -- unlike the old approach of baking a header
    // div into each section's HTML, which vanished on any page the section's
    // content spilled onto. margin.top must reserve real space for it.
    const pdfBuffer = await page.pdf({
      format: options.format ?? 'A4',
      printBackground: options.printBackground ?? true,
      margin: options.margin ?? { top: options.headerTemplate ? '30mm' : '0', bottom: '18mm', left: '0', right: '0' },
      displayHeaderFooter: true,
      headerTemplate: options.headerTemplate ?? '<span></span>',
      footerTemplate: IA_FOOTER,
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

export async function generatePdfFromUrl(url: string, options: PdfOptions = {}): Promise<Buffer> {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: options.format ?? 'A4',
      printBackground: options.printBackground ?? true,
      margin: options.margin ?? { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
    });
    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const C = {
  green:    '#1A4731',
  red:      '#DC2626',
  orange:   '#EA6500',
  amber:    '#D97706',
  accGreen: '#16A34A',
  gold:     '#F5A623',
};

// Mirrors apps/api/src/services/BookingService.ts formatInspectionType() — keep in sync.
const INSPECTION_TYPES: Record<string, { title: string; abbr: string }> = {
  shi:  { title: 'HINL Home Inspection (Standard)',        abbr: 'SHI' },
  mic:  { title: 'Move-In Certification',                  abbr: 'MIC' },
  cib:  { title: 'Commercial Inspection & Consultancy',    abbr: 'CIB' },
  fsi:  { title: 'New Construction — Phase 1',              abbr: 'FSI' },
  pcc:  { title: 'New Construction — Phase 2',              abbr: 'PCC' },
  hhc:  { title: 'No Utility Inspection',                   abbr: 'HHC' },
  snag: { title: 'HINL Snag Inspection',                    abbr: 'SNAG' },
  lsi:  { title: 'Land Site Inspection',                    abbr: 'LSI' },
};

// Exported so filename-building code (reportFilename.ts) can resolve the
// same abbreviation used in the report header, without duplicating the map.
export function resolveInspectionTypeAbbr(rawType: string | null | undefined): string {
  const key = (rawType || 'shi').toLowerCase().replace(/_/g, '');
  return INSPECTION_TYPES[key]?.abbr ?? key.toUpperCase();
}

// Mirrors apps/web/src/lib/inspectionMetadata.ts — keep in sync. Used to
// resolve stored codes (e.g. 'apartment_flat') to display labels
// (e.g. 'Apartment / Flat') in the metadata/constraints pages.
const BUILDING_TYPE_LABELS: Record<string, string> = {
  apartment_flat: 'Apartment / Flat',
  terrace_townhouse: 'Terrace / Townhouse',
  semi_detached: 'Semi-Detached House',
  detached: 'Detached House',
  duplex: 'Duplex',
  bungalow: 'Bungalow',
  block_of_flats: 'Block of Flats',
  commercial: 'Commercial Building',
  mixed_use: 'Mixed-Use Building',
  other: 'Other',
};

const OCCUPANCY_STATUS_LABELS: Record<string, string> = {
  vacant: 'Vacant',
  owner_occupied: 'Owner Occupied',
  tenant_occupied: 'Tenant Occupied',
  newly_completed: 'Newly Completed (Unoccupied)',
  under_construction: 'Under Construction',
  under_renovation: 'Under Renovation',
  partially_occupied: 'Partially Occupied',
  commercially_occupied: 'Commercially Occupied',
  temporarily_vacant: 'Temporarily Vacant',
};

const IN_ATTENDANCE_LABELS: Record<string, string> = {
  client_owner: 'Client / Owner',
  buyer_prospective: 'Buyer / Prospective Buyer',
  occupant_tenant: 'Occupant / Tenant',
  estate_agent: 'Estate Agent / Property Manager',
  developer_builder: 'Developer / Builder / Contractor',
  design_professional: 'Design Professional (Architect / Engineer)',
  site_representative: 'Site Representative (Supervisor / Foreman / Facility Manager)',
  inspector_only: 'Inspector Only',
  other: 'Other',
};

const INSPECTION_CONSTRAINT_LABELS: Record<string, string> = {
  restricted_access: 'Restricted Access',
  unsafe_access: 'Unsafe Access',
  occupied_obstructed: 'Occupied or Obstructed Areas',
  roof_not_accessible: 'Roof Not Accessible',
  active_construction: 'Active Construction',
  utilities_unavailable: 'Utilities Unavailable',
  equipment_not_operational: 'Equipment Not Operational',
  weather_conditions: 'Weather Conditions',
  documentation_unavailable: 'Documentation Unavailable',
  scope_limited_client: 'Inspection Scope Limited by Client Request',
  time_limited: 'Inspection Time Limited',
  other: 'Other Limitation',
};

const SYSTEMS = [
  { key: 'structure',  label: 'Structure',          terms: ['structur', 'foundation', 'column', 'beam', 'slab', 'frame', 'retaining'] },
  { key: 'roofing',    label: 'Roofing',             terms: ['roof', 'gutter', 'fascia', 'soffit', 'attic'] },
  { key: 'electrical', label: 'Electrical',          terms: ['electr', 'wiring', 'socket', 'power', 'light', 'circuit', 'breaker', 'db '] },
  { key: 'plumbing',   label: 'Plumbing & Drainage', terms: ['plumb', 'drain', 'pipe', 'water', 'sanit', 'toilet', 'bath', 'kitchen'] },
  { key: 'doors',      label: 'Doors & Windows',     terms: ['door', 'window', 'glass', 'glazing'] },
  { key: 'interior',   label: 'Interior Finishes',   terms: ['interior', 'finish', 'wall', 'floor', 'tile', 'paint', 'stair', 'handrail', 'ceiling', 'decor'] },
  { key: 'external',   label: 'External Areas',      terms: ['extern', 'pav', 'fence', 'gate', 'compound', 'driveway', 'balcony', 'terrace', 'boundary'] },
  { key: 'fire',       label: 'Fire Safety',         terms: ['fire', 'alarm', 'smoke', 'extinguish', 'safety'] },
];

// ─── SVG Assets ──────────────────────────────────────────────────────────────

// Real InspectAfrica logo mark, inlined as base64 -- avoids depending on
// tsc copying non-.ts assets into dist/ at build time, same reasoning as
// why photo/signature data already flow through this file as data URLs.
const LOGO_PNG_BASE64 = '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';
const ICON = {
  location: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="5.5" r="2.2" stroke="#1A4731" stroke-width="1.2"/><path d="M7 12.5S1.5 8.5 1.5 5.5a5.5 5.5 0 0111 0C12.5 8.5 7 12.5 7 12.5Z" stroke="#1A4731" stroke-width="1.2"/></svg>`,
  house:    `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1 7.5L7 2L13 7.5" stroke="#1A4731" stroke-width="1.2" stroke-linecap="round"/><rect x="3" y="7" width="8" height="5.5" rx="0.5" stroke="#1A4731" stroke-width="1.2"/></svg>`,
  calendar: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="2.5" width="12" height="10" rx="1" stroke="#1A4731" stroke-width="1.2"/><path d="M1 6h12M5 1v3M9 1v3" stroke="#1A4731" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  person:   `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="4" r="2.5" stroke="#1A4731" stroke-width="1.2"/><path d="M1.5 13c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="#1A4731" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  weather:  `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="7" cy="5" r="2.5" stroke="#1A4731" stroke-width="1.2"/><path d="M7 1v1M7 8v1M1 5h1M11 5h1M2.5 2.5l.7.7M10.8 2.5l-.7.7" stroke="#1A4731" stroke-width="1.2" stroke-linecap="round"/><path d="M2 10.5h10M4 12.5h6" stroke="#1A4731" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/></svg>`,
  homeF:    `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 12L12 3L21 12" fill="white" stroke="white" stroke-width="1.5"/><path d="M5 10V20H9V15H15V20H19V10L12 3Z" fill="white"/></svg>`,
  unsafe:   `<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="18" fill="#DC2626"/><path d="M18 10v10M18 24v1.5" stroke="white" stroke-width="3" stroke-linecap="round"/></svg>`,
  warn:     `<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="18" fill="#EA6500"/><path d="M18 11v9M18 24v1.5" stroke="white" stroke-width="3" stroke-linecap="round"/></svg>`,
  eye:      `<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="18" fill="#D97706"/><ellipse cx="18" cy="18" rx="8" ry="5.5" stroke="white" stroke-width="2"/><circle cx="18" cy="18" r="2.5" fill="white"/></svg>`,
};

const SYS_ICONS: Record<string, string> = {
  structure:  `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M1 9.5L9 2L17 9.5" stroke="#1A4731" stroke-width="1.4" stroke-linecap="round"/><rect x="3" y="9" width="12" height="7" rx="0.5" stroke="#1A4731" stroke-width="1.4"/></svg>`,
  roofing:    `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M1 9L9 1L17 9" stroke="#1A4731" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 9v7h12V9" stroke="#1A4731" stroke-width="1.4"/></svg>`,
  electrical: `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M10 2L4 10h5l-1 6 7-9h-5l1-5Z" stroke="#1A4731" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  plumbing:   `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 6a2 2 0 012-2h2v6H6a2 2 0 01-2-2V6Z" stroke="#1A4731" stroke-width="1.4"/><path d="M8 7h6a2 2 0 012 2v4a2 2 0 01-2 2h-2" stroke="#1A4731" stroke-width="1.4"/><circle cx="10" cy="15" r="2" stroke="#1A4731" stroke-width="1.4"/></svg>`,
  doors:      `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><rect x="3" y="1" width="12" height="16" rx="1" stroke="#1A4731" stroke-width="1.4"/><circle cx="13" cy="9" r="1" fill="#1A4731"/></svg>`,
  interior:   `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 16V7l7-6 7 6v9" stroke="#1A4731" stroke-width="1.4" stroke-linejoin="round"/><rect x="6" y="9" width="6" height="7" stroke="#1A4731" stroke-width="1.4"/></svg>`,
  external:   `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M1 16h16M3 16v-5c0-.6.4-1 1-1h3v6M11 16V9a1 1 0 011-1h2a1 1 0 011 1v7" stroke="#1A4731" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  fire:       `<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 17c-3.3 0-6-2.7-6-6 0-3 2-5 4-7-.5 2 .5 3 2 3-1-1.5 0-4 2-6 1 3 2 4 2 6.5 1-1 .5-3 0-4.5 2 1.5 2 5.5 2 7 0 3.3-2.7 6-6 6Z" stroke="#1A4731" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
};

// ─── Helper functions ────────────────────────────────────────────────────────

function esc(s: any): string {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sevCfg(sev: string) {
  switch (sev) {
    case 'unsafe':          return { color: C.red,      bg: '#FEE2E2', label: 'UNSAFE',              ctaLabel: 'ACT NOW',    ctaNote: 'This poses a safety risk.' };
    case 'repair_required': return { color: C.orange,   bg: '#FFF3E0', label: 'CORRECTION REQUIRED', ctaLabel: 'CORRECT SOON',ctaNote: 'Prevent bigger problems.' };
    case 'monitor':         return { color: C.amber,    bg: '#FFFBEB', label: 'MONITOR',             ctaLabel: 'MONITOR',    ctaNote: 'Keep an eye on these.' };
    case 'acceptable':      return { color: C.accGreen, bg: '#ECFDF5', label: 'ACCEPTABLE',          ctaLabel: '',           ctaNote: '' };
    default:                return { color: '#6B7280',   bg: '#F3F4F6', label: (sev || 'N/A').toUpperCase(), ctaLabel: '', ctaNote: '' };
  }
}

function inferProfessional(condName: string, sectionName: string): string {
  const t = `${condName} ${sectionName}`.toLowerCase();
  if (/electr|wiring|socket|circuit|breaker|db /.test(t))         return 'Electrician';
  if (/plumb|drain|pipe|leak|toilet|sanit|sewage/.test(t))         return 'Plumber';
  if (/roof|gutter|fascia/.test(t))                                return 'Roofer';
  if (/structur|foundation|concrete|column|beam|reinfor/.test(t))  return 'Structural Engineer';
  if (/glass|glazing/.test(t))                                     return 'Glazier';
  if (/gate|motor|access control/.test(t))                         return 'Gate Technician';
  if (/\bgas\b|lpg/.test(t))                                       return 'Gas Technician';
  if (/fire|alarm|smoke|extinguish/.test(t))                       return 'Fire Safety Specialist';
  if (/door|window|cabinet|carpent|timber|handrail|hinge/.test(t)) return 'Carpenter';
  if (/plaster|crack|render|paint|peeling/.test(t))               return 'Mason / Plasterer';
  if (/tile|floor|screed/.test(t))                                 return 'Tiler';
  if (/pav|driveway|fence|compound|boundary/.test(t))              return 'Builder';
  return 'General Contractor';
}

function overallCondition(u: number, c: number, m: number, _a: number) {
  if (u > 5) return { label: 'REQUIRES URGENT ATTENTION', sub: 'Multiple unsafe conditions require immediate corrective action.', bg: '#FEF2F2', textColor: '#B91C1C', iconBg: C.red };
  if (u > 0) return { label: 'REQUIRES ATTENTION', sub: 'Unsafe conditions identified — corrective action is needed before occupancy.', bg: '#FEF2F2', textColor: '#B91C1C', iconBg: C.red };
  if (c > 0) return { label: 'GENERALLY GOOD CONDITION', sub: 'Some repairs and maintenance are recommended.', bg: '#FEF9C3', textColor: '#92400E', iconBg: '#F59E0B' };
  if (m > 0) return { label: 'GOOD CONDITION', sub: 'Minor items to monitor. Routine maintenance advised.', bg: '#ECFDF5', textColor: '#065F46', iconBg: C.accGreen };
  return { label: 'EXCELLENT CONDITION', sub: 'Property is well maintained. No significant issues found.', bg: '#ECFDF5', textColor: '#065F46', iconBg: C.accGreen };
}

function worstSev(a: string, b: string): string {
  const order = ['acceptable', 'monitor', 'repair_required', 'unsafe'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

function buildSystemSummary(sections: any[]) {
  const map = new Map<string, { sev: string }>();
  for (const section of sections) {
    const sname = (section.name || '').toLowerCase();
    let key = 'interior';
    for (const sys of SYSTEMS) {
      if (sys.terms.some((t) => sname.includes(t))) { key = sys.key; break; }
    }
    const existing = map.get(key) ?? { sev: 'acceptable' };
    for (const c of section.conditions || []) {
      if (c.severity) existing.sev = worstSev(existing.sev, c.severity);
    }
    map.set(key, existing);
  }
  return SYSTEMS.filter((s) => map.has(s.key)).map((s) => {
    const sev = map.get(s.key)!.sev;
    const comments: Record<string, string> = {
      unsafe:          'Unsafe conditions observed. Immediate action required.',
      repair_required: 'Issues present. Corrective action recommended.',
      monitor:         'Minor items to monitor over time.',
      acceptable:      'No significant issues observed.',
    };
    return { key: s.key, label: s.label, sev, comment: comments[sev] ?? 'N/A' };
  });
}

function sysIconForSectionName(sectionName: string): string {
  const sname = (sectionName || '').toLowerCase();
  for (const sys of SYSTEMS) {
    if (sys.terms.some((t) => sname.includes(t))) return SYS_ICONS[sys.key] ?? '';
  }
  return '';
}

const SEV_RANK: Record<string, number> = { unsafe: 0, repair_required: 1, monitor: 2, acceptable: 3 };

// Groups defects Section -> Location -> [conditions], preserving section
// order as authored and sorting each location's items worst-severity-first.
// Both the "What Needs Attention" tables and "Key Findings" photo cards use
// this same nesting so a reader can find everything about one spot in one
// place, instead of the old flat severity-only or discovery-order lists.
function groupBySectionLocation(conds: any[]): Map<string, Map<string, any[]>> {
  const bySection = new Map<string, Map<string, any[]>>();
  for (const c of conds) {
    const sec = c.sectionName || 'Other';
    const loc = c.location || 'General';
    if (!bySection.has(sec)) bySection.set(sec, new Map());
    const locMap = bySection.get(sec)!;
    if (!locMap.has(loc)) locMap.set(loc, []);
    locMap.get(loc)!.push(c);
  }
  for (const locMap of bySection.values()) {
    for (const list of locMap.values()) {
      list.sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9));
    }
  }
  return bySection;
}

function renderAnnotationSvg(shapes: any[]): string {
  if (!shapes?.length) return '';
  const parts: string[] = [];
  for (const s of shapes) {
    const color = (typeof s?.color === 'string' ? s.color : '#EF4444') || '#EF4444';
    if (s?.type === 'arrow' && Array.isArray(s.points) && s.points.length === 4) {
      const [x1, y1, x2, y2] = s.points as number[];
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="0.012" stroke-linecap="round" marker-end="url(#ah)"/>`);
    } else if (s?.type === 'circle' && typeof s.x === 'number') {
      parts.push(`<circle cx="${s.x}" cy="${s.y}" r="${s.radius}" stroke="${color}" stroke-width="0.012" fill="none"/>`);
    }
  }
  if (!parts.length) return '';
  return `<svg viewBox="0 0 1 1" preserveAspectRatio="none"><defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 Z" fill="#EF4444"/></marker></defs>${parts.join('')}</svg>`;
}

// ─── Main HTML builder ───────────────────────────────────────────────────────

export function buildInspectionReportHtml(params: {
  inspection: any;
  booking: any;
  inspector: any;
  sections: any[];
  additionalObservations?: any[];
  limitations?: string[];
  stageVerdict?: 'APPROVED' | 'APPROVED_WITH_DEFECTS' | 'NOT_APPROVED' | null;
  certificateNumber: string;
  generatedAt: string;
  signatureDataUrl?: string | null;
  coverPhotoDataUrl?: string | null;
  weatherSnapshot?: { condition: string; label: string; recorded_at?: string } | null;
  clientName?: string | null;
  buildingType?: string | null;
  occupancyStatus?: string | null;
  inAttendance?: string[] | null;
  inspectionConstraints?: string[] | null;
  otherBuildingType?: string | null;
  otherInAttendance?: string | null;
  otherConstraints?: string | null;
}): { html: string; headerTemplate: string } {
  const {
    inspection, booking, inspector, sections,
    additionalObservations = [], limitations = [],
    stageVerdict = null, certificateNumber, generatedAt,
    signatureDataUrl = null, coverPhotoDataUrl = null,
    weatherSnapshot = null, clientName = null,
    buildingType = null, occupancyStatus = null,
    inAttendance = null, inspectionConstraints = null,
    otherBuildingType = null, otherInAttendance = null, otherConstraints = null,
  } = params;

  // Resolve stored codes to display labels, falling back to the raw
  // value for forward-compat with any code not in the lookup, and
  // substituting the inspector's free-text when 'other' was selected.
  const buildingTypeLabel = buildingType === 'other' && otherBuildingType
    ? otherBuildingType
    : (buildingType ? (BUILDING_TYPE_LABELS[buildingType] ?? buildingType) : null);
  const occupancyStatusLabel = occupancyStatus ? (OCCUPANCY_STATUS_LABELS[occupancyStatus] ?? occupancyStatus) : null;
  const inAttendanceLabels = (inAttendance ?? []).map((a) =>
    a === 'other' && otherInAttendance ? otherInAttendance : (IN_ATTENDANCE_LABELS[a] ?? a)
  );
  const inspectionConstraintLabels = (inspectionConstraints ?? []).map((c) =>
    c === 'other' && otherConstraints ? otherConstraints : (INSPECTION_CONSTRAINT_LABELS[c] ?? c)
  );

  const rawType    = (booking?.inspection_type || inspection?.inspection_type || 'shi').toLowerCase().replace(/_/g, '');
  const typeInfo   = INSPECTION_TYPES[rawType] ?? { title: rawType.replace(/\b\w/g, (c: string) => c.toUpperCase()), abbr: rawType.toUpperCase() };
  const propAddr    = booking?.property_address || inspection?.property_address || 'N/A';
  const propCity    = booking?.property_city    || inspection?.state || '';
  const propCountry = booking?.country          || inspection?.country || '';
  const propType    = booking?.property_type    || inspection?.property_type    || 'N/A';
  const inspName   = inspector?.full_name || '—';
  const achiNum    = inspector?.achi_number;
  // The report must not vouch for a credential the inspector doesn't hold. The
  // certified label used to be the fallback for a *missing* ACHI number, so an
  // uncertified inspector was printed as "HINL Certified Inspector" — the
  // credential claim was strongest exactly where the evidence was weakest.
  // Gate it on achi_status, and on status alone, so a lapsed or suspended
  // number can't stand in for a live certification either. Same rule the web
  // side already applies in AchiBadge.
  const credential = inspector?.achi_status === 'certified'
    ? (achiNum ? `ACHI: ${esc(achiNum)}` : 'HINL Certified Inspector')
    : null;
  const fullAddr    = [propAddr, propCity, propCountry].filter(Boolean).join(', ');
  const inspDate   = (() => {
    const d = inspection?.submitted_at || inspection?.created_at;
    return d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }) : 'N/A';
  })();
  const genDate = new Date(generatedAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });

  const allConds  = sections.flatMap((s: any) => (s.conditions || []).map((c: any) => ({ ...c, sectionName: s.name })));
  const unsafeL   = allConds.filter((c: any) => c.severity === 'unsafe');
  const corrL     = allConds.filter((c: any) => c.severity === 'repair_required');
  const monL      = allConds.filter((c: any) => c.severity === 'monitor');
  const accL      = allConds.filter((c: any) => c.severity === 'acceptable');
  const total     = allConds.length;
  const cond      = overallCondition(unsafeL.length, corrL.length, monL.length, accL.length);
  const topIssues = [...unsafeL, ...corrL, ...monL].slice(0, 6);
  const sysSummary = buildSystemSummary(sections);
  const photoFindings = allConds.filter((c: any) => c.severity !== 'acceptable' && (c.photos || []).length > 0);

  // ── Real repeating page header ──────────────────────────────────────────────
  // Rendered via Puppeteer's headerTemplate (see generatePdfFromHtml), not as
  // body HTML, so it appears identically on every physical page including
  // ones a section overflows onto -- fixes headers vanishing on continuation
  // pages and appearing mid-page when a section's forced page-break landed
  // partway through its content.
  const headerTemplate = `
<div style="width:100%;padding:10px 20mm 7px;box-sizing:border-box;font-family:'Segoe UI',Arial,sans-serif;border-bottom:2px solid ${C.green};">
  <div style="display:flex;justify-content:space-between;align-items:center;">
    <div style="display:flex;align-items:center;gap:10px;">
      <img src="data:image/png;base64,${LOGO_PNG_BASE64}" style="height:36px;width:auto;display:block;"/>
      <div style="display:flex;flex-direction:column;justify-content:center;">
        <span style="font-size:14px;font-weight:800;color:${C.green};line-height:1.15;">InspectAfrica</span>
        <span style="font-size:6px;color:#4B5563;">One Continent &bull; One Standard &bull; Every Home</span>
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:12px;font-weight:700;color:${C.green};">${esc(typeInfo.title.toUpperCase())} (${esc(typeInfo.abbr)})</div>
      <div style="font-size:10px;color:#6B7280;margin-top:1px;">REPORT ID: ${esc(certificateNumber)}</div>
    </div>
  </div>
</div>`;

  // ── Table of Contents ──────────────────────────────────────────────────────
  const tocPage = `
<section class="page">
  <div style="padding:30px 40px;">
    <h2 style="font-size:20px;font-weight:700;color:#1A4731;margin-bottom:25px;">TABLE OF CONTENTS</h2>
    <div style="line-height:1.8;font-size:12px;color:#374151;">
      <div style="padding:8px 0;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;"><span>1. Property & Inspection Details</span><span style="color:#999;">Page 2</span></div>
      <div style="padding:8px 0;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;"><span>2. Main Areas Needing Attention</span><span style="color:#999;">Page 3</span></div>
      <div style="padding:8px 0;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;"><span>3. Detailed Findings</span><span style="color:#999;">Page 4+</span></div>
      ${inspectionConstraintLabels.length > 0 ? `<div style="padding:8px 0;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;"><span>4. Limitations</span><span style="color:#999;">Back</span></div>` : ''}
      <div style="padding:8px 0;border-bottom:1px solid #E5E7EB;display:flex;justify-content:space-between;"><span>${inspectionConstraintLabels.length > 0 ? '5' : '4'}. Standard Inspection Disclaimer</span><span style="color:#999;">Back</span></div>
    </div>
  </div>
</section>`;

  // ── Limitations Page ─────────────────────────────────────────────────────────
  // Its own page, not a box tacked onto the Disclaimer page — the two used to
  // share one page/section, which read as Limitations being a subsection of
  // the Disclaimer rather than its own thing. Renamed from "Inspection
  // Constraints" to "Limitations" per client instruction — that's the
  // official term for this document. Only the printed label changed; the
  // underlying field name (inspectionConstraints, INSPECTION_CONSTRAINT_LABELS)
  // is untouched. Omitted entirely (no page at all) when the inspection has
  // none recorded, rather than rendering an empty page.
  const limitationsPage = inspectionConstraintLabels.length > 0 ? `
<section class="page pb">
  <div style="padding:30px 40px;font-size:11px;line-height:1.6;color:#374151;">
    <h2 style="font-size:20px;font-weight:700;color:#1A4731;margin-bottom:20px;">LIMITATIONS</h2>
    <div style="background:#FEF9E7;padding:15px;border-radius:6px;border-left:4px solid #F59E0B;">
      <p style="margin:0 0 10px 0;font-size:12px;color:#92400E;font-weight:600;">The following limitations affected the scope or completeness of this inspection:</p>
      <ul style="margin:8px 0;padding-left:20px;">
        ${inspectionConstraintLabels.map((c: string) => `<li style="margin:4px 0;">${esc(c)}</li>`).join('')}
      </ul>
      <p style="margin:10px 0 0 0;font-size:10px;color:#7C2D12;"><strong>Important:</strong> Areas, systems, or components affected by these limitations may not have been fully assessed.</p>
    </div>
  </div>
</section>` : '';

  // ── Standard Inspection Disclaimer Page ─────────────────────────────────────
  // Text mirrors STANDARD_INSPECTION_DISCLAIMER in
  // apps/web/src/lib/inspectionMetadata.ts verbatim — keep in sync. A prior
  // version of this page used an abbreviated disclaimer missing the
  // "Limitations" and "Report Use" sections entirely. Always renders
  // (boilerplate, independent of whether this inspection has any limitations
  // of its own — its "Limitations:" clause below is a standing legal clause,
  // not a repeat of the itemized list on the page above).
  const disclaimerPage = `
<section class="page pb">
  <div style="padding:30px 40px;font-size:11px;line-height:1.6;color:#374151;">
    <h2 style="font-size:20px;font-weight:700;color:#1A4731;margin-bottom:20px;">STANDARD INSPECTION DISCLAIMER</h2>
    <div style="background:#F3F4F6;padding:15px;border-radius:6px;font-size:14px;line-height:1.5;">
      <p style="margin:8px 0;"><strong>Inspection Scope:</strong> This inspection was conducted as a visual, non-invasive assessment of the property based on conditions that were visible and reasonably accessible at the time of inspection. The purpose of this inspection is to identify observable safety concerns, functional deficiencies, workmanship issues, and visible defects within the agreed inspection scope. No destructive testing, dismantling of building components, engineering analysis, laboratory testing, or specialist investigations were performed unless specifically stated in this report.</p>
      <p style="margin:8px 0;"><strong>Limitations:</strong> The inspection findings should be read together with the Limitations recorded in this report. Areas, systems, or components affected by the selected limitations may not have been fully assessed and may contain conditions that were not visible or reasonably accessible at the time of inspection. Where the inspection scope was limited at the client's request, excluded areas or systems are outside the scope of this report. Where inspection time was limited, the inspection was completed to the greatest extent reasonably possible within the available time.</p>
      <p style="margin:8px 0;"><strong>Inspection Findings:</strong> This report reflects the visible condition of the property at the date and time of inspection only. Building components may deteriorate, fail, or change after the inspection due to age, use, maintenance, weather, environmental conditions, alterations, or other factors beyond the inspector's control.</p>
      <p style="margin:8px 0;"><strong>Scope of Opinion:</strong> Unless specifically stated otherwise, this report is not: an engineering certification, a structural adequacy certification, a building code compliance inspection, a guarantee or warranty of workmanship, a guarantee against future defects or failures, or a prediction of the future condition or remaining service life of any component.</p>
      <p style="margin:8px 0;"><strong>Recommendations:</strong> Where significant concerns are identified, further assessment or repair by an appropriately qualified contractor, engineer, or other competent specialist may be recommended before purchase, occupancy, continued use, or construction proceeds.</p>
      <p style="margin:8px 0;"><strong>Report Use:</strong> This report has been prepared solely for the named client for the property identified in this report. It should be read in its entirety, including all findings, photographs, limitations, and recommendations. No individual observation, photograph, or section should be interpreted in isolation from the complete report.</p>
    </div>
  </div>
</section>`;

  // ── Page 1: Cover ───────────────────────────────────────────────────────────
  const pdRow = (iconSvg: string, label: string, valueHtml: string) => `
<div class="pd-row">
  <div class="pd-icon">${iconSvg}</div>
  <div><div class="pd-label">${esc(label)}</div><div class="pd-val">${valueHtml}</div></div>
</div>`;

  const qsRow = (color: string, label: string, count: number) => `
<div class="qs-row">
  <span class="qs-dot" style="background:${color}"></span>
  <span class="qs-lbl">${esc(label)}</span>
  <span class="qs-num">${count}</span>
</div>`;

  const page1 = `
<section class="page pb">
  <div class="p1-body">
    <div class="p1-top">
      <div class="p1-photo-col">
        ${coverPhotoDataUrl
          ? `<div class="p1-photo-wrap"><img class="p1-photo" src="${coverPhotoDataUrl}" alt="Property photo"/></div>`
          : `<div class="p1-photo-empty"><span>No property photo available</span></div>`}
      </div>
      <div class="p1-detail-col">
        <div class="pd-head">PROPERTY DETAILS</div>
        <div class="pd-rows">
          ${pdRow(ICON.location, 'Address', esc(fullAddr))}
          ${pdRow(ICON.house,    'Property Type', esc(propType))}
          ${pdRow(ICON.calendar, 'Inspection Date', esc(inspDate))}
          ${pdRow(ICON.person,   'Inspector', `${esc(inspName)}${credential ? `<span class="pd-sub"> — ${credential}</span>` : ''}`)}
          ${clientName ? pdRow(ICON.person, 'Client', esc(clientName)) : ''}
          ${weatherSnapshot ? pdRow(ICON.weather, 'Weather', esc(weatherSnapshot.label)) : ''}
        </div>
        ${(buildingTypeLabel || occupancyStatusLabel || inAttendanceLabels.length > 0) ? `
        <div class="pd-meta">
          ${buildingTypeLabel ? `<div class="pd-meta-item"><span class="pd-meta-label">Building Type</span><span class="pd-meta-val">${esc(buildingTypeLabel)}</span></div>` : ''}
          ${occupancyStatusLabel ? `<div class="pd-meta-item"><span class="pd-meta-label">Occupancy</span><span class="pd-meta-val">${esc(occupancyStatusLabel)}</span></div>` : ''}
          ${inAttendanceLabels.length > 0 ? `<div class="pd-meta-item pd-meta-wide"><span class="pd-meta-label">In Attendance</span><span class="pd-meta-val">${inAttendanceLabels.map((a: string) => esc(a)).join(', ')}</span></div>` : ''}
        </div>` : ''}
      </div>
    </div>

    <div class="p1-mid">
      <div class="oc-box" style="background:${cond.bg}">
        <div class="oc-icon" style="background:${cond.iconBg}">${ICON.homeF}</div>
        <div>
          <div class="oc-label" style="color:${cond.textColor}">${esc(cond.label)}</div>
          <div class="oc-sub">${esc(cond.sub)}</div>
        </div>
      </div>
      <div class="qs-box">
        <div class="qs-head">QUICK SUMMARY</div>
        ${qsRow(C.red,      'Unsafe',               unsafeL.length)}
        ${qsRow(C.orange,   'Correction Required',  corrL.length)}
        ${qsRow(C.amber,    'Monitor',              monL.length)}
        ${qsRow(C.accGreen, 'Acceptable',           accL.length)}
        <div class="qs-total">
          <span>TOTAL ITEMS ASSESSED</span><span class="qs-total-n">${total}</span>
        </div>
      </div>
    </div>

    ${topIssues.length > 0 ? `
    <div class="p1-issues">
      <div class="p1-issues-head">MAIN AREAS NEEDING ATTENTION</div>
      ${topIssues.map((c: any, i: number) => {
        const sc = sevCfg(c.severity);
        return `<div class="p1-issue-row">
          <div class="issue-num" style="background:${sc.color}">${i + 1}</div>
          <div class="issue-name">${esc(c.name)}</div>
          <div class="issue-badge" style="background:${sc.color}">${sc.label}</div>
        </div>`;
      }).join('')}
    </div>` : ''}
  </div>
</section>`;

  // ── Page 2: What Needs Attention ────────────────────────────────────────────
  // Grouped Section -> Location -> Condition (e.g. ROOFING -> "Rear roof
  // access" -> defects found there) rather than one flat list per severity --
  // easier to act on since everything about one spot in one section is
  // together, with each row's own severity badge preserving that signal.
  // Rendered as compact tables (matching the System Summary table pattern)
  // rather than one-defect-per-block cards -- the old card layout wasted the
  // right ~40% of the page, and a group-level page-break-inside:avoid used to
  // push an entire 15+ item block onto a fresh page, leaving the previous
  // page nearly blank.
  let seqNum = 0;

  const attentionItems = allConds.filter((c: any) =>
    c.severity === 'unsafe' || c.severity === 'repair_required' || c.severity === 'monitor'
  );
  const attentionBySection = groupBySectionLocation(attentionItems);

  const attentionSectionBlock = (sectionName: string, locMap: Map<string, any[]>) => {
    const count = Array.from(locMap.values()).reduce((n, l) => n + l.length, 0);
    return `
<div class="sec-group">
  <div class="sec-group-head">
    <div class="sec-group-icon">${sysIconForSectionName(sectionName)}</div>
    <div class="sec-group-title">${esc(sectionName.toUpperCase())}</div>
    <div class="sec-group-count">${count} DEFECT${count > 1 ? 'S' : ''}</div>
  </div>
  ${Array.from(locMap.entries()).map(([loc, list]) => `
  <div class="loc-group">
    <div class="loc-head">${esc(loc)}</div>
    <table class="at-tbl">
      <thead>
        <tr>
          <th class="ath" style="background:${C.green}">#</th>
          <th class="ath" style="background:${C.green}">DEFECT</th>
          <th class="ath" style="background:${C.green}">IMPLICATION OF DEFECT</th>
          <th class="ath" style="background:${C.green}">RECOMMENDATION</th>
          <th class="ath" style="background:${C.green}">ASSIGNED PROFESSIONAL</th>
        </tr>
      </thead>
      <tbody>
        ${list.map((c: any) => {
          seqNum++;
          const sc = sevCfg(c.severity);
          const prof = inferProfessional(c.name, c.sectionName);
          return `<tr>
            <td class="atd atd-num"><span class="at-num" style="background:${sc.color}">${seqNum}</span></td>
            <td class="atd atd-defect">
              <span class="atd-sev" style="background:${sc.bg};color:${sc.color}">${sc.label}</span>
              <div>${esc(c.name)}</div>
            </td>
            <td class="atd">${esc(c.risk_snapshot || '—')}</td>
            <td class="atd">${esc(c.recommendation_snapshot || '—')}${c.clarification ? `<div class="atd-note"><i>Inspector's note: ${esc(c.clarification)}</i></div>` : ''}</td>
            <td class="atd">${esc(prof)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`).join('')}
</div>`;
  };

  const hasAttention = attentionItems.length > 0;
  const page2 = hasAttention ? `
<section class="page pb">
  <div class="p2-body">
    <h2 class="sec-title">WHAT NEEDS ATTENTION?</h2>
    <div class="sec-sub">Key issues by section and location, with recommended actions</div>
    ${Array.from(attentionBySection.entries()).map(([sec, locMap]) => attentionSectionBlock(sec, locMap)).join('')}
  </div>
</section>` : '';

  // ── Page 3: Key Findings (Photo Evidence) ───────────────────────────────────
  // Same Section -> Location grouping as page 2, so a reader can find the
  // photos for a given spot alongside its table entry above. Photos render
  // in a flex row so a single photo goes full-width ("wide", as requested)
  // and two photos split the width evenly, both far larger than the old
  // fixed 155x116 thumbnail.
  let fNum = 0;
  const photoBySection = groupBySectionLocation(photoFindings);

  const photoSectionBlock = (sectionName: string, locMap: Map<string, any[]>) => {
    const count = Array.from(locMap.values()).reduce((n, l) => n + l.length, 0);
    return `
<div class="sec-group">
  <div class="sec-group-head">
    <div class="sec-group-icon">${sysIconForSectionName(sectionName)}</div>
    <div class="sec-group-title">${esc(sectionName.toUpperCase())}</div>
    <div class="sec-group-count">${count} DEFECT${count > 1 ? 'S' : ''}</div>
  </div>
  ${Array.from(locMap.entries()).map(([loc, list]) => `
  <div class="loc-group">
    <div class="loc-head">${esc(loc)}</div>
    ${list.map((c: any) => {
      fNum++;
      const sc = sevCfg(c.severity);
      const photos = c.photos || [];
      const prof = inferProfessional(c.name, c.sectionName);
      return `<div class="fc">
        <div class="fc-top">
          <div class="fc-num" style="background:${sc.color}">${fNum}</div>
          <div class="fc-badge" style="background:${sc.bg};color:${sc.color}">${sc.label}</div>
          <div class="fc-name">${esc(c.name)}</div>
        </div>
        ${photos.length ? `<div class="fc-photos${photos.length === 1 ? ' fc-photos-single' : ''}">
          ${photos.map((photo: any) => `<div class="fc-photo-wrap">
            <img class="fc-photo" src="${photo.dataUrl}" alt="Finding photo"/>
            ${renderAnnotationSvg(photo.shapes || [])}
          </div>`).join('')}
        </div>` : ''}
        <div class="fc-meta-grid">
          <div class="fc-meta"><b>Assigned To:</b> ${esc(prof)}</div>
          <div class="fc-meta"><b>Date Taken:</b> ${esc(inspDate)}</div>
          ${c.risk_snapshot ? `<div class="fc-meta fc-meta-wide"><b>Risk:</b> ${esc(c.risk_snapshot)}</div>` : ''}
          ${c.recommendation_snapshot ? `<div class="fc-meta fc-meta-wide"><b>Action:</b> ${esc(c.recommendation_snapshot)}</div>` : ''}
          ${c.clarification ? `<div class="fc-meta fc-meta-wide"><b>Inspector's note:</b> ${esc(c.clarification)}</div>` : ''}
        </div>
      </div>`;
    }).join('')}
  </div>`).join('')}
</div>`;
  };

  const page3 = photoFindings.length > 0 ? `
<section class="page pb">
  <div class="p3-body">
    <h2 class="sec-title">KEY FINDINGS (PHOTO EVIDENCE)</h2>
    <div class="sec-sub">Photos by section and location for the issues that need attention</div>
    ${Array.from(photoBySection.entries()).map(([sec, locMap]) => photoSectionBlock(sec, locMap)).join('')}
  </div>
</section>` : '';

  // ── Page 4: System Summary ───────────────────────────────────────────────────
  const verdictBanner = stageVerdict ? (() => {
    const v = {
      APPROVED:             { bg: C.accGreen, label: '✓ APPROVED',              sub: 'No critical findings identified.' },
      APPROVED_WITH_DEFECTS:{ bg: C.amber,    label: '⚠ APPROVED WITH DEFECTS',  sub: 'Minor defects noted. Remediation recommended.' },
      NOT_APPROVED:         { bg: C.red,      label: '✗ NOT APPROVED',           sub: 'Unsafe findings require immediate corrective action.' },
    }[stageVerdict];
    return `<div class="verdict" style="background:${v.bg}"><div class="vd-label">${v.label}</div><div class="vd-sub">${v.sub}</div></div>`;
  })() : '';

  const page4 = `
<section class="page pb">
  <div class="p4-body">
    ${verdictBanner}
    <h2 class="sec-title">SYSTEM SUMMARY (AT A GLANCE)</h2>
    <div class="sec-sub">Condition of key building systems</div>
    <table class="sys-tbl">
      <thead>
        <tr>
          <th class="sth">SYSTEM / AREA</th>
          <th class="sth">CONDITION</th>
          <th class="sth">COMMENTS</th>
        </tr>
      </thead>
      <tbody>
        ${sysSummary.map((sys) => {
          const sc = sevCfg(sys.sev);
          return `<tr>
            <td class="std">
              <span class="std-area">
                <span class="sys-icon">${SYS_ICONS[sys.key] ?? ''}</span>
                <span class="sys-name">${esc(sys.label)}</span>
              </span>
            </td>
            <td class="std">
              <span class="sys-badge" style="color:${sc.color}">
                <span class="sys-dot" style="background:${sc.color}"></span>${sc.label}
              </span>
            </td>
            <td class="std std-comment">${esc(sys.comment)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>

    ${additionalObservations.length > 0 || limitations.length > 0 ? `
    <div class="p4-cols">
      ${additionalObservations.length > 0 ? `
      <div class="p4-card">
        <div class="p4-card-title">ADDITIONAL OBSERVATIONS</div>
        <ul class="p4-list">
          ${additionalObservations.map((o: any) => `<li>${esc(o.title)}${o.description ? ': ' + esc(o.description) : ''}</li>`).join('')}
        </ul>
      </div>` : ''}
      ${limitations.length > 0 ? `
      <div class="p4-card">
        <div class="p4-card-title">LIMITATIONS</div>
        <ul class="p4-list">
          ${limitations.map((l: string) => `<li>${esc(l)}</li>`).join('')}
        </ul>
      </div>` : ''}
    </div>` : ''}

    <div class="p4-bottom">
      <div class="sg-card">
        <div class="sg-head">SEVERITY GUIDE <span class="sg-sub">(used throughout this report)</span></div>
        <div class="sg-row"><span class="sg-dot" style="background:${C.red}"></span><b>UNSAFE</b> — Immediate safety concern</div>
        <div class="sg-row"><span class="sg-dot" style="background:${C.orange}"></span><b>CORRECTION REQUIRED</b> — Corrective action recommended</div>
        <div class="sg-row"><span class="sg-dot" style="background:${C.amber}"></span><b>MONITOR</b> — Observe over time</div>
        <div class="sg-row"><span class="sg-dot" style="background:${C.accGreen}"></span><b>ACCEPTABLE</b> — Acceptable condition</div>
      </div>
      <div class="so-card">
        <div class="so-head">INSPECTOR SIGN-OFF</div>
        <div class="so-inspector-label">Inspector:</div>
        <div class="so-name">${esc(inspName)}</div>
        ${credential ? `<div class="so-cert">${credential}</div>` : ''}
        ${signatureDataUrl
          ? `<div class="so-sig-label">Signature:</div><img class="so-sig" src="${signatureDataUrl}" alt="Signature"/>`
          : `<div class="so-sig-blank"></div>`}
        <div class="so-date">Date: ${esc(genDate)}</div>
      </div>
    </div>
  </div>
</section>`;

  // ── Assemble ────────────────────────────────────────────────────────────────
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>InspectAfrica Report — ${esc(certificateNumber)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Segoe UI',Arial,sans-serif;color:#1F2937;font-size:16px;line-height:1.5;}
.page{padding:16px 22px;}
.pb{page-break-before:always;break-before:page;}

/* Cover page */
.p1-body{}
.p1-top{display:flex;flex-direction:column;gap:14px;margin-bottom:14px;}
.p1-photo-col{width:100%;}
.p1-detail-col{width:100%;}
.p1-photo-wrap{height:340px;border-radius:10px;overflow:hidden;border:1px solid #E5E7EB;}
.p1-photo{width:100%;height:100%;object-fit:cover;display:block;}
.p1-photo-empty{height:340px;background:#F3F4F6;border-radius:10px;border:2px dashed #D1D5DB;display:flex;align-items:center;justify-content:center;color:#9CA3AF;font-size:14.5px;}
.pd-head{background:${C.green};color:#fff;font-size:13.5px;font-weight:700;letter-spacing:.08em;padding:7px 11px;border-radius:4px 4px 0 0;}
.pd-rows{display:grid;grid-template-columns:1fr 1fr;border:1px solid #E5E7EB;border-top:none;border-radius:0 0 4px 4px;}
.pd-row{display:flex;align-items:flex-start;gap:8px;padding:9px 14px;border-bottom:1px solid #F3F4F6;border-right:1px solid #F3F4F6;}
.pd-icon{width:16px;height:16px;flex-shrink:0;margin-top:2px;}
.pd-label{font-size:12.5px;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;font-weight:600;}
.pd-val{font-size:15px;font-weight:600;color:#111827;margin-top:1px;}
.pd-sub{font-size:13.5px;font-weight:400;color:#6B7280;font-style:italic;}
.pd-meta{display:flex;flex-wrap:wrap;gap:10px 22px;margin-top:10px;padding:10px 14px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;}
.pd-meta-item{display:flex;flex-direction:column;min-width:130px;}
.pd-meta-wide{flex:1 1 100%;}
.pd-meta-label{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:#6B7280;font-weight:600;}
.pd-meta-val{font-size:13px;font-weight:600;color:#111827;margin-top:1px;}

/* Mid row */
.p1-mid{display:flex;gap:14px;margin-bottom:14px;}
.oc-box{flex:2;border-radius:8px;padding:12px 14px;display:flex;align-items:center;gap:12px;}
.oc-icon{width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.oc-label{font-size:17px;font-weight:800;line-height:1.2;}
.oc-sub{font-size:13.5px;color:#374151;margin-top:3px;}
.qs-box{flex:3;border:1px solid #E5E7EB;border-radius:8px;padding:11px 14px;}
.qs-head{font-size:13.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#374151;margin-bottom:8px;}
.qs-row{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid #F9FAFB;}
.qs-dot{width:11px;height:11px;border-radius:50%;flex-shrink:0;}
.qs-lbl{flex:1;font-size:15px;color:#374151;}
.qs-num{font-size:16px;font-weight:700;color:#111827;}
.qs-total{display:flex;justify-content:space-between;align-items:center;padding-top:7px;margin-top:3px;border-top:2px solid ${C.green};}
.qs-total span{font-size:13.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#111827;}
.qs-total-n{font-size:18px!important;font-weight:800!important;}

/* Issues list */
.p1-issues{margin-top:2px;}
.p1-issues-head{font-size:13.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#374151;margin-bottom:7px;}
.p1-issue-row{display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid #F3F4F6;}
.p1-issue-row:last-child{border-bottom:none;}
.issue-num{width:20px;height:20px;border-radius:50%;color:#fff;font-size:13.5px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.issue-name{flex:1;font-size:15px;color:#111827;}
.issue-badge{font-size:12.5px;font-weight:700;letter-spacing:.05em;padding:3px 8px;border-radius:12px;color:#fff;white-space:nowrap;}

/* Page 2 */
.p2-body,.p3-body,.p4-body{}
.sec-title{font-size:23px;font-weight:800;color:#111827;margin-bottom:3px;}
.sec-sub{font-size:15px;color:#6B7280;margin-bottom:16px;}
.sec-group{margin-bottom:22px;}
.sec-group-head{display:flex;align-items:center;gap:9px;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid ${C.green};page-break-after:avoid;}
.sec-group-icon{width:20px;height:20px;flex-shrink:0;}
.sec-group-title{font-size:16px;font-weight:800;color:${C.green};letter-spacing:.04em;flex:1;}
.sec-group-count{font-size:13.5px;font-weight:700;color:#6B7280;letter-spacing:.05em;}
.loc-group{margin-bottom:16px;}
.loc-head{font-size:14.5px;font-weight:700;color:#374151;margin-bottom:6px;page-break-after:avoid;}
.at-tbl{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:4px;}
.ath{color:#fff;font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:7px 9px;text-align:left;}
.ath:first-child{width:26px;}
.ath:last-child{width:110px;}
.atd{padding:7px 9px;border-bottom:1px solid #E5E7EB;font-size:14.5px;color:#374151;vertical-align:top;}
.atd-num{text-align:center;}
.at-num{display:inline-flex;width:20px;height:20px;border-radius:50%;color:#fff;font-size:13.5px;font-weight:700;align-items:center;justify-content:center;}
.atd-defect{font-weight:700;color:#111827;}
.atd-sev{display:inline-block;font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;letter-spacing:.04em;margin-bottom:3px;}
.atd-note{margin-top:2px;color:#6B7280;}

/* Page 3 */
.fc{margin-bottom:16px;page-break-inside:avoid;border:1px solid #E5E7EB;border-radius:8px;padding:11px 13px;}
.fc-top{display:flex;align-items:center;gap:9px;margin-bottom:9px;}
.fc-num{width:24px;height:24px;border-radius:50%;color:#fff;font-size:14.5px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.fc-badge{display:inline-block;font-size:12.5px;font-weight:700;padding:2px 8px;border-radius:12px;letter-spacing:.05em;flex-shrink:0;}
.fc-name{font-size:16px;font-weight:700;color:#111827;}
.fc-photos{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:9px;}
.fc-photos-single{grid-template-columns:1fr;}
.fc-photo-wrap{aspect-ratio:4/3;border-radius:6px;overflow:hidden;position:relative;border:1px solid #E5E7EB;}
.fc-photo-wrap svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;}
.fc-photo{width:100%;height:100%;object-fit:cover;display:block;}
.fc-meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 18px;}
.fc-meta{font-size:14px;color:#374151;}
.fc-meta-wide{grid-column:1 / -1;}

/* Page 4 */
.sys-tbl{width:100%;border-collapse:collapse;margin-bottom:14px;}
.sth{background:${C.green};color:#fff;font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;padding:8px 11px;text-align:left;}
.std{padding:8px 11px;border-bottom:1px solid #E5E7EB;font-size:14.5px;vertical-align:middle;}
.std-area{display:inline-flex;align-items:center;gap:8px;}
.sys-icon{width:20px;height:20px;flex-shrink:0;}
.sys-name{font-weight:600;}
.sys-badge{display:flex;align-items:center;gap:5px;font-size:13.5px;font-weight:700;}
.sys-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
.std-comment{color:#374151;font-size:14.5px;}
.p4-cols{display:flex;gap:12px;margin-bottom:12px;}
.p4-card{flex:1;border:1px solid #E5E7EB;border-radius:6px;padding:10px 12px;}
.p4-card-title{font-size:13.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#374151;margin-bottom:7px;}
.p4-list{list-style:disc;padding-left:14px;}
.p4-list li{font-size:13.5px;color:#374151;margin-bottom:3px;}
.p4-bottom{display:flex;gap:12px;}
.sg-card,.so-card{flex:1;border:1px solid #E5E7EB;border-radius:6px;padding:10px 12px;}
.sg-head{font-size:13.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#374151;margin-bottom:7px;}
.sg-sub{font-size:12.5px;font-weight:400;text-transform:none;letter-spacing:0;}
.sg-row{display:flex;align-items:center;gap:6px;font-size:13.5px;color:#374151;margin-bottom:4px;}
.sg-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0;}
.so-head{font-size:13.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#374151;margin-bottom:7px;}
.so-inspector-label{font-size:13.5px;color:#6B7280;}
.so-name{font-size:16px;font-weight:700;color:#111827;margin-top:2px;}
.so-cert{font-size:12.5px;color:#6B7280;font-style:italic;margin-bottom:7px;}
.so-sig-label{font-size:13.5px;color:#6B7280;}
.so-sig{max-height:48px;max-width:140px;object-fit:contain;display:block;margin:4px 0;}
.so-sig-blank{height:36px;border-bottom:1px solid #D1D5DB;width:130px;margin:6px 0;}
.so-date{font-size:13.5px;color:#374151;margin-top:4px;}
.verdict{color:#fff;padding:10px 14px;border-radius:8px;margin-bottom:12px;page-break-inside:avoid;}
.vd-label{font-size:17px;font-weight:700;}
.vd-sub{font-size:14.5px;margin-top:3px;opacity:.9;}
</style>
</head>
<body>
${tocPage}
${page1}
${page2}
${page3}
${page4}
${limitationsPage}
${disclaimerPage}
</body>
</html>`;

  return { html, headerTemplate };
}
