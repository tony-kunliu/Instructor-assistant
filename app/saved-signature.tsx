"use client";

// "Use my saved signature" (Tony 2026-10-22, option A): the signed-in instructor draws their ADI signature once and later
// taps this instead of drawing it again. The tap is always the instructor's own: nothing fills it in by itself, and only
// the signed-in instructor's own signature is ever fetched (GET/PUT /api/me/signature). The learner's is never stored.
import { useEffect, useState } from "react";

type Props = {
  /** The ADI pad's current value (a PNG data URL, or ""). */
  value: string;
  onUse: (signature: string) => void;
};

async function call(method: "GET" | "PUT", signature?: string): Promise<string | null> {
  const response = await fetch("/api/me/signature", method === "PUT" ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify({ signature }) } : undefined);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return (data.signature as string | null) ?? null;
}

export default function SavedSignature({ value, onUse }: Props) {
  // undefined = still loading, or not available (no signed-in instructor): show nothing.
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    call("GET").then((s) => { if (live) setSaved(s); }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  if (saved === undefined) return null;
  const run = async (action: () => Promise<void>) => {
    setNote(null);
    try { await action(); } catch (e) { setNote((e as Error).message); }
  };
  return (
    <div className="saved-sig" data-testid="saved-signature">
      {saved ? (
        <>
          <button type="button" className="link" data-testid="saved-signature-use" onClick={() => onUse(saved)}>Use my saved signature</button>
          <button type="button" className="link" onClick={() => void run(async () => { await call("PUT", ""); setSaved(null); setNote("Saved signature removed."); })}>Remove it</button>
        </>
      ) : null}
      {value && value !== saved ? (
        <button type="button" className="link" data-testid="saved-signature-save" onClick={() => void run(async () => { setSaved(await call("PUT", value)); setNote("Saved as your signature."); })}>
          {saved ? "Replace my saved signature with this" : "Save this as my signature"}
        </button>
      ) : null}
      {note ? <small className="hint" role="status">{note}</small> : null}
    </div>
  );
}
