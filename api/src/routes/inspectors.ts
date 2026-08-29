import type { FastifyInstance } from 'fastify';
import { InspectorService } from '../services/InspectorService.js';
import { getUser } from '../utils/getUser.js';
import { uploadFile, getPublicUrl } from '../lib/storage.js';
import { db } from '../db/index.js';
import { users, bookings } from '../db/schema.js';
import { aliasedTable, desc, eq } from 'drizzle-orm';

interface ListQuery {
  city?: string;
  inspectionType?: string;
  available?: string; // Query string params are always strings
}

interface UpdateProfileBody {
  bio?: string;
  serviceAreas?: string[];
  inspectionTypes?: string[];
  phone?: string;
  bankName?: string;
  accountNumber?: string;
  accountName?: string;
}

export default async function inspectorsRoutes(fastify: FastifyInstance) {
  // GET /api/v1/inspectors [public]
  fastify.get<{ Querystring: ListQuery }>('/', async (request, _reply) => {
    const { city, inspectionType, available } = request.query;
    const result = await InspectorService.list({
      city,
      inspectionType,
      // Only forward `available` when explicitly provided. Coercing missing
      // → false would clash with the default isActive=true filter and
      // return 0 rows.
      ...(available !== undefined ? { available: available === 'true' } : {}),
    });
    return { data: result, error: null };
  });

  // GET /api/v1/inspectors/me [inspector only]
  // IMPORTANT: This must come BEFORE /:id route to avoid matching conflicts
  fastify.get(
    '/me',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const inspector = await InspectorService.getMyProfile(user.id);

      if (!inspector) {
        return reply.status(404).send({
          data: null,
          error: { code: 'PROFILE_NOT_FOUND', message: 'Inspector profile not found' },
        });
      }

      return { data: { inspector }, error: null };
    }
  );

  // GET /api/v1/inspectors/:id [public]
  fastify.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const { id } = request.params;
    const result = await InspectorService.getPublicProfile(id);

    if (!result.inspector) {
      return reply.status(404).send({
        data: null,
        error: { code: 'INSPECTOR_NOT_FOUND', message: 'Inspector not found' },
      });
    }

    return { data: result, error: null };
  });

  // PUT /api/v1/inspectors/me [inspector only]
  fastify.put<{ Body: UpdateProfileBody }>(
    '/me',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const inspector = await InspectorService.updateMyProfile(user.id, request.body);

      if (!inspector) {
        return reply.status(400).send({
          data: null,
          error: { code: 'UPDATE_FAILED', message: 'Failed to update profile' },
        });
      }

      return { data: { inspector }, error: null };
    }
  );

  // GET /api/v1/inspectors/me/stats [inspector only]
  fastify.get(
    '/me/stats',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, _reply) => {
      const user = getUser(request);
      const stats = await InspectorService.getStats(user.id);
      return { data: { stats }, error: null };
    }
  );

  // GET /api/v1/inspectors/me/clients [inspector only]
  fastify.get(
    '/me/clients',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, _reply) => {
      const user = getUser(request);
      const clientUsers = aliasedTable(users, 'client_user');

      const rows = await db
        .select({
          clientId:           bookings.clientId,
          clientFullName:     clientUsers.fullName,
          clientEmail:        clientUsers.email,
          clientPhone:        clientUsers.phone,
          clientCreatedAt:    clientUsers.createdAt,
          propertyAddress:    bookings.propertyAddress,
          inspectionType:     bookings.inspectionType,
          bookingCreatedAt:   bookings.createdAt,
        })
        .from(bookings)
        .leftJoin(clientUsers, eq(clientUsers.id, bookings.clientId))
        .where(eq(bookings.inspectorId, user.id))
        .orderBy(desc(bookings.createdAt));

      // Deduplicate by client id — keep first occurrence (most recent booking)
      const seen = new Set<string>();
      const clients: any[] = [];
      for (const row of rows) {
        if (row.clientId && !seen.has(row.clientId)) {
          seen.add(row.clientId);
          clients.push({
            id:                  row.clientId,
            fullName:            row.clientFullName,
            email:               row.clientEmail,
            phone:               row.clientPhone,
            createdAt:           row.clientCreatedAt?.toISOString() ?? null,
            lastProperty:        row.propertyAddress,
            lastInspectionType:  row.inspectionType,
          });
        }
      }

      return { data: { clients }, error: null };
    }
  );

  // POST /api/v1/inspectors/me/signature [inspector only - upload signature image]
  fastify.post(
    '/me/signature',
    { preHandler: [fastify.authenticate, fastify.requireRole('inspector')] },
    async (request, reply) => {
      const user = getUser(request);
      const data = await request.file();
      if (!data) {
        return reply.status(400).send({ data: null, error: { code: 'NO_FILE', message: 'No file uploaded' } });
      }

      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(data.mimetype)) {
        return reply.status(400).send({ data: null, error: { code: 'INVALID_TYPE', message: 'JPEG, PNG, or WebP only' } });
      }

      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of data.file) {
        chunks.push(chunk);
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          return reply.status(400).send({ data: null, error: { code: 'FILE_TOO_LARGE', message: 'Max 2 MB' } });
        }
      }

      const buffer = Buffer.concat(chunks);
      const ext = data.mimetype === 'image/png' ? 'png' : 'jpg';
      const storagePath = `signatures/${user.id}.${ext}`;

      const upload = await uploadFile('avatars', storagePath, buffer, {
        contentType: data.mimetype, upsert: true,
      });
      if (!upload.ok) {
        request.log.error({ userId: user.id, storagePath, reason: upload.reason, detail: upload.message }, 'signature upload failed');
        return reply.status(503).send({ data: null, error: { code: 'STORAGE_UNAVAILABLE', message: 'Could not save your signature right now. Please try again in a moment.' } });
      }

      try {
        await db.update(users).set({ signatureImagePath: storagePath }).where(eq(users.id, user.id));
      } catch (err) {
        request.log.error({ err, userId: user.id }, 'signature path update failed');
        return reply.status(500).send({ data: null, error: { code: 'UPDATE_FAILED', message: 'Failed to save signature path' } });
      }

      const signatureUrl = await getPublicUrl('avatars', storagePath);
      return { data: { signaturePath: storagePath, signatureUrl }, error: null };
    }
  );

}
