import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { observations, inspectionConditions, inspections } from '../db/schema.js';
import { RevisionService } from './RevisionService.js';
import { logger } from '../lib/logger.js';

export interface CreateObservationData {
  conditionId: string;
  text: string;
}

export interface Observation {
  id: string;
  conditionId: string;
  inspectionId: string;
  addedBy: string;
  addedByRole: string;
  text: string;
  isDeleted: boolean;
  createdAt: string;
  editedAt: string | null;
}

const INSPECTOR_STATUSES = ['draft', 'in_progress', 'flagged'];
const ADMIN_STATUSES     = ['draft', 'in_progress', 'pending_review', 'approved', 'flagged', 'revised'];

function shape(row: any): Observation {
  return {
    id:           row.id,
    conditionId:  row.conditionId,
    inspectionId: row.inspectionId,
    addedBy:      row.addedBy,
    addedByRole:  row.addedByRole,
    text:         row.text,
    isDeleted:    row.isDeleted,
    createdAt:    row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    editedAt:     row.editedAt instanceof Date ? row.editedAt.toISOString() : (row.editedAt ?? null),
  };
}

export class ObservationService {
  static async create(user: { id: string; role: string }, data: CreateObservationData) {
    // Verify condition exists, get inspection info
    const [row] = await db
      .select({
        conditionId:  inspectionConditions.id,
        inspectionId: inspectionConditions.inspectionId,
        inspectorId:  inspections.inspectorId,
        status:       inspections.status,
      })
      .from(inspectionConditions)
      .innerJoin(inspections, eq(inspections.id, inspectionConditions.inspectionId))
      .where(eq(inspectionConditions.id, data.conditionId))
      .limit(1);

    if (!row) return { observation: null, error: 'Condition not found' };

    if (user.role === 'inspector' && row.inspectorId !== user.id) {
      return { observation: null, error: 'You do not have access to this condition' };
    }

    const allowed = user.role === 'admin' ? ADMIN_STATUSES : INSPECTOR_STATUSES;
    if (!row.status || !allowed.includes(row.status)) {
      return { observation: null, error: 'Cannot add observation in current inspection status' };
    }

    let inserted: any;
    try {
      [inserted] = await db
        .insert(observations)
        .values({
          conditionId:  data.conditionId,
          inspectionId: row.inspectionId,
          addedBy:      user.id,
          addedByRole:  user.role as 'inspector' | 'admin',
          text:         data.text,
          isDeleted:    false,
        })
        .returning();
    } catch (err) {
      logger.error({ err, conditionId: data.conditionId, userId: user.id }, 'ObservationService.create failed');
      return { observation: null, error: 'Failed to create observation' };
    }

    // Bump observation_count on the condition
    await db
      .update(inspectionConditions)
      .set({ observationCount: sql`COALESCE(${inspectionConditions.observationCount}, 0) + 1` })
      .where(eq(inspectionConditions.id, data.conditionId));

    await RevisionService.log({
      inspectionId: row.inspectionId,
      entityType: 'observation',
      entityId: inserted.id,
      action: 'created',
      newValue: { text: data.text },
      changedBy: user.id,
    });

    return { observation: shape(inserted), error: null };
  }

  static async update(user: { id: string; role: string }, observationId: string, text: string) {
    const [row] = await db
      .select({
        id:            observations.id,
        addedBy:       observations.addedBy,
        addedByRole:   observations.addedByRole,
        inspectionId:  observations.inspectionId,
        text:          observations.text,
        status:        inspections.status,
      })
      .from(observations)
      .innerJoin(inspections, eq(inspections.id, observations.inspectionId))
      .where(eq(observations.id, observationId))
      .limit(1);

    if (!row) return { observation: null, error: 'Observation not found' };

    if (user.role === 'inspector' && row.addedByRole === 'admin') {
      return { observation: null, error: 'Inspectors cannot edit admin observations' };
    }
    if (user.role === 'admin' && row.addedByRole === 'inspector') {
      return { observation: null, error: 'Admins cannot edit inspector observations' };
    }
    if (row.addedBy !== user.id) {
      return { observation: null, error: 'Only the original author can update this observation' };
    }

    const allowed = user.role === 'admin' ? ADMIN_STATUSES : INSPECTOR_STATUSES;
    if (!row.status || !allowed.includes(row.status)) {
      return { observation: null, error: 'Cannot update observation in current inspection status' };
    }

    let updated: any;
    try {
      [updated] = await db
        .update(observations)
        .set({ text, editedAt: new Date(), editedBy: user.id })
        .where(eq(observations.id, observationId))
        .returning();
    } catch (err) {
      logger.error({ err, observationId, userId: user.id }, 'ObservationService.update failed');
      return { observation: null, error: 'Failed to update observation' };
    }

    await RevisionService.log({
      inspectionId: row.inspectionId,
      entityType: 'observation',
      entityId: observationId,
      action: 'updated',
      field: 'text',
      previousValue: { text: row.text },
      newValue: { text },
      changedBy: user.id,
    });

    return { observation: shape(updated), error: null };
  }

  static async delete(user: { id: string; role: string }, observationId: string) {
    const [row] = await db
      .select({
        id:           observations.id,
        conditionId:  observations.conditionId,
        addedBy:      observations.addedBy,
        inspectionId: observations.inspectionId,
        status:       inspections.status,
      })
      .from(observations)
      .innerJoin(inspections, eq(inspections.id, observations.inspectionId))
      .where(eq(observations.id, observationId))
      .limit(1);

    if (!row) return { success: false, error: 'Observation not found' };

    if (user.role !== 'admin' && row.addedBy !== user.id) {
      return { success: false, error: 'You do not have permission to delete this observation' };
    }

    const allowed = user.role === 'admin' ? ADMIN_STATUSES : INSPECTOR_STATUSES;
    if (!row.status || !allowed.includes(row.status)) {
      return { success: false, error: 'Cannot delete observation in current inspection status' };
    }

    try {
      await db
        .update(observations)
        .set({ isDeleted: true })
        .where(eq(observations.id, observationId));
    } catch (err) {
      logger.error({ err, observationId, userId: user.id }, 'ObservationService.delete failed');
      return { success: false, error: 'Failed to delete observation' };
    }

    await db
      .update(inspectionConditions)
      .set({ observationCount: sql`GREATEST(COALESCE(${inspectionConditions.observationCount}, 0) - 1, 0)` })
      .where(eq(inspectionConditions.id, row.conditionId));

    await RevisionService.log({
      inspectionId: row.inspectionId,
      entityType: 'observation',
      entityId: observationId,
      action: 'deleted',
      changedBy: user.id,
    });

    return { success: true, error: null };
  }
}
