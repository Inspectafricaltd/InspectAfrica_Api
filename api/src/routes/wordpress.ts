import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, inspectorProfiles, notificationLogs } from '../db/schema.js';
import { z } from 'zod';
import { timingSafeEqualString } from '../lib/timingSafe.js';

// WordPress webhook validation schemas
const certIssuedSchema = z.object({
  achi_number: z.string(),
  user_id: z.number(),
  full_name: z.string(),
  email: z.string().email(),
  // The WordPress plugin sends `null` (not omitted) when the user has no
  // phone on file (`get_user_meta(...) ?: null`) — .optional() alone only
  // allows the field to be missing, not explicitly null. Every real
  // cert_issued webhook from a user without a phone number failed Zod
  // validation with "Expected string, received null" until this was added.
  phone: z.string().nullable().optional(),
  certification_type: z.string().default('Home Inspector'),
  issued_at: z.string(),
  expires_at: z.string(),
  // Same gap as `phone` above: the WordPress plugin sends `null` (not
  // omitted) for a certificate with no originating course — e.g. a
  // "grandfathered" credential granted before the LearnPress completion
  // pipeline existed. .optional() alone only allows the key to be missing.
  lms_course_id: z.number().nullable().optional(),
});

const certExpiredSchema = z.object({
  achi_number: z.string(),
  user_id: z.number(),
  reason: z.enum(['expired', 'suspended']),
});

const certUpdatedSchema = z.object({
  achi_number: z.string(),
  user_id: z.number(),
  changes: z.record(z.unknown()),
});

// API Key verification middleware
async function verifyWordPressApiKey(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const apiKeyHeader = request.headers['x-wp-api-key'];
  const apiKey = typeof apiKeyHeader === 'string' ? apiKeyHeader : '';

  if (!apiKey) {
    reply.status(401).send({
      data: null,
      error: { code: 'UNAUTHORIZED', message: 'Missing API key' },
    });
    return;
  }

  const expectedKey = process.env.WP_API_KEY;
  if (!expectedKey || !timingSafeEqualString(apiKey, expectedKey)) {
    reply.status(403).send({
      data: null,
      error: { code: 'FORBIDDEN', message: 'Invalid API key' },
    });
    return;
  }
}

