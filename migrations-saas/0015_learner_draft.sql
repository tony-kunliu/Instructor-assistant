-- Migration number: 0015
-- Learner drafts (Tony 2026-10-22): a learner can be saved as a DRAFT, incomplete, with notes about what could not be
-- read (a personal assistant types up a photo of the paper record; unclear parts are left empty and noted). A draft is
-- not a record yet: it cannot take lessons or an import until the instructor reviews it and confirms it.
-- Additive only: two nullable TEXT columns on learners, no defaults, no backfill, no table rebuild.
--   draft_at     NULL = a normal learner | ISO time the draft was saved
--   draft_notes  NULL | free text, what to check before confirming (<= 2000 chars)
-- Existing rows get NULL = normal learner. Never sent to ACTGDS.
--
-- ALTER TABLE ... ADD COLUMN is not idempotent: wrangler records applied migrations, so it runs once.
--
-- Must stay in sync with lib/schema.ts SCHEMA_SQL; tests/d1-storage.test.ts checks
-- migrations/0001..0015 concatenated equal SCHEMA_SQL. Apply with:
--   wrangler d1 migrations apply DB --local   (local dev, no account needed)
ALTER TABLE learners ADD COLUMN draft_at TEXT;
ALTER TABLE learners ADD COLUMN draft_notes TEXT;
