import type { FastifyInstance } from 'fastify';
import { TemplateService } from '../services/TemplateService.js';

interface CreateTypeBody {
  slug: string;
  name: string;
  description?: string;
  displayOrder?: number;
}

interface UpdateTypeBody {
  name?: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
}

interface ConditionBody {
  sectionSlug: string;
  slug: string;
  name: string;
  description?: string;
  displayOrder?: number;
}

interface UpdateConditionBody {
  name?: string;
  description?: string;
  displayOrder?: number;
  isActive?: boolean;
}

interface TagBody {
  typeSlug: string;
  action: 'add' | 'remove';
}

export default async function templateRoutes(fastify: FastifyInstance) {
  // GET /api/v1/templates/types — list inspection types (public for inspectors)
  fastify.get(
    '/types',
    { preHandler: [fastify.authenticate] },
    async (_request, _reply) => {
      const result = await TemplateService.getInspectionTypes();
      if (result.error) {
        return { data: null, error: { code: 'TEMPLATE_ERROR', message: result.error } };
      }
      return { data: { types: result.types }, error: null };
    }
  );

  // GET /api/v1/templates/types/:slug — get full template for an inspection type
  fastify.get<{ Params: { slug: string } }>(
    '/types/:slug',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { slug } = request.params;
      const result = await TemplateService.getTemplate(slug);

      if (result.error) {
        return reply.status(404).send({
          data: null,
          error: { code: 'TEMPLATE_NOT_FOUND', message: result.error },
        });
      }

      return { data: { template: result.template }, error: null };
    }
  );

  // POST /api/v1/templates/types — admin: create a new inspection type
  fastify.post<{ Body: CreateTypeBody }>(
    '/types',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const { slug, name, description, displayOrder } = request.body || ({} as CreateTypeBody);
      if (!slug || !name) {
        return reply.status(400).send({ data: null, error: { code: 'MISSING_FIELDS', message: 'slug and name are required' } });
      }
      const result = await TemplateService.createType({ slug: slug.trim().toLowerCase(), name: name.trim(), description, displayOrder });
      if (result.error || !result.type) {
        const isDup = /already exists/i.test(result.error || '');
        return reply.status(isDup ? 409 : 400).send({ data: null, error: { code: isDup ? 'SLUG_EXISTS' : 'CREATE_FAILED', message: result.error || 'Create failed' } });
      }
      return reply.status(201).send({ data: { type: result.type }, error: null });
    }
  );

  // PUT /api/v1/templates/types/:slug — admin: update inspection type metadata
  fastify.put<{ Params: { slug: string }; Body: UpdateTypeBody }>(
    '/types/:slug',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const { slug } = request.params;
      const result = await TemplateService.updateType(slug, request.body || {});
      if (result.error || !result.type) {
        const notFound = /not found/i.test(result.error || '');
        return reply.status(notFound ? 404 : 400).send({ data: null, error: { code: notFound ? 'NOT_FOUND' : 'UPDATE_FAILED', message: result.error || 'Update failed' } });
      }
      return { data: { type: result.type }, error: null };
    }
  );

  // POST /api/v1/templates/conditions — admin: add a new master condition
  fastify.post<{ Body: ConditionBody }>(
    '/conditions',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const result = await TemplateService.addCondition(request.body);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'ADD_CONDITION_FAILED', message: result.error },
        });
      }

      return reply.status(201).send({ data: { condition: result.condition }, error: null });
    }
  );

  // PUT /api/v1/templates/conditions/:id — admin: update a master condition
  fastify.put<{ Params: { id: string }; Body: UpdateConditionBody }>(
    '/conditions/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const result = await TemplateService.updateCondition(id, request.body);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'UPDATE_CONDITION_FAILED', message: result.error },
        });
      }

      return { data: { condition: result.condition }, error: null };
    }
  );

  // PUT /api/v1/templates/conditions/:id/types — admin: tag/untag condition for a type
  fastify.put<{ Params: { id: string }; Body: TagBody }>(
    '/conditions/:id/types',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const { typeSlug, action } = request.body;
      const result = await TemplateService.tagCondition(id, typeSlug, action);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'TAG_CONDITION_FAILED', message: result.error },
        });
      }

      return { data: { success: true }, error: null };
    }
  );

  // DELETE /api/v1/templates/conditions/:id — admin: deactivate a condition
  fastify.delete<{ Params: { id: string } }>(
    '/conditions/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const { id } = request.params;
      const result = await TemplateService.deactivateCondition(id);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'DEACTIVATE_FAILED', message: result.error },
        });
      }

      return { data: { condition: result.condition }, error: null };
    }
  );
}
