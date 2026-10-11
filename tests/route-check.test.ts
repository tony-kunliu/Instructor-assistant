import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { openTestD1 } from "../lib/db.ts";
import { createLearner, createLesson, findInstructorByEmail, getLesson } from "../lib/repo.ts";
import { listOutboxRowsForLearner } from "../lib/integration/outbox.ts";
import { resolveIntegrationConfig } from "../lib/integration/config.ts";
import type { IntegrationHooks } from "../lib/integration/types.ts";
import { FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22 } from "../lib/competency.ts";
import { buildCbtaChecklistPdf } from "../lib/pdf-export.ts";
import type { Learner, Lesson } from "../lib/types.ts";
import { TOWN_CENTRES, townCentre, townCentreByName } from "../lib/town-centres.ts";
import { DISTRICTS, DISTRICT_ALIASES, NSW_PLACES, UNMAPPED_ACT_SUBURBS, matchSuburb } from "../lib/act-suburbs.ts";
import {
  ALL_ITEM_IDS,
  applyRoute,
  commentsWithRoute,
  defaultRouteState,
  homeDistrict,
  locationWithCentre,
  MAX_COMMENTS_LENGTH,
  MAX_LOCATION_LENGTH,
  parseRouteComments,
  parseRouteLine,
  ROUTE_ITEMS,
  routeCheckReminders,
  routeLine,
  routeSuggestionReminder,
  suggestTownCentres,
  syncRouteWithAssessed,
  type RouteState,
} from "../lib/route-check.ts";

// R10 design (docs/superpowers/specs/2026-10-11-competency-23-route-design.md): reminders only, never blockers;
// pure functions, zero D1; home district from the address; location + one comment line, nothing to ACTGDS.

// ───────────────────────── D2: the 7 accepted centres, verbatim (NI2020-703 p 37) ─────────────────────────

test("town centres: exactly the 7 accepted centres, in the instrument's order, with its exact names", () => {
  assert.deepEqual(TOWN_CENTRES.map((c) => c.id), ["civic", "gungahlin", "belconnen", "woden", "tuggeranong", "fyshwick", "manuka-kingston"]);
  assert.deepEqual(TOWN_CENTRES.map((c) => c.official), ["Canberra City (Civic)", "Gungahlin", "Belconnen", "Woden", "Tuggeranong", "Fyshwick", "Manuka and Kingston – together"]);
  assert.deepEqual(TOWN_CENTRES.map((c) => c.name), ["Civic", "Gungahlin", "Belconnen", "Woden", "Tuggeranong", "Fyshwick", "Manuka/Kingston"]);
  assert.equal(new Set(TOWN_CENTRES.map((c) => c.name.toLowerCase())).size, 7, "names are unique, so the comment line parses back to one centre");
});

test("town centres: boundary streets as printed, incl. the instrument's spelling and repeats", () => {
  assert.deepEqual(townCentre("gungahlin").streetsAsPrinted, ["Gunghalin Dr", "The Valley Ave", "Kate Crace St / Tesselaar St", "Swain St", "Pallin St", "Gundaroo Dr"]);
  assert.deepEqual(townCentre("tuggeranong").streetsAsPrinted, ["Athllon Dr", "Anketell St", "Colishaw St", "North Reed St / South Reed St", "Anketell St"]);
  assert.deepEqual(townCentre("civic").streetsAsPrinted, ["Barry Dr", "Marcus Clarke St", "Edinburgh Ave", "London Cct", "Constitution Ave", "Coranderrk St / Cooyong St"]);
  assert.equal(townCentre("belconnen").streetsAsPrinted.filter((s) => s === "Emu Bank").length, 2);
  assert.deepEqual(townCentre("woden").streetsAsPrinted, ["Melrose Dr", "Launceston St", "Callam St", "Hindmarsh Dr"]);
  assert.deepEqual(townCentre("fyshwick").streetsAsPrinted, ["Canberra Ave", "Newcastle St", "Collie St / Tennant St", "Gladstone St", "Newcastle St", "Ipswich St"]);
  assert.deepEqual(townCentre("manuka-kingston").streetsAsPrinted, ["Canberra Ave", "Captain Cook Cres", "Murray St", "Furneaux St", "Eyre St", "Jardine St", "Giles St", "Kennedy St"]);
  assert.equal(townCentreByName("manuka/kingston")?.id, "manuka-kingston");
  assert.equal(townCentreByName("Manuka"), null, "only the exact short name parses (aliases are for typing, not the stored line)");
});

