-- Inspect-002 (QA): enforce phone uniqueness so duplicate-phone registrations
-- are caught by Postgres and surfaced with the customised error message
-- in AuthServiceV2 (registerClient / registerInspector).
--
-- Step 1: dedupe existing rows.
-- For any phone with more than one user, keep the earliest (smallest created_at,
-- tie-broken by id) and NULL out the rest. This preserves the row but releases
-- the phone for re-claim. Operators can recover overwritten phone values from
-- the audit/notification logs or DB backups if needed.
UPDATE "users"
SET "phone" = NULL
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT
      "id",
      ROW_NUMBER() OVER (
        PARTITION BY "phone"
        ORDER BY "created_at" NULLS LAST, "id"
      ) AS rn
    FROM "users"
    WHERE "phone" IS NOT NULL
  ) ranked
  WHERE rn > 1
);
--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_unique" UNIQUE("phone");
