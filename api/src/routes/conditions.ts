import type { FastifyInstance } from 'fastify';
import { ConditionService, type UpdateConditionData } from '../services/ConditionService.js';
import { updateConditionSchema } from '../schemas/index.js';
import { getUser } from '../utils/getUser.js';

export default async function conditionsRoutes(fastify: FastifyInstance) {
  // PUT /api/v1/conditions/:id [inspector only]
  fastify.put<{ Params: { id: string }; Body: UpdateConditionData }>(
    '/:id',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('inspector')],
      schema: { body: updateConditionSchema },
    },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const result = await ConditionService.update(user.id, id, request.body);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'UPDATE_FAILED', message: result.error },
        });
      }

      return { data: { condition: result.condition }, error: null };
    }
  );

  // GET /api/v1/conditions/:id/history [inspector-of-record, client-of-record, or admin]
  fastify.get<{ Params: { id: string } }>(
    '/:id/history',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const result = await ConditionService.getHistory(user, id);

      if (result.error) {
        const status = result.error === 'Condition not found' ? 404 : 403;
        return reply.status(status).send({
          data: null,
          error: { code: status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message: result.error },
        });
      }

      return { data: { history: result.history }, error: null };
    }
  );
}
