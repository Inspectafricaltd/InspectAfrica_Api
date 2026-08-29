import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  inspections, inspectionConditions, inspectionPhotos,
  additionalObservations, photoAnnotations,
} from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { getSignedUploadUrl } from '../lib/storage.js';

export interface SignUploadData {
  conditionId?: string;
  observationId?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  /** Optional UUID for the new photo row, supplied by the offline-queue
   *  client so the photo can be referenced by id before sync. */
  clientId?: string;
}

export interface ConfirmUploadData {
  thumbPath?: string;
  width: number;
  height: number;
}

export interface Photo {
  id: string;
  conditionId: string;
  inspectionId: string;
  takenBy: string;
  storagePath: string;
  thumbPath: string | null;
  width: number | null;
  height: number | null;
  uploadStatus: string;
  mimeType: string;
  fileSizeBytes: number | null;
  createdAt: string;
}

const EDITABLE_STATUSES = ['draft', 'in_progress', 'flagged'];
const ANNOTATABLE_STATUSES = ['draft', 'in_progress', 'flagged', 'pending_review', 'revised'];

export class PhotoService {
  static async getSignedUploadUrl(inspectorId: string, data: SignUploadData) {
    if (Boolean(data.conditionId) === Boolean(data.observationId)) {
      return { uploadUrl: null, photoId: null, storagePath: null, error: 'Provide exactly one of conditionId or observationId' };
    }

    let inspectionId: string;
    let parentScope: 'conditions' | 'observations';
    let parentId: string;

    if (data.conditionId) {
      const [row] = await db
        .select({
          condId:       inspectionConditions.id,
          inspectionId: inspectionConditions.inspectionId,
          photoCount:   inspectionConditions.photoCount,
          inspectorId:  inspections.inspectorId,
          status:       inspections.status,
        })
        .from(inspectionConditions)
        .innerJoin(inspections, eq(inspections.id, inspectionConditions.inspectionId))
        .where(eq(inspectionConditions.id, data.conditionId))
        .limit(1);

      if (!row) return { uploadUrl: null, photoId: null, storagePath: null, error: 'Condition not found' };
      if (row.inspectorId !== inspectorId) {
        return { uploadUrl: null, photoId: null, storagePath: null, error: 'You do not have access to this condition' };
      }
      if (!row.status || !EDITABLE_STATUSES.includes(row.status)) {
        return { uploadUrl: null, photoId: null, storagePath: null, error: 'Cannot upload photo in current inspection status' };
      }
      if ((row.photoCount ?? 0) >= 5) {
        return { uploadUrl: null, photoId: null, storagePath: null, error: 'Maximum 5 photos per item' };
      }

      inspectionId = row.inspectionId;
      parentScope = 'conditions';
      parentId = data.conditionId;
    } else {
      const [row] = await db
        .select({
          obsId:        additionalObservations.id,
          inspectionId: additionalObservations.inspectionId,
          inspectorId:  inspections.inspectorId,
          status:       inspections.status,
        })
        .from(additionalObservations)
        .innerJoin(inspections, eq(inspections.id, additionalObservations.inspectionId))
        .where(eq(additionalObservations.id, data.observationId!))
        .limit(1);

      if (!row) return { uploadUrl: null, photoId: null, storagePath: null, error: 'Observation not found' };
      if (row.inspectorId !== inspectorId) {
        return { uploadUrl: null, photoId: null, storagePath: null, error: 'You do not have access to this observation' };
      }
      if (!row.status || !EDITABLE_STATUSES.includes(row.status)) {
        return { uploadUrl: null, photoId: null, storagePath: null, error: 'Cannot upload photo in current inspection status' };
      }

      inspectionId = row.inspectionId;
      parentScope = 'observations';
      parentId = data.observationId!;
    }

    // Use client-supplied UUID when present (offline queue replay), otherwise mint a new one
    const photoId = data.clientId ?? randomUUID();
    const storagePath = `inspections/${inspectionId}/${parentScope}/${parentId}/full/${photoId}.webp`;

    const signed = await getSignedUploadUrl('inspection-photos', storagePath, 300, data.mimeType);
    if (!signed) {
      logger.error({ parentId, inspectorId }, 'PhotoService.getSignedUploadUrl failed');
      return { uploadUrl: null, photoId: null, storagePath: null, error: 'Failed to generate upload URL' };
    }

    try {
      await db.insert(inspectionPhotos).values({
        id:            photoId,
        conditionId:   parentScope === 'conditions' ? parentId : null,
        observationId: parentScope === 'observations' ? parentId : null,
        inspectionId,
        takenBy:       inspectorId,
        storagePath,
        thumbPath:     null,
        width:         null,
        height:        null,
        uploadStatus:  'pending',
        mimeType:      data.mimeType,
        fileSizeBytes: data.fileSizeBytes,
      }).onConflictDoNothing({ target: inspectionPhotos.id });
    } catch (err) {
      logger.error({ err, photoId, parentId }, 'PhotoService.insert failed');
      return { uploadUrl: null, photoId: null, storagePath: null, error: 'Failed to create photo record' };
    }

    return { uploadUrl: signed.signedUrl, photoId, storagePath, error: null };
  }

