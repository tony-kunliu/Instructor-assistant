# iOS Core Location self-test

## Status

The web diagnostic measured 99.5% foreground coverage and 14.6% background coverage in Tony’s personal test, with a roughly 90-second gap during page suspension. These observations apply to the web diagnostic only. PR #130 still requires evidence of continuous capture in the actual lesson workflow before release. This note prepares the isolated native test. No installable native build or native field result exists in the evidence reviewed.

## Prototype acceptance before handoff

- Use a standalone, signed iPhone app with Core Location background updates configured. Start only after the tester taps Start and grants the necessary system permission. The app displays recording state, shows a clear permission error, and stops updates on Stop. Keep capture on-device and use no app account, learner record, network upload, or shared storage with Instructor Assistant.
- Capture fix time separately from callback time so late delivery cannot be mistaken for a sampling gap. Record phase boundaries and changes to authorization. Restrict exports to counts, durations, coverage and gap metrics. Keep coordinates and route details out of exported diagnostics and GitHub.
- Before inviting Tony, install and launch the exact build on a development device, verify Start/Stop and the permission-denied path, and confirm an export contains no coordinates. Record the build identifier, source commit, iOS version and device model. Establish a signed installation route through existing approved tooling.

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

- Current task: Partial. Test protocol recorded. Native compile, signing, installation and field evidence are still open. The current Linux runtime lacks Xcode and an iOS device.
- Next: build the isolated prototype on an authorized macOS/Xcode environment and complete the pre-handoff checks above. Request the single personal drive only once the signed build can be installed.
- Waiting on other repo: None.
- Tony action: None for this step.
