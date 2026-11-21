import { deviceDeps } from "./browser.ts";
import { lessonGpsNotes, type LessonGpsNotes } from "./lesson-gps-notes.ts";
import { describeGeoError, Recorder, recoverSession } from "./recorder.ts";
import { IndexedDbStore } from "./store.ts";

const DRAFT_RETENTION_MS = 24 * 60 * 60 * 1000;

export class LessonGpsCapture {
  private readonly store = new IndexedDbStore("ia-lesson-gps");
  private active: { id: string; recorder: Recorder; off: () => void; release: () => void } | null = null;
  private readonly stopping = new Map<string, Promise<void>>();
  private readonly results = new Map<string, Promise<LessonGpsNotes | null>>();

  start(id: string, onStatus: (text: string) => void) {
    void this.stop();
    try {
      if (!navigator.locks) {
        onStatus("GPS is unavailable in this browser. The lesson can continue.");
        return;
      }
      const recorder = new Recorder(deviceDeps(this.store, () => id));
      const off = recorder.subscribe(() => {
        const snapshot = recorder.snapshot();
        onStatus(describeGeoError(snapshot.geoError) ?? (snapshot.samples ? "GPS recording on this device." : "Waiting for GPS…"));
      });
      let release = () => {};
      const unlocked = new Promise<void>((resolve) => { release = resolve; });
      this.active = { id, recorder, off, release };
      const fail = () => {
        if (this.active?.id !== id) return;
        onStatus("GPS is unavailable. The lesson can continue.");
        void this.stop(id);
      };
      void this.withLock(id, async () => {
        if (this.active?.id !== id) return;
        void recorder.start().catch(fail);
        await unlocked;
      }).catch(fail);
    } catch {
      onStatus("GPS is unavailable. The lesson can continue.");
    }
  }

  stop(id = this.active?.id): Promise<void> {
    if (!id) return Promise.resolve();
    const existing = this.stopping.get(id);
    if (existing) return existing;
    if (this.active?.id !== id) return Promise.resolve();
    const { recorder, off, release } = this.active;
    this.active = null;
    off();
    const stopped = recorder.stop().then(() => undefined, () => undefined).finally(() => {
      release();
      this.stopping.delete(id);
    });
    this.stopping.set(id, stopped);
    return stopped;
  }

  collect(id: string, endedAt: number): Promise<LessonGpsNotes | null> {
    const existing = this.results.get(id);
    if (existing) return existing;
    const result = this.read(id, endedAt).catch(() => null);
    this.results.set(id, result);
    return result;
  }

  private async withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    // Old browsers can still clean up their device store but do not start new private-edition GPS sessions.
    return navigator.locks ? navigator.locks.request(`ia-lesson-gps:${id}`, work) : work();
  }

  private async read(id: string, endedAt: number) {
    await this.stop(id);
    const data = await this.withLock(id, async () => {
      const saved = await this.store.load(id);
      if (saved && saved.meta.stoppedAt === undefined) {
        await recoverSession(this.store, id, endedAt);
        return this.store.load(id);
      }
      return saved;
    });
    if (!data) return null;
    return lessonGpsNotes(data, endedAt - (data.meta.stoppedAt ?? 0) > 1_000);
  }

  async remove(id: string) {
    await this.stop(id);
    this.results.delete(id);
    await this.withLock(id, () => this.store.deleteSession(id)).catch(() => undefined);
  }

  async prune() {
    try {
      const cutoff = Date.now() - DRAFT_RETENTION_MS;
      for (const session of await this.store.listSessions()) {
        if (session.startedAt < cutoff) await this.withLock(session.id, () => this.store.deleteSession(session.id));
      }
    } catch { /* Location remains optional on devices without IndexedDB. */ }
  }
}
