// Device-local, append-only buffer for a recording session. Same interface for tests (memory) and the phone (IndexedDB).
import type { LabEvent, Sample, SessionData, SessionMeta } from "./types.ts";

export interface SampleStore {
  putMeta(meta: SessionMeta): Promise<void>;
  append(sessionId: string, samples: Sample[], events: LabEvent[]): Promise<void>;
  load(sessionId: string): Promise<SessionData | null>;
  listSessions(): Promise<SessionMeta[]>;
  deleteSession(id: string): Promise<void>;
}

/** In-memory store; `failNext` simulates quota/IndexedDB failures. */
export class MemoryStore implements SampleStore {
  metas = new Map<string, SessionMeta>();
  samples = new Map<string, Sample[]>();
  events = new Map<string, LabEvent[]>();
  failNext = 0;
  async putMeta(meta: SessionMeta) {
    this.#maybeFail();
    this.metas.set(meta.id, structuredClone(meta));
  }
  async append(id: string, samples: Sample[], events: LabEvent[]) {
    this.#maybeFail();
    this.samples.set(id, [...(this.samples.get(id) ?? []), ...structuredClone(samples)]);
    this.events.set(id, [...(this.events.get(id) ?? []), ...structuredClone(events)]);
  }
  async load(id: string): Promise<SessionData | null> {
    const meta = this.metas.get(id);
    return meta ? { meta: structuredClone(meta), samples: structuredClone(this.samples.get(id) ?? []), events: structuredClone(this.events.get(id) ?? []) } : null;
  }
  async listSessions() {
    return [...this.metas.values()].map((m) => structuredClone(m)).sort((a, b) => b.startedAt - a.startedAt);
  }
  async deleteSession(id: string) {
    this.metas.delete(id);
    this.samples.delete(id);
    this.events.delete(id);
  }
  #maybeFail() {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("simulated store failure");
    }
  }
}

const DB_NAME = "gps-lab";
const req = <T,>(r: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (tx: IDBTransaction): Promise<void> => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

/** Browser IndexedDB store: one transaction per flush, so a kill loses at most the unflushed tail. */
export class IndexedDbStore implements SampleStore {
  #db: Promise<IDBDatabase> | null = null;
  #open(): Promise<IDBDatabase> {
    this.#db ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore("meta", { keyPath: "id" });
        db.createObjectStore("samples", { autoIncrement: true }).createIndex("sid", "sid");
        db.createObjectStore("events", { autoIncrement: true }).createIndex("sid", "sid");
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return this.#db;
  }
  async putMeta(meta: SessionMeta) {
    const tx = (await this.#open()).transaction("meta", "readwrite");
    tx.objectStore("meta").put(meta);
    await done(tx);
  }
  async append(id: string, samples: Sample[], events: LabEvent[]) {
    const tx = (await this.#open()).transaction(["samples", "events"], "readwrite");
    for (const s of samples) tx.objectStore("samples").add({ ...s, sid: id });
    for (const e of events) tx.objectStore("events").add({ ...e, sid: id });
    await done(tx);
  }
  async load(id: string): Promise<SessionData | null> {
    const db = await this.#open();
    const meta = (await req(db.transaction("meta").objectStore("meta").get(id))) as SessionMeta | undefined;
    if (!meta) return null;
    const strip = <T extends { sid?: string }>(row: T): Omit<T, "sid"> => { const { sid: _sid, ...rest } = row; return rest; };
    const samples = (await req(db.transaction("samples").objectStore("samples").index("sid").getAll(id))) as (Sample & { sid: string })[];
    const events = (await req(db.transaction("events").objectStore("events").index("sid").getAll(id))) as (LabEvent & { sid: string })[];
    return { meta, samples: samples.map(strip) as Sample[], events: events.map(strip) as LabEvent[] };
  }
  async listSessions() {
    const all = (await req((await this.#open()).transaction("meta").objectStore("meta").getAll())) as SessionMeta[];
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }
  async deleteSession(id: string) {
    const db = await this.#open();
    const tx = db.transaction(["meta", "samples", "events"], "readwrite");
    tx.objectStore("meta").delete(id);
    for (const name of ["samples", "events"] as const) {
      const cursorReq = tx.objectStore(name).index("sid").openKeyCursor(IDBKeyRange.only(id));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) { tx.objectStore(name).delete(cursor.primaryKey); cursor.continue(); }
      };
    }
    await done(tx);
  }
}
