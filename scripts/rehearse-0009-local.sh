#!/usr/bin/env bash
# Local-only rehearsal of migration 0009 (learner Competency 23 eligibility columns) on a D1 seeded via 0001-0008.
# Uses an isolated --persist-to dir; never touches remote D1. Synthetic data only.
set -euo pipefail
cd "$(dirname "$0")/.."
P="${REHEARSAL_DIR:-$(mktemp -d)}"
rm -rf "$P"; mkdir -p "$P"
W() { npx wrangler d1 execute DB --local --persist-to "$P" "$@"; }
Q() { W --json --command "$1" | jq -c '.[0].results'; }
for f in migrations/000[1-8]*.sql; do W --file "$f" >/dev/null; done
W --command "
INSERT INTO learners (id, instructor_id, full_name, phone, licence_stage, licence_expiry) VALUES ('L1','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01','QA Rehearsal One','0400 000 001','p1',NULL),('L2','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02','QA Rehearsal Two',NULL,'learner','2027-03-01');
INSERT INTO lessons (id,learner_id,instructor_id,lesson_no,lesson_date,start_time,finish_time,start_odometer,finish_odometer,duration_minutes,distance_km,cumulative_minutes,cumulative_km,taught,adi_signature,learner_signature) VALUES
('S1','L1','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01',1,'2026-01-05','09:00','10:00',1000,1030,60,30,60,30,'[\"1\"]','sigA','sigL');
INSERT INTO learner_revisions (id,learner_id,revision_no,edited_at,snapshot_json) VALUES ('LR1','L1',1,'2026-01-06T00:00:00.000Z','{\"fullName\":\"Old\"}');
INSERT INTO integration_outbox (id,event_id,event_type,learner_id,lesson_id,source_updated_at,payload_json) VALUES ('O1','ev-1','lesson.upserted','L1','S1','2026-01-05T01:00:00.000Z','{\"qa\":true}');" >/dev/null
SNAP="SELECT (SELECT count(*) FROM learners) n,(SELECT count(*) FROM lessons) l,(SELECT count(*) FROM learner_revisions) lr,(SELECT count(*) FROM integration_outbox) o,(SELECT count(*) FROM instructors) i"
OLDCOLS="id,instructor_id,full_name,address,phone,dob,licence_number,licence_expiry,eligibility,transmission,school_work,licence_stage,archived_at,created_at,updated_at"
OTHERS="SELECT name, sql FROM sqlite_master WHERE type='table' AND name <> 'learners' ORDER BY name"
echo "BEFORE counts: $(Q "$SNAP")"
Q "SELECT $OLDCOLS FROM learners ORDER BY id" > "$P/learners-before.json"
Q "SELECT * FROM lessons ORDER BY id" > "$P/lessons-before.json"
Q "SELECT * FROM learner_revisions" > "$P/rev-before.json"
Q "SELECT * FROM integration_outbox" > "$P/ob-before.json"
Q "$OTHERS" > "$P/schema-before.json"
W --file migrations/0009_learner_rules_fields.sql >/dev/null
echo "AFTER counts:  $(Q "$SNAP")"
Q "SELECT $OLDCOLS FROM learners ORDER BY id" > "$P/learners-after.json"
Q "SELECT * FROM lessons ORDER BY id" > "$P/lessons-after.json"
Q "SELECT * FROM learner_revisions" > "$P/rev-after.json"
Q "SELECT * FROM integration_outbox" > "$P/ob-after.json"
Q "$OTHERS" > "$P/schema-after.json"
cmp "$P/learners-before.json" "$P/learners-after.json" && echo "learners: every pre-existing column of every row identical"
cmp "$P/lessons-before.json" "$P/lessons-after.json" && echo "lessons table identical"
cmp "$P/rev-before.json" "$P/rev-after.json" && echo "learner_revisions identical"
cmp "$P/ob-before.json" "$P/ob-after.json" && echo "integration_outbox identical"
cmp "$P/schema-before.json" "$P/schema-after.json" && echo "all other table definitions identical (additive only)"
echo "foreign_key_check: $(Q 'PRAGMA foreign_key_check')"
echo "new columns: $(Q "SELECT name,type,\"notnull\" nn,dflt_value d FROM pragma_table_info('learners') WHERE name IN ('learner_licence_issued_on','learner_licence_first_issued_on','hpt_passed_on','logged_hours','logged_hours_on') ORDER BY cid")"
echo "new column values (expect all NULL): $(Q "SELECT id,learner_licence_issued_on a,learner_licence_first_issued_on b,hpt_passed_on c,logged_hours d,logged_hours_on e FROM learners ORDER BY id")"
if W --file migrations/0009_learner_rules_fields.sql >/dev/null 2>&1; then echo "re-apply: UNEXPECTEDLY succeeded"; exit 1; else echo "re-apply: refused (duplicate column), as expected; wrangler records applied migrations"; fi
# The edit path: revision snapshot with the new keys, then UPDATE of the new columns.
W --command "INSERT INTO learner_revisions (id,learner_id,revision_no,edited_at,edited_by_instructor_id,snapshot_json)
 SELECT 'R2', learners.id, (SELECT COALESCE(MAX(r.revision_no),0)+1 FROM learner_revisions r WHERE r.learner_id = learners.id), '2026-01-07T00:00:00.000Z', learners.instructor_id,
 json_object('fullName', learners.full_name, 'learnerLicenceIssuedOn', learners.learner_licence_issued_on, 'loggedHours', learners.logged_hours) FROM learners WHERE learners.id = 'L1';
 UPDATE learners SET learner_licence_issued_on = '2025-11-15', hpt_passed_on = '2026-05-05', logged_hours = 82, logged_hours_on = '2026-10-03', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'L1';" >/dev/null
echo "revision readable: $(Q "SELECT learner_id,revision_no,snapshot_json FROM learner_revisions ORDER BY revision_no")"
echo "learner after edit: $(Q "SELECT learner_licence_issued_on a,hpt_passed_on c,logged_hours d,logged_hours_on e FROM learners WHERE id='L1'")"
echo "outbox after learner edit: $(Q 'SELECT count(*) n FROM integration_outbox')"
