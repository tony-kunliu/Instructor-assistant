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

/**
 * Upload → preview → confirm for importing a learner's historical paper
 * logbook (CSV). Owns its own state; the caller only supplies the learner and
 * reloads itself via `onImported`. Nothing is written until "Confirm import".
 */
export default function PaperImportPanel({ learnerId, onImported }: { learnerId: string; onImported: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<PaperImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<RowError[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setCsv(null);
    setFileName("");
    setPreview(null);
    setError(null);
    setRows([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const choose = async (file: File | undefined) => {
    reset();
    if (!file) return;
    setBusy(true);
    setFileName(file.name);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setBusy(false);
      setError("Could not read that file. Please choose it again.");
      return;
    }
    const result = await post(learnerId, text, "preview");
    setBusy(false);
    if (result.ok) {
      setCsv(text);
      setPreview(result.data.preview);
    } else {
      setError(result.error);
      setRows(result.rows);
    }
  };

  const confirm = async () => {
    if (!csv || busy) return;
    setBusy(true);
    setError(null);
    const result = await post(learnerId, csv, "commit");
    if (result.ok) {
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
    return <button type="button" className="btn ghost block" data-testid="paper-import-open" onClick={() => setOpen(true)}>Import paper records</button>;
  }

  return (
    <section className="card paper-import" data-testid="paper-import-panel">
      <h2>Import paper records</h2>
      <p className="meta">Choose a CSV of this learner's paper logbook lessons (and any prior-instructor records). Nothing is saved until you confirm.</p>
      <input ref={inputRef} type="file" accept=".csv,text/csv" aria-label="Paper records CSV file" disabled={busy} onChange={(e) => void choose(e.target.files?.[0])} />
      {fileName ? <p className="meta paper-import-file">{fileName}</p> : null}

      {error && !rows.length ? <p className="status error" data-testid="paper-import-error">{error}</p> : null}
      {rows.length ? (
        <div className="status error" data-testid="paper-import-errors">
          <p>{error || "Import has errors."} Fix the file and choose it again.</p>
          <ul className="paper-import-rows">
            {rows.map((r, i) => <li key={i}>Row {r.row}: {r.message}</li>)}
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
          <button type="button" className="btn primary block" data-testid="paper-import-confirm" disabled={busy} onClick={() => void confirm()}>
            {busy ? "Importing…" : "Confirm import"}
          </button>
        </div>
      ) : null}
      <button type="button" className="link" onClick={() => { reset(); setOpen(false); }}>Cancel</button>
    </section>
  );
}
