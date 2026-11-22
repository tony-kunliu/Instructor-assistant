# iPhone GPS Self-Test

Standalone SwiftUI prototype for measuring Core Location continuity during a
personal test. The recorder retains fix and first callback times in memory and
exports only aggregate durations, gaps and counts. The iPhone reports foreground and background
transitions. The tester labels the next background period as locked or
another app before leaving the recorder.

## Build

On macOS with Xcode and XcodeGen installed, run these commands from this folder.

```sh
xcodegen generate
xcodebuild -project GpsSelfTest.xcodeproj -scheme GpsSelfTest \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

For development-device installation, open the generated project in Xcode.
Use automatic signing with the approved Apple development team and a unique
bundle identifier, then run the scheme on the connected development iPhone.
Follow [Apple's device setup instructions](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)
for pairing and Developer Mode. GitHub Actions runs the summary checks and
compiles the exact prototype pull request head without signing.

## Test

Follow [the self-test protocol](../../docs/tasks/ios-core-location-self-test.md).
After verifying installation, stop the Xcode run and launch the installed
app from the iPhone Home Screen so the timing test runs without a debugger.
Start while parked and allow location when prompted. Arm each phase before
locking the screen or switching apps. Return to the recorder before arming
the next phase. Stop while parked and share the JSON summary. The existing
evaluator handles incomplete phases and applies the sampling thresholds. Each
phase reports both fixes sampled and how many of those fixes reached the app
before the phase ended. Compare the counts to spot delayed delivery even when
the timestamps suggest good sampling coverage.
