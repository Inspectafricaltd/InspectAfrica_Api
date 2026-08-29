import type { FastifyInstance } from 'fastify';
import { AuthServiceV2 } from '../services/AuthServiceV2.js';
import { loginSchema, registerClientSchema, refreshTokenSchema } from '../schemas/index.js';
import { getUser } from '../utils/getUser.js';
import { AUTH_RATE_LIMIT } from '../plugins/rateLimit.js';
import { ClientService } from '../services/ClientService.js';
import { uploadFile, getPublicUrl } from '../lib/storage.js';

interface LoginBody     { email: string; password: string; }
interface RegisterBody  { email: string; password: string; fullName: string; phone?: string; countryOfResidence?: string; diasporaFlag?: string; }
interface RegisterInspectorBody { email: string; password: string; fullName: string; phone: string; achiNumber?: string; }
interface RefreshBody   { refreshToken: string; }

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /api/v1/auth/login
  fastify.post<{ Body: LoginBody }>(
    '/login',
    { schema: { body: loginSchema }, config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const { email, password } = request.body;
      request.log.info({ action: 'auth.login', email }, 'login attempt');

      const result = await AuthServiceV2.login(email, password, {
        userAgent: request.headers['user-agent'],
        ipAddress: request.ip,
      });

      if (result.error) {
        return reply.status(401).send({ data: null, error: { code: 'AUTH_FAILED', message: result.error } });
      }

      return { data: result, error: null };
    }
  );

  // POST /api/v1/auth/logout
  fastify.post(
    '/logout',
    { preHandler: [fastify.authenticate] },
    async (request, _reply) => {
      const user = getUser(request);
      await AuthServiceV2.logout(user.id);
      return { data: { success: true }, error: null };
    }
  );

  // POST /api/v1/auth/refresh
  fastify.post<{ Body: RefreshBody }>(
    '/refresh',
    { schema: { body: refreshTokenSchema } },
    async (request, reply) => {
      const result = await AuthServiceV2.refresh(request.body.refreshToken);
      if (result.error) {
        return reply.status(401).send({ data: null, error: { code: 'REFRESH_FAILED', message: result.error } });
      }
      return { data: result, error: null };
    }
  );

  // POST /api/v1/auth/forgot-password
  fastify.post<{ Body: { email: string } }>(
    '/forgot-password',
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, _reply) => {
      const { email } = request.body;
      if (!email) {
        return { data: null, error: { code: 'MISSING_EMAIL', message: 'Email is required' } };
      }
      await AuthServiceV2.requestPasswordReset(email);
      return { data: { message: 'If an account exists, a reset link has been sent.' }, error: null };
    }
  );

  // POST /api/v1/auth/update-password  (token from reset email link)
  fastify.post<{ Body: { token: string; newPassword: string } }>(
    '/update-password',
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const { token, newPassword } = request.body;
      if (!token || !newPassword) {
        return reply.status(400).send({ data: null, error: { code: 'MISSING_FIELDS', message: 'token and newPassword are required' } });
      }
      if (newPassword.length < 8) {
        return reply.status(400).send({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters' } });
      }
      const result = await AuthServiceV2.resetPassword(token, newPassword);
      if (result.error) {
        return reply.status(400).send({ data: null, error: { code: 'RESET_FAILED', message: result.error } });
      }
      return { data: { success: true }, error: null };
    }
  );

  // POST /api/v1/auth/change-password  (authenticated — knows old password)
  fastify.post<{ Body: { oldPassword: string; newPassword: string } }>(
    '/change-password',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { oldPassword, newPassword } = request.body;
      if (!oldPassword || !newPassword) {
        return reply.status(400).send({ data: null, error: { code: 'MISSING_FIELDS', message: 'oldPassword and newPassword are required' } });
      }
      if (newPassword.length < 8) {
        return reply.status(400).send({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Password must be at least 8 characters' } });
      }
      const user = getUser(request);
      const result = await AuthServiceV2.changePassword(user.id, oldPassword, newPassword);
      if (result.error) {
        return reply.status(400).send({ data: null, error: { code: 'CHANGE_FAILED', message: result.error } });
      }
      return { data: { success: true }, error: null };
    }
  );

  // POST /api/v1/auth/register  (client self-registration)
  fastify.post<{ Body: RegisterBody }>(
    '/register',
    { schema: { body: registerClientSchema }, config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      request.log.info({ action: 'auth.register', email: request.body.email }, 'client registration');
      const result = await AuthServiceV2.registerClient(request.body);
      if (result.error) {
        return reply.status(400).send({ data: null, error: { code: 'REGISTRATION_FAILED', message: result.error } });
      }
      return reply.status(201).send({ data: result, error: null });
    }
  );

  // POST /api/v1/auth/register/inspector
  fastify.post<{ Body: RegisterInspectorBody }>(
    '/register/inspector',
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (request, reply) => {
      const { email, password, fullName, phone, achiNumber } = request.body;
      if (!email || !password || !fullName || !phone) {
        return reply.status(400).send({ data: null, error: { code: 'VALIDATION_ERROR', message: 'Name, email, phone and password are required' } });
      }
      const result = await AuthServiceV2.registerInspector({ email, password, fullName, phone, achiNumber });
      if (result.error) {
        return reply.status(400).send({ data: null, error: { code: 'REGISTRATION_FAILED', message: result.error } });
      }
      return reply.status(201).send({ data: { user: result.user, message: 'Registration successful.' }, error: null });
    }
  );

  // GET /api/v1/auth/me
  fastify.get(
    '/me',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      const result = await AuthServiceV2.getMe(user.id);
      if (result.error) {
        return reply.status(404).send({ data: null, error: { code: 'USER_NOT_FOUND', message: result.error } });
      }
      return { data: { user: result.user, profile: result.profile }, error: null };
    }
  );

  // POST /api/v1/auth/avatar
  fastify.post(
    '/avatar',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = getUser(request);
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({ data: null, error: { code: 'NO_FILE', message: 'No file uploaded' } });
      }

      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(data.mimetype)) {
        return reply.status(400).send({ data: null, error: { code: 'INVALID_TYPE', message: 'Only JPEG, PNG, or WebP images are allowed' } });
      }

      const maxSize = 5 * 1024 * 1024;
      const chunks: Buffer[] = [];
      let fileSize = 0;

      for await (const chunk of data.file) {
        chunks.push(chunk);
        fileSize += chunk.length;
        if (fileSize > maxSize) {
          return reply.status(400).send({ data: null, error: { code: 'FILE_TOO_LARGE', message: 'File size must be less than 5MB' } });
        }
      }

      const buffer = Buffer.concat(chunks);
      const fileExt = data.filename.split('.').pop() || 'jpg';
      const fileName = `${user.id}/${Date.now()}.${fileExt}`;

      const upload = await uploadFile('avatars', fileName, buffer, {
        contentType: data.mimetype, upsert: true,
      });
      if (!upload.ok) {
        request.log.error({ userId: user.id, reason: upload.reason, detail: upload.message }, 'avatar upload failed');
        return reply.status(503).send({ data: null, error: { code: 'STORAGE_UNAVAILABLE', message: 'Could not save your photo right now. Please try again in a moment.' } });
      }

      const avatarUrl = await getPublicUrl('avatars', fileName);
      const { success, error: updateError } = await ClientService.updateAvatar(user.id, avatarUrl);

      if (!success) {
        return reply.status(500).send({ data: null, error: { code: 'UPDATE_FAILED', message: `Failed to update avatar URL: ${updateError}` } });
      }

      return { data: { avatarUrl, message: 'Avatar uploaded successfully' }, error: null };
    }
  );
}
