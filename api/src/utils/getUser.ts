import type { FastifyRequest } from 'fastify';
import type { UserPayload } from '../types/fastify.d.ts';

/**
 * Safely extract the typed user from a Fastify request.
 * The request.user property is set by the authenticate preHandler.
 */
export function getUser(request: FastifyRequest): UserPayload {
  if (!request.user) {
    throw new Error('User not authenticated - request.user is undefined');
  }
  return request.user as unknown as UserPayload;
}

/**
 * Get user or null if not authenticated
 */
export function getUserOrNull(request: FastifyRequest): UserPayload | null {
  if (!request.user) return null;
  return request.user as unknown as UserPayload;
}
