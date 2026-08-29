ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "country" text;
ALTER TABLE "inspections" ADD COLUMN IF NOT EXISTS "country" text;
