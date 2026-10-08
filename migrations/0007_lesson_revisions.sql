-- Migration number: 0007
-- Lesson edit ownership + revision history (ACT Code of Practice 9.1 g / 9.2 c-d:
-- correct by striking out and initialling; never change another instructor's
-- entry). Additive only: one new table, one index. The lessons table and all
-- existing data are untouched.
-- Every successful History Edit stores a revision: the lesson's PREVIOUS content
-- (snapshot_json: every editable field plus signature_status, and only whether each
-- signature image was present, never the image itself), who edited, when, and an
-- optional reason (max 200 chars, validated in lib/repo.ts).
--
-- Future lessons rebuild: lesson_revisions.lesson_id references lessons (id),
-- exactly like competency_events. Any later migration that rebuilds lessons
-- must use the 0006 pattern (PRAGMA defer_foreign_keys = ON, copy to a backup
-- table, DROP, re-create, re-insert from the backup); that pattern covers
-- lesson_revisions as well, and a lessons_new + RENAME rebuild would fail at COMMIT.
--
-- Must stay in sync with lib/schema.ts SCHEMA_SQL — tests/d1-storage.test.ts
-- checks migrations/0001..0007 concatenated equal SCHEMA_SQL. Apply with:
--   wrangler d1 migrations apply DB --local   (local dev, no account needed)
--   wrangler d1 migrations apply DB --remote  (real Cloudflare D1, needs auth)

CREATE TABLE IF NOT EXISTS lesson_revisions (
  id                       TEXT PRIMARY KEY,
  lesson_id                TEXT NOT NULL REFERENCES lessons (id),
  revision_no              INTEGER NOT NULL,
  edited_at                TEXT NOT NULL,
  edited_by_instructor_id  TEXT REFERENCES instructors (id),
  reason                   TEXT,
  snapshot_json            TEXT NOT NULL,
  UNIQUE (lesson_id, revision_no)
);
CREATE INDEX IF NOT EXISTS lesson_revisions_lesson_idx ON lesson_revisions (lesson_id, revision_no);
