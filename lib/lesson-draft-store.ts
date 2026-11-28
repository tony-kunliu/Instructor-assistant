// The lesson draft in localStorage is shared by every tab on the device. Storing bare draft JSON meant any
// tab could overwrite or delete another tab's newer draft: a discarded draft resurrected by a stale tab's
// autosave, an old tab's Discard deleting a new tab's lesson, and two tabs saving the same lesson twice
// (double-counted hours/km). v2 stores an envelope instead: a monotonic revision, the owning tab, and a
// tombstone. Every write is a compare-and-swap on the revision — a tab that has not seen the latest revision
// cannot write — and Discard/Save write a tombstone instead of deleting the key, so a stale tab can never
// resurrect the draft. Cross-tab saves are additionally serialised by a Web Lock around the save itself
// (see app/driver-app.tsx#saveLesson); the revision check is the fallback when locks are unavailable.
//
// Pure functions over a minimal storage interface, so the rules are unit-tested without a browser.

export type DraftStorage = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

export type DraftEnvelope = {
  v: 1;
  rev: number;
  tabId: string;
  updatedAt: number;
  tombstone: boolean;
  draft: unknown;
};

export type ParsedDraft =
  | { kind: "empty" }
  | { kind: "tombstone"; rev: number; tabId: string }
  | { kind: "draft"; rev: number; tabId: string; draft: unknown };

/** The revision a missing or unreadable value counts as: the first write expects -1. */
export const NO_DRAFT_REV = -1;

export function encodeDraftEnvelope(rev: number, tabId: string, draft: unknown, tombstone = false): string {
  const envelope: DraftEnvelope = { v: 1, rev, tabId, updatedAt: Date.now(), tombstone, draft: tombstone ? null : draft };
  return JSON.stringify(envelope);
}

/**
 * Parse a stored draft value. v1 envelopes carry their revision; older bare draft JSON (written before the
 * envelope, or by a tool that writes drafts directly) counts as revision 0 with no owner. A corrupt value
 * counts as empty — it must never crash the app, and the next write starts from revision -1.
 */
export function parseStoredDraft(raw: string | null): ParsedDraft {
  if (!raw) return { kind: "empty" };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      // A v1 envelope carries all of these keys; a bare lesson draft never has `v` or `tombstone`.
      if (record.v === 1 && typeof record.rev === "number" && typeof record.tombstone === "boolean" && "draft" in record) {
        const envelope = parsed as DraftEnvelope;
        if (envelope.tombstone) return { kind: "tombstone", rev: envelope.rev, tabId: envelope.tabId ?? "" };
        return { kind: "draft", rev: envelope.rev, tabId: envelope.tabId ?? "", draft: envelope.draft };
      }
    }
    return { kind: "draft", rev: 0, tabId: "", draft: parsed };
  } catch {
    return { kind: "empty" };
  }
}

/** The revision currently stored under `key`, or NO_DRAFT_REV when nothing (readable) is stored. */
export function storedRev(store: DraftStorage, key: string): number {
  const parsed = parseStoredDraft(store.get(key));
  return parsed.kind === "empty" ? NO_DRAFT_REV : parsed.rev;
}

export type CasResult = { ok: boolean; rev: number; raw: string | null };

function currentRev(store: DraftStorage, key: string): number {
  return storedRev(store, key);
}

/**
 * Write `draft` only if the stored revision still equals `expectedRev`. On success the stored revision
 * becomes expectedRev + 1 and `raw` is the exact string written (so the caller can tell a later external
 * modification apart from its own write even when the revision was not bumped). On failure nothing is
 * written and `rev` is the revision actually stored, so the caller can reload instead of overwriting
 * another tab's newer draft.
 */
export function casWriteDraft(store: DraftStorage, key: string, expectedRev: number, tabId: string, draft: unknown): CasResult {
  const current = currentRev(store, key);
  if (current !== expectedRev) return { ok: false, rev: current, raw: null };
  const next = expectedRev + 1;
  const raw = encodeDraftEnvelope(next, tabId, draft);
  store.set(key, raw);
  return { ok: true, rev: next, raw };
}

/** Like casWriteDraft, but the stored value becomes a tombstone: the draft is gone and stays gone. */
export function casTombstone(store: DraftStorage, key: string, expectedRev: number, tabId: string): CasResult {
  const current = currentRev(store, key);
  if (current !== expectedRev) return { ok: false, rev: current, raw: null };
  const next = expectedRev + 1;
  const raw = encodeDraftEnvelope(next, tabId, null, true);
  store.set(key, raw);
  return { ok: true, rev: next, raw };
}

let cachedTabId: string | null = null;

/**
 * This tab's identity. `tabId` survives a reload of the same tab (sessionStorage) so a reloaded tab can
 * re-adopt its own GPS session; `instanceId` is fresh on every page load, so two live tabs that were
 * duplicated from one another (shared sessionStorage) still differ. In environments without sessionStorage
 * (tests, private mode) both fall back to fresh random ids.
 */
export function tabIdentity(): { tabId: string; instanceId: string } {
  const random = () => (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  if (cachedTabId === null) {
    try {
      const stored = sessionStorage.getItem("actgds-driver:tab");
      cachedTabId = stored ?? random();
      sessionStorage.setItem("actgds-driver:tab", cachedTabId);
    } catch {
      cachedTabId = random();
    }
  }
  return { tabId: cachedTabId, instanceId: random() };
}