// ───────────────────────── §2a: suburb table shape ─────────────────────────

test("suburb table: every name is listed once across districts, unmapped and NSW (case-insensitive); centres exist or are null; no '(?)'", () => {
  const all = [...DISTRICTS.flatMap((d) => d.suburbs), ...DISTRICT_ALIASES.map((a) => a.alias), ...UNMAPPED_ACT_SUBURBS, ...NSW_PLACES];
  const lower = all.map((s) => s.toLowerCase());
  assert.equal(new Set(lower).size, lower.length, `duplicates: ${lower.filter((s, i) => lower.indexOf(s) !== i).join(", ")}`);
  for (const name of all) assert.ok(!name.includes("?"), `${name} is marked uncertain and must not be in the table`);
  const centreIds = new Set(TOWN_CENTRES.map((c) => c.id));
  for (const district of DISTRICTS) assert.ok(district.townCentreId === null || centreIds.has(district.townCentreId), district.name);
  assert.deepEqual(DISTRICTS.filter((d) => d.townCentreId === null).map((d) => d.id), ["weston-creek", "molonglo-valley", "jerrabomberra-act", "majura", "hall"]);
  assert.equal(DISTRICTS.find((d) => d.id === "belconnen")?.suburbs.length, 27);
  assert.equal(DISTRICTS.find((d) => d.id === "gungahlin")?.suburbs.length, 17);
});

test("suburb table: Weston Creek and the Molonglo Valley have no accepted centre; no neighbour counts as home (Tony 2026-10-11)", () => {
  for (const address of ["7 Namatjira Dr, Weston ACT 2611", "2 Woodberry Ave, Coombs ACT 2611", "9 Felstead Vista, Denman Prospect"]) {
    const home = homeDistrict(address);
    assert.equal(home.kind, "district");
    assert.equal(home.kind === "district" && home.townCentreId, null, address);
    assert.equal(suggestTownCentres(home).length, 7, address);
  }
});

// ───────────────────────── D3: matching ─────────────────────────

const districtOf = (address: string) => { const home = homeDistrict(address); return home.kind === "district" ? home : null; };
const matchedOf = (address: string) => districtOf(address)?.matched ?? null;

test("homeDistrict: whole-word, case-insensitive suburb match with evidence", () => {
  for (const address of ["12 Smith St, Florey ACT 2615", "12 SMITH ST FLOREY ACT 2615", "12 smith st, florey", "Unit 3/12 Smith Street\nFlorey, A.C.T. 2615"]) {
    const home = homeDistrict(address);
    assert.equal(home.kind, "district", address);
    if (home.kind === "district") {
      assert.equal(home.district.id, "belconnen");
      assert.equal(home.townCentreId, "belconnen");
      assert.equal(home.matched, "Florey");
    }
  }
  assert.equal(matchSuburb("FLOREY").kind, "district");
  assert.equal(matchSuburb("florey").kind, "district");
});

test("homeDistrict: a street named after a suburb never wins over the real suburb (nearest the end of the address)", () => {
  const cases: [string, string][] = [
    ["3 Gungahlin Dr, Florey ACT 2615", "Florey"],
    ["10 Belconnen Way, Hawker ACT 2614", "Hawker"],
    ["5 Kingston Ave, Kaleen", "Kaleen"],
    ["Woden Rd, Red Hill ACT", "Red Hill"],
    ["1 Tuggeranong Pkwy, Kambah", "Kambah"],
  ];
  for (const [address, expected] of cases) {
    const home = homeDistrict(address);
    assert.equal(home.kind === "district" && home.matched, expected, address);
  }
  // Multi-word suburbs and apostrophes.
  assert.equal(matchedOf("4 Hill St, Isabella Plains ACT 2905"), "Isabella Plains");
  for (const address of ["2 Macarthur Ave, O'Connor ACT 2602", "2 Macarthur Ave, O’Connor", "2 Macarthur Ave OConnor"]) {
    const home = homeDistrict(address);
    assert.equal(home.kind === "district" && home.matched, "O'Connor", address);
    assert.equal(home.kind === "district" && home.townCentreId, "civic");
  }
  // Partial words never match.
  assert.equal(homeDistrict("1 Pageant St, Nowhere").kind, "unknown");
  assert.equal(homeDistrict("Cooks Hill").kind, "unknown");
});

