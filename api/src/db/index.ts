import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema.js';

// Lazy-init so importing this module doesn't throw in environments without
// DATABASE_URL (CI tests, lint, typecheck). The error surfaces only on first
// query — and most unit tests mock at the service boundary so they never hit it.
let _client: Sql | null = null;
let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

function getClient(): Sql {
  if (_client) return _client;
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  _client = postgres(process.env.DATABASE_URL, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  return _client;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    if (!_db) _db = drizzle(getClient(), { schema });
    return (_db as any)[prop];
  },
});

export type DB = typeof db;
