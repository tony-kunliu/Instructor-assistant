#!/usr/bin/env bash
# Local-only rehearsal of migration 0011 (learner_transfer_events) on a D1 seeded via 0001-0010.
# Uses an isolated --persist-to dir; never touches remote D1. Synthetic data only.
set -euo pipefail
cd "$(dirname "$0")/.."
P="${REHEARSAL_DIR:-$(mktemp -d)}"
rm -rf "$P"; mkdir -p "$P"
W() { npx wrangler d1 execute DB --local --persist-to "$P" "$@"; }
Q() { W --json --command "$1" | jq -c '.[0].results'; }
TONY=a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01
ANNA=a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02
for f in migrations/000[1-9]*.sql migrations/0010_*.sql; do W --file "$f" >/dev/null; done
W --command "
INSERT INTO learners (id, instructor_id, full_name, phone, licence_stage, logged_hours, logged_hours_on) VALUES ('L1','$TONY','QA Rehearsal One','0400 000 001','p1',12,'2026-10-01'),('L2','$ANNA','QA Rehearsal Two',NULL,'learner',NULL,NULL);
UPDATE learners SET archived_at = '2026-09-01T00:00:00.000Z' WHERE id = 'L2';
INSERT INTO learner_archive_events (id, learner_id, action, reason, at, by_instructor_id) VALUES ('A1','L2','archived','moved_away','2026-09-01T00:00:00.000Z','$ANNA');
INSERT INTO lessons (id,learner_id,instructor_id,lesson_no,lesson_date,start_time,finish_time,start_odometer,finish_odometer,duration_minutes,distance_km,cumulative_minutes,cumulative_km,taught,adi_signature,learner_signature) VALUES
('S1','L1','$TONY',1,'2026-01-05','09:00','10:00',1000,1030,60,30,60,30,'[\"1\"]','sigA','sigL');
INSERT INTO lesson_revisions (id,lesson_id,revision_no,edited_at,snapshot_json) VALUES ('V1','S1',1,'2026-01-06T00:00:00.000Z','{\"location\":\"Old\"}');
INSERT INTO learner_revisions (id,learner_id,revision_no,edited_at,snapshot_json) VALUES ('LR1','L1',1,'2026-01-06T00:00:00.000Z','{\"fullName\":\"Old\"}');
INSERT INTO integration_outbox (id,event_id,event_type,learner_id,lesson_id,source_updated_at,payload_json) VALUES ('O1','ev-1','lesson.upserted','L1','S1','2026-01-05T01:00:00.000Z','{\"qa\":true}');" >/dev/null
SNAP="SELECT (SELECT count(*) FROM learners) n,(SELECT count(*) FROM lessons) l,(SELECT count(*) FROM lesson_revisions) v,(SELECT count(*) FROM learner_revisions) lr,(SELECT count(*) FROM learner_archive_events) ae,(SELECT count(*) FROM integration_outbox) o,(SELECT count(*) FROM instructors) i"
EXISTING="SELECT name, sql FROM sqlite_master WHERE type='table' AND name <> 'learner_transfer_events' ORDER BY name"
TABLES="learners lessons lesson_revisions learner_revisions learner_archive_events integration_outbox instructors"
echo "BEFORE counts: $(Q "$SNAP")"
for t in $TABLES; do Q "SELECT * FROM $t ORDER BY id" > "$P/$t-before.json"; done
Q "$EXISTING" > "$P/schema-before.json"
W --file migrations/0011_learner_transfer_events.sql >/dev/null
echo "AFTER counts:  $(Q "$SNAP")"
for t in $TABLES; do Q "SELECT * FROM $t ORDER BY id" > "$P/$t-after.json"; cmp "$P/$t-before.json" "$P/$t-after.json" && echo "$t: every column of every row identical"; done
Q "$EXISTING" > "$P/schema-after.json"
cmp "$P/schema-before.json" "$P/schema-after.json" && echo "existing table definitions identical (additive only)"
echo "foreign_key_check: $(Q 'PRAGMA foreign_key_check')"
echo "learner_transfer_events columns: $(Q "SELECT name FROM pragma_table_info('learner_transfer_events') ORDER BY cid")"
echo "learner_transfer_events rows (expect 0, none invented): $(Q 'SELECT count(*) n FROM learner_transfer_events')"
echo "indexes: $(Q "SELECT name FROM sqlite_master WHERE tbl_name='learner_transfer_events' AND type='index' ORDER BY name")"
W --file migrations/0011_learner_transfer_events.sql >/dev/null && echo "re-apply: no error"
# The exact transfer batch used by lib/repo.ts#transferLearner (event INSERT first, then the UPDATE, same compare-and-set guard).
TRANSFER() { # $1 event id, $2 learner, $3 expected from, $4 to, $5 at
  local G="learners.id = '$2' AND learners.instructor_id = '$3' AND learners.archived_at IS NULL AND EXISTS (SELECT 1 FROM instructors WHERE instructors.id = '$4' AND instructors.status = 'active')"
  W --command "INSERT INTO learner_transfer_events (id, learner_id, from_instructor_id, to_instructor_id, at, by_instructor_id, note)
   SELECT '$1', learners.id, learners.instructor_id, '$4', '$5', '$3', NULL FROM learners WHERE $G;
   UPDATE learners SET instructor_id = '$4', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE $G;" >/dev/null
}
TRANSFER T1 L1 "$TONY" "$ANNA" 2026-10-11T01:00:00.000Z
TRANSFER T2 L1 "$TONY" "$ANNA" 2026-10-11T02:00:00.000Z   # stale "from" (lost race): must write nothing
TRANSFER T3 L2 "$ANNA" "$TONY" 2026-10-11T03:00:00.000Z   # archived learner: must write nothing
echo "events after transfer, stale repeat, archived (expect only T1): $(Q "SELECT id, learner_id, from_instructor_id = '$TONY' AS from_tony, to_instructor_id = '$ANNA' AS to_anna FROM learner_transfer_events ORDER BY at")"
echo "owners (expect L1 Anna, L2 still Anna + archived): $(Q "SELECT id, instructor_id = '$ANNA' AS anna, archived_at IS NOT NULL AS archived FROM learners ORDER BY id")"
# The D7 Checked UPDATE used by lib/repo.ts#markTransferRecordsChecked: Tony (not the receiver) changes nothing, Anna does.
CHECK() { W --command "UPDATE learner_transfer_events SET records_checked_at = '2026-10-11T04:00:00.000Z', records_checked_by = '$1'
  WHERE id = (SELECT e.id FROM learner_transfer_events e WHERE e.learner_id = 'L1' ORDER BY e.at DESC, e.rowid DESC LIMIT 1)
  AND records_checked_at IS NULL AND to_instructor_id = (SELECT instructor_id FROM learners WHERE id = 'L1') AND to_instructor_id = '$1';" >/dev/null; }
CHECK "$TONY"; echo "checked by Tony (expect null): $(Q "SELECT records_checked_by FROM learner_transfer_events WHERE id = 'T1'")"
CHECK "$ANNA"; echo "checked by Anna (expect Anna=1): $(Q "SELECT records_checked_by = '$ANNA' AS anna FROM learner_transfer_events WHERE id = 'T1'")"
for t in lessons lesson_revisions learner_revisions learner_archive_events integration_outbox; do
  Q "SELECT * FROM $t ORDER BY id" > "$P/$t-final.json"; cmp "$P/$t-before.json" "$P/$t-final.json" && echo "$t still identical after transfer + Checked"
done
