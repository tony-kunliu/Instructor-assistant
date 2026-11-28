import type { DocLike, GeoLike, RecorderDeps, WakeLockLike } from "./recorder.ts";
import type { SampleStore } from "./store.ts";

export const browserDoc = (): DocLike => ({
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

export function wakeLockDep(): WakeLockLike | null {
  const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<EventTarget & { release(): Promise<void> }> } };
  return nav.wakeLock
    ? { request: async () => { const s = await nav.wakeLock!.request("screen"); return { release: () => s.release(), onrelease: (cb) => s.addEventListener("release", cb) }; } }
    : null;
}

export function browserEnv(source: "device" | "synthetic", geolocationSupported: boolean): RecorderDeps["env"] {
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
export function deviceDeps(store: SampleStore, newId = () => crypto.randomUUID()): RecorderDeps {
  const geo: GeoLike | null = "geolocation" in navigator ? (navigator.geolocation as unknown as GeoLike) : null;
  return {
    geo, wakeLock: wakeLockDep(), doc: browserDoc(), store,
    now: () => Date.now(),
    setInterval: (fn, ms) => window.setInterval(fn, ms),
    clearInterval: (id) => window.clearInterval(id as number),
    env: browserEnv("device", geo !== null),
    newId,
  };
}
