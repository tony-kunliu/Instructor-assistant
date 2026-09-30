"use client";

// GPS PWA feasibility harness (P4-A spike). Measures reliability — never draws a map, never touches lessons or the database.
import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeSession, type Report } from "@/lib/gps-lab/analysis.ts";
import { Recorder, findInterrupted, recoverSession, type DocLike, type GeoLike, type RecorderDeps, type Snapshot, type WakeLockLike } from "@/lib/gps-lab/recorder.ts";
import { IndexedDbStore } from "@/lib/gps-lab/store.ts";
import type { SessionMeta } from "@/lib/gps-lab/types.ts";
import "./gps-lab.css";

const fmtMs = (ms: number | null) => (ms === null ? "—" : ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`);
const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);

function browserDeps(store: IndexedDbStore): RecorderDeps {
  const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<EventTarget & { release(): Promise<void> }> }; standalone?: boolean };
  const geo: GeoLike | null = "geolocation" in navigator ? (navigator.geolocation as unknown as GeoLike) : null;
  const wakeLock: WakeLockLike | null = nav.wakeLock
    ? { request: async () => { const s = await nav.wakeLock!.request("screen"); return { release: () => s.release(), onrelease: (cb) => s.addEventListener("release", cb) }; } }
    : null;
  const doc: DocLike = {
    visibility: () => (document.visibilityState === "visible" ? "visible" : "hidden"),
    onVisibility: (cb) => { document.addEventListener("visibilitychange", cb); return () => document.removeEventListener("visibilitychange", cb); },
    onLifecycle: (cb) => {
      const handlers: [EventTarget, string, () => void][] = [
        [window, "pagehide", () => cb("pagehide")], [window, "pageshow", () => cb("pageshow")],
        [document, "freeze", () => cb("freeze")], [document, "resume", () => cb("resume")],
      ];
      for (const [target, name, fn] of handlers) target.addEventListener(name, fn);
      return () => { for (const [target, name, fn] of handlers) target.removeEventListener(name, fn); };
    },
  };
  return {
    geo, wakeLock, doc, store,
    now: () => Date.now(),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
    env: {
      userAgent: navigator.userAgent,
      standalone: Boolean(nav.standalone) || window.matchMedia("(display-mode: standalone)").matches,
      wakeLockSupported: Boolean(nav.wakeLock),
      geolocationSupported: Boolean(geo),
    },
    newId: () => crypto.randomUUID(),
  };
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

export default function GpsLab() {
  // Created after mount (never during SSR) so server and client markup match.
  const [store, setStore] = useState<IndexedDbStore | null>(null);
  const [storeMissing, setStoreMissing] = useState(false);
  const recRef = useRef<Recorder | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [report, setReport] = useState<Report | null>(null);
  const [interrupted, setInterrupted] = useState<SessionMeta[]>([]);
  const [past, setPast] = useState<SessionMeta[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const refreshLists = useCallback(async () => {
    if (!store) return;
    const all = await store.listSessions();
    setInterrupted(all.filter((m) => m.stoppedAt === undefined && recRef.current?.meta?.id !== m.id));
    setPast(all.filter((m) => m.stoppedAt !== undefined).slice(0, 5));
  }, [store]);

  useEffect(() => {
    if (typeof indexedDB === "undefined") setStoreMissing(true);
    else setStore(new IndexedDbStore());
  }, []);

  useEffect(() => {
    if (!store) return;
    const rec = new Recorder(browserDeps(store));
    recRef.current = rec;
    const render = () => { setSnap(rec.snapshot()); setLog(rec.recent.slice(-10).reverse().map((e) => `${new Date(e.t).toLocaleTimeString("en-AU", { hour12: false })} ${e.type}${e.detail ? ` ${e.detail}` : ""}`)); };
    const off = rec.subscribe(render);
    render();
    void refreshLists();
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { off(); window.clearInterval(tick); };
  }, [store, refreshLists]);

  const start = async () => {
    setReport(null); setNote(null);
    await recRef.current?.start();
    void refreshLists();
  };
  const stop = async () => {
    const r = await recRef.current?.stop();
    if (r) setReport(r);
    void refreshLists();
  };
  const showReport = async (id: string, recover: boolean) => {
    if (!store) return;
    const r = recover ? await recoverSession(store, id, Date.now()) : (await store.load(id)) && analyzeSession((await store.load(id))!);
    if (r) setReport(r);
    void refreshLists();
  };
  const exportRaw = async (id: string) => {
    const data = await store?.load(id);
    if (data) download(`gps-lab-raw-${id.slice(0, 8)}.json`, JSON.stringify(data));
  };
  const copyReport = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); setNote("Report JSON copied."); } catch { setNote("Copy failed — use Download report."); }
  };

  const active = snap?.active ?? false;
  const fixAge = snap?.lastFixAt ? Math.max(0, Math.round((now - snap.lastFixAt) / 1000)) : null;
  const tone = !report ? "" : report.verdict.overall === "PWA_VIABLE" ? "ok" : report.verdict.overall === "INCONCLUSIVE" ? "warn" : "bad";

  return (
    <main className="app lab">
      <header className="topbar"><div><strong>GPS Lab</strong><small>P4-A feasibility spike — not part of lessons</small></div></header>

      {storeMissing ? <p className="status error">IndexedDB is unavailable — cannot buffer fixes on this device.</p> : null}

      <section className="card">
        <p className="state-line" data-testid="lab-state">{active ? "Recording" : "Not recording"}</p>
        {!active ? (
          <button type="button" className="btn huge" data-testid="lab-start" onClick={() => void start()}>Start recording</button>
        ) : (
          <button type="button" className="btn huge" data-testid="lab-stop" onClick={() => void stop()}>Stop and get report</button>
        )}
        <dl className="metrics" data-testid="lab-metrics">
          <div><dt>Fixes</dt><dd data-testid="lab-fixes">{snap?.samples ?? 0}</dd></div>
          <div><dt>Last fix</dt><dd data-testid="lab-fix-age">{fixAge === null ? "—" : `${fixAge}s ago`}</dd></div>
          <div><dt>Accuracy</dt><dd>{snap?.lastAcc != null ? `${Math.round(snap.lastAcc)} m` : "—"}</dd></div>
          <div><dt>Speed</dt><dd>{snap?.lastSpeed != null ? `${Math.round(snap.lastSpeed * 3.6)} km/h` : "—"}</dd></div>
          <div><dt>Screen</dt><dd data-testid="lab-vis">{snap?.visibility ?? "—"}</dd></div>
          <div><dt>Wake lock</dt><dd data-testid="lab-wakelock">{snap?.wakeLock ?? "—"}</dd></div>
          <div><dt>Unsaved</dt><dd>{snap?.unflushed ?? 0}</dd></div>
          <div><dt>Storage errors</dt><dd>{snap?.storeErrors ?? 0}</dd></div>
        </dl>
        {snap?.geoError ? <p className="status error" data-testid="lab-geo-error">GPS: {snap.geoError}</p> : null}
        <ul className="log" aria-label="Recent events" data-testid="lab-log">{log.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </section>

      {interrupted.length ? (
        <section className="card" data-testid="lab-interrupted">
          <h2>Interrupted recording found</h2>
          {interrupted.map((m) => (
            <div key={m.id}>
              <p className="meta">Started {new Date(m.startedAt).toLocaleString("en-AU")} and never stopped — the page was closed, reloaded or killed. Your buffered fixes are still on this device.</p>
              <div className="row">
                <button type="button" className="btn primary" data-testid="lab-recover" onClick={() => void showReport(m.id, true)}>Recover and show report</button>
                <button type="button" className="btn ghost" onClick={() => void exportRaw(m.id)}>Download raw trace</button>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {report ? (
        <section className="card" data-testid="lab-report">
          <div className={`verdict ${tone}`} data-testid="lab-verdict">
            {report.verdict.overall.replace(/_/g, " ")}
            {report.verdict.reasons.map((r) => <small key={r}>{r}</small>)}
          </div>
          <dl className="metrics">
            <div><dt>Duration</dt><dd>{fmtMs(report.durationMs)}</dd></div>
            <div><dt>Fixes</dt><dd>{report.samples}</dd></div>
            <div><dt>Coverage (all)</dt><dd>{pct(report.coverage.overall)}</dd></div>
            <div><dt>Screen-on coverage</dt><dd>{pct(report.coverage.foreground)}</dd></div>
            <div><dt>Screen-off / background</dt><dd>{pct(report.coverage.background)} of {fmtMs(report.coverage.hiddenMs)}</dd></div>
            <div><dt>Gaps (&gt;15 s)</dt><dd>{report.gaps.count} (max {fmtMs(report.gaps.maxMs)})</dd></div>
            <div><dt>Interval median / p95</dt><dd>{fmtMs(report.intervals.medianMs)} / {fmtMs(report.intervals.p95Ms)}</dd></div>
            <div><dt>Time to first fix</dt><dd>{fmtMs(report.timeToFirstFixMs)}</dd></div>
            <div><dt>Page frozen</dt><dd>{report.jsSuspension.periods}× (max {fmtMs(report.jsSuspension.maxMs)})</dd></div>
            <div><dt>Late-delivered fixes</dt><dd>{report.dataQuality.lateDelivered}</dd></div>
            <div><dt>Accuracy median / p95</dt><dd>{report.accuracy.medianM ?? "—"} / {report.accuracy.p95M ?? "—"} m</dd></div>
            <div><dt>Wake lock held</dt><dd>{report.wakeLock.heldPct}% ({report.wakeLock.acquired}× on)</dd></div>
            <div><dt>GPS distance</dt><dd>{(report.distanceM / 1000).toFixed(2)} km</dd></div>
            <div><dt>Recovered?</dt><dd>{report.recovered ? "yes" : "no"}</dd></div>
          </dl>
          {report.gaps.list.length ? (
            <ul className="gaps">{report.gaps.list.slice(0, 8).map((g) => <li key={g.from}>{new Date(g.from).toLocaleTimeString("en-AU", { hour12: false })} · {fmtMs(g.ms)} · {g.cls}{g.jsSuspended ? " · page frozen" : ""}</li>)}</ul>
          ) : <p className="meta">No gaps.</p>}
          <div className="row">
            <button type="button" className="btn primary" data-testid="lab-copy" onClick={() => void copyReport()}>Copy report</button>
            <button type="button" className="btn ghost" data-testid="lab-download" onClick={() => download(`gps-lab-report-${report.sessionId.slice(0, 8)}.json`, JSON.stringify(report, null, 2))}>Download report</button>
            <button type="button" className="btn ghost" onClick={() => void exportRaw(report.sessionId)}>Raw trace (your route)</button>
          </div>
          {note ? <p className="meta" role="status">{note}</p> : null}
          <p className="meta">The report holds statistics only — no coordinates. Send it back as-is.</p>
        </section>
      ) : null}

      {past.length && !active ? (
        <section className="card">
          <h2>Earlier recordings</h2>
          {past.map((m) => (
            <div key={m.id} className="row">
              <button type="button" className="btn ghost" onClick={() => void showReport(m.id, false)}>{new Date(m.startedAt).toLocaleString("en-AU")}</button>
              <button type="button" className="btn ghost" onClick={() => void store?.deleteSession(m.id).then(refreshLists)}>Delete</button>
            </div>
          ))}
        </section>
      ) : null}

      <section className="card">
        <h2>One real test (≈ 30 min)</h2>
        <ol className="steps">
          <li>Add this page to the Home Screen and open it from there. Allow location “While Using”.</li>
          <li>Tap <b>Start recording</b>, put the phone on the dash / in a holder, then drive about 30 minutes on a normal route.</li>
          <li>At roughly 5 minutes: <b>lock the screen</b> for ~5 minutes (side button). At roughly 15 minutes: switch to another app (e.g. Maps) for ~5 minutes.</li>
          <li>Keep the screen on for the rest. Do not interact while moving — have the student or a passenger do steps 2–3 if needed.</li>
          <li>When parked, open this page and tap <b>Stop and get report</b> (if the page was closed, use <b>Recover</b>). Copy the report back.</li>
        </ol>
      </section>
      <p className="foot">Experiment branch · no data leaves this device</p>
    </main>
  );
}
