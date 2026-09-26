# TASK.md

No active development task.

**Completed this session:** Instructor Identity V1 — data model + lesson/
history attribution. Adds `instructors.status` and `lessons.
updated_by_instructor_id` (additive migration), seeds the first two named
instructors (Tony, Anna) with their real login emails, and wires an
optional `actingInstructorId` through lesson create/edit so a lesson's
`instructor_id` and a history edit's `updated_by_instructor_id` can be
attributed to whoever actually performed it — validated server-side
against real, active instructors only, never a client-submitted name/
email. Built on `feature/instructor-identity` from `staging`, merged back
into `staging` (`ad89cd5`), migration applied to the real remote D1,
Cloudflare Staging redeployed, and remote-verified with isolated test data
(a learner + lessons deliberately attributed across two different
instructors) — Tony's real learners and instructor rows confirmed
untouched. Not merged into `main` and Production was not touched. See
STATUS.md for full detail.

**Cloudflare Access itself is deferred, per Tony's own decision mid-round:**
Zero Trust Access is not yet enabled on the Cloudflare account (a one-time
manual dashboard step Cloudflare requires from the account owner — cannot
be done via API token). When asked how to proceed, Tony chose to ship the
data model + attribution plumbing now and leave Access for a later round.
Consequently: no "Signed in as Tony/Anna" UI was built (would need real
verified identity to be honest), the app UI does not yet source
`actingInstructorId` anywhere, and Basic Auth remains the only access
control layer on Staging — unchanged from before this round.

**Explicitly out of scope this round (per instruction, roadmap only):**

- A full employee management system, roles/permissions matrix, or anything
  beyond the first two named instructors (Tony, Anna).
- Learner/parent login, ACTGDS website integration, Booking/Cal.com, CRM,
  GPS, Drive Intelligence, AI, voice input, billing, unrelated UI redesign.
- This session's other work is happening in a separate repo (actgds.com
  CRM) — not touched here, per instruction.

**Follow-up for Tony (not done, needs his action):**

- **Enable Cloudflare Zero Trust Access** in the dashboard (one-time,
  manual — cannot be done via API token; visit the Access dashboard and
  click "Enable Access"). This unblocks the next round: configuring a real
  Access Application restricted to Tony's + Anna's emails, verifying its
  JWT server-side, and wiring the resulting verified email through
  `lib/repo.ts#findInstructorByEmail` into the app (a "Signed in as
  Tony/Anna" UI, `actingInstructorId` sourced automatically instead of
  needing to be passed by hand, and unauthorized-email rejection at the
  app level, not just Basic Auth at the perimeter).
- Confirm which real instructor the pre-existing `ADI601`/`ADI604` rows
  correspond to (if either is in fact Tony or Anna) — nothing was
  auto-merged or guessed; they're left exactly as they were, with no email.
- Open the exported CBT&A PDF on your own iPhone (carried over from the
  PDF export round — still not done).
- Decide when to authorize merging `staging` into `main`.

等待 Tony 指定下一任务。
