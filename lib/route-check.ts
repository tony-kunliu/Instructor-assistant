// Competency 23 route REMINDERS and route check (R10 design, docs/superpowers/specs/2026-10-11-competency-23-route-design.md).
//
// Display only (D1): nothing here blocks a save, an assessment, Achieved or History Edit.
// Pure functions (D11): no clock, no database, no network, run in the browser on the learner's
// address already loaded for the panel. The address is never copied or sent anywhere.
// Storage (D9): the chosen centre goes into the lesson's existing `location`, and ONE generated
// line into `comments`; both already print on the PDF and are never sent to ACTGDS (D10).
// Tones as in lib/rules.ts: amber = not met / looks familiar, grey = cannot check, plain = per the entered data.

import { matchSuburb, type District } from "./act-suburbs.ts";
import type { Reminder } from "./rules.ts";
import { TOWN_CENTRES, townCentre, townCentreByName, type TownCentre, type TownCentreId } from "./town-centres.ts";

// ───────────────────────── Home district (D3, D4) ─────────────────────────

export type HomeDistrict =
  | { kind: "district"; district: District; townCentreId: TownCentreId | null; matched: string }
  | { kind: "unmapped"; matched: string }
  | { kind: "outside-act"; matched: string }
  | { kind: "unknown" };

/** The learner's home district from the free-text address (lib/act-suburbs.ts). `unknown` = empty or no suburb matched. */
export function homeDistrict(address: string | null | undefined): HomeDistrict {
  const match = matchSuburb(address);
  if (match.kind === "district") return { kind: "district", district: match.district, townCentreId: match.district.townCentreId, matched: match.matched };
  if (match.kind === "unmapped") return { kind: "unmapped", matched: match.matched };
  if (match.kind === "outside-act") return { kind: "outside-act", matched: match.matched };
  return { kind: "unknown" };
}

/** The home town centre id, or null when the rule gives none (no accepted centre in the district, outside the ACT, unknown). */
export const homeCentreId = (home: HomeDistrict): TownCentreId | null => (home.kind === "district" ? home.townCentreId : null);

/** D5: the accepted centres in table order, with the home centre (if any) excluded. Never empty. */
export function suggestTownCentres(home: HomeDistrict): TownCentre[] {
  const exclude = homeCentreId(home);
  return TOWN_CENTRES.filter((centre) => centre.id !== exclude);
}

const names = (centres: readonly TownCentre[]) => centres.map((centre) => centre.name).join(", ");
const evidence = (home: { matched: string }) => `from '${home.matched}' in the address`;

/** D5: the Start Lesson panel's 4th line while 23 Final Drive is ready. */
export function routeSuggestionReminder(address: string | null | undefined): Reminder {
  const id = "r10";
  const home = homeDistrict(address);
  if (home.kind === "unknown") return { id, tone: "grey", text: "Cannot check the home town centre: add the learner's suburb to the address." };
  if (home.kind === "unmapped") {
    return { id, tone: "grey", text: `Cannot check the home town centre: '${home.matched}' is not in the app's district table. Choose an unfamiliar town centre yourself.` };
  }
  if (home.kind === "outside-act") return { id, tone: "plain", text: `Address outside the ACT (${home.matched}): all 7 town centres are unfamiliar by the home-district rule.` };
  if (home.townCentreId === null) {
    return { id, tone: "plain", text: `Home district ${home.district.name} (${evidence(home)}) has no accepted town centre: all 7 are unfamiliar by this rule.` };
  }
  return { id, tone: "plain", text: `Unfamiliar town centres (home: ${townCentre(home.townCentreId).name}, ${evidence(home)}): ${names(suggestTownCentres(home))}.` };
}

// ───────────────────────── Route check items (D6; NI2020-703 p 36-37) ─────────────────────────

export type RouteItemId = "zones" | "stop" | "giveWay" | "lights" | "crossings" | "turns";

