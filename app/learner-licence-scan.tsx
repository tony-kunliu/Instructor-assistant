"use client";

import { useEffect, useRef, useState } from "react";
import { LICENCE_SCAN_FIELDS, parseLearnerLicence, type LicenceScan } from "@/lib/learner-licence-text.ts";

type Props = {
  disabled: boolean;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onScan: (scan: LicenceScan) => void;
};

export default function LearnerLicenceScan({ disabled, busy, onBusyChange, onScan }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  const [scanText, setScanText] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => () => {
    pending.current?.abort();
    onBusyChange(false);
  }, [onBusyChange]);

  const review = (text: string) => {
    const result = parseLearnerLicence(text);
    const fields = (Object.keys(result) as (keyof LicenceScan)[]).map((key) => LICENCE_SCAN_FIELDS[key]);
    if (!fields.length) {
      setStatus("No details found. Try a clearer photo, paste scanned text, or enter the details below.");
      return;
    }
    onScan(result);
    setScanText("");
    setStatus(`Found ${fields.join(", ")}. Check the fields against the card, then tap Save learner.`);
  };

  const takePhoto = async (file: File) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    onBusyChange(true);
    setStatus("Reading the licence on this device…");
    try {
      const { readLearnerLicencePhoto } = await import("@/lib/licence-photo-ocr.ts");
      const text = await readLearnerLicencePhoto(file, controller.signal);
      if (!controller.signal.aborted) review(text);
    } catch {
      if (!controller.signal.aborted) setStatus("Couldn’t read that photo. Try again, paste scanned text, or enter the details below.");
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        onBusyChange(false);
      }
    }
  };

  return (
    <section className="lblock learner-licence-scan" aria-label="Scan learner licence">
      <input ref={input} type="file" accept="image/*" capture="environment" hidden data-testid="licence-photo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void takePhoto(file);
        }} />
      <button className="btn primary block" type="button" disabled={disabled || busy} onClick={() => input.current?.click()}>
        {busy ? "Reading licence…" : "Scan learner licence"}
      </button>
      {busy ? <button className="btn ghost small" type="button" onClick={() => {
        const controller = pending.current;
        pending.current = null;
        controller?.abort();
        onBusyChange(false);
        setStatus("Scan cancelled. Enter the details below or try again.");
      }}>Cancel scan</button> : null}
      {status ? <p className="form-sub" role="status" data-testid="licence-scan-status">{status}</p> : null}
      <details>
        <summary>Use iPhone Scan Text or paste text</summary>
        <label className="field"><span>Licence text</span>
          <textarea rows={3} value={scanText} onChange={(event) => setScanText(event.target.value)} maxLength={6000}
            autoComplete="off" autoCorrect="off" spellCheck={false} />
        </label>
        <button className="btn ghost small" type="button" disabled={disabled || busy || !scanText.trim()}
          onClick={() => review(scanText)}>Fill from text</button>
      </details>
    </section>
  );
}
