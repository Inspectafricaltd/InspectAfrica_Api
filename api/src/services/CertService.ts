import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { inspectorProfiles, users } from '../db/schema.js';
import { CertCacheService } from './CertCacheService.js';
import { logger } from '../lib/logger.js';

export interface CertVerification {
  valid: boolean;
  name: string | null;
  issued: string | null;
  expires: string | null;
  status: string | null;
}

export interface CertReverifyResult {
  achiNumber: string;
  valid: boolean;
  status: string | null;
  issued: string | null;
  expires: string | null;
  /** True only when inspector_profiles was actually updated to match. */
  promoted: boolean;
}

export interface InspectorCert {
  achiNumber: string;
  achiStatus: string;
  achiIssuedAt: string | null;
  achiExpiresAt: string | null;
  inspectorName: string;
  inspectorEmail: string;
}

function toIso(v: any): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export class CertService {
  static async verify(achiNumber: string, inspectorId: string): Promise<CertVerification> {
    // Get inspector profile with ACHI details + user name
    const [profile] = await db
      .select({
        achiNumber:     inspectorProfiles.achiNumber,
        achiStatus:     inspectorProfiles.achiStatus,
        achiIssuedAt:   inspectorProfiles.achiIssuedAt,
        achiExpiresAt:  inspectorProfiles.achiExpiresAt,
        userId:         inspectorProfiles.userId,
        userFullName:   users.fullName,
      })
      .from(inspectorProfiles)
      .leftJoin(users, eq(users.id, inspectorProfiles.userId))
      .where(eq(inspectorProfiles.userId, inspectorId))
      .limit(1);

    if (!profile) {
      return { valid: false, name: null, issued: null, expires: null, status: null };
    }

    // Verify ACHI number matches
    if (profile.achiNumber !== achiNumber) {
      return { valid: false, name: null, issued: null, expires: null, status: null };
    }

    // Check if certificate is valid (not expired)
    const now = new Date();
    const expiresAt = profile.achiExpiresAt ? new Date(profile.achiExpiresAt) : null;
    const isExpired = expiresAt ? expiresAt < now : false;

    const isValid = profile.achiStatus === 'certified' && !isExpired;

    return {
      valid: isValid,
      name: profile.userFullName ?? null,
      issued: toIso(profile.achiIssuedAt),
      expires: toIso(profile.achiExpiresAt),
      status: profile.achiStatus,
    };
  }

  /**
   * Self-service re-verify for the inspector who owns `inspectorId` — the
   * ACHI number is read from their own profile, never client-supplied, so
   * this can't be used to verify/claim someone else's number.
   *
   * The old flow (frontend calling the public GET /certs/verify/:achiNumber
   * directly) checked WordPress live via CertCacheService but only ever
   * cached the result — it never wrote inspector_profiles, so a successful
   * re-verify showed "Verified!" while the displayed status stayed stale
   * (confirmed bug, docs/projects/claims-2026-08-27.md — B5). This method
   * does the same live check and actually applies it.
   *
   * Promote-only, deliberately: this is inspector-reachable self-service,
   * and achi_status gates paid work. A wrong promotion is as fixable as the
   * stale-data bug this replaces; a wrong downgrade from a transient
   * WordPress hiccup or webhook race would silently cut off someone's
   * ability to earn, with no human in the loop. Downgrades stay on the
   * authoritative, auditable paths that already exist: the WordPress
   * webhook (real-time, WordPress-initiated) and the admin-only verify
   * route/cert-expired webhook.
   */
  static async reverifySelf(inspectorId: string): Promise<CertReverifyResult | { error: string }> {
    const [profile] = await db
      .select({ achiNumber: inspectorProfiles.achiNumber })
      .from(inspectorProfiles)
      .where(eq(inspectorProfiles.userId, inspectorId))
      .limit(1);

    if (!profile?.achiNumber) {
      return { error: 'No ACHI number on profile — add it first.' };
    }

    const result = await CertCacheService.verifyWithCache(profile.achiNumber);

    let promoted = false;
    if (result.valid && (result.status === 'certified' || result.status === 'active')) {
      try {
        const updates: Record<string, unknown> = { achiStatus: 'certified', updatedAt: new Date() };
        if (result.issued) updates.achiIssuedAt = new Date(result.issued);
        if (result.expires) updates.achiExpiresAt = new Date(result.expires);

        await db
          .update(inspectorProfiles)
          .set(updates)
          .where(eq(inspectorProfiles.userId, inspectorId));
        promoted = true;
      } catch (err) {
        logger.error({ err, inspectorId }, 'CertService.reverifySelf: failed to apply promotion');
      }
    }
    // status === 'suspended' | 'expired' | 'not_found' | 'error' | 'not_configured'
    // -> inspector_profiles is left untouched entirely. Promote-only.

    return {
      achiNumber: profile.achiNumber,
      valid:      result.valid,
      status:     result.status || null,
      issued:     result.issued || null,
      expires:    result.expires || null,
      promoted,
    };
  }

  static async getInspectorCert(inspectorId: string): Promise<InspectorCert | null> {
    const [profile] = await db
      .select({
        achiNumber:     inspectorProfiles.achiNumber,
        achiStatus:     inspectorProfiles.achiStatus,
        achiIssuedAt:   inspectorProfiles.achiIssuedAt,
        achiExpiresAt:  inspectorProfiles.achiExpiresAt,
        userFullName:   users.fullName,
        userEmail:      users.email,
      })
      .from(inspectorProfiles)
      .leftJoin(users, eq(users.id, inspectorProfiles.userId))
      .where(eq(inspectorProfiles.userId, inspectorId))
      .limit(1);

    if (!profile) {
      return null;
    }

    return {
      achiNumber: profile.achiNumber ?? '',
      achiStatus: profile.achiStatus ?? 'pending',
      achiIssuedAt: toIso(profile.achiIssuedAt),
      achiExpiresAt: toIso(profile.achiExpiresAt),
      inspectorName: profile.userFullName ?? '',
      inspectorEmail: profile.userEmail ?? '',
    };
  }
}
