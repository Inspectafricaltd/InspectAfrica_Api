import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { aliasedTable } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  additionalObservations,
  bookings,
  inspectionConditions,
  inspectionLimitations,
  inspectionPhotos,
  inspectionSections,
  inspections,
  inspectorProfiles,
  masterConditions,
  masterSections,
  observations,
  photoAnnotations,
  tokenLedger,
  users,
} from '../db/schema.js';
import { NotificationService } from './NotificationService.js';
import { RevisionService } from './RevisionService.js';
import { TemplateService } from './TemplateService.js';
import { logger } from '../lib/logger.js';
import { broadcast, broadcastToRole } from '../lib/eventBus.js';
import { getSignedDownloadUrl } from '../lib/storage.js';

export interface Inspection {
  id: string;
  bookingId: string | null;
  inspectorId: string;
  clientId: string | null;
  isSolo: boolean;
  propertyAddress: string | null;
  propertyType: string | null;
  inspectionType: string | null;
  state: string | null;
  lga: string | null;
  notes: string | null;
  status: string;
  startedAt: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  flaggedAt: string | null;
  flaggedBy: string | null;
  flagReason: string | null;
  createdAt: string;
  updatedAt: string;
  sections?: InspectionSection[];
}

export interface InspectionSection {
  id: string;
  inspectionId: string;
  name: string;
  displayOrder: number;
  status: string;
  completedAt: string | null;
  conditions?: InspectionCondition[];
}

export interface InspectionCondition {
  id: string;
  sectionId: string;
  inspectionId: string;
  name: string;
  displayOrder: number;
  severity: string | null;
  isComplete: boolean;
  photoCount: number;
  observationCount: number;
}

export interface CreateSoloData {
  propertyAddress: string;
  propertyType: 'residential' | 'commercial' | 'land';
  inspectionType: string;
  state: string;
  lga: string;
  country?: string;
  notes?: string;
  buildingType?: string;
  occupancyStatus?: string;
  inAttendance?: string[];
  inspectionConstraints?: string[];
  otherBuildingType?: string;
  otherInAttendance?: string;
  otherConstraints?: string;
}

function toIso(v: any): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Shape an inspection row coming straight out of Drizzle into the snake_case
 * envelope that downstream callers (routes, ReportService, frontend) still
 * expect. Earlier REST queries returned snake_case and all clients were
 * built on top of that — preserving the contract avoids touching every
 * consumer.
 */
function shapeInspectionRow(row: any) {
  return {
    id:                  row.id,
    booking_id:          row.bookingId ?? null,
    inspector_id:        row.inspectorId,
    client_id:           row.clientId ?? null,
    is_solo:             row.isSolo,
    property_address:    row.propertyAddress ?? null,
    property_type:       row.propertyType ?? null,
    inspection_type:     row.inspectionType ?? null,
    state:               row.state ?? null,
    lga:                 row.lga ?? null,
    country:             row.country ?? null,
    notes:               row.notes ?? null,
    status:              row.status,
    cover_photo_path:    row.coverPhotoPath ?? null,
    weather_snapshot:    row.weatherSnapshot ?? null,
    started_at:          toIso(row.startedAt),
    submitted_at:        toIso(row.submittedAt),
    approved_at:         toIso(row.approvedAt),
    approved_by:         row.approvedBy ?? null,
    flagged_at:          toIso(row.flaggedAt),
    flagged_by:          row.flaggedBy ?? null,
    flag_reason:         row.flagReason ?? null,
    revision_requested_at: toIso(row.revisionRequestedAt),
    revision_notes:      row.revisionNotes ?? null,
    created_at:          toIso(row.createdAt),
    updated_at:          toIso(row.updatedAt),
    building_type:       row.buildingType ?? null,
    occupancy_status:    row.occupancyStatus ?? null,
    in_attendance:       row.inAttendance ?? null,
    inspection_constraints: row.inspectionConstraints ?? null,
    other_building_type: row.otherBuildingType ?? null,
    other_in_attendance: row.otherInAttendance ?? null,
    other_constraints:   row.otherConstraints ?? null,
  };
}

/**
 * Selection set used by the public list/getById routes. Mirrors the original
 * INSPECTION_SELECT column list.
 */
const inspectionFields = {
  id:                  inspections.id,
  bookingId:           inspections.bookingId,
  inspectorId:         inspections.inspectorId,
  clientId:            inspections.clientId,
  isSolo:              inspections.isSolo,
  propertyAddress:     inspections.propertyAddress,
  propertyType:        inspections.propertyType,
  inspectionType:      inspections.inspectionType,
  state:               inspections.state,
  lga:                 inspections.lga,
  country:             inspections.country,
  notes:               inspections.notes,
  status:              inspections.status,
  coverPhotoPath:      inspections.coverPhotoPath,
  weatherSnapshot:     inspections.weatherSnapshot,
  startedAt:           inspections.startedAt,
  submittedAt:         inspections.submittedAt,
  approvedAt:          inspections.approvedAt,
  approvedBy:          inspections.approvedBy,
  flaggedAt:           inspections.flaggedAt,
  flaggedBy:           inspections.flaggedBy,
  flagReason:          inspections.flagReason,
  revisionRequestedAt: inspections.revisionRequestedAt,
  revisionNotes:       inspections.revisionNotes,
  createdAt:           inspections.createdAt,
  updatedAt:           inspections.updatedAt,
  buildingType:        inspections.buildingType,
  occupancyStatus:     inspections.occupancyStatus,
  inAttendance:        inspections.inAttendance,
  inspectionConstraints: inspections.inspectionConstraints,
  otherBuildingType:   inspections.otherBuildingType,
  otherInAttendance:   inspections.otherInAttendance,
  otherConstraints:    inspections.otherConstraints,
};

