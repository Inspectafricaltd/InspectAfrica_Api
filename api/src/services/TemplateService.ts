import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  inspectionTypeConditions,
  inspectionTypes,
  masterConditions,
  masterSections,
} from '../db/schema.js';
import { logger } from '../lib/logger.js';

/**
 * TemplateService — reads master inspection templates from the database.
 * Replaces the hardcoded INSPECTION_TEMPLATE array.
 */
export class TemplateService {
  /**
   * List all active inspection types
   */
  static async getInspectionTypes() {
    try {
      const rows = await db
        .select({
          id:           inspectionTypes.id,
          slug:         inspectionTypes.slug,
          name:         inspectionTypes.name,
          description:  inspectionTypes.description,
          display_order: inspectionTypes.displayOrder,
        })
        .from(inspectionTypes)
        .where(eq(inspectionTypes.isActive, true))
        .orderBy(asc(inspectionTypes.displayOrder));

      return { types: rows, error: null };
    } catch (err) {
      logger.error({ err }, 'TemplateService.getInspectionTypes failed');
      return { types: [], error: 'Failed to load inspection types' };
    }
  }

  /**
   * Get the full template for an inspection type:
   * sections → conditions, filtered by the junction table.
   */
  static async getTemplate(typeSlug: string) {
    // 1. Resolve the inspection type
    const [inspType] = await db
      .select({
        id:          inspectionTypes.id,
        slug:        inspectionTypes.slug,
        name:        inspectionTypes.name,
        description: inspectionTypes.description,
      })
      .from(inspectionTypes)
      .where(and(
        eq(inspectionTypes.slug, typeSlug),
        eq(inspectionTypes.isActive, true),
      ))
      .limit(1);

    if (!inspType) {
      return { template: null, error: 'Inspection type not found' };
    }

    // 2. Get all conditions tagged for this type, joined with their section
    let tagged: Array<{
      isRequired: boolean | null;
      condId:     string;
      condSlug:   string;
      condName:   string;
      condDescription: string | null;
      condDisplayOrder: number;
      sectionId:  string | null;
      sectionSlug: string | null;
      sectionName: string | null;
      sectionDisplayOrder: number | null;
    }>;
    try {
      tagged = await db
        .select({
          isRequired:           inspectionTypeConditions.isRequired,
          condId:               masterConditions.id,
          condSlug:             masterConditions.slug,
          condName:             masterConditions.name,
          condDescription:      masterConditions.description,
          condDisplayOrder:     masterConditions.displayOrder,
          sectionId:            masterSections.id,
          sectionSlug:          masterSections.slug,
          sectionName:          masterSections.name,
          sectionDisplayOrder:  masterSections.displayOrder,
        })
        .from(inspectionTypeConditions)
        .innerJoin(masterConditions, and(
          eq(masterConditions.id, inspectionTypeConditions.conditionId),
          eq(masterConditions.isActive, true),
        ))
        .innerJoin(masterSections, and(
          eq(masterSections.id, masterConditions.sectionId),
          eq(masterSections.isActive, true),
        ))
        .where(eq(inspectionTypeConditions.inspectionTypeId, inspType.id));
    } catch (err) {
      logger.error({ err, typeSlug }, 'TemplateService.getTemplate: failed to load conditions');
      return { template: null, error: 'Failed to load template conditions' };
    }

    // 3. Group conditions by section, respecting display_order
    const sectionMap = new Map<string, {
      id: string;
      slug: string;
      name: string;
      display_order: number;
      conditions: { id: string; slug: string; name: string; description: string | null; display_order: number; is_required: boolean }[];
    }>();

    for (const row of tagged) {
      if (!row.sectionId || !row.sectionSlug || !row.sectionName) continue;

      if (!sectionMap.has(row.sectionId)) {
        sectionMap.set(row.sectionId, {
          id: row.sectionId,
          slug: row.sectionSlug,
          name: row.sectionName,
          display_order: row.sectionDisplayOrder ?? 0,
          conditions: [],
        });
      }

      sectionMap.get(row.sectionId)!.conditions.push({
        id: row.condId,
        slug: row.condSlug,
        name: row.condName,
        description: row.condDescription,
        display_order: row.condDisplayOrder,
        is_required: row.isRequired ?? true,
      });
    }

    // Sort sections by display_order, then conditions within each section
    const sections = Array.from(sectionMap.values())
      .sort((a, b) => a.display_order - b.display_order)
      .map(sec => ({
        ...sec,
        conditions: sec.conditions.sort((a, b) => a.display_order - b.display_order),
      }));

    return {
      template: {
        type: inspType,
        sections,
      },
      error: null,
    };
  }

  /**
   * Admin: create a new inspection type (template)
   */
  static async createType(data: {
    slug: string;
    name: string;
    description?: string;
    displayOrder?: number;
  }) {
    try {
      const inserted = await db
        .insert(inspectionTypes)
        .values({
          slug:         data.slug,
          name:         data.name,
          description:  data.description ?? null,
          displayOrder: data.displayOrder ?? 0,
          isActive:     true,
        })
        .returning({
          id:           inspectionTypes.id,
          slug:         inspectionTypes.slug,
          name:         inspectionTypes.name,
          description:  inspectionTypes.description,
          display_order: inspectionTypes.displayOrder,
        });
      const type = inserted[0];
      if (!type) throw new Error('insert returned no row');
      return { type, error: null };
    } catch (err: any) {
      logger.error({ err }, 'TemplateService.createType failed');
      const isDup = err?.code === '23505' || String(err?.message).includes('duplicate');
      return { type: null, error: isDup ? 'A template with this slug already exists' : 'Failed to create template' };
    }
  }

