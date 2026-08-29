import {
  pgTable, uuid, text, integer, bigint, boolean, numeric,
  timestamp, date, time, jsonb, varchar, doublePrecision,
  index, uniqueIndex, primaryKey, check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { relations } from 'drizzle-orm';

// ── Users ─────────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  email:              text('email').notNull().unique(),
  fullName:           text('full_name').notNull(),
  phone:              text('phone').unique(),
  role:               text('role', { enum: ['inspector', 'client', 'admin'] }).notNull(),
  avatarUrl:          text('avatar_url'),
  createdAt:          timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).defaultNow(),
  status:             text('status', { enum: ['active', 'pending', 'suspended', 'invited'] }).notNull().default('active'),
  signatureImagePath: text('signature_image_path'),
  passwordHash:       text('password_hash'),
  tokenVersion:       integer('token_version').notNull().default(0),
}, t => ({
  emailIdx:    uniqueIndex('users_email_idx').on(t.email),
  emailIdx2:   index('idx_users_email').on(t.email),
  roleIdx:     index('idx_users_role').on(t.role),
  statusIdx:   index('idx_users_status').on(t.status),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  inspectorProfile: one(inspectorProfiles, { fields: [users.id], references: [inspectorProfiles.userId] }),
  clientProfile:    one(clientProfiles,    { fields: [users.id], references: [clientProfiles.userId] }),
  refreshTokens:    many(refreshTokens),
}));

// ── Auth tables ──────────────────────────────────────────────────────────────

export const refreshTokens = pgTable('refresh_tokens', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),
}, t => ({
  userIdx:    index('idx_refresh_tokens_user').on(t.userId),
  expiresIdx: index('idx_refresh_tokens_expires').on(t.expiresAt),
}));

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt:    timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  userIdx:    index('idx_prt_user').on(t.userId),
  expiresIdx: index('idx_prt_expires').on(t.expiresAt),
}));

// ── Profiles ──────────────────────────────────────────────────────────────────

export const inspectorProfiles = pgTable('inspector_profiles', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  userId:              uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).unique(),
  achiNumber:          text('achi_number').unique(),
  achiStatus:          text('achi_status', { enum: ['candidate', 'certified', 'suspended', 'expired'] }).default('candidate'),
  achiIssuedAt:        timestamp('achi_issued_at', { withTimezone: true }),
  achiExpiresAt:       timestamp('achi_expires_at', { withTimezone: true }),
  bio:                 text('bio'),
  serviceAreas:        text('service_areas').array(),
  inspectionTypes:     text('inspection_types').array(),
  rating:              numeric('rating', { precision: 3, scale: 2 }).default('0'),
  totalInspections:    integer('total_inspections').default(0),
  isActive:            boolean('is_active').default(true),
  bankName:            text('bank_name'),
  accountNumber:       text('account_number'),
  accountName:         text('account_name'),
  createdAt:           timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).defaultNow(),
  payoutBankName:      text('payout_bank_name'),
  payoutAccountNumber: text('payout_account_number'),
  payoutAccountName:   text('payout_account_name'),
}, t => ({
  achiIdx: index('idx_inspectors_achi').on(t.achiNumber),
}));