export class InspectionService {
  /**
   * Create an inspection linked to a booking (existing flow)
   */
  static async create(
    inspectorId: string,
    bookingId: string,
    metadata?: Partial<CreateSoloData>
  ) {
    // Verify booking exists, is in_progress, and belongs to this inspector
    const [booking] = await db
      .select({
        id:                  bookings.id,
        status:              bookings.status,
        inspectorId:         bookings.inspectorId,
        clientId:            bookings.clientId,
        inspectionType:      bookings.inspectionType,
        clientPaymentStatus: bookings.clientPaymentStatus,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) {
      return { inspection: null, error: 'Booking not found' };
    }

    if (booking.inspectorId !== inspectorId) {
      return { inspection: null, error: 'This booking is not assigned to you' };
    }

    if (booking.status !== 'confirmed' && booking.status !== 'in_progress') {
      return { inspection: null, error: 'Booking must be confirmed or in progress to start inspection' };
    }

    // Same gate as BookingService.start. This is the other way an inspection
    // begins — it transitions the booking to in_progress itself just below, so
    // gating only `start` would leave the rule trivially bypassable.
    if (booking.clientPaymentStatus !== 'paid') {
      return { inspection: null, error: 'Payment must be confirmed before the inspection can start' };
    }

    // Transition booking to in_progress if it's confirmed
    if (booking.status === 'confirmed') {
      try {
        await db
          .update(bookings)
          .set({ status: 'in_progress' })
          .where(and(eq(bookings.id, bookingId), eq(bookings.status, 'confirmed')));
      } catch (startError) {
        logger.error({ err: startError, bookingId, inspectorId }, 'InspectionService.create: failed to start booking');
        return { inspection: null, error: 'Failed to start booking' };
      }
    }

    // Check if inspection already exists for this booking
    const [existingInspection] = await db
      .select({ id: inspections.id })
      .from(inspections)
      .where(eq(inspections.bookingId, bookingId))
      .limit(1);

    if (existingInspection) {
      return { inspection: null, error: 'Inspection already exists for this booking' };
    }

    // Create inspection record
    let inspection: any;
    try {
      const inserted = await db
        .insert(inspections)
        .values({
          bookingId:             bookingId,
          inspectorId:           inspectorId,
          clientId:              booking.clientId,
          isSolo:                false,
          status:                'draft',
          buildingType:          metadata?.buildingType ?? null,
          occupancyStatus:       metadata?.occupancyStatus ?? null,
          inAttendance:          metadata?.inAttendance ?? null,
          inspectionConstraints: metadata?.inspectionConstraints ?? null,
          otherBuildingType:     metadata?.otherBuildingType ?? null,
          otherInAttendance:     metadata?.otherInAttendance ?? null,
          otherConstraints:      metadata?.otherConstraints ?? null,
        })
        .returning(inspectionFields);
      inspection = inserted[0];
      if (!inspection) throw new Error('insert returned no row');
    } catch (inspectionError) {
      logger.error({ err: inspectionError, bookingId, inspectorId }, 'InspectionService.create failed');
      return { inspection: null, error: 'Failed to create inspection' };
    }

    // Create sections and conditions from template (use booking's inspection type)
    const tmplResult = await this.createSectionsFromTemplate(
      inspection.id,
      booking.inspectionType || 'shi'
    );
    if (tmplResult.error) {
      await this.rollbackInspection(inspection.id);
      return { inspection: null, error: tmplResult.error };
    }

    // Write revision event
    await RevisionService.log({
      inspectionId: inspection.id,
      entityType: 'inspection',
      entityId: inspection.id,
      action: 'created',
      changedBy: inspectorId,
    });

    // Fetch the complete inspection with sections and conditions
    return this.getById({ id: inspectorId, role: 'inspector' }, inspection.id);
  }

  /**
   * Create a solo inspection (no booking, no client).
   * Solo inspections are the inspector's own work — no client commitment — so ACHI
   * certification is not required. We only need the user to hold the 'inspector' role,
   * which the route middleware already enforces.
   *
   * If the inspector_profiles row is missing (can happen after a partial registration),
   * we upsert a candidate profile so the inspector can still work.
   */
  static async createSolo(inspectorId: string, data: CreateSoloData, clientId?: string) {
    // Ensure the inspector_profiles row exists (upsert if missing due to registration edge-case)
    try {
      await db
        .insert(inspectorProfiles)
        .values({ userId: inspectorId, achiStatus: 'candidate', isActive: true })
        .onConflictDoNothing({ target: inspectorProfiles.userId });
    } catch (upsertError) {
      logger.warn({ err: upsertError, inspectorId }, 'InspectionService.createSolo: profile upsert failed (non-fatal)');
    }

    // Create solo inspection — starts in_progress immediately
    let inspection: any;
    try {
      const inserted = await db
        .insert(inspections)
        .values({
          ...(clientId ? { id: clientId } : {}),
          bookingId:            null,
          inspectorId:          inspectorId,
          clientId:             null,
          isSolo:               true,
          propertyAddress:      data.propertyAddress,
          propertyType:         data.propertyType,
          inspectionType:       data.inspectionType as any,
          state:                data.state,
          lga:                  data.lga,
          country:              data.country ?? null,
          notes:                data.notes ?? null,
          status:               'in_progress',
          startedAt:            new Date(),
          buildingType:         data.buildingType ?? null,
          occupancyStatus:      data.occupancyStatus ?? null,
          inAttendance:         data.inAttendance ?? null,
          inspectionConstraints: data.inspectionConstraints ?? null,
          otherBuildingType:    data.otherBuildingType ?? null,
          otherInAttendance:    data.otherInAttendance ?? null,
          otherConstraints:     data.otherConstraints ?? null,
        })
        .onConflictDoNothing({ target: inspections.id })
        .returning(inspectionFields);
      inspection = inserted[0];
      // Replay-idempotency: if a queued create lands twice, return the
      // existing row instead of erroring. The client-supplied UUID is the
      // primary key, so the lookup must be scoped to this inspector's own
      // solo inspections — otherwise any inspector could pass a foreign
      // inspection id and read it back without consuming a token.
      if (!inspection && clientId) {
        const [existingRow] = await db
          .select(inspectionFields)
          .from(inspections)
          .where(and(
            eq(inspections.id, clientId),
            eq(inspections.inspectorId, inspectorId),
            eq(inspections.isSolo, true),
          ))
          .limit(1);
        inspection = existingRow;
        if (inspection) return { inspection: shapeInspectionRow(inspection), error: null };
        logger.warn(
          { inspectorId, clientId },
          'InspectionService.createSolo: clientId collides with an inspection this inspector does not own'
        );
        return { inspection: null, error: 'Failed to create solo inspection' };
      }
      if (!inspection) throw new Error('insert returned no row');
    } catch (inspectionError) {
      logger.error({ err: inspectionError, inspectorId }, 'InspectionService.createSolo failed');
      return { inspection: null, error: 'Failed to create solo inspection' };
    }

    // Consume one token — atomic, raises insufficient_tokens if balance = 0
    const tokenError = await this.consumeSoloToken(inspectorId, inspection.id);

    if (tokenError) {
      await this.rollbackInspection(inspection.id);
      if (tokenError === 'insufficient_tokens') {
        return { inspection: null, error: 'insufficient_tokens' };
      }
      logger.error({ err: tokenError, inspectorId }, 'InspectionService.createSolo: token consume failed');
      return { inspection: null, error: 'Failed to consume token' };
    }

    // Create sections and conditions from template (use solo inspection's type)
    const tmplResult = await this.createSectionsFromTemplate(
      inspection.id,
      data.inspectionType || 'shi'
    );
    if (tmplResult.error) {
      await this.rollbackInspection(inspection.id);
      return { inspection: null, error: tmplResult.error };
    }

    // Write revision event
    await RevisionService.log({
      inspectionId: inspection.id,
      entityType: 'inspection',
      entityId: inspection.id,
      action: 'created',
      newValue: { is_solo: true },
      changedBy: inspectorId,
    });

    return { inspection: { id: inspection.id } as Inspection, error: null };
  }

  static async updateMetadata(
    inspectorId: string,
    inspectionId: string,
    data: Partial<CreateSoloData>
  ) {
    // Verify inspection belongs to this inspector
    const [inspection] = await db
      .select({ inspectorId: inspections.inspectorId })
      .from(inspections)
      .where(eq(inspections.id, inspectionId))
      .limit(1);

    if (!inspection) {
      return { error: 'Inspection not found' };
    }

    if (inspection.inspectorId !== inspectorId) {
      return { error: 'This inspection does not belong to you' };
    }

    // Update metadata fields
    try {
      await db
        .update(inspections)
        .set({
          buildingType:         data.buildingType ?? null,
          occupancyStatus:      data.occupancyStatus ?? null,
          inAttendance:         data.inAttendance ?? null,
          inspectionConstraints: data.inspectionConstraints ?? null,
          otherBuildingType:    data.otherBuildingType ?? null,
          otherInAttendance:    data.otherInAttendance ?? null,
          otherConstraints:     data.otherConstraints ?? null,
        })
        .where(eq(inspections.id, inspectionId));

      // Write revision event
      await RevisionService.log({
        inspectionId: inspectionId,
        entityType: 'inspection',
        entityId: inspectionId,
        action: 'updated',
        newValue: {
          building_type: data.buildingType,
          occupancy_status: data.occupancyStatus,
          in_attendance: data.inAttendance,
          inspection_constraints: data.inspectionConstraints,
        },
        changedBy: inspectorId,
      });

      return { error: null };
    } catch (err) {
      logger.error({ err, inspectionId, inspectorId }, 'InspectionService.updateMetadata failed');
      return { error: 'Failed to update inspection metadata' };
    }
  }

  /**
   * Atomic equivalent of the legacy `consume_solo_token` Postgres function.
   * Returns null on success or an error string ('insufficient_tokens' for the
   * balance gate, anything else for unexpected failures).
   */
  private static async consumeSoloToken(inspectorId: string, inspectionId: string): Promise<string | null> {
    try {
      return await db.transaction(async (tx) => {
        // Serialize check-and-insert per inspector. The balance is an
        // unindexed SUM over ledger rows, so without this two concurrent
        // creations at balance=1 both read 1 and both insert -1, driving the
        // balance negative. The advisory xact lock is released at
        // commit/rollback; the second transaction then re-reads a balance
        // that includes the first one's -1 row.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended('token_ledger:' || ${inspectorId}, 0))`
        );

        const [balanceRow] = await tx
          .select({ balance: sql<number>`COALESCE(SUM(${tokenLedger.delta}), 0)::int` })
          .from(tokenLedger)
          .where(eq(tokenLedger.userId, inspectorId));

        const balance = Number(balanceRow?.balance ?? 0);
        if (balance <= 0) {
          // Mirror the original RPC error semantics — non-null `error` on the caller side.
          throw new Error('insufficient_tokens');
        }

        await tx.insert(tokenLedger).values({
          userId:       inspectorId,
          delta:        -1,
          kind:         'consume',
          inspectionId: inspectionId,
        });

        return null;
      });
    } catch (err: any) {
      if (err?.message === 'insufficient_tokens') return 'insufficient_tokens';
      logger.error({ err, inspectorId, inspectionId }, 'InspectionService.consumeSoloToken failed');
      return err?.message || 'token_consume_failed';
    }
  }

