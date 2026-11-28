-- Migration number: 0013
-- Overseas / interstate licence held by the learner (learner intake design 2026-10-11, Feature 2, decisions
-- D11-D14; school rule confirmed by Tony with the authority 2026-10-11/12). Additive only: six nullable TEXT
-- columns on learners, no defaults, no backfill, no table rebuild (learners is referenced by foreign keys;
-- nothing here touches it beyond ADD COLUMN). Existing rows get NULL = "not recorded". Enum checks live in
-- lib/repo.ts#parseLearnerFields / lib/other-licence.ts, not in SQL CHECK (which would need a rebuild).
-- Read ONLY by the Competency 23 reminders (lib/rules.ts R2 and "eligible from"); never sent to ACTGDS
-- (V1 contract unchanged); editing them emits no event; no PDF field prints them (D15).
--   other_licence_kind        NULL = not recorded | 'none' | 'interstate' | 'overseas'
--   other_licence_place       state/territory code other than ACT (interstate) or a country name (overseas)
--   other_licence_number      the other licence's number, <= 40 chars, upper-case
--   other_licence_class       NULL = not recorded | 'learner' | 'full' | 'other'
--   other_licence_issued_on   YYYY-MM-DD, first issue if known, otherwise the issue date on the card (Q3)
--   other_licence_expires_on  YYYY-MM-DD, information only (Q4): no rule reads it
--
-- ALTER TABLE ... ADD COLUMN is not idempotent: wrangler records applied migrations, so it runs once.
--
-- Must stay in sync with lib/schema.ts SCHEMA_SQL; tests/d1-storage.test.ts checks
-- migrations/0001..0013 concatenated equal SCHEMA_SQL. Apply with:
--   wrangler d1 migrations apply DB --local   (local dev, no account needed)
--   wrangler d1 migrations apply DB --remote  (real Cloudflare D1, needs auth)

ALTER TABLE learners ADD COLUMN other_licence_kind TEXT;
ALTER TABLE learners ADD COLUMN other_licence_place TEXT;
ALTER TABLE learners ADD COLUMN other_licence_number TEXT;
ALTER TABLE learners ADD COLUMN other_licence_class TEXT;
ALTER TABLE learners ADD COLUMN other_licence_issued_on TEXT;
ALTER TABLE learners ADD COLUMN other_licence_expires_on TEXT;
