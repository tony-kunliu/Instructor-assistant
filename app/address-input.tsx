"use client";

// Address field with street suggestions (learner intake design 2026-10-11, Feature 1, D3/D4/D6/D7).
// A plain text input (never readonly, never a <datalist>: iOS Scan Text must keep working, and the number-first
// ranking needs our own list) with a custom listbox underneath: role=listbox / role=option rows of at least 44px,
// at most 5, keyboard (arrows, Enter, Escape) and touch (pointerdown is prevented so the input keeps focus and the
// keyboard stays open). The bundled G-NAF index is fetched once, on the first focus or keystroke, and then held in
// memory (module level) so the field keeps working offline afterwards; if the fetch fails the field is a plain input.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { MAX_QUERY_LENGTH, MAX_SUGGESTIONS, STREET_INDEX_URL, suggestAddresses, type AddressSuggestion, type StreetIndex } from "@/lib/address-suggest.ts";

let indexCache: StreetIndex | null = null;
let indexPromise: Promise<StreetIndex | null> | null = null;

/** Loads the index once per page; a failure resolves to null (plain input) and may be retried on a later focus. */
function loadStreetIndex(): Promise<StreetIndex | null> {
  if (indexCache) return Promise.resolve(indexCache);
  if (!indexPromise) {
    indexPromise = fetch(STREET_INDEX_URL, { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as StreetIndex;
        if (!Array.isArray(data.streets) || !Array.isArray(data.localities)) throw new Error("bad index");
        indexCache = data;
        return data;
      })
      .catch(() => { indexPromise = null; return null; });
  }
  return indexPromise;
}

type Props = {
  value: string;
  onChange: (text: string) => void;
  onPick: (suggestion: AddressSuggestion) => void;
  label?: string;
};

export default function AddressInput({ value, onChange, onPick, label = "Address" }: Props) {
  const inputId = useId();
  const listId = useId();
  const [index, setIndex] = useState<StreetIndex | null>(indexCache);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = useMemo(() => (index && open ? suggestAddresses(index, value) : []), [index, value, open]);
  const expanded = suggestions.length > 0;
  const activeIndex = active < suggestions.length ? active : -1;

  const ensureIndex = useCallback(() => {
    if (index) return;
    void loadStreetIndex().then((loaded) => { if (loaded) setIndex(loaded); });
  }, [index]);

  // Reset the highlighted row whenever the list contents change.
  const listKey = suggestions.map((s) => s.label).join("|");
  useEffect(() => { setActive(-1); }, [listKey]);

  const pick = (suggestion: AddressSuggestion) => {
    onPick(suggestion);
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") { if (open) { event.preventDefault(); setOpen(false); } return; }
    if (!expanded) { if (event.key === "ArrowDown") setOpen(true); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((activeIndex + 1) % suggestions.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((activeIndex - 1 + suggestions.length) % suggestions.length); }
    else if (event.key === "Enter" && activeIndex >= 0) { event.preventDefault(); pick(suggestions[activeIndex]); }
  };

  return (
    <div className="full address-field">
      <label className="field" htmlFor={inputId}>
        <span>{label}</span>
        <input
        id={inputId}
        ref={inputRef}
        type="text"
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true); ensureIndex(); }}
        onFocus={() => { ensureIndex(); setOpen(true); }}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        maxLength={MAX_QUERY_LENGTH}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        data-testid="learner-address"
        />
      </label>
      {expanded ? (
        <div className="address-list">
          <div role="listbox" id={listId} aria-label="Street suggestions" data-testid="address-suggestions">
          {suggestions.slice(0, MAX_SUGGESTIONS).map((suggestion, i) => (
            <div
              key={`${i}-${suggestion.label}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`address-option${i === activeIndex ? " active" : ""}`}
              // pointerdown is prevented so the input never loses focus (the keyboard stays open on a tap); click/pointerup picks.
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(suggestion)}
              data-testid="address-option"
            >
              <span className="address-main">{suggestion.number ? `${suggestion.number} ` : ""}{suggestion.street}{suggestion.streetType ? ` ${suggestion.streetType}` : ""}</span>
              <small>{suggestion.suburb} {suggestion.state} {suggestion.postcode}</small>
            </div>
          ))}
          </div>
          {/* Outside the listbox (m4): a listbox may only contain options. */}
          <button type="button" className="address-close" aria-label="Close suggestions" onPointerDown={(event) => event.preventDefault()} onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen(false)}>×</button>
        </div>
      ) : null}
      <small className="address-hint">Type the house number and 3 letters of the street; pick a row to fill it in. House numbers are not checked; any text saves.</small>
    </div>
  );
}
