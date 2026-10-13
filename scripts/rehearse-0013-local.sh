#!/usr/bin/env bash
# Local-only rehearsal of migration 0013 (learners.other_licence_* : kind, place, number, class, issued_on, expires_on)
# on a D1 seeded via 0001-0012. Uses an isolated --persist-to dir; never touches remote D1. Synthetic data only.
set -euo pipefail
cd "$(dirname "$0")/.."
P="${REHEARSAL_DIR:-$(mktemp -d)}"
rm -rf "$P"; mkdir -p "$P"
W() { npx wrangler d1 execute DB --local --persist-to "$P" "$@"; }
Q() { W --json --command "$1" | jq -c '.[0].results'; }
TONY=a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01
ANNA=a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02
for f in migrations/000[1-9]*.sql migrations/0010_*.sql migrations/0011_*.sql migrations/0012_*.sql; do W --file "$f" >/dev/null; done
W --command "
INSERT INTO learners (id, instructor_id, full_name, address, address_suburb, address_state, address_postcode, phone, dob, licence_stage, learner_licence_issued_on, logged_hours, logged_hours_on) VALUES ('L1','$TONY','QA Rehearsal One','44 Appleford Av, Jacka ACT 2914','Jacka','ACT','2914','0400 000 001','2008-05-06','learner','2026-03-01',12,'2026-10-01'),('L2','$ANNA','QA Rehearsal Two',NULL,NULL,NULL,NULL,NULL,NULL,'learner',NULL,NULL,NULL);
UPDATE learners SET archived_at = '2026-09-01T00:00:00.000Z' WHERE id = 'L2';
INSERT INTO learner_archive_events (id, learner_id, action, reason, at, by_instructor_id) VALUES ('A1','L2','archived','moved_away','2026-09-01T00:00:00.000Z','$ANNA');
INSERT INTO learner_transfer_events (id, learner_id, from_instructor_id, to_instructor_id, at) VALUES ('T1','L1','$ANNA','$TONY','2026-09-02T00:00:00.000Z');
INSERT INTO lessons (id,learner_id,instructor_id,lesson_no,lesson_date,start_time,finish_time,start_odometer,finish_odometer,duration_minutes,distance_km,cumulative_minutes,cumulative_km,taught,adi_signature,learner_signature) VALUES
('S1','L1','$TONY',1,'2026-01-05','09:00','10:00',1000,1030,60,30,60,30,'[\"1\"]','sigA','sigL');
INSERT INTO lesson_revisions (id,lesson_id,revision_no,edited_at,snapshot_json) VALUES ('V1','S1',1,'2026-01-06T00:00:00.000Z','{\"location\":\"Old\"}');
INSERT INTO learner_revisions (id,learner_id,revision_no,edited_at,snapshot_json) VALUES ('LR1','L1',1,'2026-01-06T00:00:00.000Z','{\"fullName\":\"Old\"}');
INSERT INTO integration_outbox (id,event_id,event_type,learner_id,lesson_id,source_updated_at,payload_json) VALUES ('O1','ev-1','lesson.upserted','L1','S1','2026-01-05T01:00:00.000Z','{\"qa\":true}');" >/dev/null
SNAP="SELECT (SELECT count(*) FROM learners) n,(SELECT count(*) FROM lessons) l,(SELECT count(*) FROM lesson_revisions) v,(SELECT count(*) FROM learner_revisions) lr,(SELECT count(*) FROM learner_archive_events) ae,(SELECT count(*) FROM learner_transfer_events) te,(SELECT count(*) FROM integration_outbox) o,(SELECT count(*) FROM instructors) i"
OTHERS="SELECT name, sql FROM sqlite_master WHERE type='table' AND name <> 'learners' ORDER BY name"
INDEXES="SELECT name, sql FROM sqlite_master WHERE type='index' ORDER BY name"
TABLES="lessons lesson_revisions learner_revisions learner_archive_events learner_transfer_events integration_outbox instructors"
NEW="other_licence_kind other_licence_place other_licence_number other_licence_class other_licence_issued_on other_licence_expires_on"
NEW_IN="'other_licence_kind','other_licence_place','other_licence_number','other_licence_class','other_licence_issued_on','other_licence_expires_on'"
echo "BEFORE counts: $(Q "$SNAP")"
for t in $TABLES; do Q "SELECT * FROM $t ORDER BY id" > "$P/$t-before.json"; done
Q "SELECT * FROM learners ORDER BY id" > "$P/learners-before.json"
Q "SELECT name FROM pragma_table_info('learners') ORDER BY cid" > "$P/learners-columns-before.json"
Q "$OTHERS" > "$P/schema-before.json"
Q "$INDEXES" > "$P/indexes-before.json"
W --file migrations/0013_learner_other_licence.sql >/dev/null
echo "AFTER counts:  $(Q "$SNAP")"
for t in $TABLES; do Q "SELECT * FROM $t ORDER BY id" > "$P/$t-after.json"; cmp "$P/$t-before.json" "$P/$t-after.json" && echo "$t: every column of every row identical" || { echo "MISMATCH: $t: every column of every row identical"; exit 1; }; done
Q "$OTHERS" > "$P/schema-after.json"
cmp "$P/schema-before.json" "$P/schema-after.json" && echo "other table definitions identical (additive only)" || { echo "MISMATCH: other table definitions identical (additive only)"; exit 1; }
Q "$INDEXES" > "$P/indexes-after.json"
cmp "$P/indexes-before.json" "$P/indexes-after.json" && echo "index definitions identical" || { echo "MISMATCH: index definitions identical"; exit 1; }
echo "learners columns before: $(cat "$P/learners-columns-before.json")"
echo "learners columns after:  $(Q "SELECT name FROM pragma_table_info('learners') ORDER BY cid")"
echo "new columns (expect 6 x TEXT, nullable, no default): $(Q "SELECT name, type, \"notnull\" AS nn, dflt_value AS dflt FROM pragma_table_info('learners') WHERE name IN ($NEW_IN) ORDER BY cid")"
# Existing learner rows: every old column identical, the six new ones NULL.
Q "SELECT id, instructor_id, full_name, address, phone, dob, licence_number, licence_expiry, eligibility, transmission, school_work, licence_stage, archived_at, created_at, updated_at, learner_licence_issued_on, learner_licence_first_issued_on, hpt_passed_on, logged_hours, logged_hours_on, address_suburb, address_state, address_postcode FROM learners ORDER BY id" > "$P/learners-old-columns-after.json"
jq -c '[.[] | del(.other_licence_kind, .other_licence_place, .other_licence_number, .other_licence_class, .other_licence_issued_on, .other_licence_expires_on)]' "$P/learners-before.json" > "$P/learners-before-norm.json"
cmp "$P/learners-before-norm.json" <(jq -c . "$P/learners-old-columns-after.json") && echo "learners: every existing column of every row identical" || { echo "MISMATCH: learners: every existing column of every row identical"; exit 1; }
echo "new columns on existing rows (expect all null): $(Q "SELECT id, $(echo $NEW | tr ' ' ',') FROM learners ORDER BY id")"
echo "foreign_key_check: $(Q 'PRAGMA foreign_key_check')"
# Re-apply: ADD COLUMN is refused by SQLite (duplicate column) by design; wrangler records applied migrations so it never runs twice.
if W --file migrations/0013_learner_other_licence.sql >/dev/null 2>"$P/reapply.err"; then echo "re-apply: UNEXPECTEDLY succeeded"; exit 1; else grep -qi "duplicate column" "$P/reapply.err" && echo "re-apply refused with 'duplicate column' (by design)" || { echo "MISMATCH: re-apply refused with 'duplicate column' (by design)"; exit 1; }; fi
# The exact UPDATE shapes lib/repo.ts#updateLearner issues: record an interstate learner licence, then the form's "No" (details cleared, old values only in learner_revisions).
W --command "UPDATE learners SET other_licence_kind = 'interstate', other_licence_place = 'NSW', other_licence_number = 'QA NSW 1', other_licence_class = 'learner', other_licence_issued_on = '2025-10-13', other_licence_expires_on = '2030-10-13', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'L1';" >/dev/null
echo "after record (expect interstate/NSW/learner/2025-10-13): $(Q "SELECT $(echo $NEW | tr ' ' ',') FROM learners WHERE id = 'L1'")"
W --command "UPDATE learners SET other_licence_kind = 'none', other_licence_place = NULL, other_licence_number = NULL, other_licence_class = NULL, other_licence_issued_on = NULL, other_licence_expires_on = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = 'L1';" >/dev/null
echo "after 'No' (expect none + nulls): $(Q "SELECT $(echo $NEW | tr ' ' ',') FROM learners WHERE id = 'L1'")"
echo "L2 untouched (expect nulls + archived): $(Q "SELECT other_licence_kind, other_licence_class, archived_at IS NOT NULL AS archived FROM learners WHERE id = 'L2'")"
for t in $TABLES; do Q "SELECT * FROM $t ORDER BY id" > "$P/$t-final.json"; cmp "$P/$t-before.json" "$P/$t-final.json" && echo "$t still identical after record + 'No'" || { echo "MISMATCH: $t still identical after record + 'No'"; exit 1; }; done
