"use client";

// P4 GPS recorder — isolated test page (/gps), default OFF, not linked from the app. Everything stays on this device
// (IndexedDB "ia-gps"); nothing is uploaded, nothing touches lessons. Two sources: a synthetic drive (default; no
// location API is called) and this device's GPS behind an explicit, never-persisted, per-session consent.
import { useCallback, useEffect, useRef, useState } from "react";
import ThemeToggle from "@/app/theme-switch.tsx";
import { analyzeSession, type Report } from "@/lib/gps/analysis.ts";
import { Recorder, describeGeoError, recoverSession, type DocLike, type GeoLike, type RecorderDeps, type Snapshot, type WakeLockLike } from "@/lib/gps/recorder.ts";
import { FaultInjectingStore, IndexedDbStore } from "@/lib/gps/store.ts";
import { summarizeTrack, type TrackSummary } from "@/lib/gps/summary.ts";
import { DEFAULT_DRIVE, syntheticDriver, type SyntheticDriver } from "@/lib/gps/synthetic.ts";
import { SYNTHETIC_DRIVE_FINISHED, type SessionMeta } from "@/lib/gps/types.ts";
import "./gps.css";

type Source = "synthetic" | "device";
const DEFAULT_SPEEDUP = 90;
const GEO_NOTICE_MS = 8_000;

