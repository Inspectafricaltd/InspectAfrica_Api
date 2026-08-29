import { z } from 'zod';

const PLACEHOLDER_PATTERNS = [/^your-/i, /\[PASSWORD\]/, /\[PROJECT-REF\]/, /xxxx+/i];

function rejectPlaceholder(fieldName: string) {
  return z
    .string()
    .min(1, `${fieldName} is required`)
    .refine(
      (v) => !PLACEHOLDER_PATTERNS.some((p) => p.test(v)),
      (v) => ({ message: `${fieldName} still contains a placeholder value: "${v}"` })
    );
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().optional(),

  // Railway Postgres
  DATABASE_URL: z.string().url(),

  JWT_SECRET: rejectPlaceholder('JWT_SECRET').pipe(z.string().min(32, 'JWT_SECRET must be at least 32 characters')),
  REPORT_TOKEN_SECRET: rejectPlaceholder('REPORT_TOKEN_SECRET').pipe(
    z.string().min(32, 'REPORT_TOKEN_SECRET must be at least 32 characters')
  ),

  RESEND_API_KEY: rejectPlaceholder('RESEND_API_KEY'),

  WP_BASE_URL: z.string().url(),
  WP_API_KEY: rejectPlaceholder('WP_API_KEY'),

  // Public base URL of the web app, used to build links in outgoing emails.
  APP_URL: z.string().url().optional(),

  // Extra CORS origin (see app.ts). Not used for email links — use APP_URL for those.
  FRONTEND_URL: z.string().url().optional(),

  CRON_SECRET: rejectPlaceholder('CRON_SECRET').optional(),
});

export type Env = z.infer<typeof schema>;

export function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env = loadEnv();
