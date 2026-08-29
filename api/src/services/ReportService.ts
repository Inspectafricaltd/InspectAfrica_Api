import { randomUUID } from 'node:crypto';
import { aliasedTable, and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  additionalObservations,
  bookings,
  certNumberCounters,
  inspectionConditions,
  inspectionLimitations,
  inspectionPhotos,
  inspectionSections,
  inspections,
  inspectorProfiles,
  limitationLibrary,
  observations,
  photoAnnotations,
  reportAccessTokens,
  reportVersions,
  revisionEvents,
  users,
} from '../db/schema.js';
import { generatePdfFromHtml, buildInspectionReportHtml, resolveInspectionTypeAbbr } from '../lib/pdf.js';
import { buildReportFilename } from '../lib/reportFilename.js';
import { RevisionService } from './RevisionService.js';
import { NotificationService } from './NotificationService.js';
import { logger } from '../lib/logger.js';
import { broadcast, broadcastToRole } from '../lib/eventBus.js';
import { uploadFile, deleteFiles, downloadFile, getSignedDownloadUrl } from '../lib/storage.js';
import { processCoverPhoto, processFindingPhoto, processSignature } from '../lib/imageProcessing.js';

const CLIENT_APP_URL =
  process.env.CLIENT_APP_URL ||
  process.env.WEB_BASE_URL ||
  process.env.APP_URL ||
  'https://app.inspectafrica.org';

export interface Report {
  id: string;
  inspectionId: string;
  version: number;
  certificateNumber: string;
  isLatest: boolean;
  generatedAt: string;
  generatedBy: string;
  storagePath: string | null;
  fileSizeBytes: number | null;
}

export interface ReportVersion {
  version: number;
  certificateNumber: string;
  isLatest: boolean;
  generatedAt: string;
  generatedBy: string;
}

export interface ReportAccess {
  report: Report;
  inspection: any;
  property: any;
}

function toIso(v: any): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Reserve a unique certificate number for the current year. Replaces the
 * legacy `next_certificate_number()` Postgres function. The upsert takes a
 * row-level lock on the per-year counter, so concurrent callers serialize
 * cleanly.
 *
 * Format: `IA-<YEAR>-<6-digit-zero-padded>` (e.g. `IA-2026-000001`).
 */
async function generateCertificateNumber(): Promise<string> {
  try {
    const year = new Date().getUTCFullYear();
    const [row] = await db
      .insert(certNumberCounters)
      .values({ year, lastNum: 1 })
      .onConflictDoUpdate({
        target: certNumberCounters.year,
        set: {
          lastNum:   sql`${certNumberCounters.lastNum} + 1`,
          updatedAt: new Date(),
        },
      })
      .returning({ lastNum: certNumberCounters.lastNum });

    if (!row) throw new Error('counter upsert returned no row');
    const seq = String(row.lastNum).padStart(6, '0');
    return `IA-${year}-${seq}`;
  } catch (err) {
    logger.error({ err }, 'ReportService.generateCertificateNumber failed');
    throw new Error('Failed to reserve certificate number');
  }
}

/**
 * Atomically demote prior latest versions and mark `reportId` as latest.
 * Replaces the legacy `promote_report_version_to_latest(p_inspection_id, p_report_id)`
 * Postgres function. Protected by the partial unique index
 * `report_versions_one_latest_per_inspection`.
 */
async function promoteReportToLatest(inspectionId: string, reportId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(reportVersions)
      .set({ isLatest: false })
      .where(and(
        eq(reportVersions.inspectionId, inspectionId),
        sql`${reportVersions.id} <> ${reportId}`,
      ));
    await tx
      .update(reportVersions)
      .set({ isLatest: true })
      .where(eq(reportVersions.id, reportId));
  });
}

export class ReportService {
  /** One automatic retry smooths transient Puppeteer/R2 hiccups; after that
   *  the failure is escalated to admins instead of being swallowed. */
  private static readonly MAX_BACKGROUND_ATTEMPTS = 2;
  private static readonly BACKGROUND_RETRY_DELAY_MS = 30_000;

  /**
   * Fire-and-forget wrapper around generate() shared by every approval path
   * (InspectionService.approve and AdminService.resolveFlag), so the approve
   * request returns fast and the two paths can't diverge on whether a report
   * gets produced. The client is only emailed from generate()'s success path
   * (report_ready/report_revised, with the real access URL); on failure the
   * run is retried once, and a persistent failure is broadcast + emailed to
   * admins so it can be reconciled from the inspection page.
   */
  static generateInBackground(inspectionId: string, generatedBy: string, attempt = 1): void {
    setImmediate(() => {
      ReportService.generate(inspectionId, generatedBy)
        .then((result) => {
          if (result.error) {
            ReportService.handleBackgroundFailure(inspectionId, generatedBy, result.error, attempt);
          }
        })
        .catch((err) => {
          ReportService.handleBackgroundFailure(inspectionId, generatedBy, err?.message ?? String(err), attempt);
        });
    });
  }

  private static handleBackgroundFailure(
    inspectionId: string,
    generatedBy: string,
    errorMessage: string,
    attempt: number
  ): void {
    logger.error({ inspectionId, attempt, err: errorMessage }, 'background report generation failed');

    if (attempt < ReportService.MAX_BACKGROUND_ATTEMPTS) {
      const timer = setTimeout(
        () => ReportService.generateInBackground(inspectionId, generatedBy, attempt + 1),
        ReportService.BACKGROUND_RETRY_DELAY_MS
      );
      timer.unref?.();
      return;
    }

    ReportService.notifyAdminsOfGenerationFailure(inspectionId, errorMessage, attempt).catch((err) => {
      logger.error({ err, inspectionId }, 'failed to notify admins of report generation failure');
    });
  }

