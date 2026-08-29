import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Auth schemas
const loginSchemaZod = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

const registerClientSchemaZod = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Full name is required'),
  phone: z.string().optional(),
  countryOfResidence: z.string().optional(),
  diasporaFlag: z.enum(['diaspora', 'local', 'not_specified']).optional(),
});

const refreshTokenSchemaZod = z.object({
  refreshToken: z.string(),
});

// Booking schemas
const bookingCreateSchemaZod = z.object({
  propertyAddress: z.string().min(5, 'Property address is required'),
  propertyCity: z.string().min(2, 'Property city is required'),
  propertyType: z.enum(['residential', 'commercial', 'land']),
  inspectionType: z.enum(['shi', 'mic', 'cib', 'fsi', 'pcc', 'hhc']),
  requestedDate: z.string().min(1, 'Requested date is required'),
  requestedTime: z.string().optional(),
  notesToInspector: z.string().optional(),
  state: z.string().optional(),
  lga: z.string().optional(),
});

const createBookingSchemaZod = z.object({
  inspectorId: z.string().uuid(),
  propertyId: z.string().uuid().optional(),
  property: z.object({
    address: z.string().min(5),
    city: z.string().min(2),
    country: z.string().min(2),
    propertyType: z.enum(['residential', 'commercial', 'industrial', 'land']),
    bedrooms: z.number().int().min(0).optional(),
    bathrooms: z.number().int().min(0).optional(),
    buildingAge: z.number().int().min(0).optional(),
    sizeSqM: z.number().positive().optional(),
    notes: z.string().optional(),
  }),
  scheduledDate: z.string().datetime(),
  inspectionType: z.enum(['shi', 'mic', 'cib', 'fsi', 'pcc', 'hhc']),
  notes: z.string().optional(),
});

// Solo inspection schemas
//
// Fastify's default Ajv config strips (removeAdditional: true) any request
// body field not declared here before the route handler ever sees it —
// silently, not a validation error. This schema never declared the
// INSPECTAFRICA STANDARD™ metadata fields, so buildingType/occupancyStatus/
// inAttendance/inspectionConstraints/otherBuildingType/otherInAttendance/
// otherConstraints were dropped on every solo inspection ever created
// (confirmed: every is_solo row back to May has them all null) even though
// the inspector filled the form, NewSoloInspection.tsx sent them, and
// InspectionService.createSolo() was always ready to persist them. The
// booking-linked POST /inspections route never had this bug — it has no
// `schema` option at all, so nothing there was ever stripped.
const soloInspectionCreateSchemaZod = z.object({
  propertyAddress: z.string().min(5, 'Property address is required'),
  propertyType: z.enum(['residential', 'commercial', 'land']),
  inspectionType: z.enum(['shi', 'mic', 'cib', 'fsi', 'pcc', 'hhc']),
  state: z.string().min(2, 'State is required'),
  lga: z.string().min(2, 'LGA is required'),
  country: z.string().optional(),
  notes: z.string().optional(),
  // Optional client-minted UUID (offline queue replay).
  clientId: z.string().uuid().optional(),
  buildingType: z.string().optional(),
  occupancyStatus: z.string().optional(),
  inAttendance: z.array(z.string()).optional(),
  inspectionConstraints: z.array(z.string()).optional(),
  otherBuildingType: z.string().optional(),
  otherInAttendance: z.string().optional(),
  otherConstraints: z.string().optional(),
});

// Condition schemas
// Severity uses the ACHI vocabulary — the same enum as the
// inspection_conditions.severity column and every reader (report generation,
// summaries). Do not reintroduce the legacy {pass, major, moderate, critical}
// scale here: values outside this enum are never counted in report verdicts.
const updateConditionSchemaZod = z.object({
  severity: z.enum(['acceptable', 'monitor', 'repair_required', 'unsafe']),
  notes: z.string().optional(),
});

// Observation schemas
const createObservationSchemaZod = z.object({
  conditionId: z.string().uuid(),
  text: z.string().min(1, 'Observation cannot be empty'),
});

// Photo schemas
const signUploadSchemaZod = z.object({
  conditionId: z.string().uuid().optional(),
  observationId: z.string().uuid().optional(),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  fileSizeBytes: z.number().int().positive().max(10 * 1024 * 1024), // 10MB max
  // Optional client-minted UUID for the new photo row (offline queue replay).
  clientId: z.string().uuid().optional(),
}).refine(
  (v) => Boolean(v.conditionId) !== Boolean(v.observationId),
  { message: 'Provide exactly one of conditionId or observationId' }
);

const confirmUploadSchemaZod = z.object({
  thumbPath: z.string().optional(),
  width: z.number().int().min(0),
  height: z.number().int().min(0),
});

// Normalized (0..1) image-space coordinates so shapes survive display resize.
// Two primitives only — the UI never needs more for "point at the defect".
const annotationShapeSchemaZod = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('arrow'),
    color: z.string().optional(),
    points: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
  z.object({
    type: z.literal('circle'),
    color: z.string().optional(),
    x: z.number(),
    y: z.number(),
    radius: z.number().nonnegative(),
  }),
]);
const annotatePhotoSchemaZod = z.object({
  shapes: z.array(annotationShapeSchemaZod),
});

// Admin schemas
const suspendInspectorSchemaZod = z.object({
  reason: z.string().min(10, 'Reason is required'),
});

const flagInspectionSchemaZod = z.object({
  reason: z.string().min(10, 'Reason is required'),
});

// Pagination schema
const paginationSchemaZod = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// Convert to JSON Schema for Fastify validation
export const loginSchema = zodToJsonSchema(loginSchemaZod);
export const registerClientSchema = zodToJsonSchema(registerClientSchemaZod);
export const refreshTokenSchema = zodToJsonSchema(refreshTokenSchemaZod);
export const bookingCreateSchema = zodToJsonSchema(bookingCreateSchemaZod);
export const createBookingSchema = zodToJsonSchema(createBookingSchemaZod);
export const updateConditionSchema = zodToJsonSchema(updateConditionSchemaZod);
export const createObservationSchema = zodToJsonSchema(createObservationSchemaZod);
export const signUploadSchema = zodToJsonSchema(signUploadSchemaZod);
export const confirmUploadSchema = zodToJsonSchema(confirmUploadSchemaZod);
export const annotatePhotoSchema = zodToJsonSchema(annotatePhotoSchemaZod);
export const suspendInspectorSchema = zodToJsonSchema(suspendInspectorSchemaZod);
export const flagInspectionSchema = zodToJsonSchema(flagInspectionSchemaZod);
export const soloInspectionCreateSchema = zodToJsonSchema(soloInspectionCreateSchemaZod);
export const paginationSchema = zodToJsonSchema(paginationSchemaZod);

// Type exports (from Zod schemas)
export type LoginInput = z.infer<typeof loginSchemaZod>;
export type RegisterClientInput = z.infer<typeof registerClientSchemaZod>;
export type CreateBookingInput = z.infer<typeof createBookingSchemaZod>;
export type UpdateConditionInput = z.infer<typeof updateConditionSchemaZod>;
export type CreateObservationInput = z.infer<typeof createObservationSchemaZod>;
export type SignUploadInput = z.infer<typeof signUploadSchemaZod>;
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchemaZod>;
export type AnnotatePhotoInput = z.infer<typeof annotatePhotoSchemaZod>;
export type SoloInspectionCreateInput = z.infer<typeof soloInspectionCreateSchemaZod>;
export type PaginationInput = z.infer<typeof paginationSchemaZod>;
