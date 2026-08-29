-- fix_resolution_timing.sql
-- Every seeded "Resolved" report currently resolves 5-10 days after
-- submission (or, for the deliberately engineered recurring-failure/
-- systemic clusters, 3-5 days) — always past the 3-day SLA target, no
-- exceptions. That's why the Repair Reliability chart showed empty bars:
-- they were rendering correctly at exactly 0% width, because on-time rate
-- was genuinely 0% for every department. Not a rendering bug — a seed-data
-- bug (the same one just fixed in seed_hotspot_demo.py for future re-seeds).
--
-- This UPDATE recomputes only the three workflow timestamps below for
-- every currently-Resolved report, using the same realistic on-time/late
-- split (~45% resolve within 72h, the rest later) as the fixed seed
-- script. "timestamp" (submission date/time), location, category, and
-- every other field are untouched — this only corrects how long each
-- report took to close, not what it was about or when it was filed.
--
-- Safe to run on top of an already-seeded database: UPDATE only, no
-- deletes, scoped to status = 'Resolved'.

BEGIN;

-- resolved_at/in_process_at/in_maintenance_at are varchar columns (an
-- existing quirk of this schema, not something this script changes), and
-- every other row in the table was written as an ISO-8601 string with an
-- explicit UTC offset (Python's datetime.isoformat(), e.g.
-- "2026-07-22T20:38:00.494807+00:00"). Postgres' own timestamp-to-text
-- cast instead produces "2026-07-22 20:38:00.494807" — no "T", no offset
-- — which a JS Date parses as LOCAL time rather than UTC, silently
-- shifting every date by the browser's timezone offset. to_char() with
-- an explicit format plus a literal "+00:00" suffix keeps the string
-- shape identical to the rest of the seeded data instead of introducing
-- a second, inconsistent date format.
UPDATE "Complaint"
SET
  "in_process_at" = to_char("timestamp" + (12 + random() * 12) * interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00',
  "in_maintenance_at" = to_char("timestamp" + (24 + random() * 16) * interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00',
  "resolved_at" = CASE
    WHEN random() < 0.45 THEN to_char("timestamp" + (42 + random() * 28) * interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00'   -- on time (<=70h)
    ELSE to_char("timestamp" + (74 + random() * 146) * interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00:00'                        -- late
  END
WHERE "status" = 'Resolved';

COMMIT;

-- Verify — should now show a realistic mix, not all "late":
-- SELECT
--   COUNT(*) FILTER (WHERE resolved_at - "timestamp" <= interval '3 days') AS on_time,
--   COUNT(*) FILTER (WHERE resolved_at - "timestamp" > interval '3 days') AS late
-- FROM "Complaint" WHERE status = 'Resolved';
