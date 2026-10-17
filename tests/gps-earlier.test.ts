// "Earlier recordings" one-line summaries (read-only, in memory). Synthetic fixtures only: MemoryStore + the scripted drive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EARLIER_SUMMARY_LIMIT, loadEarlierSummaries } from "../lib/gps/earlier.ts";
import { coverageText, distanceText, earlierSummaryLine, fmtMs, recordedText } from "../lib/gps/format.ts";
import { MemoryStore, type SampleStore } from "../lib/gps/store.ts";
import { summarizeTrack } from "../lib/gps/summary.ts";
import { syntheticSession } from "../lib/gps/synthetic.ts";
import type { SessionData, SessionMeta } from "../lib/gps/types.ts";

const session = (id: string, startedAt: number, durationS = 600): SessionData => {
  const d = syntheticSession({ durationS, startAt: startedAt });
  return { ...d, meta: { ...d.meta, id, startedAt, stoppedAt: startedAt + durationS * 1000 } };
};
async function seed(store: MemoryStore, data: SessionData) {
  await store.putMeta(data.meta);
  await store.append(data.meta.id, data.samples, data.events);
}
/** A store that refuses every write: proves the projection only reads. */
const readOnly = (inner: SampleStore): SampleStore & { loads: string[] } => {
  const loads: string[] = [];
  const no = () => { throw new Error("write attempted"); };
  return { loads, putMeta: no, append: no, deleteSession: no, clearAll: no, listSessions: () => inner.listSessions(), load: async (id) => { loads.push(id); return inner.load(id); } };
};
const collect = async (store: Pick<SampleStore, "load">, metas: SessionMeta[], extra: Partial<Parameters<typeof loadEarlierSummaries>[2]> = {}) => {
  const got: [string, string | null][] = [];
  await loadEarlierSummaries(store, metas, { isCurrent: () => true, onResult: (id, line) => got.push([id, line]), ...extra });
  return got;
};

test("the line is built from the SAME formatters as the Results card: distance, Recorded (total, incl. pause), Coverage", () => {
  const s = summarizeTrack(session("a", Date.UTC(2026, 9, 1), 900));
  assert.equal(earlierSummaryLine(s), `${distanceText(s)} · Recorded ${recordedText(s)} · Coverage ${coverageText(s)}`);
  assert.match(earlierSummaryLine(s), /^\d+\.\d{2} km · Recorded \d+(\.\d)? (min|s) · Coverage \d+(\.\d)?%$/);
  assert.equal(recordedText(s), fmtMs(s.recordedMs), "total duration, not movingMs");
  assert.notEqual(s.movingMs, s.recordedMs, "fixture has parked time, so Recorded and Moving differ");
});

test("fmtMs keeps its exact old behaviour (moved from the page)", () => {
  assert.equal(fmtMs(null), "—");
  assert.equal(fmtMs(0), "0.0 s");
  assert.equal(fmtMs(59_949), "59.9 s");
  assert.equal(fmtMs(60_000), "1.0 min");
  assert.equal(fmtMs(1_626_000), "27.1 min");
});

test("only the newest five are read, one at a time, in list order; each gets its own line", async () => {
  const store = new MemoryStore();
  const metas: SessionMeta[] = [];
  for (let i = 0; i < 8; i++) { const d = session(`s${i}`, Date.UTC(2026, 9, 1) + i * 86_400_000); await seed(store, d); metas.push(d.meta); }
  const ro = readOnly(store);
  const got = await collect(ro, metas);
  assert.equal(EARLIER_SUMMARY_LIMIT, 5);
  assert.deepEqual(got.map(([id]) => id), ["s0", "s1", "s2", "s3", "s4"]);
  assert.deepEqual(ro.loads, ["s0", "s1", "s2", "s3", "s4"]);
  for (const [id, line] of got) assert.equal(line, earlierSummaryLine(summarizeTrack((await store.load(id))!)));
});

test("projection never writes: every write method of the store would throw, and nothing did", async () => {
  const store = new MemoryStore();
  const d = session("w", Date.UTC(2026, 9, 1)); await seed(store, d);
  const before = JSON.stringify([...store.metas], (_k, v) => v).length + store.samples.get("w")!.length + store.events.get("w")!.length;
  await collect(readOnly(store), [d.meta]);
  assert.equal(JSON.stringify([...store.metas]).length + store.samples.get("w")!.length + store.events.get("w")!.length, before);
});

test("a recording that cannot be summarised falls back alone: missing data, a throwing load, malformed fields", async () => {
  const store = new MemoryStore();
  const good = session("good", Date.UTC(2026, 9, 1)); await seed(store, good);
  const empty = session("empty", Date.UTC(2026, 9, 2), 0); empty.samples = []; empty.events = []; await seed(store, empty);
  const bad: SessionMeta = { ...session("bad", Date.UTC(2026, 9, 3)).meta, pauses: 7 as never }; await store.putMeta(bad);
  const ghost: SessionMeta = { ...good.meta, id: "ghost" }; // listed, but nothing stored under it
  const throwing: SampleStore["load"] = async (id) => { if (id === "boom") throw new Error("IndexedDB read failed"); return store.load(id); };
  const boom: SessionMeta = { ...good.meta, id: "boom" };
  const got = Object.fromEntries(await collect({ load: throwing }, [good.meta, empty.meta, bad, ghost, boom]));
  assert.equal(got.good, earlierSummaryLine(summarizeTrack(good)));
  assert.equal(typeof got.empty, "string", "an empty recording summarises like its detail card (zeros), it does not block");
  assert.equal(got.empty, earlierSummaryLine(summarizeTrack(empty)));
  assert.equal(got.bad, null, "malformed record: no line, nothing thrown");
  assert.equal(got.ghost, null);
  assert.equal(got.boom, null);
});

test("a superseded run stops reading and drops late results", async () => {
  const store = new MemoryStore();
  const metas: SessionMeta[] = [];
  for (let i = 0; i < 4; i++) { const d = session(`s${i}`, Date.UTC(2026, 9, 1) + i * 86_400_000); await seed(store, d); metas.push(d.meta); }
  let current = true;
  const loads: string[] = [];
  const got: string[] = [];
  await loadEarlierSummaries({ load: async (id) => { loads.push(id); if (id === "s1") current = false; return store.load(id); } }, metas, { isCurrent: () => current, onResult: (id) => got.push(id) });
  assert.deepEqual(got, ["s0"], "the result that arrived after the run was superseded is dropped");
  assert.deepEqual(loads, ["s0", "s1"], "and no further recording is read");
});

test("recordings that already have a line are not read again", async () => {
  const store = new MemoryStore();
  const a = session("a", Date.UTC(2026, 9, 1)), b = session("b", Date.UTC(2026, 9, 2)); await seed(store, a); await seed(store, b);
  const ro = readOnly(store);
  const got = await collect(ro, [a.meta, b.meta], { skip: (id) => id === "a" });
  assert.deepEqual(got.map(([id]) => id), ["b"]);
  assert.deepEqual(ro.loads, ["b"]);
});
