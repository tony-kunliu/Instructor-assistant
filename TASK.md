# TASK.md

No active development task.

**Completed this session (follow-up to Instructor Identity V1):** Cloudflare
Zero Trust Access is now fully wired up. Tony enabled Access in the
dashboard (the one-time manual step the previous round was blocked on);
everything after that was done via API/CLI: created the Access Application
+ a policy restricted to exactly Tony's and Anna's real emails, verified
the Access JWT server-side (`lib/access.ts`, using `jose`), and mapped the
verified email to an instructor record (`lib/repo.ts#findInstructorByEmail`,
built last round). Lesson creation and history edits are now automatically
attributed to whoever is actually signed in via Access — no manual
`actingInstructorId` needed from the client anymore when Access identity is
present. Added a minimal "Signed in as `<name>`" line and `GET /api/me`.
Basic Auth is deliberately **kept** as an independent second gate this
round, not removed. Built on `feature/instructor-identity-access` (+ a
small test-only follow-up branch) from `staging`, merged back into
`staging` (`d13e7e7`), Cloudflare Staging redeployed (Version
`ac54eaea-ab97-4220-8fe6-80521b0d37bc`). Not merged into `main` and
Production was not touched. See STATUS.md for full detail.

**Real data provided by Tony this round:** his own ADI number (604) and
Anna's (358) — both set on their instructor records via direct D1 update
(not through fabrication). **Worth Tony's attention:** his ADI number (604)
is identical to the pre-existing `ADI601` instructor row's `adi_number` —
circumstantial evidence that row may be his own historical record, but it
was left untouched since nothing was confirmed, per instruction not to
guess/merge historical data.

**What this session could not verify, and why (needs Tony's/Anna's own
action):** actually completing a real Cloudflare Access login as Tony or
Anna (receiving the one-time-PIN email and finishing the browser flow)
requires access to their real email inboxes, which this session does not
have. Everything up to that point was verified: Access blocks anyone else
(confirmed live — an unauthenticated request now gets redirected to
Access's own login page before the Worker even runs); the exact
JWT-verification and email→instructor mapping code that will run for a real
login was tested against real RSA-signed tokens (`tests/access.test.ts`);
and the attribution override logic was tested directly
(`tests/api.test.ts`).

**Explicitly out of scope this round (per instruction, roadmap only):**

- A full employee management system, roles/permissions matrix, or an
  identity provider beyond Access's built-in email one-time PIN.
- Learner/parent login, ACTGDS website integration, Booking/Cal.com, CRM,
  GPS, Drive Intelligence, AI, voice input, billing, unrelated UI redesign.
- This session's other work is happening in a separate repo (actgds.com
  CRM) — not touched here, per instruction.

**Follow-up for Tony (not done, needs his/Anna's action):**

- **You and Anna should each sign in once** at
  `https://instructor-assistant.kunliu-work.workers.dev` — you'll be
  redirected to a Cloudflare Access login (enter your email, then the
  one-time PIN code sent to it), then Basic Auth's own prompt (existing
  credentials, unchanged). Confirm the topbar shows "Signed in as Tony" /
  "Signed in as Anna", and that a newly created or edited lesson is
  attributed to the right person. This is the one remaining acceptance
  step this session couldn't perform itself.
- Confirm whether the pre-existing `ADI601` instructor row is in fact your
  own historical record (see the ADI-number coincidence above) — nothing
  was auto-merged.
- Confirm which real instructor `ADI604` corresponds to, if anyone.
- Decide when Basic Auth can be retired now that Access is live (per the
  migration order: only after both of you have confirmed the Access login
  path works).
- Open the exported CBT&A PDF on your own iPhone (carried over from an
  earlier round — still not done).
- Decide when to authorize merging `staging` into `main`.

等待 Tony 指定下一任务。
