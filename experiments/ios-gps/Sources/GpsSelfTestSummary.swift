import Foundation

struct PhaseSummary: Encodable {
    let activeMs: Int
    let uncoveredMs: Int
    let longestGapMs: Int
    let fixesSampled: Int
    let fixesDeliveredDuringPhase: Int
}

struct SelfTestSummary: Encodable {
    let activeMs: Int
    let locked: PhaseSummary?
    let anotherApp: PhaseSummary?

    enum CodingKeys: String, CodingKey {
        case activeMs, locked, anotherApp
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(activeMs, forKey: .activeMs)
        try container.encode(locked, forKey: .locked)
        try container.encode(anotherApp, forKey: .anotherApp)
    }
}

private func milliseconds(_ duration: TimeInterval) -> Int {
    Int((max(0, duration) * 1_000).rounded())
}

func summarizeGpsSelfTest(
    start: Date,
    end: Date,
    locked: DateInterval?,
    anotherApp: DateInterval?,
    firstDeliveryByFixTime: [Date: Date]
) -> SelfTestSummary {
    let dates = firstDeliveryByFixTime.keys.filter { $0 >= start && $0 <= end }.sorted()
    let edges = [start] + dates + [end]
    let gaps = zip(edges, edges.dropFirst()).compactMap { pair -> DateInterval? in
        let (from, to) = pair
        guard to.timeIntervalSince(from) > 15 else { return nil }
        return DateInterval(start: from, end: to)
    }
    func summarize(_ phase: DateInterval?) -> PhaseSummary? {
        guard let window = phase else { return nil }
        let overlaps = gaps.compactMap { $0.intersection(with: window)?.duration }
        let sampledInPhase = dates.filter { $0 >= window.start && $0 < window.end }
        let deliveredInPhase = sampledInPhase.filter { fixTime in
            guard let delivery = firstDeliveryByFixTime[fixTime] else { return false }
            return delivery >= window.start && delivery < window.end
        }.count
        return PhaseSummary(
            activeMs: milliseconds(window.duration),
            uncoveredMs: milliseconds(overlaps.reduce(0, +)),
            longestGapMs: milliseconds(overlaps.max() ?? 0),
            fixesSampled: sampledInPhase.count,
            fixesDeliveredDuringPhase: deliveredInPhase
        )
    }
    return SelfTestSummary(
        activeMs: milliseconds(end.timeIntervalSince(start)),
        locked: summarize(locked),
        anotherApp: summarize(anotherApp)
    )
}
