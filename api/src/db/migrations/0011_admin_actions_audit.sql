-- Audit trail for account suspend/reinstate, and the fix for a reinstatement deadlock.
--
-- An inspector reported being suspended with no way back in. Two problems:
--
-- 1. reinstateInspector gated on CertService.verify, which only returns valid
--    when achi_status = 'certified'. But suspendInspector sets achi_status to
--    'suspended' first, so the check could never pass and the method returned
--    before restoring users.status. Any inspector holding an ACHI number, once
--    suspended, could never be reinstated through the admin UI or API.
--
-- 2. Nothing recorded who suspended an account or why. suspendClient did call
--    RevisionService.log, but passed a client id as revision_events.inspection_id
--    -- an FK to inspections -- so every one of those writes failed the FK and
--    was swallowed by that service's catch. Production has 99 revision_events and
--    zero client_status rows, confirming none ever landed.
--
-- revision_events is inspection-scoped by design, so account-level actions get
-- their own table rather than more overloading of that one.

CREATE TABLE IF NOT EXISTS "admin_actions" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "actor_id"        uuid REFERENCES "users"("id"),
  "target_user_id"  uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "action"          text NOT NULL,
  "previous_status" text,
  "new_status"      text,
  "reason"          text,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now()
);

-- The admin UI reads an account's history newest-first.
CREATE INDEX IF NOT EXISTS "idx_admin_actions_target_created"
  ON "admin_actions" ("target_user_id", "created_at" DESC);
