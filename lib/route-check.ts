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
/** "assessment" = a condition on the whole assessment ("must include 2 designated zones"); "centre" = negotiated in the UNFAMILIAR town centre within ONE zone. */
export type RouteItemGroup = "assessment" | "centre";

/** `label` = the tick's wording; `short` = the token in the generated comment line (unique, no commas or semicolons). */
export const ROUTE_ITEMS: readonly { id: RouteItemId; group: RouteItemGroup; label: string; short: string }[] = [
  { id: "zones", group: "assessment", label: "2 designated zones (RTA-approved)", short: "2 zones" },
  { id: "stop", group: "centre", label: "1+ stop sign", short: "stop" },
  { id: "giveWay", group: "centre", label: "1+ give way sign", short: "give way" },
  { id: "lights", group: "centre", label: "2+ traffic lights", short: "2 lights" },
  { id: "crossings", group: "centre", label: "2+ pedestrian crossings", short: "2 crossings" },
  { id: "turns", group: "centre", label: "5+ right and 5+ left turns", short: "5R/5L" },
];

/** Headings for the two groups, as the form shows them (the instrument's structure; A1 = the app's minimum reading). */
export const ROUTE_GROUP_HEADINGS: Record<RouteItemGroup, string> = {
  assessment: "The assessment must include",
  centre: "In the UNFAMILIAR town centre, within one zone (counts read as minimums, assumption A1)",
};

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

const esc = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const ITEM_ALT = `(?:${ROUTE_ITEMS.map((item) => esc(item.short)).join("|")})`;
const ITEM_LIST = `${ITEM_ALT}(?:, ${ITEM_ALT})*`;
// The app's line, followed by whatever the instructor appended on the same line (kept as `extra`).
const LINE_RE = new RegExp(`^Comp 23 route \\(([^()]+)\\): (?:(none ticked\\.)|(${ITEM_LIST}) all ticked\\.|ticked: (${ITEM_LIST}); not ticked: (${ITEM_LIST})\\.)(.*)$`);

export type ParsedLine = { state: RouteState; /** Text the instructor appended after the generated part on the same line ("" when none). */ extra: string };

function idsOf(part: string): RouteItemId[] {
  const byShort = new Map(ROUTE_ITEMS.map((item) => [item.short, item.id]));
  return part.split(", ").map((short) => byShort.get(short)!);
}

/**
 * Recognises the app's line: the exact generated pattern at the START of the line, plus any text appended after it
 * (kept). A line whose generated part is altered (centre renamed, an item missing or repeated) is plain comment text.
 */
export function parseRouteLine(line: string): ParsedLine | null {
  const match = LINE_RE.exec(line.replace(/^\s+/, "").replace(/\r$/, ""));
  if (!match) return null;
  const centre = townCentreByName(match[1]);
  if (!centre) return null;
  let ticked: RouteItemId[];
  if (match[2]) ticked = [];
  else if (match[3]) {
    ticked = idsOf(match[3]);
    if (new Set(ticked).size !== ALL_ITEM_IDS.length) return null;
  } else {
    ticked = idsOf(match[4]);
    const notTicked = idsOf(match[5]);
    if (new Set([...ticked, ...notTicked]).size !== ALL_ITEM_IDS.length || ticked.length + notTicked.length !== ALL_ITEM_IDS.length) return null;
  }
  return { state: { townCentreId: centre.id, ticked }, extra: match[6] };
}

export type ParsedComments = {
  state: RouteState | null;
  /** The comments with the generated part removed (the instructor's own text, untouched). */
  own: string;
  /** Text appended on the app's line, re-appended after regeneration. */
  extra: string;
};