test("homeDistrict: aliases ('Belco', 'Tuggers') map to the district; outside the ACT and unmapped are explicit; empty is unknown", () => {
  assert.equal(districtOf("3 Nettlefold St, Belco")?.district.id, "belconnen");
  assert.equal(districtOf("Tuggers")?.townCentreId, "tuggeranong");
  assert.deepEqual(homeDistrict("8 Lowe St, Queanbeyan NSW 2620"), { kind: "outside-act", matched: "Queanbeyan" }, "the place name is the evidence, not the bare 'NSW'");
  assert.deepEqual(homeDistrict("12 Florey St NSW"), { kind: "outside-act", matched: "NSW" });
  for (const address of ["8 Lowe St, Queanbeyan NSW 2620", "8 Lowe St, Queanbeyan", "2 Belconnen St, Jerrabomberra NSW", "Googong", "12 Florey St NSW"]) {
    assert.equal(homeDistrict(address).kind, "outside-act", address);
  }
  assert.deepEqual(homeDistrict("1 Hume Hwy, Hume ACT"), { kind: "district", district: DISTRICTS.find((d) => d.id === "jerrabomberra-act"), townCentreId: null, matched: "Hume" });
  assert.deepEqual(homeDistrict("12 Wollongong St, Fyshwick ACT 2609"), { kind: "unmapped", matched: "Fyshwick" });
  assert.equal(homeDistrict("").kind, "unknown");
  assert.equal(homeDistrict(null).kind, "unknown");
  assert.equal(homeDistrict(undefined).kind, "unknown");
  assert.equal(homeDistrict("12 Smith St").kind, "unknown");
});

// ───────────────────────── D5: suggestion line ─────────────────────────

test("suggestTownCentres: excludes exactly the home centre and keeps table order", () => {
  assert.deepEqual(suggestTownCentres(homeDistrict("Florey")).map((c) => c.name), ["Civic", "Gungahlin", "Woden", "Tuggeranong", "Fyshwick", "Manuka/Kingston"]);
  assert.deepEqual(suggestTownCentres(homeDistrict("Kingston")).map((c) => c.id), ["civic", "gungahlin", "belconnen", "woden", "tuggeranong", "fyshwick"]);
  assert.deepEqual(suggestTownCentres(homeDistrict("Dickson")).map((c) => c.id)[0], "gungahlin");
  for (const address of ["Weston", "Queanbeyan", "", "Fyshwick"]) assert.equal(suggestTownCentres(homeDistrict(address)).length, 7, address);
});

