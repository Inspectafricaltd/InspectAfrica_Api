import type { FastifyInstance } from 'fastify';
import { eq, desc, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { tokenLedger, tokenPurchases, users } from '../db/schema.js';
import { getUser } from '../utils/getUser.js';
import { TOKEN_CONFIG } from '../config/tokens.js';
import { broadcast, broadcastToRole } from '../lib/eventBus.js';
import { uploadFile, getSignedDownloadUrl } from '../lib/storage.js';
import { NotificationService } from '../services/NotificationService.js';

export default async function tokensRoutes(fastify: FastifyInstance) {

  // ─── Inspector endpoints ───────────────────────────────────────────────────

  // GET /solo/tokens/balance
  fastify.get(
    '/solo/tokens/balance',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, _reply) => {
      const user = getUser(request);
      const rows = await db
        .select({ delta: tokenLedger.delta, kind: tokenLedger.kind })
        .from(tokenLedger)
        .where(eq(tokenLedger.userId, user.id));

      const balance = rows.reduce((s, r) => s + r.delta, 0);
      const lifetimePurchased = rows.filter(r => r.kind === 'purchase').reduce((s, r) => s + r.delta, 0);
      const lifetimeConsumed = Math.abs(rows.filter(r => r.kind === 'consume').reduce((s, r) => s + r.delta, 0));
      const bonusReceived = rows.filter(r => r.kind === 'signup_bonus' || r.kind === 'admin_grant').reduce((s, r) => s + r.delta, 0);

      return {
        data: { balance, lifetimePurchased, lifetimeConsumed, bonusReceived, config: TOKEN_CONFIG },
        error: null,
      };
    }
  );

  // GET /solo/tokens/ledger
  fastify.get<{ Querystring: { limit?: number } }>(
    '/solo/tokens/ledger',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, _reply) => {
      const user = getUser(request);
      const limit = Math.min(request.query.limit ?? 50, 200);

      const rows = await db
        .select({
          id:            tokenLedger.id,
          delta:         tokenLedger.delta,
          kind:          tokenLedger.kind,
          note:          tokenLedger.note,
          created_at:    tokenLedger.createdAt,
          inspection_id: tokenLedger.inspectionId,
          purchase_id:   tokenLedger.purchaseId,
        })
        .from(tokenLedger)
        .where(eq(tokenLedger.userId, user.id))
        .orderBy(desc(tokenLedger.createdAt))
        .limit(limit);

      return { data: { rows }, error: null };
    }
  );

  // POST /solo/tokens/purchases — submit proof of payment
  fastify.post(
    '/solo/tokens/purchases',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ data: null, error: { code: 'NO_FILE', message: 'Proof of payment required' } });
      }

      // quantity is passed as a form field
      const fields = (data as any).fields ?? {};
      const quantity = parseInt(fields.quantity?.value ?? fields.quantity ?? '0', 10);

      if (!quantity || quantity < 1 || quantity > TOKEN_CONFIG.maxTokensPerPurchase) {
        return reply.status(400).send({
          data: null,
          error: { code: 'INVALID_QUANTITY', message: `Quantity must be 1–${TOKEN_CONFIG.maxTokensPerPurchase}` },
        });
      }

      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      if (!allowedTypes.includes(data.mimetype)) {
        return reply.status(400).send({ data: null, error: { code: 'INVALID_TYPE', message: 'JPEG, PNG, WebP, or PDF only' } });
      }

      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of data.file) {
        chunks.push(chunk);
        size += chunk.length;
        if (size > 5 * 1024 * 1024) {
          return reply.status(400).send({ data: null, error: { code: 'FILE_TOO_LARGE', message: 'Max 5 MB' } });
        }
      }

      const buffer = Buffer.concat(chunks);
      const ext = data.mimetype === 'application/pdf' ? 'pdf' : data.mimetype === 'image/png' ? 'png' : 'jpg';
      const proofPath = `${user.id}/${Date.now()}.${ext}`;

      const upload = await uploadFile('token-receipts', proofPath, buffer, {
        contentType: data.mimetype, upsert: false,
      });
      if (!upload.ok) {
        // A storage outage isn't the inspector's fault, and it's worth trying
        // again — say so rather than returning a bare 500 they can only guess at.
        request.log.error({ userId: user.id, proofPath, reason: upload.reason, detail: upload.message }, 'token purchase proof upload failed');
        return upload.reason === 'unavailable'
          ? reply.status(503).send({ data: null, error: { code: 'STORAGE_UNAVAILABLE', message: 'Could not store your proof of payment right now. Please try again in a moment.' } })
          : reply.status(409).send({ data: null, error: { code: 'UPLOAD_CONFLICT', message: 'That file has already been uploaded.' } });
      }

      const amountNgn = quantity * TOKEN_CONFIG.pricePerTokenNgn;
      try {
        const [purchase] = await db
          .insert(tokenPurchases)
          .values({
            userId:    user.id,
            quantity,
            amountNgn,
            proofPath,
            status:    'pending_review',
          })
          .returning({
            id:         tokenPurchases.id,
            quantity:   tokenPurchases.quantity,
            amount_ngn: tokenPurchases.amountNgn,
            status:     tokenPurchases.status,
            created_at: tokenPurchases.createdAt,
          });

        // Notify all admins about the new purchase request
        try {
          const [requester] = await db
            .select({ fullName: users.fullName })
            .from(users)
            .where(eq(users.id, user.id))
            .limit(1);

          const admins = await db
            .select({ id: users.id, email: users.email, fullName: users.fullName })
            .from(users)
            .where(eq(users.role, 'admin'));

          // Live badge/toast for admins — previously email-only, so admins
          // had no signal until they happened to check inbox or the page.
          broadcastToRole('admin', 'token_purchase.requested', {
            inspectorName: requester?.fullName ?? user.email,
            quantity: purchase!.quantity,
          });

          for (const admin of admins) {
            NotificationService.send('token_purchase_requested', {
              recipientId: admin.id,
              recipientEmail: admin.email,
              data: {
                adminName: admin.fullName,
                inspectorName: requester?.fullName ?? user.email,
                inspectorEmail: user.email,
                quantity: String(purchase!.quantity),
                amountNgn: String(purchase!.amount_ngn),
              },
              entityType: 'token_purchase',
              entityId: purchase!.id,
            });
          }
        } catch (notifyErr) {
          // non-blocking — fire-and-forget
          void notifyErr;
        }

        return reply.status(201).send({ data: { purchase }, error: null });
      } catch {
        return reply.status(500).send({ data: null, error: { code: 'INSERT_FAILED', message: 'Failed to create purchase request' } });
      }
    }
  );

  // GET /solo/tokens/purchases — inspector's own purchase history
  fastify.get(
    '/solo/tokens/purchases',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, _reply) => {
      const user = getUser(request);
      const purchases = await db
        .select({
          id:           tokenPurchases.id,
          quantity:     tokenPurchases.quantity,
          amount_ngn:   tokenPurchases.amountNgn,
          status:       tokenPurchases.status,
          review_notes: tokenPurchases.reviewNotes,
          created_at:   tokenPurchases.createdAt,
          reviewed_at:  tokenPurchases.reviewedAt,
        })
        .from(tokenPurchases)
        .where(eq(tokenPurchases.userId, user.id))
        .orderBy(desc(tokenPurchases.createdAt))
        .limit(50);

      return { data: { purchases }, error: null };
    }
  );

  // ─── Admin endpoints ───────────────────────────────────────────────────────

  // GET /admin/token-purchases
  fastify.get<{ Querystring: { status?: string } }>(
    '/admin/token-purchases',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, _reply) => {
      const { status } = request.query;

      const rows = await db
        .select({
          id:           tokenPurchases.id,
          quantity:     tokenPurchases.quantity,
          amount_ngn:   tokenPurchases.amountNgn,
          status:       tokenPurchases.status,
          proof_path:   tokenPurchases.proofPath,
          review_notes: tokenPurchases.reviewNotes,
          created_at:   tokenPurchases.createdAt,
          reviewed_at:  tokenPurchases.reviewedAt,
          user_id:      users.id,
          user_email:   users.email,
          user_name:    users.fullName,
        })
        .from(tokenPurchases)
        .leftJoin(users, eq(users.id, tokenPurchases.userId))
        .where(status ? eq(tokenPurchases.status, status as 'pending_review' | 'approved' | 'rejected') : undefined)
        .orderBy(desc(tokenPurchases.createdAt))
        .limit(100);

      // Generate signed URLs for proof images and reshape to old contract
      const purchases = await Promise.all(rows.map(async (r) => {
        let proofUrl: string | null = null;
        if (r.proof_path) {
          const isLegacy = r.proof_path.startsWith('token-proofs/');
          proofUrl = await getSignedDownloadUrl(isLegacy ? 'avatars' : 'token-receipts', r.proof_path, 3600);
        }
        return {
          id:           r.id,
          quantity:     r.quantity,
          amount_ngn:   r.amount_ngn,
          status:       r.status,
          proof_path:   r.proof_path,
          review_notes: r.review_notes,
          created_at:   r.created_at,
          reviewed_at:  r.reviewed_at,
          user:         r.user_id ? { id: r.user_id, email: r.user_email, full_name: r.user_name } : null,
          proofUrl,
        };
      }));

      return { data: { purchases }, error: null };
    }
  );

  // POST /admin/token-purchases/:id/approve
  fastify.post<{ Params: { id: string }; Body: { notes?: string } }>(
    '/admin/token-purchases/:id/approve',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const admin = getUser(request);
      const { id } = request.params;

      const [purchase] = await db
        .select({ id: tokenPurchases.id, userId: tokenPurchases.userId, quantity: tokenPurchases.quantity, status: tokenPurchases.status })
        .from(tokenPurchases)
        .where(eq(tokenPurchases.id, id))
        .limit(1);

      if (!purchase) return reply.status(404).send({ data: null, error: { code: 'NOT_FOUND', message: 'Purchase not found' } });
      if (purchase.status !== 'pending_review') return reply.status(400).send({ data: null, error: { code: 'ALREADY_REVIEWED', message: 'Already reviewed' } });

      await db.transaction(async (tx) => {
        await tx
          .update(tokenPurchases)
          .set({
            status:      'approved',
            reviewedBy:  admin.id,
            reviewedAt:  new Date(),
            reviewNotes: request.body?.notes ?? null,
          })
          .where(eq(tokenPurchases.id, id));

        await tx.insert(tokenLedger).values({
          userId:     purchase.userId,
          delta:      purchase.quantity,
          kind:       'purchase',
          purchaseId: id,
          note:       'Approved by admin',
        });
      });

      broadcast(purchase.userId, 'token_purchase.approved', { quantity: purchase.quantity });

      // Email the inspector about approval
      try {
        const [inspector] = await db
          .select({ id: users.id, email: users.email, fullName: users.fullName })
          .from(users)
          .where(eq(users.id, purchase.userId))
          .limit(1);

        if (inspector) {
          NotificationService.send('token_purchase_approved', {
            recipientId: inspector.id,
            recipientEmail: inspector.email,
            data: { inspectorName: inspector.fullName, quantity: String(purchase.quantity) },
            entityType: 'token_purchase',
            entityId: id,
          });
        }
      } catch (notifyErr) { void notifyErr; }

      return { data: { approved: true }, error: null };
    }
  );

  // POST /admin/token-purchases/:id/reject
  fastify.post<{ Params: { id: string }; Body: { notes: string } }>(
    '/admin/token-purchases/:id/reject',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const admin = getUser(request);
      const { id } = request.params;

      const [purchase] = await db
        .select({ userId: tokenPurchases.userId, status: tokenPurchases.status, quantity: tokenPurchases.quantity, amountNgn: tokenPurchases.amountNgn })
        .from(tokenPurchases)
        .where(eq(tokenPurchases.id, id))
        .limit(1);

      if (!purchase) return reply.status(404).send({ data: null, error: { code: 'NOT_FOUND', message: 'Purchase not found' } });
      if (purchase.status !== 'pending_review') return reply.status(400).send({ data: null, error: { code: 'ALREADY_REVIEWED', message: 'Already reviewed' } });

      await db
        .update(tokenPurchases)
        .set({
          status:      'rejected',
          reviewedBy:  admin.id,
          reviewedAt:  new Date(),
          reviewNotes: request.body.notes,
        })
        .where(eq(tokenPurchases.id, id));

      broadcast(purchase.userId, 'token_purchase.rejected', { notes: request.body.notes });

      // Email the inspector about rejection
      try {
        const [inspector] = await db
          .select({ id: users.id, email: users.email, fullName: users.fullName })
          .from(users)
          .where(eq(users.id, purchase.userId))
          .limit(1);

        if (inspector) {
          NotificationService.send('token_purchase_rejected', {
            recipientId: inspector.id,
            recipientEmail: inspector.email,
            data: {
              inspectorName: inspector.fullName,
              quantity: String(purchase.quantity),
              amountNgn: String(purchase.amountNgn),
              reason: request.body.notes,
            },
            entityType: 'token_purchase',
            entityId: id,
          });
        }
      } catch (notifyErr) { void notifyErr; }

      return { data: { rejected: true }, error: null };
    }
  );

  // POST /admin/users/:userId/tokens/grant
  fastify.post<{ Params: { userId: string }; Body: { quantity: number; note?: string } }>(
    '/admin/users/:userId/tokens/grant',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const admin = getUser(request);
      const { userId } = request.params;
      const { quantity, note } = request.body;

      if (!quantity || quantity < 1) {
        return reply.status(400).send({ data: null, error: { code: 'INVALID_QUANTITY', message: 'Quantity must be ≥ 1' } });
      }

      try {
        await db.insert(tokenLedger).values({
          userId,
          delta:     quantity,
          kind:      'admin_grant',
          grantedBy: admin.id,
          note:      note ?? 'Granted by admin',
        });
      } catch (err) {
        return reply.status(500).send({ data: null, error: { code: 'GRANT_FAILED', message: (err as Error).message } });
      }

      // Email the user about the granted tokens
      try {
        const [recipient] = await db
          .select({ id: users.id, email: users.email, fullName: users.fullName })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        if (recipient) {
          NotificationService.send('token_granted', {
            recipientId: recipient.id,
            recipientEmail: recipient.email,
            data: {
              inspectorName: recipient.fullName,
              quantity: String(quantity),
              note: note ?? 'Granted by admin',
            },
            entityType: 'token_ledger',
            entityId: userId,
          });
        }
      } catch (notifyErr) { void notifyErr; }

      return { data: { granted: true, quantity }, error: null };
    }
  );

  // GET /admin/users/:userId/tokens
  fastify.get<{ Params: { userId: string } }>(
    '/admin/users/:userId/tokens',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, _reply) => {
      const { userId } = request.params;

      const ledger = await db
        .select({
          delta:      tokenLedger.delta,
          kind:       tokenLedger.kind,
          created_at: tokenLedger.createdAt,
          note:       tokenLedger.note,
          granted_by: tokenLedger.grantedBy,
        })
        .from(tokenLedger)
        .where(eq(tokenLedger.userId, userId))
        .orderBy(desc(tokenLedger.createdAt));

      const balance = ledger.reduce((s, r) => s + r.delta, 0);
      const lifetimePurchased = ledger.filter(r => r.kind === 'purchase').reduce((s, r) => s + r.delta, 0);
      const lifetimeConsumed = Math.abs(ledger.filter(r => r.kind === 'consume').reduce((s, r) => s + r.delta, 0));
      const bonusReceived = ledger.filter(r => r.kind === 'signup_bonus' || r.kind === 'admin_grant').reduce((s, r) => s + r.delta, 0);

      return { data: { balance, lifetimePurchased, lifetimeConsumed, bonusReceived, recentRows: ledger.slice(0, 10) }, error: null };
    }
  );
}

// silence unused import — `and`, `sql` retained for future joins/expressions
void and; void sql;
