import type { FastifyInstance } from 'fastify';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  inspectionTypes,
  masterSections,
  masterConditions,
  inspectionTypeConditions,
  limitationLibrary,
} from '../db/schema.js';

function shapeCondition(c: any, s: any) {
  return {
    id:             c.id,
    slug:           c.slug,
    name:           c.name,
    description:    c.description,
    display_order:  c.displayOrder,
    severity:       c.severity,
    risk_statement: c.riskStatement,
    recommendation: c.recommendation,
    photo_required: c.photoRequired,
    keywords:       c.keywords,
    subsection:     c.subsection ?? null,
    is_active:      c.isActive ?? true,
    section: s
      ? {
          id:            s.id,
          slug:          s.slug,
          name:          s.name,
          display_order: s.displayOrder,
        }
      : null,
  };
}

export default async function libraryRoutes(fastify: FastifyInstance) {
  // GET /api/v1/sections — the master section list.
  //
  // POST /condition-library requires a sectionId (master_conditions.section_id
  // is NOT NULL), so the admin create form has to offer a real choice. Deriving
  // the list from conditions already in the library would silently hide any
  // section that has none yet — exactly the sections a new condition most needs.
  // Optional ?showInactive=true includes inactive sections (admin only).
  fastify.get<{ Querystring: { showInactive?: string } }>(
    '/sections',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const includeInactive =
        request.query.showInactive === 'true' && (request as any).user?.role === 'admin';

      try {
        const rows = await db
          .select({
            id:           masterSections.id,
            slug:         masterSections.slug,
            name:         masterSections.name,
            displayOrder: masterSections.displayOrder,
            isActive:     masterSections.isActive,
          })
          .from(masterSections)
          .where(includeInactive ? undefined : eq(masterSections.isActive, true))
          .orderBy(asc(masterSections.displayOrder));

        return {
          data: {
            sections: rows.map(s => ({
              id:            s.id,
              slug:          s.slug,
              name:          s.name,
              display_order: s.displayOrder,
              is_active:     s.isActive ?? true,
            })),
          },
          error: null,
        };
      } catch (err) {
        request.log.error({ err }, 'GET /sections failed');
        return reply.status(500).send({
          data: null,
          error: { code: 'QUERY_FAILED', message: 'Failed to load sections' },
        });
      }
    },
  );

  // GET /api/v1/condition-library
  // Returns master_conditions with section info.
  // Optional ?typeSlug= filters to only conditions for that inspection type.
  // Optional ?showInactive=true returns all conditions including inactive (admin only).
  fastify.get<{ Querystring: { typeSlug?: string; showInactive?: string } }>(
    '/condition-library',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { typeSlug, showInactive } = request.query;
      const includeInactive = showInactive === 'true' && (request as any).user?.role === 'admin';

      if (typeSlug) {
        // Find inspection type by slug
        const [inspType] = await db
          .select({ id: inspectionTypes.id })
          .from(inspectionTypes)
          .where(and(eq(inspectionTypes.slug, typeSlug), eq(inspectionTypes.isActive, true)))
          .limit(1);

        if (!inspType) {
          return reply.status(404).send({ data: null, error: { code: 'NOT_FOUND', message: 'Inspection type not found' } });
        }

        try {
          const rows = await db
            .select({
              c_id:             masterConditions.id,
              c_slug:           masterConditions.slug,
              c_name:           masterConditions.name,
              c_description:    masterConditions.description,
              c_displayOrder:   masterConditions.displayOrder,
              c_severity:       masterConditions.severity,
              c_riskStatement:  masterConditions.riskStatement,
              c_recommendation: masterConditions.recommendation,
              c_photoRequired:  masterConditions.photoRequired,
              c_keywords:       masterConditions.keywords,
              c_isActive:       masterConditions.isActive,
              c_subsection:     masterConditions.subsection,
              s_id:             masterSections.id,
              s_slug:           masterSections.slug,
              s_name:           masterSections.name,
              s_displayOrder:   masterSections.displayOrder,
            })
            .from(inspectionTypeConditions)
            .innerJoin(masterConditions, and(
              eq(masterConditions.id, inspectionTypeConditions.conditionId),
              includeInactive ? undefined : eq(masterConditions.isActive, true),
            ))
            .innerJoin(masterSections, and(
              eq(masterSections.id, masterConditions.sectionId),
              includeInactive ? undefined : eq(masterSections.isActive, true),
            ))
            .where(eq(inspectionTypeConditions.inspectionTypeId, inspType.id));

          const conditions = rows
            .map(r =>
              shapeCondition(
                {
                  id:             r.c_id,
                  slug:           r.c_slug,
                  name:           r.c_name,
                  description:    r.c_description,
                  displayOrder:   r.c_displayOrder,
                  severity:       r.c_severity,
                  riskStatement:  r.c_riskStatement,
                  recommendation: r.c_recommendation,
                  photoRequired:  r.c_photoRequired,
                  keywords:       r.c_keywords,
                  isActive:       r.c_isActive,
                  subsection:     r.c_subsection,
                },
                r.s_id
                  ? { id: r.s_id, slug: r.s_slug, name: r.s_name, displayOrder: r.s_displayOrder }
                  : null,
              ),
            )
            .sort((a: any, b: any) => (a.display_order ?? 0) - (b.display_order ?? 0));

          return { data: { conditions }, error: null };
        } catch (err: any) {
          return reply.status(500).send({ data: null, error: { code: 'QUERY_FAILED', message: 'Failed to load condition library' } });
        }
      }

      // No typeSlug — return conditions (all or active-only depending on includeInactive)
      try {
        const rows = await db
          .select({
            c_id:             masterConditions.id,
            c_slug:           masterConditions.slug,
            c_name:           masterConditions.name,
            c_description:    masterConditions.description,
            c_displayOrder:   masterConditions.displayOrder,
            c_severity:       masterConditions.severity,
            c_riskStatement:  masterConditions.riskStatement,
            c_recommendation: masterConditions.recommendation,
            c_photoRequired:  masterConditions.photoRequired,
            c_keywords:       masterConditions.keywords,
            c_isActive:       masterConditions.isActive,
            c_subsection:     masterConditions.subsection,
            s_id:             masterSections.id,
            s_slug:           masterSections.slug,
            s_name:           masterSections.name,
            s_displayOrder:   masterSections.displayOrder,
          })
          .from(masterConditions)
          .leftJoin(masterSections, eq(masterSections.id, masterConditions.sectionId))
          .where(includeInactive ? undefined : eq(masterConditions.isActive, true))
          .orderBy(asc(masterConditions.displayOrder));

        const conditions = rows.map(r =>
          shapeCondition(
            {
              id:             r.c_id,
              slug:           r.c_slug,
              name:           r.c_name,
              description:    r.c_description,
              displayOrder:   r.c_displayOrder,
              severity:       r.c_severity,
              riskStatement:  r.c_riskStatement,
              recommendation: r.c_recommendation,
              photoRequired:  r.c_photoRequired,
              keywords:       r.c_keywords,
              isActive:       r.c_isActive,
              subsection:     r.c_subsection,
            },
            r.s_id
              ? { id: r.s_id, slug: r.s_slug, name: r.s_name, displayOrder: r.s_displayOrder }
              : null,
          ),
        );

        return { data: { conditions }, error: null };
      } catch (err: any) {
        return reply.status(500).send({ data: null, error: { code: 'QUERY_FAILED', message: 'Failed to load condition library' } });
      }
    },
  );

  // POST /api/v1/condition-library [admin] — create a new master condition
  fastify.post<{
    Body: {
      sectionId?: string;
      slug: string;
      name: string;
      description?: string;
      severity?: string;
      risk_statement?: string;
      recommendation?: string;
      photo_required?: boolean;
      keywords?: string[];
    };
  }>(
    '/condition-library',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const { sectionId, slug, name, description, severity, risk_statement, recommendation, photo_required, keywords } = request.body;
      if (!slug || !name || !sectionId) {
        return reply.status(400).send({ data: null, error: { code: 'MISSING_FIELDS', message: 'slug, name, and sectionId are required' } });
      }

      // Check slug uniqueness
      const [existing] = await db
        .select({ id: masterConditions.id })
        .from(masterConditions)
        .where(eq(masterConditions.slug, slug))
        .limit(1);

      if (existing) {
        return reply.status(409).send({ data: null, error: { code: 'SLUG_EXISTS', message: 'A condition with this slug already exists' } });
      }

      try {
        const [data] = await db
          .insert(masterConditions)
          .values({
            sectionId,
            slug,
            name,
            description: description || null,
            severity: (severity as any) || null,
            riskStatement: risk_statement || null,
            recommendation: recommendation || null,
            photoRequired: photo_required ?? false,
            keywords: keywords || [],
            isActive: true,
          })
          .returning();

        if (!data) throw new Error('Insert returned no row');

        const [section] = sectionId
          ? await db.select({ id: masterSections.id, slug: masterSections.slug, name: masterSections.name, displayOrder: masterSections.displayOrder }).from(masterSections).where(eq(masterSections.id, sectionId)).limit(1)
          : [];

        return reply.status(201).send({
          data: { condition: shapeCondition({ ...data, isActive: data.isActive, displayOrder: data.displayOrder, riskStatement: data.riskStatement, recommendation: data.recommendation, photoRequired: data.photoRequired }, section || null) },
          error: null,
        });
      } catch (err: any) {
        const isDup = String(err?.message).includes('duplicate') || err?.code === '23505';
        return reply.status(isDup ? 409 : 500).send({ data: null, error: { code: isDup ? 'SLUG_EXISTS' : 'CREATE_FAILED', message: isDup ? 'A condition with this slug already exists' : err?.message || 'Create failed' } });
      }
    },
  );

  // GET /api/v1/limitation-library
  fastify.get<{ Querystring: { showInactive?: string } }>(
    '/limitation-library',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const includeInactive = request.query.showInactive === 'true' && (request as any).user?.role === 'admin';
      try {
        const rows = await db
          .select({
            id:           limitationLibrary.id,
            code:         limitationLibrary.code,
            text:         limitationLibrary.text,
            displayOrder: limitationLibrary.displayOrder,
            isActive:     limitationLibrary.isActive,
          })
          .from(limitationLibrary)
          .where(includeInactive ? undefined : eq(limitationLibrary.isActive, true))
          .orderBy(asc(limitationLibrary.displayOrder));

        const limitations = rows.map(r => ({
          id:            r.id,
          code:          r.code,
          text:          r.text,
          display_order: r.displayOrder,
          is_active:     r.isActive,
        }));

        return { data: { limitations }, error: null };
      } catch (err: any) {
        return reply.status(500).send({ data: null, error: { code: 'QUERY_FAILED', message: 'Failed to load limitation library' } });
      }
    },
  );

  // ─── Admin write endpoints ────────────────────────────────────────────────

  // PATCH /api/v1/condition-library/:id [admin]
  fastify.patch<{
    Params: { id: string };
    Body: {
      name?: string;
      description?: string;
      severity?: string;
      risk_statement?: string;
      recommendation?: string;
      keywords?: string[];
      photo_required?: boolean;
      is_active?: boolean;
    };
  }>(
    '/condition-library/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const updates: Record<string, any> = {};
      const b = request.body;
      if (b.name !== undefined)           updates.name = b.name;
      if (b.description !== undefined)    updates.description = b.description;
      if (b.severity !== undefined)       updates.severity = b.severity;
      if (b.risk_statement !== undefined) updates.riskStatement = b.risk_statement;
      if (b.recommendation !== undefined) updates.recommendation = b.recommendation;
      if (b.keywords !== undefined)       updates.keywords = b.keywords;
      if (b.photo_required !== undefined) updates.photoRequired = b.photo_required;
      if (b.is_active !== undefined)      updates.isActive = b.is_active;

      try {
        const [data] = await db
          .update(masterConditions)
          .set(updates)
          .where(eq(masterConditions.id, request.params.id))
          .returning();

        if (!data) {
          return reply.status(404).send({ data: null, error: { code: 'NOT_FOUND', message: 'Condition not found' } });
        }

        return {
          data: {
            condition: {
              id:                data.id,
              section_id:        data.sectionId,
              slug:              data.slug,
              name:              data.name,
              description:       data.description,
              ai_default_severity: data.aiDefaultSeverity,
              display_order:     data.displayOrder,
              is_active:         data.isActive,
              created_at:        data.createdAt instanceof Date ? data.createdAt.toISOString() : data.createdAt,
              severity:          data.severity,
              risk_statement:    data.riskStatement,
              recommendation:    data.recommendation,
              photo_required:    data.photoRequired,
              keywords:          data.keywords,
            },
          },
          error: null,
        };
      } catch (err: any) {
        return reply.status(500).send({ data: null, error: { code: 'UPDATE_FAILED', message: err?.message || 'Update failed' } });
      }
    },
  );

  // POST /api/v1/limitation-library [admin]
  fastify.post<{ Body: { code: string; text: string; display_order?: number } }>(
    '/limitation-library',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const { code, text, display_order = 0 } = request.body;
      try {
        const [data] = await db
          .insert(limitationLibrary)
          .values({ code, text, displayOrder: display_order })
          .returning();

        if (!data) {
          return reply.status(500).send({ data: null, error: { code: 'CREATE_FAILED', message: 'Insert returned no row' } });
        }

        return reply.status(201).send({
          data: {
            limitation: {
              id:            data.id,
              code:          data.code,
              text:          data.text,
              display_order: data.displayOrder,
              is_active:     data.isActive,
              created_at:    data.createdAt instanceof Date ? data.createdAt.toISOString() : data.createdAt,
            },
          },
          error: null,
        });
      } catch (err: any) {
        const msg = String(err?.message || '').toLowerCase().includes('duplicate') || err?.code === '23505'
          ? 'Code already exists'
          : err?.message || 'Insert failed';
        return reply.status(400).send({ data: null, error: { code: 'CREATE_FAILED', message: msg } });
      }
    },
  );

  // PATCH /api/v1/limitation-library/:id [admin]
  fastify.patch<{
    Params: { id: string };
    Body: { text?: string; display_order?: number; is_active?: boolean };
  }>(
    '/limitation-library/:id',
    { preHandler: [fastify.authenticate, fastify.requireRole('admin')] },
    async (request, reply) => {
      const updates: Record<string, any> = {};
      const b = request.body;
      if (b.text !== undefined)          updates.text = b.text;
      if (b.display_order !== undefined) updates.displayOrder = b.display_order;
      if (b.is_active !== undefined)     updates.isActive = b.is_active;

      try {
        const [data] = await db
          .update(limitationLibrary)
          .set(updates)
          .where(eq(limitationLibrary.id, request.params.id))
          .returning();

        if (!data) {
          return reply.status(404).send({ data: null, error: { code: 'NOT_FOUND', message: 'Limitation not found' } });
        }

        return {
          data: {
            limitation: {
              id:            data.id,
              code:          data.code,
              text:          data.text,
              display_order: data.displayOrder,
              is_active:     data.isActive,
              created_at:    data.createdAt instanceof Date ? data.createdAt.toISOString() : data.createdAt,
            },
          },
          error: null,
        };
      } catch (err: any) {
        return reply.status(500).send({ data: null, error: { code: 'UPDATE_FAILED', message: err?.message || 'Update failed' } });
      }
    },
  );
}
