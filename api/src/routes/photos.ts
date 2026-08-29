import type { FastifyInstance } from 'fastify';
import { PhotoService, type SignUploadData, type ConfirmUploadData } from '../services/PhotoService.js';
import { signUploadSchema, confirmUploadSchema, annotatePhotoSchema } from '../schemas/index.js';
import { getUser } from '../utils/getUser.js';

interface AnnotateBody {
  shapes: Record<string, unknown>[];
}

export default async function photosRoutes(fastify: FastifyInstance) {
  // POST /api/v1/photos/sign [inspector only]
  fastify.post<{ Body: SignUploadData }>(
    '/sign',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('inspector')],
      schema: { body: signUploadSchema },
    },
    async (request, reply) => {
      const user = getUser(request);
      const result = await PhotoService.getSignedUploadUrl(user.id, request.body);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'SIGN_FAILED', message: result.error },
        });
      }

      return { data: result, error: null };
    }
  );

  // PUT /api/v1/photos/:id/confirm [inspector only]
  fastify.put<{ Params: { id: string }; Body: ConfirmUploadData }>(
    '/:id/confirm',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('inspector')],
      schema: { body: confirmUploadSchema },
    },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const result = await PhotoService.confirmUpload(user.id, id, request.body);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'CONFIRM_FAILED', message: result.error },
        });
      }

      return { data: { photo: result.photo }, error: null };
    }
  );

  // DELETE /api/v1/photos/:id [inspector only]
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const result = await PhotoService.delete(user.id, id);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'DELETE_FAILED', message: result.error },
        });
      }

      return { data: { success: true }, error: null };
    }
  );

  // PUT /api/v1/photos/:id/annotate [inspector only]
  fastify.put<{ Params: { id: string }; Body: AnnotateBody }>(
    '/:id/annotate',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('inspector')],
      schema: { body: annotatePhotoSchema },
    },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const { shapes } = request.body;
      const result = await PhotoService.upsertAnnotation(user.id, id, shapes);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'ANNOTATE_FAILED', message: result.error },
        });
      }

      return { data: { annotation: result.annotation }, error: null };
    }
  );
}
