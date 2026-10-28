-- Migration number: 0003
-- Tracks when a lesson was last edited (see lib/repo.ts#updateLesson —
-- CBT&A V3 history lesson editing). NULL until the lesson is edited for
-- the first time.
--
-- Must stay in sync with lib/schema.ts SCHEMA_SQL — tests/d1-storage.test.ts
-- checks migrations/0001+0002+0003 concatenated equal SCHEMA_SQL. Apply with:
--   wrangler d1 migrations apply DB --local   (local dev, no account needed)
--   wrangler d1 migrations apply DB --remote  (real Cloudflare D1, needs auth)

ALTER TABLE lessons ADD COLUMN updated_at TEXT;
