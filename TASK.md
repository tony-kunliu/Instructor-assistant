# TASK.md

No active development task.

**Completed this session:** Instructor Identity V1 is now fully working end
to end, verified live by Tony and Anna themselves. The earlier blocker
(Anna's Cloudflare Access login only offering "Sign in with Cloudflare",
which requires Cloudflare account membership she doesn't have) was fixed by
Tony adding the "One-time PIN" identity provider in the Zero Trust
dashboard — a one-time, ~1 minute step only he could do. Anna then
completed a real login (email → one-time code → in) and the app correctly
showed **"Signed in as Anna"**. Combined with Tony's earlier successful
login ("Signed in as Tony"), both named instructors' identity paths are now
proven against the real, deployed system — not just unit tests. No code
changes were needed this round; this was Cloudflare-side configuration only.

**Current live state:**
- Cloudflare Access (self-hosted app + "Tony and Anna only" policy) sits in
  front of the Worker, with two login methods available: "Cloudflare"
  (account-member login) and "One-time PIN" (email code — this is what
  makes Anna's access work).
- Basic Auth is **still active** as an independent second gate (unchanged,
  not yet retired).
- Lesson/history attribution is automatic for whoever is actually signed
  in via Access.

**Two decisions now ready for Tony (previously conditioned on this exact
outcome — now unblocked):**

1. **Retire Basic Auth?** The migration order from earlier rounds said not
   to remove it until both people's Access login was proven — that's now
   done. Tony can say the word and Basic Auth can be removed from
   `middleware.ts` next round (Access + the app-level instructor mapping
   would become the sole gate).
2. **Authorize merging `staging` into `main`?** Tony previously said this
   could happen "once Anna's login works" — it now does. Still needs his
   explicit go-ahead per this repo's branch rules before it happens.

**Follow-up for Tony:**

- Reply with a decision on the two items above (or "not yet" on either).
- Everything else from earlier rounds (PDF export tested fine on his
  iPhone, ADI numbers set, `ADI601` left untouched as a likely-harmless
  typo) is already closed out.

等待 Tony 对以上两项决定，或指定下一任务。
