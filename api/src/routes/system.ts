import type { FastifyInstance } from 'fastify';
import { AdminService } from '../services/AdminService.js';
import { BookingService } from '../services/BookingService.js';
import { runCertExpiryJob } from '../jobs/certExpiryJob.js';
import { timingSafeEqualString } from '../lib/timingSafe.js';

export default async function systemRoutes(fastify: FastifyInstance) {
  // HEAD /api/v1/ping [public - no auth]
  fastify.route({
    method: 'HEAD',
    url: '/ping',
    handler: async (_request, reply) => {
      return reply.code(200).send();
    },
  });

  // GET /api/v1/health [admin only]
  fastify.get('/health', { preHandler: [fastify.authenticate, fastify.requireRole('admin')] }, async (_request, _reply) => {
    const health = await AdminService.healthCheck(fastify);
    return { data: health, error: null };
  });

  // POST /api/v1/cron/stale-bookings [cron secret auth]
  // Called by Railway cron every 6 hours. Notifies admins about bookings open > 48 hours.
  fastify.post('/cron/stale-bookings', async (request, reply) => {
    const cronSecret = (request.headers['x-cron-secret'] as string) || '';
    if (!process.env.CRON_SECRET || !timingSafeEqualString(cronSecret, process.env.CRON_SECRET)) {
      return reply.status(401).send({ data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' } });
    }

    const result = await BookingService.notifyStaleBookings();
    return { data: { notified: result.notified }, error: null };
  });

  // POST /api/v1/cron/cert-expiry [cron secret auth]
  // Should be called daily by Railway cron. Sends 30/7-day ACHI cert expiry
  // warnings and demotes any certs that have actually lapsed. Previously
  // only existed as a standalone CLI script with no HTTP trigger, so this
  // never ran in production.
  fastify.post('/cron/cert-expiry', async (request, reply) => {
    const cronSecret = (request.headers['x-cron-secret'] as string) || '';
    if (!process.env.CRON_SECRET || !timingSafeEqualString(cronSecret, process.env.CRON_SECRET)) {
      return reply.status(401).send({ data: null, error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' } });
    }

    const result = await runCertExpiryJob();
    return { data: result, error: null };
  });
}
