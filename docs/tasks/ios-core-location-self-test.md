# iOS Core Location self-test

## Status

The web diagnostic measured 99.5% foreground coverage and 14.6% background coverage in Tony’s personal test, with an approximately 90-second gap during page suspension. These results apply only to the web diagnostic and do not prove native background continuity. PR #130 still requires evidence of continuous capture in the actual lesson workflow before release.

The native prototype is now packaged as an unsigned Xcode project. On source commit `1f6591b67fed6c5a88514d6f721d4b7cb21566ac`, exact-source GitHub CI run `45158620979` and Xcode build run `45158620930` both succeeded. The artifact is ID `14810301175` (8,611 bytes), created 2026-11-23 and expiring 2026-12-07 10:43:57 UTC. It contains the standalone project but is not signed or installable until an approved Apple development team signs it. No iPhone installation or native field result exists.

Tony will arrange his own signing, installation and device test when available. Do not seek an external tester or send reminders. PR #130 remains Draft and its continuous-background-recording release gate is unchanged.

## Prototype acceptance before handoff

- Use a standalone, signed iPhone app with Core Location background updates configured. Start only after the tester taps Start and grants the necessary system permission. The app displays recording state, shows a clear permission error, and stops updates on Stop. Keep capture on-device and use no app account, learner record, network upload, or shared storage with Instructor Assistant.
- Capture fix time separately from callback time so late delivery cannot be mistaken for a sampling gap. Record phase boundaries and changes to authorization. Restrict exports to counts, durations, coverage and gap metrics. Keep coordinates and route details out of exported diagnostics and GitHub.
- Do not ask Tony to test until a signed, installable build exists. The signing and installation route must use an approved Apple development team. Before the personal drive, verify Start/Stop and permission-denied behavior and confirm the exported aggregate contains no coordinates. Record the exact source/build identifier, iOS version and device model.

## One personal drive, about 20 minutes

Use a personal outing with no learner or lesson. Use the phone controls only while parked, or have a passenger handle the phase transitions.

| Phase | Target time | What to record |
| --- | --- | --- |
| Foreground control | 5 minutes | Start with the app visible. Record whether a fix arrives and the phase start time. |
| Locked screen | 5 minutes | Lock the phone and leave it locked while moving. Mark the interval start and end when safe. |
| Another app | 5 minutes | Leave the recorder in the background without force-quitting it. Mark the interval start and end when safe. |
| Foreground recovery | 5 minutes | Return to the recorder. Confirm the session did not restart. Stop when parked, then export the aggregate summary. |

Report coverage and longest sampling gap separately for the locked and other-app phases. Use fix timestamps, count gaps over 15 seconds, exclude explicit pauses, and classify coverage with the existing web diagnostic definitions in `lib/gps/analysis.ts`. Report interrupted or unmarked phases as inconclusive. As a comparison with the existing web diagnostic, aim for at least 95% coverage and no gap over 30 seconds in **each** background phase. This is a prototype test target. Any production decision still needs the checks listed on PR #130, including exact-build QA of the lesson flow.

## Evaluate the aggregate result

`evaluateNativeSelfTest` in `lib/gps/native-acceptance.ts` applies the web diagnostic thresholds separately to the two marked background windows. Its input carries the overall active duration (`activeMs`) and a `locked` and `anotherApp` window, each with `activeMs`, `uncoveredMs` and `longestGapMs` in milliseconds. Pass `null` for an unmarked or interrupted window. Compute aggregate gaps from fix times before passing the summary. The evaluator needs no coordinates or fix timestamps. To evaluate an exported aggregate file from the repository root with Node 22.13 or later:

```sh
node --experimental-strip-types --input-type=module -e '
  import { readFileSync } from "node:fs";
  import { evaluateNativeSelfTest } from "./lib/gps/native-acceptance.ts";
  console.log(JSON.stringify(evaluateNativeSelfTest(JSON.parse(readFileSync(0, "utf8"))), null, 2));
' < summary.json
```

## Handoff

- Current task: Partial. Unsigned Xcode project compiled on source `1f6591b67fed6c5a88514d6f721d4b7cb21566ac`; exact-source CI `45158620979` and Xcode build `45158620930` passed. Artifact `14810301175` expires 2026-12-07 10:43:57 UTC. No signing, installation or native field evidence.
- Next: wait for Tony to arrange approved signing and installation. Once the app is installable, Tony will perform one approximately 20-minute personal test; then evaluate the aggregate summary with `evaluateNativeSelfTest`.
- Waiting on other repo: None.
- Tony action: none requested now; Tony will arrange signing, installation and the personal test when available. Do not seek external testers or send reminders.
