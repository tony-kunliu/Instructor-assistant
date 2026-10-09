-- Migration number: 0009
-- Competency 23 eligibility fields (assessment-rules reminders, T2, decisions D17/D18). Additive only:
-- five nullable columns on learners, no defaults, no backfill, no table rebuild (the learners table is
-- referenced by foreign keys; nothing here touches it beyond ADD COLUMN). Existing rows get NULL.
-- Used only by the R2 reminder (lib/rules.ts); never sent to ACTGDS; editing them emits no event.
--   learner_licence_issued_on        issue date of the CURRENT learner licence (empty = estimated from licence_expiry, D21)
--   learner_licence_first_issued_on  first-ever issue date, only if the licence was renewed
--   hpt_passed_on                    hazard perception test pass date (NULL = not recorded)
--   logged_hours                     logbook total as the instructor reads it (whole hours)
--   logged_hours_on                  the "as of" date for logged_hours
--
-- ALTER TABLE ... ADD COLUMN is not idempotent: wrangler records applied migrations, so it runs once.
--
-- Must stay in sync with lib/schema.ts SCHEMA_SQL; tests/d1-storage.test.ts checks
-- migrations/0001..0009 concatenated equal SCHEMA_SQL. Apply with:
--   wrangler d1 migrations apply DB --local   (local dev, no account needed)
--   wrangler d1 migrations apply DB --remote  (real Cloudflare D1, needs auth)

ALTER TABLE learners ADD COLUMN learner_licence_issued_on TEXT;
ALTER TABLE learners ADD COLUMN learner_licence_first_issued_on TEXT;
ALTER TABLE learners ADD COLUMN hpt_passed_on TEXT;
ALTER TABLE learners ADD COLUMN logged_hours INTEGER;
ALTER TABLE learners ADD COLUMN logged_hours_on TEXT;
