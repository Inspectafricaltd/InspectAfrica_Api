import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, inspectorProfiles, notificationLogs } from '../db/schema.js';
import { SyncStatusService } from '../services/SyncStatusService.js';
import { SyncConflictService } from '../services/SyncConflictService.js';
import { CertCacheService } from '../services/CertCacheService.js';

interface WordPressCert {
  achi_number: string;
  user_id: number;
  full_name: string;
  email: string;
  phone?: string;
  certification_type: string;
  issued_at: string;
  expires_at: string;
  status: 'active' | 'suspended' | 'expired' | 'candidate';
  lms_course_id?: number;
}

interface SyncResult {
  total: number;
  created: number;
  updated: number;
  expired: number;
  conflicts: number;
  errors: string[];
}

const WP_API_URL = process.env.WP_BASE_URL;
const WP_API_KEY = process.env.WP_API_KEY;

/**
 * Fetch all certificates from WordPress
 */
async function fetchCertificatesFromWordPress(): Promise<WordPressCert[]> {
  if (!WP_API_URL || !WP_API_KEY) {
    throw new Error('WordPress API credentials not configured');
  }

  const response = await fetch(`${WP_API_URL}/wp-json/inspect-africa/v1/certificates`, {
    headers: {
      'X-IA-API-Key': WP_API_KEY,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`WordPress API error: ${response.status}`);
  }

  const data = await response.json() as { certificates?: any[] };
  return data.certificates || [];
}

/**
 * Sync certificates from WordPress to the app database
 * Run daily via cron
 */
export async function syncCertificates(): Promise<SyncResult> {
  const result: SyncResult = {
    total: 0,
    created: 0,
    updated: 0,
    expired: 0,
    conflicts: 0,
    errors: [],
  };

  // Start sync run tracking
  let runId: string;
  try {
    runId = await SyncStatusService.startSync('cert_sync');
  } catch (e) {
    console.error('Failed to start sync tracking:', e);
    runId = '';
  }

  try {
    const certificates = await fetchCertificatesFromWordPress();
    result.total = certificates.length;

    // Update progress
    if (runId) {
      await SyncStatusService.updateProgress(runId, { records_processed: 0 });
    }

    let processed = 0;
    for (const cert of certificates) {
      try {
        // Find existing user by email
        const [existingUser] = await db
          .select({ id: users.id, email: users.email, fullName: users.fullName })
          .from(users)
          .where(eq(users.email, cert.email))
          .limit(1);

        if (existingUser) {
          // Get existing profile for conflict detection
          const [existingProfile] = await db
            .select({
              achiNumber:    inspectorProfiles.achiNumber,
              achiStatus:    inspectorProfiles.achiStatus,
              achiIssuedAt:  inspectorProfiles.achiIssuedAt,
              achiExpiresAt: inspectorProfiles.achiExpiresAt,
            })
            .from(inspectorProfiles)
            .where(eq(inspectorProfiles.userId, existingUser.id))
            .limit(1);

          // Detect conflicts if profile exists
          if (existingProfile && existingProfile.achiNumber) {
            const conflictResult = await SyncConflictService.detectConflicts(
              {
                achi_number: cert.achi_number,
                status: cert.status,
                expires_at: cert.expires_at,
                issued_at: cert.issued_at,
                full_name: cert.full_name,
                email: cert.email,
              },
              {
                achi_number: existingProfile.achiNumber,
                achi_status: existingProfile.achiStatus,
                achi_expires_at: existingProfile.achiExpiresAt instanceof Date ? existingProfile.achiExpiresAt.toISOString() : existingProfile.achiExpiresAt,
                achi_issued_at: existingProfile.achiIssuedAt instanceof Date ? existingProfile.achiIssuedAt.toISOString() : existingProfile.achiIssuedAt,
                user_email: existingUser.email,
                user_full_name: existingUser.fullName,
              }
            );

            if (conflictResult.hasConflict) {
              let skipUpdate = false;
              for (const conflict of conflictResult.conflicts) {
                await SyncConflictService.logConflict(conflict);
                result.conflicts++;
                if (conflict.resolution === 'manual_review') skipUpdate = true;
              }
              if (skipUpdate) {
                processed++;
                continue;
              }
            }
          }

          // Update existing inspector profile
          try {
            await db
              .update(inspectorProfiles)
              .set({
                achiNumber:    cert.achi_number,
                achiStatus:    mapWordPressStatus(cert.status),
                achiIssuedAt:  new Date(cert.issued_at),
                achiExpiresAt: new Date(cert.expires_at),
                isActive:      cert.status === 'active',
                updatedAt:     new Date(),
              })
              .where(eq(inspectorProfiles.userId, existingUser.id));

            result.updated++;
            await CertCacheService.invalidateCache(cert.achi_number);
            if (new Date(cert.expires_at) < new Date()) {
              result.expired++;
            }
          } catch (err) {
            result.errors.push(`Failed to update ${cert.achi_number}: ${(err as Error).message}`);
          }
        } else {
          // Create new user and profile in a transaction
          try {
            await db.transaction(async (tx) => {
              const inserted = await tx
                .insert(users)
                .values({
                  email:    cert.email,
                  fullName: cert.full_name,
                  phone:    cert.phone || null,
                  role:     'inspector',
                })
                .returning({ id: users.id });

              const newUser = inserted[0];
              if (!newUser) throw new Error('user insert returned no row');

              await tx.insert(inspectorProfiles).values({
                userId:        newUser.id,
                achiNumber:    cert.achi_number,
                achiStatus:    mapWordPressStatus(cert.status),
                achiIssuedAt:  new Date(cert.issued_at),
                achiExpiresAt: new Date(cert.expires_at),
                isActive:      cert.status === 'active',
              });
            });

            result.created++;
          } catch (err) {
            result.errors.push(`Failed to create user/profile ${cert.email}: ${(err as Error).message}`);
            continue;
          }
        }

        processed++;
        if (runId && processed % 10 === 0) {
          await SyncStatusService.updateProgress(runId, {
            records_processed: processed,
            records_created: result.created,
            records_updated: result.updated,
            records_failed: result.errors.length,
          });
        }
      } catch (err) {
        result.errors.push(`Error processing ${cert.achi_number}: ${(err as Error).message}`);
      }
    }

    // Complete sync run
    if (runId) {
      await SyncStatusService.completeSync(
        runId,
        result.errors.length === 0 ? 'completed' : 'partial',
        {
          records_processed: result.total,
          records_created: result.created,
          records_updated: result.updated,
          records_failed: result.errors.length,
          errors: result.errors,
        },
        { conflicts: result.conflicts }
      );
    }

    // Log sync completion
    try {
      await db.insert(notificationLogs).values({
        type:           'cert_sync',
        recipientEmail: 'system@inspectafrica.org',
        status:         result.errors.length > 0 ? 'failed' : 'sent',
        error:          result.errors.length > 0 ? result.errors.join('; ') : null,
      });
    } catch {/* non-fatal */}

    console.log('Certificate sync complete:', result);
    return result;
  } catch (err) {
    result.errors.push(`Sync failed: ${(err as Error).message}`);
    console.error('Certificate sync failed:', err);

    // Mark sync as failed
    if (runId) {
      await SyncStatusService.completeSync(runId, 'failed', {
        records_processed: 0,
        records_created: 0,
        records_updated: 0,
        records_failed: 1,
        errors: [`${(err as Error).message}`],
      });
    }

    return result;
  }
}

/**
 * Map WordPress status to internal ACHI status
 */
function mapWordPressStatus(status: string): 'candidate' | 'certified' | 'expired' | 'suspended' {
  switch (status) {
    case 'active':
      return 'certified';
    case 'suspended':
      return 'suspended';
    case 'expired':
      return 'expired';
    default:
      return 'candidate';
  }
}

/**
 * Run sync if called directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  syncCertificates()
    .then((result) => {
      console.log('Sync result:', JSON.stringify(result, null, 2));
      process.exit(result.errors.length > 0 ? 1 : 0);
    })
    .catch((err) => {
      console.error('Sync failed:', err);
      process.exit(1);
    });
}

export default syncCertificates;
