"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Errors = { fullName?: string; adiNumber?: string; accept?: string; form?: string };

/** A server validation message ("Full name is required.", "ADI number must be …") shown under its own field. */
function errorsFromServer(message: string): Errors {
  if (/^Full name/i.test(message)) return { fullName: message };
  if (/^ADI number/i.test(message)) return { adiNumber: message };
  return { form: message };
}

/**
 * The /welcome form: full name, ADI number (self-declared; shown on screen and on the PDF only) and the terms /
 * privacy acceptance. Sends `POST /api/welcome` once — a double tap is ignored while a request is in flight — and on
 * 200/201 goes to the main screen. Someone who already has an account is sent straight to the main screen.
 */
export default function WelcomeForm() {
  const [fullName, setFullName] = useState("");
  const [adiNumber, setAdiNumber] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [sending, setSending] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  // Set synchronously on the first tap, so a second tap before React re-renders cannot send again.
  const inFlight = useRef(false);

  useEffect(() => {
    void fetch("/api/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { instructor?: { id: string } | null } | null) => {
        if (data?.instructor) window.location.replace("/");
      })
      .catch(() => undefined);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (inFlight.current) return;
    const local: Errors = {};
    if (!fullName.trim()) local.fullName = "Full name is required.";
    if (!adiNumber.trim()) local.adiNumber = "ADI number is required.";
    if (!accepted) local.accept = "Please confirm you have read the Terms and the Privacy Policy.";
    setErrors(local);
    if (Object.keys(local).length) return;
    inFlight.current = true;
    setSending(true);
    try {
      const response = await fetch("/api/welcome", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, adiNumber }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 200 || response.status === 201) {
        window.location.assign("/");
        return;
      }
      setErrors(errorsFromServer(typeof data.error === "string" && data.error ? data.error : "Could not save your details. Please try again."));
    } catch {
      setErrors({ form: "Could not reach the server. Check your connection and try again." });
    }
    inFlight.current = false;
    setSending(false);
  };

  return (
    <form className="card saas-form" onSubmit={(e) => void submit(e)} noValidate data-testid="welcome-form">
      <p className="meta">Set up your instructor profile. Your name and ADI number appear on your lesson records and PDFs.</p>
      <label className={`field${errors.fullName ? " invalid" : ""}`}>
        <span>Full name</span>
        <input
          name="fullName" value={fullName} maxLength={80} required autoComplete="name" autoCapitalize="words" enterKeyHint="next"
          onChange={(e) => { setFullName(e.target.value); setErrors((c) => ({ ...c, fullName: undefined, form: undefined })); }}
          aria-invalid={errors.fullName ? true : undefined} aria-describedby={errors.fullName ? "welcome-name-error" : undefined} data-testid="welcome-name"
        />
        {errors.fullName ? <span className="field-error" id="welcome-name-error" role="alert">{errors.fullName}</span> : null}
      </label>
      <label className={`field${errors.adiNumber ? " invalid" : ""}`}>
        <span>ADI number</span>
        <input
          name="adiNumber" value={adiNumber} maxLength={20} required autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} inputMode="text" enterKeyHint="done"
          onChange={(e) => { setAdiNumber(e.target.value); setErrors((c) => ({ ...c, adiNumber: undefined, form: undefined })); }}
          aria-invalid={errors.adiNumber ? true : undefined} aria-describedby={errors.adiNumber ? "welcome-adi-error" : undefined} data-testid="welcome-adi"
        />
        {errors.adiNumber ? <span className="field-error" id="welcome-adi-error" role="alert">{errors.adiNumber}</span> : null}
      </label>
      <div className={`field${errors.accept ? " invalid" : ""}`}>
        <label className="check-row">
          <input type="checkbox" checked={accepted} required onChange={(e) => { setAccepted(e.target.checked); setErrors((c) => ({ ...c, accept: undefined })); }} aria-invalid={errors.accept ? true : undefined} data-testid="welcome-accept" />
          <span>I have read the <a href="/terms" target="_blank" rel="noopener">Terms</a> and the <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a></span>
        </label>
        {errors.accept ? <span className="field-error" role="alert">{errors.accept}</span> : null}
      </div>
      {errors.form ? <p className="status error" role="alert" data-testid="welcome-error">{errors.form}</p> : null}
      <button type="submit" className="btn primary block" disabled={sending} data-testid="welcome-submit">
        {sending ? "Saving…" : "Continue"}
      </button>
    </form>
  );
}
