import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { revisionEvents, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export interface RevisionEvent {
  id: string;
  inspectionId: string;
  entityType: 'inspection' | 'condition' | 'observation' | 'photo' | 'annotation' | 'report';
  entityId: string;
  action: 'created' | 'updated' | 'deleted';
  field: string | null;
  previousValue: unknown;
  newValue: unknown;
  changedBy: string;
  changedAt: string;
  reason: string | null;
}

export class RevisionService {
  /**
   * Log a revision event - APPEND ONLY, never update or delete.
   * Logging failures must NEVER block the calling operation.
   */
  static async log(event: {
    inspectionId: string;
    entityType: 'inspection' | 'condition' | 'observation' | 'photo' | 'annotation' | 'report';
    entityId: string;
    action: 'created' | 'updated' | 'deleted';
    field?: string;
    previousValue?: unknown;
    newValue?: unknown;
    changedBy: string;
    reason?: string;
  }): Promise<void> {
    try {
      await db.insert(revisionEvents).values({
        inspectionId:  event.inspectionId,
        entityType:    event.entityType,
        entityId:      event.entityId,
        action:        event.action,
        field:         event.field ?? null,
        previousValue: (event.previousValue ?? null) as any,
        newValue:      (event.newValue ?? null) as any,
        changedBy:     event.changedBy,
        reason:        event.reason ?? null,
      });
    } catch (err) {
      logger.error({ err, inspectionId: event.inspectionId, entityType: event.entityType }, 'RevisionService.log failed');
    }
  }

  /**
   * Get all revision events for a specific entity
   */
  static async getHistory(entityType: string, entityId: string): Promise<RevisionEvent[]> {
    try {
      const rows = await db
        .select({
          id:            revisionEvents.id,
          inspectionId:  revisionEvents.inspectionId,
          entityType:    revisionEvents.entityType,
          entityId:      revisionEvents.entityId,
          action:        revisionEvents.action,
          field:         revisionEvents.field,
          previousValue: revisionEvents.previousValue,
          newValue:      revisionEvents.newValue,
          changedBy:     revisionEvents.changedBy,
          changedAt:     revisionEvents.changedAt,
          reason:        revisionEvents.reason,
          changedByName: users.fullName,
        })
        .from(revisionEvents)
        .leftJoin(users, eq(users.id, revisionEvents.changedBy))
        .where(and(
          eq(revisionEvents.entityType, entityType),
          eq(revisionEvents.entityId, entityId),
        ))
        .orderBy(desc(revisionEvents.changedAt));

      return rows.map(r => shapeEvent(r));
    } catch (err) {
      logger.error({ err, entityType, entityId }, 'RevisionService.getHistory failed');
      return [];
    }
  }

  /**
   * Admin audit log — paginated list of all revision events, optionally filtered.
   */
  static async listAll(filters: {
    page?: number;
    limit?: number;
    entityType?: string;
    action?: string;
    changedBy?: string;
    inspectionId?: string;
    from?: string;
    to?: string;
  } = {}): Promise<{ events: RevisionEvent[]; total: number }> {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    const offset = (page - 1) * limit;

    const conditions = [];
    if (filters.entityType)   conditions.push(eq(revisionEvents.entityType, filters.entityType));
    if (filters.action)       conditions.push(eq(revisionEvents.action, filters.action as 'created' | 'updated' | 'deleted'));
    if (filters.changedBy)    conditions.push(eq(revisionEvents.changedBy, filters.changedBy));
    if (filters.inspectionId) conditions.push(eq(revisionEvents.inspectionId, filters.inspectionId));
    if (filters.from)         conditions.push(gte(revisionEvents.changedAt, new Date(filters.from)));
    if (filters.to)           conditions.push(lte(revisionEvents.changedAt, new Date(filters.to)));

    const whereExpr = conditions.length > 0 ? and(...conditions) : undefined;

    try {
      const [rows, totalRow] = await Promise.all([
        db
          .select({
            id:            revisionEvents.id,
            inspectionId:  revisionEvents.inspectionId,
            entityType:    revisionEvents.entityType,
            entityId:      revisionEvents.entityId,
            action:        revisionEvents.action,
            field:         revisionEvents.field,
            previousValue: revisionEvents.previousValue,
            newValue:      revisionEvents.newValue,
            changedBy:     revisionEvents.changedBy,
            changedAt:     revisionEvents.changedAt,
            reason:        revisionEvents.reason,
            changedByName: users.fullName,
          })
          .from(revisionEvents)
          .leftJoin(users, eq(users.id, revisionEvents.changedBy))
          .where(whereExpr)
          .orderBy(desc(revisionEvents.changedAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(revisionEvents)
          .where(whereExpr),
      ]);

      return {
        events: rows.map(r => shapeEvent(r)),
        total:  totalRow[0]?.count ?? 0,
      };
    } catch (err) {
      logger.error({ err, filters }, 'RevisionService.listAll failed');
      return { events: [], total: 0 };
    }
  }

  /**
   * Get all revision events for an inspection
   */
  static async getInspectionHistory(inspectionId: string): Promise<RevisionEvent[]> {
    try {
      const rows = await db
        .select({
          id:            revisionEvents.id,
          inspectionId:  revisionEvents.inspectionId,
          entityType:    revisionEvents.entityType,
          entityId:      revisionEvents.entityId,
          action:        revisionEvents.action,
          field:         revisionEvents.field,
          previousValue: revisionEvents.previousValue,
          newValue:      revisionEvents.newValue,
          changedBy:     revisionEvents.changedBy,
          changedAt:     revisionEvents.changedAt,
          reason:        revisionEvents.reason,
          changedByName: users.fullName,
        })
        .from(revisionEvents)
        .leftJoin(users, eq(users.id, revisionEvents.changedBy))
        .where(eq(revisionEvents.inspectionId, inspectionId))
        .orderBy(desc(revisionEvents.changedAt));

      return rows.map(r => shapeEvent(r));
    } catch (err) {
      logger.error({ err, inspectionId }, 'RevisionService.getInspectionHistory failed');
      return [];
    }
  }
}

function shapeEvent(r: any): RevisionEvent {
  return {
    id:            String(r.id),
    inspectionId:  r.inspectionId,
    entityType:    r.entityType,
    entityId:      r.entityId,
    action:        r.action,
    field:         r.field,
    previousValue: r.previousValue,
    newValue:      r.newValue,
    changedBy:     r.changedByName ?? r.changedBy,
    changedAt:     r.changedAt instanceof Date ? r.changedAt.toISOString() : r.changedAt,
    reason:        r.reason,
  };
}
