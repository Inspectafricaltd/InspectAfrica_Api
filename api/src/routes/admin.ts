import type { FastifyInstance } from 'fastify';
import { AdminService } from '../services/AdminService.js';
import { BookingService } from '../services/BookingService.js';
import { RevisionService } from '../services/RevisionService.js';
import { getUser } from '../utils/getUser.js';
import { db } from '../db/index.js';
import { bookings, users } from '../db/schema.js';
import { getSignedDownloadUrl } from '../lib/storage.js';
import { aliasedTable, desc, eq, isNotNull, ne, or } from 'drizzle-orm';

/** Must match PaymentService's bucket — receipts are written there on upload. */
const RECEIPTS_BUCKET = 'booking-receipts';
const RECEIPT_URL_TTL = 3600;

interface PaymentsQuery {
  filter?: 'pending' | 'confirmed' | 'all';
}

interface ListInspectorsQuery {
  // 'expired' is the schema's fourth achi_status. Leaving it out here meant an
  // expired inspector matched no tab on the Inspectors screen, so the tabs
  // never summed to the dashboard's total.
  status?: 'candidate' | 'certified' | 'suspended' | 'expired';
  page?: number;
  limit?: number;
}

interface SuspendBody {
  reason?: string;
}

interface ResolveFlagBody {
  action: 'approve' | 'request_revision';
  notes?: string;
}

