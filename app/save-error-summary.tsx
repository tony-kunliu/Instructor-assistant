"use client";

import { useEffect, useRef } from "react";
import { FIELD_LABELS, type FormFieldId, type FormIssue } from "@/lib/lesson-form-errors.ts";

/** Elements the summary can jump to carry `id="<prefix>-field-<field>"` (an input, or a wrapper for the signature / competency sections). */
export function goToField(prefix: string, field: FormFieldId): void {
  const target = document.getElementById(`${prefix}-field-${field}`);
  if (!target) return;
  const details = target.closest("details");
  if (details) details.open = true;
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // Centre small targets; align tall ones (the competency section is taller than a phone screen) to the top so their start isn't cut off.
  const tall = target.getBoundingClientRect().height > window.innerHeight * 0.7;
  target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: tall ? "start" : "center" });
  // Wrappers (signatures, competencies) aren't focusable by default.
  if (!target.matches("input, select, textarea, button") && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
  target.classList.add("field-flash");
  window.setTimeout(() => target.classList.remove("field-flash"), 2200);
}

type Props = {
  issues: FormIssue[];
  prefix: string;
  /** Incremented on every failed save so the summary is scrolled into view again even if its text is unchanged. */
  attempt: number;
};

/** Sits directly above the Save button and stays until the problems are corrected — never a disappearing toast. */
export default function SaveErrorSummary({ issues, prefix, attempt }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // After a failed save, bring the summary (and the Save button under it) on screen — but never scroll its top out of view.
  useEffect(() => {
    const element = ref.current;
    if (attempt === 0 || !element) return;
    const anchor = (element.nextElementSibling as HTMLElement | null) ?? element;
    const top = element.getBoundingClientRect().top;
    const bottom = anchor.getBoundingClientRect().bottom;
    const margin = 8;
    if (top < margin) window.scrollBy({ top: top - margin });
    else if (bottom > window.innerHeight - margin) window.scrollBy({ top: Math.min(bottom - window.innerHeight + margin, top - margin) });
  }, [attempt]);
  if (!issues.length) return null;
  return (
    <div ref={ref} className="save-errors" role="alert" data-testid={`${prefix}-save-errors`}>
      <strong>{issues.length === 1 ? "Can't save yet — 1 thing to fix" : `Can't save yet — ${issues.length} things to fix`}</strong>
      <ul>
        {issues.map((issue) => (
          <li key={`${issue.field ?? "general"}:${issue.message}`}>
            <span>{issue.message}</span>
            {issue.field ? (
              <button type="button" className="save-errors-go" data-testid={`${prefix}-go-${issue.field}`} onClick={() => goToField(prefix, issue.field!)}>
                Go to {FIELD_LABELS[issue.field]}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