  /**
   * List inspections for a user, with optional filters
   */
  static async list(
    user: { id: string; role: string },
    filters: {
      isSolo?: boolean;
      status?: string;
      page?: number;
      limit?: number;
      inspectorId?: string;
      from?: string;
      to?: string;
      search?: string;
    }
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const conds: any[] = [];

    // Scope by role
    if (user.role === 'inspector') {
      conds.push(eq(inspections.inspectorId, user.id));
    } else if (user.role === 'client') {
      // Client must only see inspections linked to their own bookings.
      // leftJoin with bookings is already in the main query; add join to
      // count query below as well so the WHERE on bookings.clientId resolves.
      conds.push(eq(bookings.clientId, user.id));
    }
    // Admin sees all

    if (filters.isSolo !== undefined) {
      conds.push(eq(inspections.isSolo, filters.isSolo));
    }

    if (filters.status) {
      conds.push(eq(inspections.status, filters.status as any));
    }

    // Admin-only filters
    if (user.role === 'admin') {
      if (filters.inspectorId) conds.push(eq(inspections.inspectorId, filters.inspectorId));
      if (filters.from) conds.push(gte(inspections.createdAt, new Date(filters.from)));
      if (filters.to) conds.push(lte(inspections.createdAt, new Date(filters.to)));
      if (filters.search) {
        const term = `%${filters.search.replace(/[%_]/g, (m) => `\\${m}`)}%`;
        // Only solo inspections carry their own address; for booking-based ones
        // it lives on the booking, so searching just the inspection column
        // silently matched nothing for the majority of records.
        conds.push(or(ilike(inspections.propertyAddress, term), ilike(bookings.propertyAddress, term))!);
      }
    }

    const whereExpr = conds.length > 0 ? and(...conds) : undefined;

    try {
      const [rows, totalRow] = await Promise.all([
        db
          .select({
            ...inspectionFields,
            bookingPropAddress:  bookings.propertyAddress,
            bookingPropCity:     bookings.propertyCity,
            bookingPropType:     bookings.propertyType,
            bookingInspType:     bookings.inspectionType,
            bookingRequestedDate: bookings.requestedDate,
            bookingState:        bookings.state,
            bookingLga:          bookings.lga,
            bookingCountry:      bookings.country,
            bookingId2:          bookings.id,
          })
          .from(inspections)
          .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
          .where(whereExpr)
          .orderBy(desc(inspections.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(inspections)
          .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
          .where(whereExpr),
      ]);

      const data = rows.map((r) => {
        const shaped = shapeInspectionRow(r);
        const hasBooking = r.bookingId2 != null;
        return {
          ...shaped,
          // Solo inspections carry these on the inspection; booking-based ones
          // leave them null and hold them on the booking. Resolve here so every
          // consumer reads one field — the admin Approved tab rendered "N/A" for
          // every booking-based inspection by trusting the top-level column.
          property_address: shaped.property_address ?? r.bookingPropAddress ?? null,
          property_type:    shaped.property_type ?? r.bookingPropType ?? null,
          inspection_type:  shaped.inspection_type ?? r.bookingInspType ?? null,
          state:            shaped.state ?? r.bookingState ?? null,
          lga:              shaped.lga ?? r.bookingLga ?? null,
          country:          shaped.country ?? r.bookingCountry ?? null,
          bookings: hasBooking
            ? {
                id:               r.bookingId2,
                property_address: r.bookingPropAddress,
                property_city:    r.bookingPropCity,
                property_type:    r.bookingPropType,
                inspection_type:  r.bookingInspType,
                requested_date:   r.bookingRequestedDate ? String(r.bookingRequestedDate) : null,
                state:            r.bookingState,
                lga:              r.bookingLga,
                country:          r.bookingCountry,
              }
            : null,
        };
      });

      return { inspections: data, total: totalRow[0]?.count ?? 0, page, limit };
    } catch (err) {
      logger.error({ err, userId: user.id, role: user.role }, 'InspectionService.list failed');
      return { inspections: [], total: 0, page, limit };
    }
  }

  /**
   * Lightweight access-check used by inspector mutations. Avoids the heavy
   * sections + photos hydration that getById performs — a single SELECT to
   * verify the inspection exists, the inspector owns it, and the status is
   * still mutable.
   */
  static async checkInspectorAccess(inspectorId: string, inspectionId: string) {
    const [data] = await db
      .select({
        id:          inspections.id,
        inspectorId: inspections.inspectorId,
        status:      inspections.status,
      })
      .from(inspections)
      .where(eq(inspections.id, inspectionId))
      .limit(1);

    if (!data) return { ok: false, error: 'Inspection not found' as const };
    if (data.inspectorId !== inspectorId) return { ok: false, error: 'Access denied' as const };
    if (!data.status || !['draft', 'in_progress', 'flagged'].includes(data.status)) {
      return { ok: false, error: 'Inspection is not editable in current status' as const };
    }
    return { ok: true, error: null };
  }

  static async getById(user: { id: string; role: string }, inspectionId: string) {
    const [row] = await db
      .select({
        ...inspectionFields,
        bookingClientId:     bookings.clientId,
        bookingPropAddress:  bookings.propertyAddress,
        bookingPropCity:     bookings.propertyCity,
        bookingPropType:     bookings.propertyType,
        bookingInspType:     bookings.inspectionType,
        bookingState:        bookings.state,
        bookingLga:          bookings.lga,
        bookingCountry:      bookings.country,
      })
      .from(inspections)
      .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
      .where(eq(inspections.id, inspectionId))
      .limit(1);

    if (!row) {
      return { inspection: null, error: 'Inspection not found' };
    }

    const shaped: any = shapeInspectionRow(row);
    // Booking-based inspections never copy the property/location fields onto
    // the inspection row (they live on the booking) — without this fallback
    // the inspector's actual inspection-taking screens (SectionList,
    // SectionDetail, ReviewScreen — all read via this endpoint) show no
    // property address, state, or country at all for anything but solo
    // inspections. Mirrors the same fallback InspectionService.list() already
    // does for property_address/property_type/inspection_type.
    shaped.property_address = shaped.property_address ?? row.bookingPropAddress ?? null;
    shaped.property_type    = shaped.property_type    ?? row.bookingPropType    ?? null;
    shaped.inspection_type  = shaped.inspection_type  ?? row.bookingInspType    ?? null;
    shaped.state            = shaped.state            ?? row.bookingState      ?? null;
    shaped.lga              = shaped.lga              ?? row.bookingLga        ?? null;
    shaped.country          = shaped.country          ?? row.bookingCountry    ?? null;
    shaped.bookings = row.bookingClientId != null
      ? {
          client_id:        row.bookingClientId,
          property_address: row.bookingPropAddress,
          property_city:    row.bookingPropCity,
          property_type:    row.bookingPropType,
          inspection_type:  row.bookingInspType,
          state:            row.bookingState,
          lga:              row.bookingLga,
          country:          row.bookingCountry,
        }
      : null;

    // Access control — admins pass through; inspectors must own the inspection;
    // clients must be either the booking's client (non-solo) or the solo
    // inspection's client_id owner.
    if (user.role === 'inspector' && shaped.inspector_id !== user.id) {
      return { inspection: null, error: 'Access denied' };
    }
    if (user.role === 'client') {
      const bookingClientId = shaped.bookings?.client_id ?? null;
      const isOwner = shaped.is_solo
        ? shaped.client_id === user.id
        : bookingClientId === user.id;
      if (!isOwner) {
        return { inspection: null, error: 'Access denied' };
      }
    }

    // Fetch sections with master_section slug
    const sectionRows = await db
      .select({
        id:              inspectionSections.id,
        inspectionId:    inspectionSections.inspectionId,
        masterSectionId: inspectionSections.masterSectionId,
        name:            inspectionSections.name,
        displayOrder:    inspectionSections.displayOrder,
        status:          inspectionSections.status,
        completedAt:     inspectionSections.completedAt,
        createdAt:       inspectionSections.createdAt,
        masterSectionSlug: masterSections.slug,
      })
      .from(inspectionSections)
      .leftJoin(masterSections, eq(masterSections.id, inspectionSections.masterSectionId))
      .where(eq(inspectionSections.inspectionId, inspectionId))
      .orderBy(asc(inspectionSections.displayOrder));

    // Fetch all conditions for this inspection in one go
    const conditionRows = await db
      .select({
        id:                     inspectionConditions.id,
        sectionId:              inspectionConditions.sectionId,
        inspectionId:           inspectionConditions.inspectionId,
        name:                   inspectionConditions.name,
        displayOrder:           inspectionConditions.displayOrder,
        severity:               inspectionConditions.severity,
        isComplete:             inspectionConditions.isComplete,
        photoCount:             inspectionConditions.photoCount,
        observationCount:       inspectionConditions.observationCount,
        masterConditionId:      inspectionConditions.masterConditionId,
        riskSnapshot:           inspectionConditions.riskSnapshot,
        recommendationSnapshot: inspectionConditions.recommendationSnapshot,
        photoRequired:          inspectionConditions.photoRequired,
        clarification:          inspectionConditions.clarification,
        location:               inspectionConditions.location,
        updatedAt:              inspectionConditions.updatedAt,
        createdAt:              inspectionConditions.createdAt,
      })
      .from(inspectionConditions)
      .where(eq(inspectionConditions.inspectionId, inspectionId));

    // Photos for this inspection (covers both condition + observation photos)
    const photos = await db
      .select({
        id:            inspectionPhotos.id,
        conditionId:   inspectionPhotos.conditionId,
        observationId: inspectionPhotos.observationId,
        storagePath:   inspectionPhotos.storagePath,
        thumbPath:     inspectionPhotos.thumbPath,
        width:         inspectionPhotos.width,
        height:        inspectionPhotos.height,
        createdAt:     inspectionPhotos.createdAt,
      })
      .from(inspectionPhotos)
      .where(and(
        eq(inspectionPhotos.inspectionId, inspectionId),
        eq(inspectionPhotos.isDeleted, false),
        eq(inspectionPhotos.uploadStatus, 'done'),
      ))
      .orderBy(asc(inspectionPhotos.createdAt));

    // Sign all photo URLs in bulk (private bucket).
    const allPaths: string[] = [];
    for (const p of photos) {
      if (p.storagePath) allPaths.push(p.storagePath);
    }
    const signedUrlByPath = new Map<string, string>();
    if (allPaths.length > 0) {
      // R2 has no batch sign — fan out in parallel (tens of paths is fine)
      await Promise.all(allPaths.map(async (p) => {
        const url = await getSignedDownloadUrl('inspection-photos', p, 3600);
        if (url) signedUrlByPath.set(p, url);
      }));
    }

    // Annotations for any of those photos.
    const photoIds = photos.map((p) => p.id);
    const annotationsByPhotoId = new Map<string, any>();
    if (photoIds.length > 0) {
      const anns = await db
        .select({ photoId: photoAnnotations.photoId, shapes: photoAnnotations.shapes })
        .from(photoAnnotations)
        .where(inArray(photoAnnotations.photoId, photoIds));
      for (const a of anns) {
        annotationsByPhotoId.set(a.photoId, a.shapes);
      }
    }

    const photosByCondition = new Map<string, any[]>();
    const photosByObservation = new Map<string, any[]>();
    for (const p of photos) {
      const enriched = {
        id: p.id,
        url: p.storagePath ? signedUrlByPath.get(p.storagePath) ?? null : null,
        width: p.width,
        height: p.height,
        annotations: annotationsByPhotoId.get(p.id) ?? null,
        created_at: toIso(p.createdAt),
      };
      if (p.conditionId) {
        const arr = photosByCondition.get(p.conditionId) || [];
        arr.push(enriched);
        photosByCondition.set(p.conditionId, arr);
      } else if (p.observationId) {
        const arr = photosByObservation.get(p.observationId) || [];
        arr.push(enriched);
        photosByObservation.set(p.observationId, arr);
      }
    }

    // Additional observations
    const additionalObs = await db
      .select({
        id:           additionalObservations.id,
        inspectionId: additionalObservations.inspectionId,
        sectionSlug:  additionalObservations.sectionSlug,
        title:        additionalObservations.title,
        description:  additionalObservations.description,
        createdAt:    additionalObservations.createdAt,
        updatedAt:    additionalObservations.updatedAt,
      })
      .from(additionalObservations)
      .where(eq(additionalObservations.inspectionId, inspectionId))
      .orderBy(asc(additionalObservations.createdAt));

    const additionalObsWithPhotos = additionalObs.map((o) => ({
      id:            o.id,
      inspection_id: o.inspectionId,
      section_slug:  o.sectionSlug,
      title:         o.title,
      description:   o.description,
      created_at:    toIso(o.createdAt),
      updated_at:    toIso(o.updatedAt),
      photos:        photosByObservation.get(o.id) ?? [],
    }));

    // Group conditions by section_id and shape into snake_case
    const conditionsBySection = new Map<string, any[]>();
    for (const c of conditionRows) {
      const shapedC: any = {
        id:                      c.id,
        section_id:              c.sectionId,
        inspection_id:           c.inspectionId,
        name:                    c.name,
        display_order:           c.displayOrder,
        severity:                c.severity,
        is_complete:             c.isComplete,
        photo_count:             c.photoCount,
        observation_count:       c.observationCount,
        master_condition_id:     c.masterConditionId,
        risk_snapshot:           c.riskSnapshot,
        recommendation_snapshot: c.recommendationSnapshot,
        photo_required:          c.photoRequired,
        clarification:           c.clarification,
        location:                c.location,
        updated_at:              toIso(c.updatedAt),
        created_at:              toIso(c.createdAt),
        photos:                  photosByCondition.get(c.id) ?? [],
      };
      const arr = conditionsBySection.get(c.sectionId) || [];
      arr.push(shapedC);
      conditionsBySection.set(c.sectionId, arr);
    }

    const sectionsWithConditions = sectionRows.map((s) => {
      const sConditions = (conditionsBySection.get(s.id) || []).sort(
        (a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0)
      );
      return {
        id:                  s.id,
        inspection_id:       s.inspectionId,
        master_section_id:   s.masterSectionId,
        name:                s.name,
        display_order:       s.displayOrder,
        status:              s.status,
        completed_at:        toIso(s.completedAt),
        created_at:          toIso(s.createdAt),
        master_section_slug: s.masterSectionSlug ?? null,
        conditions:          sConditions,
      };
    });

    // Sign the cover photo URL if present
    let cover_photo_url: string | null = null;
    const coverPath = shaped.cover_photo_path;
    if (coverPath) {
      cover_photo_url = await getSignedDownloadUrl('inspection-photos', coverPath, 3600);
    }

    return {
      inspection: {
        ...shaped,
        cover_photo_url,
        sections: sectionsWithConditions,
        additional_observations: additionalObsWithPhotos,
      } as unknown as Inspection,
      error: null,
    };
  }

  /**
   * Full detail view for admin review — includes observations and photos per condition.
   */
  static async getFullDetail(user: { id: string; role: string }, inspectionId: string) {
    const { inspection, error } = await this.getById(user, inspectionId);
    if (error || !inspection) {
      return { detail: null, error };
    }

    const insp = inspection as any;

    // Fetch all observations for this inspection
    const obsRows = await db
      .select({
        id:          observations.id,
        conditionId: observations.conditionId,
        text:        observations.text,
        addedBy:     observations.addedBy,
        addedByRole: observations.addedByRole,
        createdAt:   observations.createdAt,
        editedAt:    observations.editedAt,
        isDeleted:   observations.isDeleted,
      })
      .from(observations)
      .where(and(
        eq(observations.inspectionId, inspectionId),
        eq(observations.isDeleted, false),
      ))
      .orderBy(asc(observations.createdAt));

    // Fetch all photos for this inspection
    const photoRows = await db
      .select({
        id:          inspectionPhotos.id,
        conditionId: inspectionPhotos.conditionId,
        storagePath: inspectionPhotos.storagePath,
        thumbPath:   inspectionPhotos.thumbPath,
        width:       inspectionPhotos.width,
        height:      inspectionPhotos.height,
        createdAt:   inspectionPhotos.createdAt,
      })
      .from(inspectionPhotos)
      .where(and(
        eq(inspectionPhotos.inspectionId, inspectionId),
        eq(inspectionPhotos.isDeleted, false),
      ))
      .orderBy(asc(inspectionPhotos.createdAt));

    // Group by condition_id
    const obsByCondition = new Map<string, any[]>();
    for (const obs of obsRows) {
      if (!obs.conditionId) continue;
      const shaped = {
        id:            obs.id,
        condition_id:  obs.conditionId,
        text:          obs.text,
        added_by:      obs.addedBy,
        added_by_role: obs.addedByRole,
        created_at:    toIso(obs.createdAt),
        edited_at:     toIso(obs.editedAt),
        is_deleted:    obs.isDeleted,
      };
      const arr = obsByCondition.get(obs.conditionId) || [];
      arr.push(shaped);
      obsByCondition.set(obs.conditionId, arr);
    }

    // Annotations for these photos. The reviewer needs to see the same marks the
    // client's report shows — without them they approve an unmarked photo.
    const detailPhotoIds = photoRows.map((p) => p.id);
    const annotationsByPhotoId = new Map<string, any>();
    if (detailPhotoIds.length > 0) {
      const anns = await db
        .select({ photoId: photoAnnotations.photoId, shapes: photoAnnotations.shapes })
        .from(photoAnnotations)
        .where(inArray(photoAnnotations.photoId, detailPhotoIds));
      for (const a of anns) {
        annotationsByPhotoId.set(a.photoId, a.shapes);
      }
    }

    const photosByCondition = new Map<string, any[]>();
    for (const photo of photoRows) {
      if (!photo.conditionId) continue;
      const arr = photosByCondition.get(photo.conditionId) || [];
      arr.push({
        id:            photo.id,
        condition_id:  photo.conditionId,
        storage_path:  photo.storagePath,
        thumb_path:    photo.thumbPath,
        width:         photo.width,
        height:        photo.height,
        annotations:   annotationsByPhotoId.get(photo.id) ?? null,
        created_at:    toIso(photo.createdAt),
      });
      photosByCondition.set(photo.conditionId, arr);
    }

    // Generate signed URLs in bulk for every photo path (bucket is private).
    // 1-hour expiry is plenty for an admin review session.
    const allPaths: string[] = [];
    for (const p of photoRows) {
      if (p.storagePath) allPaths.push(p.storagePath);
      if (p.thumbPath) allPaths.push(p.thumbPath);
    }

    const signedUrlByPath = new Map<string, string>();
    if (allPaths.length > 0) {
      await Promise.all(allPaths.map(async (p) => {
        const url = await getSignedDownloadUrl('inspection-photos', p, 3600);
        if (url) signedUrlByPath.set(p, url);
      }));
    }

    // Enrich sections with observations and signed photo URLs
    const enrichedSections = (insp.sections || []).map((section: any) => ({
      ...section,
      conditions: (section.conditions || []).map((cond: any) => ({
        ...cond,
        observations: obsByCondition.get(cond.id) || [],
        photos: (photosByCondition.get(cond.id) || []).map((p: any) => ({
          ...p,
          url: p.storage_path ? signedUrlByPath.get(p.storage_path) ?? null : null,
          thumbUrl: p.thumb_path ? signedUrlByPath.get(p.thumb_path) ?? null : null,
        })),
      })),
    }));

    // Get inspector + booking info
    let booking: any = null;
    let inspector: any = null;

    if (insp.booking_id) {
      const clientUser = aliasedTable(users, 'detail_client');
      const [bookingRow] = await db
        .select({
          id:              bookings.id,
          propertyAddress: bookings.propertyAddress,
          propertyCity:    bookings.propertyCity,
          propertyType:    bookings.propertyType,
          inspectionType:  bookings.inspectionType,
          requestedDate:   bookings.requestedDate,
          clientId:        clientUser.id,
          clientFullName:  clientUser.fullName,
          clientEmail:     clientUser.email,
        })
        .from(bookings)
        .leftJoin(clientUser, eq(clientUser.id, bookings.clientId))
        .where(eq(bookings.id, insp.booking_id))
        .limit(1);

      if (bookingRow) {
        booking = {
          id:               bookingRow.id,
          property_address: bookingRow.propertyAddress,
          property_city:    bookingRow.propertyCity,
          property_type:    bookingRow.propertyType,
          inspection_type:  bookingRow.inspectionType,
          requested_date:   bookingRow.requestedDate ? String(bookingRow.requestedDate) : null,
          client: bookingRow.clientId
            ? { id: bookingRow.clientId, full_name: bookingRow.clientFullName, email: bookingRow.clientEmail }
            : null,
        };
      }
    }

    const [inspectorRow] = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .where(eq(users.id, insp.inspector_id))
      .limit(1);

    if (inspectorRow) {
      inspector = { id: inspectorRow.id, full_name: inspectorRow.fullName, email: inspectorRow.email };
    }

    return {
      detail: {
        inspection: { ...insp, sections: enrichedSections },
        booking: booking || (insp.is_solo ? {
          property_address: insp.property_address,
          property_city: null,
          property_type: insp.property_type,
          inspection_type: insp.inspection_type,
          client: null,
        } : null),
        inspector,
      },
      error: null,
    };
  }

  static async getSummary(user: { id: string; role: string }, inspectionId: string) {
    const { inspection, error } = await this.getById(user, inspectionId);

    if (error || !inspection) {
      return { summary: null, error };
    }

    // getById returns raw snake_case fields cast as Inspection
    const insp = inspection as any;

    // Get property/client info — from booking if available, or from inspection itself for solo
    let booking: any = null;
    let inspector: any = null;

    if (insp.booking_id) {
      const clientUser = aliasedTable(users, 'summary_client');
      const [bookingRow] = await db
        .select({
          id:              bookings.id,
          propertyAddress: bookings.propertyAddress,
          propertyCity:    bookings.propertyCity,
          propertyType:    bookings.propertyType,
          inspectionType:  bookings.inspectionType,
          requestedDate:   bookings.requestedDate,
          clientId:        clientUser.id,
          clientFullName:  clientUser.fullName,
          clientEmail:     clientUser.email,
        })
        .from(bookings)
        .leftJoin(clientUser, eq(clientUser.id, bookings.clientId))
        .where(eq(bookings.id, insp.booking_id))
        .limit(1);

      if (bookingRow) {
        booking = {
          id:               bookingRow.id,
          property_address: bookingRow.propertyAddress,
          property_city:    bookingRow.propertyCity,
          property_type:    bookingRow.propertyType,
          inspection_type:  bookingRow.inspectionType,
          requested_date:   bookingRow.requestedDate ? String(bookingRow.requestedDate) : null,
          client: bookingRow.clientId
            ? { id: bookingRow.clientId, full_name: bookingRow.clientFullName, email: bookingRow.clientEmail }
            : null,
        };
      }
    }

    const [inspectorRow] = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email })
      .from(users)
      .where(eq(users.id, insp.inspector_id))
      .limit(1);

    if (inspectorRow) {
      inspector = { id: inspectorRow.id, full_name: inspectorRow.fullName, email: inspectorRow.email };
    }

    // Count conditions by severity (HINL/ACHI vocab)
    let acceptableCount = 0;
    let monitorCount = 0;
    let repairRequiredCount = 0;
    let unsafeCount = 0;

    for (const section of insp.sections || []) {
      for (const condition of section.conditions || []) {
        if (condition.severity === 'acceptable') acceptableCount++;
        else if (condition.severity === 'monitor') monitorCount++;
        else if (condition.severity === 'repair_required') repairRequiredCount++;
        else if (condition.severity === 'unsafe') unsafeCount++;
      }
    }

    // For solo inspections, build a synthetic booking-like object from inspection fields
    const propertyInfo = booking || (insp.is_solo ? {
      property_address: insp.property_address,
      property_city: null,
      property_type: insp.property_type,
      inspection_type: insp.inspection_type,
      requested_date: null,
      client: null,
    } : null);

    return {
      summary: {
        inspection,
        booking: propertyInfo,
        inspector,
        conditionCounts: {
          acceptable: acceptableCount,
          monitor: monitorCount,
          repair_required: repairRequiredCount,
          unsafe: unsafeCount,
        },
      },
      error: null,
    };
  }

