CREATE TABLE "additional_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"section_slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_declines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"inspector_id" uuid NOT NULL,
	"declined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"inspector_id" uuid,
	"property_address" text NOT NULL,
	"property_city" text NOT NULL,
	"property_type" text NOT NULL,
	"inspection_type" text NOT NULL,
	"requested_date" date NOT NULL,
	"requested_time" time,
	"notes_to_inspector" text,
	"status" text DEFAULT 'pending',
	"declined_reason" text,
	"accepted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"state" text,
	"lga" text,
	"client_payment_status" text DEFAULT 'unpaid',
	"client_payment_amount" numeric(12, 2),
	"client_receipt_path" text,
	"client_receipt_uploaded_at" timestamp with time zone,
	"client_paid_at" timestamp with time zone,
	"client_paid_by" uuid,
	"client_payment_notes" text,
	"inspector_payout_status" text DEFAULT 'unpaid',
	"inspector_payout_amount" numeric(12, 2),
	"inspector_paid_at" timestamp with time zone,
	"inspector_paid_by" uuid,
	"inspector_payout_notes" text
);
--> statement-breakpoint
CREATE TABLE "cert_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"achi_number" varchar(20) NOT NULL,
	"inspector_name" varchar(255) NOT NULL,
	"status" varchar(50) NOT NULL,
	"issued_at" date,
	"expires_at" date,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" varchar(20) DEFAULT 'wordpress' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cert_cache_achi_number_unique" UNIQUE("achi_number")
);
--> statement-breakpoint
CREATE TABLE "cert_expiry_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspector_id" uuid NOT NULL,
	"achi_number" text NOT NULL,
	"window_days" integer NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cert_number_counters" (
	"year" integer PRIMARY KEY NOT NULL,
	"last_num" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"country_of_residence" text,
	"diaspora_flag" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "client_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "inspection_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_order" integer NOT NULL,
	"severity" text,
	"is_complete" boolean DEFAULT false,
	"photo_count" integer DEFAULT 0,
	"observation_count" integer DEFAULT 0,
	"updated_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"master_condition_id" uuid,
	"risk_snapshot" text,
	"recommendation_snapshot" text,
	"photo_required" boolean DEFAULT false NOT NULL,
	"clarification" text
);
--> statement-breakpoint
CREATE TABLE "inspection_limitations" (
	"inspection_id" uuid NOT NULL,
	"limitation_id" uuid NOT NULL,
	CONSTRAINT "inspection_limitations_inspection_id_limitation_id_pk" PRIMARY KEY("inspection_id","limitation_id")
);
--> statement-breakpoint
CREATE TABLE "inspection_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condition_id" uuid,
	"inspection_id" uuid NOT NULL,
	"storage_path" text,
	"thumb_path" text,
	"upload_status" text DEFAULT 'pending',
	"local_id" text,
	"mime_type" text DEFAULT 'image/webp',
	"file_size_bytes" integer,
	"width" integer,
	"height" integer,
	"taken_at" timestamp with time zone,
	"uploaded_at" timestamp with time zone,
	"taken_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"is_deleted" boolean DEFAULT false,
	"updated_at" timestamp with time zone DEFAULT now(),
	"observation_id" uuid
);
--> statement-breakpoint
CREATE TABLE "inspection_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"name" text NOT NULL,
	"display_order" integer NOT NULL,
	"status" text DEFAULT 'pending',
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"master_section_id" uuid
);
--> statement-breakpoint
CREATE TABLE "inspection_type_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_type_id" uuid NOT NULL,
	"condition_id" uuid NOT NULL,
	"is_required" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "inspection_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "inspection_types_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid,
	"inspector_id" uuid,
	"status" text DEFAULT 'draft',
	"overall_result" text,
	"started_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"flagged_at" timestamp with time zone,
	"flagged_by" uuid,
	"flag_reason" text,
	"current_report_version_id" uuid,
	"last_modified_at" timestamp with time zone,
	"last_modified_by" uuid,
	"sync_status" text DEFAULT 'synced',
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"is_solo" boolean DEFAULT false NOT NULL,
	"client_id" uuid,
	"property_address" text,
	"property_type" text,
	"inspection_type" text,
	"state" text,
	"lga" text,
	"notes" text,
	"inspection_type_id" uuid,
	"cover_photo_path" text,
	"location_lat" double precision,
	"location_lng" double precision,
	"weather_snapshot" jsonb,
	CONSTRAINT "inspections_booking_id_unique" UNIQUE("booking_id")
);
--> statement-breakpoint
CREATE TABLE "inspector_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"achi_number" text,
	"achi_status" text DEFAULT 'candidate',
	"achi_issued_at" timestamp with time zone,
	"achi_expires_at" timestamp with time zone,
	"bio" text,
	"service_areas" text[],
	"inspection_types" text[],
	"rating" numeric(3, 2) DEFAULT '0',
	"total_inspections" integer DEFAULT 0,
	"is_active" boolean DEFAULT true,
	"bank_name" text,
	"account_number" text,
	"account_name" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"payout_bank_name" text,
	"payout_account_number" text,
	"payout_account_name" text,
	CONSTRAINT "inspector_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "inspector_profiles_achi_number_unique" UNIQUE("achi_number")
);
--> statement-breakpoint
CREATE TABLE "inspector_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspector_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"booking_id" uuid,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "limitation_library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"text" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "limitation_library_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "master_conditions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"ai_default_severity" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"severity" text NOT NULL,
	"risk_statement" text,
	"recommendation" text,
	"photo_required" boolean DEFAULT false NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "master_conditions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "master_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "master_sections_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "notification_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"recipient_id" uuid,
	"recipient_email" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now(),
	"status" text DEFAULT 'sent',
	"resend_id" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"condition_id" uuid NOT NULL,
	"inspection_id" uuid NOT NULL,
	"text" text NOT NULL,
	"added_by" uuid NOT NULL,
	"added_by_role" text NOT NULL,
	"edited_at" timestamp with time zone,
	"edited_by" uuid,
	"is_deleted" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "photo_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"photo_id" uuid NOT NULL,
	"shapes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "photo_annotations_photo_id_unique" UNIQUE("photo_id")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"ip_address" text,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "report_access_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"token" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"accessed_at" timestamp with time zone,
	CONSTRAINT "report_access_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "report_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"certificate_number" text,
	"generated_at" timestamp with time zone DEFAULT now(),
	"generated_by" uuid,
	"storage_path" text,
	"file_size_bytes" integer,
	"changes_summary" text,
	"is_latest" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now(),
	"stage_verdict" text
);
--> statement-breakpoint
CREATE TABLE "revision_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "revision_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"inspection_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"field" text,
	"previous_value" jsonb,
	"new_value" jsonb,
	"changed_by" uuid,
	"changed_at" timestamp with time zone DEFAULT now(),
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"achi_number" varchar(20) NOT NULL,
	"wordpress_value" jsonb NOT NULL,
	"supabase_value" jsonb NOT NULL,
	"resolution" varchar(20) DEFAULT 'manual_review' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"records_processed" integer DEFAULT 0,
	"records_created" integer DEFAULT 0,
	"records_updated" integer DEFAULT 0,
	"records_failed" integer DEFAULT 0,
	"errors" text[],
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"kind" text NOT NULL,
	"inspection_id" uuid,
	"purchase_id" uuid,
	"granted_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"amount_ngn" integer NOT NULL,
	"proof_path" text,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"role" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	"status" text DEFAULT 'active' NOT NULL,
	"signature_image_path" text,
	"password_hash" text,
	"token_version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"source" varchar(50) DEFAULT 'wordpress' NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'received' NOT NULL,
	"processed_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "additional_observations" ADD CONSTRAINT "additional_observations_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_declines" ADD CONSTRAINT "booking_declines_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_declines" ADD CONSTRAINT "booking_declines_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_paid_by_users_id_fk" FOREIGN KEY ("client_paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_inspector_paid_by_users_id_fk" FOREIGN KEY ("inspector_paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cert_expiry_notifications" ADD CONSTRAINT "cert_expiry_notifications_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_conditions" ADD CONSTRAINT "inspection_conditions_section_id_inspection_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."inspection_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_conditions" ADD CONSTRAINT "inspection_conditions_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_conditions" ADD CONSTRAINT "inspection_conditions_master_condition_id_master_conditions_id_fk" FOREIGN KEY ("master_condition_id") REFERENCES "public"."master_conditions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_limitations" ADD CONSTRAINT "inspection_limitations_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_limitations" ADD CONSTRAINT "inspection_limitations_limitation_id_limitation_library_id_fk" FOREIGN KEY ("limitation_id") REFERENCES "public"."limitation_library"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_condition_id_inspection_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."inspection_conditions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_taken_by_users_id_fk" FOREIGN KEY ("taken_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_observation_id_additional_observations_id_fk" FOREIGN KEY ("observation_id") REFERENCES "public"."additional_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_sections" ADD CONSTRAINT "inspection_sections_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_sections" ADD CONSTRAINT "inspection_sections_master_section_id_master_sections_id_fk" FOREIGN KEY ("master_section_id") REFERENCES "public"."master_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_conditions" ADD CONSTRAINT "inspection_type_conditions_inspection_type_id_inspection_types_id_fk" FOREIGN KEY ("inspection_type_id") REFERENCES "public"."inspection_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection_type_conditions" ADD CONSTRAINT "inspection_type_conditions_condition_id_master_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."master_conditions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_flagged_by_users_id_fk" FOREIGN KEY ("flagged_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_last_modified_by_users_id_fk" FOREIGN KEY ("last_modified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_inspection_type_id_inspection_types_id_fk" FOREIGN KEY ("inspection_type_id") REFERENCES "public"."inspection_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspector_profiles" ADD CONSTRAINT "inspector_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspector_reviews" ADD CONSTRAINT "inspector_reviews_inspector_id_users_id_fk" FOREIGN KEY ("inspector_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspector_reviews" ADD CONSTRAINT "inspector_reviews_client_id_users_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspector_reviews" ADD CONSTRAINT "inspector_reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "master_conditions" ADD CONSTRAINT "master_conditions_section_id_master_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."master_sections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_condition_id_inspection_conditions_id_fk" FOREIGN KEY ("condition_id") REFERENCES "public"."inspection_conditions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_annotations" ADD CONSTRAINT "photo_annotations_photo_id_inspection_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."inspection_photos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_annotations" ADD CONSTRAINT "photo_annotations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_access_tokens" ADD CONSTRAINT "report_access_tokens_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_access_tokens" ADD CONSTRAINT "report_access_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_versions" ADD CONSTRAINT "report_versions_generated_by_users_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_events" ADD CONSTRAINT "revision_events_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_events" ADD CONSTRAINT "revision_events_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_conflicts" ADD CONSTRAINT "sync_conflicts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "public"."inspections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_ledger" ADD CONSTRAINT "token_ledger_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD CONSTRAINT "token_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD CONSTRAINT "token_purchases_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_additional_observations_inspection" ON "additional_observations" USING btree ("inspection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "booking_declines_unique" ON "booking_declines" USING btree ("booking_id","inspector_id");--> statement-breakpoint
CREATE INDEX "idx_booking_declines_booking_id" ON "booking_declines" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "idx_booking_declines_inspector_id" ON "booking_declines" USING btree ("inspector_id");--> statement-breakpoint
CREATE INDEX "idx_bookings_client" ON "bookings" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_bookings_client_date" ON "bookings" USING btree ("client_id","requested_date");--> statement-breakpoint
CREATE INDEX "idx_bookings_client_payment_status" ON "bookings" USING btree ("client_payment_status");--> statement-breakpoint
CREATE INDEX "idx_bookings_date" ON "bookings" USING btree ("requested_date");--> statement-breakpoint
CREATE INDEX "idx_bookings_inspector" ON "bookings" USING btree ("inspector_id");--> statement-breakpoint
CREATE INDEX "idx_bookings_inspector_payout_status" ON "bookings" USING btree ("inspector_payout_status");--> statement-breakpoint
CREATE INDEX "idx_bookings_inspector_status" ON "bookings" USING btree ("inspector_id","status");--> statement-breakpoint
CREATE INDEX "idx_bookings_status" ON "bookings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_cert_cache_achi" ON "cert_cache" USING btree ("achi_number");--> statement-breakpoint
CREATE INDEX "idx_cert_cache_cached_at" ON "cert_cache" USING btree ("cached_at");--> statement-breakpoint
CREATE INDEX "idx_cert_expiry_inspector" ON "cert_expiry_notifications" USING btree ("inspector_id");--> statement-breakpoint
CREATE INDEX "idx_cert_expiry_window" ON "cert_expiry_notifications" USING btree ("inspector_id","window_days");--> statement-breakpoint
CREATE INDEX "idx_conditions_section" ON "inspection_conditions" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "idx_conditions_inspection" ON "inspection_conditions" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "idx_conditions_master" ON "inspection_conditions" USING btree ("master_condition_id");--> statement-breakpoint
CREATE INDEX "idx_photos_condition" ON "inspection_photos" USING btree ("condition_id");--> statement-breakpoint
CREATE INDEX "idx_photos_inspection" ON "inspection_photos" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "idx_sections_inspection" ON "inspection_sections" USING btree ("inspection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inspection_type_conditions_inspection_type_id_condition_id_key" ON "inspection_type_conditions" USING btree ("inspection_type_id","condition_id");--> statement-breakpoint
CREATE INDEX "idx_itc_type" ON "inspection_type_conditions" USING btree ("inspection_type_id");--> statement-breakpoint
CREATE INDEX "idx_itc_condition" ON "inspection_type_conditions" USING btree ("condition_id");--> statement-breakpoint
CREATE INDEX "idx_inspections_inspector" ON "inspections" USING btree ("inspector_id");--> statement-breakpoint
CREATE INDEX "idx_inspections_inspector_id" ON "inspections" USING btree ("inspector_id");--> statement-breakpoint
CREATE INDEX "idx_inspections_inspector_date" ON "inspections" USING btree ("inspector_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_inspections_status" ON "inspections" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_inspectors_achi" ON "inspector_profiles" USING btree ("achi_number");--> statement-breakpoint
CREATE INDEX "idx_reviews_client" ON "inspector_reviews" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "idx_reviews_inspector" ON "inspector_reviews" USING btree ("inspector_id");--> statement-breakpoint
CREATE INDEX "idx_master_conditions_section" ON "master_conditions" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "idx_notification_recipient" ON "notification_logs" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_recent" ON "notification_logs" USING btree ("recipient_id","sent_at");--> statement-breakpoint
CREATE INDEX "idx_observations_condition" ON "observations" USING btree ("condition_id");--> statement-breakpoint
CREATE INDEX "idx_observations_inspection" ON "observations" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "idx_prt_user" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_prt_expires" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_annotations_photo" ON "photo_annotations" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_expires" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_report_tokens_inspection" ON "report_access_tokens" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "idx_report_tokens_token" ON "report_access_tokens" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "report_versions_inspection_id_version_key" ON "report_versions" USING btree ("inspection_id","version");--> statement-breakpoint
CREATE INDEX "idx_report_versions_inspection" ON "report_versions" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "idx_reports_certificate" ON "report_versions" USING btree ("certificate_number");--> statement-breakpoint
CREATE INDEX "idx_revision_inspection" ON "revision_events" USING btree ("inspection_id");--> statement-breakpoint
CREATE INDEX "idx_revision_entity" ON "revision_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_sync_conflicts_achi" ON "sync_conflicts" USING btree ("achi_number");--> statement-breakpoint
CREATE INDEX "idx_sync_conflicts_type" ON "sync_conflicts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_sync_runs_started_at" ON "sync_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "idx_sync_runs_status" ON "sync_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_sync_runs_type" ON "sync_runs" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_token_ledger_user_created" ON "token_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_token_purchases_user" ON "token_purchases" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_role" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_users_status" ON "users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_created_at" ON "webhook_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_status" ON "webhook_events" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_webhook_events_type" ON "webhook_events" USING btree ("event_type");