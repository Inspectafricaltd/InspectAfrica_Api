import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { inspectorProfiles, syncRuns } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export type SyncType = 'cert_sync' | 'expiry_check' | 'full_sync' | 'incremental_sync';
export type SyncStatus = 'running' | 'completed' | 'failed' | 'partial';

export interface SyncRun {
  id: string;
  type: SyncType;
  status: SyncStatus;
  started_at: string;
  completed_at?: string;
  records_processed: number;
  records_created: number;
  records_updated: number;
  records_failed: number;
  errors: string[];
  metadata?: Record<string, any>;
}

export interface SyncHealth {
  lastSyncAt?: string;
  lastSuccessfulSyncAt?: string;
  lastSyncStatus: SyncStatus;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  averageDuration: number;
}

function toIso(v: any): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Map a Drizzle row from sync_runs into the snake_case shape callers expect.
 */
function mapSyncRun(row: any): SyncRun {
  return {
    id: row.id,
    type: row.type as SyncType,
    status: row.status as SyncStatus,
    started_at: toIso(row.startedAt) ?? '',
    completed_at: row.completedAt ? toIso(row.completedAt) ?? undefined : undefined,
    records_processed: row.recordsProcessed ?? 0,
    records_created: row.recordsCreated ?? 0,
    records_updated: row.recordsUpdated ?? 0,
    records_failed: row.recordsFailed ?? 0,
    errors: row.errors ?? [],
    metadata: row.metadata ?? undefined,
  };
}

/**
 * Sync Status Tracking Service
 */
export class SyncStatusService {
  /**
   * Start a new sync run
   */
  static async startSync(type: SyncType): Promise<string> {
    try {
      const inserted = await db
        .insert(syncRuns)
        .values({
          type,
          status: 'running',
          startedAt: new Date(),
          recordsProcessed: 0,
          recordsCreated: 0,
          recordsUpdated: 0,
          recordsFailed: 0,
          errors: [],
        })
        .returning({ id: syncRuns.id });

      const row = inserted[0];
      if (!row) throw new Error('insert returned no row');
      return row.id;
    } catch (err) {
      logger.error({ err, type }, 'SyncStatusService.startSync failed');
      throw new Error('Failed to start sync run');
    }
  }

  /**
   * Update sync progress
   */
  static async updateProgress(
    runId: string,
    updates: {
      records_processed?: number;
      records_created?: number;
      records_updated?: number;
      records_failed?: number;
      errors?: string[];
    }
  ): Promise<void> {
    const setClause: Record<string, any> = {};
    if (updates.records_processed !== undefined) setClause.recordsProcessed = updates.records_processed;
    if (updates.records_created !== undefined) setClause.recordsCreated = updates.records_created;
    if (updates.records_updated !== undefined) setClause.recordsUpdated = updates.records_updated;
    if (updates.records_failed !== undefined) setClause.recordsFailed = updates.records_failed;
    if (updates.errors !== undefined) setClause.errors = updates.errors;

    if (Object.keys(setClause).length === 0) return;

    try {
      await db.update(syncRuns).set(setClause).where(eq(syncRuns.id, runId));
    } catch (err) {
      logger.error({ err, runId }, 'SyncStatusService.updateProgress failed');
    }
  }