test("routeSuggestionReminder: the panel's 4th line per D5", () => {
  assert.deepEqual(routeSuggestionReminder("12 Smith St, Florey ACT 2615"), {
    id: "r10", tone: "plain",
    text: "Unfamiliar town centres (home: Belconnen, from 'Florey' in the address): Civic, Gungahlin, Woden, Tuggeranong, Fyshwick, Manuka/Kingston.",
  });
  assert.deepEqual(routeSuggestionReminder("7 Namatjira Dr, Weston ACT 2611"), {
    id: "r10", tone: "plain", text: "Home district Weston Creek (from 'Weston' in the address) has no accepted town centre: all 7 are unfamiliar by this rule.",
  });
  assert.deepEqual(routeSuggestionReminder("8 Lowe St, Queanbeyan NSW 2620"), { id: "r10", tone: "plain", text: "Address outside the ACT (Queanbeyan): all 7 town centres are unfamiliar by the home-district rule." });
  assert.deepEqual(routeSuggestionReminder(""), { id: "r10", tone: "grey", text: "Cannot check the home town centre: add the learner's suburb to the address." });
  assert.deepEqual(routeSuggestionReminder("12 Smith St"), { id: "r10", tone: "grey", text: "Cannot check the home town centre: add the learner's suburb to the address." });
  assert.equal(routeSuggestionReminder("Fyshwick").tone, "grey");
  assert.match(routeSuggestionReminder("Fyshwick").text, /'Fyshwick' is not in the app's district table/);
});

// ───────────────────────── D9: comment line build + parse ─────────────────────────

test("route items: the six official requirements (NI2020-703 pp 36-37), 'minimum' reading (A1)", () => {
  assert.deepEqual(ROUTE_ITEMS.map((i) => i.label), ["2 designated zones", "1+ stop sign", "1+ give way sign", "2+ traffic lights", "2+ pedestrian crossings", "5+ right and 5+ left turns"]);
  assert.equal(new Set(ROUTE_ITEMS.map((i) => i.short)).size, 6);
  for (const item of ROUTE_ITEMS) assert.ok(!item.short.includes(",") && !item.short.includes(";"), item.short);
});

test("routeLine: the exact generated texts", () => {
  assert.equal(routeLine({ townCentreId: "woden", ticked: [...ALL_ITEM_IDS] }), "Comp 23 route (Woden): 2 zones, stop, give way, 2 lights, 2 crossings, 5R/5L all ticked.");
  assert.equal(routeLine({ townCentreId: "woden", ticked: [] }), "Comp 23 route (Woden): none ticked.");
  assert.equal(routeLine({ townCentreId: "manuka-kingston", ticked: ["turns", "stop"] }), "Comp 23 route (Manuka/Kingston): ticked: stop, 5R/5L; not ticked: 2 zones, give way, 2 lights, 2 crossings.");
});

test("routeLine ↔ parseRouteLine: round trip for every centre and every subset of ticks; altered lines are plain text", () => {
  for (const centre of TOWN_CENTRES) {
    for (let mask = 0; mask < 1 << ALL_ITEM_IDS.length; mask++) {
      const ticked = ALL_ITEM_IDS.filter((_, i) => mask & (1 << i));
      const state: RouteState = { townCentreId: centre.id, ticked };
      const parsed = parseRouteLine(routeLine(state));
      assert.deepEqual(parsed, { townCentreId: centre.id, ticked }, routeLine(state));
    }
  }
  for (const altered of [
    "Comp 23 route (Woden): 2 zones, stop, give way, 2 lights, 2 crossings all ticked.",
    "Comp 23 route (Woden): ticked: stop; not ticked: 2 zones.",
    "Comp 23 route (Woden): ticked: stop, stop; not ticked: 2 zones, give way, 2 lights, 2 crossings.",
    "Comp 23 route (Belco): none ticked.",
    "Comp 23 route (Woden): none ticked, but it was a good drive.",
    "comp 23 route (Woden): none ticked.",
    "Good drive.",
  ]) assert.equal(parseRouteLine(altered), null, altered);
});

test("parseRouteComments / commentsWithRoute: the instructor's own text is never changed; regeneration is idempotent", () => {
  const own = "Nervous at first.\nMuch better in traffic.";
  const woden: RouteState = { townCentreId: "woden", ticked: ["stop", "lights"] };
  const once = commentsWithRoute(own, woden);
  assert.equal(once, `${own}\n${routeLine(woden)}`);
  assert.deepEqual(parseRouteComments(once), { state: woden, own });
  const belco: RouteState = { townCentreId: "belconnen", ticked: [...ALL_ITEM_IDS] };
  const twice = commentsWithRoute(once, belco);
  assert.equal(twice, `${own}\n${routeLine(belco)}`, "the earlier generated line is replaced, not stacked");
  assert.equal(commentsWithRoute(twice, belco), twice, "idempotent");
  assert.equal(commentsWithRoute(twice, null), own, "removing the route leaves exactly the own text");
  assert.equal(commentsWithRoute("", woden), routeLine(woden));
  assert.equal(commentsWithRoute("   ", woden), routeLine(woden));
  // The line typed in the middle by hand is still recognised; the surrounding text stays, in order.
  const middle = `Before.\n${routeLine(woden)}\nAfter.`;
  assert.deepEqual(parseRouteComments(middle), { state: woden, own: "Before.\nAfter." });
  // A hand-altered line is plain text and is kept as such.
  const altered = "Comp 23 route (Woden): none ticked, really.";
  assert.deepEqual(parseRouteComments(altered), { state: null, own: altered });
  assert.equal(commentsWithRoute(altered, woden), `${altered}\n${routeLine(woden)}`);
});

test("commentsWithRoute respects 3000 characters: when the line would not fit, the comments are returned unchanged", () => {
  const woden: RouteState = { townCentreId: "woden", ticked: [] };
  const long = "x".repeat(MAX_COMMENTS_LENGTH - routeLine(woden).length - 1);
  assert.equal(commentsWithRoute(long, woden).length, MAX_COMMENTS_LENGTH);
  const tooLong = "x".repeat(MAX_COMMENTS_LENGTH - 5);
  assert.equal(commentsWithRoute(tooLong, woden), tooLong);
});

test("locationWithCentre: empty → name; own text → prefixed; previous prefix replaced; own text kept; 200 chars respected", () => {
  assert.equal(locationWithCentre("", "woden", null), "Woden");
  assert.equal(locationWithCentre("Launceston St car park", "woden", null), "Woden: Launceston St car park");
  assert.equal(locationWithCentre("Woden: Launceston St car park", "woden", "woden"), "Woden: Launceston St car park");
  assert.equal(locationWithCentre("Woden: Launceston St car park", "belconnen", "woden"), "Belconnen: Launceston St car park");
  assert.equal(locationWithCentre("Woden", "belconnen", "woden"), "Belconnen");
  assert.equal(locationWithCentre("Woden", null, "woden"), "", "unticking 23 removes the written name");
  assert.equal(locationWithCentre("Woden: Launceston St", null, "woden"), "Launceston St");
  assert.equal(locationWithCentre("Hawker then Belconnen", null, "woden"), "Hawker then Belconnen", "hand-typed text is never touched");
  const long = "y".repeat(MAX_LOCATION_LENGTH - 3);
  assert.equal(locationWithCentre(long, "woden", null), long, "would exceed 200: unchanged");
  assert.equal(locationWithCentre("y".repeat(193), "woden", null).length, 200);
});

test("applyRoute + syncRouteWithAssessed: the form's state machine", () => {
  const home = homeDistrict("12 Smith St, Florey ACT 2615");
  const empty = { location: "", comments: "" };
  // 23 ticked as Assessed: the first suggested centre (Civic for a Belconnen learner) is preselected, nothing ticked (D6).
  const started = syncRouteWithAssessed(empty, true, home);
  assert.deepEqual(started, { location: "Civic", comments: "Comp 23 route (Civic): none ticked." });
  assert.deepEqual(defaultRouteState(home), { townCentreId: "civic", ticked: [] });
  // Already has a route: Assessed changes elsewhere leave it alone.
  assert.deepEqual(syncRouteWithAssessed(started, true, home), started);
  // Choosing a centre, ticking items.
  const chosen = applyRoute(started, { townCentreId: "woden", ticked: ["zones"] });
  assert.deepEqual(chosen, { location: "Woden", comments: "Comp 23 route (Woden): ticked: 2 zones; not ticked: stop, give way, 2 lights, 2 crossings, 5R/5L." });
  const all = applyRoute({ ...chosen, comments: `Smooth drive.\n${parseRouteComments(chosen.comments).state ? routeLine(parseRouteComments(chosen.comments).state!) : ""}` }, { townCentreId: "woden", ticked: [...ALL_ITEM_IDS] });
  assert.deepEqual(all, { location: "Woden", comments: "Smooth drive.\nComp 23 route (Woden): 2 zones, stop, give way, 2 lights, 2 crossings, 5R/5L all ticked." });
  // 23 unticked: the app's line and the written name go; own text stays.
  assert.deepEqual(syncRouteWithAssessed(all, false, home), { location: "", comments: "Smooth drive." });
  assert.deepEqual(syncRouteWithAssessed({ location: "Hawker", comments: "Own." }, false, home), { location: "Hawker", comments: "Own." });
  // Regression (first qa-browser run): the unchanged branch must return ONLY location + comments, never echo a wider
  // draft back (the caller spreads the result over the draft after setting the new Assessed list).
  const wider = { location: "Hawker", comments: "Own.", assessedIds: ["old"] } as { location: string; comments: string };
  assert.deepEqual(Object.keys(syncRouteWithAssessed(wider, false, home)).sort(), ["comments", "location"]);
  assert.deepEqual(Object.keys(syncRouteWithAssessed({ ...wider, comments: routeLine({ townCentreId: "woden", ticked: [] }) }, true, home)).sort(), ["comments", "location"]);
  assert.deepEqual(Object.keys(applyRoute(wider, { townCentreId: "woden", ticked: [] })).sort(), ["comments", "location"]);
  // Default for a learner with no home centre (Weston Creek): the first of all 7, Civic.
  assert.equal(defaultRouteState(homeDistrict("Weston")).townCentreId, "civic");
  // Default for a North Canberra learner skips Civic.
  assert.equal(defaultRouteState(homeDistrict("Braddon")).townCentreId, "gungahlin");
});

// ───────────────────────── D7: display-only checks ─────────────────────────

test("routeCheckReminders: home centre → amber; incomplete + Achieved → amber; incomplete not achieved → grey; all ticked → plain; none → grey", () => {
  const home = homeDistrict("12 Smith St, Florey ACT 2615");
  assert.deepEqual(routeCheckReminders({ state: null, home, achieved23: true }), [{ id: "r10-centre", tone: "grey", text: "Choose the town centre to check the route." }]);
  const homeCentre = routeCheckReminders({ state: { townCentreId: "belconnen", ticked: [...ALL_ITEM_IDS] }, home, achieved23: true });
  assert.deepEqual(homeCentre.map((r) => [r.id, r.tone]), [["r10-home", "amber"], ["r10-items", "plain"]]);
  assert.equal(homeCentre[0].text, "Belconnen is the learner's home district (from 'Florey' in the address). Competency 23 needs an unfamiliar town centre. You can still save.");
  const incomplete = routeCheckReminders({ state: { townCentreId: "woden", ticked: ["zones", "stop", "giveWay", "crossings"] }, home, achieved23: true });
  assert.deepEqual(incomplete, [{ id: "r10-items", tone: "amber", text: "Route check not complete: 2 lights, 5R/5L. You can still save." }]);
  const pending = routeCheckReminders({ state: { townCentreId: "woden", ticked: [] }, home, achieved23: false });
  assert.deepEqual(pending.map((r) => r.tone), ["grey"]);
  assert.deepEqual(routeCheckReminders({ state: { townCentreId: "woden", ticked: [...ALL_ITEM_IDS] }, home, achieved23: true }), [{ id: "r10-items", tone: "plain", text: "Route check: all Competency 23 route items ticked (Woden)." }]);
  // No home centre (Weston Creek, outside the ACT, unknown): never the amber home line.
  for (const address of ["Weston", "Queanbeyan NSW", ""]) {
    assert.ok(routeCheckReminders({ state: { townCentreId: "woden", ticked: [] }, home: homeDistrict(address), achieved23: false }).every((r) => r.id !== "r10-home"), address);
  }
});

// ───────────────────────── D9/D10: storage and ACTGDS ─────────────────────────

const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const achieved = (ids: string[]) => ({ assessedIds: ids, achievedResults: Object.fromEntries(ids.map((id) => [id, "achieved"])) });

test("D1: a lesson with 23 Assessed + Achieved saves with and without route data (never blocks); the line and location are stored as typed; nothing new goes to ACTGDS", async () => {
  const db = openTestD1(":memory:");
  const tony = await findInstructorByEmail(db, "Kunliu.work@gmail.com");
  const learner = await createLearner(db, { fullName: "QA Route Learner", instructorId: tony?.id, address: "12 Smith St, Florey ACT 2615" });
  const pending: Promise<void>[] = [];
  const sent: string[] = [];
  const hooks: IntegrationHooks = {
    config: resolveIntegrationConfig({ ACTGDS_INTEGRATION_ENABLED: "true", ACTGDS_WEBHOOK_URL: "https://fake.example/webhook", ACTGDS_WEBHOOK_SECRET: "synthetic-test-secret-never-real", ACTGDS_INTEGRATION_ENV: "staging" }),
    fetchImpl: (async (_url: unknown, init?: RequestInit) => { sent.push(String(init?.body)); return new Response("", { status: 202 }); }) as typeof fetch,
    schedule: (attempt) => { pending.push(attempt()); },
  };
  let odo = 1000;
  const save = async (extra: Record<string, unknown>) => {
    const start = odo; odo += 12;
    return createLesson(db, learner.id, { lessonDate: "2026-09-20", startTime: "09:00", finishTime: "10:00", startOdometer: String(start), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...extra }, hooks);
  };
  await save(achieved(range(1, 17)));
  await save(achieved([REVIEW_1_17]));
  await save(achieved(range(18, 22)));
  await save(achieved([REVIEW_1_22]));
  // Without any route data (legacy / untouched group): saves.
  const plain = await save({ ...achieved([FINAL_DRIVE_23]), achievedResults: { [FINAL_DRIVE_23]: "not_achieved" } });
  assert.equal(plain.location, null);
  // With the generated line + location (what the form writes), and the instructor's own text.
  const state: RouteState = { townCentreId: "woden", ticked: [...ALL_ITEM_IDS] };
  const fields = applyRoute({ location: "Launceston St start", comments: "Confident throughout." }, state);
  const lesson = await save({ ...achieved([FINAL_DRIVE_23]), ...fields });
  const stored = await getLesson(db, learner.id, lesson.id);
  assert.equal(stored.location, "Woden: Launceston St start");
  assert.equal(stored.comments, "Confident throughout.\nComp 23 route (Woden): 2 zones, stop, give way, 2 lights, 2 crossings, 5R/5L all ticked.");
  assert.deepEqual(parseRouteComments(stored.comments ?? ""), { state, own: "Confident throughout." });
  await Promise.all(pending);
  const rows = await listOutboxRowsForLearner(db, learner.id);
  assert.equal(rows.length, 6);
  for (const text of [...rows.map((row) => row.payloadJson), ...sent]) {
    for (const forbidden of ["Comp 23 route", "Woden", "Launceston", "Confident", "location", "comments", "Florey", "address", "route"]) {
      assert.ok(!text.includes(forbidden), `payload must not contain "${forbidden}"`);
    }
  }
});

test("D10: the V1 contract has no location, comments or route keys (the schema file is byte-identical to ACTGDS's; hash pinned in integration-alignment.test.ts)", () => {
  const schema = readFileSync(new URL("../docs/integrations/lesson-upserted-v1.schema.json", import.meta.url), "utf8");
  for (const forbidden of ["location", "comments", "route", "town_centre", "address"]) assert.ok(!schema.toLowerCase().includes(forbidden), forbidden);
});

// ───────────────────────── PDF: location + comments print as today ─────────────────────────

test("PDF: the route line prints through the existing Comments cell (and the centre through Location), unchanged layout", async () => {
  const templateBytes = readFileSync(new URL("../public/pdf-template/adi-cbta-checklist.pdf", import.meta.url));
  const fontBytes = readFileSync(new URL("../public/fonts/NotoSansSC-Regular.otf", import.meta.url));
  const learner: Learner = {
    id: "learner-1", instructorId: "instructor-1", instructorName: "Test Instructor", instructorAdiNumber: "ADI-9", fullName: "QA Route Learner",
    address: "12 Smith St, Florey ACT 2615", phone: null, dob: null, licenceNumber: null, licenceExpiry: null, eligibility: null, transmission: null, schoolWork: null,
    licenceStage: "learner", learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null,
    archivedAt: null, archiveReason: null, archiveNote: null, transfers: [],
  };
  const fields = applyRoute({ location: "", comments: "Good drive." }, { townCentreId: "woden", ticked: ["zones", "stop"] });
  const lesson: Lesson = {
    id: "lesson-1", learnerId: "learner-1", instructorId: "instructor-1", lessonNo: 1, lessonDate: "2026-10-01", startTime: "09:00", finishTime: "10:00",
    startOdometer: 10, finishOdometer: 20, durationMinutes: 60, distanceKm: 10, cumulativeMinutes: 60, cumulativeKm: 10, taught: null, competenciesAssessed: "23 Final Drive", achieved: "23 Final Drive",
    location: fields.location, comments: fields.comments, adiSignature: SIG, learnerSignature: SIG, createdAt: new Date().toISOString(), updatedAt: null, updatedByInstructorId: null,
    updatedByInstructorName: null, recordSource: "app", signatureStatus: "digital", priorInstructorLabel: null, priorLessonCount: null, revisionCount: 0, editedBeforeRevisionHistory: false,
  };
  const result = await buildCbtaChecklistPdf({ templateBytes, fontBytes, learner, lessons: [lesson] });
  assert.ok(result.bytes.length > 1000);
  const dir = mkdtempSync(path.join(os.tmpdir(), "route-pdf-"));
  const file = path.join(dir, "out.pdf");
  writeFileSync(file, result.bytes);
  let extracted: string | null = null;
  try { extracted = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" }); } catch { /* pdftotext not installed */ }
  if (extracted !== null) {
    const flat = extracted.replace(/\s+/g, " ");
    assert.match(flat, /Woden/);
    assert.match(flat, /Good drive\./);
    assert.match(flat, /Comp 23 route \(Woden\)/, "the generated line is printed (in the cell or in Additional Notes), never dropped");
  } else if (process.env.REQUIRE_POPPLER === "1") {
    assert.fail("pdftotext is required (REQUIRE_POPPLER=1)");
  }
});

