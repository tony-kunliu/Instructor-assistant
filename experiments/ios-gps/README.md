# iPhone GPS Self-Test

Standalone SwiftUI prototype for measuring Core Location continuity during a
personal test. The recorder retains fix timestamps in memory and exports only
aggregate durations and gaps. The iPhone reports foreground and background
transitions. The tester labels the next background period as locked or
another app before leaving the recorder.

## Build

On macOS with Xcode and XcodeGen installed, run these commands from this folder.

```sh
xcodegen generate
xcodebuild -project GpsSelfTest.xcodeproj -scheme GpsSelfTest \
  -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO build
```

For development-device installation, open the generated project in Xcode,
select the approved Apple development team and a bundle identifier registered
to that team, and run the scheme on a registered iPhone. GitHub Actions
compiles without signing on pushes to the prototype branch. Use that result
as a compile check before device signing.

## Test

Follow [the self-test protocol](../../docs/tasks/ios-core-location-self-test.md).
Start while parked and allow location when prompted. Arm each phase before
locking the screen or switching apps. Return to the recorder before arming
the next phase. Stop while parked and share the JSON summary. The existing
evaluator handles incomplete phases and applies the acceptance thresholds.