export const clientProfiles = pgTable('client_profiles', {
  id:                  uuid('id').primaryKey().defaultRandom(),
  userId:              uuid('user_id').references(() => users.id, { onDelete: 'cascade' }).unique(),
  countryOfResidence:  text('country_of_residence'),
  diasporaFlag:        text('diaspora_flag'),
  createdAt:           timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ── Condition library ─────────────────────────────────────────────────────────

export const inspectionTypes = pgTable('inspection_types', {
  id:           uuid('id').primaryKey().defaultRandom(),
  slug:         text('slug').notNull().unique(),
  name:         text('name').notNull(),
  description:  text('description'),
  isActive:     boolean('is_active').default(true),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const masterSections = pgTable('master_sections', {
  id:           uuid('id').primaryKey().defaultRandom(),
  slug:         text('slug').notNull().unique(),
  name:         text('name').notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  isActive:     boolean('is_active').default(true),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const masterConditions = pgTable('master_conditions', {
  id:                uuid('id').primaryKey().defaultRandom(),
  sectionId:         uuid('section_id').notNull().references(() => masterSections.id, { onDelete: 'restrict' }),
  slug:              text('slug').notNull().unique(),
  name:              text('name').notNull(),
  description:       text('description'),
  aiDefaultSeverity: text('ai_default_severity'),
  displayOrder:      integer('display_order').notNull().default(0),
  isActive:          boolean('is_active').default(true),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow(),
  severity:          text('severity', { enum: ['acceptable', 'monitor', 'repair_required', 'unsafe'] }).notNull(),
  riskStatement:     text('risk_statement'),
  recommendation:    text('recommendation'),
  photoRequired:     boolean('photo_required').notNull().default(false),
  keywords:          text('keywords').array().notNull().default(sql`'{}'::text[]`),
  subsection:        text('subsection'),
}, t => ({
  sectionIdx: index('idx_master_conditions_section').on(t.sectionId),
}));

export const inspectionTypeConditions = pgTable('inspection_type_conditions', {
  id:               uuid('id').primaryKey().defaultRandom(),
  inspectionTypeId: uuid('inspection_type_id').notNull().references(() => inspectionTypes.id, { onDelete: 'cascade' }),
  conditionId:      uuid('condition_id').notNull().references(() => masterConditions.id, { onDelete: 'cascade' }),
  isRequired:       boolean('is_required').default(true),
}, t => ({
  uq:          uniqueIndex('inspection_type_conditions_inspection_type_id_condition_id_key').on(t.inspectionTypeId, t.conditionId),
  typeIdx:     index('idx_itc_type').on(t.inspectionTypeId),
  condIdx:     index('idx_itc_condition').on(t.conditionId),
}));

// ── Limitations ──────────────────────────────────────────────────────────────

export const limitationLibrary = pgTable('limitation_library', {
  id:           uuid('id').primaryKey().defaultRandom(),
  code:         text('code').notNull().unique(),
  text:         text('text').notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  isActive:     boolean('is_active').notNull().default(true),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const inspectionLimitations = pgTable('inspection_limitations', {
  inspectionId: uuid('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
  limitationId: uuid('limitation_id').notNull().references(() => limitationLibrary.id),
}, t => ({
  pk: primaryKey({ columns: [t.inspectionId, t.limitationId] }),
}));

// ── Bookings ──────────────────────────────────────────────────────────────────

export const bookings = pgTable('bookings', {
  id:                       uuid('id').primaryKey().defaultRandom(),
  clientId:                 uuid('client_id').notNull().references(() => users.id),
  inspectorId:              uuid('inspector_id').references(() => users.id),
  propertyAddress:          text('property_address').notNull(),
  propertyCity:             text('property_city').notNull(),
  propertyType:             text('property_type', { enum: ['residential', 'commercial', 'land'] }).notNull(),
  inspectionType:           text('inspection_type', { enum: ['shi', 'mic', 'cib', 'fsi', 'pcc', 'hhc', 'snag', 'lsi'] }).notNull(),
  requestedDate:            date('requested_date').notNull(),
  requestedTime:            time('requested_time'),
  notesToInspector:         text('notes_to_inspector'),
  status:                   text('status').default('pending'),
  declinedReason:           text('declined_reason'),
  acceptedAt:               timestamp('accepted_at', { withTimezone: true }),
  completedAt:              timestamp('completed_at', { withTimezone: true }),
  createdAt:                timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:                timestamp('updated_at', { withTimezone: true }).defaultNow(),
  state:                    text('state'),
  lga:                      text('lga'),
  country:                  text('country'),
  clientPaymentStatus:      text('client_payment_status', { enum: ['unpaid', 'pending', 'paid'] }).default('unpaid'),
  clientPaymentAmount:      numeric('client_payment_amount', { precision: 12, scale: 2 }),
  clientReceiptPath:        text('client_receipt_path'),
  clientReceiptUploadedAt:  timestamp('client_receipt_uploaded_at', { withTimezone: true }),
  clientPaidAt:             timestamp('client_paid_at', { withTimezone: true }),
  clientPaidBy:             uuid('client_paid_by').references(() => users.id),
  clientPaymentNotes:       text('client_payment_notes'),
  inspectorPayoutStatus:    text('inspector_payout_status', { enum: ['unpaid', 'pending', 'paid'] }).default('unpaid'),
  inspectorPayoutAmount:    numeric('inspector_payout_amount', { precision: 12, scale: 2 }),
  inspectorPaidAt:          timestamp('inspector_paid_at', { withTimezone: true }),
  inspectorPaidBy:          uuid('inspector_paid_by').references(() => users.id),
  inspectorPayoutNotes:     text('inspector_payout_notes'),
}, t => ({
  clientIdx:               index('idx_bookings_client').on(t.clientId),
  clientDateIdx:           index('idx_bookings_client_date').on(t.clientId, t.requestedDate),
  clientPayStatusIdx:      index('idx_bookings_client_payment_status').on(t.clientPaymentStatus),
  dateIdx:                 index('idx_bookings_date').on(t.requestedDate),
  inspectorIdx:            index('idx_bookings_inspector').on(t.inspectorId),
  inspectorPayoutIdx:      index('idx_bookings_inspector_payout_status').on(t.inspectorPayoutStatus),
  inspectorStatusIdx:      index('idx_bookings_inspector_status').on(t.inspectorId, t.status),
  statusIdx:               index('idx_bookings_status').on(t.status),
  // The real guard against duplicate bookings. BookingService.create also
  // checks before inserting, but that is a read-then-write race: concurrent
  // submits all read before any of them commits. Only the database can settle
  // it. Scoped to live statuses so a client can rebook after cancelling.
  activeDuplicateUq:       uniqueIndex('bookings_active_client_property_date_unique')
                             .on(t.clientId, t.propertyAddress, t.requestedDate)
                             .where(sql`${t.status} IN ('open', 'confirmed', 'in_progress')`),
}));

export const bookingDeclines = pgTable('booking_declines', {
  id:          uuid('id').primaryKey().defaultRandom(),
  bookingId:   uuid('booking_id').notNull().references(() => bookings.id, { onDelete: 'cascade' }),
  inspectorId: uuid('inspector_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  declinedAt:  timestamp('declined_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  uq:          uniqueIndex('booking_declines_unique').on(t.bookingId, t.inspectorId),
  bookingIdx:  index('idx_booking_declines_booking_id').on(t.bookingId),
  inspectorIdx: index('idx_booking_declines_inspector_id').on(t.inspectorId),
}));

// ── Inspections ───────────────────────────────────────────────────────────────

export const inspections = pgTable('inspections', {
  id:                      uuid('id').primaryKey().defaultRandom(),
  bookingId:               uuid('booking_id').references(() => bookings.id, { onDelete: 'restrict' }).unique(),
  inspectorId:             uuid('inspector_id').references(() => users.id),
  status:                  text('status', { enum: ['draft', 'in_progress', 'pending_review', 'approved', 'flagged', 'revised'] }).default('draft'),
  overallResult:           text('overall_result', { enum: ['pass', 'conditional', 'fail'] }),
  startedAt:               timestamp('started_at', { withTimezone: true }),
  submittedAt:             timestamp('submitted_at', { withTimezone: true }),
  approvedAt:              timestamp('approved_at', { withTimezone: true }),
  approvedBy:              uuid('approved_by').references(() => users.id),
  flaggedAt:               timestamp('flagged_at', { withTimezone: true }),
  flaggedBy:               uuid('flagged_by').references(() => users.id),
  flagReason:              text('flag_reason'),
  // A revision request keeps the inspection at status='flagged' — submit()'s
  // allowlist accepts that — so these are what distinguishes "flagged, nobody
  // has acted" from "revision requested, waiting on the inspector". Kept apart
  // from flagReason so the reason it was flagged survives the request.
  revisionRequestedAt:     timestamp('revision_requested_at', { withTimezone: true }),
  revisionNotes:           text('revision_notes'),
  currentReportVersionId:  uuid('current_report_version_id'),
  lastModifiedAt:          timestamp('last_modified_at', { withTimezone: true }),
  lastModifiedBy:          uuid('last_modified_by').references(() => users.id),
  syncStatus:              text('sync_status', { enum: ['synced', 'pending', 'conflict'] }).default('synced'),
  createdAt:               timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:               timestamp('updated_at', { withTimezone: true }).defaultNow(),
  isSolo:                  boolean('is_solo').notNull().default(false),
  clientId:                uuid('client_id').references(() => users.id),
  propertyAddress:         text('property_address'),
  propertyType:            text('property_type'),
  inspectionType:          text('inspection_type', { enum: ['shi', 'mic', 'cib', 'fsi', 'pcc', 'hhc', 'snag'] }),
  state:                   text('state'),
  lga:                     text('lga'),
  country:                 text('country'),
  notes:                   text('notes'),
  inspectionTypeId:        uuid('inspection_type_id').references(() => inspectionTypes.id),
  coverPhotoPath:          text('cover_photo_path'),
  locationLat:             doublePrecision('location_lat'),
  locationLng:             doublePrecision('location_lng'),
  weatherSnapshot:         jsonb('weather_snapshot'),
  buildingType:            text('building_type'),
  occupancyStatus:         text('occupancy_status'),
  inAttendance:            text('in_attendance').array(),
  inspectionConstraints:   text('inspection_constraints').array(),
  otherBuildingType:       text('other_building_type'),
  otherInAttendance:       text('other_in_attendance'),
  otherConstraints:        text('other_constraints'),
}, t => ({
  inspectorIdx:     index('idx_inspections_inspector').on(t.inspectorId),
  inspectorIdIdx:   index('idx_inspections_inspector_id').on(t.inspectorId),
  inspectorDateIdx: index('idx_inspections_inspector_date').on(t.inspectorId, t.createdAt),
  statusIdx:        index('idx_inspections_status').on(t.status),
}));

// ── Inspection sections, conditions, photos ───────────────────────────────────

export const inspectionSections = pgTable('inspection_sections', {
  id:              uuid('id').primaryKey().defaultRandom(),
  inspectionId:    uuid('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
  name:            text('name').notNull(),
  displayOrder:    integer('display_order').notNull(),
  status:          text('status', { enum: ['pending', 'pass', 'observations'] }).default('pending'),
  completedAt:     timestamp('completed_at', { withTimezone: true }),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow(),
  masterSectionId: uuid('master_section_id').references(() => masterSections.id),
}, t => ({
  inspectionIdx: index('idx_sections_inspection').on(t.inspectionId),
}));

export const inspectionConditions = pgTable('inspection_conditions', {
  id:                       uuid('id').primaryKey().defaultRandom(),
  sectionId:                uuid('section_id').notNull().references(() => inspectionSections.id, { onDelete: 'cascade' }),
  inspectionId:             uuid('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
  name:                     text('name').notNull(),
  displayOrder:             integer('display_order').notNull(),
  severity:                 text('severity', { enum: ['acceptable', 'monitor', 'repair_required', 'unsafe'] }),
  isComplete:               boolean('is_complete').default(false),
  photoCount:               integer('photo_count').default(0),
  observationCount:         integer('observation_count').default(0),
  updatedAt:                timestamp('updated_at', { withTimezone: true }).defaultNow(),
  createdAt:                timestamp('created_at', { withTimezone: true }).defaultNow(),
  masterConditionId:        uuid('master_condition_id').references(() => masterConditions.id),
  riskSnapshot:             text('risk_snapshot'),
  recommendationSnapshot:   text('recommendation_snapshot'),
  photoRequired:            boolean('photo_required').notNull().default(false),
  clarification:            text('clarification'),
  location:                 text('location'),
}, t => ({
  sectionIdx:    index('idx_conditions_section').on(t.sectionId),
  inspectionIdx: index('idx_conditions_inspection').on(t.inspectionId),
  masterIdx:     index('idx_conditions_master').on(t.masterConditionId),
  // The text enum above is TypeScript-only; this CHECK makes the DB reject
  // out-of-vocabulary severities loudly instead of persisting them silently.
  severityCheck: check(
    'inspection_conditions_severity_check',
    sql`${t.severity} IS NULL OR ${t.severity} IN ('acceptable', 'monitor', 'repair_required', 'unsafe')`
  ),
}));

export const additionalObservations = pgTable('additional_observations', {
  id:           uuid('id').primaryKey().defaultRandom(),
  inspectionId: uuid('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
  sectionSlug:  text('section_slug').notNull(),
  title:        text('title').notNull(),
  description:  text('description').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  inspectionIdx: index('idx_additional_observations_inspection').on(t.inspectionId),
}));

export const inspectionPhotos = pgTable('inspection_photos', {
  id:            uuid('id').primaryKey().defaultRandom(),
  conditionId:   uuid('condition_id').references(() => inspectionConditions.id, { onDelete: 'cascade' }),
  inspectionId:  uuid('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
  storagePath:   text('storage_path'),
  thumbPath:     text('thumb_path'),
  uploadStatus:  text('upload_status', { enum: ['pending', 'uploading', 'done', 'failed'] }).default('pending'),
  localId:       text('local_id'),
  mimeType:      text('mime_type').default('image/webp'),
  fileSizeBytes: integer('file_size_bytes'),
  width:         integer('width'),
  height:        integer('height'),
  takenAt:       timestamp('taken_at', { withTimezone: true }),
  uploadedAt:    timestamp('uploaded_at', { withTimezone: true }),
  takenBy:       uuid('taken_by').references(() => users.id),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
  isDeleted:     boolean('is_deleted').default(false),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).defaultNow(),
  observationId: uuid('observation_id').references(() => additionalObservations.id, { onDelete: 'cascade' }),
}, t => ({
  conditionIdx:   index('idx_photos_condition').on(t.conditionId),
  inspectionIdx:  index('idx_photos_inspection').on(t.inspectionId),
}));

export const photoAnnotations = pgTable('photo_annotations', {
  id:        uuid('id').primaryKey().defaultRandom(),
  photoId:   uuid('photo_id').notNull().references(() => inspectionPhotos.id, { onDelete: 'cascade' }).unique(),
  shapes:    jsonb('shapes').notNull().default(sql`'[]'::jsonb`),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
  photoIdx: index('idx_annotations_photo').on(t.photoId),
}));

export const observations = pgTable('observations', {
  id:           uuid('id').primaryKey().defaultRandom(),
  conditionId:  uuid('condition_id').notNull().references(() => inspectionConditions.id, { onDelete: 'cascade' }),
  inspectionId: uuid('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
  text:         text('text').notNull(),
  addedBy:      uuid('added_by').notNull().references(() => users.id),
  addedByRole:  text('added_by_role', { enum: ['inspector', 'admin'] }).notNull(),
  editedAt:     timestamp('edited_at', { withTimezone: true }),
  editedBy:     uuid('edited_by').references(() => users.id),
  isDeleted:    boolean('is_deleted').default(false),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
  conditionIdx:  index('idx_observations_condition').on(t.conditionId),
  inspectionIdx: index('idx_observations_inspection').on(t.inspectionId),
}));

// ── Reviews ───────────────────────────────────────────────────────────────────

export const inspectorReviews = pgTable('inspector_reviews', {
  id:          uuid('id').primaryKey().defaultRandom(),
  inspectorId: uuid('inspector_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId:    uuid('client_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  bookingId:   uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
  rating:      integer('rating').notNull(),
  comment:     text('comment'),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
  clientIdx:    index('idx_reviews_client').on(t.clientId),
  inspectorIdx: index('idx_reviews_inspector').on(t.inspectorId),
}));

// ── Reports ───────────────────────────────────────────────────────────────────

export const reportVersions = pgTable('report_versions', {
  id:                uuid('id').primaryKey().defaultRandom(),
  inspectionId:      uuid('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
  version:           integer('version').notNull().default(1),
  certificateNumber: text('certificate_number'),
  generatedAt:       timestamp('generated_at', { withTimezone: true }).defaultNow(),
  generatedBy:       uuid('generated_by').references(() => users.id),
  storagePath:       text('storage_path'),
  fileSizeBytes:     integer('file_size_bytes'),
  changesSummary:    text('changes_summary'),
  isLatest:          boolean('is_latest').default(true),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow(),
  stageVerdict:      text('stage_verdict', { enum: ['APPROVED', 'APPROVED_WITH_DEFECTS', 'NOT_APPROVED'] }),
}, t => ({
  uq:            uniqueIndex('report_versions_inspection_id_version_key').on(t.inspectionId, t.version),
  inspectionIdx: index('idx_report_versions_inspection').on(t.inspectionId),
  certIdx:       index('idx_reports_certificate').on(t.certificateNumber),
}));

export const reportAccessTokens = pgTable('report_access_tokens', {
  id:           uuid('id').primaryKey().defaultRandom(),
  inspectionId: uuid('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
  token:        text('token').notNull().unique(),
  createdBy:    uuid('created_by').references(() => users.id),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt:    timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt:    timestamp('revoked_at', { withTimezone: true }),
  accessedAt:   timestamp('accessed_at', { withTimezone: true }),
}, t => ({
  inspectionIdx: index('idx_report_tokens_inspection').on(t.inspectionId),
  tokenIdx:      index('idx_report_tokens_token').on(t.token),
}));

// ── Audit + ops ──────────────────────────────────────────────────────────────

export const revisionEvents = pgTable('revision_events', {
  id:             bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  inspectionId:   uuid('inspection_id').references(() => inspections.id, { onDelete: 'set null' }),
  entityType:     text('entity_type').notNull(),
  entityId:       text('entity_id').notNull(),
  action:         text('action', { enum: ['created', 'updated', 'deleted'] }).notNull(),
  field:          text('field'),
  previousValue:  jsonb('previous_value'),
  newValue:       jsonb('new_value'),
  changedBy:      uuid('changed_by').references(() => users.id),
  changedAt:      timestamp('changed_at', { withTimezone: true }).defaultNow(),
  reason:         text('reason'),
}, t => ({
  inspectionIdx: index('idx_revision_inspection').on(t.inspectionId),
  entityIdx:     index('idx_revision_entity').on(t.entityType, t.entityId),
}));

// Who suspended or reinstated whom, and why. revision_events is inspection-scoped
// (its inspection_id is an FK to inspections), so account-level actions have no
// valid home there and belong here instead.
export const adminActions = pgTable('admin_actions', {
  id:           uuid('id').primaryKey().defaultRandom(),
  actorId:      uuid('actor_id').references(() => users.id),
  targetUserId: uuid('target_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  action:       text('action', {
    enum: ['suspend_inspector', 'reinstate_inspector', 'suspend_client', 'reinstate_client'],
  }).notNull(),
  previousStatus: text('previous_status'),
  newStatus:      text('new_status'),
  reason:         text('reason'),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  targetIdx: index('idx_admin_actions_target_created').on(t.targetUserId, t.createdAt),
}));

export const tokenLedger = pgTable('token_ledger', {
  id:           uuid('id').primaryKey().defaultRandom(),
  userId:       uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  delta:        integer('delta').notNull(),
  kind:         text('kind', { enum: ['purchase', 'consume', 'admin_grant', 'signup_bonus'] }).notNull(),
  inspectionId: uuid('inspection_id').references(() => inspections.id, { onDelete: 'set null' }),
  purchaseId:   uuid('purchase_id'),
  grantedBy:    uuid('granted_by').references(() => users.id),
  note:         text('note'),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  userIdx: index('idx_token_ledger_user_created').on(t.userId, t.createdAt),
}));

export const tokenPurchases = pgTable('token_purchases', {
  id:          uuid('id').primaryKey().defaultRandom(),
  userId:      uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  quantity:    integer('quantity').notNull(),
  amountNgn:   integer('amount_ngn').notNull(),
  proofPath:   text('proof_path'),
  status:      text('status', { enum: ['pending_review', 'approved', 'rejected'] }).notNull().default('pending_review'),
  reviewedBy:  uuid('reviewed_by').references(() => users.id),
  reviewedAt:  timestamp('reviewed_at', { withTimezone: true }),
  reviewNotes: text('review_notes'),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  userIdx:   index('idx_token_purchases_user').on(t.userId, t.createdAt),
}));

// ── Cert library + ops ───────────────────────────────────────────────────────

export const certCache = pgTable('cert_cache', {
  id:            uuid('id').primaryKey().defaultRandom(),
  achiNumber:    varchar('achi_number', { length: 20 }).notNull().unique(),
  inspectorName: varchar('inspector_name', { length: 255 }).notNull(),
  status:        varchar('status', { length: 50 }).notNull(),
  issuedAt:      date('issued_at'),
  expiresAt:     date('expires_at'),
  cachedAt:      timestamp('cached_at', { withTimezone: true }).defaultNow().notNull(),
  source:        varchar('source', { length: 20 }).notNull().default('wordpress'),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  achiIdx:     index('idx_cert_cache_achi').on(t.achiNumber),
  cachedIdx:   index('idx_cert_cache_cached_at').on(t.cachedAt),
}));

export const certExpiryNotifications = pgTable('cert_expiry_notifications', {
  id:          uuid('id').primaryKey().defaultRandom(),
  inspectorId: uuid('inspector_id').notNull().references(() => users.id),
  achiNumber:  text('achi_number').notNull(),
  windowDays:  integer('window_days').notNull(),
  sentAt:      timestamp('sent_at', { withTimezone: true }).defaultNow(),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
  inspectorIdx: index('idx_cert_expiry_inspector').on(t.inspectorId),
  windowIdx:    index('idx_cert_expiry_window').on(t.inspectorId, t.windowDays),
}));

export const certNumberCounters = pgTable('cert_number_counters', {
  year:      integer('year').primaryKey(),
  lastNum:   bigint('last_num', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const notificationLogs = pgTable('notification_logs', {
  id:             uuid('id').primaryKey().defaultRandom(),
  type:           text('type').notNull(),
  recipientId:    uuid('recipient_id').references(() => users.id),
  recipientEmail: text('recipient_email').notNull(),
  entityType:     text('entity_type'),
  entityId:       uuid('entity_id'),
  sentAt:         timestamp('sent_at', { withTimezone: true }).defaultNow(),
  status:         text('status', { enum: ['sent', 'failed'] }).default('sent'),
  resendId:       text('resend_id'),
  error:          text('error'),
}, t => ({
  recipientIdx: index('idx_notification_recipient').on(t.recipientId),
  recentIdx:    index('idx_notifications_recent').on(t.recipientId, t.sentAt),
}));

// ── Sync (offline) ───────────────────────────────────────────────────────────

export const syncRuns = pgTable('sync_runs', {
  id:               uuid('id').primaryKey().defaultRandom(),
  type:             varchar('type', { length: 50 }).notNull(),
  status:           varchar('status', { length: 20 }).notNull().default('running'),
  startedAt:        timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt:      timestamp('completed_at', { withTimezone: true }),
  recordsProcessed: integer('records_processed').default(0),
  recordsCreated:   integer('records_created').default(0),
  recordsUpdated:   integer('records_updated').default(0),
  recordsFailed:    integer('records_failed').default(0),
  errors:           text('errors').array(),
  metadata:         jsonb('metadata'),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  startedIdx: index('idx_sync_runs_started_at').on(t.startedAt),
  statusIdx:  index('idx_sync_runs_status').on(t.status),
  typeIdx:    index('idx_sync_runs_type').on(t.type),
}));

export const syncConflicts = pgTable('sync_conflicts', {
  id:             uuid('id').primaryKey().defaultRandom(),
  type:           varchar('type', { length: 50 }).notNull(),
  achiNumber:     varchar('achi_number', { length: 20 }).notNull(),
  wordpressValue: jsonb('wordpress_value').notNull(),
  appValue:       jsonb('app_value').notNull(),
  resolution:     varchar('resolution', { length: 20 }).notNull().default('manual_review'),
  resolvedAt:     timestamp('resolved_at', { withTimezone: true }),
  resolvedBy:     uuid('resolved_by').references(() => users.id),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  achiIdx:    index('idx_sync_conflicts_achi').on(t.achiNumber),
  typeIdx:    index('idx_sync_conflicts_type').on(t.type),
}));

export const webhookEvents = pgTable('webhook_events', {
  id:           uuid('id').primaryKey().defaultRandom(),
  eventType:    varchar('event_type', { length: 50 }).notNull(),
  source:       varchar('source', { length: 50 }).notNull().default('wordpress'),
  payload:      jsonb('payload').notNull(),
  status:       varchar('status', { length: 20 }).notNull().default('received'),
  processedAt:  timestamp('processed_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => ({
  createdIdx: index('idx_webhook_events_created_at').on(t.createdAt),
  statusIdx:  index('idx_webhook_events_status').on(t.status),
  typeIdx:    index('idx_webhook_events_type').on(t.eventType),
}));
