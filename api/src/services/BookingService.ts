import { eq, and, inArray, lt, isNull, notInArray, desc, asc, sql, or } from 'drizzle-orm';
import { aliasedTable } from 'drizzle-orm';
import { db } from '../db/index.js';
import { bookings, bookingDeclines, users, inspectorProfiles } from '../db/schema.js';
import { NotificationService } from './NotificationService.js';
import { RevisionService } from './RevisionService.js';
import { logger } from '../lib/logger.js';
import { broadcastToRole } from '../lib/eventBus.js';

/**
 * Booking statuses that mean "this booking is still live", for the purpose of
 * rejecting a duplicate. Deliberately excludes `completed` and `cancelled` so a
 * client can rebook the same property for the same date after either.
 *
 * The previous list looked for 'pending' and 'accepted', which this application
 * never writes, and omitted 'confirmed' — the status of a booking an inspector
 * has already claimed, and so the most important one to catch.
 */
export const ACTIVE_BOOKING_STATUSES = ['open', 'confirmed', 'in_progress'] as const;

const DUPLICATE_BOOKING_MESSAGE = 'A booking for this property on that date already exists.';

/** Postgres unique-violation on the partial index that guards duplicates. */
function isDuplicateBookingViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint_name?: string; constraint?: string; message?: string };
  const code = e?.code ?? (e as any)?.cause?.code;
  const target = e?.constraint_name ?? e?.constraint ?? e?.message ?? '';
  return code === '23505' && String(target).includes('bookings_active_client_property_date_unique');
}

/**
 * Pricing by inspection type (in NGN). Keys must match the DB enum on
 * `bookings.inspection_type` / `inspections.inspection_type` (shi, mic, cib,
 * fsi, pcc, hhc, snag, lsi) — mirrors the client-facing catalogue in
 * apps/web/src/screens/Client/NewBooking.tsx. Inspector share is a flat 70%
 * of the total, matching the original pre-HINL pricing ratio.
 *
 * `cib` and `lsi` are priced "On Demand" on the client and have no fixed
 * total here — see `formatInspectionPrice` below for how callers should
 * handle that instead of falling back to a wrong number.
 */
export const INSPECTION_PRICES: Record<string, { total: number; inspectorShare: number }> = {
  shi:  { total: 350000, inspectorShare: 245000 }, // HINL Home Inspection (Standard)
  mic:  { total: 150000, inspectorShare: 105000 }, // Move-In Certification
  hhc:  { total: 300000, inspectorShare: 210000 }, // No Utility Inspection
  snag: { total: 500000, inspectorShare: 350000 }, // HINL Snag Inspection
  fsi:  { total: 250000, inspectorShare: 175000 }, // New Construction — Phase 1
  pcc:  { total: 300000, inspectorShare: 210000 }, // New Construction — Phase 2
  // cib (Commercial Inspection & Consultancy) and lsi (Land Site Inspection)
  // are On Demand — intentionally absent, do not add a fallback total for them.
};

/** Format a price for display, returning "On Demand" for types with no fixed price. */
export function formatInspectionPrice(type: string): { price: string; share: string } {
  const priceData = INSPECTION_PRICES[type];
  if (!priceData) return { price: 'On Demand', share: 'On Demand' };
  return {
    price: `₦${priceData.total.toLocaleString()}`,
    share: `₦${priceData.inspectorShare.toLocaleString()}`,
  };
}

export function getCountryFlag(country: string | null | undefined): string {
  if (!country) return '🌍';
  const countryMap: Record<string, string> = {
    'US': '🇺🇸', 'USA': '🇺🇸', 'United States': '🇺🇸', 'America': '🇺🇸',
    'GB': '🇬🇧', 'UK': '🇬🇧', 'United Kingdom': '🇬🇧', 'England': '🇬🇧',
    'NG': '🇳🇬', 'Nigeria': '🇳🇬',
    'CA': '🇨🇦', 'Canada': '🇨🇦',
    'AU': '🇦🇺', 'Australia': '🇦🇺',
    'DE': '🇩🇪', 'Germany': '🇩🇪',
    'FR': '🇫🇷', 'France': '🇫🇷',
    'ZA': '🇿🇦', 'South Africa': '🇿🇦',
    'KE': '🇰🇪', 'Kenya': '🇰🇪',
    'GH': '🇬🇭', 'Ghana': '🇬🇭',
  };
  return countryMap[country] || '🌍';
}

