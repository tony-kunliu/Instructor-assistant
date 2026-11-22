import CoreLocation
import SwiftUI

private enum TestPhase: String, Hashable {
    case locked = "Lock screen"
    case anotherApp = "Switch apps"
}

private struct PhaseSummary: Encodable {
    let activeMs: Int
    let uncoveredMs: Int
    let longestGapMs: Int
    let fixesSampled: Int
    let fixesDeliveredDuringPhase: Int
}

private struct SelfTestSummary: Encodable {
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

private final class Recorder: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var recording = false
    @Published private(set) var waitingForPermission = false
    @Published private(set) var fixCount = 0
    @Published private(set) var status = "Ready"
    @Published private(set) var report: String?

    private let manager = CLLocationManager()
    private var armedPhase: TestPhase?
    private var backgroundStart: Date?
    private var windows: [TestPhase: DateInterval] = [:]
    private var startedAt: Date?
    private var firstDeliveryByFixTime: [Date: Date] = [:]

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = kCLDistanceFilterNone
        manager.activityType = .automotiveNavigation
        manager.pausesLocationUpdatesAutomatically = false
        manager.showsBackgroundLocationIndicator = true
    }

    func start() {
        guard !recording, !waitingForPermission else { return }
        switch manager.authorizationStatus {
        case .notDetermined:
            waitingForPermission = true
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            beginRecording()
        default:
            status = "Location access is off. Allow location in Settings and try again."
        }
    }

    private func beginRecording() {
        startedAt = Date()
        report = nil
        armedPhase = nil
        backgroundStart = nil
        windows.removeAll()
        firstDeliveryByFixTime.removeAll()
        fixCount = 0
        recording = true
        status = "Recording"
        manager.allowsBackgroundLocationUpdates = true
        manager.startUpdatingLocation()
    }

    func arm(_ phase: TestPhase) {
        guard recording, backgroundStart == nil else { return }
        armedPhase = phase
        status = "\(phase.rawValue) armed. Leave this screen now."
    }

    func sceneChanged(_ phase: ScenePhase) {
        guard recording else { return }
        if phase == .background, backgroundStart == nil, armedPhase != nil {
            backgroundStart = Date()
        }
        if phase == .active, let start = backgroundStart, let markedPhase = armedPhase {
            let end = Date()
            if end > start {
                windows[markedPhase] = DateInterval(start: start, end: end)
            }
            backgroundStart = nil
            armedPhase = nil
            status = "\(markedPhase.rawValue) recorded. GPS is still recording."
        }
    }

    func stop() {
        guard let start = startedAt, recording else { return }
        let end = Date()
        stopUpdates()
        let dates = firstDeliveryByFixTime.keys.filter { $0 <= end }.sorted()
        let edges = [start] + dates + [end]
        let gaps = zip(edges, edges.dropFirst()).compactMap { pair -> DateInterval? in
            let (from, to) = pair
            guard to.timeIntervalSince(from) > 15 else { return nil }
            return DateInterval(start: from, end: to)
        }
        func summarize(_ phase: TestPhase) -> PhaseSummary? {
            guard let window = windows[phase] else { return nil }
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
        let result = SelfTestSummary(
            activeMs: milliseconds(end.timeIntervalSince(start)),
            locked: summarize(.locked),
            anotherApp: summarize(.anotherApp)
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        do {
            let data = try encoder.encode(result)
            report = String(decoding: data, as: UTF8.self)
            status = "Stopped. Share the summary."
        } catch {
            status = "The summary could not be created."
        }
        firstDeliveryByFixTime.removeAll()
    }

    private func stopUpdates() {
        recording = false
        waitingForPermission = false
        manager.stopUpdatingLocation()
        manager.allowsBackgroundLocationUpdates = false
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            if waitingForPermission {
                waitingForPermission = false
                beginRecording()
            }
        case .denied, .restricted:
            stopUpdates()
            firstDeliveryByFixTime.removeAll()
            status = "Location access is off. Allow location in Settings and try again."
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let start = startedAt, recording else { return }
        let receivedAt = Date()
        for location in locations where location.horizontalAccuracy >= 0 &&
            location.timestamp >= start && location.timestamp <= receivedAt {
            if firstDeliveryByFixTime[location.timestamp] == nil {
                firstDeliveryByFixTime[location.timestamp] = receivedAt
            }
        }
        fixCount = firstDeliveryByFixTime.count
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard recording, (error as? CLError)?.code != .locationUnknown else { return }
        status = "Location service reported a problem. GPS gaps are included in the summary."
    }
}

@main
struct GpsSelfTestApp: App {
    var body: some Scene {
        WindowGroup { TestScreen() }
    }
}

private struct TestScreen: View {
    @StateObject private var recorder = Recorder()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(recorder.status)
                    LabeledContent("Location fixes", value: String(recorder.fixCount))
                    if recorder.recording {
                        Button("Mark next lock screen test") { recorder.arm(.locked) }
                        Button("Mark next app switch test") { recorder.arm(.anotherApp) }
                        Button("Stop recording", role: .destructive) { recorder.stop() }
                    } else {
                        Button("Start recording") { recorder.start() }
                            .disabled(recorder.waitingForPermission)
                    }
                } footer: {
                    Text("The test keeps location timestamps in memory for this session and shares only timing totals. Use the controls while parked.")
                }
                if let report = recorder.report {
                    Section("Result") {
                        ShareLink(item: report) { Label("Share summary", systemImage: "square.and.arrow.up") }
                        Text(report).font(.caption.monospaced()).textSelection(.enabled)
                    }
                }
            }
            .navigationTitle("GPS Self-Test")
            .onChange(of: scenePhase) { _, phase in recorder.sceneChanged(phase) }
        }
    }
}
