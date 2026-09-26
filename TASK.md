# TASK.md

No active development task.

**Completed this session:** with Tony's explicit authorization ("都可以
继续"), both remaining decisions from Instructor Identity V1 were acted on:

1. **Basic Auth retired.** `middleware.ts` no longer checks
   `STAGING_BASIC_AUTH_USER`/`PASSWORD` — Cloudflare Access is now the sole
   gate on Staging. A request reaching the deployed Worker with no verified
   Access identity now fails closed (`403`), rather than silently passing
   through, since this Worker has no other route Access doesn't sit in
   front of. The Basic Auth secrets themselves were left in place (not
   deleted) as a quick rollback lever. Built on `feature/retire-basic-auth`
   from `staging`, merged back (`07704d8`), deployed to Cloudflare Staging
   (Version `201cdf7e-7a5e-443b-9b12-028a8f22547c`), and re-confirmed live
   that unauthenticated requests are still correctly blocked.
2. **`staging` merged into `main`**, per Tony's explicit authorization —
   this repo's governance requires that for every merge into `main`, and
   it was given this round.

**Production was not touched** — merging to `main` does not imply
Production deployment, and this session did not deploy to Production or
receive separate authorization to do so.

**State of the app now:** CBT&A Lesson Checklist (creation, editing,
history), CBT&A V2/V3 competency rules and Final Drive gating, the official
CBT&A PDF export, and Instructor Identity V1 (Cloudflare Access login for
Tony and Anna, automatic lesson/history attribution, Basic Auth retired)
are all live on Cloudflare Staging and now also reflected in `main`.

**Explicitly out of scope this round:** no new features — this was purely
finishing the two decisions Tony had deferred, plus the merge he
authorized.

**Follow-up for Tony (not done, needs his action):**

- Confirm whether the pre-existing `ADI604` instructor row corresponds to
  a real person (still unconfirmed from an earlier round; `ADI601` was
  already addressed — left untouched, per Tony's own answer).
- Decide when (and if) to authorize an actual Production deployment —
  separate, explicit authorization still required per AGENTS.md; nothing
  about this round changes that.
- Confirm the official CBT&A competency full names/content once available
  (still only official numbering 1-22 / Review 1-17 / Review 1-22 / 23
  Final Drive is used — nothing invented).

等待 Tony 指定下一任务。
