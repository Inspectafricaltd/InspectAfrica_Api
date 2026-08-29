import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { AuthServiceV2 } from '../services/AuthServiceV2.js';
import { logger } from '../lib/logger.js';
import { cacheGet, cacheSet, cacheInvalidate, type CachedUser } from '../lib/userCache.js';
import type { UserPayload } from '../types/fastify.d.ts';

// Re-export for callers (e.g. AuthService) that need to invalidate after logout
export { cacheInvalidate as invalidateUserCacheV2 } from '../lib/userCache.js';

async function authV2Plugin(fastify: FastifyInstance) {
  fastify.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.substring(7);
    const payload = AuthServiceV2.verifyAccessToken(token);

    if (!payload) {
      return reply.status(401).send({ error: 'Invalid or expired token' });
    }

    let cached: CachedUser | null = cacheGet(payload.sub);

    if (!cached) {
      const [row] = await db
        .select({ id: users.id, email: users.email, role: users.role, tokenVersion: users.tokenVersion, status: users.status })
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1);

      if (!row || row.status === 'suspended') {
        logger.warn({ userId: payload.sub }, 'authV2: user not found or suspended');
        return reply.status(401).send({ error: 'Account unavailable' });
      }

      cacheSet({
        id: row.id, email: row.email,
        role: row.role as UserPayload['role'],
        tokenVersion: row.tokenVersion ?? 0,
      });
      cached = cacheGet(payload.sub)!;
    }

    if (payload.version < cached.tokenVersion) {
      cacheInvalidate(payload.sub);
      return reply.status(401).send({ error: 'Token has been revoked' });
    }

    request.user = {
      id: cached.id,
      email: cached.email,
      role: cached.role,
    } as unknown as typeof request.user;
  });

  fastify.decorate('requireRole', function (role: string) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      const user = request.user as unknown as UserPayload | undefined;
      if (!user) return reply.status(401).send({ error: 'Not authenticated' });
      if (user.role !== role) return reply.status(403).send({ error: `Requires role: ${role}` });
    };
  });
}

export default fp(authV2Plugin, { name: 'authV2' });
