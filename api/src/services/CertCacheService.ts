import { eq, ne } from 'drizzle-orm';
import { db } from '../db/index.js';
import { certCache } from '../db/schema.js';
import { verifyCert, type CertVerificationResult } from '../lib/wordpress.js';
import { logger } from '../lib/logger.js';

interface CachedCert {
  achi_number: string;
  inspector_name: string;
  status: string;
  issued_at: string;
  expires_at: string;
  cached_at: string;
  source: 'wordpress';
}

interface CacheEntry {
  data: CachedCert;
  cached_at: string;
  expires_at: string;
}

// Cache duration: 30 minutes
const CACHE_DURATION_MS = 30 * 60 * 1000;

function toIso(v: any): string {
  if (!v) return '';
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Certificate verification with caching layer
 *
 * Flow:
 * 1. Check cache (< 30 min old)
 * 2. If fresh, return cached
 * 3. If stale/missing, call WordPress API
 * 4. Update cache and return
 */
export class CertCacheService {
  /**
   * Verify an ACHI certificate number with caching
   */
  static async verifyWithCache(achiNumber: string): Promise<CertVerificationResult & { cached?: boolean }> {
    // 1. Check cache
    const cached = await this.getCachedCert(achiNumber);

    if (cached && this.isCacheFresh(cached)) {
      return {
        valid: cached.data.status === 'certified' || cached.data.status === 'active',
        name: cached.data.inspector_name,
        issued: cached.data.issued_at,
        expires: cached.data.expires_at,
        status: cached.data.status,
        cached: true,
      };
    }

    // 2. Fetch from WordPress
    const wpResult = await verifyCert(achiNumber);

    if (wpResult.valid) {
      // 3. Update cache
      await this.updateCache(achiNumber, wpResult);
    }

    return { ...wpResult, cached: false };
  }

  /**
   * Get cached certificate from DB
   */
  private static async getCachedCert(achiNumber: string): Promise<CacheEntry | null> {
    try {
      const [row] = await db
        .select()
        .from(certCache)
        .where(eq(certCache.achiNumber, achiNumber))
        .limit(1);

      if (!row) return null;

      return {
        data: {
          achi_number:    row.achiNumber,
          inspector_name: row.inspectorName,
          status:         row.status,
          issued_at:      toIso(row.issuedAt),
          expires_at:     toIso(row.expiresAt),
          cached_at:      toIso(row.cachedAt),
          source:         row.source as 'wordpress',
        },
        cached_at: toIso(row.cachedAt),
        expires_at: toIso(row.expiresAt),
      };
    } catch (err) {
      logger.error({ err, achiNumber }, 'CertCacheService.getCachedCert failed');
      return null;
    }
  }

  /**
   * Check if cache entry is fresh (< 30 minutes old)
   */
  private static isCacheFresh(cache: CacheEntry): boolean {
    const cachedAt = new Date(cache.cached_at).getTime();
    const now = Date.now();
    return (now - cachedAt) < CACHE_DURATION_MS;
  }

  /**
   * Update cache with fresh WordPress data
   */
  private static async updateCache(achiNumber: string, result: CertVerificationResult): Promise<void> {
    try {
      await db
        .insert(certCache)
        .values({
          achiNumber,
          inspectorName: result.name || '',
          status:        result.status || 'unknown',
          issuedAt:      result.issued || null,
          expiresAt:     result.expires || null,
          cachedAt:      new Date(),
          source:        'wordpress',
        })
        .onConflictDoUpdate({
          target: certCache.achiNumber,
          set: {
            inspectorName: result.name || '',
            status:        result.status || 'unknown',
            issuedAt:      result.issued || null,
            expiresAt:     result.expires || null,
            cachedAt:      new Date(),
            source:        'wordpress',
          },
        });
    } catch (err) {
      logger.error({ err, achiNumber }, 'CertCacheService.updateCache failed');
    }
  }

  /**
   * Invalidate cache for a specific ACHI number
   */
  static async invalidateCache(achiNumber: string): Promise<void> {
    try {
      await db.delete(certCache).where(eq(certCache.achiNumber, achiNumber));
    } catch (err) {
      logger.error({ err, achiNumber }, 'CertCacheService.invalidateCache failed');
    }
  }

  /**
   * Clear all cache entries
   */
  static async clearAllCache(): Promise<void> {
    try {
      await db.delete(certCache).where(ne(certCache.achiNumber, ''));
    } catch (err) {
      logger.error({ err }, 'CertCacheService.clearAllCache failed');
    }
  }

  /**
   * Get cache statistics
   */
  static async getCacheStats(): Promise<{ total: number; fresh: number; stale: number }> {
    try {
      const rows = await db
        .select({ cachedAt: certCache.cachedAt })
        .from(certCache);

      const now = Date.now();
      let fresh = 0;
      let stale = 0;

      for (const entry of rows) {
        const cachedAt = entry.cachedAt ? new Date(entry.cachedAt).getTime() : 0;
        if ((now - cachedAt) < CACHE_DURATION_MS) {
          fresh++;
        } else {
          stale++;
        }
      }

      return { total: rows.length, fresh, stale };
    } catch (err) {
      logger.error({ err }, 'CertCacheService.getCacheStats failed');
      return { total: 0, fresh: 0, stale: 0 };
    }
  }
}

export default CertCacheService;