  /**
   * Complete a sync run
   */
  static async completeSync(
    runId: string,
    status: SyncStatus,
    summary: {
      records_processed: number;
      records_created: number;
      records_updated: number;
      records_failed: number;
      errors: string[];
    },
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      await db
        .update(syncRuns)
        .set({
          status,
          completedAt: new Date(),
          recordsProcessed: summary.records_processed,
          recordsCreated: summary.records_created,
          recordsUpdated: summary.records_updated,
          recordsFailed: summary.records_failed,
          errors: summary.errors,
          metadata: metadata as any,
        })
        .where(eq(syncRuns.id, runId));
    } catch (err) {
      logger.error({ err, runId }, 'SyncStatusService.completeSync failed');
    }
  }

  /**
   * Get sync run by ID
   */
  static async getSyncRun(runId: string): Promise<SyncRun | null> {
    try {
      const [row] = await db
        .select()
        .from(syncRuns)
        .where(eq(syncRuns.id, runId))
        .limit(1);

      if (!row) return null;
      return mapSyncRun(row);
    } catch {
      return null;
    }
  }

  /**
   * Get recent sync runs
   */
  static async getRecentRuns(limit = 10, type?: SyncType): Promise<SyncRun[]> {
    try {
      const whereExpr = type ? eq(syncRuns.type, type) : undefined;
      const rows = await db
        .select()
        .from(syncRuns)
        .where(whereExpr)
        .orderBy(desc(syncRuns.startedAt))
        .limit(limit);

      return rows.map(mapSyncRun);
    } catch {
      return [];
    }
  }

  /**
   * Get sync health status
   */
  static async getSyncHealth(type: SyncType = 'cert_sync'): Promise<SyncHealth> {
    let rows: any[];
    try {
      rows = await db
        .select()
        .from(syncRuns)
        .where(eq(syncRuns.type, type))
        .orderBy(desc(syncRuns.startedAt))
        .limit(100);
    } catch {
      return {
        lastSyncStatus: 'failed',
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        averageDuration: 0,
      };
    }

    if (rows.length === 0) {
      return {
        lastSyncStatus: 'failed',
        totalRuns: 0,
        successfulRuns: 0,
        failedRuns: 0,
        averageDuration: 0,
      };
    }

    const runs = rows.map(mapSyncRun);
    const completedRuns = runs.filter((r) => r.completed_at);

    const durations = completedRuns
      .map((r) => {
        const start = new Date(r.started_at).getTime();
        const end = new Date(r.completed_at!).getTime();
        return end - start;
      })
      .filter((d) => d > 0);

    const lastSuccessful = runs.find((r) => r.status === 'completed');

    const firstRun = runs[0];
    return {
      lastSyncAt: firstRun?.started_at ?? undefined,
      lastSuccessfulSyncAt: lastSuccessful?.started_at ?? undefined,
      lastSyncStatus: (firstRun?.status as SyncStatus) ?? 'failed',
      totalRuns: runs.length,
      successfulRuns: runs.filter((r) => r.status === 'completed').length,
      failedRuns: runs.filter((r) => r.status === 'failed').length,
      averageDuration: durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0,
    };
  }

  /**
   * Check if sync is currently running
   */
  static async isSyncRunning(type: SyncType): Promise<boolean> {
    try {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(syncRuns)
        .where(and(
          eq(syncRuns.type, type),
          eq(syncRuns.status, 'running'),
        ));

      return (row?.count ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get sync statistics for dashboard
   */
  static async getSyncStats(): Promise<{
    totalInspectors: number;
    certifiedInspectors: number;
    expiringWithin30Days: number;
    expiringWithin7Days: number;
    lastSyncAt?: string;
  }> {
    // Get inspector counts
    let profiles: Array<{ achiStatus: string | null; achiExpiresAt: Date | null }> = [];
    try {
      profiles = await db
        .select({
          achiStatus:    inspectorProfiles.achiStatus,
          achiExpiresAt: inspectorProfiles.achiExpiresAt,
        })
        .from(inspectorProfiles);
    } catch (err) {
      logger.error({ err }, 'SyncStatusService.getSyncStats: profile fetch failed');
    }

    const now = new Date();
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const sevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    let certified = 0;
    let expiring30 = 0;
    let expiring7 = 0;

    for (const profile of profiles) {
      if (profile.achiStatus === 'certified') {
        certified++;
      }

      if (profile.achiExpiresAt) {
        const expiry = new Date(profile.achiExpiresAt);
        if (expiry <= thirtyDays && expiry > now) {
          expiring30++;
        }
        if (expiry <= sevenDays && expiry > now) {
          expiring7++;
        }
      }
    }

    // Get last sync
    let lastRunStartedAt: Date | null = null;
    try {
      const [lastRun] = await db
        .select({ startedAt: syncRuns.startedAt })
        .from(syncRuns)
        .where(and(
          eq(syncRuns.type, 'cert_sync'),
          eq(syncRuns.status, 'completed'),
        ))
        .orderBy(desc(syncRuns.startedAt))
        .limit(1);
      lastRunStartedAt = lastRun?.startedAt ?? null;
    } catch (err) {
      logger.error({ err }, 'SyncStatusService.getSyncStats: lastRun fetch failed');
    }

    return {
      totalInspectors: profiles.length,
      certifiedInspectors: certified,
      expiringWithin30Days: expiring30,
      expiringWithin7Days: expiring7,
      lastSyncAt: lastRunStartedAt ? toIso(lastRunStartedAt) ?? undefined : undefined,
    };
  }
}

export default SyncStatusService;
