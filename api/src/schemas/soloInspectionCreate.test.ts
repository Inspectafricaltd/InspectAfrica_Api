import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { soloInspectionCreateSchema } from './index.js';

// Regression coverage: Fastify's default Ajv config strips
// (removeAdditional: true) any request body field not declared in the
// route's schema — silently, not a validation error. This schema never
// declared the INSPECTAFRICA STANDARD™ metadata fields, so every solo
// inspection ever created had buildingType/occupancyStatus/inAttendance/
// inspectionConstraints/otherBuildingType/otherInAttendance/
// otherConstraints dropped before InspectionService.createSolo() ever saw
// them, even though the inspector filled the form and the frontend sent
// them correctly. Confirmed against production data: every is_solo row
// back to May had all of these null.
describe('soloInspectionCreateSchema — INSPECTAFRICA STANDARD metadata survives Ajv validation', () => {
  const buildBody = (overrides: Record<string, unknown> = {}) => ({
    propertyAddress: '12 Banana Island Road',
    propertyType: 'residential',
    inspectionType: 'shi',
    state: 'Lagos',
    lga: 'Eti-Osa',
    buildingType: 'apartment_flat',
    occupancyStatus: 'tenant_occupied',
    inAttendance: ['client_owner'],
    inspectionConstraints: ['weather_conditions', 'other'],
    otherBuildingType: '',
    otherInAttendance: '',
    otherConstraints: 'Locked storage room',
    ...overrides,
  });

  async function postAndEcho(body: Record<string, unknown>) {
    const fastify = Fastify();
    fastify.post('/test', { schema: { body: soloInspectionCreateSchema } }, async (request) => request.body);
    const res = await fastify.inject({ method: 'POST', url: '/test', payload: body });
    return { statusCode: res.statusCode, body: JSON.parse(res.body) };
  }

  it('does not strip any of the metadata fields', async () => {
    const sent = buildBody();
    const { statusCode, body } = await postAndEcho(sent);

    expect(statusCode).toBe(200);
    expect(body.buildingType).toBe('apartment_flat');
    expect(body.occupancyStatus).toBe('tenant_occupied');
    expect(body.inAttendance).toEqual(['client_owner']);
    expect(body.inspectionConstraints).toEqual(['weather_conditions', 'other']);
    expect(body.otherConstraints).toBe('Locked storage room');
  });

  it('still accepts a request with no metadata at all (all optional)', async () => {
    const sent = {
      propertyAddress: '12 Banana Island Road',
      propertyType: 'residential',
      inspectionType: 'shi',
      state: 'Lagos',
      lga: 'Eti-Osa',
    };
    const { statusCode } = await postAndEcho(sent);
    expect(statusCode).toBe(200);
  });
});
