import type { FastifyInstance } from 'fastify';
import { ReviewService } from '../services/ReviewService.js';
import { getUser } from '../utils/getUser.js';

interface CreateBody {
  bookingId: string;
  rating: number;
  comment?: string;
}

interface InspectorParams {
  inspectorId: string;
}

interface BookingParams {
  bookingId: string;
}

interface ListQuery {
  page?: number;
  limit?: number;
}

export default async function reviewRoutes(fastify: FastifyInstance) {
  // POST /api/v1/reviews [client only — submit a review]
  fastify.post<{ Body: CreateBody }>(
    '/',
    { preHandler: [fastify.authenticate, fastify.requireRole('client')] },
    async (request, reply) => {
      const user = getUser(request);
      const { bookingId, rating, comment } = request.body;

      if (!bookingId || !rating) {
        return reply.status(400).send({
          data: null,
          error: { code: 'VALIDATION_ERROR', message: 'bookingId and rating are required' },
        });
      }

      if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        return reply.status(400).send({
          data: null,
          error: { code: 'VALIDATION_ERROR', message: 'Rating must be an integer between 1 and 5' },
        });
      }

      const result = await ReviewService.create(user.id, { bookingId, rating, comment });

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'REVIEW_FAILED', message: result.error },
        });
      }

      return reply.status(201).send({ data: { review: result.review }, error: null });
    }
  );

  // GET /api/v1/reviews/inspector/:inspectorId [public — get reviews for an inspector]
  fastify.get<{ Params: InspectorParams; Querystring: ListQuery }>(
    '/inspector/:inspectorId',
    async (request, _reply) => {
      const { inspectorId } = request.params;
      const { page, limit } = request.query;
      const result = await ReviewService.listByInspector(inspectorId, page, limit);
      return { data: result, error: null };
    }
  );

  // GET /api/v1/reviews/check/:bookingId [client only — check if already reviewed]
  fastify.get<{ Params: BookingParams }>(
    '/check/:bookingId',
    { preHandler: [fastify.authenticate, fastify.requireRole('client')] },
    async (request, _reply) => {
      const user = getUser(request);
      const { bookingId } = request.params;
      const result = await ReviewService.hasReviewed(user.id, bookingId);
      return { data: result, error: null };
    }
  );
}
