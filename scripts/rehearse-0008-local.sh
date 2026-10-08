#!/usr/bin/env bash
# Local-only rehearsal of migration 0008 (learner_revisions) on a D1 seeded via 0001-0007.
# Uses an isolated --persist-to dir; never touches remote D1. Synthetic data only.
set -euo pipefail
cd "$(dirname "$0")/.."
P="${REHEARSAL_DIR:-$(mktemp -d)}"
rm -rf "$P"; mkdir -p "$P"
W() { npx wrangler d1 execute DB --local --persist-to "$P" "$@"; }
Q() { W --json --command "$1" | jq -c '.[0].results'; }
for f in migrations/000[1-7]*.sql; do W --file "$f" >/dev/null; done
W --command "
INSERT INTO learners (id, instructor_id, full_name, phone, licence_stage) VALUES ('L1','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01','QA Rehearsal One','0400 000 001','p1'),('L2','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02','QA Rehearsal Two',NULL,'learner');
INSERT INTO lessons (id,learner_id,instructor_id,lesson_no,lesson_date,start_time,finish_time,start_odometer,finish_odometer,duration_minutes,distance_km,cumulative_minutes,cumulative_km,taught,adi_signature,learner_signature) VALUES
('S1','L1','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01',1,'2026-01-05','09:00','10:00',1000,1030,60,30,60,30,'[\"1\"]','sigA','sigL');
INSERT INTO lesson_revisions (id,lesson_id,revision_no,edited_at,snapshot_json) VALUES ('LR1','S1',1,'2026-01-06T00:00:00.000Z','{}');
INSERT INTO integration_outbox (id,event_id,event_type,learner_id,lesson_id,source_updated_at,payload_json) VALUES ('O1','ev-1','lesson.upserted','L1','S1','2026-01-05T01:00:00.000Z','{\"qa\":true}');" >/dev/null
SNAP="SELECT (SELECT count(*) FROM learners) n,(SELECT count(*) FROM lessons) l,(SELECT count(*) FROM lesson_revisions) lr,(SELECT count(*) FROM integration_outbox) o,(SELECT count(*) FROM instructors) i"
EXISTING="SELECT name, sql FROM sqlite_master WHERE type='table' AND name <> 'learner_revisions' ORDER BY name"
echo "BEFORE counts: $(Q "$SNAP")"
Q "SELECT * FROM learners ORDER BY id" > "$P/learners-before.json"
Q "SELECT * FROM lessons ORDER BY id" > "$P/lessons-before.json"
Q "SELECT * FROM integration_outbox" > "$P/ob-before.json"
Q "$EXISTING" > "$P/schema-before.json"
W --file migrations/0008_learner_revisions.sql >/dev/null
echo "AFTER counts:  $(Q "$SNAP")"
Q "SELECT * FROM learners ORDER BY id" > "$P/learners-after.json"
Q "SELECT * FROM lessons ORDER BY id" > "$P/lessons-after.json"
Q "SELECT * FROM integration_outbox" > "$P/ob-after.json"
Q "$EXISTING" > "$P/schema-after.json"
cmp "$P/learners-before.json" "$P/learners-after.json" && echo "learners table: every column of every row identical"
cmp "$P/lessons-before.json" "$P/lessons-after.json" && echo "lessons table identical"
cmp "$P/ob-before.json" "$P/ob-after.json" && echo "integration_outbox identical"
cmp "$P/schema-before.json" "$P/schema-after.json" && echo "existing table definitions identical (additive only)"
echo "foreign_key_check: $(Q 'PRAGMA foreign_key_check')"
echo "learner_revisions columns: $(Q "SELECT name FROM pragma_table_info('learner_revisions') ORDER BY cid")"
echo "learner_revisions rows: $(Q 'SELECT count(*) n FROM learner_revisions')"
echo "indexes: $(Q "SELECT name FROM sqlite_master WHERE tbl_name='learner_revisions' AND type='index' ORDER BY name")"
W --file migrations/0008_learner_revisions.sql >/dev/null && echo "re-apply: no error"
# The exact INSERT ... SELECT used by lib/repo.ts#updateLearner works against the migrated data.
W --command "INSERT INTO learner_revisions (id,learner_id,revision_no,edited_at,edited_by_instructor_id,snapshot_json)
 SELECT 'R1', learners.id, (SELECT COALESCE(MAX(r.revision_no),0)+1 FROM learner_revisions r WHERE r.learner_id = learners.id), '2026-01-07T00:00:00.000Z', learners.instructor_id,
 json_object('fullName', learners.full_name, 'phone', learners.phone, 'licenceStage', learners.licence_stage) FROM learners WHERE learners.id = 'L1';
 UPDATE learners SET full_name = 'QA Rehearsal Renamed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'L1';" >/dev/null
echo "revision readable: $(Q "SELECT learner_id,revision_no,snapshot_json FROM learner_revisions")"
echo "outbox after learner edit: $(Q 'SELECT count(*) n FROM integration_outbox')"
