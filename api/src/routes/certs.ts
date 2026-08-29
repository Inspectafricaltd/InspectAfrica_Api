import type { FastifyInstance } from 'fastify';
import { CertService } from '../services/CertService.js';
import { CertCacheService } from '../services/CertCacheService.js';
import { SyncConflictService } from '../services/SyncConflictService.js';
import { SyncStatusService } from '../services/SyncStatusService.js';
import { getUser } from '../utils/getUser.js';

interface VerifyBody {
  achiNumber: string;
  inspectorId: string;
}

interface PublicVerifyParams {
  achiNumber: string;
}

export default async function certsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/certs/verify/:achiNumber [public]
  // Public endpoint for certificate verification with caching
  fastify.get<{ Params: PublicVerifyParams }>(
    '/verify/:achiNumber',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            achiNumber: { type: 'string', pattern: '^ACHI-\\d{4}-\\d{5}$' },
          },
          required: ['achiNumber'],
        },
      },
    },
    async (request, _reply) => {
      const { achiNumber } = request.params;

      // Use cached verification
      const result = await CertCacheService.verifyWithCache(achiNumber);

      return {
        data: {
          achi_number: achiNumber,
          valid: result.valid,
          name: result.name || null,
          issued: result.issued || null,
          expires: result.expires || null,
          status: result.status || null,
          cached: result.cached || false,
        },
        error: null,
      };
    }
  );

  // POST /api/v1/certs/reverify [inspector only — self-service]
  // See CertService.reverifySelf for the full rationale (checks WordPress
  // live and actually applies the result to the caller's own profile,
  // promote-only — never downgrades).
  fastify.post(
    '/reverify',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const inspectorId = getUser(request).id;
      const result = await CertService.reverifySelf(inspectorId);

      if ('error' in result) {
        return reply.status(400).send({
          data: null,
          error: { code: 'NO_ACHI_NUMBER', message: result.error },
        });
      }

      return {
        data: {
          achi_number: result.achiNumber,
          valid:       result.valid,
          status:      result.status,
          issued:      result.issued,
          expires:     result.expires,
          promoted:    result.promoted,
        },
        error: null,
      };
    }
  );

  // POST /api/v1/certs/verify [admin only]
  fastify.post<{ Body: VerifyBody }>(
    '/verify',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, _reply) => {
      const { achiNumber, inspectorId } = request.body;
      const result = await CertService.verify(achiNumber, inspectorId);
      return { data: { verification: result }, error: null };
    }
  );

  // GET /api/v1/certs/:inspectorId [admin only]
  fastify.get<{ Params: { inspectorId: string } }>(
    '/:inspectorId',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const { inspectorId } = request.params;
      const cert = await CertService.getInspectorCert(inspectorId);

      if (!cert) {
        return reply.status(404).send({
          data: null,
          error: { code: 'CERT_NOT_FOUND', message: 'Inspector certificate not found' },
        });
      }

      return { data: { cert }, error: null };
    }
  );

  // GET /api/v1/certs/sync/status [admin only]
  fastify.get(
    '/sync/status',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (_request, _reply) => {
      const health = await SyncStatusService.getSyncHealth('cert_sync');
      const stats = await SyncStatusService.getSyncStats();
      const cacheStats = await CertCacheService.getCacheStats();

      return {
        data: {
          sync: health,
          stats,
          cache: cacheStats,
        },
        error: null,
      };
    }
  );

  // GET /api/v1/certs/sync/runs [admin only]
  fastify.get(
    '/sync/runs',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (_request, _reply) => {
      const runs = await SyncStatusService.getRecentRuns(20, 'cert_sync');
      return { data: { runs }, error: null };
    }
  );

  // GET /api/v1/certs/conflicts [admin only]
  fastify.get(
    '/conflicts',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (_request, _reply) => {
      const conflicts = await SyncConflictService.getUnresolvedConflicts();
      const stats = await SyncConflictService.getConflictStats();

      return {
        data: {
          conflicts,
          stats,
        },
        error: null,
      };
    }
  );

  // POST /api/v1/certs/conflicts/:conflictId/resolve [admin only]
  fastify.post<{ Params: { conflictId: string }; Body: { resolution: 'wordpress_wins' | 'app_wins' | 'manual_review' } }>(
    '/conflicts/:conflictId/resolve',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, _reply) => {
      const { conflictId } = request.params;
      const { resolution } = request.body;
      const userId = getUser(request).id;

      await SyncConflictService.resolveConflict(conflictId, resolution, userId);

      return {
        data: { success: true, conflictId, resolution },
        error: null,
      };
    }
  );

  // POST /api/v1/certs/cache/clear [admin only]
  fastify.post(
    '/cache/clear',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (_request, _reply) => {
      await CertCacheService.clearAllCache();
      return { data: { success: true, message: 'Cache cleared' }, error: null };
    }
  );

  // DELETE /api/v1/certs/cache/:achiNumber [admin only]
  fastify.delete<{ Params: { achiNumber: string } }>(
    '/cache/:achiNumber',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, _reply) => {
      const { achiNumber } = request.params;
      await CertCacheService.invalidateCache(achiNumber);
      return { data: { success: true, achiNumber }, error: null };
    }
  );
}