  /**
   * Admin: update inspection type metadata
   */
  static async updateType(slug: string, data: {
    name?: string;
    description?: string;
    displayOrder?: number;
    isActive?: boolean;
  }) {
    const updates: Record<string, any> = { updatedAt: new Date() };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.displayOrder !== undefined) updates.displayOrder = data.displayOrder;
    if (data.isActive !== undefined) updates.isActive = data.isActive;

    try {
      const updated = await db
        .update(inspectionTypes)
        .set(updates)
        .where(eq(inspectionTypes.slug, slug))
        .returning({
          id:           inspectionTypes.id,
          slug:         inspectionTypes.slug,
          name:         inspectionTypes.name,
          description:  inspectionTypes.description,
          display_order: inspectionTypes.displayOrder,
          is_active:    inspectionTypes.isActive,
        });
      const type = updated[0];
      if (!type) return { type: null, error: 'Template not found' };
      return { type, error: null };
    } catch (err) {
      logger.error({ err, slug }, 'TemplateService.updateType failed');
      return { type: null, error: 'Failed to update template' };
    }
  }

  /**
   * Admin: add a new master condition
   */
  static async addCondition(data: {
    sectionSlug: string;
    slug: string;
    name: string;
    description?: string;
    displayOrder?: number;
  }) {
    // Resolve section
    const [section] = await db
      .select({ id: masterSections.id })
      .from(masterSections)
      .where(eq(masterSections.slug, data.sectionSlug))
      .limit(1);

    if (!section) {
      return { condition: null, error: 'Section not found' };
    }

    try {
      const inserted = await db
        .insert(masterConditions)
        .values({
          sectionId:    section.id,
          slug:         data.slug,
          name:         data.name,
          description:  data.description ?? null,
          displayOrder: data.displayOrder ?? 0,
          // severity is required (NOT NULL) — default to 'monitor' for new master entries
          severity:     'monitor',
        })
        .returning({
          id:           masterConditions.id,
          slug:         masterConditions.slug,
          name:         masterConditions.name,
          description:  masterConditions.description,
          display_order: masterConditions.displayOrder,
        });
      const condition = inserted[0];
      if (!condition) throw new Error('insert returned no row');
      return { condition, error: null };
    } catch (err: any) {
      logger.error({ err }, 'TemplateService.addCondition failed');
      const msg = String(err?.message ?? '');
      const isDuplicate = err?.code === '23505' || msg.includes('duplicate');
      return {
        condition: null,
        error: isDuplicate ? 'Condition slug already exists' : 'Failed to add condition',
      };
    }
  }

  /**
   * Admin: update a master condition
   */
  static async updateCondition(conditionId: string, data: {
    name?: string;
    description?: string;
    displayOrder?: number;
    isActive?: boolean;
  }) {
    const updates: Record<string, any> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.displayOrder !== undefined) updates.displayOrder = data.displayOrder;
    if (data.isActive !== undefined) updates.isActive = data.isActive;

    try {
      const updated = await db
        .update(masterConditions)
        .set(updates)
        .where(eq(masterConditions.id, conditionId))
        .returning({
          id:           masterConditions.id,
          slug:         masterConditions.slug,
          name:         masterConditions.name,
          description:  masterConditions.description,
          display_order: masterConditions.displayOrder,
          is_active:    masterConditions.isActive,
        });
      const condition = updated[0];
      if (!condition) throw new Error('update returned no row');
      return { condition, error: null };
    } catch (err) {
      logger.error({ err, conditionId }, 'TemplateService.updateCondition failed');
      return { condition: null, error: 'Failed to update condition' };
    }
  }

  /**
   * Admin: tag/untag a condition for an inspection type
   */
  static async tagCondition(conditionId: string, typeSlug: string, action: 'add' | 'remove') {
    const [inspType] = await db
      .select({ id: inspectionTypes.id })
      .from(inspectionTypes)
      .where(eq(inspectionTypes.slug, typeSlug))
      .limit(1);

    if (!inspType) {
      return { error: 'Inspection type not found' };
    }

    if (action === 'add') {
      try {
        await db
          .insert(inspectionTypeConditions)
          .values({
            inspectionTypeId: inspType.id,
            conditionId,
            isRequired: true,
          })
          .onConflictDoUpdate({
            target: [inspectionTypeConditions.inspectionTypeId, inspectionTypeConditions.conditionId],
            set: { isRequired: true },
          });
      } catch (err) {
        logger.error({ err }, 'TemplateService.tagCondition (add) failed');
        return { error: 'Failed to tag condition' };
      }
    } else {
      try {
        await db
          .delete(inspectionTypeConditions)
          .where(and(
            eq(inspectionTypeConditions.inspectionTypeId, inspType.id),
            eq(inspectionTypeConditions.conditionId, conditionId),
          ));
      } catch (err) {
        logger.error({ err }, 'TemplateService.tagCondition (remove) failed');
        return { error: 'Failed to untag condition' };
      }
    }

    return { error: null };
  }

  /**
   * Admin: deactivate (soft-delete) a master condition
   */
  static async deactivateCondition(conditionId: string) {
    return this.updateCondition(conditionId, { isActive: false });
  }
}
