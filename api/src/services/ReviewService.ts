import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { bookings, inspectorProfiles, inspectorReviews, users } from '../db/schema.js';
import { logger } from '../lib/logger.js';

export interface CreateReviewData {
  bookingId: string;
  rating: number;
  comment?: string;
}

export interface Review {
  id: string;
  inspectorId: string;
  clientId: string;
  bookingId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  clientName?: string;
  propertyAddress?: string | null;
}

function toIso(v: any): string | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v.toISOString() : String(v);
}

export class ReviewService {
  /**
   * Client submits a review for an inspector after a completed booking.
   */
  static async create(clientId: string, data: CreateReviewData) {
    // Verify booking exists, is completed, and belongs to this client
    const [booking] = await db
      .select({
        id:          bookings.id,
        status:      bookings.status,
        clientId:    bookings.clientId,
        inspectorId: bookings.inspectorId,
      })
      .from(bookings)
      .where(eq(bookings.id, data.bookingId))
      .limit(1);

    if (!booking) {
      return { review: null, error: 'Booking not found' };
    }

    if (booking.clientId !== clientId) {
      return { review: null, error: 'This booking does not belong to you' };
    }

    if (booking.status !== 'completed') {
      return { review: null, error: 'You can only review completed bookings' };
    }

    if (!booking.inspectorId) {
      return { review: null, error: 'No inspector assigned to this booking' };
    }

    // Check if review already exists for this booking
    const [existing] = await db
      .select({ id: inspectorReviews.id })
      .from(inspectorReviews)
      .where(eq(inspectorReviews.bookingId, data.bookingId))
      .limit(1);

    if (existing) {
      return { review: null, error: 'You have already reviewed this booking' };
    }

    // Create review
    let review: any;
    try {
      const inserted = await db
        .insert(inspectorReviews)
        .values({
          inspectorId: booking.inspectorId,
          clientId,
          bookingId:   data.bookingId,
          rating:      data.rating,
          comment:     data.comment || null,
        })
        .returning({
          id:          inspectorReviews.id,
          inspectorId: inspectorReviews.inspectorId,
          clientId:    inspectorReviews.clientId,
          bookingId:   inspectorReviews.bookingId,
          rating:      inspectorReviews.rating,
          comment:     inspectorReviews.comment,
          createdAt:   inspectorReviews.createdAt,
        });
      review = inserted[0];
      if (!review) throw new Error('insert returned no row');
    } catch (err: any) {
      logger.error({ err, bookingId: data.bookingId, clientId }, 'ReviewService.create failed');
      // Unique constraint violation
      if (err?.code === '23505') {
        return { review: null, error: 'You have already reviewed this booking' };
      }
      return { review: null, error: 'Failed to submit review' };
    }

    // Update inspector average rating
    await this.updateInspectorRating(booking.inspectorId);

    return {
      review: {
        id: review.id,
        inspectorId: review.inspectorId,
        clientId: review.clientId,
        bookingId: review.bookingId,
        rating: review.rating,
        comment: review.comment,
        createdAt: toIso(review.createdAt) ?? '',
      } as Review,
      error: null,
    };
  }

  /**
   * Get reviews for an inspector (public)
   */
  static async listByInspector(inspectorId: string, page = 1, limit = 10) {
    const offset = (page - 1) * limit;

    try {
      const [rows, totalRow] = await Promise.all([
        db
          .select({
            id:          inspectorReviews.id,
            inspectorId: inspectorReviews.inspectorId,
            clientId:    inspectorReviews.clientId,
            bookingId:   inspectorReviews.bookingId,
            rating:      inspectorReviews.rating,
            comment:     inspectorReviews.comment,
            createdAt:   inspectorReviews.createdAt,
            clientFullName: users.fullName,
            propertyAddress: bookings.propertyAddress,
          })
          .from(inspectorReviews)
          .leftJoin(users, eq(users.id, inspectorReviews.clientId))
          .leftJoin(bookings, eq(bookings.id, inspectorReviews.bookingId))
          .where(eq(inspectorReviews.inspectorId, inspectorId))
          .orderBy(desc(inspectorReviews.createdAt))
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(inspectorReviews)
          .where(eq(inspectorReviews.inspectorId, inspectorId)),
      ]);

      const reviews: Review[] = rows.map((r) => ({
        id: r.id,
        inspectorId: r.inspectorId,
        clientId: r.clientId,
        bookingId: r.bookingId ?? '',
        rating: r.rating,
        comment: r.comment,
        createdAt: toIso(r.createdAt) ?? '',
        clientName: r.clientFullName || 'Anonymous',
        propertyAddress: r.propertyAddress ?? null,
      }));

      return { reviews, total: totalRow[0]?.count ?? 0, page, limit };
    } catch (err) {
      logger.error({ err, inspectorId }, 'ReviewService.listByInspector failed');
      return { reviews: [], total: 0, page, limit };
    }
  }

  /**
   * Check if a client has already reviewed a specific booking
   */
  static async hasReviewed(clientId: string, bookingId: string) {
    try {
      const [row] = await db
        .select({ id: inspectorReviews.id })
        .from(inspectorReviews)
        .where(and(
          eq(inspectorReviews.clientId, clientId),
          eq(inspectorReviews.bookingId, bookingId),
        ))
        .limit(1);

      return { hasReviewed: !!row };
    } catch {
      return { hasReviewed: false };
    }
  }

  /**
   * Recalculate and update inspector's average rating
   */
  private static async updateInspectorRating(inspectorId: string) {
    let ratings: Array<{ rating: number }> = [];
    try {
      ratings = await db
        .select({ rating: inspectorReviews.rating })
        .from(inspectorReviews)
        .where(eq(inspectorReviews.inspectorId, inspectorId));
    } catch (err) {
      logger.error({ err, inspectorId }, 'ReviewService.updateInspectorRating: ratings fetch failed');
      return;
    }

    if (ratings.length === 0) return;

    const avg = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
    const rounded = Math.round(avg * 100) / 100;

    try {
      await db
        .update(inspectorProfiles)
        .set({ rating: String(rounded) as any })
        .where(eq(inspectorProfiles.userId, inspectorId));
    } catch (err) {
      logger.error({ err, inspectorId }, 'ReviewService.updateInspectorRating: profile update failed');
    }
  }
}
