import type { FastifyInstance } from 'fastify';
import { ReportService } from '../services/ReportService.js';
import { getUser } from '../utils/getUser.js';

export default async function reportsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/reports [inspector lists own, client lists own, admin lists all]
  // Registered BEFORE /:inspectionId to avoid greedy matching.
  fastify.get<{ Querystring: { page?: number; limit?: number; bookingId?: string } }>(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      const { page, limit, bookingId } = request.query;

      if (user.role === 'inspector') {
        const result = await ReportService.listForInspector(user.id, { page, limit });
        return { data: result, error: null };
      }

      if (user.role === 'client') {
        const result = await ReportService.listForClient(user.id, { page, limit, bookingId });
        return { data: result, error: null };
      }

      if (user.role === 'admin') {
        // Admin: if bookingId is provided, filter to that booking; otherwise reject for now.
        return reply.status(400).send({
          data: null,
          error: {
            code: 'NOT_SUPPORTED',
            message: 'Admin listing of all reports is not supported at this endpoint',
          },
        });
      }

      return reply.status(403).send({
        data: null,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
    }
  );

  // GET /api/v1/reports/:inspectionId [inspector, client, admin]
  fastify.get<{ Params: { inspectionId: string } }>(
    '/:inspectionId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      const { inspectionId } = request.params;
      const result = await ReportService.getLatest(user, inspectionId);

      if (result.error) {
        const status =
          result.error === 'Inspection not found' || result.error === 'No report available'
            ? 404
            : 403;
        return reply.status(status).send({
          data: null,
          error: { code: 'REPORT_ERROR', message: result.error },
        });
      }

      return { data: { report: result.report, downloadUrl: result.downloadUrl }, error: null };
    }
  );

  // GET /api/v1/reports/:inspectionId/versions [inspector or admin]
  fastify.get<{ Params: { inspectionId: string } }>(
    '/:inspectionId/versions',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      const { inspectionId } = request.params;

      // Non-admin roles must own the inspection (inspector or client of record).
      // Admins pass through.
      if (user.role !== 'admin') {
        const { InspectionService } = await import('../services/InspectionService.js');
        const { error } = await InspectionService.getById(user, inspectionId);
        if (error) {
          const status = error === 'Inspection not found' ? 404 : 403;
          return reply.status(status).send({
            data: null,
            error: { code: status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message: error },
          });
        }
      }

      const versions = await ReportService.getAllVersions(inspectionId);
      return { data: { versions }, error: null };
    }
  );

  // GET /api/v1/reports/:inspectionId/versions/:v [admin only]
  fastify.get<{ Params: { inspectionId: string; v: number } }>(
    '/:inspectionId/versions/:v',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const { inspectionId, v } = request.params;
      const result = await ReportService.getVersion(inspectionId, v);

      if (result.error) {
        return reply.status(404).send({
          data: null,
          error: { code: 'VERSION_NOT_FOUND', message: result.error },
        });
      }

      return { data: { report: result.report, downloadUrl: result.downloadUrl }, error: null };
    }
  );

  // POST /api/v1/reports/:inspectionId/generate [inspector or admin]
  fastify.post<{ Params: { inspectionId: string } }>(
    '/:inspectionId/generate',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      if (user.role !== 'inspector' && user.role !== 'admin') {
        return reply.status(403).send({
          data: null,
          error: { code: 'FORBIDDEN', message: 'Only inspectors and admins can generate reports' },
        });
      }

      const { inspectionId } = request.params;
      request.log.info({ action: 'report.generate', inspectionId, userId: user.id, role: user.role }, 'generate report');

      // Ownership check: inspectors can only generate reports for their own inspections
      if (user.role === 'inspector') {
        const { InspectionService } = await import('../services/InspectionService.js');
        const { error } = await InspectionService.getById(user, inspectionId);
        if (error) {
          return reply.status(403).send({
            data: null,
            error: { code: 'FORBIDDEN', message: error },
          });
        }
      }

      const result = await ReportService.generate(inspectionId, user.id);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'GENERATE_FAILED', message: result.error },
        });
      }

      return reply.status(201).send({ data: { report: result.report }, error: null });
    }
  );

  // GET /api/v1/reports/access/:token [public - no auth]
  fastify.get<{ Params: { token: string } }>(
    '/access/:token',
    async (request, reply) => {
      const { token } = request.params;
      const result = await ReportService.accessByToken(token);

      if (result.error) {
        return reply.status(403).send({
          data: null,
          error: { code: 'ACCESS_DENIED', message: result.error },
        });
      }

      return { data: result, error: null };
    }
  );

  // GET /api/v1/reports/:inspectionId/share-link [inspector/admin/client]
  fastify.get<{ Params: { inspectionId: string } }>(
    '/:inspectionId/share-link',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      const { inspectionId } = request.params;
      const result = await ReportService.getShareLink(user, inspectionId);

      if (result.error) {
        const status = result.error === 'Inspection not found' ? 404 : 403;
        return reply.status(status).send({
          data: null,
          error: { code: status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message: result.error },
        });
      }

      return { data: { token: result.token, expiresAt: result.expiresAt }, error: null };
    }
  );

  // POST /api/v1/reports/:inspectionId/share-link/regenerate [inspector/admin only]
  fastify.post<{ Params: { inspectionId: string } }>(
    '/:inspectionId/share-link/regenerate',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      if (user.role !== 'inspector' && user.role !== 'admin') {
        return reply.status(403).send({
          data: null,
          error: { code: 'FORBIDDEN', message: 'Only inspectors and admins can regenerate share links' },
        });
      }

      const { inspectionId } = request.params;
      const result = await ReportService.getShareLink(user, inspectionId, { regenerate: true });

      if (result.error) {
        const status = result.error === 'Inspection not found' ? 404 : 403;
        return reply.status(status).send({
          data: null,
          error: { code: status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message: result.error },
        });
      }

      return { data: { token: result.token, expiresAt: result.expiresAt }, error: null };
    }
  );

  // GET /api/v1/reports/:inspectionId/history [admin only]
  fastify.get<{ Params: { inspectionId: string } }>(
    '/:inspectionId/history',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, _reply) => {
      const { inspectionId } = request.params;
      const history = await ReportService.getHistory(inspectionId);
      return { data: { history }, error: null };
    }
  );
}
