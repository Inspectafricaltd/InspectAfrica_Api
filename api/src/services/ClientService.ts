import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { clientProfiles, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export interface ClientProfile {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  countryOfResidence: string | null;
  diasporaFlag: string | null;
  role: string;
  status: string;
  createdAt: string;
}

function toIso(v: any): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export class ClientService {
  /**
   * Get authenticated client's profile
   */
  static async getMyProfile(clientId: string): Promise<ClientProfile | null> {
    let user: {
      id: string;
      email: string;
      fullName: string;
      phone: string | null;
      avatarUrl: string | null;
      role: string;
      status: string;
      createdAt: Date | null;
    } | undefined;
    try {
      const rows = await db
        .select({
          id:        users.id,
          email:     users.email,
          fullName:  users.fullName,
          phone:     users.phone,
          avatarUrl: users.avatarUrl,
          role:      users.role,
          status:    users.status,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, clientId))
        .limit(1);
      user = rows[0];
    } catch (err) {
      logger.error({ err, clientId }, 'ClientService.getMyProfile failed');
      return null;
    }

    if (!user) {
      logger.error({ clientId }, 'ClientService.getMyProfile: user not found');
      return null;
    }

    let clientProfile: { id: string; countryOfResidence: string | null; diasporaFlag: string | null } | undefined;
    try {
      const rows = await db
        .select({
          id:                  clientProfiles.id,
          countryOfResidence:  clientProfiles.countryOfResidence,
          diasporaFlag:        clientProfiles.diasporaFlag,
        })
        .from(clientProfiles)
        .where(eq(clientProfiles.userId, clientId))
        .limit(1);
      clientProfile = rows[0];
    } catch (err) {
      logger.error({ err, clientId }, 'ClientService.getMyProfile: client profile fetch failed');
    }

    return {
      id: clientProfile?.id || user.id,
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      countryOfResidence: clientProfile?.countryOfResidence || null,
      diasporaFlag: clientProfile?.diasporaFlag || null,
      role: user.role,
      status: user.status,
      createdAt: toIso(user.createdAt) ?? '',
    };
  }

  /**
   * Update client's profile
   */
  static async updateMyProfile(
    clientId: string,
    data: {
      phone?: string;
      countryOfResidence?: string;
      diasporaFlag?: string;
    }
  ): Promise<ClientProfile | null> {
    // Update phone in users table if provided
    if (data.phone !== undefined) {
      try {
        await db
          .update(users)
          .set({ phone: data.phone })
          .where(eq(users.id, clientId));
      } catch (err) {
        logger.error({ err, clientId }, 'ClientService.updateMyProfile: phone update failed');
        return null;
      }
    }

    // Build client_profiles update
    const profileUpdate: Record<string, any> = {};
    if (data.countryOfResidence !== undefined) profileUpdate.countryOfResidence = data.countryOfResidence;
    if (data.diasporaFlag !== undefined) profileUpdate.diasporaFlag = data.diasporaFlag;

    if (Object.keys(profileUpdate).length > 0) {
      try {
        await db
          .update(clientProfiles)
          .set(profileUpdate)
          .where(eq(clientProfiles.userId, clientId));
      } catch (err) {
        logger.error({ err, clientId }, 'ClientService.updateMyProfile: profile update failed');
        return null;
      }
    }

    return this.getMyProfile(clientId);
  }

  /**
   * Update user's avatar URL
   */
  static async updateAvatar(userId: string, avatarUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      await db
        .update(users)
        .set({ avatarUrl })
        .where(eq(users.id, userId));
      return { success: true };
    } catch (err: any) {
      logger.error({ err, userId }, 'ClientService.updateAvatar failed');
      return { success: false, error: err?.message ?? 'Failed to update avatar' };
    }
  }
}
