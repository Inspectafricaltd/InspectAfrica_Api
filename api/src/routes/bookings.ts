import type { FastifyInstance } from 'fastify';
import { BookingService, type CreateBookingData } from '../services/BookingService.js';
import { bookingCreateSchema } from '../schemas/index.js';
import { getUser } from '../utils/getUser.js';

interface ListQuery {
  status?: string;
  page?: number;
  limit?: number;
}

export default async function bookingsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/bookings/open [inspector only — open pool]
  // Registered BEFORE /:id to avoid param matching
  fastify.get(
    '/open',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, _reply) => {
      const user = getUser(request);
      const result = await BookingService.listOpen(user.id);

      if (result.error) {
        return { data: null, error: { code: 'POOL_ERROR', message: result.error } };
      }

      return { data: { bookings: result.bookings }, error: null };
    }
  );

  // POST /api/v1/bookings [client only]
  fastify.post<{ Body: CreateBookingData }>(
    '/',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('client')],
      schema: { body: bookingCreateSchema },
    },
    async (request, reply) => {
      const user = getUser(request);
      request.log.info({ action: 'booking.create', userId: user.id }, 'create booking');
      const result = await BookingService.create(user.id, request.body);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'BOOKING_FAILED', message: result.error },
        });
      }

      return reply.status(201).send({ data: { booking: result.booking }, error: null });
    }
  );

  // GET /api/v1/bookings [scoped by role]
  fastify.get<{ Querystring: ListQuery }>(
    '/',
    { preHandler: [fastify.authenticate] },
    async (request, _reply) => {
      const user = getUser(request);
      const { status, page, limit } = request.query;
      const result = await BookingService.list(user, { status, page, limit });
      return { data: result, error: null };
    }
  );

  // GET /api/v1/bookings/:id [scoped by role]
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const result = await BookingService.getById(user, id);

      if (result.error) {
        const status = result.error === 'Booking not found' ? 404 : 403;
        return reply.status(status).send({
          data: null,
          error: { code: 'BOOKING_ERROR', message: result.error },
        });
      }

      return { data: { booking: result.booking }, error: null };
    }
  );

  // POST /api/v1/bookings/:id/accept [inspector only — accept from open pool]
  fastify.post<{ Params: { id: string } }>(
    '/:id/accept',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      request.log.info({ action: 'booking.accept', bookingId: id, inspectorId: user.id }, 'accept booking');
      const result = await BookingService.accept(user.id, id);

      if (result.error) {
        const statusCode = (result as any).statusCode === 409 ? 409 : 400;
        return reply.status(statusCode).send({
          data: null,
          error: { code: 'ACCEPT_FAILED', message: result.error },
        });
      }

      return { data: { booking: result.booking }, error: null };
    }
  );

  // POST /api/v1/bookings/:id/decline [inspector only — decline from open pool]
  fastify.post<{ Params: { id: string } }>(
    '/:id/decline',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      request.log.info({ action: 'booking.decline', bookingId: id, inspectorId: user.id }, 'decline booking');
      const result = await BookingService.decline(user.id, id);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'DECLINE_FAILED', message: result.error },
        });
      }

      return { data: { message: 'Booking declined' }, error: null };
    }
  );

  // PUT /api/v1/bookings/:id/cancel [client only]
  fastify.put<{ Params: { id: string } }>(
    '/:id/cancel',
    { preHandler: [fastify.authenticate, fastify.requireRole('client')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      request.log.info({ action: 'booking.cancel', bookingId: id, clientId: user.id }, 'cancel booking');
      const result = await BookingService.cancel(user.id, id);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'CANCEL_FAILED', message: result.error },
        });
      }

      return { data: { booking: result.booking }, error: null };
    }
  );

  // PUT /api/v1/bookings/:id/start [inspector only]
  fastify.put<{ Params: { id: string } }>(
    '/:id/start',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const result = await BookingService.start(user.id, id);

      if (result.error) {
        return reply.status(400).send({
          data: null,
          error: { code: 'START_FAILED', message: result.error },
        });
      }

      return { data: { booking: result.booking }, error: null };
    }
  );
}
