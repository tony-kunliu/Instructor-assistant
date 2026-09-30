# UX Design System — Instructor Ergonomics & ACT Golden

Canonical frontend contract for Instructor Assistant. **Read this before
changing task-critical UI** (AGENTS.md §14). Origin: Issue #9; implemented in
UI Foundation V1 (`app/globals.css`, `app/driver-app.tsx`). The app is a
professional working instrument — not a marketing site, not a metrics
dashboard, not a copy of actgds.com, and never meant for use while the
vehicle is moving.

## Priorities (in order)
1. road safety / instructor attention · 2. clarity · 3. error prevention ·
4. minimum taps · 5. one-handed iPhone use while safely stationary ·
6. accessibility · 7. ACT Golden brand consistency · 8. decorative polish.
Never trade usability for branding.

## Parked-first interaction
No workflow may need the phone while driving. Lesson states (derived from the
existing draft: no start time → READY, start without finish → RUNNING, both →
ENDED; there is no separate backend state machine):

| State | Shows | Hides |
|---|---|---|
| READY | learner, lesson #, totals, Start odometer, one dominant **Start Lesson** | Finish odometer, completion form |
| RUNNING | learner, **Lesson running** pill, elapsed, Start odometer, one dominant **End Lesson**, quiet Discard | totals, tools, Finish odometer, CBT&A, location/comments, signatures, Save |
| ENDED | Finish odometer (auto-focused) → CBT&A → Location/Comments → Edit date/times (collapsed) → Signatures → error summary → **Save Lesson** | — |
| SAVED | confirmation (`saved-confirmation`): lesson #, duration/km, totals, CBT&A progress; form back to READY; completed/archive prompt where applicable | — |

Hidden RUNNING fields stay in the draft (nothing is deleted; reload restores
the state). Future GPS status belongs in RUNNING as one compact line — no map.

## One primary action
One visually dominant action per state (`.btn.huge`: navy, 60px, gold base
line): Start Lesson / End Lesson / Save Lesson / Save Changes. Secondary
actions are quiet (`.btn.ghost`, `.link`). Destructive red is only for truly
destructive actions; Archive is reversible and stays a quiet link. Labels are
verb-first ("Restore Learner", "Archive Learner…").

## Touch targets
Every interactive control has a **≥44×44** CSS px hit area (`--hit`); normal
controls 48 (`--hit-comfy`); lesson-state primaries 60 (`--hit-primary`).
Enlarge the hit area, not the visuals. Tabs, chips, links, summaries, Sign out
and error-jump buttons all conform; `qa-browser` asserts it at 375/390px.

## Information hierarchy
Who → what state → what matters now → what next → details. Progressive
disclosure for technical/infrequent data: Integration ID and licence details
live under "Learner details", advanced date/time under "Edit date / times",
Export PDF/Archive in the quiet tools card below the lesson and progress.

## ACT Golden tokens (`:root`)
Navy 950 `#06121F` · Navy 900 `#0A1B2D` · Navy 800 `#102A43` · Gold 500
`#D8AE55` · Gold 400 `#EDCA78` · Paper `#F6F3EB` · Ink `#13202C` · Muted
`#64707B`. Paper/white = working surfaces; Ink/Navy = text and primary
actions; Gold = focus halo, selection base line, small accents. **Gold 500 on
Paper is 1.9:1 — never text.** Gold on Navy is fine (header accent).
Do not flood the UI with gold or show a large logo repeatedly.

## Functional colours (separate from brand, never colour-only)
Success `--success-*` (✓ + text), error `--error-*` (text + summary),
warning/in-progress `--warn-*` (pill text), neutral/disabled = Muted + dashed
border. Green for white text is `#166534` (7.1:1; the old `#1F8A4C` was 4.4:1).
`tests/ui-design-tokens.test.ts` enforces ≥4.5:1 text, ≥3:1 boundaries and the
canonical brand values.

## Typography
System font stack only. Body/inputs 17px (inputs must stay ≥16px — iOS zoom).
Labels/meta ≥14px; nothing important below 13px. No serif in operational UI.

## Forms, chips, cards
Order of preference: automatic value → chip → picker → text. Derived values
(lesson #, duration, km, totals) are never typed. Persistent labels; numeric
keyboard for odometer; disabled fields are dashed/muted and explained. Chips:
≥44px; selected = navy fill + gold base line; achieved = ✓ + green; locked =
dashed + muted with an on-screen reason. Cards group one coherent task; no
card-in-card; no card per metric.

## Validation / error UX
Summary directly above Save; plain reason per item; "Go to …" scrolls and
focuses the exact field (`scroll-margin-top` keeps it clear of the edge);
input is preserved; no disappearing toasts. Finish odometer mounts only in
ENDED; End Lesson focuses it.

## Accessibility
Text ≥4.5:1; one focus style for everything (`--focus`: navy ring + gold halo,
visible in forced-colors); semantic labels; state never by colour alone;
no horizontal overflow at 375/390px; safe-area padding top/bottom; no
gesture-only action (signature has Clear). A permanent sticky Save bar is **not**
adopted — only with real-keyboard proof it never hides the focused field, the
error summary, or safe areas.

## Navigation
Current layout stays. Do not add Today / Learners / More or placeholder cards
before P3 exists; that structure is the future direction only.

## Future compatibility (design direction, not implemented)
- **P3 Today:** booking card = time, learner, place, link state, one next
  action; hide Cal.com metadata. Booking ≠ lesson; Start Lesson stays the
  instructor's action.
- **P4 GPS:** RUNNING gets one compact status (Recording / Gap / Syncing); no
  live map while driving; route map only in post-lesson review.
- **P5:** post-lesson summary leads with a few exposure facts, evidence is
  drill-down; exposure never equals CBT&A achievement.

## QA gates for any changed UI
375px and 390px; all lesson states; long learner name / location / messages;
locked + selected chips; save error + jump; History Edit; archived and
completed learners. Use behavioural assertions in `scripts/qa-browser/qa.mjs`
(overflow, ≥44px hit targets via `undersized()`, one dominant action, state
controls) — screenshots only supplement. Not automated: larger-text/Dynamic
Type rendering and real-iPhone keyboard/safe-area behaviour.
