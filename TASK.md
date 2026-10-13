# TASK.md

_Last updated: 2026-10-13_

This file describes **current task only**. Completed work's detail
lives in git log and closed PRs, not here.

**Current Task:** Learner intake P3, overseas / interstate licence (design
`docs/superpowers/specs/2026-10-11-learner-intake-design.md` D11-D14, D17 school rule), branch
`feature/intake-p3-licence` — **Completed on the branch, not merged** (L2 additive migration +
reminder logic + derived value: strict independent review next). Migration `0013` adds six nullable
`learners.other_licence_*` columns (kind, place, number, class, issued_on, expires_on; no default, no
backfill, no rebuild; rehearsed with `scripts/rehearse-0013-local.sh`, re-apply refused by design).
`lib/other-licence.ts` (enums, labels, D12 validation with distinct errors, bundled country list);
`lib/rules.ts`: Tony's rule as REMINDERS only — interstate LEARNER time counts from its issue date (grey
"Age band unclear" if the bands differ), interstate or overseas FULL licence held 12 months
(`OTHER_FULL_LICENCE_MONTHS`) removes the wait, overseas learner / class `other` never count (note on the
R2 line), missing type or date → grey `otherLicenceDataReminder`; hours, HPT and age unchanged; the other
licence's expiry is never read. "Competency 23 from" and the PDF Eligibility auto-fill follow (never
overwriting Tony's text). Form: collapsed group "Overseas or interstate licence" after the Competency 23
group; "Yes" opens the details; "No" clears them (old values stay in `learner_revisions`). D1: edit 5 /
create 3 statements, UPDATE binds 25, INSERT 25, revision 4. Nothing to ACTGDS (payload keys pinned).
qa-browser section 23 (375 light/dark, 820, R2 wording, PDF, snapshots). D1 stays `0012` until applied.

**Next Recommended Task:** strict independent review of `feature/intake-p3-licence` (Handbook §2,
L2 data/rules); then `Staging D1 Migrate` with `0013` BEFORE merging to `staging`; post-merge CI;
Tony's real-phone look at the new group (375px, iOS date pickers). Then, on Tony's go: (a) Transfer /
Archive into the edit form's "More" section + learner form restyle; (b) `docs/tasks` memory scheme;
(c) intake P4 (iOS Scan Text + local parser); (d) `scripts/check-signature-row-limits.mjs` on Staging
D1; (e) the `tests/pdf-export-font-subset.test.ts` temp-dir leak.

**Waiting on Other Repo:** ACTGDS: notify-tick waits for Website PR #47 rework and Tony's explicit
approval of the new endpoint + secret (Production stays OFF); Work's display polish list. Nothing
blocks this repo.

**Tony Manual Action Required:** none blocking. Questions for P3 (answer with one word each): (1) an
interstate learner licence issued AFTER the ACT licence is counted literally from its own date (spec
D13 a) — fine, or count from the earlier of the two? (2) the D13 (e) grey line is a separate line under
R2 (R2 itself is unchanged) — fine? Optional, still open: hide the ACT "Jerrabomberra" district in
Address suggestions; the 30-minute tooling checklist (Dependabot, duplicate environments, plugins).

**CI note:** poppler tests are opt-in hard failures (`REQUIRE_POPPLER=1`, `ci.yml` only); Cloudflare
Workers Builds skip them. Simulate the Workers Builds command locally before merging (see STATUS.md CI).
