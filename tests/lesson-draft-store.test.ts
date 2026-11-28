import assert from "node:assert/strict";
import test from "node:test";
import {
  casTombstone, casWriteDraft, encodeDraftEnvelope, NO_DRAFT_REV, parseStoredDraft, storedRev, tabIdentity,
  type DraftStorage,
} from "../lib/lesson-draft-store.ts";

function memoryStore(): DraftStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: (key) => map.get(key) ?? null,
    set: (key, value) => { map.set(key, value); },
    remove: (key) => { map.delete(key); },
  };
}

const key = "actgds-driver:draft:learner-1";
const draftA = { startTime: "10:00", comments: "first" };
const draftB = { startTime: "10:00", comments: "second" };

test("a missing value parses as empty and the first write expects revision -1", () => {
  const store = memoryStore();
  assert.deepEqual(parseStoredDraft(store.get(key)), { kind: "empty" });
  assert.equal(storedRev(store, key), NO_DRAFT_REV);
  const written = casWriteDraft(store, key, NO_DRAFT_REV, "tab-a", draftA);
  assert.equal(written.ok, true);
  assert.equal(written.rev, 0);
  assert.equal(written.raw, store.get(key));
  assert.deepEqual(parseStoredDraft(store.get(key)), { kind: "draft", rev: 0, tabId: "tab-a", draft: draftA });
});

test("a stale tab cannot overwrite a newer draft", () => {
  const store = memoryStore();
  casWriteDraft(store, key, NO_DRAFT_REV, "tab-a", draftA);
  const stale = casWriteDraft(store, key, NO_DRAFT_REV, "tab-b", draftB);
  assert.deepEqual(stale, { ok: false, rev: 0, raw: null });
  assert.deepEqual(parseStoredDraft(store.get(key)), { kind: "draft", rev: 0, tabId: "tab-a", draft: draftA });
  const current = casWriteDraft(store, key, 0, "tab-a", draftB);
  assert.equal(current.ok, true);
  assert.equal(current.rev, 1);
});

test("a tombstone stays gone: a stale autosave cannot resurrect the draft", () => {
  const store = memoryStore();
  casWriteDraft(store, key, NO_DRAFT_REV, "tab-a", draftA);
  const tombstoned = casTombstone(store, key, 0, "tab-a");
  assert.equal(tombstoned.ok, true);
  assert.equal(tombstoned.rev, 1);
  assert.equal(tombstoned.raw, store.get(key));
  assert.deepEqual(parseStoredDraft(store.get(key)), { kind: "tombstone", rev: 1, tabId: "tab-a" });
  // A stale tab that still holds revision 0 cannot write over the tombstone.
  assert.deepEqual(casWriteDraft(store, key, 0, "tab-b", draftB), { ok: false, rev: 1, raw: null });
  // A new draft starts from the tombstone's revision.
  assert.equal(casWriteDraft(store, key, 1, "tab-b", draftB).ok, true);
  assert.deepEqual(parseStoredDraft(store.get(key)), { kind: "draft", rev: 2, tabId: "tab-b", draft: draftB });
});

test("a tombstone cannot be written by a stale tab either", () => {
  const store = memoryStore();
  casWriteDraft(store, key, NO_DRAFT_REV, "tab-a", draftA);
  casWriteDraft(store, key, 0, "tab-a", draftB);
  assert.deepEqual(casTombstone(store, key, 0, "tab-b"), { ok: false, rev: 1, raw: null });
  assert.deepEqual(parseStoredDraft(store.get(key)), { kind: "draft", rev: 1, tabId: "tab-a", draft: draftB });
});

test("bare draft JSON from before the envelope counts as revision 0 with no owner", () => {
  const store = memoryStore();
  store.set(key, JSON.stringify(draftA));
  assert.deepEqual(parseStoredDraft(store.get(key)), { kind: "draft", rev: 0, tabId: "", draft: draftA });
  assert.equal(casWriteDraft(store, key, 0, "tab-a", draftB).ok, true);
});

test("a corrupt stored value counts as empty and never crashes the parse", () => {
  const store = memoryStore();
  store.set(key, "{not json");
  assert.deepEqual(parseStoredDraft(store.get(key)), { kind: "empty" });
  assert.equal(casWriteDraft(store, key, NO_DRAFT_REV, "tab-a", draftA).ok, true);
});

test("an envelope round-trips through encode and parse", () => {
  const raw = encodeDraftEnvelope(3, "tab-a", draftA);
  assert.deepEqual(parseStoredDraft(raw), { kind: "draft", rev: 3, tabId: "tab-a", draft: draftA });
  assert.deepEqual(parseStoredDraft(encodeDraftEnvelope(4, "tab-a", null, true)), { kind: "tombstone", rev: 4, tabId: "tab-a" });
});

test("tab identity is stable within a load and differs across loads", () => {
  const first = tabIdentity();
  const second = tabIdentity();
  assert.equal(first.tabId, second.tabId);
  assert.notEqual(first.instanceId, second.instanceId);
  assert.ok(first.tabId.length > 0 && first.instanceId.length > 0);
});
