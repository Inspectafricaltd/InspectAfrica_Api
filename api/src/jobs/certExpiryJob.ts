/**
 * ACHI Certificate Expiry Notification Job
 *
 * This job runs daily to check for expiring ACHI certificates and send
 * notification emails to inspectors at 30-day and 7-day intervals.
 *
 * Run with: npx tsx src/jobs/certExpiryJob.ts
 * Or schedule via cron: 0 8 * * * cd /app && npx tsx src/jobs/certExpiryJob.ts
 */

import { and, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { certExpiryNotifications, inspectorProfiles, users } from '../db/schema.js';
import { NotificationService } from '../services/NotificationService.js';

interface InspectorWithCert {
  user_id: string;
  achi_number: string;
  achi_expires_at: string;
  users: {
    id: string;
    email: string;
    full_name: string;
  };
}

/**
 * Get inspectors whose certificates expire within a specific number of days
 */
async function getExpiringInspectors(withinDays: number): Promise<InspectorWithCert[]> {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + withinDays);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  try {
    const rows = await db
      .select({
        userId:        inspectorProfiles.userId,
        achiNumber:    inspectorProfiles.achiNumber,
        achiExpiresAt: inspectorProfiles.achiExpiresAt,
        userIdJoined:  users.id,
        userEmail:     users.email,
        userFullName:  users.fullName,
      })
      .from(inspectorProfiles)
      .leftJoin(users, eq(users.id, inspectorProfiles.userId))
      .where(and(
        eq(inspectorProfiles.achiStatus, 'certified'),
        eq(inspectorProfiles.isActive, true),
        gte(inspectorProfiles.achiExpiresAt, todayStart),
        lte(inspectorProfiles.achiExpiresAt, targetDate),
      ));

    return rows
      .filter((r) => r.userIdJoined && r.userEmail)
      .map((r) => ({
        user_id: r.userId ?? '',
        achi_number: r.achiNumber ?? '',
        achi_expires_at: r.achiExpiresAt ? new Date(r.achiExpiresAt).toISOString() : '',
        users: {
          id: r.userIdJoined ?? '',
          email: r.userEmail ?? '',
          full_name: r.userFullName ?? '',
        },
      }));
  } catch (error) {
    console.error('Failed to fetch expiring inspectors:', error);
    return [];
  }
}

/**
 * Check if a notification was already sent for this expiry window
 * Uses cert_expiry_notifications table for dedicated tracking
 */
async function wasNotificationSent(userId: string, windowDays: number): Promise<boolean> {
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(certExpiryNotifications)
      .where(and(
        eq(certExpiryNotifications.inspectorId, userId),
        eq(certExpiryNotifications.windowDays, windowDays),
      ));

    return (row?.count ?? 0) > 0;
  } catch (error) {
    console.error('Failed to check notification history:', error);
    return false;
  }
}

/**
 * Log notification to cert_expiry_notifications table
 */
async function logCertExpiryNotification(userId: string, windowDays: number, achiNumber: string): Promise<void> {
  try {
    await db.insert(certExpiryNotifications).values({
      inspectorId: userId,
      achiNumber,
      windowDays,
      sentAt: new Date(),
    });
  } catch (error) {
    console.error('Failed to log cert expiry notification:', error);
  }
}

/**
 * Send expiry notifications for a specific window
 */
async function sendExpiryNotifications(windowDays: number, notificationType: 'cert_expiry_30' | 'cert_expiry_7'): Promise<number> {
  console.log(`Checking for certificates expiring in ${windowDays} days...`);

  const inspectors = await getExpiringInspectors(windowDays);
  let sentCount = 0;

  for (const inspector of inspectors) {
    const user = inspector.users;
    if (!user?.email) continue;

    // Check if we already sent this notification recently
    const alreadySent = await wasNotificationSent(user.id, windowDays);
    if (alreadySent) {
      console.log(`Skipping ${user.email} - notification already sent`);
      continue;
    }

    // Send notification
    await NotificationService.send(notificationType, {
      recipientId: user.id,
      recipientEmail: user.email,
      data: {
        recipientName: user.full_name,
        achiNumber: inspector.achi_number,
        expiresAt: new Date(inspector.achi_expires_at).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        renewUrl: `${process.env.APP_URL || 'https://inspectafrica.org'}/inspector/settings/certification`,
      },
    });

    // Log to cert_expiry_notifications table
    await logCertExpiryNotification(user.id, windowDays, inspector.achi_number);

    sentCount++;
    console.log(`Sent ${notificationType} to ${user.email}`);
  }

  return sentCount;
}

/**
 * Update inspector status for expired certificates
 */
async function processExpiredCertificates(): Promise<number> {
  console.log('Processing expired certificates...');

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let expired: Array<{ userId: string | null; achiNumber: string | null }> = [];
  try {
    expired = await db
      .select({
        userId:     inspectorProfiles.userId,
        achiNumber: inspectorProfiles.achiNumber,
      })
      .from(inspectorProfiles)
      .where(and(
        eq(inspectorProfiles.achiStatus, 'certified'),
        lt(inspectorProfiles.achiExpiresAt, todayStart),
      ));
  } catch (fetchError) {
    console.error('Failed to fetch expired certificates:', fetchError);
    return 0;
  }

  let processedCount = 0;

  for (const inspector of expired) {
    if (!inspector.userId) continue;

    // Update status to expired
    try {
      await db
        .update(inspectorProfiles)
        .set({ achiStatus: 'expired', isActive: false })
        .where(eq(inspectorProfiles.userId, inspector.userId));

      processedCount++;
      console.log(`Marked certificate ${inspector.achiNumber} as expired`);
    } catch (updateError) {
      console.error(`Failed to update status for ${inspector.achiNumber}:`, updateError);
      continue;
    }
  }

  return processedCount;
}

/**
 * Main job function. Exported for use both as a standalone CLI script (see
 * bottom of file) and as an HTTP-triggered cron job (routes/system.ts
 * POST /api/v1/cron/cert-expiry) — this was previously CLI-only
 * (`pnpm cron:cert-expiry`) with no HTTP endpoint, so nothing in production
 * ever actually called it; certificate expiry warnings were coded but never
 * reachable.
 */
export async function runCertExpiryJob(): Promise<{ sent30: number; sent7: number; expired: number }> {
  console.log('='.repeat(60));
  console.log('ACHI Certificate Expiry Job');
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  // Process 30-day expiry notifications
  const sent30 = await sendExpiryNotifications(30, 'cert_expiry_30');
  console.log(`Sent ${sent30} 30-day expiry notifications`);

  // Process 7-day expiry notifications
  const sent7 = await sendExpiryNotifications(7, 'cert_expiry_7');
  console.log(`Sent ${sent7} 7-day expiry notifications`);

  // Process expired certificates
  const expired = await processExpiredCertificates();
  console.log(`Processed ${expired} expired certificates`);

  console.log('='.repeat(60));
  console.log('Job completed successfully');
  console.log(`Finished at: ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  return { sent30, sent7, expired };
}

// CLI entry point — only runs when this file is executed directly
// (`pnpm cron:cert-expiry` / `npx tsx src/jobs/certExpiryJob.ts`), not when
// imported by routes/system.ts for the HTTP-triggered path.
if (import.meta.url === `file://${process.argv[1]}`) {
  runCertExpiryJob()
    .then(() => {
      console.log('Exiting...');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}