/** `label` = the tick's wording; `short` = the token in the generated comment line (unique, no commas). */
export const ROUTE_ITEMS: readonly { id: RouteItemId; label: string; short: string }[] = [
  { id: "zones", label: "2 designated zones", short: "2 zones" },
  { id: "stop", label: "1+ stop sign", short: "stop" },
  { id: "giveWay", label: "1+ give way sign", short: "give way" },
  { id: "lights", label: "2+ traffic lights", short: "2 lights" },
  { id: "crossings", label: "2+ pedestrian crossings", short: "2 crossings" },
  { id: "turns", label: "5+ right and 5+ left turns", short: "5R/5L" },
];

export type RouteState = { townCentreId: TownCentreId; ticked: readonly RouteItemId[] };

export const ALL_ITEM_IDS: readonly RouteItemId[] = ROUTE_ITEMS.map((item) => item.id);
export const allTicked = (state: RouteState) => ALL_ITEM_IDS.every((id) => state.ticked.includes(id));
export const missingItems = (state: RouteState) => ROUTE_ITEMS.filter((item) => !state.ticked.includes(item.id));

// ───────────────────────── Generated comment line (D9) ─────────────────────────

const LINE_PREFIX = "Comp 23 route (";
const shortOf = (id: RouteItemId) => ROUTE_ITEMS.find((item) => item.id === id)!.short;
const inOrder = (ids: readonly RouteItemId[]) => ALL_ITEM_IDS.filter((id) => ids.includes(id));

/** "Comp 23 route (Woden): 2 zones, stop, give way, 2 lights, 2 crossings, 5R/5L all ticked." / "…: none ticked." / "…: ticked: stop, 2 lights; not ticked: …". */
export function routeLine(state: RouteState): string {
  const name = townCentre(state.townCentreId).name;
  const ticked = inOrder(state.ticked);
  if (ticked.length === ALL_ITEM_IDS.length) return `${LINE_PREFIX}${name}): ${ALL_ITEM_IDS.map(shortOf).join(", ")} all ticked.`;
  if (ticked.length === 0) return `${LINE_PREFIX}${name}): none ticked.`;
  const notTicked = ALL_ITEM_IDS.filter((id) => !ticked.includes(id));
  return `${LINE_PREFIX}${name}): ticked: ${ticked.map(shortOf).join(", ")}; not ticked: ${notTicked.map(shortOf).join(", ")}.`;
}

const LINE_RE = /^Comp 23 route \(([^()]+)\): (.+)$/;

function parseItems(text: string): RouteItemId[] | null {
  const byShort = new Map(ROUTE_ITEMS.map((item) => [item.short, item.id]));
  const list = (part: string) => part.split(", ").map((short) => byShort.get(short));
  if (text === "none ticked.") return [];
  const all = /^(.+) all ticked\.$/.exec(text);
  if (all) {
    const ids = list(all[1]);
    return ids.every(Boolean) && ids.length === ALL_ITEM_IDS.length ? (ids as RouteItemId[]) : null;
  }
  const some = /^ticked: (.+); not ticked: (.+)\.$/.exec(text);
  if (!some) return null;
  const ticked = list(some[1]);
  const notTicked = list(some[2]);
  if (!ticked.every(Boolean) || !notTicked.every(Boolean)) return null;
  if (new Set([...ticked, ...notTicked]).size !== ALL_ITEM_IDS.length) return null;
  return ticked as RouteItemId[];
}

/** Parses one EXACT generated line; anything altered by hand is plain comment text (null). */
export function parseRouteLine(line: string): RouteState | null {
  const match = LINE_RE.exec(line.trim());
  if (!match) return null;
  const centre = townCentreByName(match[1]);
  const ticked = parseItems(match[2]);
  return centre && ticked ? { townCentreId: centre.id, ticked } : null;
}

export type ParsedComments = { state: RouteState | null; /** The comments with the generated line removed (the instructor's own text, untouched). */ own: string };

