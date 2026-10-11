#!/usr/bin/env bash
# Local-only rehearsal of migration 0010 (learner_archive_events) on a D1 seeded via 0001-0009.
# Uses an isolated --persist-to dir; never touches remote D1. Synthetic data only.
set -euo pipefail
cd "$(dirname "$0")/.."
P="${REHEARSAL_DIR:-$(mktemp -d)}"
rm -rf "$P"; mkdir -p "$P"
W() { npx wrangler d1 execute DB --local --persist-to "$P" "$@"; }
Q() { W --json --command "$1" | jq -c '.[0].results'; }
for f in migrations/000[1-9]*.sql; do W --file "$f" >/dev/null; done
W --command "
INSERT INTO learners (id, instructor_id, full_name, phone, licence_stage, logged_hours, logged_hours_on) VALUES ('L1','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01','QA Rehearsal One','0400 000 001','p1',12,'2026-10-01'),('L2','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02','QA Rehearsal Two',NULL,'learner',NULL,NULL);
UPDATE learners SET archived_at = '2026-09-01T00:00:00.000Z' WHERE id = 'L2';
INSERT INTO lessons (id,learner_id,instructor_id,lesson_no,lesson_date,start_time,finish_time,start_odometer,finish_odometer,duration_minutes,distance_km,cumulative_minutes,cumulative_km,taught,adi_signature,learner_signature) VALUES
('S1','L1','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01',1,'2026-01-05','09:00','10:00',1000,1030,60,30,60,30,'[\"1\"]','sigA','sigL');
INSERT INTO learner_revisions (id,learner_id,revision_no,edited_at,snapshot_json) VALUES ('LR1','L1',1,'2026-01-06T00:00:00.000Z','{\"fullName\":\"Old\"}');
INSERT INTO integration_outbox (id,event_id,event_type,learner_id,lesson_id,source_updated_at,payload_json) VALUES ('O1','ev-1','lesson.upserted','L1','S1','2026-01-05T01:00:00.000Z','{\"qa\":true}');" >/dev/null
SNAP="SELECT (SELECT count(*) FROM learners) n,(SELECT count(*) FROM lessons) l,(SELECT count(*) FROM learner_revisions) lr,(SELECT count(*) FROM integration_outbox) o,(SELECT count(*) FROM instructors) i"
EXISTING="SELECT name, sql FROM sqlite_master WHERE type='table' AND name <> 'learner_archive_events' ORDER BY name"
echo "BEFORE counts: $(Q "$SNAP")"
Q "SELECT * FROM learners ORDER BY id" > "$P/learners-before.json"
Q "SELECT * FROM lessons ORDER BY id" > "$P/lessons-before.json"
Q "SELECT * FROM learner_revisions" > "$P/rev-before.json"
Q "SELECT * FROM integration_outbox" > "$P/ob-before.json"
Q "$EXISTING" > "$P/schema-before.json"
W --file migrations/0010_learner_archive_events.sql >/dev/null
echo "AFTER counts:  $(Q "$SNAP")"
Q "SELECT * FROM learners ORDER BY id" > "$P/learners-after.json"
Q "SELECT * FROM lessons ORDER BY id" > "$P/lessons-after.json"
Q "SELECT * FROM learner_revisions" > "$P/rev-after.json"
Q "SELECT * FROM integration_outbox" > "$P/ob-after.json"
Q "$EXISTING" > "$P/schema-after.json"
cmp "$P/learners-before.json" "$P/learners-after.json" && echo "learners table: every column of every row identical"
cmp "$P/lessons-before.json" "$P/lessons-after.json" && echo "lessons table identical"
cmp "$P/rev-before.json" "$P/rev-after.json" && echo "learner_revisions identical"
cmp "$P/ob-before.json" "$P/ob-after.json" && echo "integration_outbox identical"
cmp "$P/schema-before.json" "$P/schema-after.json" && echo "existing table definitions identical (additive only)"
echo "foreign_key_check: $(Q 'PRAGMA foreign_key_check')"
echo "learner_archive_events columns: $(Q "SELECT name FROM pragma_table_info('learner_archive_events') ORDER BY cid")"
echo "learner_archive_events rows (expect 0, none invented for the already-archived L2): $(Q 'SELECT count(*) n FROM learner_archive_events')"
echo "indexes: $(Q "SELECT name FROM sqlite_master WHERE tbl_name='learner_archive_events' AND type='index' ORDER BY name")"
W --file migrations/0010_learner_archive_events.sql >/dev/null && echo "re-apply: no error"
# The exact archive batch used by lib/repo.ts#setLearnerArchived (event INSERT first, then the UPDATE), then a repeat (no event) and a restore.
ARCHIVE() { # $1 event id, $2 archived 1/0, $3 action, $4 reason SQL literal, $5 at
  W --command "INSERT INTO learner_archive_events (id, learner_id, action, reason, note, at, by_instructor_id)
   SELECT '$1', learners.id, '$3', $4, NULL, '$5', (SELECT instructors.id FROM instructors WHERE instructors.id = 'a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01')
   FROM learners WHERE learners.id = 'L1' AND (learners.archived_at IS NULL) = $2;
   UPDATE learners SET archived_at = CASE WHEN $2 THEN COALESCE(archived_at, '$5') ELSE NULL END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'L1';" >/dev/null
}
ARCHIVE E1 1 archived "'moved_away'" 2026-10-11T01:00:00.000Z
ARCHIVE E2 1 archived "'stopped'" 2026-10-11T02:00:00.000Z
ARCHIVE E3 0 restored NULL 2026-10-11T03:00:00.000Z
ARCHIVE E4 1 archived "'other'" 2026-10-11T04:00:00.000Z
echo "events after archive, repeat archive, restore, archive (expect E4,E3,E1; no E2): $(Q "SELECT id,action,reason,at FROM learner_archive_events ORDER BY at DESC, rowid DESC")"
# The read used by LEARNER_SELECT: the latest event, only if 'archived' and only while archived.
echo "current reason per learner (expect L1 'other' = latest archive event; L2 NULL = archived before 0010, none invented): $(Q "SELECT l.id, l.archived_at, ae.reason FROM learners l LEFT JOIN learner_archive_events ae ON l.archived_at IS NOT NULL AND ae.action = 'archived' AND ae.rowid = (SELECT e.rowid FROM learner_archive_events e WHERE e.learner_id = l.id ORDER BY e.at DESC, e.rowid DESC LIMIT 1) ORDER BY l.id")"
echo "learner_revisions after archive/restore (expect 1): $(Q 'SELECT count(*) n FROM learner_revisions')"
echo "outbox after archive/restore (expect 1): $(Q 'SELECT count(*) n FROM integration_outbox')"
