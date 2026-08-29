import type { FastifyInstance } from 'fastify';
import { PaymentService } from '../services/PaymentService.js';
import { getUser } from '../utils/getUser.js';

interface UpdatePayoutBody {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

interface SetStatusBody {
  status: 'unpaid' | 'pending' | 'paid';
  amount?: number | null;
  notes?: string | null;
}

export default async function paymentsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/payments/company-account — any authenticated user
  fastify.get('/company-account', { preHandler: [fastify.authenticate] }, async (_request, _reply) => {
    return { data: { account: PaymentService.getCompanyAccount() }, error: null };
  });

  // GET /api/v1/payments/inspector/me — inspector reads own payout account
  fastify.get(
    '/inspector/me',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, _reply) => {
      const user = getUser(request);
      const result = await PaymentService.getInspectorPayout(user.id);
      if (result.error) {
        return { data: null, error: { code: 'PAYOUT_ERROR', message: result.error } };
      }
      return { data: { payout: result.payout }, error: null };
    }
  );

  // PUT /api/v1/payments/inspector/me
  fastify.put<{ Body: UpdatePayoutBody }>(
    '/inspector/me',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const { bankName, accountNumber, accountName } = request.body || ({} as UpdatePayoutBody);

      if (!bankName?.trim() || !accountNumber?.trim() || !accountName?.trim()) {
        return reply.status(400).send({
          data: null,
          error: { code: 'INVALID_PAYOUT', message: 'bankName, accountNumber, and accountName are required' },
        });
      }

      const result = await PaymentService.updateInspectorPayout(user.id, { bankName, accountNumber, accountName });
      if (result.error) {
        return reply.status(400).send({ data: null, error: { code: 'PAYOUT_UPDATE_FAILED', message: result.error } });
      }
      return { data: { payout: result.payout }, error: null };
    }
  );

  // GET /api/v1/payments/bookings/:id — admin, or client/inspector for own booking
  fastify.get<{ Params: { id: string } }>(
    '/bookings/:id',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const result = await PaymentService.getBookingPayment(user, id);
      if (result.error) {
        return reply.status(result.error === 'Access denied' ? 403 : 404).send({
          data: null,
          error: { code: 'PAYMENT_ERROR', message: result.error },
        });
      }
      return { data: { payment: result.payment }, error: null };
    }
  );

  // POST /api/v1/payments/bookings/:id/receipt — client uploads receipt (multipart)
  fastify.post<{ Params: { id: string } }>(
    '/bookings/:id/receipt',
    { preHandler: [fastify.authenticate, fastify.requireRole('client')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({
          data: null,
          error: { code: 'NO_FILE', message: 'No file uploaded' },
        });
      }

      const buffer = await data.toBuffer();
      const result = await PaymentService.uploadClientReceipt(user.id, id, {
        buffer,
        mimeType: data.mimetype,
        originalName: data.filename,
      });

      if (result.error) {
        const status = result.error === 'Access denied' ? 403 : result.error === 'Booking not found' ? 404 : 400;
        return reply.status(status).send({
          data: null,
          error: { code: 'RECEIPT_UPLOAD_FAILED', message: result.error },
        });
      }

      return { data: { path: result.path }, error: null };
    }
  );

  // PUT /api/v1/payments/bookings/:id/client-status — admin
  fastify.put<{ Params: { id: string }; Body: SetStatusBody }>(
    '/bookings/:id/client-status',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const { status, amount, notes } = request.body;

      if (!['unpaid', 'pending', 'paid'].includes(status)) {
        return reply.status(400).send({ data: null, error: { code: 'INVALID_STATUS', message: 'Invalid status' } });
      }

      const result = await PaymentService.setClientPaymentStatus(user.id, id, status, {
        ...(amount !== undefined ? { amount } : {}),
        ...(notes !== undefined ? { notes } : {}),
      });

      if (result.error) {
        return reply.status(400).send({ data: null, error: { code: 'STATUS_UPDATE_FAILED', message: result.error } });
      }
      return { data: { ok: true }, error: null };
    }
  );

  // PUT /api/v1/payments/bookings/:id/inspector-status — admin
  fastify.put<{ Params: { id: string }; Body: SetStatusBody }>(
    '/bookings/:id/inspector-status',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const user = getUser(request);
      const { id } = request.params;
      const { status, amount, notes } = request.body;

      if (!['unpaid', 'pending', 'paid'].includes(status)) {
        return reply.status(400).send({ data: null, error: { code: 'INVALID_STATUS', message: 'Invalid status' } });
      }

      const result = await PaymentService.setInspectorPayoutStatus(user.id, id, status, {
        ...(amount !== undefined ? { amount } : {}),
        ...(notes !== undefined ? { notes } : {}),
      });

      if (result.error) {
        return reply.status(400).send({ data: null, error: { code: 'STATUS_UPDATE_FAILED', message: result.error } });
      }
      return { data: { ok: true }, error: null };
    }
  );
}
