import type { FastifyRequest, FastifyReply } from 'fastify';

export interface UserPayload {
  id: string;
  email: string;
  role: 'inspector' | 'client' | 'admin';
}

// Type helper for extracting user from request
export type RequestWithUser = FastifyRequest & { user: UserPayload };

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (role: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: UserPayload;
  }
}