const fmtMs = (ms: number | null) => (ms === null ? "—" : ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`);
const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;
const when = (t: number) => new Date(t).toLocaleString("en-AU", { timeZone: "Australia/Sydney", hour12: false });

const browserDoc = (): DocLike => ({
  visibility: () => (document.visibilityState === "visible" ? "visible" : "hidden"),
  onVisibility: (cb) => { document.addEventListener("visibilitychange", cb); return () => document.removeEventListener("visibilitychange", cb); },
  onLifecycle: (cb) => {
    const handlers: [EventTarget, string, () => void][] = [
      [window, "pagehide", () => cb("pagehide")], [window, "pageshow", () => cb("pageshow")],
      [document, "freeze", () => cb("freeze")], [document, "resume", () => cb("lifecycle_resume")],
    ];
    for (const [target, name, fn] of handlers) target.addEventListener(name, fn);
    return () => { for (const [target, name, fn] of handlers) target.removeEventListener(name, fn); };
  },
});

function wakeLockDep(): WakeLockLike | null {
  const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<EventTarget & { release(): Promise<void> }> } };
  return nav.wakeLock
    ? { request: async () => { const s = await nav.wakeLock!.request("screen"); return { release: () => s.release(), onrelease: (cb) => s.addEventListener("release", cb) }; } }
    : null;
}

function envDep(source: Source, geolocationSupported: boolean): RecorderDeps["env"] {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: navigator.userAgent,
    standalone: Boolean(nav.standalone) || window.matchMedia("(display-mode: standalone)").matches,
    wakeLockSupported: "wakeLock" in navigator,
    geolocationSupported,
    source,
  };
}

/** Real device: navigator.geolocation is looked up only here, only after consent, only when Start is tapped. */
function deviceDeps(store: FaultInjectingStore): RecorderDeps {
  const geo: GeoLike | null = "geolocation" in navigator ? (navigator.geolocation as unknown as GeoLike) : null;
  return {
    geo, wakeLock: wakeLockDep(), doc: browserDoc(), store,
    now: () => Date.now(),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
    env: envDep("device", geo !== null),
    newId: () => crypto.randomUUID(),
  };
}

/** Synthetic drive: the driver is the geolocation AND the clock, so the whole session runs `speedup`× faster. */
function syntheticDeps(store: FaultInjectingStore, driver: SyntheticDriver): RecorderDeps {
  return {
    geo: driver, wakeLock: wakeLockDep(), doc: browserDoc(), store,
    now: driver.clock.now, setInterval: driver.clock.setInterval, clearInterval: driver.clock.clearInterval,
    env: envDep("synthetic", true),
    newId: () => crypto.randomUUID(),
  };
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

type Results = { summary: TrackSummary; report: Report };

export default function GpsRecorder() {
  // Created after mount (never during SSR) so server and client markup match.
  const [store, setStore] = useState<FaultInjectingStore | null>(null);
  const [storeMissing, setStoreMissing] = useState(false);
  const recRef = useRef<Recorder | null>(null);
  const driverRef = useRef<SyntheticDriver | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [fixAgeS, setFixAgeS] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [results, setResults] = useState<Results | null>(null);
  const [interrupted, setInterrupted] = useState<SessionMeta[]>([]);
  const [past, setPast] = useState<SessionMeta[]>([]);
  const [note, setNote] = useState<string | null>(null);
  // A location error stays readable for a few seconds after the next fix clears it (a flash is no use on the dash).
  const [geoNotice, setGeoNotice] = useState<{ n: number; text: string; recovered: boolean; note: boolean; until: number } | null>(null);
  const [wallNow, setWallNow] = useState(0);
  const [busy, setBusy] = useState(false);
  // Source + consent live only in React state: a reload always returns to Synthetic with consent off.
  const [source, setSource] = useState<Source>("synthetic");
  const [consent, setConsent] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [speedup, setSpeedup] = useState(DEFAULT_SPEEDUP);

  const refreshLists = useCallback(async () => {
    if (!store) return;
    const all = await store.listSessions();
    const current = recRef.current?.meta?.id;
    setInterrupted(all.filter((m) => m.stoppedAt === undefined && m.id !== current));
    setPast(all.filter((m) => m.stoppedAt !== undefined).slice(0, 8));
  }, [store]);

  useEffect(() => {
    if (typeof indexedDB === "undefined") setStoreMissing(true);
    else setStore(new FaultInjectingStore(new IndexedDbStore()));
    const q = Number(new URLSearchParams(window.location.search).get("speedup"));
    if (Number.isFinite(q) && q >= 1 && q <= 1000) setSpeedup(q);
  }, []);

  useEffect(() => { void refreshLists(); }, [refreshLists]);

  // Live clock: elapsed (recorder time, simulated for the synthetic drive) and the last-fix age.
  useEffect(() => {
    const tick = window.setInterval(() => {
      const rec = recRef.current;
      if (!rec || !rec.active) return;
      const now = rec.deps.now();
      setWallNow(Date.now());
      setElapsedMs(now - (rec.meta?.startedAt ?? now));
      setFixAgeS(rec.lastFix ? Math.max(0, Math.round((now - rec.lastFix.t) / 1000)) : null);
    }, 250);
    return () => window.clearInterval(tick);
  }, []);

  // Unmount (client-side navigation away): nothing may outlive the page — the watch, the wake lock, the intervals.
  useEffect(() => () => { driverRef.current?.dispose(); void recRef.current?.stop(); }, []);

  const attach = (rec: Recorder) => {
    recRef.current = rec;
    let frame = 0;
    const render = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const next = rec.snapshot();
        setSnap(next);
        // From the recorder's LAST error (fixes may have resumed within the same frame), not only the current one.
        setGeoNotice((cur) => {
          if (!next.lastGeoError) return null;
          const recovered = next.geoError === null;
          if (!cur || cur.n !== next.geoErrors) return { n: next.geoErrors, text: describeGeoError(next.lastGeoError) ?? "", recovered, note: next.lastGeoError.message === SYNTHETIC_DRIVE_FINISHED, until: recovered ? Date.now() + GEO_NOTICE_MS : Number.POSITIVE_INFINITY };
          if (!cur.recovered && recovered) return { ...cur, recovered: true, until: Date.now() + GEO_NOTICE_MS };
          return cur;
        });
        setLog(rec.recent.slice(-8).reverse().map((e) => `${new Date(e.t).toLocaleTimeString("en-AU", { hour12: false })} ${e.type}${e.detail ? ` ${e.detail}` : ""}`));
      });
    };
    rec.subscribe(render);
    render();
  };

  const start = async () => {
    if (!store || busy) return;
    if (source === "device" && !consent) return;
    setBusy(true);
    setResults(null); setNote(null); setConfirmClear(false); setGeoNotice(null);
    driverRef.current?.dispose();
    let rec: Recorder;
    if (source === "synthetic") {
      const driver = syntheticDriver(DEFAULT_DRIVE, { speedup });
      driverRef.current = driver;
      rec = new Recorder(syntheticDeps(store, driver));
    } else {
      driverRef.current = null;
      rec = new Recorder(deviceDeps(store));
    }
    attach(rec);
    await rec.start();
    setElapsedMs(0); setFixAgeS(null);
    setBusy(false);
    void refreshLists();
  };
  const pause = async () => { await recRef.current?.pause(); };
  const resume = async () => { await recRef.current?.resume(); };
  const showResults = async (id: string, recover: boolean) => {
    if (!store) return;
    if (recover) await recoverSession(store, id, Date.now());
    try {
      const data = await store.load(id);
      if (data) { setResults({ summary: summarizeTrack(data), report: analyzeSession(data) }); setNote(null); }
    } catch {
      // A damaged record must not break the page (or leave Stop busy): say so; Delete still works.
      setNote("This recording can't be read on this device. You can delete it.");
    }
    void refreshLists();
  };
  const stop = async () => {
    const rec = recRef.current;
    if (!rec || busy) return;
    setBusy(true);
    await rec.stop();
    driverRef.current?.dispose();
    if (rec.meta) await showResults(rec.meta.id, false);
    setBusy(false);
  };
  const deleteRecording = async (id: string) => {
    await store?.deleteSession(id);
    if (results?.summary.sessionId === id) setResults(null);
    void refreshLists();
  };
  const clearDevice = async () => {
    if (!store) return;
    if (recRef.current?.active) await stop();
    await store.clearAll();
    setResults(null); setConfirmClear(false); setNote("Everything recorded on this device has been deleted.");
    void refreshLists();
  };
  const copySummary = async () => {
    if (!results) return;
    try { await navigator.clipboard.writeText(JSON.stringify(results.summary, null, 2)); setNote("Summary JSON copied."); } catch { setNote("Copy failed — use Download summary JSON."); }
  };

  const state = snap?.state ?? "idle";
  const active = state === "recording" || state === "paused";
  const geoErrorText = geoNotice && (geoNotice.until === Number.POSITIVE_INFINITY || wallNow < geoNotice.until) ? `${geoNotice.text}${geoNotice.recovered ? " Fixes are arriving again." : ""}` : null;
  const canStart = !busy && !!store && !active && (source === "synthetic" || consent);
  const headline = state === "recording" ? "Recording" : state === "paused" ? "Paused" : state === "stopped" ? "Stopped" : "Ready";
  const verdictTone = !results ? "" : results.report.verdict.overall === "PWA_VIABLE" ? "ok" : results.report.verdict.overall === "INCONCLUSIVE" ? "warn" : "bad";
  const r = results?.summary;

  return (
    <main className="app gps">
      <header className="topbar gps-top">
        <div className="brand">
          <div className="brand-name"><strong>GPS recorder</strong><small>P4 isolated test · not part of lessons</small></div>
          <ThemeToggle />
        </div>
      </header>

      {storeMissing ? <p className="status error">IndexedDB is unavailable — this device cannot buffer fixes. Nothing can be recorded.</p> : null}

      {/* Source — Synthetic is the default and touches no location API; Real GPS needs consent for THIS session. */}
      <section className="card gps-source" aria-labelledby="gps-source-h">
        <h2 id="gps-source-h">Source</h2>
        <div className="view-tabs" role="radiogroup" aria-label="Position source" data-testid="gps-source" data-source={source} data-profile={JSON.stringify({ ...DEFAULT_DRIVE, speedup })}>
          <button type="button" role="radio" aria-checked={source === "synthetic"} className={`view-tab${source === "synthetic" ? " active" : ""}`} data-testid="gps-source-synthetic" disabled={active} onClick={() => { setSource("synthetic"); setConsent(false); }}>Synthetic drive</button>
          <button type="button" role="radio" aria-checked={source === "device"} className={`view-tab${source === "device" ? " active" : ""}`} data-testid="gps-source-device" disabled={active} onClick={() => setSource("device")}>Real GPS (this device)</button>
        </div>
        {source === "synthetic" ? (
          <p className="meta">A scripted 30-minute drive (43 km/h, 4 stops, one signal loss, one GPS jump, a minute without speed) replayed {speedup}× faster. No location is read.</p>
        ) : (
          <div className="gps-consent" data-testid="gps-consent">
            <p>Location is read only on this device while you record. Nothing is uploaded. Stop or Clear ends it.</p>
            <label className="gps-check">
              <input type="checkbox" checked={consent} disabled={active} onChange={(e) => setConsent(e.target.checked)} data-testid="gps-consent-box" />
              <span>I understand; use this device’s location for this recording</span>
            </label>
          </div>
        )}
      </section>

      {/* Live status — readable at a glance from the dash; the only taps happen while parked. */}
      <section className="card gps-live" aria-live="polite">
        <p className={`gps-state gps-state-${state}`} data-testid="gps-state" data-state={state}>
          <b>{headline}</b>
          {active || state === "stopped" ? <><span aria-hidden="true">·</span><span data-testid="gps-elapsed">{clock(elapsedMs)}</span><span aria-hidden="true">·</span><span data-testid="gps-distance">{km(snap?.distanceM ?? 0)}</span></> : <span className="gps-state-sub">{source === "synthetic" ? "synthetic drive" : consent ? "this device’s GPS" : "tick the consent box to enable Start"}</span>}
        </p>
        <div className="gps-actions">
          {!active ? <button type="button" className="btn gps-big go" data-testid="gps-start" disabled={!canStart} onClick={() => void start()}>Start</button> : null}
          {state === "recording" ? <button type="button" className="btn gps-big ghost" data-testid="gps-pause" onClick={() => void pause()}>Pause</button> : null}
          {state === "paused" ? <button type="button" className="btn gps-big go" data-testid="gps-resume" onClick={() => void resume()}>Resume</button> : null}
          {active ? <button type="button" className="btn gps-big stop" data-testid="gps-stop" disabled={busy} onClick={() => void stop()}>Stop</button> : null}
        </div>
        <dl className="gps-metrics" data-testid="gps-metrics">
          <div><dt>Fixes</dt><dd data-testid="gps-fixes">{snap?.samples ?? 0}</dd></div>
          <div><dt>Last fix</dt><dd data-testid="gps-fix-age">{fixAgeS === null || !active ? "—" : `${fixAgeS} s ago`}</dd></div>
          <div><dt>Accuracy</dt><dd>{snap?.lastAcc != null ? `${Math.round(snap.lastAcc)} m` : "—"}</dd></div>
          <div><dt>Speed</dt><dd>{snap?.lastSpeed != null ? `${Math.round(snap.lastSpeed * 3.6)} km/h` : "—"}</dd></div>
          <div><dt>Paused</dt><dd data-testid="gps-paused">{clock(snap?.pausedMs ?? 0)}</dd></div>
          <div><dt>Screen</dt><dd data-testid="gps-vis">{snap?.visibility ?? "—"}</dd></div>
          <div><dt>Wake lock</dt><dd data-testid="gps-wakelock">{snap?.wakeLock ?? "—"}</dd></div>
          <div><dt>Unsaved / flushed</dt><dd data-testid="gps-unsaved">{snap?.unflushed ?? 0} / {Math.max(0, (snap?.samples ?? 0) - (snap?.unflushed ?? 0))}</dd></div>
          <div><dt>Storage errors</dt><dd data-testid="gps-store-errors">{snap?.storeErrors ?? 0}</dd></div>
        </dl>
        {geoErrorText && geoNotice?.note ? <p className="status info" data-testid="gps-drive-finished">{geoNotice.text}</p> : geoErrorText ? <p className={`status ${geoNotice?.recovered ? "info" : "warn"} gps-geo-error`} data-testid="gps-geo-error" data-recovered={geoNotice?.recovered ? "1" : "0"}>{geoErrorText}</p> : null}
        {active && source === "synthetic" && driverRef.current ? (
          <details className="group gps-tools" data-testid="gps-tools">
            <summary>Test tools <small>synthetic only</small></summary>
            <div className="inner">
              <div className="gps-row">
                <button type="button" className="btn ghost" data-testid="gps-inject-denied" onClick={() => driverRef.current?.injectGeoError(1)}>GPS error: denied</button>
                <button type="button" className="btn ghost" data-testid="gps-inject-unavailable" onClick={() => driverRef.current?.injectGeoError(2)}>GPS error: unavailable</button>
                <button type="button" className="btn ghost" data-testid="gps-inject-timeout" onClick={() => driverRef.current?.injectGeoError(3)}>GPS error: timeout</button>
                <button type="button" className="btn ghost" data-testid="gps-inject-store" onClick={() => { if (store) store.failNext += 1; }}>Storage failure ×1</button>
              </div>
            </div>
          </details>
        ) : null}
        <ul className="gps-log" aria-label="Recent events" data-testid="gps-log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </section>

      {interrupted.length ? (
        <section className="card" data-testid="gps-interrupted">
          <h2>Interrupted recording found</h2>
          {interrupted.map((m) => (
            <div key={m.id} className="gps-past">
              <p className="meta">Started {when(m.startedAt)} and never stopped — the page was closed, reloaded or killed. The fixes already saved are still on this device.</p>
              <div className="gps-row">
                <button type="button" className="btn primary" data-testid="gps-recover" onClick={() => void showResults(m.id, true)}>Recover and show results</button>
                <button type="button" className="btn ghost" onClick={() => void deleteRecording(m.id)}>Delete</button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {r && results ? (
        <section className="card gps-results" data-testid="gps-results" data-session={r.sessionId}>
          <h2>Results</h2>
          <p className="meta">{when(new Date(r.startedAt).getTime())}{r.recovered ? " · recovered" : ""}</p>
          <dl className="gps-metrics gps-summary">
            <div className="wide"><dt>GPS distance (diagnostic) — the odometer stays official</dt><dd data-testid="gps-r-distance">{(r.distanceM / 1000).toFixed(2)} km</dd></div>
            <div><dt>Moving</dt><dd data-testid="gps-r-moving">{fmtMs(r.movingMs)}</dd></div>
            <div><dt>Stopped</dt><dd data-testid="gps-r-stopped">{fmtMs(r.stoppedMs)}</dd></div>
            <div><dt>Stops (≥ 3 s)</dt><dd data-testid="gps-r-stops">{r.stops.count} · {fmtMs(r.stops.totalMs)}</dd></div>
            <div><dt>Max speed</dt><dd data-testid="gps-r-max">{r.maxSpeedKmh === null ? "—" : `${r.maxSpeedKmh} km/h`}</dd></div>
            <div><dt>Coverage</dt><dd data-testid="gps-r-coverage">{r.coveragePct}%</dd></div>
            <div><dt>Recorded</dt><dd data-testid="gps-r-recorded">{fmtMs(r.recordedMs)}</dd></div>
            <div><dt>Paused</dt><dd data-testid="gps-r-paused">{fmtMs(r.pausedMs)}{r.pauses ? ` (${r.pauses}×)` : ""}</dd></div>
            <div><dt>Gaps (&gt; 15 s)</dt><dd data-testid="gps-r-gaps">{r.gaps.count}{r.gaps.count ? ` · max ${fmtMs(r.gaps.maxMs)}` : ""}</dd></div>
            <div><dt>Fixes used</dt><dd>{r.usedFixes} / {r.fixes}{r.jumps ? ` · ${r.jumps} jump${r.jumps > 1 ? "s" : ""}` : ""}</dd></div>
            <div><dt>Start/end trimmed</dt><dd>{r.trimming.enabled ? `${r.trimming.trimmedStart + r.trimming.trimmedEnd} pts (${r.trimming.radiusM} m)` : "off"}</dd></div>
          </dl>
          <details className="group gps-feasibility" data-testid="gps-feasibility">
            <summary>Feasibility report <small>{results.report.verdict.overall.replace(/_/g, " ")}</small></summary>
            <div className="inner">
              <div className={`gps-verdict ${verdictTone}`} data-testid="gps-verdict">
                {results.report.verdict.overall.replace(/_/g, " ")}
                {results.report.verdict.reasons.map((x) => <small key={x}>{x}</small>)}
              </div>
              <dl className="gps-metrics">
                <div><dt>Recording time</dt><dd>{fmtMs(results.report.recordingMs)}</dd></div>
                <div><dt>Coverage (all)</dt><dd>{pct(results.report.coverage.overall)}</dd></div>
                <div><dt>Screen-on coverage</dt><dd>{pct(results.report.coverage.foreground)}</dd></div>
                <div><dt>Screen-off / background</dt><dd>{pct(results.report.coverage.background)} of {fmtMs(results.report.coverage.hiddenMs)}</dd></div>
                <div><dt>Interval median / p95</dt><dd>{fmtMs(results.report.intervals.medianMs)} / {fmtMs(results.report.intervals.p95Ms)}</dd></div>
                <div><dt>Time to first fix</dt><dd>{fmtMs(results.report.timeToFirstFixMs)}</dd></div>
                <div><dt>Page frozen</dt><dd>{results.report.jsSuspension.periods}× (max {fmtMs(results.report.jsSuspension.maxMs)})</dd></div>
                <div><dt>Late-delivered fixes</dt><dd>{results.report.dataQuality.lateDelivered}</dd></div>
                <div><dt>Accuracy median / p95</dt><dd>{results.report.accuracy.medianM ?? "—"} / {results.report.accuracy.p95M ?? "—"} m</dd></div>
                <div><dt>Wake lock held</dt><dd>{results.report.wakeLock.heldPct}% ({results.report.wakeLock.acquired}× on)</dd></div>
              </dl>
              {results.report.gaps.list.length ? (
                <ul className="gps-gaps">{results.report.gaps.list.slice(0, 8).map((g) => <li key={g.from}>{new Date(g.from).toLocaleTimeString("en-AU", { hour12: false })} · {fmtMs(g.ms)} · {g.cls}{g.jsSuspended ? " · page frozen" : ""}</li>)}</ul>
              ) : <p className="meta">No gaps.</p>}
            </div>
          </details>
          <div className="gps-row">
            <button type="button" className="btn primary" data-testid="gps-copy" onClick={() => void copySummary()}>Copy summary JSON</button>
            <button type="button" className="btn ghost" data-testid="gps-download" onClick={() => download(`gps-summary-${r.sessionId.slice(0, 8)}.json`, JSON.stringify(results.summary, null, 2))}>Download summary JSON</button>
            <button type="button" className="btn ghost gps-danger" data-testid="gps-delete" onClick={() => void deleteRecording(r.sessionId)}>Delete this recording</button>
          </div>
          <p className="meta">Numbers only — no coordinates leave this card.</p>
        </section>
      ) : null}
      {note ? <p className="status info" role="status" data-testid="gps-note">{note}</p> : null}

      {past.length && !active ? (
        <section className="card" data-testid="gps-earlier">
          <h2>Earlier recordings</h2>
          {past.map((m) => (
            <div key={m.id} className="gps-row gps-past">
              <button type="button" className="btn ghost" data-testid="gps-earlier-open" onClick={() => void showResults(m.id, false)}>{when(m.startedAt)}{m.env.source === "device" ? " · device" : " · synthetic"}</button>
              <button type="button" className="btn ghost gps-danger" data-testid="gps-earlier-delete" onClick={() => void deleteRecording(m.id)}>Delete</button>
            </div>
          ))}
        </section>
      ) : null}

      {store && (past.length || interrupted.length || active) ? (
        <section className="card gps-clear" data-testid="gps-clear">
          {!confirmClear ? (
            <button type="button" className="btn ghost gps-danger block" data-testid="gps-clear-device" onClick={() => setConfirmClear(true)}>Clear this device</button>
          ) : (
            <div>
              <p className="status warn">Delete every recording on this device ({past.length + interrupted.length + (active ? 1 : 0)})? This cannot be undone.</p>
              <div className="gps-row">
                <button type="button" className="btn danger" data-testid="gps-clear-confirm" onClick={() => void clearDevice()}>Delete all</button>
                <button type="button" className="btn ghost" data-testid="gps-clear-cancel" onClick={() => setConfirmClear(false)}>Keep</button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      <p className="gps-foot">Isolated test page · nothing leaves this device · not part of lesson records</p>
    </main>
  );
}
