import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import helmet from '@fastify/helmet';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import multipart from '@fastify/multipart';
import authPlugin from './plugins/authV2.js';
import errorHandlerPlugin from './plugins/errorHandler.js';
import rateLimitPlugin from './plugins/rateLimit.js';
import wordpressRoutes from './routes/wordpress.js';

// Routes
import authRoutes from './routes/auth.js';
import clientsRoutes from './routes/clients.js';
import inspectorsRoutes from './routes/inspectors.js';
import bookingsRoutes from './routes/bookings.js';
import inspectionsRoutes from './routes/inspections.js';
import conditionsRoutes from './routes/conditions.js';
import observationsRoutes from './routes/observations.js';
import photosRoutes from './routes/photos.js';
import reportsRoutes from './routes/reports.js';
import certsRoutes from './routes/certs.js';
import reviewRoutes from './routes/reviews.js';
import adminRoutes from './routes/admin.js';
import paymentsRoutes from './routes/payments.js';
import systemRoutes from './routes/system.js';
import templateRoutes from './routes/templates.js';
import libraryRoutes from './routes/library.js';
import tokensRoutes from './routes/tokens.js';
import eventsRoutes from './routes/events.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    },
    genReqId: () => randomUUID(),
    // Trust one proxy hop (Railway/Vercel) so request.ip reflects the real
    // client address. Required for IP-based rate limiting to be meaningful.
    //
    // Was `trustProxy: 1` — identical behavior (fastify/proxy-addr treat a
    // numeric trustProxy as "trust exactly this many hops", i.e. hop < 1,
    // which is what this function reproduces explicitly), but Railway's
    // build installs with plain `npm i` rather than pnpm, so it doesn't
    // respect pnpm-lock.yaml and resolved a fastify/@types version whose
    // TrustProxyFunction-based type no longer accepts a bare `number` —
    // broke every deploy with a TS2769 on this line while staying green
    // locally. A function is accepted regardless of that drift.
    trustProxy: (_address: string, hop: number) => hop < 1,
  });

  // Schema (ajv) validation failures otherwise surface as raw messages like
  // "body/reason must NOT have fewer than 10 characters" — technically
  // accurate but confusing in a UI error banner (e.g. flagging an inspection
  // with too short a reason). Reword the common keywords into plain English;
  // fall back to ajv's own message for anything less common.
  fastify.setSchemaErrorFormatter((errors, dataVar) => {
    const first = errors[0];
    const field = first?.instancePath
      ?.replace(/^\/(body|params|querystring)\//, '')
      .replace(/^\//, '')
      .replace(/\//g, '.') || (first?.params as any)?.missingProperty || dataVar;

    let message = `Invalid ${dataVar}`;
    if (first) {
      switch (first.keyword) {
        case 'minLength':
          message = `${field} must be at least ${(first.params as any).limit} characters`;
          break;
        case 'maxLength':
          message = `${field} must be at most ${(first.params as any).limit} characters`;
          break;
        case 'required':
          message = `${(first.params as any).missingProperty} is required`;
          break;
        case 'enum':
          message = `${field} must be one of: ${(first.params as any).allowedValues?.join(', ')}`;
          break;
        case 'type':
          message = `${field} must be a ${(first.params as any).type}`;
          break;
        default:
          message = `${field} ${first.message ?? 'is invalid'}`.trim();
      }
    }

    const err = new Error(message) as Error & { statusCode: number };
    err.statusCode = 400;
    return err;
  });

  // Allow POST/PUT requests with Content-Type: application/json but no body.
  // The frontend may send this header on empty-body requests (e.g. booking accept).
  fastify.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    if (!body || (typeof body === 'string' && body.trim() === '')) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Register sensible defaults (includes httpErrors)
  await fastify.register(sensible);

  // Register security headers
  await fastify.register(helmet);

  // Register CORS - allow multiple origins
  const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'https://inspect-africa.vercel.app',
    'https://inspectafrica.vercel.app',
    'https://app.inspectafrica.org',
    'https://api.inspectafrica.org',
  ];

  if (process.env.FRONTEND_URL) {
    allowedOrigins.push(process.env.FRONTEND_URL);
  }

  await fastify.register(cors, {
    origin: (origin, cb) => {
      // Allow requests with no origin (like mobile apps, curl, etc)
      if (!origin) {
        cb(null, true);
        return;
      }
      
      if (allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }
      
      // Reject origin
      cb(null, false);
    },
    credentials: true,
  });

  // Register Swagger — schema is always registered (used internally for
  // validator generation), but the UI is only exposed off production to
  // avoid leaking the full API surface.
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'InspectAfrica API',
        description: 'Property inspection platform API for certified ACHI inspectors',
        version: '1.0.0',
      },
      servers: [
        { url: 'http://localhost:3001', description: 'Development' },
        { url: 'https://inspect-africa-api-staging.up.railway.app', description: 'Staging' },
        { url: 'https://api.inspectafrica.org', description: 'Production' },
      ],
      tags: [
        { name: 'auth', description: 'Authentication endpoints' },
        { name: 'inspectors', description: 'Inspector management' },
        { name: 'bookings', description: 'Booking operations' },
        { name: 'inspections', description: 'Inspection workflow' },
        { name: 'conditions', description: 'Inspection conditions' },
        { name: 'observations', description: 'Observations and notes' },
        { name: 'photos', description: 'Photo management' },
        { name: 'reports', description: 'Report generation' },
        { name: 'certs', description: 'Certificate verification' },
        { name: 'admin', description: 'Admin operations' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  // Register Swagger UI only in non-production environments.
  if (process.env.NODE_ENV !== 'production') {
    await fastify.register(swaggerUI, {
      routePrefix: '/docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
      },
      staticCSP: true,
    });
  }

  // Register plugins (order matters!)
  await fastify.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit
  await fastify.register(authPlugin);
  await fastify.register(rateLimitPlugin);
  await fastify.register(errorHandlerPlugin);

  // Access logging — one structured JSON line per request with timing, user, and correlation ID
  fastify.addHook('onResponse', (request, reply, done) => {
    request.log.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: reply.elapsedTime,
      userId: (request as any).user?.id,
      role: (request as any).user?.role,
    }, 'request completed');
    done();
  });

  // Register routes (all prefixed with /api/v1)
  await fastify.register(authRoutes, { prefix: '/api/v1/auth' });
  await fastify.register(clientsRoutes, { prefix: '/api/v1/clients' });
  await fastify.register(inspectorsRoutes, { prefix: '/api/v1/inspectors' });
  await fastify.register(bookingsRoutes, { prefix: '/api/v1/bookings' });
  await fastify.register(inspectionsRoutes, { prefix: '/api/v1/inspections' });
  await fastify.register(conditionsRoutes, { prefix: '/api/v1/conditions' });
  await fastify.register(observationsRoutes, { prefix: '/api/v1/observations' });
  await fastify.register(photosRoutes, { prefix: '/api/v1/photos' });
  await fastify.register(reportsRoutes, { prefix: '/api/v1/reports' });
  await fastify.register(certsRoutes, { prefix: '/api/v1/certs' });
  await fastify.register(reviewRoutes, { prefix: '/api/v1/reviews' });
  await fastify.register(adminRoutes, { prefix: '/api/v1/admin' });
  await fastify.register(paymentsRoutes, { prefix: '/api/v1/payments' });
  await fastify.register(templateRoutes, { prefix: '/api/v1/templates' });
  await fastify.register(systemRoutes, { prefix: '/api/v1' });
  await fastify.register(libraryRoutes, { prefix: '/api/v1' });
  await fastify.register(tokensRoutes, { prefix: '/api/v1' });
  await fastify.register(eventsRoutes, { prefix: '/api/v1' });
  await fastify.register(wordpressRoutes, { prefix: '/api/v1/wordpress' });

  return fastify;
}

export default buildApp;
