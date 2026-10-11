"use client";

import { useId } from "react";
import { ALL_ITEM_IDS, defaultRouteState, ROUTE_GROUP_HEADINGS, ROUTE_ITEMS, ROUTE_SIGNATURE_HINT, routeCheckReminders, suggestTownCentres, type HomeDistrict, type RouteItemGroup, type RouteItemId, type RouteState } from "@/lib/route-check.ts";
import { TOWN_CENTRES, type TownCentreId } from "@/lib/town-centres.ts";
import { RulesReminders } from "./rules-reminders.tsx";

type Props = {
  /** Parsed from the draft's comments; null = nothing recorded yet (the first suggested centre is then only highlighted). */
  state: RouteState | null;
  home: HomeDistrict;
  achieved23: boolean;
  /** false = the generated line would not fit the field limits, so taps are refused (grey line). */
  fits: boolean;
  /** History Edit: location and comments are signed content, so a change clears both signatures. */
  inHistoryEdit: boolean;
  onChange: (next: RouteState) => void;
  testId: string;
};

/**
 * R10 D6: collapsed "Competency 23 route" group under the competency picker, only while 23 Final Drive is Assessed.
 * Town-centre chips (the first suggested one highlighted until a tap), six ticks in the instrument's two groups and one
 * "All met" button; filled AFTER the drive (CoP 5 f). Nothing is written until the instructor taps something here;
 * display-only checks (D7); nothing disables Save.
 */
export default function RouteCheckGroup({ state, home, achieved23, fits, inHistoryEdit, onChange, testId }: Props) {
  const homeNoteId = useId();
  const suggested = new Set(suggestTownCentres(home).map((centre) => centre.id));
  const shown: RouteState = state ?? defaultRouteState(home);
  const chooseCentre = (townCentreId: TownCentreId) => onChange({ townCentreId, ticked: shown.ticked });
  const toggleItem = (id: RouteItemId) => onChange({ ...shown, ticked: shown.ticked.includes(id) ? shown.ticked.filter((x) => x !== id) : [...shown.ticked, id] });
  const allMet = () => onChange({ ...shown, ticked: [...ALL_ITEM_IDS] });
  const itemsOf = (group: RouteItemGroup) => ROUTE_ITEMS.filter((item) => item.group === group);
  return (
    <details className="rules-group route-group" data-testid={testId}>
      <summary>Competency 23 route</summary>
      <p className="hint-note">Fill in after the drive. Reminders only: nothing here blocks the save. Written into the lesson location and one comment line only when you tap here.</p>
      {inHistoryEdit ? <p className="hint-note signed" data-testid="route-signature-hint">{ROUTE_SIGNATURE_HINT}</p> : null}
      <span className="comp-label">Town centre</span>
      <div className="chip-row route-centres">
        {TOWN_CENTRES.map((centre) => {
          const isHome = !suggested.has(centre.id);
          const selected = shown.townCentreId === centre.id;
          return (
            <button
              key={centre.id}
              type="button"
              className={`chip wide${selected ? " selected" : ""}${isHome ? " home" : ""}`}
              aria-pressed={selected}
              aria-describedby={isHome ? homeNoteId : undefined}
              title={centre.official}
              data-testid="route-centre"
              data-centre={centre.id}
              data-preselected={selected && !state ? "true" : undefined}
              onClick={() => chooseCentre(centre.id)}
            >
              {centre.name}
              {isHome ? <span className="sr-only"> (home district)</span> : null}
            </button>
          );
        })}
      </div>
      <p id={homeNoteId} className="hint-note">{home.kind === "district" && home.townCentreId ? "The dashed chip is the learner's home district centre (familiar); the others are unfamiliar by the home-district rule." : "No home centre for this learner: all 7 are unfamiliar by the home-district rule."}</p>
      {(["assessment", "centre"] as const).map((group) => (
        <div key={group}>
          <span className="comp-label">{ROUTE_GROUP_HEADINGS[group]}</span>
          <div className="route-items">
            {itemsOf(group).map((item) => (
              <label key={item.id} className="route-item">
                <input type="checkbox" checked={shown.ticked.includes(item.id)} disabled={!fits} onChange={() => toggleItem(item.id)} data-testid="route-item" data-item={item.id} />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="btn ghost small route-all" disabled={!fits} onClick={allMet} data-testid="route-all-met">All met</button>
      <RulesReminders reminders={routeCheckReminders({ state, home, achieved23, fits })} testId={`${testId}-reminders`} />
    </details>
  );
}