/** Finds the app's line anywhere in the comments (last one wins); the rest is the instructor's own text. */
export function parseRouteComments(comments: string): ParsedComments {
  const lines = comments.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const parsed = parseRouteLine(lines[i]);
    if (!parsed) continue;
    return { state: parsed.state, own: [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n"), extra: parsed.extra };
  }
  return { state: null, own: comments, extra: "" };
}

export const MAX_LOCATION_LENGTH = 200;
export const MAX_COMMENTS_LENGTH = 3000;

/** D9: the own text, then the regenerated line (+ appended text). Null when it would not fit in 3000 characters. */
export function commentsWithRoute(comments: string, state: RouteState | null): string | null {
  const { own, extra } = parseRouteComments(comments);
  if (!state) return own;
  const line = routeLine(state) + extra;
  const next = own.trim() === "" ? line : `${own.replace(/\s+$/, "")}\n${line}`;
  return next.length <= MAX_COMMENTS_LENGTH ? next : null;
}

/** Strips ANY accepted centre's "<Name>: " prefix (or a bare "<Name>") from the location, so prefixes never stack. */
export function stripCentrePrefix(location: string): string {
  for (const centre of TOWN_CENTRES) {
    if (location.trim() === centre.name) return "";
    if (location.startsWith(`${centre.name}: `)) return location.slice(centre.name.length + 2);
  }
  return location;
}

/** The centre name as `location` when empty, otherwise the prefix "Woden: …" over the own text. Null when it would not fit in 200 characters. */
export function locationWithCentre(location: string, next: TownCentreId | null): string | null {
  const rest = stripCentrePrefix(location);
  if (next === null) return rest;
  const name = townCentre(next).name;
  const result = rest.trim() === "" ? name : `${name}: ${rest}`;
  return result.length <= MAX_LOCATION_LENGTH ? result : null;
}

export type RouteFields = { location: string; comments: string };

/**
 * Writes `state` (or removes the route, null) into location + comments: all or nothing. When either write would
 * exceed its limit, BOTH fields come back unchanged and `ok` is false (the form shows a grey line).
 */
export function applyRoute(fields: RouteFields, state: RouteState | null): RouteFields & { ok: boolean } {
  const location = locationWithCentre(fields.location, state?.townCentreId ?? null);
  const comments = commentsWithRoute(fields.comments, state);
  if (location === null || comments === null) return { location: fields.location, comments: fields.comments, ok: false };
  return { location, comments, ok: true };
}

/** D6: the first suggested centre, shown preselected in the form (UI only; nothing is written until the instructor taps). */
export function defaultRouteState(home: HomeDistrict): RouteState {
  return { townCentreId: suggestTownCentres(home)[0].id, ticked: [] };
}

/**
 * The form's state machine, run when the Assessed set changes. Only the 23 TRANSITION matters: ticking 23 writes
 * nothing (the group just appears; location/comments are written only by an explicit tap in it); unticking 23 removes
 * exactly the app's own generated part (prefix + line), keeping the instructor's text. Any other Assessed change,
 * including on a legacy lesson with 23 assessed and no line, leaves both fields untouched.
 */
export function syncRouteWithAssessed(fields: RouteFields, was23: boolean, now23: boolean): RouteFields {
  if (was23 && !now23) {
    const { location, comments } = applyRoute(fields, null);
    return { location, comments };
  }
  return { location: fields.location, comments: fields.comments };
}

export const ROUTE_TOO_LONG_TEXT = "Comments or location are too long to add the route line.";
export const ROUTE_SIGNATURE_HINT = "Changing this clears both signatures: location and comments are signed content.";

// ───────────────────────── D7: checks on the draft (display only) ─────────────────────────

export function routeCheckReminders(args: { state: RouteState | null; home: HomeDistrict; achieved23: boolean; /** false = the line would not fit (applyRoute refused). */ fits?: boolean }): Reminder[] {
  const { state, home, achieved23 } = args;
  const out: Reminder[] = [];
  if (args.fits === false) out.push({ id: "r10-fit", tone: "grey", text: ROUTE_TOO_LONG_TEXT });
  if (!state) {
    out.push({ id: "r10-centre", tone: "grey", text: "Route not recorded yet: tap the town centre or a tick after the drive. Nothing is written until you do." });
    return out;
  }
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
