import { describe, it, expect } from 'vitest';
import { updateConditionSchema } from './index.js';

// Regression coverage for issue #3: the PUT /conditions/:id body schema
// accepted the legacy severity vocabulary {pass, major, moderate, critical},
// which the DB column and every reader (report generation, summaries) do not
// use — so severities written through that endpoint were never counted in
// report verdicts.
describe('updateConditionSchema — severity vocabulary (issue #3)', () => {
  const severityEnum = (): string[] => {
    // zodToJsonSchema output: { properties: { severity: { enum: [...] } } }
    const schema = updateConditionSchema as any;
    return schema.properties.severity.enum;
  };

  it('accepts exactly the ACHI vocabulary the DB column and readers use', () => {
    expect(severityEnum().sort()).toEqual(
      ['acceptable', 'monitor', 'repair_required', 'unsafe'].sort()
    );
  });

  it('rejects the legacy vocabulary', () => {
    for (const legacy of ['pass', 'major', 'moderate', 'critical']) {
      expect(severityEnum()).not.toContain(legacy);
    }
  });
});
