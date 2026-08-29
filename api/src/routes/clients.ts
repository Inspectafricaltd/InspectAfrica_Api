import type { FastifyInstance } from 'fastify';
import { ClientService } from '../services/ClientService.js';
import { getUser } from '../utils/getUser.js';

interface UpdateProfileBody {
  phone?: string;
  countryOfResidence?: string;
  diasporaFlag?: string;
}

export default async function clientsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/clients/me [client only]
  fastify.get(
    '/me',
    { preHandler: [fastify.authenticate, fastify.requireRole('client')] },
    async (request, reply) => {
      const user = getUser(request);
      const client = await ClientService.getMyProfile(user.id);

      if (!client) {
        return reply.status(404).send({
          data: null,
          error: { code: 'PROFILE_NOT_FOUND', message: 'Client profile not found' },
        });
      }

      return { data: { client }, error: null };
    }
  );

  // PUT /api/v1/clients/me [client only]
  fastify.put<{ Body: UpdateProfileBody }>(
    '/me',
    { preHandler: [fastify.authenticate, fastify.requireRole('client')] },
    async (request, reply) => {
      const user = getUser(request);
      const client = await ClientService.updateMyProfile(user.id, request.body);

      if (!client) {
        return reply.status(400).send({
          data: null,
          error: { code: 'UPDATE_FAILED', message: 'Failed to update profile' },
        });
      }

      return { data: { client }, error: null };
    }
  );
}