interface NotificationQuery {
  type?: string;
  recipientId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

interface ListClientsQuery {
  status?: 'active' | 'suspended' | 'pending' | 'invited';
  page?: number;
  limit?: number;
}

interface AuditLogQuery {
  page?: number;
  limit?: number;
  entityType?: string;
  action?: string;
  changedBy?: string;
  inspectionId?: string;
  from?: string;
  to?: string;
}

export default async function adminRoutes(fastify: FastifyInstance) {
  // All admin routes require authenticate + admin role
  const adminOnly = { preHandler: [fastify.authenticate, fastify.requireRole('admin')] };

  // GET /api/v1/admin/dashboard
  fastify.get('/dashboard', adminOnly, async (_request, _reply) => {
    const result = await AdminService.getDashboard();
    return { data: result, error: null };
  });

  // GET /api/v1/admin/inspectors
  fastify.get<{ Querystring: ListInspectorsQuery }>('/inspectors', adminOnly, async (request, _reply) => {
    const { status, page, limit } = request.query;
    const result = await AdminService.listInspectors({ status, page, limit });
    return { data: result, error: null };
  });

  // GET /api/v1/admin/inspectors/:id
  fastify.get<{ Params: { id: string } }>('/inspectors/:id', adminOnly, async (request, reply) => {
    const { id } = request.params;
    const result = await AdminService.getInspectorDetail(id);
    if (result.error) {
      return reply.status(404).send({ data: null, error: { code: 'INSPECTOR_NOT_FOUND', message: result.error } });
    }
    return { data: { inspector: result.inspector }, error: null };
  });

  // PUT /api/v1/admin/inspectors/:id/suspend
  fastify.put<{ Params: { id: string }; Body: SuspendBody }>('/inspectors/:id/suspend', adminOnly, async (request, reply) => {
    const user = getUser(request);
    const { id } = request.params;
    const { reason } = request.body || {};
    request.log.info({ action: 'admin.suspend', inspectorId: id, adminId: user.id, reason }, 'suspend inspector');

    const result = await AdminService.suspendInspector(user.id, id, reason);

    if (result.error) {
      return reply.status(400).send({
        data: null,
        error: { code: 'SUSPEND_FAILED', message: result.error },
      });
    }

    return { data: { inspector: result.inspector }, error: null };
  });

  // PUT /api/v1/admin/inspectors/:id/reinstate
  fastify.put<{ Params: { id: string }; Body: SuspendBody }>('/inspectors/:id/reinstate', adminOnly, async (request, reply) => {
    const user = getUser(request);
    const { id } = request.params;
    const { reason } = request.body || {};

    const result = await AdminService.reinstateInspector(user.id, id, reason);

    if (result.error) {
      return reply.status(400).send({
        data: null,
        error: { code: 'REINSTATE_FAILED', message: result.error },
      });
    }

    return { data: { inspector: result.inspector }, error: null };
  });

  // GET /api/v1/admin/bookings/open — open bookings with wait times
  fastify.get('/bookings/open', adminOnly, async (_request, _reply) => {
    const result = await BookingService.listOpenForAdmin();
    if (result.error) {
      return { data: null, error: { code: 'OPEN_BOOKINGS_ERROR', message: result.error } };
    }
    return { data: { bookings: result.bookings }, error: null };
  });

  // GET /api/v1/admin/reports/queue
  fastify.get<{ Querystring: { page?: number; limit?: number } }>('/reports/queue', adminOnly, async (request, _reply) => {
    const { page, limit } = request.query;
    const result = await AdminService.getReviewQueue({ page, limit });
    return { data: result, error: null };
  });

  // GET /api/v1/admin/flags
  // GET /api/v1/admin/attention — one count per queue currently waiting on an
  // admin. Both the notification bell and the dashboard read this.
  fastify.get('/attention', adminOnly, async (_request, _reply) => {
    const attention = await AdminService.getAttention();
    return { data: { attention }, error: null };
  });

  fastify.get('/flags', adminOnly, async (_request, _reply) => {
    const flags = await AdminService.getOpenFlags();
    return { data: { flags }, error: null };
  });

  // PUT /api/v1/admin/flags/:inspectionId/resolve
  fastify.put<{ Params: { inspectionId: string }; Body: ResolveFlagBody }>('/flags/:inspectionId/resolve', adminOnly, async (request, reply) => {
    const user = getUser(request);
    const { inspectionId } = request.params;
    const { action, notes } = request.body;

    const result = await AdminService.resolveFlag(user.id, inspectionId, action, notes);

    if (result.error) {
      return reply.status(400).send({
        data: null,
        error: { code: 'RESOLVE_FAILED', message: result.error },
      });
    }

    return { data: { inspection: result.inspection }, error: null };
  });

  // GET /api/v1/admin/revenue
  fastify.get('/revenue', adminOnly, async (_request, _reply) => {
    return { data: { message: 'Revenue reporting coming in a future release' }, error: null };
  });

  // GET /api/v1/admin/notifications
  fastify.get<{ Querystring: NotificationQuery }>('/notifications', adminOnly, async (request, _reply) => {
    const { type, recipientId, status, page, limit } = request.query;
    const result = await AdminService.getNotificationLog({
      type,
      recipientId,
      status,
      page,
      limit,
    });
    return { data: result, error: null };
  });

  // GET /api/v1/admin/clients
  fastify.get<{ Querystring: ListClientsQuery }>('/clients', adminOnly, async (request, _reply) => {
    const { status, page, limit } = request.query;
    const result = await AdminService.listClients({ status, page, limit });
    return { data: result, error: null };
  });

  // GET /api/v1/admin/clients/:id
  fastify.get<{ Params: { id: string } }>('/clients/:id', adminOnly, async (request, reply) => {
    const { id } = request.params;
    const result = await AdminService.getClient(id);
    if (result.error) {
      return reply.status(404).send({ data: null, error: { code: 'CLIENT_NOT_FOUND', message: result.error } });
    }
    return { data: { client: result.client }, error: null };
  });

  // PUT /api/v1/admin/clients/:id/suspend
  fastify.put<{ Params: { id: string }; Body: SuspendBody }>('/clients/:id/suspend', adminOnly, async (request, reply) => {
    const user = getUser(request);
    const { id } = request.params;
    const { reason } = request.body || {};
    const result = await AdminService.suspendClient(user.id, id, reason);
    if (result.error) {
      return reply.status(400).send({ data: null, error: { code: 'SUSPEND_FAILED', message: result.error } });
    }
    return { data: { client: result.client }, error: null };
  });

  // PUT /api/v1/admin/clients/:id/reinstate
  fastify.put<{ Params: { id: string }; Body: SuspendBody }>('/clients/:id/reinstate', adminOnly, async (request, reply) => {
    const user = getUser(request);
    const { id } = request.params;
    const { reason } = request.body || {};
    const result = await AdminService.reinstateClient(user.id, id, reason);
    if (result.error) {
      return reply.status(400).send({ data: null, error: { code: 'REINSTATE_FAILED', message: result.error } });
    }
    return { data: { client: result.client }, error: null };
  });

  // POST /api/v1/admin/clients/invite
  fastify.post<{ Body: { email: string; fullName?: string } }>('/clients/invite', adminOnly, async (request, reply) => {
    const { email, fullName } = request.body || {};
    if (!email || !email.includes('@')) {
      return reply.status(400).send({ data: null, error: { code: 'INVALID_EMAIL', message: 'Valid email required' } });
    }
    const result = await AdminService.inviteClient(getUser(request).id, email.trim().toLowerCase(), fullName?.trim());
    if (result.error) {
      return reply.status(400).send({ data: null, error: { code: 'INVITE_FAILED', message: result.error } });
    }
    return reply.status(201).send({ data: { client: result.client }, error: null });
  });

  // GET /api/v1/admin/payments?filter=pending|confirmed|all
  //
  // Defaults to `pending`, which is the queue the dashboard's attention tile
  // counts — the two predicates have to stay identical or the badge and the
  // list disagree. The other two filters exist because a confirmed payment used
  // to leave the queue and take its receipt with it: there was no admin screen
  // anywhere that could show the proof for a booking once it was marked paid.
  // (/admin/bookings/open lists unassigned bookings, which by design cannot
  // have a payment yet, so it is no help here.)
  fastify.get<{ Querystring: PaymentsQuery }>('/payments', adminOnly, async (request, _reply) => {
    const filter = request.query?.filter ?? 'pending';
    const clientUser  = aliasedTable(users, 'pmt_client');
    const inspUser    = aliasedTable(users, 'pmt_insp');

    const whereExpr =
      filter === 'confirmed'
        ? or(
            eq(bookings.clientPaymentStatus, 'paid'),
            eq(bookings.inspectorPayoutStatus, 'paid'),
          )
        : filter === 'all'
          // Anything that has seen payment activity — a receipt on file, or a
          // status moved off the 'unpaid' default on either side.
          ? or(
              isNotNull(bookings.clientReceiptPath),
              ne(bookings.clientPaymentStatus, 'unpaid'),
              ne(bookings.inspectorPayoutStatus, 'unpaid'),
            )
          : or(
              eq(bookings.clientPaymentStatus, 'pending'),
              eq(bookings.inspectorPayoutStatus, 'pending'),
            );

    const rows = await db
      .select({
        bookingId:              bookings.id,
        propertyAddress:        bookings.propertyAddress,
        inspectionType:         bookings.inspectionType,
        status:                 bookings.status,
        clientPaymentStatus:    bookings.clientPaymentStatus,
        inspectorPaymentStatus: bookings.inspectorPayoutStatus,
        clientPaymentAmount:    bookings.clientPaymentAmount,
        inspectorPaymentAmount: bookings.inspectorPayoutAmount,
        clientReceiptPath:      bookings.clientReceiptPath,
        createdAt:              bookings.createdAt,
        clientId:               clientUser.id,
        clientName:             clientUser.fullName,
        inspectorId:            inspUser.id,
        inspectorName:          inspUser.fullName,
      })
      .from(bookings)
      .leftJoin(clientUser,  eq(clientUser.id,  bookings.clientId))
      .leftJoin(inspUser,    eq(inspUser.id,    bookings.inspectorId))
      .where(whereExpr)
      .orderBy(desc(bookings.createdAt))
      .limit(100);

    // Sign the receipts so the admin can actually look at the proof they are
    // being asked to confirm. Without this the queue offered a Confirm button
    // and no way to see what was paid.
    const receiptUrls = await Promise.all(
      rows.map(r =>
        r.clientReceiptPath
          ? getSignedDownloadUrl(RECEIPTS_BUCKET, r.clientReceiptPath, RECEIPT_URL_TTL)
          : Promise.resolve(null),
      ),
    );

    return {
      data: {
        payments: rows.map((r, i) => ({
          bookingId:              r.bookingId,
          propertyAddress:        r.propertyAddress,
          inspectionType:         r.inspectionType,
          bookingStatus:          r.status,
          clientPaymentStatus:    r.clientPaymentStatus,
          inspectorPaymentStatus: r.inspectorPaymentStatus,
          clientPaymentAmount:    r.clientPaymentAmount,
          inspectorPaymentAmount: r.inspectorPaymentAmount,
          clientReceiptUrl:       receiptUrls[i],
          createdAt:              r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
          clientId:               r.clientId,
          clientName:             r.clientName,
          inspectorId:            r.inspectorId,
          inspectorName:          r.inspectorName,
        })),
      },
      error: null,
    };
  });

  // GET /api/v1/admin/audit-log — paginated revision events across all inspections
  fastify.get<{ Querystring: AuditLogQuery }>('/audit-log', adminOnly, async (request, _reply) => {
    const { page, limit, entityType, action, changedBy, inspectionId, from, to } = request.query;
    const result = await RevisionService.listAll({
      page,
      limit,
      entityType,
      action,
      changedBy,
      inspectionId,
      from,
      to,
    });
    return { data: result, error: null };
  });
}
