# STATUS.md

_Last updated: 2026-09-26_

Repo: `tony-kunliu/instructor-assistant`

| Branch | Commit | State |
| --- | --- | --- |
| `main` | `edeab503bcd84e4dd0907cdc49c61dfc8762855b` | Project skeleton and working rules only. Not deployed. |
| `staging` | `edeab503bcd84e4dd0907cdc49c61dfc8762855b` | Same as `main`. |
| `feature/cbta-checklist` | `234c959ed6994c9797cb69d5fcebbb1afda5a9ac` | CBT&A Lesson Checklist MVP — complete, not yet merged into `staging`/`main`. |

Production: **not deployed**. Production requires separate, explicit
authorization from Tony (merging to `main` does not imply this).

## CBT&A Checklist MVP (`feature/cbta-checklist`) — complete

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
