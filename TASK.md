# TASK.md

No active development task.

**Completed this session (second follow-up to Instructor Identity V1):**
diagnosed why Anna could not sign in through Cloudflare Access while Tony
could. Root cause confirmed via API: this Zero Trust account has **no
login method configured at all** — the only fallback, "Login with
Cloudflare", requires actual Cloudflare account membership, which Tony (the
account owner) has and Anna doesn't. The Access Application and Policy
created in the previous round are correct and not the problem. Creating a
login method (identity provider) requires a Zero Trust permission scope the
current API token doesn't have, and this session does not expand its own
token permissions to work around that — so this one step needs Tony
himself. Asked Tony which login method he wanted; **he chose email
One-Time PIN.**

No code changes were needed this round — this was a Cloudflare
configuration gap, not an app bug.

**Follow-up for Tony (not done, needs his action):**

1. **Add the One-Time PIN login method** (one-time, ~1 minute, dashboard
   only — cannot be done via the current API token): Cloudflare Zero Trust
   dashboard → **Settings → Authentication → Login methods → Add → select
   "One-time PIN" → Save.** Nothing else needs to change — the existing
   Access Application already accepts any configured login method.
2. **Have Anna try signing in again** after that — she should now get an
   email with a one-time PIN code instead of the Cloudflare-account-only
   screen, and the topbar should show "Signed in as Anna" once she's in.
3. Once both of you have confirmed the Access login path works, decide
   whether to retire Basic Auth (still kept as a second gate today).
4. Decide when to authorize merging `staging` into `main` — Tony said this
   can happen once Anna's login is working.

**Already confirmed by Tony, no action needed:**

- His own ADI number (604) — already set on the "Tony" instructor record.
- The pre-existing `ADI601` row ("not important, maybe my own typo") —
  left untouched rather than deleted, since deletion is irreversible and
  wasn't required by this task.
- PDF export tested fine on his own iPhone — no issue.

**Explicitly out of scope this round:** no code was touched; this was pure
diagnosis + a data question already answered by Tony.

等待 Tony 完成 One-Time PIN 设置后确认 Anna 可登录，再指定下一任务。