  static async submit(inspectorId: string, inspectionId: string) {
    // Get inspection with all conditions
    const { inspection, error: fetchError } = await this.getById(
      { id: inspectorId, role: 'inspector' },
      inspectionId
    );

    if (fetchError || !inspection) {
      return { inspection: null, error: fetchError || 'Inspection not found' };
    }

    // Gate 1 (ownership) is enforced inside getById — inspector_id mismatch returns 'Access denied'.

    // Gate 2: Must be draft, in_progress, pending_review, or flagged (resubmission)
    const submittableStatuses = ['draft', 'in_progress', 'pending_review', 'flagged'];
    if (!submittableStatuses.includes(inspection.status)) {
      return { inspection: null, error: 'Inspection cannot be submitted in its current status' };
    }

    const wasFlagged = inspection.status === 'flagged';

    // Gate 3: reject if any photo_required condition has no photos
    const unphotoedConditions = await db
      .select({ id: inspectionConditions.id, name: inspectionConditions.name })
      .from(inspectionConditions)
      .where(and(
        eq(inspectionConditions.inspectionId, inspectionId),
        eq(inspectionConditions.photoRequired, true),
        eq(inspectionConditions.photoCount, 0),
      ));

    if (unphotoedConditions.length > 0) {
      const names = unphotoedConditions.map((c) => c.name).join(', ');
      return { inspection: null, error: `Photos required for: ${names}` };
    }

    const updatePayload: Record<string, any> = {
      status: 'pending_review',
      submittedAt: new Date(),
    };
    if (wasFlagged) {
      updatePayload.flaggedAt = null;
      updatePayload.flaggedBy = null;
      updatePayload.flagReason = null;
      // The resubmission is the answer to any outstanding revision request.
      updatePayload.revisionRequestedAt = null;
      updatePayload.revisionNotes = null;
    }

    let updatedInspection: any;
    try {
      const updated = await db
        .update(inspections)
        .set(updatePayload)
        .where(eq(inspections.id, inspectionId))
        .returning(inspectionFields);
      updatedInspection = updated[0];
      if (!updatedInspection) throw new Error('update returned no row');
    } catch (updateError) {
      logger.error({ err: updateError, inspectionId, inspectorId }, 'InspectionService.submit failed');
      return { inspection: null, error: 'Failed to submit inspection' };
    }

    // Write revision event
    await RevisionService.log({
      inspectionId: inspectionId,
      entityType: 'inspection',
      entityId: inspectionId,
      action: 'updated',
      field: wasFlagged ? 'resubmitted' : 'status',
      newValue: { status: 'pending_review', wasFlagged },
      changedBy: inspectorId,
    });

    // Transition booking to completed — only for non-solo inspections
    const submittedInsp = inspection as any;
    if (submittedInsp.booking_id) {
      try {
        await db
          .update(bookings)
          .set({ status: 'completed', completedAt: new Date() })
          .where(eq(bookings.id, submittedInsp.booking_id));
      } catch (err) {
        logger.error({ err, bookingId: submittedInsp.booking_id }, 'InspectionService.submit: booking completion failed');
      }
    }

    // Notify all admins of the new submission — distinguish a resubmission
    // after a flag from a first-time submission, so admins aren't reviewing
    // it cold a second time.
    broadcastToRole('admin', wasFlagged ? 'inspection.resubmitted' : 'inspection.submitted', {
      inspectionId,
      inspectorId,
      propertyAddress: submittedInsp.property_address ?? null,
    });
    this.notifyAdminsOfSubmission(inspectionId, inspectorId, submittedInsp.property_address ?? null, wasFlagged).catch((err) =>
      logger.warn({ err, inspectionId }, 'InspectionService.submit: admin email notification failed (non-fatal)')
    );

    // Client is notified when the report is actually generated (see ReportService.generate).
    return { inspection: shapeInspectionRow(updatedInspection), error: null };
  }

