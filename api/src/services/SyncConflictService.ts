import { eq, isNull, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { syncConflicts, inspectorProfiles } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export type ConflictType = 'cert_status_mismatch' | 'expiry_date_diff' | 'issued_date_diff' | 'inspector_not_found' | 'email_mismatch';
export type ConflictResolution = 'wordpress_wins' | 'app_wins' | 'manual_review';

export interface SyncConflict {
  id: string;
  type: ConflictType;
  achi_number: string;
  wordpress_value: Record<string, any>;
  app_value: Record<string, any>;
  resolution: ConflictResolution;
  resolved_at?: string;
  resolved_by?: string;
  created_at: string;
}

interface ConflictDetectionResult {
  hasConflict: boolean;
  conflicts: Partial<SyncConflict>[];
}

function toIso(v: any): string | undefined {
  if (v === null || v === undefined) return undefined;
  return v instanceof Date ? v.toISOString() : String(v);
}

function shapeConflict(row: any): SyncConflict {
  return {
    id:              row.id,
    type:            row.type as ConflictType,
    achi_number:     row.achiNumber,
    wordpress_value: row.wordpressValue ?? {},
    app_value:       row.appValue ?? {},
    resolution:      row.resolution as ConflictResolution,
    resolved_at:     toIso(row.resolvedAt),
    resolved_by:     row.resolvedBy ?? undefined,
    created_at:      toIso(row.createdAt) ?? '',
  };
}

/**
 * Conflict Resolution Service
 *
 * Rules:
 * - WordPress is source of truth for: achi_number existence, certification status, issue/expire dates, inspector name
 * - The app DB is source of truth for: app-specific data (bookings, inspections), availability, service regions, bio
 */
export class SyncConflictService {
  /**
   * Detect conflicts between WordPress and app DB data
   */
  static async detectConflicts(
    wpData: {
      achi_number: string;
      status: string;
      expires_at: string;
      issued_at: string;
      full_name: string;
      email: string;
    },
    appData: {
      achi_number: string | null;
      achi_status: string | null;
      achi_expires_at: string | null;
      achi_issued_at: string | null;
      user_email: string;
      user_full_name: string;
    }
  ): Promise<ConflictDetectionResult> {
    const conflicts: Partial<SyncConflict>[] = [];

    // Check status mismatch
    if (appData.achi_status && wpData.status !== this.mapWpStatus(appData.achi_status)) {
      conflicts.push({
        type: 'cert_status_mismatch',
        achi_number: wpData.achi_number,
        wordpress_value: { status: wpData.status },
        app_value: { status: appData.achi_status },
        resolution: 'wordpress_wins',
      });
    }

    // Check expiry date mismatch (more than 1 day difference)
    if (appData.achi_expires_at) {
      const wpExpiry = new Date(wpData.expires_at).getTime();
      const appExpiry = new Date(appData.achi_expires_at).getTime();
      const dayDiff = Math.abs(wpExpiry - appExpiry) / (1000 * 60 * 60 * 24);

      if (dayDiff > 1) {
        conflicts.push({
          type: 'expiry_date_diff',
          achi_number: wpData.achi_number,
          wordpress_value: { expires_at: wpData.expires_at },
          app_value: { expires_at: appData.achi_expires_at },
          resolution: 'wordpress_wins',
        });
      }
    }

    // Check email mismatch (requires manual review)
    if (wpData.email.toLowerCase() !== appData.user_email.toLowerCase()) {
      conflicts.push({
        type: 'email_mismatch',
        achi_number: wpData.achi_number,
        wordpress_value: { email: wpData.email },
        app_value: { email: appData.user_email },
        resolution: 'manual_review',
      });
    }

    return {
      hasConflict: conflicts.length > 0,
      conflicts,
    };
  }

  /**
   * Resolve a conflict based on resolution strategy
   */
  static async resolveConflict(conflictId: string, resolution: ConflictResolution, resolvedBy?: string): Promise<void> {
    // Get conflict details
    const [row] = await db
      .select()
      .from(syncConflicts)
      .where(eq(syncConflicts.id, conflictId))
      .limit(1);

    if (!row) {
      throw new Error('Conflict not found');
    }

    const conflictData = shapeConflict(row);

    if (resolution === 'wordpress_wins') {
      await this.applyWordPressValue(conflictData);
    } else if (resolution === 'app_wins') {
      // Keep app DB value, no action needed
    }

    // Update conflict record
    try {
      await db
        .update(syncConflicts)
        .set({
          resolution,
          resolvedAt: new Date(),
          resolvedBy: resolvedBy || null,
        })
        .where(eq(syncConflicts.id, conflictId));
    } catch (err) {
      logger.error({ err, conflictId }, 'SyncConflictService.resolveConflict failed');
    }
  }

  /**
   * Apply WordPress value to app DB (WordPress wins)
   */
  private static async applyWordPressValue(conflict: SyncConflict): Promise<void> {
    const updates: Record<string, any> = {};

    switch (conflict.type) {
      case 'cert_status_mismatch':
        updates.achiStatus = this.mapWpStatusToApp(conflict.wordpress_value.status);
        break;
      case 'expiry_date_diff':
        updates.achiExpiresAt = conflict.wordpress_value.expires_at
          ? new Date(conflict.wordpress_value.expires_at)
          : null;
        break;
      case 'issued_date_diff':
        updates.achiIssuedAt = conflict.wordpress_value.issued_at
          ? new Date(conflict.wordpress_value.issued_at)
          : null;
        break;
    }

    if (Object.keys(updates).length > 0) {
      try {
        await db
          .update(inspectorProfiles)
          .set(updates)
          .where(eq(inspectorProfiles.achiNumber, conflict.achi_number));
      } catch (err) {
        logger.error({ err, achiNumber: conflict.achi_number }, 'SyncConflictService.applyWordPressValue failed');
      }
    }
  }

  /**
   * Log a conflict for manual review
   */
  static async logConflict(conflict: Partial<SyncConflict>): Promise<string> {
    try {
      const [row] = await db
        .insert(syncConflicts)
        .values({
          type:           conflict.type ?? 'manual_review',
          achiNumber:     conflict.achi_number ?? '',
          wordpressValue: conflict.wordpress_value ?? {},
          appValue:       conflict.app_value ?? {},
          resolution:     conflict.resolution || 'manual_review',
        })
        .returning({ id: syncConflicts.id });

      return row?.id ?? '';
    } catch (err) {
      logger.error({ err, conflict }, 'SyncConflictService.logConflict failed');
      return '';
    }
  }

  /**
   * Get all unresolved conflicts
   */
  static async getUnresolvedConflicts(): Promise<SyncConflict[]> {
    try {
      const rows = await db
        .select()
        .from(syncConflicts)
        .where(isNull(syncConflicts.resolvedAt))
        .orderBy(desc(syncConflicts.createdAt));

      return rows.map(shapeConflict);
    } catch (err) {
      logger.error({ err }, 'SyncConflictService.getUnresolvedConflicts failed');
      return [];
    }
  }

  /**
   * Get conflict statistics
   */
  static async getConflictStats(): Promise<{
    total: number;
    unresolved: number;
    byType: Record<ConflictType, number>;
  }> {
    try {
      const rows = await db
        .select({
          type:       syncConflicts.type,
          resolvedAt: syncConflicts.resolvedAt,
        })
        .from(syncConflicts);

      const stats: { total: number; unresolved: number; byType: Record<ConflictType, number> } = {
        total: rows.length,
        unresolved: rows.filter(r => !r.resolvedAt).length,
        byType: {} as Record<ConflictType, number>,
      };

      for (const item of rows) {
        const type = item.type as ConflictType;
        stats.byType[type] = (stats.byType[type] || 0) + 1;
      }

      return stats;
    } catch (err) {
      logger.error({ err }, 'SyncConflictService.getConflictStats failed');
      return { total: 0, unresolved: 0, byType: {} as Record<ConflictType, number> };
    }
  }

  /**
   * Map WordPress status to app DB status
   */
  private static mapWpStatus(status: string): string {
    const statusMap: Record<string, string> = {
      'active': 'certified',
      'suspended': 'suspended',
      'expired': 'expired',
      'candidate': 'candidate',
    };
    return statusMap[status] || status;
  }

  /**
   * Map WordPress status to app DB status (reverse)
   */
  private static mapWpStatusToApp(wpStatus: string): string {
    const statusMap: Record<string, string> = {
      'active': 'certified',
      'suspended': 'suspended',
      'expired': 'expired',
      'candidate': 'candidate',
    };
    return statusMap[wpStatus] || wpStatus;
  }
}

export default SyncConflictService;
