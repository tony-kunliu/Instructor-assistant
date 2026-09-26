# TASK.md

No active development task.

**Completed this session:** one-click export of the official ACT CBT&A
Checklist PDF (form 10,044 (7/2002)) for a learner, filled with their saved
lesson history, generated entirely client-side with pdf-lib against the
exact template Tony supplied. Correct pagination (5 rows page 1, 6 per
continuation page), header fields (with a new ADI-number fill-in prompt when
missing), Taught/Assessed/Achieved verbatim, signatures scaled to fit,
overflow handled via an appendix page (never truncated), Chinese/English
mixed text, and page numbers throughout. Built on `feature/cbta-pdf-export`
from `staging`, merged back into `staging` (`ee9633c`), Cloudflare Staging
redeployed (Version ID `aa3c1c09-9892-4855-82d2-0e7fb1940d94`) and
remote-verified against real D1 with isolated, fully-cleaned-up test data —
Tony's real learners confirmed untouched. Not merged into `main` (needs
Tony's authorization) and Production was not touched. See STATUS.md for full
detail, including a real bug (font `locl` feature corrupting digit widths)
found and fixed via this round's own visual QA before it shipped.

**Explicitly out of scope this round (per instruction, roadmap only):**

- Anything beyond the PDF export itself: no GPS, no login, no website sync,
  no notifications, no booking, no UI redesign, no unrelated optimization.
- This session's other work is happening in a separate repo (actgds.com
  CRM) — not touched here, per instruction.

**Follow-up for Tony (not done, needs his action):**

- **Open the exported PDF on your own iPhone** to confirm it opens/saves
  correctly on a real device — this round's mobile verification was an
  emulated iPhone 13 viewport in a headless browser, not a real device.
- Enable Cloudflare Zero Trust Access in the dashboard (one-time, manual —
  cannot be done via API token) so Basic Auth on Staging can be replaced
  with a proper Access application. (Carried over from earlier rounds.)
- Confirm the official CBT&A competency full names/content once available
  (currently only official numbering 1-22 / Review 1-17 / Review 1-22 / 23
  Final Drive is used — nothing invented, per AGENTS.md).
- Decide when to authorize merging `staging` into `main`.

等待 Tony 指定下一任务。
