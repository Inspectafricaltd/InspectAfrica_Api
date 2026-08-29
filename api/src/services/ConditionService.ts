import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  bookings,
  inspectionConditions,
  inspections,
  revisionEvents,
  users,
} from '../db/schema.js';
import { RevisionService } from './RevisionService.js';
import { logger } from '../lib/logger.js';

export interface UpdateConditionData {
  severity?: 'acceptable' | 'monitor' | 'repair_required' | 'unsafe';
  notes?: string;
}

export interface Condition {
  id: string;
  sectionId: string;
  inspectionId: string;
  name: string;
  displayOrder: number;
  severity: string | null;
  isComplete: boolean;
  photoCount: number;
  observationCount: number;
  updatedAt: string;
}

export interface ConditionHistory {
  id: string;
  action: string;
  field: string;
  oldValue: any;
  newValue: any;
  changedAt: string;
  changedBy: string;
}

function toIso(v: any): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export class ConditionService {
  static async update(inspectorId: string, conditionId: string, data: UpdateConditionData) {
    // Verify condition exists and belongs to an inspection owned by this inspector
    const [condition] = await db
      .select({
        id:               inspectionConditions.id,
        inspectionId:     inspectionConditions.inspectionId,
        severity:         inspectionConditions.severity,
        inspectionInspectorId: inspections.inspectorId,
        inspectionStatus:      inspections.status,
      })
      .from(inspectionConditions)
      .innerJoin(inspections, eq(inspections.id, inspectionConditions.inspectionId))
      .where(eq(inspectionConditions.id, conditionId))
      .limit(1);

    if (!condition) {
      return { condition: null, error: 'Condition not found' };
    }

    if (condition.inspectionInspectorId !== inspectorId) {
      return { condition: null, error: 'You do not have access to this condition' };
    }

    if (
      !condition.inspectionStatus ||
      !['draft', 'in_progress', 'pending_review', 'flagged'].includes(condition.inspectionStatus)
    ) {
      return { condition: null, error: 'Cannot update condition in current inspection status' };
    }

    // Store old value for revision
    const oldSeverity = condition.severity;

    // Update condition
    const updateData: Record<string, any> = { isComplete: true };
    if (data.severity !== undefined) {
      updateData.severity = data.severity;
    }

    let updatedCondition: any;
    try {
      const updated = await db
        .update(inspectionConditions)
        .set(updateData)
        .where(eq(inspectionConditions.id, conditionId))
        .returning({
          id:               inspectionConditions.id,
          section_id:       inspectionConditions.sectionId,
          inspection_id:    inspectionConditions.inspectionId,
          name:             inspectionConditions.name,
          display_order:    inspectionConditions.displayOrder,
          severity:         inspectionConditions.severity,
          is_complete:      inspectionConditions.isComplete,
          photo_count:      inspectionConditions.photoCount,
          observation_count: inspectionConditions.observationCount,
          updated_at:       inspectionConditions.updatedAt,
          created_at:       inspectionConditions.createdAt,
        });
      updatedCondition = updated[0];
      if (!updatedCondition) throw new Error('update returned no row');
    } catch (updateError) {
      logger.error({ err: updateError, conditionId, inspectorId }, 'ConditionService.update failed');
      return { condition: null, error: 'Failed to update condition' };
    }

    // Log revision event using RevisionService if severity changed.
    if (data.severity !== undefined && oldSeverity !== data.severity) {
      await RevisionService.log({
        inspectionId: condition.inspectionId,
        entityType: 'condition',
        entityId: conditionId,
        action: 'updated',
        field: 'severity',
        previousValue: { severity: oldSeverity },
        newValue: { severity: data.severity },
        changedBy: inspectorId,
      });
    }

    // Normalize timestamps to ISO strings to preserve API contract
    return {
      condition: {
        ...updatedCondition,
        updated_at: toIso(updatedCondition.updated_at),
        created_at: toIso(updatedCondition.created_at),
      } as unknown as Condition,
      error: null,
    };
  }

  static async getHistory(
    user: { id: string; role: string },
    conditionId: string
  ): Promise<{ history: ConditionHistory[]; error: string | null }> {
    // Ownership gate: resolve the condition's parent inspection and require
    // that the caller is the inspector of record, the client of record (via
    // booking or solo client_id), or an admin.
    const [condition] = await db
      .select({
        id:                  inspectionConditions.id,
        inspectionId:        inspectionConditions.inspectionId,
        inspectionInspectorId: inspections.inspectorId,
        inspectionIsSolo:    inspections.isSolo,
        inspectionClientId:  inspections.clientId,
        bookingClientId:     bookings.clientId,
      })
      .from(inspectionConditions)
      .innerJoin(inspections, eq(inspections.id, inspectionConditions.inspectionId))
      .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
      .where(eq(inspectionConditions.id, conditionId))
      .limit(1);

    if (!condition) {
      return { history: [], error: 'Condition not found' };
    }

    if (user.role !== 'admin') {
      const isInspectorOwner =
        user.role === 'inspector' && condition.inspectionInspectorId === user.id;
      const isClientOwner =
        user.role === 'client' &&
        (condition.inspectionIsSolo
          ? condition.inspectionClientId === user.id
          : condition.bookingClientId === user.id);

      if (!isInspectorOwner && !isClientOwner) {
        return { history: [], error: 'Access denied' };
      }
    }

    let events: any[];
    try {
      events = await db
        .select({
          id:            revisionEvents.id,
          action:        revisionEvents.action,
          field:         revisionEvents.field,
          previousValue: revisionEvents.previousValue,
          newValue:      revisionEvents.newValue,
          changedAt:     revisionEvents.changedAt,
          changedBy:     revisionEvents.changedBy,
          userFullName:  users.fullName,
        })
        .from(revisionEvents)
        .leftJoin(users, eq(users.id, revisionEvents.changedBy))
        .where(and(
          eq(revisionEvents.entityId, conditionId),
          eq(revisionEvents.entityType, 'condition'),
        ))
        .orderBy(desc(revisionEvents.changedAt));
    } catch (err) {
      logger.error({ err, conditionId }, 'ConditionService.getHistory failed');
      return { history: [], error: 'Failed to load condition history' };
    }

    const history = events.map((e) => ({
      id: String(e.id),
      action: e.action,
      field: e.field,
      oldValue: e.previousValue,
      newValue: e.newValue,
      changedAt: toIso(e.changedAt) ?? '',
      changedBy: e.userFullName ?? 'Unknown',
    })) as ConditionHistory[];

    return { history, error: null };
  }
}
