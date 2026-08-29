ALTER TABLE "inspections"
ADD COLUMN IF NOT EXISTS "building_type" text,
ADD COLUMN IF NOT EXISTS "occupancy_status" text,
ADD COLUMN IF NOT EXISTS "in_attendance" text[],
ADD COLUMN IF NOT EXISTS "inspection_constraints" text[],
ADD COLUMN IF NOT EXISTS "other_building_type" text,
ADD COLUMN IF NOT EXISTS "other_in_attendance" text,
ADD COLUMN IF NOT EXISTS "other_constraints" text;
