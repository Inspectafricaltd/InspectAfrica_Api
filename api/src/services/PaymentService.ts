import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { inspectorProfiles, bookings, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { RevisionService } from './RevisionService.js';
import { NotificationService } from './NotificationService.js';
import { uploadFile, deleteFiles, getSignedDownloadUrl } from '../lib/storage.js';
import { broadcast, broadcastToRole } from '../lib/eventBus.js';

const RECEIPTS_BUCKET = 'booking-receipts';
const SIGNED_URL_TTL = 3600;

export interface InspectorPayout {
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
}

export interface CompanyAccount {
  bankName: string;
  accountNumber: string;
  accountName: string;
}

export interface BookingPayment {
  bookingId: string;
  clientPaymentStatus: 'unpaid' | 'pending' | 'paid';
  clientPaymentAmount: number | null;
  clientReceiptPath: string | null;
  clientReceiptUrl: string | null;
  clientReceiptUploadedAt: string | null;
  clientPaidAt: string | null;
  clientPaymentNotes: string | null;
  inspectorPayoutStatus: 'unpaid' | 'pending' | 'paid';
  inspectorPayoutAmount: number | null;
  inspectorPaidAt: string | null;
  inspectorPayoutNotes: string | null;
  inspectorPayout: InspectorPayout | null;
}

function getCompanyAccount(): CompanyAccount {
  return {
    bankName: process.env.COMPANY_BANK_NAME || 'Inspect Africa Ltd',
    accountNumber: process.env.COMPANY_ACCOUNT_NUMBER || '',
    accountName: process.env.COMPANY_ACCOUNT_NAME || 'Inspect Africa Ltd',
  };
}

function toIso(v: any): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export class PaymentService {
  static getCompanyAccount = getCompanyAccount;

  /** Inspector reads their own payout account */
  static async getInspectorPayout(inspectorId: string): Promise<{ payout: InspectorPayout; error: string | null }> {
    try {
      const [row] = await db
        .select({
          bankName:      inspectorProfiles.bankName,
          accountNumber: inspectorProfiles.accountNumber,
          accountName:   inspectorProfiles.accountName,
        })
        .from(inspectorProfiles)
        .where(eq(inspectorProfiles.userId, inspectorId))
        .limit(1);

      return {
        payout: {
          bankName:      row?.bankName ?? null,
          accountNumber: row?.accountNumber ?? null,
          accountName:   row?.accountName ?? null,
        },
        error: null,
      };
    } catch (err) {
      logger.error({ err, inspectorId }, 'PaymentService.getInspectorPayout failed');
      return {
        payout: { bankName: null, accountNumber: null, accountName: null },
        error: 'Failed to load payout account',
      };
    }
  }

  /** Inspector updates their own payout account */
  static async updateInspectorPayout(
    inspectorId: string,
    payout: { bankName: string; accountNumber: string; accountName: string }
  ): Promise<{ payout: InspectorPayout | null; error: string | null }> {
    try {
      const [data] = await db
        .update(inspectorProfiles)
        .set({
          bankName:      payout.bankName.trim(),
          accountNumber: payout.accountNumber.trim(),
          accountName:   payout.accountName.trim(),
        })
        .where(eq(inspectorProfiles.userId, inspectorId))
        .returning({
          bankName:      inspectorProfiles.bankName,
          accountNumber: inspectorProfiles.accountNumber,
          accountName:   inspectorProfiles.accountName,
        });

      if (!data) {
        return { payout: null, error: 'Failed to update payout account' };
      }

      return {
        payout: {
          bankName:      data.bankName ?? null,
          accountNumber: data.accountNumber ?? null,
          accountName:   data.accountName ?? null,
        },
        error: null,
      };
    } catch (err) {
      logger.error({ err, inspectorId }, 'PaymentService.updateInspectorPayout failed');
      return { payout: null, error: 'Failed to update payout account' };
    }
  }

  /**
   * Fetch booking payment state with receipt signed URL when viewable.
   */
  static async getBookingPayment(
    user: { id: string; role: string },
    bookingId: string
  ): Promise<{ payment: BookingPayment | null; error: string | null }> {
    const [booking] = await db
      .select({
        id:                    bookings.id,
        clientId:              bookings.clientId,
        inspectorId:           bookings.inspectorId,
        clientPaymentStatus:   bookings.clientPaymentStatus,
        clientPaymentAmount:   bookings.clientPaymentAmount,
        clientReceiptPath:     bookings.clientReceiptPath,
        clientReceiptUploadedAt: bookings.clientReceiptUploadedAt,
        clientPaidAt:          bookings.clientPaidAt,
        clientPaymentNotes:    bookings.clientPaymentNotes,
        inspectorPayoutStatus: bookings.inspectorPayoutStatus,
        inspectorPayoutAmount: bookings.inspectorPayoutAmount,
        inspectorPaidAt:       bookings.inspectorPaidAt,
        inspectorPayoutNotes:  bookings.inspectorPayoutNotes,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) return { payment: null, error: 'Booking not found' };

    const isAdmin = user.role === 'admin';
    const isClient = user.role === 'client' && booking.clientId === user.id;
    const isInspector = user.role === 'inspector' && booking.inspectorId === user.id;
    if (!isAdmin && !isClient && !isInspector) {
      return { payment: null, error: 'Access denied' };
    }

    let receiptUrl: string | null = null;
    if (booking.clientReceiptPath && (isAdmin || isClient)) {
      receiptUrl = await getSignedDownloadUrl(RECEIPTS_BUCKET, booking.clientReceiptPath, SIGNED_URL_TTL);
    }

    let inspectorPayout: InspectorPayout | null = null;
    if (isAdmin && booking.inspectorId) {
      const { payout } = await this.getInspectorPayout(booking.inspectorId);
      inspectorPayout = payout;
    }

    return {
      payment: {
        bookingId:               booking.id,
        clientPaymentStatus:     (booking.clientPaymentStatus ?? 'unpaid') as BookingPayment['clientPaymentStatus'],
        clientPaymentAmount:     booking.clientPaymentAmount ? Number(booking.clientPaymentAmount) : null,
        clientReceiptPath:       booking.clientReceiptPath,
        clientReceiptUrl:        receiptUrl,
        clientReceiptUploadedAt: toIso(booking.clientReceiptUploadedAt),
        clientPaidAt:            toIso(booking.clientPaidAt),
        clientPaymentNotes:      booking.clientPaymentNotes,
        inspectorPayoutStatus:   (booking.inspectorPayoutStatus ?? 'unpaid') as BookingPayment['inspectorPayoutStatus'],
        inspectorPayoutAmount:   booking.inspectorPayoutAmount ? Number(booking.inspectorPayoutAmount) : null,
        inspectorPaidAt:         toIso(booking.inspectorPaidAt),
        inspectorPayoutNotes:    booking.inspectorPayoutNotes,
        inspectorPayout,
      },
      error: null,
    };
  }

  /** Client uploads a payment receipt — sets status to 'pending' for admin confirmation. */
  static async uploadClientReceipt(
    clientId: string,
    bookingId: string,
    file: { buffer: Buffer; mimeType: string; originalName: string }
  ): Promise<{ path: string | null; error: string | null }> {
    const [booking] = await db
      .select({
        id:                bookings.id,
        clientId:          bookings.clientId,
        status:            bookings.status,
        clientReceiptPath: bookings.clientReceiptPath,
        propertyAddress:   bookings.propertyAddress,
      })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) return { path: null, error: 'Booking not found' };
    if (booking.clientId !== clientId) return { path: null, error: 'Access denied' };

    // A client pays only after an inspector has accepted. Until then the
    // booking may still be repriced or go unclaimed, so taking money is wrong.
    // The UI hides the payment card before acceptance; this is the rule the UI
    // is expressing, enforced where it cannot be bypassed.
    if (booking.status === 'open') {
      return { path: null, error: 'An inspector must accept this booking before you can pay' };
    }
    if (booking.status === 'cancelled') {
      return { path: null, error: 'This booking was cancelled' };
    }

    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedMimes.includes(file.mimeType)) {
      return { path: null, error: 'Unsupported file type. Use JPG, PNG, WEBP, or PDF.' };
    }

    const ext = file.mimeType === 'application/pdf' ? 'pdf'
      : file.mimeType === 'image/png' ? 'png'
      : file.mimeType === 'image/webp' ? 'webp'
      : 'jpg';
    const storagePath = `bookings/${bookingId}/receipts/${randomUUID()}.${ext}`;

    const upload = await uploadFile(RECEIPTS_BUCKET, storagePath, file.buffer, {
      contentType: file.mimeType, upsert: false,
    });
    if (!upload.ok) {
      logger.error(
        { bookingId, storagePath, reason: upload.reason, detail: upload.message },
        'PaymentService.uploadClientReceipt failed'
      );
      return {
        path: null,
        error: upload.reason === 'unavailable'
          ? 'Could not store the receipt right now. Please try again in a moment.'
          : 'A receipt already exists at that path',
      };
    }

    if (booking.clientReceiptPath) {
      await deleteFiles(RECEIPTS_BUCKET, [booking.clientReceiptPath]);
    }

    try {
      await db
        .update(bookings)
        .set({
          clientReceiptPath:       storagePath,
          clientReceiptUploadedAt: new Date(),
          clientPaymentStatus:     'pending',
        })
        .where(eq(bookings.id, bookingId));
    } catch (err) {
      logger.error({ err, bookingId }, 'PaymentService.update receipt path failed');
      return { path: null, error: 'Failed to save receipt' };
    }

    await RevisionService.log({
      inspectionId: bookingId,
      entityType: 'inspection',
      entityId: bookingId,
      action: 'updated',
      field: 'client_receipt_uploaded',
      previousValue: null,
      newValue: storagePath,
      changedBy: clientId,
    });

    broadcastToRole('admin', 'payment.receipt_uploaded', {
      bookingId,
      propertyAddress: booking.propertyAddress,
    });
    this.notifyAdminsOfReceiptUpload(bookingId, booking.propertyAddress).catch((err) =>
      logger.warn({ err, bookingId }, 'PaymentService: admin email notification failed (non-fatal)')
    );

    return { path: storagePath, error: null };
  }

  /** Email all admins when a client uploads a payment receipt — the broadcast above is in-app only and lost if no admin is online. */
  private static async notifyAdminsOfReceiptUpload(bookingId: string, propertyAddress: string | null): Promise<void> {
    const admins = await db
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.role, 'admin'));

    for (const admin of admins) {
      await NotificationService.send('payment_receipt_uploaded', {
        recipientId: admin.id,
        recipientEmail: admin.email,
        data: {
          adminName: admin.fullName,
          propertyAddress,
          bookingId,
        },
      });
    }
  }

  /** Admin sets client payment status */
  static async setClientPaymentStatus(
    adminId: string,
    bookingId: string,
    status: 'unpaid' | 'pending' | 'paid',
    opts: { amount?: number | null; notes?: string | null } = {}
  ): Promise<{ error: string | null }> {
    const [booking] = await db
      .select({ id: bookings.id, clientPaymentStatus: bookings.clientPaymentStatus })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) return { error: 'Booking not found' };

    const update: Record<string, any> = { clientPaymentStatus: status };
    if (status === 'paid') {
      update.clientPaidAt = new Date();
      update.clientPaidBy = adminId;
    } else {
      update.clientPaidAt = null;
      update.clientPaidBy = null;
    }
    if (opts.amount !== undefined) update.clientPaymentAmount = opts.amount;
    if (opts.notes !== undefined)  update.clientPaymentNotes  = opts.notes;

    try {
      await db.update(bookings).set(update).where(eq(bookings.id, bookingId));
    } catch (err) {
      logger.error({ err, bookingId }, 'PaymentService.setClientPaymentStatus failed');
      return { error: 'Failed to update status' };
    }

    await RevisionService.log({
      inspectionId: bookingId,
      entityType: 'inspection',
      entityId: bookingId,
      action: 'updated',
      field: 'client_payment_status',
      previousValue: booking.clientPaymentStatus,
      newValue: status,
      changedBy: adminId,
      ...(opts.notes ? { reason: opts.notes } : {}),
    });

    return { error: null };
  }

  /** Admin sets inspector payout status */
  static async setInspectorPayoutStatus(
    adminId: string,
    bookingId: string,
    status: 'unpaid' | 'pending' | 'paid',
    opts: { amount?: number | null; notes?: string | null } = {}
  ): Promise<{ error: string | null }> {
    const [booking] = await db
      .select({ id: bookings.id, inspectorId: bookings.inspectorId, inspectorPayoutStatus: bookings.inspectorPayoutStatus })
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (!booking) return { error: 'Booking not found' };

    const update: Record<string, any> = { inspectorPayoutStatus: status };
    if (status === 'paid') {
      update.inspectorPaidAt = new Date();
      update.inspectorPaidBy = adminId;
    } else {
      update.inspectorPaidAt = null;
      update.inspectorPaidBy = null;
    }
    if (opts.amount !== undefined) update.inspectorPayoutAmount = opts.amount;
    if (opts.notes !== undefined)  update.inspectorPayoutNotes  = opts.notes;

    try {
      await db.update(bookings).set(update).where(eq(bookings.id, bookingId));
    } catch (err) {
      logger.error({ err, bookingId }, 'PaymentService.setInspectorPayoutStatus failed');
      return { error: 'Failed to update status' };
    }

    await RevisionService.log({
      inspectionId: bookingId,
      entityType: 'inspection',
      entityId: bookingId,
      action: 'updated',
      field: 'inspector_payout_status',
      previousValue: booking.inspectorPayoutStatus,
      newValue: status,
      changedBy: adminId,
      ...(opts.notes ? { reason: opts.notes } : {}),
    });

    if (status === 'paid' && booking.inspectorId) {
      this.notifyInspectorOfPayout(booking.inspectorId, opts.amount ?? null, opts.notes ?? null).catch((err) =>
        logger.warn({ err, bookingId }, 'PaymentService.setInspectorPayoutStatus: inspector notification failed (non-fatal)')
      );
    }

    return { error: null };
  }

  /** Email + in-app broadcast to an inspector when their payout is marked paid. */
  private static async notifyInspectorOfPayout(inspectorId: string, amount: number | null, notes: string | null): Promise<void> {
    const [inspector] = await db
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, inspectorId))
      .limit(1);

    if (!inspector) return;

    broadcast(inspectorId, 'payout.paid', { amount });

    await NotificationService.send('payout_paid', {
      recipientId: inspector.id,
      recipientEmail: inspector.email,
      data: {
        inspectorName: inspector.fullName,
        amount,
        notes,
      },
    });
  }
}
