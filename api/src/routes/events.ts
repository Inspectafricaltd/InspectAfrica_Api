import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { AuthServiceV2 } from '../services/AuthServiceV2.js';
import { register, deregister } from '../lib/eventBus.js';

const PING_INTERVAL_MS = 25_000; // keep-alive under Railway's 30s proxy timeout

export default async function eventsRoutes(fastify: FastifyInstance) {
  /**
   * GET /api/v1/events?token=<accessToken>
   *
   * Opens an SSE stream for the authenticated user.
   * EventSource doesn't support custom headers so the JWT travels as ?token=.
   * We verify it the same way the authenticate preHandler does.
   */
  fastify.get<{ Querystring: { token?: string } }>(
    '/events',
    async (request, reply) => {
      const rawToken = request.query.token;

      if (!rawToken) {
        return reply.status(401).send({ error: 'Missing token' });
      }

      // Verify token → resolve user id
      const payload = AuthServiceV2.verifyAccessToken(rawToken);
      if (!payload) {
        return reply.status(401).send({ error: 'Invalid token' });
      }
      const userId = payload.sub;

      // Load role from DB (Drizzle/Railway)
      const [userRow] = await db
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!userRow) return reply.status(401).send({ error: 'User not found' });
      const role = userRow.role;

      // SSE headers — must set CORS manually because reply.raw bypasses @fastify/cors
      const reqOrigin = request.headers.origin;
      if (reqOrigin) {
        reply.raw.setHeader('Access-Control-Allow-Origin', reqOrigin);
        reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
        reply.raw.setHeader('Vary', 'Origin');
      }
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
      reply.raw.flushHeaders();

      const write = (event: string, data: Record<string, unknown>) => {
        try {
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify({ ...data, ts: Date.now() })}\n\n`);
        } catch {
          // connection already gone
        }
      };

      const close = () => {
        try { reply.raw.end(); } catch { /* ignore */ }
      };

      register({ userId, role, write, close });

      // Keep-alive ping so Railway proxy doesn't close idle streams
      const pingTimer = setInterval(() => {
        try {
          reply.raw.write(': ping\n\n');
        } catch {
          clearInterval(pingTimer);
        }
      }, PING_INTERVAL_MS);

      // Send a connected confirmation so the client knows the stream is live
      write('connected', { userId, role });

      // Cleanup when client disconnects
      request.raw.on('close', () => {
        clearInterval(pingTimer);
        deregister(userId);
      });

      // Keep the handler alive (Fastify would auto-close otherwise)
      await new Promise<void>((resolve) => {
        request.raw.on('close', resolve);
      });
    }
  );

  // GET /api/v1/events/health — quick check for ops
  fastify.get('/events/health', async () => {
    const { connectionCount } = await import('../lib/eventBus.js');
    return { ok: true, connections: connectionCount() };
  });
}