export function formatInspectionType(type: string): string {
  const map: Record<string, string> = {
    residential: 'Residential', commercial: 'Commercial', land: 'Land',
    shi: 'HINL Home Inspection (Standard)', mic: 'Move-In Certification',
    cib: 'Commercial Inspection & Consultancy', fsi: 'New Construction — Phase 1',
    pcc: 'New Construction — Phase 2', hhc: 'No Utility Inspection', snag: 'HINL Snag Inspection',
    lsi: 'Land Site Inspection',
  };
  return map[type] || type;
}

export function formatBookingDate(date: string, time?: string | null): string {
  if (!date) return '';
  return time ? `${date} ${time}` : date;
}

export interface CreateBookingData {
  propertyAddress: string;
  propertyCity: string;
  propertyType: 'residential' | 'commercial' | 'land';
  inspectionType: 'shi' | 'mic' | 'cib' | 'fsi' | 'pcc' | 'hhc' | 'lsi' | 'snag';
  requestedDate: string;
  requestedTime?: string;
  notesToInspector?: string;
  state?: string;
  lga?: string;
  country?: string;
}

export interface FrontendBooking {
  id: string;
  client: string;
  flag: string;
  loc: string;
  property: string;
  type: string;
  date: string;
  price: string;
  share: string;
  note: string | null;
  contact: string | null;
  status: string;
  createdAt: string;
  _raw?: {
    clientId: string;
    inspectorId: string | null;
    propertyAddress: string;
    propertyCity: string;
    propertyType: string;
    inspectionType: string;
    requestedDate: string;
    requestedTime: string | null;
    clientEmail?: string;
    inspectorName?: string;
  };
}

export interface Booking {
  id: string;
  clientId: string;
  inspectorId: string | null;
  propertyAddress: string;
  propertyCity: string;
  propertyType: string;
  inspectionType: string;
  requestedDate: string;
  requestedTime: string | null;
  notesToInspector: string | null;
  status: string;
  declinedReason: string | null;
  acceptedAt: string | null;
  completedAt: string | null;
  state: string | null;
  lga: string | null;
  country: string | null;
  createdAt: string;
  updatedAt: string;
  client?: { id: string; fullName: string; email: string; phone: string | null };
  inspector?: { id: string; fullName: string; email: string };
}

const clientUsers    = aliasedTable(users, 'client_user');
const inspectorUsers = aliasedTable(users, 'inspector_user');

function toIso(v: any): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

/** Selection set for booking + joined client + inspector summaries */
const bookingFieldsWithJoins = {
  id:                bookings.id,
  clientId:          bookings.clientId,
  inspectorId:       bookings.inspectorId,
  propertyAddress:   bookings.propertyAddress,
  propertyCity:      bookings.propertyCity,
  propertyType:      bookings.propertyType,
  inspectionType:    bookings.inspectionType,
  requestedDate:     bookings.requestedDate,
  requestedTime:     bookings.requestedTime,
  notesToInspector:  bookings.notesToInspector,
  status:            bookings.status,
  declinedReason:    bookings.declinedReason,
  acceptedAt:        bookings.acceptedAt,
  completedAt:       bookings.completedAt,
  state:             bookings.state,
  lga:               bookings.lga,
  country:           bookings.country,
  createdAt:         bookings.createdAt,
  updatedAt:         bookings.updatedAt,
  clientFullName:    clientUsers.fullName,
  clientEmail:       clientUsers.email,
  clientPhone:       clientUsers.phone,
  inspectorFullName: inspectorUsers.fullName,
  inspectorEmail:    inspectorUsers.email,
};

