-- Issues #97 and #19: duplicate bookings.
--
-- BookingService.create guarded against duplicates by SELECTing first and then
-- inserting. Three clicks on "Confirm Booking" arrive close enough together that
-- all three run their SELECT before any INSERT commits, so all three find
-- nothing and all three insert — observed one millisecond apart.
--
-- A check in application code cannot win that race; only the database can.
-- This partial unique index is the actual guarantee. The application-level
-- check stays, because it produces a friendlier message on the common
-- non-concurrent path.
--
-- The status list is also corrected here (#19): the old check looked for
-- 'pending' and 'accepted', which this application never writes, and omitted
-- 'confirmed' — the status of a booking an inspector has already claimed, and
-- so the one that matters most.
--
-- Verified before writing: neither the local nor the Railway staging database
-- contains a violation of this index.

CREATE UNIQUE INDEX IF NOT EXISTS "bookings_active_client_property_date_unique"
  ON "bookings" ("client_id", "property_address", "requested_date")
  WHERE "status" IN ('open', 'confirmed', 'in_progress');
