import { aliasedTable, and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  adminActions,
  bookings,
  inspectionConditions,
  inspectionSections,
  inspectorProfiles,
  inspections,
  notificationLogs,
  revisionEvents,
  syncConflicts,
  tokenPurchases,
  users,
} from '../db/schema.js';
import { NotificationService } from './NotificationService.js';
import { RevisionService } from './RevisionService.js';
import { logger } from '../lib/logger.js';
import { listFiles } from '../lib/storage.js';


export interface DashboardStats {
  totalInspectors: number;
  activeInspectors: number;
  certifiedInspectors: number;
  totalClients: number;
  totalBookings: number;
  pendingBookings: number;
  acceptedBookings: number;
  completedBookings: number;
  pendingReviewCount: number;
  openFlagsCount: number;
}

/** Per-status inspector counts. `all` is the same population the dashboard's
 *  Total Inspectors tile counts, so the two are reconcilable by construction. */
export interface InspectorStatusCounts {
  all: number;
  certified: number;
  candidate: number;
  suspended: number;
  expired: number;
}

export interface InspectorListItem {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  achiNumber: string | null;
  achiStatus: string;
  isActive: boolean;
  totalInspections: number;
  rating: number | null;
  createdAt: string;
}

export interface ReviewQueueItem {
  inspectionId: string;
  submittedAt: string;
  inspectorName: string;
  propertyAddress: string;
  conditionCounts: {
    acceptable: number;
    monitor: number;
    repairRequired: number;
    unsafe: number;
    incomplete: number;
  };
  // Section-level pass count -- distinct from conditionCounts.acceptable.
  // A section marked "pass" has zero condition rows at all (nothing to log),
  // so an all-pass inspection shows every conditionCount at 0, which reads as
  // broken/empty in the UI without this to explain why.
  sectionsPassedCount: number;
  totalSections: number;
}

export interface FlagItem {
  inspectionId: string;
  flaggedAt: string;
  flaggedBy: string;
  flagReason: string;
  inspectorName: string;
  propertyAddress: string;
}

export interface ClientListItem {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: string;
  createdAt: string;
  totalBookings: number;
  completedBookings: number;
}

