import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  bookings,
  inspections,
  inspectorProfiles,
  inspectorReviews,
  users,
} from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { getPublicUrl } from '../lib/storage.js';

export interface PublicInspector {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  achiNumber: string | null;
  achiStatus: string;
  bio: string | null;
  serviceAreas: string[];
  inspectionTypes: string[];
  rating: number;
  totalInspections: number;
}

export interface InspectorReview {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  clientName: string;
}

function toIso(v: any): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export class InspectorService {
  static async list(filters: { city?: string; inspectionType?: string; available?: boolean }) {
    const conds: any[] = [eq(inspectorProfiles.isActive, true)];

    // Filter by city (service_areas contains city) — array containment
    if (filters.city) {
      conds.push(sql`${inspectorProfiles.serviceAreas} @> ARRAY[${filters.city}]::text[]`);
    }

    // Filter by inspection type
    if (filters.inspectionType) {
      conds.push(sql`${inspectorProfiles.inspectionTypes} @> ARRAY[${filters.inspectionType}]::text[]`);
    }

    // Filter by availability — overrides the default isActive=true filter when explicitly provided
    if (filters.available !== undefined) {
      conds.push(eq(inspectorProfiles.isActive, filters.available));
    }

    try {
      const rows = await db
        .select({
          id:               inspectorProfiles.id,
          userId:           inspectorProfiles.userId,
          achiNumber:       inspectorProfiles.achiNumber,
          achiStatus:       inspectorProfiles.achiStatus,
          bio:              inspectorProfiles.bio,
          serviceAreas:     inspectorProfiles.serviceAreas,
          inspectionTypes:  inspectorProfiles.inspectionTypes,
          rating:           inspectorProfiles.rating,
          totalInspections: inspectorProfiles.totalInspections,
          isActive:         inspectorProfiles.isActive,
          userFullName:     users.fullName,
          userAvatarUrl:    users.avatarUrl,
        })
        .from(inspectorProfiles)
        .innerJoin(users, eq(users.id, inspectorProfiles.userId))
        .where(and(...conds));

      const inspectors: PublicInspector[] = rows.map((p) => ({
        id: p.userId ?? '',
        fullName: p.userFullName ?? '',
        avatarUrl: p.userAvatarUrl ?? null,
        achiNumber: p.achiNumber,
        achiStatus: p.achiStatus ?? '',
        bio: p.bio,
        serviceAreas: p.serviceAreas ?? [],
        inspectionTypes: p.inspectionTypes ?? [],
        rating: Number(p.rating ?? 0),
        totalInspections: p.totalInspections ?? 0,
      }));

      return { inspectors, total: inspectors.length };
    } catch (err) {
      logger.error({ err }, 'InspectorService.list failed');
      return { inspectors: [], total: 0 };
    }
  }

  static async getPublicProfile(inspectorId: string) {
    // Get inspector profile
    const [profile] = await db
      .select({
        id:               inspectorProfiles.id,
        userId:           inspectorProfiles.userId,
        achiNumber:       inspectorProfiles.achiNumber,
        achiStatus:       inspectorProfiles.achiStatus,
        bio:              inspectorProfiles.bio,
        serviceAreas:     inspectorProfiles.serviceAreas,
        inspectionTypes:  inspectorProfiles.inspectionTypes,
        rating:           inspectorProfiles.rating,
        totalInspections: inspectorProfiles.totalInspections,
        userFullName:     users.fullName,
        userAvatarUrl:    users.avatarUrl,
      })
      .from(inspectorProfiles)
      .innerJoin(users, eq(users.id, inspectorProfiles.userId))
      .where(eq(inspectorProfiles.userId, inspectorId))
      .limit(1);

    if (!profile) {
      return { inspector: null, reviews: [] };
    }

    // Get last 5 reviews
    let reviews: any[] = [];
    try {
      reviews = await db
        .select({
          id:        inspectorReviews.id,
          rating:    inspectorReviews.rating,
          comment:   inspectorReviews.comment,
          createdAt: inspectorReviews.createdAt,
          clientFullName: users.fullName,
        })
        .from(inspectorReviews)
        .leftJoin(users, eq(users.id, inspectorReviews.clientId))
        .where(eq(inspectorReviews.inspectorId, inspectorId))
        .orderBy(desc(inspectorReviews.createdAt))
        .limit(5);
    } catch (err) {
      logger.error({ err, inspectorId }, 'InspectorService.getPublicProfile: reviews fetch failed');
    }

    const inspector: PublicInspector = {
      id: profile.userId ?? '',
      fullName: profile.userFullName ?? '',
      avatarUrl: profile.userAvatarUrl ?? null,
      achiNumber: profile.achiNumber,
      achiStatus: profile.achiStatus ?? '',
      bio: profile.bio,
      serviceAreas: profile.serviceAreas ?? [],
      inspectionTypes: profile.inspectionTypes ?? [],
      rating: Number(profile.rating ?? 0),
      totalInspections: profile.totalInspections ?? 0,
    };

    const formattedReviews: InspectorReview[] = reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      createdAt: toIso(r.createdAt) ?? '',
      clientName: r.clientFullName ?? 'Anonymous',
    }));

    return { inspector, reviews: formattedReviews };
  }

  static async getMyProfile(inspectorId: string) {
    const [profile] = await db
      .select({
        id:               inspectorProfiles.id,
        userId:           inspectorProfiles.userId,
        achiNumber:       inspectorProfiles.achiNumber,
        achiStatus:       inspectorProfiles.achiStatus,
        achiIssuedAt:     inspectorProfiles.achiIssuedAt,
        achiExpiresAt:    inspectorProfiles.achiExpiresAt,
        bio:              inspectorProfiles.bio,
        serviceAreas:     inspectorProfiles.serviceAreas,
        inspectionTypes:  inspectorProfiles.inspectionTypes,
        rating:           inspectorProfiles.rating,
        totalInspections: inspectorProfiles.totalInspections,
        isActive:         inspectorProfiles.isActive,
        bankName:         inspectorProfiles.bankName,
        accountNumber:    inspectorProfiles.accountNumber,
        accountName:      inspectorProfiles.accountName,
        userId2:          users.id,
        userEmail:        users.email,
        userFullName:     users.fullName,
        userPhone:        users.phone,
        userAvatarUrl:    users.avatarUrl,
        userSignaturePath: users.signatureImagePath,
      })
      .from(inspectorProfiles)
      .innerJoin(users, eq(users.id, inspectorProfiles.userId))
      .where(eq(inspectorProfiles.userId, inspectorId))
      .limit(1);

    if (!profile) {
      return null;
    }

    const signaturePath = profile.userSignaturePath ?? null;
    const signatureUrl = signaturePath ? await getPublicUrl('avatars', signaturePath) : null;

    return {
      id: profile.userId ?? '',
      email: profile.userEmail ?? '',
      fullName: profile.userFullName ?? '',
      phone: profile.userPhone ?? null,
      avatarUrl: profile.userAvatarUrl ?? null,
      signatureImagePath: signaturePath,
      signatureUrl,
      achiNumber: profile.achiNumber,
      achiStatus: profile.achiStatus,
      achiIssuedAt: toIso(profile.achiIssuedAt),
      achiExpiresAt: toIso(profile.achiExpiresAt),
      bio: profile.bio,
      serviceAreas: profile.serviceAreas ?? [],
      inspectionTypes: profile.inspectionTypes ?? [],
      rating: Number(profile.rating ?? 0),
      totalInspections: profile.totalInspections ?? 0,
      isActive: profile.isActive,
      bankName: profile.bankName,
      accountNumber: profile.accountNumber,
      accountName: profile.accountName,
    };
  }

  static async updateMyProfile(inspectorId: string, data: {
    bio?: string;
    serviceAreas?: string[];
    inspectionTypes?: string[];
    phone?: string;
    bankName?: string;
    accountNumber?: string;
    accountName?: string;
  }) {
    // Update inspector profile
    const profileUpdate: Record<string, any> = {};
    if (data.bio !== undefined) profileUpdate.bio = data.bio;
    if (data.serviceAreas !== undefined) profileUpdate.serviceAreas = data.serviceAreas;
    if (data.inspectionTypes !== undefined) profileUpdate.inspectionTypes = data.inspectionTypes;
    if (data.bankName !== undefined) profileUpdate.bankName = data.bankName;
    if (data.accountNumber !== undefined) profileUpdate.accountNumber = data.accountNumber;
    if (data.accountName !== undefined) profileUpdate.accountName = data.accountName;

    if (Object.keys(profileUpdate).length > 0) {
      try {
        await db
          .update(inspectorProfiles)
          .set(profileUpdate)
          .where(eq(inspectorProfiles.userId, inspectorId));
      } catch (err) {
        logger.error({ err, inspectorId }, 'InspectorService.updateMyProfile failed');
        return null;
      }
    }

    // Update phone in users table if provided
    if (data.phone !== undefined) {
      try {
        await db
          .update(users)
          .set({ phone: data.phone })
          .where(eq(users.id, inspectorId));
      } catch (err) {
        logger.error({ err, inspectorId }, 'InspectorService.updateMyProfile: phone update failed');
      }
    }

    return this.getMyProfile(inspectorId);
  }

  static async getStats(inspectorId: string) {
    const countExpr = sql<number>`count(*)::int`;

    try {
      const [
        totalInspectionsRes,
        completedInspectionsRes,
        ratingDataRes,
        pendingBookingsRes,
      ] = await Promise.all([
        db.select({ count: countExpr }).from(inspections).where(eq(inspections.inspectorId, inspectorId)),
        db.select({ count: countExpr }).from(inspections).where(and(
          eq(inspections.inspectorId, inspectorId),
          eq(inspections.status, 'approved'),
        )),
        db.select({ rating: inspectorReviews.rating }).from(inspectorReviews).where(eq(inspectorReviews.inspectorId, inspectorId)),
        db.select({ count: countExpr }).from(bookings).where(and(
          eq(bookings.inspectorId, inspectorId),
          eq(bookings.status, 'open'),
        )),
      ]);

      const totalInspections = totalInspectionsRes[0]?.count ?? 0;
      const completedInspections = completedInspectionsRes[0]?.count ?? 0;
      const pendingBookings = pendingBookingsRes[0]?.count ?? 0;

      const averageRating = ratingDataRes.length > 0
        ? ratingDataRes.reduce((sum, r) => sum + (r.rating ?? 0), 0) / ratingDataRes.length
        : 0;

      return {
        totalInspections,
        completedInspections,
        averageRating: Math.round(averageRating * 100) / 100,
        pendingBookings,
      };
    } catch (err) {
      logger.error({ err, inspectorId }, 'InspectorService.getStats failed');
      return {
        totalInspections: 0,
        completedInspections: 0,
        averageRating: 0,
        pendingBookings: 0,
      };
    }
  }
}
