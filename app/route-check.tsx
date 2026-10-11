"use client";

import { ALL_ITEM_IDS, ROUTE_ITEMS, routeCheckReminders, suggestTownCentres, type HomeDistrict, type RouteItemId, type RouteState } from "@/lib/route-check.ts";
import { TOWN_CENTRES, type TownCentreId } from "@/lib/town-centres.ts";
import { RulesReminders } from "./rules-reminders.tsx";

type Props = {
  /** Parsed from the draft's comments (null = no centre chosen yet). */
  state: RouteState | null;
  home: HomeDistrict;
  achieved23: boolean;
  onChange: (next: RouteState) => void;
  testId: string;
};

/**
 * R10 D6: collapsed "Competency 23 route" group under the competency picker, only while 23 Final Drive is Assessed.
 * Town-centre chips (the suggested ones first), six ticks and one "All met" button; filled AFTER the drive (CoP 5 f).
 * Display-only checks (D7); nothing here disables Save.
 */
export default function RouteCheckGroup({ state, home, achieved23, onChange, testId }: Props) {
  const suggested = new Set(suggestTownCentres(home).map((centre) => centre.id));
  const chooseCentre = (townCentreId: TownCentreId) => onChange({ townCentreId, ticked: state?.ticked ?? [] });
  const toggleItem = (id: RouteItemId) => {
    if (!state) return;
    onChange({ ...state, ticked: state.ticked.includes(id) ? state.ticked.filter((x) => x !== id) : [...state.ticked, id] });
  };
  const allMet = () => state && onChange({ ...state, ticked: [...ALL_ITEM_IDS] });
  return (
    <details className="rules-group route-group" data-testid={testId}>
      <summary>Competency 23 route</summary>
      <p className="hint-note">Fill in after the drive. Reminders only: nothing here blocks the save. Stored as the lesson location and one comment line.</p>
      <span className="comp-label">Town centre</span>
      <div className="chip-row route-centres">
        {TOWN_CENTRES.map((centre) => (
          <button
            key={centre.id}
            type="button"
            className={`chip wide${state?.townCentreId === centre.id ? " selected" : ""}${suggested.has(centre.id) ? "" : " home"}`}
            aria-pressed={state?.townCentreId === centre.id}
            title={suggested.has(centre.id) ? centre.official : `${centre.official}: the learner's home town centre`}
            data-testid="route-centre"
            data-centre={centre.id}
            onClick={() => chooseCentre(centre.id)}
          >
            {centre.name}
          </button>
        ))}
      </div>
      <span className="comp-label">Negotiated in the town centre (NI2020-703 Competency 23)</span>
      <div className="route-items">
        {ROUTE_ITEMS.map((item) => (
          <label key={item.id} className="route-item">
            <input type="checkbox" checked={Boolean(state?.ticked.includes(item.id))} disabled={!state} onChange={() => toggleItem(item.id)} data-testid="route-item" data-item={item.id} />
            <span>{item.label}</span>
          </label>
        ))}
        <button type="button" className="btn ghost small route-all" disabled={!state} onClick={allMet} data-testid="route-all-met">All met</button>
      </div>
      <RulesReminders reminders={routeCheckReminders({ state, home, achieved23 })} testId={`${testId}-reminders`} />
    </details>
  );
}