function shapeBooking(row: any): Booking {
  return {
    id:               row.id,
    clientId:         row.clientId,
    inspectorId:      row.inspectorId,
    propertyAddress:  row.propertyAddress,
    propertyCity:     row.propertyCity,
    propertyType:     row.propertyType,
    inspectionType:   row.inspectionType,
    requestedDate:    String(row.requestedDate),
    requestedTime:    row.requestedTime ?? null,
    notesToInspector: row.notesToInspector,
    status:           row.status,
    declinedReason:   row.declinedReason,
    acceptedAt:       toIso(row.acceptedAt),
    completedAt:      toIso(row.completedAt),
    state:            row.state,
    lga:              row.lga,
    country:          row.country,
    createdAt:        toIso(row.createdAt) ?? '',
    updatedAt:        toIso(row.updatedAt) ?? '',
    client: row.clientFullName ? {
      id:       row.clientId,
      fullName: row.clientFullName,
      email:    row.clientEmail,
      phone:    row.clientPhone,
    } : undefined,
    inspector: row.inspectorFullName ? {
      id:       row.inspectorId,
      fullName: row.inspectorFullName,
      email:    row.inspectorEmail,
    } : undefined,
  };
}

export class BookingService {
  /** Client creates a new booking — enters the open pool */
  static async create(clientId: string, data: CreateBookingData) {
    try {
      // Reject exact duplicate: same client, same address, same date, still live.
      //
      // This is the friendly path, not the guarantee — it reads before it
      // writes, so concurrent submits can all pass it. The partial unique index
      // `bookings_active_client_property_date_unique` is what actually holds,
      // and the catch below turns its violation into the same message.
      const [existing] = await db
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(
          eq(bookings.clientId, clientId),
          eq(bookings.propertyAddress, data.propertyAddress),
          eq(bookings.requestedDate, data.requestedDate as any),
          inArray(bookings.status, ACTIVE_BOOKING_STATUSES),
        ))
        .limit(1);
      if (existing) {
        return { booking: null, error: DUPLICATE_BOOKING_MESSAGE };
      }

      // Freeze the catalogue price onto the booking. The client is quoted this
      // when they book and it is what they will be asked to transfer, so it has
      // to be recorded at creation rather than left for an admin to fill in
      // afterwards — every booking before this carried a null amount, which is
      // why the payment card showed bank details with no figure against them.
      // `cib` and `lsi` are On Demand and stay null on purpose; those are
      // agreed and set offline.
      const price = INSPECTION_PRICES[data.inspectionType];

      const inserted = await db
        .insert(bookings)
        .values({
          clientId,
          inspectorId:      null,
          propertyAddress:  data.propertyAddress,
          propertyCity:     data.propertyCity,
          propertyType:     data.propertyType,
          inspectionType:   data.inspectionType,
          requestedDate:    data.requestedDate,
          requestedTime:    data.requestedTime ?? null,
          notesToInspector: data.notesToInspector ?? null,
          state:            data.state ?? null,
          lga:              data.lga ?? null,
          country:          data.country ?? null,
          status:           'open',
          clientPaymentAmount:   price ? String(price.total) : null,
          inspectorPayoutAmount: price ? String(price.inspectorShare) : null,
        })
        .returning();
      const booking = inserted[0];
      if (!booking) throw new Error('insert returned no row');
      return { booking: shapeBooking(booking), error: null };
    } catch (err) {
      // The unique index caught a duplicate the check above raced past — a
      // double-tapped Confirm button, or a retried request. Report it as the
      // duplicate it is rather than as a server failure.
      if (isDuplicateBookingViolation(err)) {
        logger.info({ clientId, propertyAddress: data.propertyAddress }, 'BookingService.create: duplicate rejected by unique index');
        return { booking: null, error: DUPLICATE_BOOKING_MESSAGE };
      }
      logger.error({ err, clientId }, 'BookingService.create failed');
      return { booking: null, error: 'Failed to create booking' };
    }
  }

  /** Inspector views the open booking pool. */
  static async listOpen(inspectorId: string) {
    const declines = await db
      .select({ bookingId: bookingDeclines.bookingId })
      .from(bookingDeclines)
      .where(eq(bookingDeclines.inspectorId, inspectorId));
    const declinedIds = declines.map(d => d.bookingId);

    try {
      const conditions = [
        inArray(bookings.status, ['open', 'pending']),
        isNull(bookings.inspectorId),
      ];
      if (declinedIds.length > 0) {
        conditions.push(notInArray(bookings.id, declinedIds));
      }

      const rows = await db
        .select({
          id:               bookings.id,
          propertyAddress:  bookings.propertyAddress,
          propertyCity:     bookings.propertyCity,
          propertyType:     bookings.propertyType,
          inspectionType:   bookings.inspectionType,
          requestedDate:    bookings.requestedDate,
          state:            bookings.state,
          lga:              bookings.lga,
          country:          bookings.country,
          createdAt:        bookings.createdAt,
          clientFullName:   clientUsers.fullName,
        })
        .from(bookings)
        .leftJoin(clientUsers, eq(clientUsers.id, bookings.clientId))
        .where(and(...conditions))
        .orderBy(asc(bookings.createdAt));

      const results = rows.map(b => {
        const clientFullName: string = b.clientFullName || 'Unknown';
        const clientFirstName = clientFullName.split(' ')[0];
        return {
          id:              b.id,
          propertyAddress: b.propertyAddress,
          propertyCity:    b.propertyCity,
          propertyType:    b.propertyType,
          inspectionType:  formatInspectionType(b.inspectionType),
          requestedDate:   String(b.requestedDate),
          state:           b.state,
          lga:             b.lga,
          country:         b.country,
          clientFirstName,
          createdAt:       toIso(b.createdAt),
        };
      });

      return { bookings: results, error: null };
    } catch (err) {
      logger.error({ err, inspectorId }, 'BookingService.listOpen failed');
      return { bookings: [], error: 'Failed to fetch open bookings' };
    }
  }

  /** Inspector accepts a booking from the open pool. */
  static async accept(inspectorId: string, bookingId: string) {
    const certCheck = await this.verifyInspectorCert(inspectorId);
    if (certCheck.error) {
      logger.warn({ inspectorId, reason: certCheck.error }, 'BookingService.accept: cert check skipped');
    }

    const [existing] = await db
      .select({ id: bookings.id, status: bookings.status, requestedDate: bookings.requestedDate })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!existing) return { booking: null, error: 'Booking not found' };
    if (existing.status !== 'open') {
      return { booking: null, error: 'This booking has already been accepted', statusCode: 409 };
    }

    // Date-conflict check
    const conflicts = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(
        eq(bookings.inspectorId, inspectorId),
        eq(bookings.status, 'confirmed'),
        eq(bookings.requestedDate, existing.requestedDate),
      ));
    if (conflicts.length > 0) {
      return { booking: null, error: 'You already have a confirmed booking on this date' };
    }

    // Atomic claim — only matches if still open
    const claimed = await db
      .update(bookings)
      .set({
        status:      'confirmed',
        inspectorId,
        acceptedAt:  new Date(),
      })
      .where(and(eq(bookings.id, bookingId), eq(bookings.status, 'open')))
      .returning();

    if (claimed.length === 0) {
      return { booking: null, error: 'This booking has already been accepted', statusCode: 409 };
    }
    const booking = claimed[0]!;

    // Fetch client/inspector for notifications
    const [client, inspector, profile] = await Promise.all([
      db.select({ id: users.id, email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, booking.clientId)).limit(1),
      db.select({ id: users.id, email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, inspectorId)).limit(1),
      db.select({ achiNumber: inspectorProfiles.achiNumber }).from(inspectorProfiles).where(eq(inspectorProfiles.userId, inspectorId)).limit(1),
    ]);
    const c = client[0];
    const i = inspector[0];
    const achiNumber = profile[0]?.achiNumber;

    // Fire-and-forget: notifications and audit log must not fail the accept
    if (c) {
      NotificationService.send('booking_accepted', {
        recipientId: c.id, recipientEmail: c.email,
        data: {
          clientName:       c.fullName,
          inspectorName:    i?.fullName || 'An inspector',
          achiNumber:       achiNumber || 'N/A',
          propertyAddress:  booking.propertyAddress,
          requestedDate:    booking.requestedDate,
        },
      }).catch(err => logger.warn({ err, bookingId }, 'booking_accepted notify failed'));
    }
    if (i) {
      NotificationService.send('booking_received', {
        recipientId: i.id, recipientEmail: i.email,
        data: {
          inspectorName:   i.fullName,
          clientName:      c?.fullName || 'A client',
          propertyAddress: booking.propertyAddress,
          propertyType:    booking.propertyType,
          requestedDate:   booking.requestedDate,
          bookingId:       booking.id,
        },
      }).catch(err => logger.warn({ err, bookingId }, 'booking_received notify failed'));
    }

    RevisionService.log({
      inspectionId: bookingId,
      entityType: 'inspection',
      entityId: bookingId,
      action: 'updated',
      field: 'status',
      previousValue: 'open',
      newValue: { status: 'confirmed', inspectorId },
      changedBy: inspectorId,
    }).catch(err => logger.warn({ err, bookingId }, 'accept audit log failed'));

    return { booking: shapeBooking(booking), error: null };
  }

  /** Inspector declines a booking from the open pool. */
  static async decline(inspectorId: string, bookingId: string, _reason?: string) {
    const [existing] = await db
      .select({ id: bookings.id, status: bookings.status })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!existing) return { booking: null, error: 'Booking not found' };
    if (existing.status !== 'open') return { booking: null, error: 'Booking is not in open status' };

    try {
      await db.insert(bookingDeclines).values({ bookingId, inspectorId });
    } catch (err: any) {
      if (err?.code === '23505') return { booking: null, error: 'You have already declined this booking' };
      logger.error({ err, bookingId, inspectorId }, 'BookingService.decline failed');
      return { booking: null, error: 'Failed to decline booking' };
    }

    return { booking: existing as any as Booking, error: null, message: 'Booking declined' };
  }

  /** Client cancels a booking */
  static async cancel(clientId: string, bookingId: string) {
    const [existing] = await db
      .select({ id: bookings.id, status: bookings.status, clientId: bookings.clientId })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!existing) return { booking: null, error: 'Booking not found' };
    if (existing.clientId !== clientId) return { booking: null, error: 'This booking does not belong to you' };
    if (existing.status === 'confirmed') return { booking: null, error: 'Cannot cancel a confirmed booking' };
    if (existing.status !== 'open')      return { booking: null, error: 'Booking cannot be cancelled in its current status' };

    try {
      const [booking] = await db
        .update(bookings)
        .set({ status: 'cancelled' })
        .where(eq(bookings.id, bookingId))
        .returning();
      if (!booking) throw new Error('update returned no row');

      // Notify admins — only ever reachable while the booking is still
      // 'open' (see guard above), so there's never an assigned inspector
      // to also tell at this point.
      this.notifyAdminsOfCancellation(booking).catch((err) =>
        logger.warn({ err, bookingId }, 'BookingService.cancel: admin notification failed (non-fatal)')
      );

      return { booking: shapeBooking(booking), error: null };
    } catch (err) {
      logger.error({ err, bookingId, clientId }, 'BookingService.cancel failed');
      return { booking: null, error: 'Failed to cancel booking' };
    }
  }

  /** Email + in-app broadcast to all admins when a client cancels an open booking. */
  private static async notifyAdminsOfCancellation(booking: typeof bookings.$inferSelect): Promise<void> {
    const [client] = await db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, booking.clientId))
      .limit(1);

    broadcastToRole('admin', 'booking.cancelled', {
      bookingId: booking.id,
      propertyAddress: booking.propertyAddress,
    });

    const admins = await db
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.role, 'admin'));

    for (const admin of admins) {
      await NotificationService.send('booking_cancelled', {
        recipientId: admin.id,
        recipientEmail: admin.email,
        data: {
          adminName: admin.fullName,
          propertyAddress: booking.propertyAddress,
          clientName: client?.fullName ?? 'Unknown',
        },
      });
    }
  }

  /** Inspector starts a confirmed booking */
  static async start(inspectorId: string, bookingId: string) {
    const [existing] = await db
      .select({
        id:                  bookings.id,
        status:              bookings.status,
        inspectorId:         bookings.inspectorId,
        clientPaymentStatus: bookings.clientPaymentStatus,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!existing) return { booking: null, error: 'Booking not found' };
    if (existing.status !== 'confirmed') return { booking: null, error: 'Booking must be confirmed before starting' };
    if (existing.inspectorId !== inspectorId) return { booking: null, error: 'This booking is not assigned to you' };
    // Work starts only once the client's transfer has been confirmed by an
    // admin. Nothing enforced this before, and inspections ran — and completed
    // — against unpaid bookings in production.
    if (existing.clientPaymentStatus !== 'paid') {
      return { booking: null, error: 'Payment must be confirmed before the inspection can start' };
    }

    let booking: any;
    try {
      [booking] = await db
        .update(bookings)
        .set({ status: 'in_progress' })
        .where(eq(bookings.id, bookingId))
        .returning();
      if (!booking) throw new Error('update returned no row');
    } catch (err) {
      logger.error({ err, bookingId, inspectorId }, 'BookingService.start failed');
      return { booking: null, error: 'Failed to start booking' };
    }

    const [client] = await db.select({ id: users.id, email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, booking.clientId)).limit(1);
    const [inspector] = await db.select({ id: users.id, email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, inspectorId)).limit(1);

    if (client) {
      await NotificationService.send('inspection_started', {
        recipientId: client.id, recipientEmail: client.email,
        data: {
          clientName:      client.fullName,
          inspectorName:   inspector?.fullName || 'The inspector',
          propertyAddress: booking.propertyAddress,
        },
      });
    }

    return { booking: shapeBooking(booking), error: null };
  }

  /** List bookings scoped by role */
  static async list(
    user: { id: string; role: string },
    filters: { status?: string; page?: number; limit?: number }
  ) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const offset = (page - 1) * limit;

    const conds = [];
    if (user.role === 'client') conds.push(eq(bookings.clientId, user.id));
    if (user.role === 'inspector') conds.push(eq(bookings.inspectorId, user.id));
    if (filters.status) conds.push(eq(bookings.status, filters.status));
    const whereExpr = conds.length > 0 ? and(...conds) : undefined;

    try {
      const [rows, totalRow] = await Promise.all([
        db
          .select(bookingFieldsWithJoins)
          .from(bookings)
          .leftJoin(clientUsers, eq(clientUsers.id, bookings.clientId))
          .leftJoin(inspectorUsers, eq(inspectorUsers.id, bookings.inspectorId))
          .where(whereExpr)
          .orderBy(desc(bookings.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(bookings)
          .where(whereExpr),
      ]);

      const transformedBookings = rows.map(r => this.transformBookingForFrontend(r));
      return { bookings: transformedBookings, total: totalRow[0]?.count ?? 0, page, limit };
    } catch (err) {
      logger.error({ err, userId: user.id, role: user.role }, 'BookingService.list failed');
      return { bookings: [], total: 0, page, limit };
    }
  }

  /** Get a single booking by ID, scoped by role */
  static async getById(user: { id: string; role: string }, bookingId: string) {
    const [row] = await db
      .select(bookingFieldsWithJoins)
      .from(bookings)
      .leftJoin(clientUsers, eq(clientUsers.id, bookings.clientId))
      .leftJoin(inspectorUsers, eq(inspectorUsers.id, bookings.inspectorId))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!row) return { booking: null, error: 'Booking not found' };

    if (user.role === 'client' && row.clientId !== user.id) return { booking: null, error: 'Access denied' };
    if (user.role === 'inspector' && row.inspectorId !== user.id) return { booking: null, error: 'Access denied' };

    return { booking: shapeBooking(row), error: null };
  }

  /** Admin: list open bookings with wait time info */
  static async listOpenForAdmin() {
    try {
      const rows = await db
        .select({
          id:              bookings.id,
          propertyAddress: bookings.propertyAddress,
          propertyCity:    bookings.propertyCity,
          propertyType:    bookings.propertyType,
          inspectionType:  bookings.inspectionType,
          requestedDate:   bookings.requestedDate,
          state:           bookings.state,
          lga:             bookings.lga,
          country:         bookings.country,
          createdAt:       bookings.createdAt,
          clientFullName:  clientUsers.fullName,
          clientEmail:     clientUsers.email,
        })
        .from(bookings)
        .leftJoin(clientUsers, eq(clientUsers.id, bookings.clientId))
        .where(eq(bookings.status, 'open'))
        .orderBy(asc(bookings.createdAt));

      const now = Date.now();
      const result = rows.map(b => {
        const createdMs = b.createdAt ? new Date(b.createdAt).getTime() : now;
        const waitingHours = Math.round((now - createdMs) / (1000 * 60 * 60));
        return {
          id: b.id,
          propertyAddress: b.propertyAddress,
          propertyCity: b.propertyCity,
          propertyType: b.propertyType,
          inspectionType: b.inspectionType,
          requestedDate: String(b.requestedDate),
          state: b.state,
          lga: b.lga,
          country: b.country,
          clientName: b.clientFullName || 'Unknown',
          clientEmail: b.clientEmail || null,
          createdAt: toIso(b.createdAt),
          waitingHours,
        };
      });

      return { bookings: result, error: null };
    } catch (err) {
      logger.error({ err }, 'BookingService.listOpenForAdmin failed');
      return { bookings: [], error: 'Failed to fetch open bookings' };
    }
  }

  /** Cron: bookings open longer than 48 hours, notify admin */
  static async notifyStaleBookings() {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

    try {
      const staleBookings = await db
        .select({ id: bookings.id, propertyAddress: bookings.propertyAddress, createdAt: bookings.createdAt })
        .from(bookings)
        .where(and(eq(bookings.status, 'open'), lt(bookings.createdAt, cutoff)));

      if (staleBookings.length === 0) return { notified: 0 };

      const admins = await db
        .select({ id: users.id, email: users.email, fullName: users.fullName })
        .from(users)
        .where(eq(users.role, 'admin'));

      if (admins.length === 0) {
        logger.warn('BookingService.notifyStaleBookings: no admin users found');
        return { notified: 0 };
      }

      let notified = 0;
      for (const booking of staleBookings) {
        const waitingHours = Math.round(
          (Date.now() - (booking.createdAt ? new Date(booking.createdAt).getTime() : Date.now())) / (1000 * 60 * 60)
        );
        for (const admin of admins) {
          await NotificationService.send('admin_booking_stale', {
            recipientId: admin.id, recipientEmail: admin.email,
            data: {
              adminName:        admin.fullName,
              bookingId:        booking.id,
              propertyAddress:  booking.propertyAddress,
              waitingHours,
            },
          });
          notified++;
        }
      }
      return { notified };
    } catch (err) {
      logger.error({ err }, 'BookingService.notifyStaleBookings failed');
      return { notified: 0 };
    }
  }

  /** Verify inspector is active and ACHI-certified */
  private static async verifyInspectorCert(inspectorId: string): Promise<{ error: string | null }> {
    const [profile] = await db
      .select({ achiStatus: inspectorProfiles.achiStatus, isActive: inspectorProfiles.isActive })
      .from(inspectorProfiles)
      .where(eq(inspectorProfiles.userId, inspectorId))
      .limit(1);

    if (!profile) return { error: 'Inspector profile not found' };
    if (profile.achiStatus !== 'certified') return { error: 'You must be ACHI-certified to perform this action' };
    if (!profile.isActive) return { error: 'Your inspector account is not currently active' };

    return { error: null };
  }

  /** Transform DB booking row (with joined fields) → frontend-expected shape */
  static transformBookingForFrontend(row: any): FrontendBooking {
    const { price, share } = formatInspectionPrice(row.inspectionType);

    return {
      id:        row.id,
      client:    row.clientFullName || 'Unknown Client',
      flag:      '🇳🇬',
      loc:       row.propertyCity || 'Nigeria',
      property:  `${row.propertyAddress}, ${row.propertyCity}`,
      type:      formatInspectionType(row.inspectionType),
      date:      formatBookingDate(String(row.requestedDate), row.requestedTime),
      price,
      share,
      note:      row.notesToInspector || null,
      contact:   row.clientPhone || null,
      status:    row.status,
      createdAt: toIso(row.createdAt) ?? '',
      _raw: {
        clientId:        row.clientId,
        inspectorId:     row.inspectorId,
        propertyAddress: row.propertyAddress,
        propertyCity:    row.propertyCity,
        propertyType:    row.propertyType,
        inspectionType:  row.inspectionType,
        requestedDate:   String(row.requestedDate),
        requestedTime:   row.requestedTime,
        clientEmail:     row.clientEmail,
        inspectorName:   row.inspectorFullName,
      },
    };
  }
}

// Silence unused imports retained for future extensions
void or;
