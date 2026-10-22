"use client";

import { useRef, useState } from "react";
import { formatMinutes } from "@/lib/calc.ts";
import type { PaperImportPreview } from "@/lib/paper-import.ts";
import { priorPreviewNote, priorSummaryLine } from "@/lib/prior-record.ts";

type RowError = { row: number; message: string };
type ImportResponse = { mode: "preview" | "commit"; preview: PaperImportPreview; lessonCount?: number };

async function post(learnerId: string, csv: string, mode: "preview" | "commit"): Promise<{ ok: true; data: ImportResponse } | { ok: false; error: string; rows: RowError[] }> {
  try {
    const response = await fetch(`/api/learners/${encodeURIComponent(learnerId)}/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ csv, mode }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error || "Import failed.", rows: Array.isArray(data.rows) ? data.rows : [] };
    return { ok: true, data: data as ImportResponse };
  } catch {
    return { ok: false, error: "Could not reach the server. Please try again.", rows: [] };
  }
}

const list = (nos: number[]) => nos.map((n) => `#${n}`).join(", ");

const draftUrl = (learnerId: string) => `/api/learners/${encodeURIComponent(learnerId)}/import-draft`;

async function draftCall<T>(learnerId: string, init?: RequestInit): Promise<T> {
  const response = await fetch(draftUrl(learnerId), init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data as T;
}

/**
 * Upload or paste → check → confirm for importing a learner's historical paper logbook (CSV). Owns its own state;
 * the caller only supplies the learner and reloads itself via `onImported`. Nothing is written until "Confirm import".
 * A CSV with problems can be kept on the site as a DRAFT (one per learner), edited here in the text box, checked again
 * and imported once it is clean; the import itself is unchanged (all-or-nothing, only into a learner with no lessons).
 * `canImport` is false for a draft learner: the CSV can be prepared and saved, not imported.
 */
export default function PaperImportPanel({ learnerId, onImported, canImport = true }: { learnerId: string; onImported: () => void | Promise<void>; canImport?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<PaperImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowError[]>([]);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Opening the panel brings back the CSV saved for this learner, if any.
  const openPanel = () => {
    setOpen(true);
    void draftCall<{ draft: { csv: string; savedAt: string } | null }>(learnerId)
      .then(({ draft }) => { if (draft) { setText(draft.csv); setSavedAt(draft.savedAt); setNote("Your saved CSV draft is loaded."); } })
      .catch(() => undefined);
  };

  const clearResult = () => {
    setPreview(null);
    setError(null);
    setRows([]);
  };

  const reset = () => {
    clearResult();
    setText("");
    setFileName("");
    setNote(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const check = async (csv: string) => {
    clearResult();
    if (!csv.trim()) return setError("Choose a CSV file or paste the CSV text first.");
    setBusy(true);
    const result = await post(learnerId, csv, "preview");
    setBusy(false);
    if (result.ok) setPreview(result.data.preview);
    else {
      setError(result.error);
      setRows(result.rows);
    }
  };

  const choose = async (file: File | undefined) => {
    clearResult();
    setNote(null);
    if (!file) return;
    setFileName(file.name);
    let content: string;
    try {
      content = await file.text();
    } catch {
      setError("Could not read that file. Please choose it again.");
      return;
    }
    setText(content);
    await check(content);
  };

  const saveDraft = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const { draft } = await draftCall<{ draft: { csv: string; savedAt: string } }>(learnerId, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv: text }) });
      setSavedAt(draft.savedAt);
      setNote("Saved as a draft. You can come back to it later.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const discardDraft = async () => {
    setBusy(true);
    try {
      await draftCall(learnerId, { method: "DELETE" });
      setSavedAt(null);
      reset();
      setNote("Draft removed.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setError(null);
    const result = await post(learnerId, text, "commit");
    if (result.ok) {
      void draftCall(learnerId, { method: "DELETE" }).catch(() => undefined); // the saved draft has done its job
      try {
        await onImported();
      } catch {
        setError("Imported, but the learner could not be reloaded. Please refresh.");
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(false);
    setError(result.error);
    if (result.rows.length) {
      setRows(result.rows);
      setPreview(null);
    }
  };

  if (!open) {
    return <button type="button" className="btn ghost block" data-testid="paper-import-open" onClick={openPanel}>Import paper records</button>;
  }

  const lines = text.split(/\r?\n/);

  return (
    <section className="card paper-import" data-testid="paper-import-panel">
      <h2>Import paper records</h2>
      <p className="meta">Choose a CSV of this learner's paper logbook lessons (and any prior-instructor records), or paste its text. Nothing is saved as a record until you confirm; a CSV with problems can be kept here as a draft.</p>
      <input ref={inputRef} type="file" accept=".csv,text/csv" aria-label="Paper records CSV file" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} />
      {fileName ? <p className="meta paper-import-file">{fileName}</p> : null}
      <label className="field full"><span>CSV text</span>
        <textarea className="paper-import-text" rows={8} spellCheck={false} value={text} onChange={(e) => { setText(e.target.value); clearResult(); setNote(null); }} data-testid="paper-import-text" placeholder="date,start_time,finish_time,…" />
      </label>
      <div className="paper-import-actions">
        {canImport ? <button type="button" className="btn primary" disabled={busy || !text.trim()} onClick={() => void check(text)} data-testid="paper-import-check">Check</button> : null}
        <button type="button" className="btn ghost" disabled={busy || !text.trim()} onClick={() => void saveDraft()} data-testid="paper-import-save-draft">Save as draft</button>
        {savedAt ? <button type="button" className="link danger" disabled={busy} onClick={() => void discardDraft()} data-testid="paper-import-discard-draft">Discard draft</button> : null}
      </div>
      {note ? <p className="meta" role="status" data-testid="paper-import-note">{note}</p> : null}
      {!canImport ? <p className="status info" data-testid="paper-import-draft-learner-note">This learner is still a draft. Save the CSV as a draft now; confirm the learner to check and import it.</p> : null}

      {error && !rows.length ? <p className="status error" data-testid="paper-import-error">{error}</p> : null}
      {rows.length ? (
        <div className="status error" data-testid="paper-import-errors">
          <p>{error || "Import has errors."} Fix the lines in the text box and check again, or save it as a draft to finish later.</p>
          <ul className="paper-import-rows">
            {rows.map((r, i) => <li key={i}>Row {r.row}: {r.message}{lines[r.row - 1] ? <code className="paper-import-line">{lines[r.row - 1].slice(0, 120)}</code> : null}</li>)}
          </ul>
        </div>
      ) : null}

      {preview ? (
        <div className="paper-import-preview" data-testid="paper-import-preview">
          <dl className="totals">
            <div><dt>Lessons</dt><dd data-testid="paper-import-lessons">{preview.lessonCount}</dd></div>
            <div><dt>Hours</dt><dd data-testid="paper-import-hours">{formatMinutes(preview.totalMinutes)}</dd></div>
            <div><dt>Km</dt><dd data-testid="paper-import-km">{preview.totalKm} km</dd></div>
            <div><dt>Achieved</dt><dd data-testid="paper-import-achieved">{preview.progress.achievedCount}</dd></div>
          </dl>
          {priorPreviewNote(preview.priorRecords) ? <p className="meta" data-testid="paper-import-prior-note">Hours / Km {priorPreviewNote(preview.priorRecords)}</p> : null}
          {preview.priorRecords.length ? (
            <ul className="paper-import-prior" data-testid="paper-import-prior">
              {preview.priorRecords.map((record, i) => <li key={i}>{priorSummaryLine(record)}</li>)}
            </ul>
          ) : null}
          {preview.missingDataLessonNos.length ? <p className="meta">Missing data: {list(preview.missingDataLessonNos)}</p> : null}
          {preview.unsignedLessonNos.length ? <p className="meta">Unsigned: {list(preview.unsignedLessonNos)}</p> : null}
          {preview.priorRecords.length ? <p className="status info" data-testid="paper-import-once-warning">Paper import can only be done once per learner; check everything before importing.</p> : null}
          {canImport ? (
            <button type="button" className="btn primary block" data-testid="paper-import-confirm" disabled={busy} onClick={() => void confirm()}>
              {busy ? "Importing…" : "Confirm import"}
            </button>
          ) : null}
        </div>
      ) : null}
      <button type="button" className="link" onClick={() => { reset(); setOpen(false); }}>Close</button>
    </section>
  );
}