function toIso(v: any): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export class AdminService {
  /**
   * Health check for all services
   */
  static async healthCheck(_fastify: any): Promise<{
    db: 'ok' | 'error';
    storage: 'ok' | 'error';
    wordpress: 'ok' | 'error';
    resend: 'ok' | 'error';
  }> {
    const results: {
      db: 'ok' | 'error';
      storage: 'ok' | 'error';
      wordpress: 'ok' | 'error';
      resend: 'ok' | 'error';
    } = {
      db: 'error',
      storage: 'error',
      wordpress: 'error',
      resend: 'error',
    };

    // Test Database
    try {
      await db.select({ id: users.id }).from(users).limit(1);
      results.db = 'ok';
    } catch (e) {
      logger.error({ err: e }, 'AdminService.healthCheck: database check failed');
    }

    // Test R2 storage
    try {
      const items = await listFiles('inspection-photos', '', { limit: 1 });
      // empty bucket is fine — listFiles returns [] without error in that case
      void items;
      results.storage = 'ok';
    } catch (e) {
      logger.error({ err: e }, 'AdminService.healthCheck: storage check failed');
    }

    // Test WordPress bridge
    try {
      const response = await fetch(`${process.env.WP_BASE_URL}/wp-json/inspectafrica/v1/`, {
        method: 'HEAD',
        headers: { 'X-IA-API-Key': process.env.WP_API_KEY! },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) results.wordpress = 'ok';
    } catch (e) {
      logger.error({ err: e }, 'AdminService.healthCheck: WordPress check failed');
    }

    // Test Resend (just check env var)
    if (process.env.RESEND_API_KEY) {
      results.resend = 'ok';
    }

    return results;
  }

  /**
   * Get dashboard statistics
   */
  static async getDashboard(): Promise<{ stats: DashboardStats; recentActivity: any[] }> {
    // Fire all counts and recent-activity query in parallel — each is an
    // independent read. With Drizzle/postgres-js these become one round trip
    // each over a pooled connection.
    const countExpr = sql<number>`count(*)::int`;

    const [
      totalInspectorsRes,
      activeInspectorsRes,
      certifiedInspectorsRes,
      totalClientsRes,
      totalBookingsRes,
      pendingBookingsRes,
      acceptedBookingsRes,
      completedBookingsRes,
      pendingReviewRes,
      openFlagsRes,
      recentActivityRes,
    ] = await Promise.all([
      db.select({ count: countExpr }).from(inspectorProfiles),
      db.select({ count: countExpr }).from(inspectorProfiles).where(eq(inspectorProfiles.isActive, true)),
      db.select({ count: countExpr }).from(inspectorProfiles).where(eq(inspectorProfiles.achiStatus, 'certified')),
      // Count the same population the Clients screen lists (listClients filters
      // users by role), not client_profiles. A client user whose profile row was
      // never created — or an orphaned profile — made the dashboard tile and the
      // list disagree, with no way to tell which was right.
      db.select({ count: countExpr }).from(users).where(eq(users.role, 'client')),
      db.select({ count: countExpr }).from(bookings),
      db.select({ count: countExpr }).from(bookings).where(eq(bookings.status, 'open')),
      db.select({ count: countExpr }).from(bookings).where(eq(bookings.status, 'confirmed')),
      db.select({ count: countExpr }).from(bookings).where(eq(bookings.status, 'completed')),
      db.select({ count: countExpr }).from(inspections).where(eq(inspections.status, 'pending_review')),
      db.select({ count: countExpr }).from(inspections).where(eq(inspections.status, 'flagged')),
      db
        .select({
          id:           revisionEvents.id,
          inspectionId: revisionEvents.inspectionId,
          entityType:   revisionEvents.entityType,
          action:       revisionEvents.action,
          changedAt:    revisionEvents.changedAt,
          changedBy:    revisionEvents.changedBy,
          userFullName: users.fullName,
        })
        .from(revisionEvents)
        .leftJoin(users, eq(users.id, revisionEvents.changedBy))
        .orderBy(desc(revisionEvents.changedAt))
        .limit(10),
    ]);

    const totalInspectors = totalInspectorsRes[0]?.count ?? 0;
    const activeInspectors = activeInspectorsRes[0]?.count ?? 0;
    const certifiedInspectors = certifiedInspectorsRes[0]?.count ?? 0;
    const totalClients = totalClientsRes[0]?.count ?? 0;
    const totalBookings = totalBookingsRes[0]?.count ?? 0;
    const pendingBookings = pendingBookingsRes[0]?.count ?? 0;
    const acceptedBookings = acceptedBookingsRes[0]?.count ?? 0;
    const completedBookings = completedBookingsRes[0]?.count ?? 0;
    const pendingReviewCount = pendingReviewRes[0]?.count ?? 0;
    const openFlagsCount = openFlagsRes[0]?.count ?? 0;

    const stats: DashboardStats = {
      totalInspectors,
      activeInspectors,
      certifiedInspectors,
      totalClients,
      totalBookings,
      pendingBookings,
      acceptedBookings,
      completedBookings,
      pendingReviewCount,
      openFlagsCount,
    };

    return {
      stats,
      recentActivity: recentActivityRes.map((e) => ({
        id: String(e.id),
        inspectionId: e.inspectionId,
        entityType: e.entityType,
        action: e.action,
        changedAt: toIso(e.changedAt),
        changedBy: e.userFullName || e.changedBy,
      })),
    };
  }

  /**
   * List inspectors with filters
   */
  static async listInspectors(filters: {
    status?: 'candidate' | 'certified' | 'suspended' | 'expired';
    page?: number;
    limit?: number;
  }): Promise<{ inspectors: InspectorListItem[]; total: number; counts: InspectorStatusCounts }> {
    const page = filters.page || 1;
    const limit = filters.limit || 25;
    const offset = (page - 1) * limit;

    const conds: any[] = [];
    if (filters.status) {
      // achi_status is nullable, so a profile that never got one belongs to no
      // status tab at all — it showed up under "All" and nowhere else, which is
      // how the list came to disagree with the dashboard tile. The column
      // defaults to 'candidate', so that's where a missing status belongs.
      conds.push(
        filters.status === 'candidate'
          ? or(eq(inspectorProfiles.achiStatus, 'candidate'), isNull(inspectorProfiles.achiStatus))
          : eq(inspectorProfiles.achiStatus, filters.status)
      );
    }
    const whereExpr = conds.length > 0 ? and(...conds) : undefined;

    try {
      const [rows, totalRow, statusRows] = await Promise.all([
        db
          .select({
            id:               inspectorProfiles.id,
            userId:           inspectorProfiles.userId,
            achiNumber:       inspectorProfiles.achiNumber,
            achiStatus:       inspectorProfiles.achiStatus,
            isActive:         inspectorProfiles.isActive,
            rating:           inspectorProfiles.rating,
            createdAt:        inspectorProfiles.createdAt,
            userFullName:     users.fullName,
            userEmail:        users.email,
          })
          .from(inspectorProfiles)
          .leftJoin(users, eq(users.id, inspectorProfiles.userId))
          .where(whereExpr)
          .orderBy(desc(inspectorProfiles.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(inspectorProfiles)
          .where(whereExpr),
        // Unfiltered breakdown, so the tab counts always sum to the dashboard's
        // Total Inspectors tile. An admin had no way to tell whether 15 vs the
        // 14 they could see across tabs meant a stale number or an inspector
        // they'd missed.
        db
          .select({ status: inspectorProfiles.achiStatus, count: sql<number>`count(*)::int` })
          .from(inspectorProfiles)
          .groupBy(inspectorProfiles.achiStatus),
      ]);

      const counts: InspectorStatusCounts = { all: 0, certified: 0, candidate: 0, suspended: 0, expired: 0 };
      for (const r of statusRows) {
        // A null status counts as a candidate — same rule the filter above uses.
        const key = (r.status ?? 'candidate') as keyof Omit<InspectorStatusCounts, 'all'>;
        if (key in counts) counts[key] += r.count;
        counts.all += r.count;
      }

      // inspector_profiles.total_inspections is never written anywhere
      // server-side (frozen at whatever it started at) — count live from
      // the inspections table instead, one grouped query for the whole page.
      const userIds = rows.map((p) => p.userId).filter((id): id is string => !!id);
      const countsByInspector = new Map<string, number>();
      if (userIds.length > 0) {
        const countRows = await db
          .select({ inspectorId: inspections.inspectorId, count: sql<number>`count(*)::int` })
          .from(inspections)
          .where(inArray(inspections.inspectorId, userIds))
          .groupBy(inspections.inspectorId);
        for (const r of countRows) {
          if (r.inspectorId) countsByInspector.set(r.inspectorId, r.count);
        }
      }

      const inspectors: InspectorListItem[] = rows.map((p) => ({
        id: p.id,
        userId: p.userId ?? '',
        fullName: p.userFullName || '',
        email: p.userEmail || '',
        achiNumber: p.achiNumber,
        achiStatus: p.achiStatus ?? '',
        isActive: p.isActive ?? false,
        totalInspections: (p.userId && countsByInspector.get(p.userId)) || 0,
        rating: p.rating != null ? Number(p.rating) : null,
        createdAt: toIso(p.createdAt) ?? '',
      }));

      return { inspectors, total: totalRow[0]?.count ?? 0, counts };
    } catch (err) {
      logger.error({ err, status: filters.status }, 'AdminService.listInspectors failed');
      return { inspectors: [], total: 0, counts: { all: 0, certified: 0, candidate: 0, suspended: 0, expired: 0 } };
    }
  }

  /**
   * Suspend an inspector
   */
  static async suspendInspector(adminId: string, inspectorId: string, reason?: string): Promise<{ inspector: any; error: string | null }> {
    // Get inspector profile
    const [profile] = await db
      .select({ id: inspectorProfiles.id, userId: inspectorProfiles.userId })
      .from(inspectorProfiles)
      .where(eq(inspectorProfiles.userId, inspectorId))
      .limit(1);

    if (!profile) {
      return { inspector: null, error: 'Inspector not found' };
    }

    // Fetch joined user record for the response, notification, and audit.
    const [userRow] = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email, status: users.status })
      .from(users)
      .where(eq(users.id, inspectorId))
      .limit(1);

    // The profile and users writes must land together: if only the first
    // succeeded the inspector would still be locked out of login while looking
    // normal in the admin list, which filters on achi_status rather than
    // users.status.
    const now = new Date();
    let updatedProfile: any;
    try {
      updatedProfile = await db.transaction(async (tx) => {
        const updated = await tx
          .update(inspectorProfiles)
          .set({ achiStatus: 'suspended', isActive: false, updatedAt: now })
          .where(eq(inspectorProfiles.userId, inspectorId))
          .returning({
            id:         inspectorProfiles.id,
            userId:     inspectorProfiles.userId,
            achiStatus: inspectorProfiles.achiStatus,
            isActive:   inspectorProfiles.isActive,
          });
        if (!updated[0]) throw new Error('update returned no row');

        await tx
          .update(users)
          .set({ status: 'suspended', updatedAt: now })
          .where(eq(users.id, inspectorId));

        await tx.insert(adminActions).values({
          actorId:        adminId,
          targetUserId:   inspectorId,
          action:         'suspend_inspector',
          previousStatus: userRow?.status ?? null,
          newStatus:      'suspended',
          reason:         reason ?? null,
        });

        return updated[0];
      });
    } catch (updateError) {
      logger.error({ err: updateError, inspectorId }, 'AdminService.suspendInspector failed');
      return { inspector: null, error: 'Failed to suspend inspector' };
    }

    // Send notification
    await NotificationService.send('account_suspended', {
      recipientId: inspectorId,
      recipientEmail: userRow?.email || '',
      data: {
        inspectorName: userRow?.fullName || 'Inspector',
        reason: reason,
        contactEmail: 'support@inspectafrica.org',
      },
    });

    return {
      inspector: {
        ...updatedProfile,
        users: userRow
          ? { id: userRow.id, full_name: userRow.fullName, email: userRow.email }
          : null,
      },
      error: null,
    };
  }

  /**
   * Reinstate an inspector.
   * Restores certified + active for inspectors holding an unexpired certificate,
   * candidate + active otherwise.
   */
  static async reinstateInspector(adminId: string, inspectorId: string, reason?: string): Promise<{ inspector: any; error: string | null }> {
    // Fetch the inspector's current profile
    const [profile] = await db
      .select({
        achiNumber:    inspectorProfiles.achiNumber,
        achiStatus:    inspectorProfiles.achiStatus,
        achiExpiresAt: inspectorProfiles.achiExpiresAt,
      })
      .from(inspectorProfiles)
      .where(eq(inspectorProfiles.userId, inspectorId))
      .limit(1);

    if (!profile) {
      return { inspector: null, error: 'Inspector profile not found' };
    }

    const hasCert = !!profile.achiNumber;
    const expiresAt = profile.achiExpiresAt ? new Date(profile.achiExpiresAt) : null;
    const certExpired = expiresAt ? expiresAt < new Date() : false;

    // Gate on expiry only. Gating on CertService.verify was circular: it returns
    // valid only for achi_status = 'certified', and suspendInspector sets that
    // field to 'suspended', so no suspended inspector holding an ACHI number
    // could ever be reinstated.
    if (hasCert && certExpired) {
      return {
        inspector: null,
        error: 'Cannot reinstate — ACHI certificate has expired. Inspector must renew certification.',
      };
    }

    // Only an unexpired certificate earns 'certified'. A self-registered inspector
    // who typed an ACHI number that was never verified has no expiry date and stays
    // a candidate, matching how registerInspector created them.
    const newStatus = hasCert && expiresAt && !certExpired ? 'certified' : 'candidate';

    // Fetch user for the response and audit.
    const [userRow] = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email, status: users.status })
      .from(users)
      .where(eq(users.id, inspectorId))
      .limit(1);

    const now = new Date();
    let updatedProfile: any;
    try {
      updatedProfile = await db.transaction(async (tx) => {
        const updated = await tx
          .update(inspectorProfiles)
          .set({ achiStatus: newStatus, isActive: true, updatedAt: now })
          .where(eq(inspectorProfiles.userId, inspectorId))
          .returning({
            id:         inspectorProfiles.id,
            userId:     inspectorProfiles.userId,
            achiStatus: inspectorProfiles.achiStatus,
            isActive:   inspectorProfiles.isActive,
          });
        if (!updated[0]) throw new Error('update returned no row');

        await tx
          .update(users)
          .set({ status: 'active', updatedAt: now })
          .where(eq(users.id, inspectorId));

        await tx.insert(adminActions).values({
          actorId:        adminId,
          targetUserId:   inspectorId,
          action:         'reinstate_inspector',
          previousStatus: userRow?.status ?? null,
          newStatus:      'active',
          reason:         reason ?? null,
        });

        return updated[0];
      });
    } catch (updateError) {
      logger.error({ err: updateError, inspectorId }, 'AdminService.reinstateInspector failed');
      return { inspector: null, error: 'Failed to reinstate inspector' };
    }

    return {
      inspector: {
        ...updatedProfile,
        users: userRow
          ? { id: userRow.id, full_name: userRow.fullName, email: userRow.email }
          : null,
      },
      error: null,
    };
  }

  /**
   * Get review queue (pending review inspections)
   */
  static async getReviewQueue(filters?: { page?: number; limit?: number }): Promise<{ queue: ReviewQueueItem[]; total: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 25;
    const offset = (page - 1) * limit;

    try {
      const inspectorUser = aliasedTable(users, 'inspector_user');

      const [rows, totalRow] = await Promise.all([
        db
          .select({
            id:                 inspections.id,
            submittedAt:        inspections.submittedAt,
            inspectorId:        inspections.inspectorId,
            isSolo:             inspections.isSolo,
            propertyAddress:    inspections.propertyAddress,
            bookingPropAddress: bookings.propertyAddress,
            inspectorFullName:  inspectorUser.fullName,
          })
          .from(inspections)
          .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
          .leftJoin(inspectorUser, eq(inspectorUser.id, inspections.inspectorId))
          .where(eq(inspections.status, 'pending_review'))
          .orderBy(asc(inspections.submittedAt)) // Oldest first
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(inspections)
          .where(eq(inspections.status, 'pending_review')),
      ]);

      // Fetch all conditions + sections for queued inspections in one round trip each
      const inspectionIds = rows.map((insp) => insp.id);
      const [allConditions, allSections] = inspectionIds.length > 0
        ? await Promise.all([
            db
              .select({ inspectionId: inspectionConditions.inspectionId, severity: inspectionConditions.severity })
              .from(inspectionConditions)
              .where(inArray(inspectionConditions.inspectionId, inspectionIds)),
            db
              .select({ inspectionId: inspectionSections.inspectionId, status: inspectionSections.status })
              .from(inspectionSections)
              .where(inArray(inspectionSections.inspectionId, inspectionIds)),
          ])
        : [[], []];

      const sectionCountsByInspection = new Map<string, { passed: number; total: number }>();
      allSections.forEach((s) => {
        const c = sectionCountsByInspection.get(s.inspectionId) || { passed: 0, total: 0 };
        c.total++;
        if (s.status === 'pass') c.passed++;
        sectionCountsByInspection.set(s.inspectionId, c);
      });

      // Group condition counts by inspection, using the real severity vocabulary
      // ({acceptable, monitor, repair_required, unsafe} — the HINL/ACHI scale
      // inspection_conditions.severity actually stores). A prior version of this
      // counted against a legacy {pass, major, moderate, critical} vocabulary
      // that was never written anywhere, so every condition silently fell
      // through to `incomplete` regardless of its real severity.
      const countsByInspection = new Map<string, { acceptable: number; monitor: number; repairRequired: number; unsafe: number; incomplete: number }>();
      allConditions.forEach((c) => {
        if (!countsByInspection.has(c.inspectionId)) {
          countsByInspection.set(c.inspectionId, { acceptable: 0, monitor: 0, repairRequired: 0, unsafe: 0, incomplete: 0 });
        }
        const counts = countsByInspection.get(c.inspectionId)!;
        const sev = c.severity as string | null;
        if (sev === 'acceptable') counts.acceptable++;
        else if (sev === 'monitor') counts.monitor++;
        else if (sev === 'repair_required') counts.repairRequired++;
        else if (sev === 'unsafe') counts.unsafe++;
        else counts.incomplete++;
      });

      const queue: ReviewQueueItem[] = rows.map((insp) => {
        const counts = countsByInspection.get(insp.id) || { acceptable: 0, monitor: 0, repairRequired: 0, unsafe: 0, incomplete: 0 };
        const sectionCounts = sectionCountsByInspection.get(insp.id) || { passed: 0, total: 0 };
        const propertyAddress = insp.bookingPropAddress || insp.propertyAddress || 'Unknown';
        const label = insp.isSolo ? 'Solo Inspection' : null;

        return {
          inspectionId: insp.id,
          submittedAt: toIso(insp.submittedAt) ?? '',
          inspectorName: insp.inspectorFullName || 'Unknown',
          propertyAddress,
          conditionCounts: counts,
          sectionsPassedCount: sectionCounts.passed,
          totalSections: sectionCounts.total,
          isSolo: insp.isSolo || false,
          label,
        } as ReviewQueueItem & { isSolo: boolean; label: string | null };
      });

      return { queue, total: totalRow[0]?.count ?? 0 };
    } catch (err) {
      logger.error({ err }, 'AdminService.getReviewQueue failed');
      return { queue: [], total: 0 };
    }
  }

  /**
   * Get open flags
   */
  static async getOpenFlags(): Promise<FlagItem[]> {
    try {
      const inspectorUser = aliasedTable(users, 'flag_inspector_user');
      const flaggerUser   = aliasedTable(users, 'flag_flagger_user');

      const rows = await db
        .select({
          id:                 inspections.id,
          flaggedAt:          inspections.flaggedAt,
          flaggedBy:          inspections.flaggedBy,
          flagReason:         inspections.flagReason,
          revisionRequestedAt: inspections.revisionRequestedAt,
          revisionNotes:      inspections.revisionNotes,
          inspectorId:        inspections.inspectorId,
          isSolo:             inspections.isSolo,
          propertyAddress:    inspections.propertyAddress,
          bookingPropAddress: bookings.propertyAddress,
          inspectorFullName:  inspectorUser.fullName,
          flaggerFullName:    flaggerUser.fullName,
        })
        .from(inspections)
        .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
        .leftJoin(inspectorUser, eq(inspectorUser.id, inspections.inspectorId))
        .leftJoin(flaggerUser, eq(flaggerUser.id, inspections.flaggedBy))
        .where(eq(inspections.status, 'flagged'))
        .orderBy(desc(inspections.flaggedAt));

      return rows.map((f) => ({
        inspectionId: f.id,
        flaggedAt: toIso(f.flaggedAt) ?? '',
        flaggedBy: f.flaggerFullName || f.flaggedBy || '',
        flagReason: f.flagReason || 'No reason provided',
        // Set once an admin has asked for a revision. Until the inspector
        // resubmits, the flag is waiting on them rather than on us.
        revisionRequestedAt: toIso(f.revisionRequestedAt),
        revisionNotes: f.revisionNotes ?? null,
        inspectorName: f.inspectorFullName || 'Unknown',
        propertyAddress: f.bookingPropAddress || f.propertyAddress || 'Unknown',
        isSolo: f.isSolo || false,
      } as FlagItem & { isSolo: boolean; revisionRequestedAt: string | null; revisionNotes: string | null }));
    } catch (err) {
      logger.error({ err }, 'AdminService.getOpenFlags failed');
      return [];
    }
  }

  /**
   * Resolve a flag
   */
  static async resolveFlag(
    adminId: string,
    inspectionId: string,
    action: 'approve' | 'request_revision',
    notes?: string
  ): Promise<{ inspection: any; error: string | null }> {
    // Get inspection with booking + booking client
    const clientUser = aliasedTable(users, 'resolve_client');

    const [row] = await db
      .select({
        id:               inspections.id,
        status:           inspections.status,
        inspectorId:      inspections.inspectorId,
        isSolo:           inspections.isSolo,
        propertyAddress:  inspections.propertyAddress,
        bookingClientId:  bookings.clientId,
        bookingPropAddr:  bookings.propertyAddress,
        clientUserId:     clientUser.id,
        clientEmail:      clientUser.email,
        clientFullName:   clientUser.fullName,
      })
      .from(inspections)
      .leftJoin(bookings, eq(bookings.id, inspections.bookingId))
      .leftJoin(clientUser, eq(clientUser.id, bookings.clientId))
      .where(eq(inspections.id, inspectionId))
      .limit(1);

    if (!row) {
      return { inspection: null, error: 'Inspection not found' };
    }

    if (row.status !== 'flagged') {
      return { inspection: null, error: 'Inspection is not flagged' };
    }

    let updateData: Record<string, any> = {};

    if (action === 'approve') {
      // Clear the flag entirely — an approved inspection carrying flagged_at,
      // flagged_by and a flag_reason reads as still flagged everywhere that
      // checks those fields. The admin's note isn't lost: it goes into the
      // revision event below.
      updateData = {
        status: 'approved',
        approvedAt: new Date(),
        approvedBy: adminId,
        flaggedAt: null,
        flaggedBy: null,
        flagReason: null,
        revisionRequestedAt: null,
        revisionNotes: null,
      };
    } else {
      // Revision requested: status stays `flagged`, because submit()'s allowlist
      // accepts that and the inspector resubmits from it. The request is
      // recorded in its own fields rather than by overwriting flag_reason, so
      // the reason the inspection was flagged in the first place survives.
      updateData = {
        revisionRequestedAt: new Date(),
        revisionNotes: notes ?? null,
      };
    }

    let updated: any;
    try {
      const updatedRows = await db
        .update(inspections)
        .set(updateData)
        .where(eq(inspections.id, inspectionId))
        .returning();
      updated = updatedRows[0];
      if (!updated) throw new Error('update returned no row');
    } catch (updateError) {
      logger.error({ err: updateError, inspectionId, action }, 'AdminService.resolveFlag failed');
      return { inspection: null, error: 'Failed to resolve flag' };
    }

    if (action === 'approve') {
      // An inspection reaches `flagged` from `pending_review`, so no report
      // version or PDF exists yet — generate it now, same as the direct
      // pending_review approve path. The client is deliberately not emailed
      // here: ReportService.generate sends report_ready/report_revised with
      // the real access URL once the PDF is in storage, and a persistent
      // generation failure is escalated to admins instead.
      const { ReportService } = await import('./ReportService.js');
      ReportService.generateInBackground(inspectionId, adminId);
    } else {
      // Notify inspector again
      const [inspector] = await db
        .select({ id: users.id, email: users.email, fullName: users.fullName })
        .from(users)
        .where(eq(users.id, row.inspectorId!))
        .limit(1);

      await NotificationService.send('report_flagged', {
        recipientId: row.inspectorId || '',
        recipientEmail: inspector?.email || '',
        data: {
          inspectorName: inspector?.fullName || 'Inspector',
          propertyAddress: row.bookingPropAddr || row.propertyAddress || '',
          flagReason: notes || 'Revision requested',
        },
      });
    }

    // Record an audit event for both branches. Prior to this, request_revision
    // left no trail — the inspection just sat at status=flagged with a mutated
    // flag_reason, indistinguishable from the original flag.
    await RevisionService.log({
      inspectionId,
      entityType: 'inspection',
      entityId: inspectionId,
      action: 'updated',
      field: action === 'approve' ? 'status' : 'revision_requested',
      newValue:
        action === 'approve'
          ? { status: 'approved', resolvedFlag: true, notes: notes ?? null }
          : { status: 'flagged', revisionRequested: true, notes: notes ?? null },
      changedBy: adminId,
    });

    return { inspection: updated, error: null };
  }

  /**
   * Everything currently waiting on an admin, in one place.
   *
   * The bell and the dashboard both read this rather than each assembling their
   * own list, so they can't disagree — and adding a queue later means touching
   * one method instead of two components. Before this, the only thing either
   * surfaced was pending reviews, so an inspector who had paid for tokens could
   * sit blocked indefinitely without anything drawing an admin's eye.
   */
  static async getAttention(): Promise<{
    pendingReviews: number;
    openFlags: number;
    pendingTokenPurchases: number;
    unclaimedBookings: number;
    paymentsAwaitingAction: number;
    failedNotifications: number;
    certConflicts: number;
  }> {
    const countExpr = sql<number>`count(*)::int`;
    // Only recent email failures — a run of them means delivery is broken now,
    // which is the thing worth acting on. Older ones are history.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    try {
      const [
        pendingReviews,
        openFlags,
        pendingTokenPurchases,
        unclaimedBookings,
        paymentsAwaitingAction,
        failedNotifications,
        certConflicts,
      ] = await Promise.all([
        db.select({ count: countExpr }).from(inspections).where(eq(inspections.status, 'pending_review')),
        db.select({ count: countExpr }).from(inspections).where(eq(inspections.status, 'flagged')),
        db.select({ count: countExpr }).from(tokenPurchases).where(eq(tokenPurchases.status, 'pending_review')),
        db.select({ count: countExpr }).from(bookings).where(eq(bookings.status, 'open')),
        db.select({ count: countExpr }).from(bookings).where(or(
          eq(bookings.clientPaymentStatus, 'pending'),
          eq(bookings.inspectorPayoutStatus, 'pending'),
        )),
        db.select({ count: countExpr }).from(notificationLogs).where(and(
          eq(notificationLogs.status, 'failed'),
          gte(notificationLogs.sentAt, since),
        )),
        db.select({ count: countExpr }).from(syncConflicts).where(isNull(syncConflicts.resolvedAt)),
      ]);

      return {
        pendingReviews: pendingReviews[0]?.count ?? 0,
        openFlags: openFlags[0]?.count ?? 0,
        pendingTokenPurchases: pendingTokenPurchases[0]?.count ?? 0,
        unclaimedBookings: unclaimedBookings[0]?.count ?? 0,
        paymentsAwaitingAction: paymentsAwaitingAction[0]?.count ?? 0,
        failedNotifications: failedNotifications[0]?.count ?? 0,
        certConflicts: certConflicts[0]?.count ?? 0,
      };
    } catch (err) {
      logger.error({ err }, 'AdminService.getAttention failed');
      return {
        pendingReviews: 0,
        openFlags: 0,
        pendingTokenPurchases: 0,
        unclaimedBookings: 0,
        paymentsAwaitingAction: 0,
        failedNotifications: 0,
        certConflicts: 0,
      };
    }
  }

  /**
   * Get notification log history
   */
  static async getNotificationLog(filters: {
    type?: string;
    recipientId?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<{ logs: any[]; total: number }> {
    return NotificationService.getLogHistory(filters as any);
  }

  /**
   * List clients with booking counts
   */
  static async listClients(filters: {
    status?: 'active' | 'suspended' | 'pending' | 'invited';
    page?: number;
    limit?: number;
  } = {}): Promise<{ clients: ClientListItem[]; total: number }> {
    const page = filters.page || 1;
    const limit = filters.limit || 25;
    const offset = (page - 1) * limit;

    const conds: any[] = [eq(users.role, 'client')];
    if (filters.status) conds.push(eq(users.status, filters.status));
    const whereExpr = and(...conds);

    try {
      const [rows, totalRow] = await Promise.all([
        db
          .select({
            id:        users.id,
            fullName:  users.fullName,
            email:     users.email,
            phone:     users.phone,
            status:    users.status,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(whereExpr)
          .orderBy(desc(users.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(users)
          .where(whereExpr),
      ]);

      const userIds = rows.map((u) => u.id);
      let bookingsByClient: Record<string, { total: number; completed: number }> = {};

      if (userIds.length > 0) {
        const bookingsData = await db
          .select({ clientId: bookings.clientId, status: bookings.status })
          .from(bookings)
          .where(inArray(bookings.clientId, userIds));

        bookingsByClient = bookingsData.reduce((acc: Record<string, { total: number; completed: number }>, b) => {
          if (!acc[b.clientId]) acc[b.clientId] = { total: 0, completed: 0 };
          acc[b.clientId]!.total += 1;
          if (b.status === 'completed') acc[b.clientId]!.completed += 1;
          return acc;
        }, {});
      }

      const clients: ClientListItem[] = rows.map((u) => ({
        id: u.id,
        fullName: u.fullName || '',
        email: u.email || '',
        phone: u.phone,
        status: u.status,
        createdAt: toIso(u.createdAt) ?? '',
        totalBookings: bookingsByClient[u.id]?.total || 0,
        completedBookings: bookingsByClient[u.id]?.completed || 0,
      }));

      return { clients, total: totalRow[0]?.count ?? 0 };
    } catch (err) {
      logger.error({ err, filters }, 'AdminService.listClients failed');
      return { clients: [], total: 0 };
    }
  }

  /**
   * Get a single inspector's admin detail (includes email, phone, isActive)
   */
  static async getInspectorDetail(inspectorId: string): Promise<{ inspector: any | null; error: string | null }> {
    const [row] = await db
      .select({
        profileId:        inspectorProfiles.id,
        userId:           inspectorProfiles.userId,
        achiNumber:       inspectorProfiles.achiNumber,
        achiStatus:       inspectorProfiles.achiStatus,
        isActive:         inspectorProfiles.isActive,
        bio:              inspectorProfiles.bio,
        serviceAreas:     inspectorProfiles.serviceAreas,
        inspectionTypes:  inspectorProfiles.inspectionTypes,
        rating:           inspectorProfiles.rating,
        createdAt:        inspectorProfiles.createdAt,
        userFullName:     users.fullName,
        userEmail:        users.email,
        userPhone:        users.phone,
        userAvatarUrl:    users.avatarUrl,
      })
      .from(inspectorProfiles)
      .leftJoin(users, eq(users.id, inspectorProfiles.userId))
      .where(eq(inspectorProfiles.userId, inspectorId))
      .limit(1);

    if (!row) {
      return { inspector: null, error: 'Inspector not found' };
    }

    // inspector_profiles.total_inspections is never written anywhere
    // server-side — count live from the inspections table instead.
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inspections)
      .where(eq(inspections.inspectorId, inspectorId));

    return {
      inspector: {
        id:               row.userId,
        profileId:        row.profileId,
        fullName:         row.userFullName || '',
        email:            row.userEmail || '',
        phone:            row.userPhone || null,
        avatarUrl:        row.userAvatarUrl || null,
        achiNumber:       row.achiNumber,
        achiStatus:       row.achiStatus || '',
        isActive:         row.isActive ?? false,
        bio:              row.bio,
        serviceAreas:     row.serviceAreas ?? [],
        inspectionTypes:  row.inspectionTypes ?? [],
        rating:           row.rating != null ? Number(row.rating) : null,
        totalInspections: countRow?.count ?? 0,
        createdAt:        toIso(row.createdAt),
      },
      error: null,
    };
  }

  /**
   * Get a client's detail with recent bookings
   */
  static async getClient(clientId: string): Promise<{ client: any | null; error: string | null }> {
    const [user] = await db
      .select({
        id:        users.id,
        fullName:  users.fullName,
        email:     users.email,
        phone:     users.phone,
        status:    users.status,
        avatarUrl: users.avatarUrl,
        createdAt: users.createdAt,
        role:      users.role,
      })
      .from(users)
      .where(and(eq(users.id, clientId), eq(users.role, 'client')))
      .limit(1);

    if (!user) {
      return { client: null, error: 'Client not found' };
    }

    let bookingRows: Array<{
      id: string;
      status: string | null;
      property_address: string;
      inspection_type: string;
      created_at: string | null;
      scheduled_for: string | null;
    }> = [];

    try {
      const rows = await db
        .select({
          id:              bookings.id,
          status:          bookings.status,
          propertyAddress: bookings.propertyAddress,
          inspectionType:  bookings.inspectionType,
          createdAt:       bookings.createdAt,
          requestedDate:   bookings.requestedDate,
        })
        .from(bookings)
        .where(eq(bookings.clientId, clientId))
        .orderBy(desc(bookings.createdAt))
        .limit(50);

      // Preserve the snake_case shape consumers expect. Note that there's no
      // `scheduled_for` column in the schema — an earlier select listed it but
      // it always resolved to undefined. We map requestedDate here, which is
      // the closest equivalent and closer to what callers actually want.
      bookingRows = rows.map((b) => ({
        id: b.id,
        status: b.status,
        property_address: b.propertyAddress,
        inspection_type: b.inspectionType,
        created_at: toIso(b.createdAt),
        scheduled_for: b.requestedDate ? String(b.requestedDate) : null,
      }));
    } catch (err) {
      logger.error({ err, clientId }, 'AdminService.getClient: bookings fetch failed');
    }

    // Real booking statuses are open/confirmed/in_progress/completed/cancelled
    // (see bookings.status in schema.ts) — 'pending'/'accepted' were never
    // real values, so these totals were always 0.
    const totals = bookingRows.reduce(
      (acc, b) => {
        acc.total += 1;
        if (b.status === 'completed') acc.completed += 1;
        if (b.status === 'open') acc.pending += 1;
        if (b.status === 'confirmed' || b.status === 'in_progress') acc.accepted += 1;
        if (b.status === 'cancelled') acc.cancelled += 1;
        return acc;
      },
      { total: 0, completed: 0, pending: 0, accepted: 0, cancelled: 0 }
    );

    return {
      client: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        status: user.status,
        avatarUrl: user.avatarUrl,
        createdAt: toIso(user.createdAt),
        totals,
        bookings: bookingRows,
      },
      error: null,
    };
  }

  /**
   * Invite a client by email. Creates a placeholder user with status='invited'.
   */
  static async inviteClient(_adminId: string, email: string, fullName?: string): Promise<{ client: any | null; error: string | null }> {
    // Check for existing user with this email
    const [existing] = await db
      .select({ id: users.id, status: users.status })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      return { client: null, error: 'A user with this email already exists' };
    }

    try {
      const [inserted] = await db
        .insert(users)
        .values({
          email,
          fullName: fullName || email,
          role: 'client',
          status: 'invited',
          passwordHash: '',
        })
        .returning({ id: users.id, email: users.email, fullName: users.fullName, status: users.status });

      if (!inserted) throw new Error('Insert returned no row');

      // Fire-and-forget invite email — uses welcome_client subject for now
      NotificationService.send('welcome_client', {
        recipientId: inserted.id,
        recipientEmail: inserted.email || '',
        data: { clientName: inserted.fullName || email, adminLink: `${process.env.APP_URL || ''}/register` },
      }).catch(err => logger.warn({ err }, 'inviteClient: notification failed'));

      return { client: { id: inserted.id, email: inserted.email, fullName: inserted.fullName, status: inserted.status }, error: null };
    } catch (err: any) {
      const isDup = String(err?.message).includes('duplicate') || err?.code === '23505';
      return { client: null, error: isDup ? 'A user with this email already exists' : 'Failed to create invite' };
    }
  }

  /**
   * Suspend a client
   */
  static async suspendClient(adminId: string, clientId: string, reason?: string): Promise<{ client: any | null; error: string | null }> {
    const [user] = await db
      .select({
        id:       users.id,
        fullName: users.fullName,
        email:    users.email,
        role:     users.role,
        status:   users.status,
      })
      .from(users)
      .where(eq(users.id, clientId))
      .limit(1);

    if (!user || user.role !== 'client') {
      return { client: null, error: 'Client not found' };
    }

    const previousStatus = user.status;

    let updated: any;
    try {
      updated = await db.transaction(async (tx) => {
        const updatedRows = await tx
          .update(users)
          .set({ status: 'suspended', updatedAt: new Date() })
          .where(eq(users.id, clientId))
          .returning({
            id:       users.id,
            fullName: users.fullName,
            email:    users.email,
            status:   users.status,
          });
        if (!updatedRows[0]) throw new Error('update returned no row');

        await tx.insert(adminActions).values({
          actorId:        adminId,
          targetUserId:   clientId,
          action:         'suspend_client',
          previousStatus: previousStatus,
          newStatus:      'suspended',
          reason:         reason ?? null,
        });

        return updatedRows[0];
      });
    } catch (updateError) {
      logger.error({ err: updateError, clientId }, 'AdminService.suspendClient failed');
      return { client: null, error: 'Failed to suspend client' };
    }

    return {
      client: {
        id: updated.id,
        full_name: updated.fullName,
        email: updated.email,
        status: updated.status,
      },
      error: null,
    };
  }

  /**
   * Reinstate a client
   */
  static async reinstateClient(adminId: string, clientId: string, reason?: string): Promise<{ client: any | null; error: string | null }> {
    const [user] = await db
      .select({
        id:       users.id,
        fullName: users.fullName,
        email:    users.email,
        role:     users.role,
        status:   users.status,
      })
      .from(users)
      .where(eq(users.id, clientId))
      .limit(1);

    if (!user || user.role !== 'client') {
      return { client: null, error: 'Client not found' };
    }

    const previousStatus = user.status;

    let updated: any;
    try {
      updated = await db.transaction(async (tx) => {
        const updatedRows = await tx
          .update(users)
          .set({ status: 'active', updatedAt: new Date() })
          .where(eq(users.id, clientId))
          .returning({
            id:       users.id,
            fullName: users.fullName,
            email:    users.email,
            status:   users.status,
          });
        if (!updatedRows[0]) throw new Error('update returned no row');

        await tx.insert(adminActions).values({
          actorId:        adminId,
          targetUserId:   clientId,
          action:         'reinstate_client',
          previousStatus: previousStatus,
          newStatus:      'active',
          reason:         reason ?? null,
        });

        return updatedRows[0];
      });
    } catch (updateError) {
      logger.error({ err: updateError, clientId }, 'AdminService.reinstateClient failed');
      return { client: null, error: 'Failed to reinstate client' };
    }

    return {
      client: {
        id: updated.id,
        full_name: updated.fullName,
        email: updated.email,
        status: updated.status,
      },
      error: null,
    };
  }
}