/** Finds the app's line anywhere in the comments (any line); the rest is the instructor's own text. */
export function parseRouteComments(comments: string): ParsedComments {
  const lines = comments.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const state = parseRouteLine(lines[i]);
    if (!state) continue;
    return { state, own: [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n") };
  }
  return { state: null, own: comments };
}

export const MAX_LOCATION_LENGTH = 200;
export const MAX_COMMENTS_LENGTH = 3000;

/**
 * D9: the route line appended after the instructor's own text (idempotent: an earlier generated line is replaced,
 * own text is never changed). When the result would not fit in 3000 characters the comments are returned unchanged.
 */
export function commentsWithRoute(comments: string, state: RouteState | null): string {
  const { own } = parseRouteComments(comments);
  if (!state) return own;
  const line = routeLine(state);
  const next = own.trim() === "" ? line : `${own.replace(/\s+$/, "")}\n${line}`;
  return next.length <= MAX_COMMENTS_LENGTH ? next : comments;
}

/** The centre name as `location` when empty, otherwise the prefix "Woden: …". A previous centre's prefix is replaced; anything else is kept. */
export function locationWithCentre(location: string, next: TownCentreId | null, previous: TownCentreId | null): string {
  let rest = location;
  if (previous !== null) {
    const name = townCentre(previous).name;
    if (rest.trim() === name) rest = "";
    else if (rest.startsWith(`${name}: `)) rest = rest.slice(name.length + 2);
  }
  if (next === null) return rest;
  const name = townCentre(next).name;
  if (rest.trim() === "") return name;
  if (rest === name || rest.startsWith(`${name}: `)) return rest;
  const prefixed = `${name}: ${rest}`;
  return prefixed.length <= MAX_LOCATION_LENGTH ? prefixed : location;
}

export type RouteFields = { location: string; comments: string };

/** Writes `state` (or removes the route, null) into location + comments, both idempotent. */
export function applyRoute(fields: RouteFields, state: RouteState | null): RouteFields {
  const previous = parseRouteComments(fields.comments).state;
  return {
    location: locationWithCentre(fields.location, state?.townCentreId ?? null, previous?.townCentreId ?? null),
    comments: commentsWithRoute(fields.comments, state),
  };
}

/** D6: the first suggested centre, preselected with nothing ticked (the ticks are filled after the drive, D8). */
export function defaultRouteState(home: HomeDistrict): RouteState {
  return { townCentreId: suggestTownCentres(home)[0].id, ticked: [] };
}

/**
 * The form's state machine, run when the Assessed set changes: 23 ticked and no route yet → the default
 * route is written (D6 preselection); 23 unticked → the app's line and prefix are removed. Otherwise unchanged.
 * A lesson opened in History Edit with 23 assessed and no line stays without one until the instructor taps a chip.
 */
export function syncRouteWithAssessed(fields: RouteFields, assessed23: boolean, home: HomeDistrict): RouteFields {
  const current = parseRouteComments(fields.comments).state;
  if (assessed23 && !current) return applyRoute(fields, defaultRouteState(home));
  if (!assessed23 && current) return applyRoute(fields, null);
  // Always exactly these two fields (callers spread the result over a wider draft).
  return { location: fields.location, comments: fields.comments };
}

// ───────────────────────── D7: checks on the draft (display only) ─────────────────────────

export function routeCheckReminders(args: { state: RouteState | null; home: HomeDistrict; achieved23: boolean }): Reminder[] {
  const { state, home, achieved23 } = args;
  if (!state) return [{ id: "r10-centre", tone: "grey", text: "Choose the town centre to check the route." }];
  const out: Reminder[] = [];
  const name = townCentre(state.townCentreId).name;
  if (home.kind === "district" && home.townCentreId === state.townCentreId) {
    out.push({ id: "r10-home", tone: "amber", text: `${name} is the learner's home district (${evidence(home)}). Competency 23 needs an unfamiliar town centre. You can still save.` });
  }
  const missing = missingItems(state);
  if (!missing.length) out.push({ id: "r10-items", tone: "plain", text: `Route check: all Competency 23 route items ticked (${name}).` });
  else if (achieved23) out.push({ id: "r10-items", tone: "amber", text: `Route check not complete: ${missing.map((item) => item.short).join(", ")}. You can still save.` });
  else out.push({ id: "r10-items", tone: "grey", text: `Route items not ticked yet: ${missing.map((item) => item.short).join(", ")}. Tick them after the drive.` });
  return out;
}