  static async confirmUpload(inspectorId: string, photoId: string, data: ConfirmUploadData) {
    const [photo] = await db
      .select({
        id:           inspectionPhotos.id,
        takenBy:      inspectionPhotos.takenBy,
        storagePath:  inspectionPhotos.storagePath,
        inspectorId:  inspections.inspectorId,
        status:       inspections.status,
      })
      .from(inspectionPhotos)
      .innerJoin(inspections, eq(inspections.id, inspectionPhotos.inspectionId))
      .where(eq(inspectionPhotos.id, photoId))
      .limit(1);

    if (!photo) return { photo: null, error: 'Photo not found' };
    if (photo.takenBy !== inspectorId) return { photo: null, error: 'You did not take this photo' };
    if (!photo.status || !EDITABLE_STATUSES.includes(photo.status)) {
      return { photo: null, error: 'Cannot confirm photo in current inspection status' };
    }

    let updated: any;
    try {
      [updated] = await db
        .update(inspectionPhotos)
        .set({
          thumbPath:    data.thumbPath ?? photo.storagePath,
          width:        data.width,
          height:       data.height,
          uploadStatus: 'done',
        })
        .where(eq(inspectionPhotos.id, photoId))
        .returning();
    } catch (err) {
      logger.error({ err, photoId }, 'PhotoService.confirmUpload failed');
      return { photo: null, error: 'Failed to confirm upload' };
    }

    if (updated.conditionId) {
      await db
        .update(inspectionConditions)
        .set({ photoCount: sql`COALESCE(${inspectionConditions.photoCount}, 0) + 1` })
        .where(eq(inspectionConditions.id, updated.conditionId));
    }

    return { photo: shapePhoto(updated), error: null };
  }

  static async delete(inspectorId: string, photoId: string) {
    const [photo] = await db
      .select({
        id:          inspectionPhotos.id,
        conditionId: inspectionPhotos.conditionId,
        takenBy:     inspectionPhotos.takenBy,
        inspectorId: inspections.inspectorId,
        status:      inspections.status,
      })
      .from(inspectionPhotos)
      .innerJoin(inspections, eq(inspections.id, inspectionPhotos.inspectionId))
      .where(eq(inspectionPhotos.id, photoId))
      .limit(1);

    if (!photo) return { success: false, error: 'Photo not found' };
    if (photo.inspectorId !== inspectorId) return { success: false, error: 'You do not have access to this photo' };
    if (!photo.status || !EDITABLE_STATUSES.includes(photo.status)) {
      return { success: false, error: 'Cannot delete photo in current inspection status' };
    }

    try {
      await db
        .update(inspectionPhotos)
        .set({ isDeleted: true })
        .where(eq(inspectionPhotos.id, photoId));
    } catch (err) {
      logger.error({ err, photoId }, 'PhotoService.delete failed');
      return { success: false, error: 'Failed to delete photo' };
    }

    if (photo.conditionId) {
      await db
        .update(inspectionConditions)
        .set({ photoCount: sql`GREATEST(COALESCE(${inspectionConditions.photoCount}, 0) - 1, 0)` })
        .where(eq(inspectionConditions.id, photo.conditionId));
    }

    return { success: true, error: null };
  }

  static async upsertAnnotation(inspectorId: string, photoId: string, shapes: Record<string, unknown>[]) {
    const [photo] = await db
      .select({
        id:          inspectionPhotos.id,
        inspectorId: inspections.inspectorId,
        status:      inspections.status,
      })
      .from(inspectionPhotos)
      .innerJoin(inspections, eq(inspections.id, inspectionPhotos.inspectionId))
      .where(eq(inspectionPhotos.id, photoId))
      .limit(1);

    if (!photo) return { annotation: null, error: 'Photo not found' };
    if (photo.inspectorId !== inspectorId) return { annotation: null, error: 'You do not have access to this photo' };
    if (!photo.status || !ANNOTATABLE_STATUSES.includes(photo.status)) {
      return { annotation: null, error: 'Cannot annotate photo in current inspection status' };
    }

    try {
      const [annotation] = await db
        .insert(photoAnnotations)
        .values({ photoId, shapes: shapes as any, createdBy: inspectorId })
        .onConflictDoUpdate({
          target: photoAnnotations.photoId,
          set:    { shapes: shapes as any, updatedAt: new Date() },
        })
        .returning();
      return { annotation, error: null };
    } catch (err) {
      logger.error({ err, photoId }, 'PhotoService.upsertAnnotation failed');
      return { annotation: null, error: 'Failed to save annotation' };
    }
  }
}

function shapePhoto(row: any): Photo {
  return {
    id:            row.id,
    conditionId:   row.conditionId ?? '',
    inspectionId:  row.inspectionId,
    takenBy:       row.takenBy,
    storagePath:   row.storagePath,
    thumbPath:     row.thumbPath,
    width:         row.width,
    height:        row.height,
    uploadStatus:  row.uploadStatus,
    mimeType:      row.mimeType,
    fileSizeBytes: row.fileSizeBytes,
    createdAt:     row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}
