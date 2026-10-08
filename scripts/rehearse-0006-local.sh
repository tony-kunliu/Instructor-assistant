#!/usr/bin/env bash
# Local-only rehearsal of migration 0006 on a D1 seeded via 0001-0005.
# Uses an isolated --persist-to dir; never touches remote D1. Synthetic data only.
set -euo pipefail
cd "$(dirname "$0")/.."
P="${REHEARSAL_DIR:-$(mktemp -d)}"
rm -rf "$P"; mkdir -p "$P"
W() { npx wrangler d1 execute DB --local --persist-to "$P" "$@"; }
Q() { W --json --command "$1" | jq -c '.[0].results'; }
for f in migrations/000[1-5]*.sql; do W --file "$f" >/dev/null; done
W --command "
INSERT INTO learners (id, instructor_id, full_name) VALUES ('L1','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01','QA Rehearsal One'),('L2','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02','QA Rehearsal Two');
INSERT INTO lessons (id,learner_id,instructor_id,lesson_no,lesson_date,start_time,finish_time,start_odometer,finish_odometer,duration_minutes,distance_km,cumulative_minutes,cumulative_km,taught,competencies_assessed,achieved,location,comments,adi_signature,learner_signature,updated_at,updated_by_instructor_id) VALUES
('S1','L1','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01',1,'2026-01-05','09:00','10:00',1000,1030,60,30,60,30,'[\"1\"]','[\"1\"]','[\"1\"]','Canberra','c1','sigA','sigL','2026-01-05T01:00:00.000Z','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01'),
('S2','L1','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01',2,'2026-01-12','09:00','10:30',1030,1075,90,45,150,75,'[\"2\"]','[]','[]','Belconnen',NULL,'sigA','sigL',NULL,NULL),
('S3','L2','a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02',1,'2026-02-01','14:00','15:00',5000,5020,60,20,60,20,NULL,NULL,NULL,NULL,NULL,'sigA','sigL',NULL,NULL);
INSERT INTO competency_events (id,learner_id,lesson_id,competency_id,action,result) VALUES ('E1','L1','S1','1','taught',NULL),('E2','L1','S1','1','assessed','achieved'),('E3','L1','S2','2','taught',NULL);
INSERT INTO integration_outbox (id,event_id,event_type,learner_id,lesson_id,source_updated_at,payload_json) VALUES ('O1','ev-1','lesson.upserted','L1','S1','2026-01-05T01:00:00.000Z','{\"qa\":true}');" >/dev/null
SNAP="SELECT (SELECT count(*) FROM lessons) l,(SELECT count(*) FROM competency_events) e,(SELECT count(*) FROM integration_outbox) o,(SELECT count(*) FROM learners) n"
KEY="SELECT id,learner_id,instructor_id,lesson_no,lesson_date,start_time,finish_time,start_odometer,finish_odometer,duration_minutes,distance_km,cumulative_minutes,cumulative_km,taught,competencies_assessed,achieved,location,comments,adi_signature,learner_signature,created_at,updated_at,updated_by_instructor_id FROM lessons ORDER BY id"
echo "BEFORE counts: $(Q "$SNAP")"; Q "$KEY" > "$P/before.json"
Q "SELECT e.id,e.lesson_id,e.competency_id,e.action,e.result FROM competency_events e ORDER BY id" > "$P/ev-before.json"
Q "SELECT * FROM integration_outbox" > "$P/ob-before.json"
W --file migrations/0006_paper_records.sql >/dev/null
echo "AFTER counts:  $(Q "$SNAP")"; Q "$KEY" > "$P/after.json"
Q "SELECT e.id,e.lesson_id,e.competency_id,e.action,e.result FROM competency_events e ORDER BY id" > "$P/ev-after.json"
Q "SELECT * FROM integration_outbox" > "$P/ob-after.json"
cmp "$P/before.json" "$P/after.json" && echo "lessons key columns identical"
cmp "$P/ev-before.json" "$P/ev-after.json" && echo "competency_events identical"
cmp "$P/ob-before.json" "$P/ob-after.json" && echo "integration_outbox identical"
echo "foreign_key_check: $(Q 'PRAGMA foreign_key_check')"
echo "new columns: $(Q "SELECT record_source,signature_status,prior_instructor_label,prior_lesson_count,count(*) n FROM lessons GROUP BY 1,2,3,4")"
echo "indexes: $(Q "SELECT name FROM sqlite_master WHERE tbl_name IN ('lessons','competency_events') AND type='index' ORDER BY name")"
echo "nullable check: $(Q "SELECT name,\"notnull\" nn FROM pragma_table_info('lessons') WHERE name IN ('start_time','finish_time','start_odometer','finish_odometer','duration_minutes','distance_km')")"
echo "tables: $(Q "SELECT name FROM sqlite_master WHERE name='lessons_backup'")"