  /** Surface a persistent generation failure: SSE to online admins plus email,
   *  since the approved inspection has no report and the client has not been
   *  told anything yet. */
  private static async notifyAdminsOfGenerationFailure(
    inspectionId: string,
    errorMessage: string,
    attempts: number
  ): Promise<void> {
    const [inspection] = await db
      .select({
        propertyAddress: inspections.propertyAddress,
        bookingPropAddr: bookings.propertyAddress,
      })
      .from(inspections)
      .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
      .where(eq(inspections.id, inspectionId))
      .limit(1);

    const propertyAddress = inspection?.bookingPropAddr || inspection?.propertyAddress || 'Unknown';

    broadcastToRole('admin', 'report.generation_failed', {
      inspectionId,
      propertyAddress,
      error: errorMessage,
    });

    const admins = await db
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.role, 'admin'));

    for (const admin of admins) {
      await NotificationService.send('report_generation_failed', {
        recipientId: admin.id,
        recipientEmail: admin.email,
        data: {
          adminName: admin.fullName,
          propertyAddress,
          inspectionId,
          errorMessage,
          attempts: String(attempts),
        },
      });
    }
  }

  static async generate(inspectionId: string, generatedBy: string) {
    // Fetch inspection + booking + client + inspector in one query
    const bookingClient = aliasedTable(users, 'gen_booking_client');
    const inspectorUser = aliasedTable(users, 'gen_inspector');

    const [inspectionRow] = await db
      .select({
        id:                    inspections.id,
        status:                inspections.status,
        inspectorId:           inspections.inspectorId,
        bookingId:             inspections.bookingId,
        isSolo:                inspections.isSolo,
        clientId:              inspections.clientId,
        propertyAddress:       inspections.propertyAddress,
        propertyType:          inspections.propertyType,
        inspectionType:        inspections.inspectionType,
        state:                 inspections.state,
        lga:                   inspections.lga,
        country:               inspections.country,
        createdAt:             inspections.createdAt,
        submittedAt:           inspections.submittedAt,
        coverPhotoPath:        inspections.coverPhotoPath,
        weatherSnapshot:       inspections.weatherSnapshot,
        buildingType:          inspections.buildingType,
        occupancyStatus:       inspections.occupancyStatus,
        inAttendance:          inspections.inAttendance,
        inspectionConstraints: inspections.inspectionConstraints,
        otherBuildingType:     inspections.otherBuildingType,
        otherInAttendance:     inspections.otherInAttendance,
        otherConstraints:      inspections.otherConstraints,
        // Booking
        bId:                   bookings.id,
        bPropertyAddress:      bookings.propertyAddress,
        bPropertyCity:         bookings.propertyCity,
        bPropertyType:         bookings.propertyType,
        bInspectionType:       bookings.inspectionType,
        bRequestedDate:        bookings.requestedDate,
        bCountry:              bookings.country,
        // Client (via booking)
        clientUserId:          bookingClient.id,
        clientFullName:        bookingClient.fullName,
        clientEmail:           bookingClient.email,
        // Inspector
        inspectorUserId:       inspectorUser.id,
        inspectorFullName:     inspectorUser.fullName,
        inspectorEmail:        inspectorUser.email,
      })
      .from(inspections)
      .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
      .leftJoin(bookingClient, eq(bookingClient.id, bookings.clientId))
      .leftJoin(inspectorUser, eq(inspectorUser.id, inspections.inspectorId))
      .where(eq(inspections.id, inspectionId))
      .limit(1);

    if (!inspectionRow) {
      return { report: null, error: 'Inspection not found' };
    }

    if (inspectionRow.status !== 'approved') {
      return { report: null, error: 'Inspection must be approved before generating report' };
    }

    // Reshape to match the snake_case shape that the rest of this method
    // (and the PDF builder) consumes.
    const inspection: any = {
      id:                    inspectionRow.id,
      status:                inspectionRow.status,
      inspector_id:          inspectionRow.inspectorId,
      booking_id:            inspectionRow.bookingId,
      is_solo:               inspectionRow.isSolo,
      client_id:             inspectionRow.clientId,
      property_address:      inspectionRow.propertyAddress,
      property_type:         inspectionRow.propertyType,
      inspection_type:       inspectionRow.inspectionType,
      state:                 inspectionRow.state,
      lga:                   inspectionRow.lga,
      country:               inspectionRow.country,
      created_at:            toIso(inspectionRow.createdAt),
      submitted_at:          toIso(inspectionRow.submittedAt),
      cover_photo_path:      inspectionRow.coverPhotoPath,
      weather_snapshot:      inspectionRow.weatherSnapshot,
      building_type:         inspectionRow.buildingType,
      occupancy_status:      inspectionRow.occupancyStatus,
      in_attendance:         inspectionRow.inAttendance,
      inspection_constraints: inspectionRow.inspectionConstraints,
      other_building_type:   inspectionRow.otherBuildingType,
      other_in_attendance:   inspectionRow.otherInAttendance,
      other_constraints:     inspectionRow.otherConstraints,
      bookings: inspectionRow.bId
        ? {
            id:               inspectionRow.bId,
            property_address: inspectionRow.bPropertyAddress,
            property_city:    inspectionRow.bPropertyCity,
            property_type:    inspectionRow.bPropertyType,
            inspection_type:  inspectionRow.bInspectionType,
            requested_date:   inspectionRow.bRequestedDate ? String(inspectionRow.bRequestedDate) : null,
            country:          inspectionRow.bCountry,
            client: inspectionRow.clientUserId
              ? {
                  id:        inspectionRow.clientUserId,
                  full_name: inspectionRow.clientFullName,
                  email:     inspectionRow.clientEmail,
                }
              : null,
          }
        : null,
      inspector: inspectionRow.inspectorUserId
        ? {
            id:        inspectionRow.inspectorUserId,
            full_name: inspectionRow.inspectorFullName,
            email:     inspectionRow.inspectorEmail,
          }
        : null,
    };

    // Get inspector profile for ACHI number and status. The status matters as
    // much as the number: the PDF prints a certification claim, and it can only
    // do that honestly if it knows whether the certification is live.
    let inspectorProfile: { achi_number: string | null; achi_status: string | null } | null = null;
    if (inspection.inspector_id) {
      const [prof] = await db
        .select({ achiNumber: inspectorProfiles.achiNumber, achiStatus: inspectorProfiles.achiStatus })
        .from(inspectorProfiles)
        .where(eq(inspectorProfiles.userId, inspection.inspector_id))
        .limit(1);
      if (prof) inspectorProfile = { achi_number: prof.achiNumber, achi_status: prof.achiStatus };
    }

    // Get sections, conditions, photos, annotations — assemble nested shape
    const sectionRows = await db
      .select({
        id:           inspectionSections.id,
        name:         inspectionSections.name,
        displayOrder: inspectionSections.displayOrder,
        status:       inspectionSections.status,
      })
      .from(inspectionSections)
      .where(eq(inspectionSections.inspectionId, inspectionId))
      .orderBy(asc(inspectionSections.displayOrder));

    const conditionRows = await db
      .select({
        id:                     inspectionConditions.id,
        sectionId:              inspectionConditions.sectionId,
        name:                   inspectionConditions.name,
        displayOrder:           inspectionConditions.displayOrder,
        severity:               inspectionConditions.severity,
        riskSnapshot:           inspectionConditions.riskSnapshot,
        recommendationSnapshot: inspectionConditions.recommendationSnapshot,
        photoRequired:          inspectionConditions.photoRequired,
        clarification:          inspectionConditions.clarification,
        location:               inspectionConditions.location,
        photoCount:             inspectionConditions.photoCount,
      })
      .from(inspectionConditions)
      .where(eq(inspectionConditions.inspectionId, inspectionId))
      .orderBy(asc(inspectionConditions.displayOrder));

    const conditionIds = conditionRows.map((c) => c.id);

    type PhotoRow = { id: string; conditionId: string | null; storagePath: string | null; thumbPath: string | null };
    const photoRows: PhotoRow[] = conditionIds.length > 0
      ? await db
          .select({
            id:          inspectionPhotos.id,
            conditionId: inspectionPhotos.conditionId,
            storagePath: inspectionPhotos.storagePath,
            thumbPath:   inspectionPhotos.thumbPath,
          })
          .from(inspectionPhotos)
          .where(and(
            eq(inspectionPhotos.inspectionId, inspectionId),
            inArray(inspectionPhotos.conditionId, conditionIds),
          ))
      : [];

    const photoIds = photoRows.map((p) => p.id);
    const annotationsByPhoto = new Map<string, any[]>();
    if (photoIds.length > 0) {
      const annRows = await db
        .select({ photoId: photoAnnotations.photoId, shapes: photoAnnotations.shapes })
        .from(photoAnnotations)
        .where(inArray(photoAnnotations.photoId, photoIds));
      for (const a of annRows) {
        annotationsByPhoto.set(a.photoId, (a.shapes as any[]) || []);
      }
    }

    const photosByCondition = new Map<string, any[]>();
    for (const p of photoRows) {
      if (!p.conditionId) continue;
      const arr = photosByCondition.get(p.conditionId) ?? [];
      arr.push({
        id:           p.id,
        storage_path: p.storagePath,
        thumb_path:   p.thumbPath,
        photo_annotations: [{ shapes: annotationsByPhoto.get(p.id) ?? [] }],
      });
      photosByCondition.set(p.conditionId, arr);
    }

    const conditionsBySection = new Map<string, any[]>();
    for (const c of conditionRows) {
      const arr = conditionsBySection.get(c.sectionId) ?? [];
      arr.push({
        id:                      c.id,
        name:                    c.name,
        display_order:           c.displayOrder,
        severity:                c.severity,
        risk_snapshot:           c.riskSnapshot,
        recommendation_snapshot: c.recommendationSnapshot,
        photo_required:          c.photoRequired,
        clarification:           c.clarification,
        location:                c.location,
        photo_count:             c.photoCount,
        inspection_photos:       photosByCondition.get(c.id) ?? [],
      });
      conditionsBySection.set(c.sectionId, arr);
    }

    const sections = sectionRows.map((s) => ({
      id:                    s.id,
      name:                  s.name,
      display_order:         s.displayOrder,
      status:                s.status,
      inspection_conditions: conditionsBySection.get(s.id) ?? [],
    }));

    // Fetch additional observations
    const additionalObsRows = await db
      .select({
        id:          additionalObservations.id,
        sectionSlug: additionalObservations.sectionSlug,
        title:       additionalObservations.title,
        description: additionalObservations.description,
        createdAt:   additionalObservations.createdAt,
      })
      .from(additionalObservations)
      .where(eq(additionalObservations.inspectionId, inspectionId))
      .orderBy(asc(additionalObservations.createdAt));

    const additionalObs = additionalObsRows.map((o) => ({
      id:           o.id,
      section_slug: o.sectionSlug,
      title:        o.title,
      description:  o.description,
      created_at:   toIso(o.createdAt),
    }));

    // Fetch limitations text
    const limitationRows = await db
      .select({ text: limitationLibrary.text })
      .from(inspectionLimitations)
      .leftJoin(limitationLibrary, eq(limitationLibrary.id, inspectionLimitations.limitationId))
      .where(eq(inspectionLimitations.inspectionId, inspectionId));

    const limitationTexts = limitationRows
      .map((r) => r.text)
      .filter((t): t is string => Boolean(t));

    // Fetch inspector signature
    let sigUser: { signature_image_path: string | null } | null = null;
    if (inspection.inspector_id) {
      const [u] = await db
        .select({ signatureImagePath: users.signatureImagePath })
        .from(users)
        .where(eq(users.id, inspection.inspector_id))
        .limit(1);
      if (u) sigUser = { signature_image_path: u.signatureImagePath };
    }

    // Flatten all conditions for analysis
    const allConditions = sections.flatMap((s: any) =>
      (s.inspection_conditions || []).map((c: any) => ({
        ...c,
        sectionName: s.name,
      }))
    );

    // Stage-inspection decision engine
    // Stage-decision inspection types (yields APPROVED / APPROVED_WITH_DEFECTS / NOT_APPROVED)
    // mic = Move-In Certification, fsi = Foundation Stage, pcc = Pre-Cover Check
    const STAGE_TYPES = ['mic', 'fsi', 'pcc'];
    const inspType = inspection.inspection_type || (inspection.bookings as any)?.inspection_type;
    let stageVerdict: 'APPROVED' | 'APPROVED_WITH_DEFECTS' | 'NOT_APPROVED' | null = null;
    if (STAGE_TYPES.includes(inspType)) {
      const unsafeCount = allConditions.filter((c: any) => c.severity === 'unsafe').length;
      const issueCount = allConditions.filter((c: any) =>
        c.severity === 'repair_required' || c.severity === 'monitor'
      ).length;
      stageVerdict = unsafeCount > 0 ? 'NOT_APPROVED'
        : issueCount > 0 ? 'APPROVED_WITH_DEFECTS'
        : 'APPROVED';
    }

    // Get current max version
    const existingReports = await db
      .select({ version: reportVersions.version, certificateNumber: reportVersions.certificateNumber })
      .from(reportVersions)
      .where(eq(reportVersions.inspectionId, inspectionId))
      .orderBy(desc(reportVersions.version))
      .limit(1);

    const nextVersion = (existingReports[0]?.version ?? 0) + 1;

    // The inspection has a stable certificate identity: carry the prior
    // version's number forward; mint a new one only for v1.
    const prevReport = existingReports[0];
    const certificateNumber = prevReport?.certificateNumber
      ? prevReport.certificateNumber
      : await generateCertificateNumber();

    // Create report record. Insert as is_latest=false so the partial unique
    // index (one latest per inspection) is never violated. We promote to
    // latest atomically only after the PDF upload succeeds.
    let report: any;
    try {
      const inserted = await db
        .insert(reportVersions)
        .values({
          inspectionId:      inspectionId,
          version:           nextVersion,
          certificateNumber: certificateNumber,
          generatedBy:       generatedBy,
          storagePath:       null,
          fileSizeBytes:     null,
          isLatest:          false,
        })
        .returning();
      report = inserted[0];
      if (!report) throw new Error('insert returned no row');
    } catch (err) {
      logger.error({ err, inspectionId }, 'ReportService.generate: report record creation failed');
      return { report: null, error: 'Failed to create report record' };
    }

    try {
      // For solo inspections, build a synthetic booking object from inspection fields
      const bookingData = inspection.bookings || (inspection.is_solo ? {
        id: null,
        property_address: inspection.property_address,
        property_city: inspection.state || null,
        property_type: inspection.property_type,
        inspection_type: inspection.inspection_type,
        requested_date: null,
        client: null,
        country: inspection.country || null,
      } : null);

      // Download photos in parallel with bounded concurrency, then embed as
      // base64 data URLs. Sequential downloads dominated wall-time on large
      // reports — 8-way concurrency typically cuts it 5-10x without
      // overloading storage.
      // Download inspector signature if available
      let signatureDataUrl: string | null = null;
      if (sigUser?.signature_image_path) {
        const buf = await downloadFile('avatars', sigUser.signature_image_path);
        if (buf) {
          const mime = sigUser.signature_image_path.endsWith('.png') ? 'image/png' : 'image/jpeg';
          const processed = await processSignature(buf);
          signatureDataUrl = `data:${mime};base64,${processed.toString('base64')}`;
        }
      }

      // Download cover photo if present
      let coverPhotoDataUrl: string | null = null;
      if (inspection.cover_photo_path) {
        const buf = await downloadFile('inspection-photos', inspection.cover_photo_path);
        if (buf) {
          const processed = await processCoverPhoto(buf);
          coverPhotoDataUrl = `data:image/jpeg;base64,${processed.toString('base64')}`;
        }
      }

      type PhotoJob = { conditionId: string; storagePath: string; index: number; shapes: any[] };
      const jobs: PhotoJob[] = [];
      for (const section of sections) {
        for (const cond of section.inspection_conditions || []) {
          const photos = cond.inspection_photos || [];
          photos.forEach((photo: any, idx: number) => {
            if (photo.storage_path) {
              const shapes = (photo.photo_annotations?.[0]?.shapes as any[]) || [];
              jobs.push({ conditionId: cond.id, storagePath: photo.storage_path, index: idx, shapes });
            }
          });
        }
      }

      const CONCURRENCY = 8;
      type RenderedPhoto = { index: number; dataUrl: string; shapes: any[] };
      const results = new Map<string, RenderedPhoto[]>();
      let cursor = 0;
      async function worker() {
        while (true) {
          const i = cursor++;
          if (i >= jobs.length) return;
          const job = jobs[i]!;
          const buffer = await downloadFile('inspection-photos', job.storagePath);
          if (!buffer) continue;
          const processed = await processFindingPhoto(buffer);
          const dataUrl = `data:image/jpeg;base64,${processed.toString('base64')}`;
          const arr = results.get(job.conditionId) ?? [];
          arr.push({ index: job.index, dataUrl, shapes: job.shapes });
          results.set(job.conditionId, arr);
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

      const photoMap = new Map<string, RenderedPhoto[]>();
      for (const [condId, arr] of results) {
        arr.sort((a, b) => a.index - b.index);
        photoMap.set(condId, arr);
      }

      const generatedAt = new Date().toISOString();

      // Build HTML report (v2)
      const { html, headerTemplate } = buildInspectionReportHtml({
        inspection,
        booking: bookingData,
        inspector: {
          ...inspection.inspector,
          achi_number: inspectorProfile?.achi_number || null,
          achi_status: inspectorProfile?.achi_status || null,
        },
        sections: sections.map((s: any) => ({
          name: s.name,
          status: s.status,
          conditions: (s.inspection_conditions || []).map((c: any) => ({
            name: c.name,
            severity: c.severity,
            risk_snapshot: c.risk_snapshot,
            recommendation_snapshot: c.recommendation_snapshot,
            clarification: c.clarification,
            location: c.location,
            photos: photoMap.get(c.id) || [],
          })),
        })),
        additionalObservations: additionalObs || [],
        limitations: limitationTexts,
        stageVerdict,
        certificateNumber,
        generatedAt,
        signatureDataUrl,
        coverPhotoDataUrl,
        weatherSnapshot: inspection.weather_snapshot ?? null,
        clientName: inspection.bookings?.client?.full_name ?? null,
        buildingType: inspection.building_type ?? null,
        occupancyStatus: inspection.occupancy_status ?? null,
        inAttendance: inspection.in_attendance ?? null,
        inspectionConstraints: inspection.inspection_constraints ?? null,
        otherBuildingType: inspection.other_building_type ?? null,
        otherInAttendance: inspection.other_in_attendance ?? null,
        otherConstraints: inspection.other_constraints ?? null,
      });

      // Generate PDF using Puppeteer
      const pdfBuffer = await generatePdfFromHtml(html, { headerTemplate });

      // Upload PDF to R2
      const storagePath = `reports/${inspectionId}/v${nextVersion}.pdf`;

      const upload = await uploadFile('reports', storagePath, pdfBuffer, {
        contentType: 'application/pdf', upsert: true,
      });
      if (!upload.ok) {
        logger.error(
          { inspectionId, storagePath, reason: upload.reason, detail: upload.message },
          'ReportService.generate: PDF upload failed'
        );
        await db.delete(reportVersions).where(eq(reportVersions.id, report.id));
        // Carried into the admin escalation email, so whoever picks it up knows
        // whether to retry or to go looking at R2.
        return { report: null, error: `Failed to upload PDF to storage: ${upload.message}` };
      }

      // Atomically demote prior latest and mark this report as latest.
      // Protected by the partial unique index `report_versions_one_latest_per_inspection`.
      try {
        await promoteReportToLatest(inspectionId, report.id);
      } catch (promoteError) {
        logger.error({ err: promoteError, reportId: report.id, inspectionId }, 'ReportService.generate: promote-to-latest failed');
        // Clean up the orphaned row and its uploaded PDF.
        await db.delete(reportVersions).where(eq(reportVersions.id, report.id)).catch(() => undefined);
        await deleteFiles('reports', [storagePath]).catch(() => false);
        return { report: null, error: 'Failed to finalize report version' };
      }

      // Revoke existing report access tokens
      await db
        .update(reportAccessTokens)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(reportAccessTokens.inspectionId, inspectionId),
          isNull(reportAccessTokens.revokedAt),
        ));

      // Generate access token only for non-solo inspections (solo has no client to send it to)
      let accessToken: string | null = null;
      let expiresAt: Date | null = null;

      if (!inspection.is_solo) {
        accessToken = randomUUID();
        expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

        await db.insert(reportAccessTokens).values({
          inspectionId: inspectionId,
          token:        accessToken,
          createdBy:    generatedBy,
          expiresAt:    expiresAt,
        });
      }

      // Update report with storage path + stage verdict
      let updatedReport: any;
      try {
        const updated = await db
          .update(reportVersions)
          .set({
            storagePath:   storagePath,
            fileSizeBytes: pdfBuffer.length,
            ...(stageVerdict ? { stageVerdict: stageVerdict } : {}),
          })
          .where(eq(reportVersions.id, report.id))
          .returning();
        updatedReport = updated[0];
        if (!updatedReport) throw new Error('update returned no row');
      } catch (err) {
        logger.error({ err, reportId: report.id, inspectionId }, 'ReportService.generate: report update failed');
        return { report: null, error: 'Failed to update report status' };
      }

      // Log revision event using RevisionService
      await RevisionService.log({
        inspectionId,
        entityType: 'report',
        entityId: report.id,
        action: 'created',
        newValue: { version: nextVersion, certificateNumber },
        changedBy: generatedBy,
      });

      // Notify client that the report is ready (non-solo only). nextVersion > 1
      // means this inspection already had a report before — this generation
      // is a revision (flagged → resubmitted → reapproved), not the first
      // time the client is hearing about it, so it gets a distinct
      // "updated" notification instead of "ready" the second time onward.
      const isRevision = nextVersion > 1;
      if (!inspection.is_solo && accessToken) {
        const client = inspection.bookings?.client as any;
        if (client?.id) {
          // Push SSE event to the client immediately (faster than email)
          broadcast(client.id, isRevision ? 'report.revised' : 'report.ready', {
            inspectionId,
            certificateNumber,
            propertyAddress: inspection.bookings?.property_address || inspection.property_address || '',
          });
        }
        if (client?.id && client?.email) {
          const bookingsRef = inspection.bookings as any;
          await NotificationService.send(isRevision ? 'report_revised' : 'report_ready', {
            recipientId: client.id,
            recipientEmail: client.email,
            data: {
              clientName: client.full_name,
              propertyAddress: bookingsRef?.property_address || inspection.property_address || '',
              reportAccessUrl: `${CLIENT_APP_URL}/reports/access/${accessToken}`,
              certificateNumber,
            },
          }).catch((err) => {
            logger.error({ err, inspectionId }, `ReportService.generate: failed to send ${isRevision ? 'report_revised' : 'report_ready'} notification`);
          });
        }
      }

      return {
        report: {
          id:                 updatedReport.id,
          inspection_id:      updatedReport.inspectionId,
          version:            updatedReport.version,
          certificate_number: updatedReport.certificateNumber,
          is_latest:          updatedReport.isLatest,
          generated_at:       toIso(updatedReport.generatedAt),
          generated_by:       updatedReport.generatedBy,
          storage_path:       updatedReport.storagePath,
          file_size_bytes:    updatedReport.fileSizeBytes,
          accessToken,
          accessExpiresAt:    expiresAt?.toISOString() ?? null,
        } as unknown as Report & { accessToken: string | null; accessExpiresAt: string | null },
        error: null,
      };

    } catch (err) {
      logger.error({ err, inspectionId, reportId: report.id }, 'ReportService.generate: PDF generation failed');

      // Delete the failed report record
      await db.delete(reportVersions).where(eq(reportVersions.id, report.id)).catch(() => undefined);

      return { report: null, error: 'Failed to generate PDF report' };
    }
  }

  static async getLatest(user: { id: string; role: string }, inspectionId: string) {
    // Get inspection + property + inspector in one query for access check and payload
    const inspectorUser = aliasedTable(users, 'latest_inspector');
    const [inspection] = await db
      .select({
        id:                    inspections.id,
        inspectorId:           inspections.inspectorId,
        bookingId:             inspections.bookingId,
        bookingClientId:       bookings.clientId,
        propertyAddress:       inspections.propertyAddress,
        propertyType:          inspections.propertyType,
        state:                 inspections.state,
        country:               inspections.country,
        submittedAt:           inspections.submittedAt,
        createdAt:             inspections.createdAt,
        buildingType:          inspections.buildingType,
        occupancyStatus:       inspections.occupancyStatus,
        inAttendance:          inspections.inAttendance,
        inspectionConstraints: inspections.inspectionConstraints,
        inspectionType:        inspections.inspectionType,
        bPropertyAddress:      bookings.propertyAddress,
        bPropertyCity:         bookings.propertyCity,
        bPropertyType:         bookings.propertyType,
        bRequestedDate:        bookings.requestedDate,
        bInspectionType:       bookings.inspectionType,
        bCountry:              bookings.country,
        inspectorUserId:       inspectorUser.id,
        inspectorName:         inspectorUser.fullName,
      })
      .from(inspections)
      .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
      .leftJoin(inspectorUser, eq(inspectorUser.id, inspections.inspectorId))
      .where(eq(inspections.id, inspectionId))
      .limit(1);

    if (!inspection) {
      return { report: null, downloadUrl: null, error: 'Inspection not found' };
    }

    // Check access
    const hasAccess =
      user.role === 'admin' ||
      inspection.inspectorId === user.id ||
      inspection.bookingClientId === user.id;

    if (!hasAccess) {
      return { report: null, downloadUrl: null, error: 'Access denied' };
    }

    // Get latest report version
    const [reportRow] = await db
      .select({
        id:                reportVersions.id,
        inspectionId:      reportVersions.inspectionId,
        version:           reportVersions.version,
        certificateNumber: reportVersions.certificateNumber,
        isLatest:          reportVersions.isLatest,
        generatedAt:       reportVersions.generatedAt,
        generatedBy:       reportVersions.generatedBy,
        storagePath:       reportVersions.storagePath,
        fileSizeBytes:     reportVersions.fileSizeBytes,
        stageVerdict:      reportVersions.stageVerdict,
      })
      .from(reportVersions)
      .where(and(
        eq(reportVersions.inspectionId, inspectionId),
        eq(reportVersions.isLatest, true),
      ))
      .orderBy(desc(reportVersions.version))
      .limit(1);

    if (!reportRow) {
      return { report: null, downloadUrl: null, error: 'No report available' };
    }

    // Generate signed download URL for the PDF
    let downloadUrl: string | null = null;
    if (reportRow.storagePath) {
      const filename = buildReportFilename({
        inspectionTypeAbbr: resolveInspectionTypeAbbr(inspection.inspectionType || inspection.bInspectionType),
        propertyAddress: inspection.propertyAddress || inspection.bPropertyAddress,
        certificateNumber: reportRow.certificateNumber,
        generatedAt: reportRow.generatedAt,
      });
      downloadUrl = await getSignedDownloadUrl('reports', reportRow.storagePath, 3600, `attachment; filename="${filename}"`);
    }

    // Inspector ACHI details
    let achiNumber: string | null = null;
    let achiStatus: string | null = null;
    if (inspection.inspectorId) {
      const [prof] = await db
        .select({ achiNumber: inspectorProfiles.achiNumber, achiStatus: inspectorProfiles.achiStatus })
        .from(inspectorProfiles)
        .where(eq(inspectorProfiles.userId, inspection.inspectorId))
        .limit(1);
      if (prof) { achiNumber = prof.achiNumber; achiStatus = prof.achiStatus; }
    }

    // Assemble the nested sections → conditions → observations + photos shape
    const sections = await this.buildClientSections(inspectionId);

    const report = {
      id:                reportRow.id,
      inspectionId:      reportRow.inspectionId,
      version:           reportRow.version,
      certificateNumber: reportRow.certificateNumber ?? undefined,
      generatedAt:       toIso(reportRow.generatedAt),
      stage_verdict:     reportRow.stageVerdict ?? null,
      property: {
        address: inspection.bPropertyAddress || inspection.propertyAddress || '',
        city:    inspection.bPropertyCity || inspection.state || '',
        type:    inspection.bPropertyType || inspection.propertyType || '',
        country: inspection.bCountry || inspection.country || '',
      },
      inspector: {
        id:         inspection.inspectorUserId || inspection.inspectorId || '',
        fullName:   inspection.inspectorName || 'Inspector',
        achiNumber: achiNumber ?? undefined,
        achiStatus: achiStatus ?? undefined,
      },
      inspectionDate: toIso(inspection.submittedAt)
        || (inspection.bRequestedDate ? String(inspection.bRequestedDate) : toIso(inspection.createdAt))
        || new Date().toISOString(),
      buildingType:          inspection.buildingType ?? null,
      occupancyStatus:       inspection.occupancyStatus ?? null,
      inAttendance:          inspection.inAttendance ?? null,
      inspectionConstraints: inspection.inspectionConstraints ?? null,
      sections,
      downloadUrl: downloadUrl ?? undefined,
    };

    return { report: report as unknown as Report, downloadUrl, error: null };
  }

  /**
   * Assemble the client-facing nested report structure for an inspection:
   * sections → conditions → { observations, photos (signed URLs) }.
   * Shared shape consumed by the client ReportView and token-access page.
   */
  private static async buildClientSections(inspectionId: string) {
    const sectionRows = await db
      .select({
        id:           inspectionSections.id,
        name:         inspectionSections.name,
        displayOrder: inspectionSections.displayOrder,
        status:       inspectionSections.status,
      })
      .from(inspectionSections)
      .where(eq(inspectionSections.inspectionId, inspectionId))
      .orderBy(asc(inspectionSections.displayOrder));

    const conditionRows = await db
      .select({
        id:                     inspectionConditions.id,
        sectionId:              inspectionConditions.sectionId,
        name:                   inspectionConditions.name,
        displayOrder:           inspectionConditions.displayOrder,
        severity:               inspectionConditions.severity,
        riskSnapshot:           inspectionConditions.riskSnapshot,
        recommendationSnapshot: inspectionConditions.recommendationSnapshot,
        clarification:          inspectionConditions.clarification,
      })
      .from(inspectionConditions)
      .where(eq(inspectionConditions.inspectionId, inspectionId))
      .orderBy(asc(inspectionConditions.displayOrder));

    const conditionIds = conditionRows.map((c) => c.id);

    // Condition-level observations
    const obsByCondition = new Map<string, Array<{ id: string; text: string }>>();
    if (conditionIds.length > 0) {
      const obsRows = await db
        .select({ id: observations.id, conditionId: observations.conditionId, text: observations.text })
        .from(observations)
        .where(and(
          eq(observations.inspectionId, inspectionId),
          eq(observations.isDeleted, false),
        ))
        .orderBy(asc(observations.createdAt));
      for (const o of obsRows) {
        if (!o.conditionId) continue;
        const arr = obsByCondition.get(o.conditionId) ?? [];
        arr.push({ id: o.id, text: o.text });
        obsByCondition.set(o.conditionId, arr);
      }
    }

    // Photos + signed URLs
    const photosByCondition = new Map<string, Array<{ id: string; storagePath: string | null; thumbPath: string | null }>>();
    const allPaths: string[] = [];
    if (conditionIds.length > 0) {
      const photoRows = await db
        .select({
          id:          inspectionPhotos.id,
          conditionId: inspectionPhotos.conditionId,
          storagePath: inspectionPhotos.storagePath,
          thumbPath:   inspectionPhotos.thumbPath,
        })
        .from(inspectionPhotos)
        .where(and(
          eq(inspectionPhotos.inspectionId, inspectionId),
          eq(inspectionPhotos.isDeleted, false),
          inArray(inspectionPhotos.conditionId, conditionIds),
        ));
      for (const p of photoRows) {
        if (!p.conditionId) continue;
        const arr = photosByCondition.get(p.conditionId) ?? [];
        arr.push({ id: p.id, storagePath: p.storagePath, thumbPath: p.thumbPath });
        photosByCondition.set(p.conditionId, arr);
        if (p.storagePath) allPaths.push(p.storagePath);
        if (p.thumbPath) allPaths.push(p.thumbPath);
      }
    }

    const signedUrlByPath = new Map<string, string>();
    if (allPaths.length > 0) {
      await Promise.all(allPaths.map(async (p) => {
        const url = await getSignedDownloadUrl('inspection-photos', p, 3600);
        if (url) signedUrlByPath.set(p, url);
      }));
    }

    const conditionsBySection = new Map<string, any[]>();
    for (const c of conditionRows) {
      const arr = conditionsBySection.get(c.sectionId) ?? [];
      arr.push({
        id:                      c.id,
        name:                    c.name,
        severity:                c.severity,
        risk_snapshot:           c.riskSnapshot ?? undefined,
        recommendation_snapshot: c.recommendationSnapshot ?? undefined,
        clarification:           c.clarification ?? undefined,
        observations:            obsByCondition.get(c.id) ?? [],
        photos: (photosByCondition.get(c.id) ?? []).map((p) => ({
          id:       p.id,
          url:      p.storagePath ? signedUrlByPath.get(p.storagePath) ?? '' : '',
          thumbUrl: p.thumbPath ? signedUrlByPath.get(p.thumbPath) ?? undefined : undefined,
        })),
      });
      conditionsBySection.set(c.sectionId, arr);
    }

    return sectionRows.map((s) => ({
      id:         s.id,
      name:       s.name,
      status:     s.status ?? undefined,
      conditions: conditionsBySection.get(s.id) ?? [],
    }));
  }

  static async getVersion(inspectionId: string, version: number) {
    const [reportRow] = await db
      .select({
        id:                reportVersions.id,
        inspectionId:      reportVersions.inspectionId,
        version:           reportVersions.version,
        isLatest:          reportVersions.isLatest,
        generatedAt:       reportVersions.generatedAt,
        generatedBy:       reportVersions.generatedBy,
        storagePath:       reportVersions.storagePath,
        fileSizeBytes:     reportVersions.fileSizeBytes,
        certificateNumber: reportVersions.certificateNumber,
      })
      .from(reportVersions)
      .where(and(
        eq(reportVersions.inspectionId, inspectionId),
        eq(reportVersions.version, version),
      ))
      .limit(1);

    if (!reportRow) {
      return { report: null, downloadUrl: null, error: 'Report version not found' };
    }

    // Generate signed download URL
    let downloadUrl: string | null = null;
    if (reportRow.storagePath) {
      const [inspectionRow] = await db
        .select({
          propertyAddress:  inspections.propertyAddress,
          inspectionType:   inspections.inspectionType,
          bPropertyAddress: bookings.propertyAddress,
          bInspectionType:  bookings.inspectionType,
        })
        .from(inspections)
        .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
        .where(eq(inspections.id, inspectionId))
        .limit(1);

      const filename = buildReportFilename({
        inspectionTypeAbbr: resolveInspectionTypeAbbr(inspectionRow?.inspectionType || inspectionRow?.bInspectionType),
        propertyAddress: inspectionRow?.propertyAddress || inspectionRow?.bPropertyAddress,
        certificateNumber: reportRow.certificateNumber,
        generatedAt: reportRow.generatedAt,
      });
      downloadUrl = await getSignedDownloadUrl('reports', reportRow.storagePath, 3600, `attachment; filename="${filename}"`);
    }

    const report = {
      id:                 reportRow.id,
      inspection_id:      reportRow.inspectionId,
      version:            reportRow.version,
      is_latest:          reportRow.isLatest,
      generated_at:       toIso(reportRow.generatedAt),
      generated_by:       reportRow.generatedBy,
      storage_path:       reportRow.storagePath,
      file_size_bytes:    reportRow.fileSizeBytes,
      certificate_number: reportRow.certificateNumber,
    };

    return { report: report as unknown as Report, downloadUrl, error: null };
  }

  static async getAllVersions(inspectionId: string) {
    try {
      const rows = await db
        .select({
          version:        reportVersions.version,
          isLatest:       reportVersions.isLatest,
          generatedAt:    reportVersions.generatedAt,
          generatedBy:    reportVersions.generatedBy,
          generatorName:  users.fullName,
        })
        .from(reportVersions)
        .leftJoin(users, eq(users.id, reportVersions.generatedBy))
        .where(eq(reportVersions.inspectionId, inspectionId))
        .orderBy(desc(reportVersions.version));

      return rows.map((r) => ({
        version:     r.version,
        isLatest:    r.isLatest,
        generatedAt: toIso(r.generatedAt),
        generatedBy: r.generatorName ?? 'Unknown',
      })) as unknown as ReportVersion[];
    } catch (err) {
      logger.error({ err, inspectionId }, 'ReportService.getAllVersions failed');
      return [];
    }
  }

  static async accessByToken(token: string) {
    // Find report access token + inspection + booking + inspector in one shot
    const inspectorUser = aliasedTable(users, 'access_inspector');

    const [tokenRow] = await db
      .select({
        tokenId:               reportAccessTokens.id,
        inspectionId:          reportAccessTokens.inspectionId,
        expiresAt:             reportAccessTokens.expiresAt,
        revokedAt:             reportAccessTokens.revokedAt,
        // Inspection
        inspId:                inspections.id,
        inspInspectorId:       inspections.inspectorId,
        inspSubmittedAt:       inspections.submittedAt,
        inspCreatedAt:         inspections.createdAt,
        buildingType:          inspections.buildingType,
        occupancyStatus:       inspections.occupancyStatus,
        inAttendance:          inspections.inAttendance,
        inspectionConstraints: inspections.inspectionConstraints,
        inspectionType:        inspections.inspectionType,
        inspCountry:           inspections.country,
        // Inspector user
        inspectorFullName:     inspectorUser.fullName,
        // Booking
        bPropertyAddress:      bookings.propertyAddress,
        bPropertyCity:         bookings.propertyCity,
        bPropertyType:         bookings.propertyType,
        bRequestedDate:        bookings.requestedDate,
        bInspectionType:       bookings.inspectionType,
        bCountry:              bookings.country,
      })
      .from(reportAccessTokens)
      .leftJoin(inspections, eq(inspections.id, reportAccessTokens.inspectionId))
      .leftJoin(inspectorUser, eq(inspectorUser.id, inspections.inspectorId))
      .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
      .where(and(
        eq(reportAccessTokens.token, token),
        isNull(reportAccessTokens.revokedAt),
      ))
      .limit(1);

    if (!tokenRow) {
      return { report: null, inspection: null, property: null, error: 'Invalid or expired access token' };
    }

    // Check expiration
    if (tokenRow.expiresAt && new Date(tokenRow.expiresAt) < new Date()) {
      return { report: null, inspection: null, property: null, error: 'Access token has expired' };
    }

    // Fetch latest report version (or fallback first one)
    const reportRows = tokenRow.inspId
      ? await db
          .select({
            id:                reportVersions.id,
            version:           reportVersions.version,
            isLatest:          reportVersions.isLatest,
            storagePath:       reportVersions.storagePath,
            certificateNumber: reportVersions.certificateNumber,
            generatedAt:       reportVersions.generatedAt,
            stageVerdict:      reportVersions.stageVerdict,
          })
          .from(reportVersions)
          .where(eq(reportVersions.inspectionId, tokenRow.inspId))
      : [];

    const latestReport = reportRows.find((r) => r.isLatest) || reportRows[0] || null;

    // Generate signed download URL
    let downloadUrl: string | null = null;
    if (latestReport?.storagePath) {
      const filename = buildReportFilename({
        inspectionTypeAbbr: resolveInspectionTypeAbbr(tokenRow.inspectionType || tokenRow.bInspectionType),
        propertyAddress: tokenRow.bPropertyAddress,
        certificateNumber: latestReport.certificateNumber,
        generatedAt: latestReport.generatedAt,
      });
      downloadUrl = await getSignedDownloadUrl('reports', latestReport.storagePath, 3600, `attachment; filename="${filename}"`);
    }

    // Inspector ACHI details
    let achiNumber: string | null = null;
    let achiStatus: string | null = null;
    if (tokenRow.inspInspectorId) {
      const [prof] = await db
        .select({ achiNumber: inspectorProfiles.achiNumber, achiStatus: inspectorProfiles.achiStatus })
        .from(inspectorProfiles)
        .where(eq(inspectorProfiles.userId, tokenRow.inspInspectorId))
        .limit(1);
      if (prof) { achiNumber = prof.achiNumber; achiStatus = prof.achiStatus; }
    }

    const sections = tokenRow.inspId ? await this.buildClientSections(tokenRow.inspId) : [];

    return {
      report: latestReport
        ? {
            id:                latestReport.id,
            inspectionId:      tokenRow.inspId,
            version:           latestReport.version,
            certificateNumber: latestReport.certificateNumber ?? undefined,
            generatedAt:       toIso(latestReport.generatedAt),
            stage_verdict:     latestReport.stageVerdict ?? null,
            property: {
              address: tokenRow.bPropertyAddress || '',
              city:    tokenRow.bPropertyCity || '',
              type:    tokenRow.bPropertyType || '',
              country: tokenRow.bCountry || tokenRow.inspCountry || '',
            },
            inspector: {
              id:         tokenRow.inspInspectorId || '',
              fullName:   tokenRow.inspectorFullName || 'Inspector',
              achiNumber: achiNumber ?? undefined,
              achiStatus: achiStatus ?? undefined,
            },
            inspectionDate: toIso(tokenRow.inspSubmittedAt)
              || (tokenRow.bRequestedDate ? String(tokenRow.bRequestedDate) : toIso(tokenRow.inspCreatedAt))
              || new Date().toISOString(),
            buildingType:          tokenRow.buildingType ?? null,
            occupancyStatus:       tokenRow.occupancyStatus ?? null,
            inAttendance:          tokenRow.inAttendance ?? null,
            inspectionConstraints: tokenRow.inspectionConstraints ?? null,
            sections,
            downloadUrl: downloadUrl ?? undefined,
          }
        : null,
      inspection: tokenRow.inspId
        ? {
            id:             tokenRow.inspId,
            inspectorName:  tokenRow.inspectorFullName,
          }
        : null,
      property: tokenRow.bPropertyAddress
        ? {
            address: tokenRow.bPropertyAddress,
            city:    tokenRow.bPropertyCity,
            type:    tokenRow.bPropertyType,
            country: tokenRow.bCountry || tokenRow.inspCountry || null,
          }
        : null,
      error: null,
    };
  }

  /**
   * Get (or regenerate) a share link for a report. Inspector (owner), admin, and
   * client (of the booking) can call this. Returns { token, expiresAt } for the
   * currently-active, non-expired, non-revoked token; if no token exists (solo
   * inspections, or token was revoked), callers pass `regenerate: true` to mint
   * a new 30-day token.
   */
  static async getShareLink(
    user: { id: string; role: string },
    inspectionId: string,
    opts: { regenerate?: boolean } = {}
  ): Promise<{ token: string | null; expiresAt: string | null; error: string | null }> {
    // Access check — reuse getLatest logic via a light select.
    const [inspection] = await db
      .select({
        id:              inspections.id,
        inspectorId:     inspections.inspectorId,
        isSolo:          inspections.isSolo,
        bookingClientId: bookings.clientId,
      })
      .from(inspections)
      .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
      .where(eq(inspections.id, inspectionId))
      .limit(1);

    if (!inspection) {
      return { token: null, expiresAt: null, error: 'Inspection not found' };
    }

    const hasAccess =
      user.role === 'admin' ||
      inspection.inspectorId === user.id ||
      inspection.bookingClientId === user.id;

    if (!hasAccess) {
      return { token: null, expiresAt: null, error: 'Access denied' };
    }

    if (opts.regenerate) {
      // Revoke existing tokens, mint a new one
      await db
        .update(reportAccessTokens)
        .set({ revokedAt: new Date() })
        .where(and(
          eq(reportAccessTokens.inspectionId, inspectionId),
          isNull(reportAccessTokens.revokedAt),
        ));

      const token = randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      try {
        await db.insert(reportAccessTokens).values({
          inspectionId: inspectionId,
          token,
          createdBy:    user.id,
          expiresAt:    expiresAt,
        });
      } catch (err) {
        logger.error({ err, inspectionId }, 'ReportService.getShareLink: insert failed');
        return { token: null, expiresAt: null, error: 'Failed to create share link' };
      }

      return { token, expiresAt: expiresAt.toISOString(), error: null };
    }

    // Fetch the active (non-revoked, non-expired) token
    const [tokenRow] = await db
      .select({
        token:     reportAccessTokens.token,
        expiresAt: reportAccessTokens.expiresAt,
        revokedAt: reportAccessTokens.revokedAt,
      })
      .from(reportAccessTokens)
      .where(and(
        eq(reportAccessTokens.inspectionId, inspectionId),
        isNull(reportAccessTokens.revokedAt),
      ))
      .orderBy(desc(reportAccessTokens.createdAt))
      .limit(1);

    if (!tokenRow) {
      return { token: null, expiresAt: null, error: null };
    }

    if (tokenRow.expiresAt && new Date(tokenRow.expiresAt) < new Date()) {
      return { token: null, expiresAt: null, error: null };
    }

    return { token: tokenRow.token, expiresAt: toIso(tokenRow.expiresAt), error: null };
  }

  /**
   * List all reports generated by an inspector.
   * Returns latest report per inspection with property/booking context.
   */
  static async listForInspector(
    inspectorId: string,
    filters: { page?: number; limit?: number } = {}
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const offset = (page - 1) * limit;

    const bookingClient = aliasedTable(users, 'list_insp_booking_client');

    try {
      const [rows, totalRow] = await Promise.all([
        db
          .select({
            id:                reportVersions.id,
            inspectionId:      reportVersions.inspectionId,
            version:           reportVersions.version,
            certificateNumber: reportVersions.certificateNumber,
            isLatest:          reportVersions.isLatest,
            generatedAt:       reportVersions.generatedAt,
            generatedBy:       reportVersions.generatedBy,
            storagePath:       reportVersions.storagePath,
            fileSizeBytes:     reportVersions.fileSizeBytes,
            // inspection
            inspId:               inspections.id,
            inspInspectorId:      inspections.inspectorId,
            inspIsSolo:           inspections.isSolo,
            inspStatus:           inspections.status,
            inspPropertyAddress:  inspections.propertyAddress,
            inspPropertyType:     inspections.propertyType,
            inspInspectionType:   inspections.inspectionType,
            inspState:            inspections.state,
            inspLga:              inspections.lga,
            // booking
            bId:               bookings.id,
            bPropertyAddress:  bookings.propertyAddress,
            bPropertyCity:     bookings.propertyCity,
            bPropertyType:     bookings.propertyType,
            bInspectionType:   bookings.inspectionType,
            bRequestedDate:    bookings.requestedDate,
            // client
            clientFullName:    bookingClient.fullName,
          })
          .from(reportVersions)
          .innerJoin(inspections, eq(inspections.id, reportVersions.inspectionId))
          .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
          .leftJoin(bookingClient, eq(bookingClient.id, bookings.clientId))
          .where(and(
            eq(reportVersions.isLatest, true),
            eq(inspections.inspectorId, inspectorId),
          ))
          .orderBy(desc(reportVersions.generatedAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(reportVersions)
          .innerJoin(inspections, eq(inspections.id, reportVersions.inspectionId))
          .where(and(
            eq(reportVersions.isLatest, true),
            eq(inspections.inspectorId, inspectorId),
          )),
      ]);

      const reports = rows.map((r) => {
        const address = r.inspIsSolo
          ? r.inspPropertyAddress
          : r.bPropertyAddress ?? null;
        const city = r.inspIsSolo
          ? (r.inspLga ? `${r.inspLga}, ${r.inspState}` : r.inspState ?? null)
          : r.bPropertyCity ?? null;
        const inspectionType = r.inspIsSolo
          ? r.inspInspectionType
          : r.bInspectionType ?? r.inspInspectionType ?? null;

        return {
          id: r.id,
          inspectionId: r.inspectionId,
          version: r.version,
          certificateNumber: r.certificateNumber,
          generatedAt: toIso(r.generatedAt),
          fileSizeBytes: r.fileSizeBytes,
          status: r.inspStatus,
          isSolo: r.inspIsSolo,
          propertyAddress: address,
          propertyCity: city,
          inspectionType,
          clientName: r.clientFullName ?? null,
        };
      });

      return { reports, total: totalRow[0]?.count ?? 0, page, limit };
    } catch (err) {
      logger.error({ err, inspectorId }, 'ReportService.listForInspector failed');
      return { reports: [], total: 0, page, limit };
    }
  }

  /**
   * List all reports for a client's bookings.
   * Returns latest report per inspection along with booking context.
   * Also returns a per-booking count of historical versions.
   */
  static async listForClient(
    clientId: string,
    filters: { page?: number; limit?: number; bookingId?: string } = {}
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 50;
    const offset = (page - 1) * limit;

    const inspectorUser = aliasedTable(users, 'list_client_inspector');

    const conds: any[] = [
      eq(reportVersions.isLatest, true),
      eq(bookings.clientId, clientId),
    ];
    if (filters.bookingId) {
      conds.push(eq(inspections.bookingId, filters.bookingId));
    }

    try {
      const [rows, totalRow] = await Promise.all([
        db
          .select({
            id:                reportVersions.id,
            inspectionId:      reportVersions.inspectionId,
            version:           reportVersions.version,
            certificateNumber: reportVersions.certificateNumber,
            isLatest:          reportVersions.isLatest,
            generatedAt:       reportVersions.generatedAt,
            storagePath:       reportVersions.storagePath,
            fileSizeBytes:     reportVersions.fileSizeBytes,
            // inspection
            inspId:        inspections.id,
            inspStatus:    inspections.status,
            inspBookingId: inspections.bookingId,
            // inspector
            inspectorId:        inspectorUser.id,
            inspectorFullName:  inspectorUser.fullName,
            // booking
            bId:               bookings.id,
            bPropertyAddress:  bookings.propertyAddress,
            bPropertyCity:     bookings.propertyCity,
            bPropertyType:     bookings.propertyType,
            bInspectionType:   bookings.inspectionType,
            bRequestedDate:    bookings.requestedDate,
          })
          .from(reportVersions)
          .innerJoin(inspections, eq(inspections.id, reportVersions.inspectionId))
          .innerJoin(bookings, eq(bookings.id, inspections.bookingId))
          .leftJoin(inspectorUser, eq(inspectorUser.id, inspections.inspectorId))
          .where(and(...conds))
          .orderBy(desc(reportVersions.generatedAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(reportVersions)
          .innerJoin(inspections, eq(inspections.id, reportVersions.inspectionId))
          .innerJoin(bookings, eq(bookings.id, inspections.bookingId))
          .where(and(...conds)),
      ]);

      // Get per-booking version counts in a single query
      const bookingIds = Array.from(
        new Set(rows.map((r) => r.inspBookingId).filter((id): id is string => Boolean(id)))
      );

      const reportsPerBooking = new Map<string, number>();
      if (bookingIds.length > 0) {
        const countRows = await db
          .select({
            bookingId: inspections.bookingId,
          })
          .from(reportVersions)
          .innerJoin(inspections, eq(inspections.id, reportVersions.inspectionId))
          .where(inArray(inspections.bookingId, bookingIds));

        for (const c of countRows) {
          if (!c.bookingId) continue;
          reportsPerBooking.set(c.bookingId, (reportsPerBooking.get(c.bookingId) ?? 0) + 1);
        }
      }

      const reports = rows.map((r) => ({
        id: r.id,
        inspectionId: r.inspectionId,
        bookingId: r.inspBookingId,
        version: r.version,
        certificateNumber: r.certificateNumber,
        generatedAt: toIso(r.generatedAt),
        fileSizeBytes: r.fileSizeBytes,
        status: r.inspStatus,
        propertyAddress: r.bPropertyAddress ?? null,
        propertyCity: r.bPropertyCity ?? null,
        inspectionType: r.bInspectionType ?? null,
        requestedDate: r.bRequestedDate ? String(r.bRequestedDate) : null,
        inspectorName: r.inspectorFullName ?? null,
        totalVersionsForBooking: r.inspBookingId
          ? reportsPerBooking.get(r.inspBookingId) ?? 1
          : 1,
      }));

      return { reports, total: totalRow[0]?.count ?? 0, page, limit };
    } catch (err) {
      logger.error({ err, clientId }, 'ReportService.listForClient failed');
      return { reports: [], total: 0, page, limit };
    }
  }

  static async getHistory(inspectionId: string) {
    try {
      const rows = await db
        .select({
          id:         revisionEvents.id,
          action:     revisionEvents.action,
          newValue:   revisionEvents.newValue,
          changedAt:  revisionEvents.changedAt,
          changedBy:  revisionEvents.changedBy,
          actorName:  users.fullName,
        })
        .from(revisionEvents)
        .leftJoin(users, eq(users.id, revisionEvents.changedBy))
        .where(and(
          eq(revisionEvents.inspectionId, inspectionId),
          eq(revisionEvents.entityType, 'report'),
        ))
        .orderBy(desc(revisionEvents.changedAt));

      return rows.map((e) => ({
        id:        e.id,
        action:    e.action,
        newValue:  e.newValue,
        changedAt: toIso(e.changedAt),
        changedBy: e.actorName ?? 'Unknown',
      }));
    } catch (err) {
      logger.error({ err, inspectionId }, 'ReportService.getHistory failed');
      return [];
    }
  }
}
