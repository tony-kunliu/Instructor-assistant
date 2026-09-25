# STATUS.md

_Last updated: 2026-09-25_

| Branch | State |
| --- | --- |
| `main` | Project skeleton and working rules. Not deployed. |
| `staging` | Same as `main`. |
| `feature/cbta-checklist` | CBT&A Lesson Checklist MVP — complete, build + tests pass. Awaiting review / merge to `staging`. |

Production: **not deployed**. Production requires separate approval.

## CBT&A Checklist MVP — done

- Learners (all CBT&A header fields + instructor), lessons, instructors in SQLite.
- Start Lesson / End Lesson stamp Canberra time; times editable if needed.
- Auto-calculated: lesson number, duration, km, cumulative hours/km.
- Previous finish odometer pre-fills the next start odometer.
- ADI + learner signature pads (both required to save).
- In-progress lesson kept on the device (survives a page reload).
- Lesson history per learner.
- Verified in an emulated iPhone 13 browser: learner → Lesson #1 → Lesson #2,
  totals 2h 30m / 70 km, no horizontal overflow.

## Known limitations

- **No login yet.** Anyone who can reach the URL can use it. Do not expose it
  publicly until instructor authentication is added.
- Needs a Node server with a persistent disk for the SQLite file (not yet
  Cloudflare/D1). Schema is plain SQL so it can move to D1.
- No offline mode / service worker yet; the app needs a connection to save.
- Lessons cannot be edited or deleted after saving.
- A lesson crossing midnight is rejected (finish must be after start).
- Taught / Competencies Assessed / Achieved are free text until the official
  ACT CBT&A competency list is verified.
- Home-screen icon is SVG only (iOS may show a generic icon).