export default async function wordpressRoutes(fastify: FastifyInstance) {
  // POST /api/v1/wordpress/webhook/cert-issued
  fastify.post(
    '/webhook/cert-issued',
    {
      preHandler: [verifyWordPressApiKey],
      schema: {
        body: {
          type: 'object',
          required: ['achi_number', 'user_id', 'full_name', 'email', 'issued_at', 'expires_at'],
        },
      },
    },
    async (request, reply) => {
      const body = certIssuedSchema.parse(request.body);

      const [existingUser] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.email, body.email))
        .limit(1);

      let userId: string;

      if (existingUser) {
        userId = existingUser.id;
        try {
          // Clients don't take certifications — if an existing account of
          // any role gets ACHI-certified, it becomes an inspector account.
          // A non-inspector user has no inspector_profiles row yet (only
          // inspector accounts do), so this must be an upsert, not a bare
          // UPDATE — the previous UPDATE-only version silently matched zero
          // rows for a client account and still reported success=true.
          if (existingUser.role !== 'inspector') {
            await db.update(users).set({ role: 'inspector' }).where(eq(users.id, userId));
          }

          await db
            .insert(inspectorProfiles)
            .values({
              userId,
              achiNumber:    body.achi_number,
              achiStatus:    'certified',
              achiIssuedAt:  new Date(body.issued_at),
              achiExpiresAt: new Date(body.expires_at),
              isActive:      true,
            })
            .onConflictDoUpdate({
              target: inspectorProfiles.userId,
              set: {
                achiNumber:    body.achi_number,
                achiStatus:    'certified',
                achiIssuedAt:  new Date(body.issued_at),
                achiExpiresAt: new Date(body.expires_at),
                isActive:      true,
                updatedAt:     new Date(),
              },
            });
        } catch (err) {
          fastify.log.error({ err, body }, 'Failed to upsert inspector profile');
          return reply.status(500).send({
            data: null,
            error: { code: 'UPDATE_FAILED', message: 'Failed to update inspector profile' },
          });
        }
      } else {
        // Create new user + inspector profile in a transaction
        try {
          await db.transaction(async (tx) => {
            const inserted = await tx
              .insert(users)
              .values({
                email:    body.email,
                fullName: body.full_name,
                phone:    body.phone || null,
                role:     'inspector',
              })
              .returning({ id: users.id });

            const newUser = inserted[0];
            if (!newUser) throw new Error('user insert returned no row');
            userId = newUser.id;

            await tx.insert(inspectorProfiles).values({
              userId,
              achiNumber:    body.achi_number,
              achiStatus:    'certified',
              achiIssuedAt:  new Date(body.issued_at),
              achiExpiresAt: new Date(body.expires_at),
              isActive:      true,
            });
          });
        } catch (err) {
          fastify.log.error({ err, body }, 'Failed to create user/profile');
          return reply.status(500).send({
            data: null,
            error: { code: 'USER_CREATE_FAILED', message: 'Failed to create user' },
          });
        }
        userId = userId!;
      }

      // Log sync (notification_logs.type allows any text — using a synthetic type)
      try {
        await db.insert(notificationLogs).values({
          type:           'cert_issued',
          recipientId:    userId,
          recipientEmail: body.email,
          entityType:     'certificate',
          status:         'sent',
        });
      } catch (err) {
        fastify.log.warn({ err }, 'failed to log cert_issued notification');
      }

      return {
        data: {
          success:     true,
          user_id:     userId,
          achi_number: body.achi_number,
        },
        error: null,
      };
    }
  );

  // POST /api/v1/wordpress/webhook/cert-expired
  fastify.post(
    '/webhook/cert-expired',
    { preHandler: [verifyWordPressApiKey] },
    async (request, reply) => {
      const body = certExpiredSchema.parse(request.body);

      const [profile] = await db
        .select({ id: inspectorProfiles.id, userId: inspectorProfiles.userId })
        .from(inspectorProfiles)
        .where(eq(inspectorProfiles.achiNumber, body.achi_number))
        .limit(1);

      if (!profile) {
        return reply.status(404).send({
          data: null,
          error: { code: 'NOT_FOUND', message: 'Inspector not found' },
        });
      }

      const newStatus = body.reason === 'suspended' ? 'suspended' : 'expired';
      try {
        await db
          .update(inspectorProfiles)
          .set({
            achiStatus: newStatus,
            isActive:   false,
            updatedAt:  new Date(),
          })
          .where(eq(inspectorProfiles.id, profile.id));
      } catch (err) {
        fastify.log.error({ err, body }, 'Failed to update status');
        return reply.status(500).send({
          data: null,
          error: { code: 'UPDATE_FAILED', message: 'Failed to update status' },
        });
      }

      return {
        data: {
          success:     true,
          achi_number: body.achi_number,
          new_status:  newStatus,
        },
        error: null,
      };
    }
  );

  // POST /api/v1/wordpress/webhook/cert-updated
  fastify.post(
    '/webhook/cert-updated',
    { preHandler: [verifyWordPressApiKey] },
    async (request, reply) => {
      const body = certUpdatedSchema.parse(request.body);

      const [profile] = await db
        .select({ id: inspectorProfiles.id, userId: inspectorProfiles.userId })
        .from(inspectorProfiles)
        .where(eq(inspectorProfiles.achiNumber, body.achi_number))
        .limit(1);

      if (!profile) {
        return reply.status(404).send({
          data: null,
          error: { code: 'NOT_FOUND', message: 'Inspector not found' },
        });
      }

      // Note: original code wrote `last_synced_at` which doesn't exist in schema —
      // bumping `updated_at` instead.
      await db
        .update(inspectorProfiles)
        .set({ updatedAt: new Date() })
        .where(eq(inspectorProfiles.id, profile.id));

      return {
        data: { success: true, achi_number: body.achi_number },
        error: null,
      };
    }
  );

  // POST /api/v1/wordpress/webhook/user-enrolled
  fastify.post(
    '/webhook/user-enrolled',
    { preHandler: [verifyWordPressApiKey] },
    async (request, reply) => {
      const body = request.body as {
        email: string;
        full_name: string;
        course_id: number;
        course_name: string;
      };

      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, body.email))
        .limit(1);

      if (existingUser) {
        return {
          data: { success: true, message: 'User already exists' },
          error: null,
        };
      }

      try {
        await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(users)
            .values({
              email:    body.email,
              fullName: body.full_name,
              role:     'inspector',
            })
            .returning({ id: users.id });
          const newUser = inserted[0];
          if (!newUser) throw new Error('user insert returned no row');

          await tx.insert(inspectorProfiles).values({
            userId:     newUser.id,
            achiStatus: 'candidate',
          });
        });
      } catch (err) {
        fastify.log.error({ err, body }, 'Failed to create candidate');
        return reply.status(500).send({
          data: null,
          error: { code: 'CREATE_FAILED', message: 'Failed to create candidate' },
        });
      }

      return {
        data: { success: true, message: 'Candidate created' },
        error: null,
      };
    }
  );

  // GET /api/v1/wordpress/health
  fastify.get(
    '/health',
    { preHandler: [verifyWordPressApiKey] },
    async () => {
      return {
        data: {
          status: 'ok',
          timestamp: new Date().toISOString(),
          version: '1.0.0',
        },
        error: null,
      };
    }
  );
}
