# TASK.md

No active development task.

**Completed this session:** added the official ACT government CBT&A
competency full names (from the document Tony provided, NI2020-703
Schedule 1) as a display-only feature — a tap-to-expand legend on the
Progress card plus chip tooltips. Nothing about persisted data, validation,
or the PDF export changed. Built on `feature/competency-full-names` from
`staging`, merged back (`938fbdd`), deployed to Cloudflare Staging (Version
`7132341d-5830-4b94-897d-4598fa55eeb0`).

**Blocked — needs Tony's direct action, not something this session can
safely do itself:** merging the pre-existing `ADI601` instructor row into
the real "Tony" instructor record (reassigning `learners.instructor_id`
and `lessons.instructor_id`/`updated_by_instructor_id` from `ADI601` to
"Tony", then deleting the now-empty `ADI601` row). This is a direct write
to real production data on the shared D1 database, and this session's
sandboxing blocked the attempt. Options for Tony:

- Run it himself via `wrangler d1 execute instructor-assistant-db --remote`
  or the Cloudflare D1 console, using this exact sequence (safe: only
  reassigns a foreign key and removes an emptied row, never deletes a
  learner or lesson):
  ```sql
  UPDATE learners SET instructor_id = 'a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01'
    WHERE instructor_id = '9414bfce-a0a9-4ffe-8f5d-849343a6da38';
  UPDATE lessons SET instructor_id = 'a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01'
    WHERE instructor_id = '9414bfce-a0a9-4ffe-8f5d-849343a6da38';
  UPDATE lessons SET updated_by_instructor_id = 'a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01'
    WHERE updated_by_instructor_id = '9414bfce-a0a9-4ffe-8f5d-849343a6da38';
  DELETE FROM instructors WHERE id = '9414bfce-a0a9-4ffe-8f5d-849343a6da38';
  ```
- Or explicitly re-confirm he wants this session to run it, so the
  permission prompt can be answered directly rather than auto-denied.

Note: `ADI604`/the "V1test" learner were deliberately **not** touched —
Tony's "开始 舍弃之前测试的数据" (start [Production], discard the previous
test data) reads as that pairing being his own test data to leave behind
when moving to Production, not something to merge into "Tony".

**Production deployment — plan, not yet started.** Tony authorized
starting this, but one detail is needed before any infrastructure is
created (a new D1 database, a new Access Application, Worker
config/secrets are all named after it): **what should the Production
Worker/domain be?** e.g. a plain `<name>.workers.dev` subdomain (same
pattern as Staging, fastest, no extra cost) or a custom domain if Tony
already has one for ACTGDS. Once that's answered, the plan is:

1. Create a separate Production D1 database (never reuse the Staging one).
2. Apply all 4 migrations to it fresh — Production starts empty, per
   Tony's "discard previous test data" (no data copied over from Staging;
   if he later wants "Kun Liu"'s real history carried over, that's a
   separate, deliberate one-time export/import, not automatic).
3. Add a `[env.production]` section to `wrangler.toml` (or an equivalent
   split) with its own D1 binding, then `wrangler deploy --env production`.
4. Create a new Cloudflare Access Application + the same "Tony and Anna
   only" policy, scoped to the Production hostname (Access apps are
   per-hostname; the Staging one doesn't cover a new domain).
5. Build, test, and a first remote QA pass against Production itself with
   isolated test data (same discipline as every Staging round), before
   telling Tony it's ready for his and Anna's own use.
6. `main` is already merged and ready to deploy from; no further merge
   needed for this step.

**Explicitly out of scope / unchanged:** `main` and Production status from
before this round — `main` was already merged with Tony's authorization
in the previous round; this round did not touch main again since only
staging-side work happened.

**Follow-up for Tony:**

- Answer the Production domain/hosting question above so deployment can
  start.
- Decide on the `ADI601` merge per the options above.
- PDF export on his iPhone and `ADI604` identity — already addressed in
  earlier rounds.

等待 Tony 回复 Production 域名方案 和/或 ADI601 合并的处理方式。
