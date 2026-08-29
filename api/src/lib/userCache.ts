/**
 * In-process user cache shared between the auth plugin and AuthServiceV2.
 * Keeps `tokenVersion` so we can detect stale tokens after logout/password reset.
 *
 * Lives in `lib/` (not `plugins/`) to avoid a circular import between the
 * plugin and the service.
 */

export type CachedUser = {
  id: string;
  email: string;
  role: 'inspector' | 'client' | 'admin';
  tokenVersion: number;
  expiresAt: number;
};

const TTL_MS = 60_000;
const MAX    = 2_000;
const cache  = new Map<string, CachedUser>();

export function cacheGet(id: string): CachedUser | null {
  const entry = cache.get(id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(id);
    return null;
  }
  return entry;
}

export function cacheSet(entry: Omit<CachedUser, 'expiresAt'>): void {
  if (cache.size >= MAX) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(entry.id, { ...entry, expiresAt: Date.now() + TTL_MS });
}

export function cacheInvalidate(userId: string): void {
  cache.delete(userId);
}
