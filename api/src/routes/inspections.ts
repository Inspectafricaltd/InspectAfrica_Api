import type { FastifyInstance } from 'fastify';
import { InspectionService, type CreateSoloData } from '../services/InspectionService.js';
import { flagInspectionSchema, soloInspectionCreateSchema } from '../schemas/index.js';
import { getUser } from '../utils/getUser.js';
import { getSignedUploadUrl } from '../lib/storage.js';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { inspections } from '../db/schema.js';

interface CreateBody {
  bookingId: string;
  buildingType?: string;
  occupancyStatus?: string;
  inAttendance?: string[];
  inspectionConstraints?: string[];
  otherBuildingType?: string;
  otherInAttendance?: string;
  otherConstraints?: string;
}

interface FlagBody {
  reason: string;
}

interface ListQuery {
  isSolo?: string;
  status?: string;
  page?: number;
  limit?: number;
  inspectorId?: string;
  from?: string;
  to?: string;
  search?: string;
}

export default async function inspectionsRoutes(fastify: FastifyInstance) {
  // POST /api/v1/inspections/solo [inspector only — solo inspection]
  // Registered BEFORE /:id to avoid param matching
  fastify.post<{ Body: CreateSoloData & { clientId?: string } }>(
    '/solo',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('inspector')],
      schema: { body: soloInspectionCreateSchema },
    },
    async (request, reply) => {
      const user = getUser(request);
      const { clientId, ...soloData } = request.body;
      const result = await InspectionService.createSolo(user.id, soloData as CreateSoloData, clientId);

      if (result.error === 'insufficient_tokens') {
        return reply.status(402).send({
          data: null,
          error: { code: 'insufficient_tokens', message: 'You need at least 1 token to create a solo inspection.', balance: 0 },
        });
      }

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'SOLO_INSPECTION_FAILED', message: result.error },
        });
      }

      return reply.status(201).send({ data: { inspection: result.inspection }, error: null });
    }
  );

  // GET /api/v1/inspections [inspector — list own inspections]
  fastify.get<{ Querystring: ListQuery }>(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request, _reply) => {
      const user = getUser(request);
      const { isSolo, status, page, limit, inspectorId, from, to, search } = request.query;

      const filters: {
        isSolo?: boolean;
        status?: string;
        page?: number;
        limit?: number;
        inspectorId?: string;
        from?: string;
        to?: string;
        search?: string;
      } = { status, page, limit };

      if (isSolo === 'true') filters.isSolo = true;
      if (isSolo === 'false') filters.isSolo = false;
      if (inspectorId) filters.inspectorId = inspectorId;
      if (from) filters.from = from;
      if (to) filters.to = to;
      if (search) filters.search = search;

      const result = await InspectionService.list(user, filters);
      return { data: result, error: null };
    }
  );

  // POST /api/v1/inspections [inspector only — booking-linked inspection]
  fastify.post<{ Body: CreateBody }>(
    '/',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const {
        bookingId,
        buildingType,
        occupancyStatus,
        inAttendance,
        inspectionConstraints,
        otherBuildingType,
        otherInAttendance,
        otherConstraints,
      } = request.body;

      const metadata = {
        buildingType,
        occupancyStatus,
        inAttendance,
        inspectionConstraints,
        otherBuildingType,
        otherInAttendance,
        otherConstraints,
      };

      const result = await InspectionService.create(user.id, bookingId, metadata);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'INSPECTION_FAILED', message: result.error },
        });
      }

      return reply.status(201).send({ data: { inspection: result.inspection }, error: null });
    }
  );

  // GET /api/v1/inspections/:id [inspector or admin]
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const result = await InspectionService.getById(user, id);

      if (result.error) {
        const status = result.error === 'Inspection not found' ? 404 : 403;
        return reply.status(status).send({
          data: null,
          error: { code: 'INSPECTION_ERROR', message: result.error },
        });
      }

      return { data: { inspection: result.inspection }, error: null };
    }
  );

  // GET /api/v1/inspections/:id/detail [admin only — full detail with observations + photos]
  fastify.get<{ Params: { id: string } }>(
    '/:id/detail',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const result = await InspectionService.getFullDetail(user, id);

      if (result.error) {
        const status = result.error === 'Inspection not found' ? 404 : 403;
        return reply.status(status).send({
          data: null,
          error: { code: 'DETAIL_ERROR', message: result.error },
        });
      }

      return { data: result.detail, error: null };
    }
  );

  // GET /api/v1/inspections/:id/summary
  fastify.get<{ Params: { id: string } }>(
    '/:id/summary',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const result = await InspectionService.getSummary(user, id);

      if (result.error) {
        const status = result.error === 'Inspection not found' ? 404 : 403;
        return reply.status(status).send({
          data: null,
          error: { code: 'SUMMARY_ERROR', message: result.error },
        });
      }

      return { data: { summary: result.summary }, error: null };
    }
  );

  // PUT /api/v1/inspections/:id/submit [inspector only]
  fastify.put<{ Params: { id: string } }>(
    '/:id/submit',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      request.log.info({ action: 'inspection.submit', inspectionId: id, inspectorId: user.id }, 'submit inspection');
      const result = await InspectionService.submit(user.id, id);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'SUBMIT_FAILED', message: result.error },
        });
      }

      return { data: { inspection: result.inspection }, error: null };
    }
  );

  // PUT /api/v1/inspections/:id/approve [admin only]
  fastify.put<{ Params: { id: string } }>(
    '/:id/approve',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      request.log.info({ action: 'inspection.approve', inspectionId: id, adminId: user.id }, 'approve inspection');
      const result = await InspectionService.approve(user.id, id);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'APPROVE_FAILED', message: result.error },
        });
      }

      return {
        data: {
          inspection: result.inspection,
          report: null,
          reportStatus: 'generating' as const,
        },
        error: null,
      };
    }
  );

  // PUT /api/v1/inspections/:id/flag [admin only]
  fastify.put<{ Params: { id: string }; Body: FlagBody }>(
    '/:id/flag',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('admin')],
      schema: { body: flagInspectionSchema },
    },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const { reason } = request.body;
      const result = await InspectionService.flag(user.id, id, reason);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'FLAG_FAILED', message: result.error },
        });
      }

      return { data: { inspection: result.inspection }, error: null };
    }
  );

  // PATCH /api/v1/inspections/:id [inspector — update mutable fields like location, cover photo, weather, metadata]
  fastify.patch<{ Params: { id: string }; Body: {
    location_lat?: number;
    location_lng?: number;
    cover_photo_path?: string;
    weather_snapshot?: Record<string, any>;
    building_type?: string;
    occupancy_status?: string;
    in_attendance?: string[];
    inspection_constraints?: string[];
    other_building_type?: string;
    other_in_attendance?: string;
    other_constraints?: string;
  } }>(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);

      const [insp] = await db
        .select({ inspectorId: inspections.inspectorId })
        .from(inspections)
        .where(eq(inspections.id, request.params.id))
        .limit(1);
      if (!insp || insp.inspectorId !== user.id) return reply.status(403).send({ data: null, error: { code: 'FORBIDDEN', message: 'Access denied' } });

      const updates: Record<string, any> = {};
      if (request.body.location_lat !== undefined) updates.locationLat = request.body.location_lat;
      if (request.body.location_lng !== undefined) updates.locationLng = request.body.location_lng;
      if (request.body.cover_photo_path !== undefined) updates.coverPhotoPath = request.body.cover_photo_path;
      if (request.body.weather_snapshot !== undefined) updates.weatherSnapshot = request.body.weather_snapshot;
      if (request.body.building_type !== undefined) updates.buildingType = request.body.building_type;
      if (request.body.occupancy_status !== undefined) updates.occupancyStatus = request.body.occupancy_status;
      if (request.body.in_attendance !== undefined) updates.inAttendance = request.body.in_attendance;
      if (request.body.inspection_constraints !== undefined) updates.inspectionConstraints = request.body.inspection_constraints;
      if (request.body.other_building_type !== undefined) updates.otherBuildingType = request.body.other_building_type;
      if (request.body.other_in_attendance !== undefined) updates.otherInAttendance = request.body.other_in_attendance;
      if (request.body.other_constraints !== undefined) updates.otherConstraints = request.body.other_constraints;

      if (Object.keys(updates).length === 0) return { data: { updated: false }, error: null };

      await db.update(inspections).set(updates).where(eq(inspections.id, request.params.id));
      return { data: { updated: true }, error: null };
    }
  );

  // POST /api/v1/inspections/:id/sign-cover [inspector — get signed upload URL for cover photo]
  fastify.post<{ Params: { id: string }; Body: { mimeType: string; fileSizeBytes: number } }>(
    '/:id/sign-cover',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);

      const [insp] = await db
        .select({ inspectorId: inspections.inspectorId, status: inspections.status })
        .from(inspections)
        .where(eq(inspections.id, request.params.id))
        .limit(1);
      if (!insp || insp.inspectorId !== user.id) return reply.status(403).send({ data: null, error: { code: 'FORBIDDEN', message: 'Access denied' } });
      if (!insp.status || !['draft', 'in_progress', 'flagged'].includes(insp.status)) {
        return reply.status(400).send({ data: null, error: { code: 'INVALID_STATUS', message: 'Cannot upload cover photo in current status' } });
      }

      const ext = request.body.mimeType === 'image/png' ? 'png' : request.body.mimeType === 'image/webp' ? 'webp' : 'jpg';
      const storagePath = `inspections/${request.params.id}/cover/front.${ext}`;

      const signed = await getSignedUploadUrl('inspection-photos', storagePath, 300, request.body.mimeType);
      if (!signed) {
        return reply.status(500).send({ data: null, error: { code: 'SIGN_FAILED', message: 'Failed to generate upload URL' } });
      }

      return { data: { uploadUrl: signed.signedUrl, storagePath }, error: null };
    }
  );

  // ─── v2 Workflow ─────────────────────────────────────────────────────────────

  // GET /api/v1/inspections/:id/review [inspector]
  fastify.get<{ Params: { id: string } }>(
    '/:id/review',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const result = await InspectionService.getReview(user.id, request.params.id);
      if (result.error) {
        return reply.status(result.error === 'Not found' ? 404 : 403).send({
          data: null, error: { code: 'REVIEW_ERROR', message: result.error },
        });
      }
      return { data: result.review, error: null };
    }
  );

  // PATCH /api/v1/inspections/:id/sections/:sectionId [inspector]
  fastify.patch<{ Params: { id: string; sectionId: string }; Body: { status: string } }>(
    '/:id/sections/:sectionId',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id, sectionId } = request.params;
      const { status } = request.body;
      if (!['pending', 'pass', 'observations'].includes(status)) {
        return reply.status(400).send({ data: null, error: { code: 'INVALID_STATUS', message: 'Status must be pending, pass, or observations' } });
      }
      const result = await InspectionService.markSectionStatus(user.id, id, sectionId, status as any);
      if (result.error) {
        return reply.status(400).send({ data: null, error: { code: 'SECTION_ERROR', message: result.error } });
      }
      return { data: { updated: true }, error: null };
    }
  );

  // POST /api/v1/inspections/:id/sections/:sectionId/conditions [inspector]
  fastify.post<{
    Params: { id: string; sectionId: string };
    Body: { masterConditionId: string; clarification?: string; clientId?: string };
  }>(
    '/:id/sections/:sectionId/conditions',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id, sectionId } = request.params;
      const { masterConditionId, clarification, clientId } = request.body;
      // clientId: optional UUID minted offline so the queued upload_photo /
      // mark_section_status etc. actions can reference the same id on replay.
      const result = await InspectionService.addCondition(user.id, id, sectionId, masterConditionId, clarification, clientId);
      if (result.error) {
        const status = result.error === 'Condition already added' ? 409 : 400;
        return reply.status(status).send({ data: null, error: { code: 'CONDITION_ADD_FAILED', message: result.error } });
      }
      return reply.status(201).send({ data: { condition: result.condition }, error: null });
    }
  );

  // DELETE /api/v1/inspections/:id [inspector — cancel/delete own inspection]
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const result = await InspectionService.cancelInspection(user.id, request.params.id);
      if (result.error) {
        const status = result.error === 'Not authorized' ? 403 : 400;
        return reply.status(status).send({ data: null, error: { code: 'CANCEL_FAILED', message: result.error } });
      }
      return { data: { cancelled: true }, error: null };
    }
  );

  // DELETE /api/v1/inspections/:id/conditions/:conditionId [inspector]
  fastify.delete<{ Params: { id: string; conditionId: string } }>(
    '/:id/conditions/:conditionId',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id, conditionId } = request.params;
      const result = await InspectionService.removeCondition(user.id, id, conditionId);
      if (result.error) {
        return reply.status(400).send({ data: null, error: { code: 'CONDITION_REMOVE_FAILED', message: result.error } });
      }
      return reply.status(204).send();
    }
  );

  // PATCH /api/v1/inspections/:id/conditions/:conditionId [inspector]
  fastify.patch<{ Params: { id: string; conditionId: string }; Body: { clarification?: string; location?: string } }>(
    '/:id/conditions/:conditionId',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id, conditionId } = request.params;
      const { clarification, location } = request.body;
      const result = await InspectionService.updateConditionFields(user.id, id, conditionId, { clarification, location });
      if (result.error) {
        return reply.status(400).send({ data: null, error: { code: 'CONDITION_UPDATE_FAILED', message: result.error } });
      }
      return { data: { updated: true }, error: null };
    }
  );

  // POST /api/v1/inspections/:id/additional-observations [inspector]
  fastify.post<{
    Params: { id: string };
    Body: { sectionId: string; title: string; description: string; clientId?: string };
  }>(
    '/:id/additional-observations',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const result = await InspectionService.addAdditionalObservation(user.id, request.params.id, request.body);
      if (result.error) {
        return reply.status(400).send({ data: null, error: { code: 'OBS_ADD_FAILED', message: result.error } });
      }
      return reply.status(201).send({ data: { observation: result.observation }, error: null });
    }
  );

  // DELETE /api/v1/inspections/:id/additional-observations/:obsId [inspector]
  fastify.delete<{ Params: { id: string; obsId: string } }>(
    '/:id/additional-observations/:obsId',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id, obsId } = request.params;
      const result = await InspectionService.removeAdditionalObservation(user.id, id, obsId);
      if (result.error) {
        return reply.status(400).send({ data: null, error: { code: 'OBS_REMOVE_FAILED', message: result.error } });
      }
      return reply.status(204).send();
    }
  );

  // PUT /api/v1/inspections/:id/limitations [inspector]
  fastify.put<{ Params: { id: string }; Body: { limitationIds: string[] } }>(
    '/:id/limitations',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const result = await InspectionService.setLimitations(user.id, request.params.id, request.body.limitationIds);
      if (result.error) {
        return reply.status(400).send({ data: null, error: { code: 'LIMITATIONS_FAILED', message: result.error } });
      }
      return { data: { updated: true }, error: null };
    }
  );
}