  /** Email all admins when an inspection is submitted or resubmitted for review — the broadcast above is in-app only and lost if no admin is online. */
  private static async notifyAdminsOfSubmission(inspectionId: string, inspectorId: string, propertyAddress: string | null, isResubmission: boolean): Promise<void> {
    const [inspector] = await db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, inspectorId))
      .limit(1);

    const admins = await db
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.role, 'admin'));

    for (const admin of admins) {
      await NotificationService.send('inspection_submitted', {
        recipientId: admin.id,
        recipientEmail: admin.email,
        data: {
          adminName: admin.fullName,
          inspectorName: inspector?.fullName ?? 'An inspector',
          propertyAddress,
          inspectionId,
          isResubmission,
        },
      });
    }
  }

  static async approve(adminId: string, inspectionId: string) {
    // Verify inspection exists and is pending_review
    const [inspection] = await db
      .select({
        id:           inspections.id,
        status:       inspections.status,
        bookingId:    inspections.bookingId,
        isSolo:       inspections.isSolo,
        inspectorId:  inspections.inspectorId,
        propertyAddress: inspections.propertyAddress,
      })
      .from(inspections)
      .where(eq(inspections.id, inspectionId))
      .limit(1);

    if (!inspection) {
      return { inspection: null, error: 'Inspection not found' };
    }

    if (inspection.status !== 'pending_review') {
      return { inspection: null, error: 'Inspection must be in pending_review status to approve' };
    }

    let updatedInspection: any;
    try {
      const updated = await db
        .update(inspections)
        .set({
          status: 'approved',
          approvedAt: new Date(),
          approvedBy: adminId,
        })
        .where(eq(inspections.id, inspectionId))
        .returning(inspectionFields);
      updatedInspection = updated[0];
      if (!updatedInspection) throw new Error('update returned no row');
    } catch (updateError) {
      logger.error({ err: updateError, inspectionId, adminId }, 'InspectionService.approve failed');
      return { inspection: null, error: 'Failed to approve inspection' };
    }

    // Write revision event
    await RevisionService.log({
      inspectionId: inspectionId,
      entityType: 'inspection',
      entityId: inspectionId,
      action: 'updated',
      field: 'status',
      newValue: { status: 'approved' },
      changedBy: adminId,
    });

    // Auto-generate the final PDF report in the background so the approve
    // request returns fast. Clients fetch the report via GET /reports/:id once
    // it's ready (they already poll / refresh on navigation).
    const { ReportService } = await import('./ReportService.js');
    ReportService.generateInBackground(inspectionId, adminId);

    // The client is deliberately NOT emailed here. Their notification is
    // report_ready/report_revised, sent from ReportService.generate's success
    // path with the real 30-day access URL — telling them "approved" before
    // the PDF exists produced emails with dead links when generation failed.

    // Notify the inspector their inspection was approved
    if (inspection.inspectorId) {
      broadcast(inspection.inspectorId, 'inspection.approved', {
        inspectionId,
        propertyAddress: inspection.propertyAddress ?? null,
      });
    }

    return {
      inspection: shapeInspectionRow(updatedInspection),
      report: null,
      reportError: null,
      reportStatus: 'generating' as const,
      error: null,
    };
  }

  static async flag(adminId: string, inspectionId: string, reason: string) {
    // Verify inspection exists
    const [inspection] = await db
      .select({ id: inspections.id, status: inspections.status })
      .from(inspections)
      .where(eq(inspections.id, inspectionId))
      .limit(1);

    if (!inspection) {
      return { inspection: null, error: 'Inspection not found' };
    }

    if (inspection.status !== 'pending_review') {
      return { inspection: null, error: 'Inspection must be in pending_review status to flag' };
    }

    let updatedInspection: any;
    try {
      const updated = await db
        .update(inspections)
        .set({
          status: 'flagged',
          flaggedAt: new Date(),
          flaggedBy: adminId,
          flagReason: reason,
        })
        .where(eq(inspections.id, inspectionId))
        .returning(inspectionFields);
      updatedInspection = updated[0];
      if (!updatedInspection) throw new Error('update returned no row');
    } catch (updateError) {
      logger.error({ err: updateError, inspectionId, adminId }, 'InspectionService.flag failed');
      return { inspection: null, error: 'Failed to flag inspection' };
    }

    // Write revision event
    await RevisionService.log({
      inspectionId: inspectionId,
      entityType: 'inspection',
      entityId: inspectionId,
      action: 'updated',
      field: 'status',
      newValue: { status: 'flagged', reason },
      changedBy: adminId,
    });

    // Notify inspector
    const [inspectionWithInspector] = await db
      .select({
        id:                    inspections.id,
        inspectorId:           inspections.inspectorId,
        bookingId:             inspections.bookingId,
        propertyAddress:       inspections.propertyAddress,
        bookingPropAddress:    bookings.propertyAddress,
        inspectorUserId:       users.id,
        inspectorEmail:        users.email,
        inspectorFullName:     users.fullName,
      })
      .from(inspections)
      .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
      .leftJoin(users, eq(users.id, inspections.inspectorId))
      .where(eq(inspections.id, inspectionId))
      .limit(1);

    if (inspectionWithInspector?.inspectorUserId && inspectionWithInspector.inspectorEmail) {
      const propertyAddress =
        inspectionWithInspector.bookingPropAddress ||
        inspectionWithInspector.propertyAddress ||
        'the property';

      await NotificationService.send('report_flagged', {
        recipientId: inspectionWithInspector.inspectorUserId,
        recipientEmail: inspectionWithInspector.inspectorEmail,
        data: {
          inspectorName: inspectionWithInspector.inspectorFullName,
          propertyAddress,
          flagReason: reason,
        },
      });
    }

    // Notify the inspector via SSE (faster than email)
    if (updatedInspection.inspectorId) {
      broadcast(updatedInspection.inspectorId as string, 'inspection.flagged', {
        inspectionId,
        reason,
      });
    }

    return { inspection: shapeInspectionRow(updatedInspection), error: null };
  }

  /**
   * Create template sections and conditions for an inspection.
   * Fetches the master template from the database for the given type slug.
   * Falls back to 'shi' if no type is specified.
   */
  private static async createSectionsFromTemplate(
    inspectionId: string,
    typeSlug: string = 'shi'
  ): Promise<{ error: string | null }> {
    const { template, error: tmplError } = await TemplateService.getTemplate(typeSlug);

    if (tmplError || !template || template.sections.length === 0) {
      logger.error(
        { tmplError, inspectionId, typeSlug },
        'InspectionService.createSectionsFromTemplate: failed to load template'
      );
      return { error: `No template available for inspection type "${typeSlug}"` };
    }

    // Batch insert all sections at once (no pre-populated conditions — inspector picks from library)
    const sectionsToInsert = template.sections.map((s: any) => ({
      inspectionId:    inspectionId,
      name:            s.name,
      displayOrder:    s.display_order,
      status:          'pending' as const,
      masterSectionId: s.id,
    }));

    try {
      await db.insert(inspectionSections).values(sectionsToInsert);
    } catch (sectionError) {
      logger.error(
        { err: sectionError, inspectionId },
        'InspectionService.createSectionsFromTemplate: section insert failed'
      );
      return { error: 'Failed to create inspection sections from template' };
    }

    return { error: null };
  }

  // ─────────────────────────────────────────────────────────────
  // v2 workflow: section status, condition picker, additional obs,
  //              limitations, review summary
  // ─────────────────────────────────────────────────────────────

  static async markSectionStatus(
    inspectorId: string,
    inspectionId: string,
    sectionId: string,
    status: 'pending' | 'pass' | 'observations'
  ) {
    const { ok, error: accessError } = await this.checkInspectorAccess(inspectorId, inspectionId);
    if (!ok) return { error: accessError };

    const update: Record<string, any> = { status };
    if (status !== 'pending') update.completedAt = new Date();
    else update.completedAt = null;

    let updatedRows: { id: string }[];
    try {
      updatedRows = await db
        .update(inspectionSections)
        .set(update)
        .where(and(
          eq(inspectionSections.id, sectionId),
          eq(inspectionSections.inspectionId, inspectionId),
        ))
        .returning({ id: inspectionSections.id });
    } catch (err) {
      logger.error({ err, sectionId, inspectionId }, 'InspectionService.markSectionStatus failed');
      return { error: 'Failed to update section status' };
    }

    // The section must belong to the caller's inspection. If nothing was
    // updated, the section id does not match this inspection — bail out
    // before deleting anything, so a foreign section id can't reach the
    // condition delete below.
    if (updatedRows.length === 0) {
      return { error: 'Section not found in this inspection' };
    }

    // Marking pass: wipe any conditions that were added before the toggle.
    // Scope the delete to this inspection as well as the section so it can
    // never touch conditions belonging to another inspection.
    if (status === 'pass') {
      try {
        await db
          .delete(inspectionConditions)
          .where(and(
            eq(inspectionConditions.sectionId, sectionId),
            eq(inspectionConditions.inspectionId, inspectionId),
          ));
      } catch (err) {
        logger.error({ err, sectionId, inspectionId }, 'InspectionService.markSectionStatus: clear conditions failed');
      }
    }

    return { error: null };
  }

  static async addCondition(
    inspectorId: string,
    inspectionId: string,
    sectionId: string,
    masterConditionId: string,
    clarification?: string,
    /** Optional UUID supplied by the offline-queue client so subsequent
     *  queued actions can reference the same id. Must be a valid UUIDv4. */
    clientId?: string
  ) {
    const { ok, error: accessError } = await this.checkInspectorAccess(inspectorId, inspectionId);
    if (!ok) return { condition: null, error: accessError };

    // Verify section belongs to inspection
    const [section] = await db
      .select({ id: inspectionSections.id, masterSectionId: inspectionSections.masterSectionId })
      .from(inspectionSections)
      .where(and(
        eq(inspectionSections.id, sectionId),
        eq(inspectionSections.inspectionId, inspectionId),
      ))
      .limit(1);

    if (!section) return { condition: null, error: 'Section not found' };

    // Load master condition + verify it belongs to this section
    const [mc] = await db
      .select({
        id:             masterConditions.id,
        name:           masterConditions.name,
        displayOrder:   masterConditions.displayOrder,
        sectionId:      masterConditions.sectionId,
        severity:       masterConditions.severity,
        riskStatement:  masterConditions.riskStatement,
        recommendation: masterConditions.recommendation,
        photoRequired:  masterConditions.photoRequired,
      })
      .from(masterConditions)
      .where(and(
        eq(masterConditions.id, masterConditionId),
        eq(masterConditions.isActive, true),
      ))
      .limit(1);

    if (!mc) return { condition: null, error: 'Condition not found' };

    // Prevent duplicates
    const [existing] = await db
      .select({ id: inspectionConditions.id })
      .from(inspectionConditions)
      .where(and(
        eq(inspectionConditions.inspectionId, inspectionId),
        eq(inspectionConditions.masterConditionId, masterConditionId),
      ))
      .limit(1);

    if (existing) return { condition: null, error: 'Condition already added' };

    let condition: any;
    try {
      const inserted = await db
        .insert(inspectionConditions)
        .values({
          ...(clientId ? { id: clientId } : {}),
          sectionId:               sectionId,
          inspectionId:            inspectionId,
          name:                    mc.name,
          displayOrder:            mc.displayOrder,
          masterConditionId:       mc.id,
          severity:                mc.severity,
          riskSnapshot:            mc.riskStatement,
          recommendationSnapshot:  mc.recommendation,
          photoRequired:           mc.photoRequired,
          clarification:           clarification ?? null,
          isComplete:              false,
        })
        .onConflictDoNothing({ target: inspectionConditions.id })
        .returning();
      condition = inserted[0];
      // If a client UUID was supplied and the row already exists (replay
      // hitting the server twice), fetch and return the existing row so the
      // call is idempotent. Scoped to this inspection: the id is
      // client-supplied, so an unscoped lookup would hand back another
      // inspection's condition.
      if (!condition && clientId) {
        const [existingRow] = await db
          .select()
          .from(inspectionConditions)
          .where(and(
            eq(inspectionConditions.id, clientId),
            eq(inspectionConditions.inspectionId, inspectionId),
          ))
          .limit(1);
        condition = existingRow;
      }
      if (!condition) throw new Error('insert returned no row');
    } catch (err) {
      logger.error({ err, sectionId, masterConditionId }, 'InspectionService.addCondition failed');
      return { condition: null, error: 'Failed to add condition' };
    }

    // Auto-set section to observations mode (only if it was previously pending or pass)
    try {
      await db
        .update(inspectionSections)
        .set({ status: 'observations', completedAt: new Date() })
        .where(and(
          eq(inspectionSections.id, sectionId),
          inArray(inspectionSections.status, ['pending', 'pass']),
        ));
    } catch (err) {
      logger.error({ err, sectionId }, 'InspectionService.addCondition: section status update failed');
    }

    return { condition, error: null };
  }

  static async cancelInspection(inspectorId: string, inspectionId: string) {
    const [inspection] = await db
      .select({
        id:          inspections.id,
        inspectorId: inspections.inspectorId,
        status:      inspections.status,
        isSolo:      inspections.isSolo,
      })
      .from(inspections)
      .where(eq(inspections.id, inspectionId))
      .limit(1);

    if (!inspection) return { error: 'Inspection not found' };
    if (inspection.inspectorId !== inspectorId) return { error: 'Not authorized' };

    const nonCancellable = ['approved', 'completed', 'cancelled'];
    if (inspection.status && nonCancellable.includes(inspection.status)) {
      return { error: 'Cannot cancel an inspection that is already completed or approved' };
    }

    if (inspection.isSolo) {
      // Hard delete solo inspections — they have no client, no booking dependency
      try {
        await db.delete(inspections).where(eq(inspections.id, inspectionId));
      } catch (err) {
        logger.error({ err, inspectionId }, 'InspectionService.cancelInspection: solo delete failed');
        return { error: 'Failed to delete inspection' };
      }
    } else {
      // Soft-cancel booking-linked inspections to preserve the booking record.
      // Status enum doesn't include 'cancelled' explicitly — cast through any to
      // match the legacy behaviour while migrations catch up.
      try {
        await db
          .update(inspections)
          .set({ status: 'cancelled' as any })
          .where(eq(inspections.id, inspectionId));
      } catch (err) {
        logger.error({ err, inspectionId }, 'InspectionService.cancelInspection: cancel update failed');
        return { error: 'Failed to cancel inspection' };
      }
    }

    return { error: null };
  }

  static async removeCondition(inspectorId: string, inspectionId: string, conditionId: string) {
    const { ok, error: accessError } = await this.checkInspectorAccess(inspectorId, inspectionId);
    if (!ok) return { error: accessError };

    try {
      await db
        .delete(inspectionConditions)
        .where(and(
          eq(inspectionConditions.id, conditionId),
          eq(inspectionConditions.inspectionId, inspectionId),
        ));
    } catch (err) {
      logger.error({ err, conditionId, inspectionId }, 'InspectionService.removeCondition failed');
      return { error: 'Failed to remove condition' };
    }
    return { error: null };
  }

  static async updateConditionFields(
    inspectorId: string,
    inspectionId: string,
    conditionId: string,
    fields: { clarification?: string; location?: string }
  ) {
    const { ok, error: accessError } = await this.checkInspectorAccess(inspectorId, inspectionId);
    if (!ok) return { error: accessError };

    const updates: Record<string, any> = {};
    if (fields.clarification !== undefined) updates.clarification = fields.clarification;
    if (fields.location !== undefined) updates.location = fields.location;
    if (Object.keys(updates).length === 0) return { error: null };

    try {
      await db
        .update(inspectionConditions)
        .set(updates)
        .where(and(
          eq(inspectionConditions.id, conditionId),
          eq(inspectionConditions.inspectionId, inspectionId),
        ));
    } catch (err) {
      logger.error({ err, conditionId, inspectionId }, 'InspectionService.updateConditionFields failed');
      return { error: 'Failed to update condition' };
    }
    return { error: null };
  }


  static async addAdditionalObservation(
    inspectorId: string,
    inspectionId: string,
    data: { sectionId: string; title: string; description: string; clientId?: string }
  ) {
    const { ok, error: accessError } = await this.checkInspectorAccess(inspectorId, inspectionId);
    if (!ok) return { observation: null, error: accessError };

    // Resolve section slug from master_sections
    const [sec] = await db
      .select({
        masterSectionId:    inspectionSections.masterSectionId,
        masterSectionSlug:  masterSections.slug,
      })
      .from(inspectionSections)
      .leftJoin(masterSections, eq(masterSections.id, inspectionSections.masterSectionId))
      .where(and(
        eq(inspectionSections.id, data.sectionId),
        eq(inspectionSections.inspectionId, inspectionId),
      ))
      .limit(1);

    const sectionSlug = sec?.masterSectionSlug ?? 'unknown';

    let obs: any;
    try {
      const inserted = await db
        .insert(additionalObservations)
        .values({
          ...(data.clientId ? { id: data.clientId } : {}),
          inspectionId: inspectionId,
          sectionSlug:  sectionSlug,
          title:        data.title,
          description:  data.description,
        })
        .onConflictDoNothing({ target: additionalObservations.id })
        .returning();
      obs = inserted[0];
      // Replay-idempotency fetch, scoped to this inspection — the id is
      // client-supplied, so an unscoped lookup would hand back another
      // inspection's observation.
      if (!obs && data.clientId) {
        const [existingRow] = await db
          .select()
          .from(additionalObservations)
          .where(and(
            eq(additionalObservations.id, data.clientId),
            eq(additionalObservations.inspectionId, inspectionId),
          ))
          .limit(1);
        obs = existingRow;
      }
      if (!obs) throw new Error('insert returned no row');
    } catch (err) {
      logger.error({ err, inspectionId }, 'InspectionService.addAdditionalObservation failed');
      return { observation: null, error: 'Failed to add observation' };
    }

    return {
      observation: {
        id:            obs.id,
        inspection_id: obs.inspectionId,
        section_slug:  obs.sectionSlug,
        title:         obs.title,
        description:   obs.description,
        created_at:    toIso(obs.createdAt),
        updated_at:    toIso(obs.updatedAt),
      },
      error: null,
    };
  }

  static async removeAdditionalObservation(
    inspectorId: string,
    inspectionId: string,
    obsId: string
  ) {
    const { ok, error: accessError } = await this.checkInspectorAccess(inspectorId, inspectionId);
    if (!ok) return { error: accessError };

    try {
      await db
        .delete(additionalObservations)
        .where(and(
          eq(additionalObservations.id, obsId),
          eq(additionalObservations.inspectionId, inspectionId),
        ));
    } catch (err) {
      logger.error({ err, obsId, inspectionId }, 'InspectionService.removeAdditionalObservation failed');
      return { error: 'Failed to remove observation' };
    }
    return { error: null };
  }

  static async setLimitations(inspectorId: string, inspectionId: string, limitationIds: string[]) {
    const { ok, error: accessError } = await this.checkInspectorAccess(inspectorId, inspectionId);
    if (!ok) return { error: accessError };

    // Replace the set: delete existing, then insert
    try {
      await db
        .delete(inspectionLimitations)
        .where(eq(inspectionLimitations.inspectionId, inspectionId));
    } catch (err) {
      logger.error({ err, inspectionId }, 'InspectionService.setLimitations: delete failed');
      return { error: 'Failed to set limitations' };
    }

    if (limitationIds.length > 0) {
      try {
        await db.insert(inspectionLimitations).values(
          limitationIds.map((id) => ({ inspectionId: inspectionId, limitationId: id }))
        );
      } catch (err) {
        logger.error({ err, inspectionId }, 'InspectionService.setLimitations: insert failed');
        return { error: 'Failed to set limitations' };
      }
    }

    return { error: null };
  }

  static async getReview(inspectorId: string, inspectionId: string) {
    const { inspection, error: fetchError } = await this.getById({ id: inspectorId, role: 'inspector' }, inspectionId);
    if (fetchError || !inspection) return { review: null, error: fetchError || 'Not found' };

    const sections = ((inspection as any).sections || []) as any[];
    const sectionsTotal = sections.length;
    const sectionsComplete = sections.filter((s) => s.status !== 'pending').length;

    let unsafeCount = 0;
    let repairRequiredCount = 0;
    let monitorCount = 0;
    const missingPhotos: { conditionId: string; sectionId: string; sectionName: string; name: string }[] = [];
    const incompleteSections: { sectionId: string; name: string }[] = [];

    for (const section of sections) {
      if (section.status === 'pending') {
        incompleteSections.push({ sectionId: section.id, name: section.name });
      }
      for (const cond of (section.conditions || [])) {
        if (cond.severity === 'unsafe') unsafeCount++;
        else if (cond.severity === 'repair_required') repairRequiredCount++;
        else if (cond.severity === 'monitor') monitorCount++;
        if (cond.photo_required && (cond.photo_count ?? 0) === 0) {
          missingPhotos.push({ conditionId: cond.id, sectionId: section.id, sectionName: section.name, name: cond.name });
        }
      }
    }

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(additionalObservations)
      .where(eq(additionalObservations.inspectionId, inspectionId));

    const additionalCount = countRow?.count ?? 0;

    return {
      review: {
        sectionsTotal,
        sectionsComplete,
        unsafeCount,
        repairRequiredCount,
        monitorCount,
        additionalCount,
        missingPhotos,
        incompleteSections,
        canSubmit: sectionsComplete === sectionsTotal && missingPhotos.length === 0,
      },
      error: null,
    };
  }

  /**
   * Roll back a just-created inspection and its dependent rows when template
   * initialization fails, so we never leave an inspection with zero sections.
   */
  private static async rollbackInspection(inspectionId: string) {
    // inspection_sections and inspection_conditions cascade on DELETE from inspections,
    // but we delete explicitly in case either side has cascade disabled by migration.
    try {
      await db.delete(inspectionConditions).where(eq(inspectionConditions.inspectionId, inspectionId));
      await db.delete(inspectionSections).where(eq(inspectionSections.inspectionId, inspectionId));
      await db.delete(inspections).where(eq(inspections.id, inspectionId));
    } catch (err) {
      logger.error({ err, inspectionId }, 'InspectionService.rollbackInspection failed');
    }
  }
}

// Silence unused imports retained for future extensions
void or;
