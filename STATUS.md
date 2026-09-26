# STATUS.md

_Last updated: 2026-09-26_

Repo: `tony-kunliu/instructor-assistant`

| Branch | Commit | State |
| --- | --- | --- |
| `main` | `98aa0c047d9b99d309c531cddb81555f8444ab43` | Working rules / docs baseline only. CBT&A MVP not yet merged in. Not deployed. |
| `staging` | `ae1bc410aaadffdaf0a30e1c47cbe8ff5f8a4f16` | CBT&A Lesson Checklist MVP merged in for integration QA. Not deployed. |
| `feature/cbta-checklist` | `e7e2c3d93902d286e2bcd03e8ac08541cd6f7186` | CBT&A Lesson Checklist MVP — complete, merged into `staging`. Not yet merged into `main`. |

Production: **not deployed**. Production requires separate, explicit
authorization from Tony (merging to `main` does not imply this).

## CBT&A Checklist MVP — merged into `staging`

Merged from `feature/cbta-checklist` into `staging` for integration QA
(commit `ae1bc41`). Re-verified on `staging` after merge: `npm run build`
PASS, `npm test` 10/10 PASS. Not yet merged into `main`; `main` still
requires Tony's explicit authorization for that step.

Implemented:

- Learner creation / selection
- Start Lesson
- End Lesson
- Lesson number (auto-incrementing)
- Date
- Start / finish time
- Start / finish odometer
- Automatic duration
- Automatic lesson km
- Cumulative hours
- Cumulative km
- Taught (free text)
- Competencies Assessed (free text)
- Achieved (free text)
- Location
- Comments
- ADI signature
- Learner signature
- Lesson history
- Previous lesson's finish odometer carried forward as next start odometer

Verification:

- `npm run build`: PASS
- `npm test`: 10/10 PASS
- End-to-end QA in an emulated iPhone 13 browser: PASS
  - Lesson #1 → Lesson #2 workflow: PASS
  - Reload persistence: PASS
  - No horizontal overflow: PASS

## Known limitations

- No instructor authentication yet — do not expose publicly.
- `node:sqlite` requires a Node server with persistent disk storage (not yet
  Cloudflare D1). Schema is plain SQL so it can move to D1 later.
- No public production deployment.
- Saved lessons cannot be edited or deleted.
- No offline mode / service worker.
- iOS home-screen icon is a basic SVG placeholder.

## Old ACTGDS (`tony-kunliu/actgds.com`) cleanup

- Old Issue #2 ("ACTGDS Driver — CBT&A Checklist MVP"): **closed**, with a
  comment pointing to this repo.
- Old `feature/driver-cbta-checklist` branch: **retained** — branch deletion
  was attempted but the available credentials/tooling did not have permission
  to delete a remote ref. Left untouched as instructed.
- ACTGDS Production: **unchanged**.
