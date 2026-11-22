import Foundation

@main
struct GpsSelfTestSummaryChecks {
    static func main() throws {
        func at(_ seconds: TimeInterval) -> Date {
            Date(timeIntervalSinceReferenceDate: seconds)
        }

        let locked = DateInterval(start: at(20), end: at(65))
        let anotherApp = DateInterval(start: at(65), end: at(85))
        let result = summarizeGpsSelfTest(
            start: at(0),
            end: at(90),
            locked: locked,
            anotherApp: anotherApp,
            firstDeliveryByFixTime: [
                at(-1): at(1), at(0): at(1), at(15): at(25), at(30): at(31),
                at(55): at(65), at(65): at(66), at(80): at(81), at(91): at(92)
            ]
        )

        precondition(result.activeMs == 90_000, "Record the full session duration")
        precondition(result.locked?.activeMs == 45_000, "Record the locked window duration")
        precondition(result.locked?.uncoveredMs == 25_000, "Only gaps longer than 15 seconds count")
        precondition(result.locked?.longestGapMs == 25_000, "Preserve the longest sampling gap")
        precondition(result.locked?.fixesSampled == 2, "Count fixes by sample time")
        precondition(result.locked?.fixesDeliveredDuringPhase == 1, "Exclude callbacks on or after the phase end")
        precondition(result.anotherApp?.fixesSampled == 2, "Count the shared boundary only in the later phase")
        precondition(result.anotherApp?.fixesDeliveredDuringPhase == 2, "Do not count a callback for an earlier phase")
        precondition(result.anotherApp?.uncoveredMs == 0, "A 15-second sampling interval is covered")

        let missing = summarizeGpsSelfTest(
            start: at(0), end: at(90), locked: locked, anotherApp: nil, firstDeliveryByFixTime: [:]
        )
        precondition(missing.locked?.uncoveredMs == 45_000, "Clip a full-session gap to the marked phase")
        precondition(missing.locked?.longestGapMs == 45_000, "Clip the longest gap to the marked phase")
        precondition(missing.locked?.fixesSampled == 0, "No fixes is a measured failure")
        precondition(missing.anotherApp == nil, "An unmarked phase has no measured result")

        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(missing)) as? [String: Any]
        precondition(json?["anotherApp"] is NSNull, "Encode unmarked phases as null for the evaluator")
        precondition(Set(json?.keys.map { $0 } ?? []) == ["activeMs", "locked", "anotherApp"],
                     "Export only aggregate fields")
        print("GPS self-test summary checks passed")
    }
}
