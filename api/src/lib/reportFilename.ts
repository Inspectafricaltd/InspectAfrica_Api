// Report downloads previously saved as bare "v1.pdf"/"v2.pdf" (the storage
// key's basename) with no reference to the property or report -- this builds
// a consistent, descriptive name for the Content-Disposition header instead.
export function buildReportFilename(params: {
  inspectionTypeAbbr: string;
  propertyAddress?: string | null;
  certificateNumber?: string | null;
  generatedAt?: string | Date | null;
}): string {
  const { inspectionTypeAbbr, propertyAddress, certificateNumber, generatedAt } = params;

  const slug = (propertyAddress || '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  const date = new Date(generatedAt ?? Date.now());
  const dateStr = date.toISOString().slice(0, 10);

  const identifier = slug || certificateNumber || 'report';

  return `InspectAfrica-${inspectionTypeAbbr}-${identifier}-${dateStr}.pdf`;
}
