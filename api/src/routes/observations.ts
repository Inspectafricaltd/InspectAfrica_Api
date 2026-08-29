import type { FastifyInstance } from 'fastify';
import { ObservationService, type CreateObservationData } from '../services/ObservationService.js';
import { createObservationSchema } from '../schemas/index.js';
import { getUser } from '../utils/getUser.js';

interface UpdateBody {
  text: string;
}

export default async function observationsRoutes(fastify: FastifyInstance) {
  // POST /api/v1/observations [inspector or admin]
  fastify.post<{ Body: CreateObservationData }>(
    '/',
    {
      preHandler: [fastify.authenticate],
      schema: { body: createObservationSchema },
    },
    async (request, reply) => {
      const user = getUser(request);
      const result = await ObservationService.create(user, request.body);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'CREATE_FAILED', message: result.error },
        });
      }

      return reply.status(201).send({ data: { observation: result.observation }, error: null });
    }
  );

  // PUT /api/v1/observations/:id [original author only]
  fastify.put<{ Params: { id: string }; Body: UpdateBody }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const { text } = request.body;
      const result = await ObservationService.update(user, id, text);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'UPDATE_FAILED', message: result.error },
        });
      }

      return { data: { observation: result.observation }, error: null };
    }
  );

  // DELETE /api/v1/observations/:id [original author or admin]
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const result = await ObservationService.delete(user, id);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'DELETE_FAILED', message: result.error },
        });
      }

      return { data: { success: true }, error: null };
    }
  );
}
