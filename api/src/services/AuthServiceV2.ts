/**
 * Native auth service.
 *
 * Uses:
 *  - bcryptjs for password hashing
 *  - jsonwebtoken for access token (15 min) + refresh token (opaque, stored hashed)
 *  - Drizzle (DATABASE_URL) for storage
 *  - Resend directly for all email flows
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { eq, and, gt, isNull, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { users, inspectorProfiles, clientProfiles, refreshTokens, passwordResetTokens } from '../db/schema.js';
import { NotificationService } from './NotificationService.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { cacheInvalidate } from '../lib/userCache.js';
import { broadcastToRole } from '../lib/eventBus.js';

const JWT_SECRET        = env.JWT_SECRET;
const APP_URL           = env.APP_URL || 'https://app.inspectafrica.org';
const ACCESS_TOKEN_TTL  = 15 * 60;              // 15 minutes (seconds)
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;   // 30 days (seconds)
const RESET_TOKEN_TTL   = 60 * 60;              // 1 hour (seconds)
const BCRYPT_ROUNDS     = 12;

type Role = 'inspector' | 'client' | 'admin';

function isValidRole(role: string): role is Role {
  return role === 'inspector' || role === 'client' || role === 'admin';
}

function safeNotify(...args: Parameters<typeof NotificationService.send>): void {
  NotificationService.send(...args).catch(err => {
    logger.warn({ err, type: args[0] }, 'AuthServiceV2: notification send failed');
  });
}

export interface AccessTokenPayload {
  sub:     string;
  email:   string;
  role:    'inspector' | 'client' | 'admin';
  version: number;   // matches users.token_version — bumped on global logout
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  // Direct postgres error
  if ('code' in err && err.code === '23505') return true;
  // Drizzle wraps postgres errors — check message and cause
  const msg = 'message' in err ? String((err as any).message) : '';
  if (msg.includes('23505') || msg.includes('unique constraint')) return true;
  const cause = 'cause' in err ? (err as any).cause : null;
  if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '23505') return true;
  return false;
}

function isPhoneConflict(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const constraint = 'constraint' in err ? String((err as any).constraint) : '';
  if (constraint.includes('phone')) return true;
  const detail = 'detail' in err ? String((err as any).detail) : '';
  if (detail.includes('phone')) return true;
  const msg = 'message' in err ? String((err as any).message) : '';
  if (msg.includes('phone')) return true;
  const cause = 'cause' in err ? (err as any).cause : null;
  if (cause && typeof cause === 'object') {
    const causeConstraint = 'constraint' in cause ? String(cause.constraint) : '';
    if (causeConstraint.includes('phone')) return true;
  }
  return false;
}

function signAccess(payload: AccessTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

function generateRefreshToken(): string {
  return randomBytes(48).toString('hex');
}

// ── Login ─────────────────────────────────────────────────────────────────────

export class AuthServiceV2 {
  static async login(
    email: string,
    password: string,
    meta?: { userAgent?: string; ipAddress?: string }
  ) {
    const [user] = await db
      .select({
        id: users.id, email: users.email, fullName: users.fullName,
        phone: users.phone, role: users.role, status: users.status,
        avatarUrl: users.avatarUrl, createdAt: users.createdAt,
        passwordHash: users.passwordHash, tokenVersion: users.tokenVersion,
      })
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);

    if (!user || !user.passwordHash) {
      return { user: null, session: null, error: 'Invalid email or password' };
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      logger.warn({ userId: user.id }, 'AuthServiceV2.login: bad password');
      return { user: null, session: null, error: 'Invalid email or password' };
    }

    if (user.status === 'suspended') {
      return { user: null, session: null, error: 'Your account has been suspended. Please contact support.' };
    }
    if (user.status === 'pending') {
      return { user: null, session: null, error: 'Your account is pending approval.' };
    }

    if (!isValidRole(user.role)) {
      logger.error({ userId: user.id, role: user.role }, 'AuthServiceV2.login: invalid role on user record');
      return { user: null, session: null, error: 'Invalid account configuration' };
    }

    const accessPayload: AccessTokenPayload = {
      sub: user.id, email: user.email, role: user.role,
      version: user.tokenVersion ?? 0,
    };
    const accessToken  = signAccess(accessPayload);
    const rawRefresh   = generateRefreshToken();
    const expiresAt    = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000);

    await db.insert(refreshTokens).values({
      userId:    user.id,
      tokenHash: hashToken(rawRefresh),
      expiresAt,
      userAgent: meta?.userAgent,
      ipAddress: meta?.ipAddress,
    });

    logger.info({ userId: user.id, role: user.role }, 'AuthServiceV2.login: success');
    return {
      user: {
        id: user.id, email: user.email, fullName: user.fullName,
        phone: user.phone, role: user.role,
        status: user.status ?? 'active', avatarUrl: user.avatarUrl,
        createdAt: user.createdAt?.toISOString() ?? '',
      },
      session: {
        accessToken,
        refreshToken: rawRefresh,
        expiresAt: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL,
      },
      error: null,
    };
  }

  // ── Refresh ────────────────────────────────────────────────────────────────

  static async refresh(rawRefreshToken: string) {
    const hash = hashToken(rawRefreshToken);
    const now  = new Date();

    const [row] = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, hash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, now)
        )
      )
      .limit(1);

    if (!row) {
      return { session: null, error: 'Invalid or expired refresh token' };
    }

    // Revoke old token (rotation)
    await db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(eq(refreshTokens.id, row.id));

    const [user] = await db
      .select({ id: users.id, email: users.email, role: users.role, tokenVersion: users.tokenVersion, status: users.status })
      .from(users)
      .where(eq(users.id, row.userId))
      .limit(1);

    if (!user || user.status === 'suspended') {
      return { session: null, error: 'Account unavailable' };
    }

    if (!isValidRole(user.role)) {
      logger.error({ userId: user.id, role: user.role }, 'AuthServiceV2.refresh: invalid role on user record');
      return { session: null, error: 'Invalid account configuration' };
    }

    const accessPayload: AccessTokenPayload = {
      sub: user.id, email: user.email,
      role: user.role,
      version: user.tokenVersion ?? 0,
    };
    const accessToken = signAccess(accessPayload);
    const rawNew      = generateRefreshToken();

    await db.insert(refreshTokens).values({
      userId:    user.id,
      tokenHash: hashToken(rawNew),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL * 1000),
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
    });

    return {
      session: {
        accessToken,
        refreshToken: rawNew,
        expiresAt: Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL,
      },
      error: null,
    };
  }

  // ── Logout (global — revoke all refresh tokens + bump token_version) ────────

  static async logout(userId: string) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));

    await db.execute(
      sql`UPDATE users SET token_version = token_version + 1 WHERE id = ${userId}`
    );

    cacheInvalidate(userId);
    return { success: true, error: null };
  }

  // ── Register client ────────────────────────────────────────────────────────

  static async registerClient(data: {
    email: string; password: string; fullName: string;
    phone?: string; countryOfResidence?: string; diasporaFlag?: string;
  }) {
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const userId = randomUUID();
    const normalizedEmail = data.email.toLowerCase().trim();

    try {
      await db.transaction(async (tx) => {
        await tx.insert(users).values({
          id: userId, email: normalizedEmail,
          fullName: data.fullName, phone: data.phone ?? null,
          role: 'client', status: 'active', passwordHash,
        });
        await tx.insert(clientProfiles).values({
          userId,
          countryOfResidence: data.countryOfResidence ?? null,
          diasporaFlag:       data.diasporaFlag ?? null,
        });
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        if (isPhoneConflict(err)) {
          return { user: null, session: null, error: 'This phone number is already registered. Please use a different number.' };
        }
        return { user: null, session: null, error: 'An account with this email already exists. Please log in instead.' };
      }
      logger.error({ err }, 'AuthServiceV2.registerClient: insert failed');
      return { user: null, session: null, error: 'Registration failed. Please try again.' };
    }

    safeNotify('welcome_client', {
      recipientId: userId, recipientEmail: normalizedEmail,
      data: { fullName: data.fullName },
    });

    logger.info({ userId, role: 'client' }, 'AuthServiceV2.registerClient: success');
    return {
      user: {
        id: userId, email: normalizedEmail, fullName: data.fullName,
        phone: data.phone ?? null, role: 'client', status: 'active',
        avatarUrl: null, createdAt: new Date().toISOString(),
      },
      session: null,
      requiresEmailConfirmation: false,
      error: null,
    };
  }

  // ── Register inspector (admin-only) ────────────────────────────────────────

  static async registerInspector(data: {
    email: string; password: string; fullName: string;
    phone: string; achiNumber?: string;
  }) {
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
    const userId = randomUUID();
    const normalizedEmail = data.email.toLowerCase().trim();

    try {
      await db.transaction(async (tx) => {
        await tx.insert(users).values({
          id: userId, email: normalizedEmail,
          fullName: data.fullName, phone: data.phone,
          role: 'inspector', status: 'active', passwordHash,
        });
        await tx.insert(inspectorProfiles).values({
          userId, achiNumber: data.achiNumber ?? null,
          achiStatus: 'candidate', isActive: true,
        });
      });
    } catch (err: unknown) {
      if (isUniqueViolation(err)) {
        if (isPhoneConflict(err)) {
          return { user: null, error: 'This phone number is already registered. Please use a different number.' };
        }
        return { user: null, error: 'An account with this email already exists. Please log in instead.' };
      }
      logger.error({ err }, 'AuthServiceV2.registerInspector: insert failed');
      return { user: null, error: 'Registration failed. Please try again.' };
    }

    safeNotify('welcome_inspector', {
      recipientId: userId, recipientEmail: normalizedEmail,
      data: { fullName: data.fullName, achiNumber: data.achiNumber ?? null },
    });

    this.notifyAdminsOfNewInspector(userId, data.fullName, normalizedEmail).catch((err) =>
      logger.warn({ err, userId }, 'AuthServiceV2.registerInspector: admin notification failed (non-fatal)')
    );

    return {
      user: {
        id: userId, email: normalizedEmail, fullName: data.fullName,
        phone: data.phone, role: 'inspector', status: 'active',
        avatarUrl: null, createdAt: new Date().toISOString(),
      },
      requiresEmailConfirmation: false,
      error: null,
    };
  }

  /** Email + in-app broadcast to all admins when a new inspector registers (candidate status — needs cert review). */
  private static async notifyAdminsOfNewInspector(inspectorId: string, fullName: string, email: string): Promise<void> {
    broadcastToRole('admin', 'inspector.registered', { inspectorId, fullName });

    const admins = await db
      .select({ id: users.id, email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.role, 'admin'));

    for (const admin of admins) {
      await NotificationService.send('inspector_registered', {
        recipientId: admin.id,
        recipientEmail: admin.email,
        data: {
          adminName: admin.fullName,
          inspectorName: fullName,
          inspectorEmail: email,
        },
      });
    }
  }

  // ── Password reset request ─────────────────────────────────────────────────

  static async requestPasswordReset(email: string) {
    const [user] = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);

    if (!user) {
      // Don't reveal whether email exists
      return { error: null };
    }

    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL * 1000);

    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt,
    });

    const resetUrl = `${APP_URL}/reset-password?token=${rawToken}`;

    await NotificationService.send('password_reset', {
      recipientId: user.id, recipientEmail: email,
      data: { fullName: user.fullName, resetUrl },
    });

    return { error: null };
  }

  // ── Password reset confirm ─────────────────────────────────────────────────

  static async resetPassword(rawToken: string, newPassword: string) {
    const hash = hashToken(rawToken);
    const now  = new Date();

    const [row] = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, hash),
          isNull(passwordResetTokens.usedAt),
          gt(passwordResetTokens.expiresAt, now)
        )
      )
      .limit(1);

    if (!row) {
      return { error: 'Invalid or expired reset token' };
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE users SET password_hash = ${passwordHash}, token_version = token_version + 1 WHERE id = ${row.userId}`
      );
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
      await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(eq(passwordResetTokens.id, row.id));
    });

    cacheInvalidate(row.userId);
    return { error: null };
  }

  // ── Change password ────────────────────────────────────────────────────────

  static async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const [user] = await db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user?.passwordHash) return { error: 'User not found' };

    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) return { error: 'Current password is incorrect' };

    const newHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    const now = new Date();

    // Bump token_version + revoke all refresh tokens so other sessions are kicked out
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`UPDATE users SET password_hash = ${newHash}, token_version = token_version + 1 WHERE id = ${userId}`
      );
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
    });

    cacheInvalidate(userId);
    return { error: null };
  }

  // ── getMe (same interface as AuthService.getMe) ────────────────────────────

  static async getMe(userId: string) {
    const [user] = await db
      .select({
        id: users.id, email: users.email, fullName: users.fullName,
        phone: users.phone, role: users.role, status: users.status,
        avatarUrl: users.avatarUrl, createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return { user: null, profile: null, error: 'User not found' };

    let profile: Record<string, any> | null = null;

    if (user.role === 'inspector') {
      const [p] = await db
        .select()
        .from(inspectorProfiles)
        .where(eq(inspectorProfiles.userId, userId))
        .limit(1);
      if (p) profile = {
        achiNumber: p.achiNumber, achiStatus: p.achiStatus,
        achiExpiresAt: p.achiExpiresAt?.toISOString() ?? null,
        bio: p.bio, serviceAreas: p.serviceAreas ?? [],
        inspectionTypes: p.inspectionTypes ?? [],
        rating: Number(p.rating), totalInspections: p.totalInspections,
        isActive: p.isActive,
      };
    } else if (user.role === 'client') {
      const [p] = await db
        .select()
        .from(clientProfiles)
        .where(eq(clientProfiles.userId, userId))
        .limit(1);
      if (p) profile = {
        countryOfResidence: p.countryOfResidence,
        diasporaFlag: p.diasporaFlag,
      };
    }

    return {
      user: {
        id: user.id, email: user.email, fullName: user.fullName,
        phone: user.phone, role: user.role,
        status: user.status ?? 'active', avatarUrl: user.avatarUrl,
        createdAt: user.createdAt?.toISOString() ?? '',
      },
      profile,
      error: null,
    };
  }

  // ── Verify JWT (used by auth plugin) ──────────────────────────────────────

  static verifyAccessToken(token: string): AccessTokenPayload | null {
    try {
      return jwt.verify(token, JWT_SECRET) as AccessTokenPayload;
    } catch {
      return null;
    }
  }
}
