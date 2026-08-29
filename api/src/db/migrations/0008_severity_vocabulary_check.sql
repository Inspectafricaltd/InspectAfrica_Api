-- Issue #3: PUT /conditions/:id accepted the legacy severity vocabulary
-- {pass, major, moderate, critical} and persisted it verbatim, but the column
-- enum and every reader (report generation, summaries) use the ACHI scale
-- {acceptable, monitor, repair_required, unsafe} — so those rows were never
-- counted in report verdicts.

-- Repair any rows written with the legacy vocabulary.
UPDATE "inspection_conditions" SET "severity" = CASE "severity"
  WHEN 'pass'     THEN 'acceptable'
  WHEN 'moderate' THEN 'monitor'
  WHEN 'major'    THEN 'repair_required'
  WHEN 'critical' THEN 'unsafe'
END
WHERE "severity" IN ('pass', 'moderate', 'major', 'critical');

-- Enforce the vocabulary at the DB so future mismatches fail loudly.
ALTER TABLE "inspection_conditions" DROP CONSTRAINT IF EXISTS "inspection_conditions_severity_check";
ALTER TABLE "inspection_conditions" ADD CONSTRAINT "inspection_conditions_severity_check"
  CHECK ("severity" IS NULL OR "severity" IN ('acceptable', 'monitor', 'repair_required', 'unsafe'));
