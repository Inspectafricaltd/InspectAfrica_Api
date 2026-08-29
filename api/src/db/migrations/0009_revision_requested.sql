-- Issue #79: "revision requested" was not a state.
--
-- resolveFlag(action='request_revision') kept status='flagged' and overwrote
-- flag_reason with the revision notes. Nothing distinguished "flagged, nobody
-- has acted yet" from "revision requested, waiting on the inspector", the
-- Request Revision button stayed enabled, and each press destroyed the reason
-- the inspection was flagged in the first place.
--
-- Keeping status='flagged' is deliberate — submit()'s allowlist accepts it —
-- so the distinguishing state goes in its own columns.

ALTER TABLE "inspections" ADD COLUMN IF NOT EXISTS "revision_requested_at" timestamp with time zone;
ALTER TABLE "inspections" ADD COLUMN IF NOT EXISTS "revision_notes" text;

-- Partial index: the admin flagged queue filters on this, and only a handful of
-- rows ever have it set.
CREATE INDEX IF NOT EXISTS "idx_inspections_revision_requested"
  ON "inspections" ("revision_requested_at")
  WHERE "revision_requested_at" IS NOT NULL;
