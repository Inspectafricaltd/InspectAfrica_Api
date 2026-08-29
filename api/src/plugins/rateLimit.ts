import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { UserPayload } from '../types/fastify.d.ts';

export interface RateLimitConfig {
  global?: {
    max: number;
    timeWindow: string;
  };
  auth?: {
    max: number;
    timeWindow: string;
  };
  api?: {
    max: number;
    timeWindow: string;
  };
}

const defaultConfig: RateLimitConfig = {
  global: {
    max: 1000,
    timeWindow: '1 minute',
  },
  auth: {
    max: 10,
    timeWindow: '1 minute',
  },
  api: {
    max: 100,
    timeWindow: '1 minute',
  },
};

/**
 * Per-route override applied to login/register/password-reset endpoints.
 * Tight IP-keyed bucket to kneecap brute-force attempts.
 */
export const AUTH_RATE_LIMIT = {
  max: defaultConfig.auth!.max,
  timeWindow: defaultConfig.auth!.timeWindow,
  keyGenerator: (request: { ip: string }) => `auth:${request.ip}`,
};

async function rateLimitPlugin(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    global: true,
    max: defaultConfig.global!.max,
    timeWindow: defaultConfig.global!.timeWindow,
    cache: 10000,
    allowList: ['127.0.0.1', '::1'],
    redis: process.env.REDIS_URL ? {
      host: new URL(process.env.REDIS_URL).hostname,
      port: parseInt(new URL(process.env.REDIS_URL).port || '6379'),
      password: new URL(process.env.REDIS_URL).password || undefined,
    } : undefined,
    keyGenerator: (request) => {
      // Use user ID if authenticated, otherwise IP
      const user = request.user as unknown as UserPayload | undefined;
      if (user?.id) {
        return `user:${user.id}`;
      }
      return request.ip;
    },
    errorResponseBuilder: (_request, context) => ({
      data: null,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: `Rate limit exceeded. Retry after ${context.after}`,
        retryAfter: context.after,
      },
    }),
  });

  // Store config for route-specific limits
  fastify.decorate('rateLimitConfig', defaultConfig);
}

export default fp(rateLimitPlugin, {
  name: 'rateLimit',
});

declare module 'fastify' {
  interface FastifyInstance {
    rateLimitConfig: RateLimitConfig;
  }
}
