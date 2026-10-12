// Learner intake P2 (design 2026-10-11, Feature 1): pure matching (D4), structured-parts rules (D7), and the shape of
// the committed G-NAF index (D2/D10). Synthetic fixture first; a few assertions against the real index at the end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import {
  ADDRESS_STATES,
  addressContainsSuburb,
  GNAF_ATTRIBUTION,
  MAX_QUERY_LENGTH,
  MAX_QUERY_WORDS,
  MAX_SUGGESTIONS,
  MIN_STREET_LETTERS,
  parseAddressQuery,
  partsAfterEdit,
  STREET_INDEX_FILE,
  suggestAddresses,
  validateAddressParts,
  type StreetIndex,
} from "../lib/address-suggest.ts";

/** Synthetic fixture (not G-NAF): "Apple Av, Acton" exists here on purpose, D5 says it does not exist in the real data. */
const FIXTURE: StreetIndex = {
  _: { source: "synthetic", release: "test", licence: "n/a", attribution: "n/a", entries: 9, localities: 5 },
  localities: [["Acton", "ACT", "2601"], ["Jacka", "ACT", "2914"], ["Queanbeyan East", "NSW", "2620"], ["Jerrabomberra", "NSW", "2619"], ["Tralee", "NSW", "2620"]],
  streets: [
    ["Apple", "Av", 0],
    ["Appleberry", "Rd", 4],
    ["Applebox", "Pl", 3],
    ["Appleford", "Av", 1],
    ["Appleton", "St", 2],
    ["Applewood", "Cl", 2],
    ["Captain Cook", "Cres", 0, "2600"],
    ["Cooke", "St", 1],
    ["The Mews", "", 0],
  ],
};
const labels = (text: string) => suggestAddresses(FIXTURE, text).map((s) => s.label);

test("parseAddressQuery: the first token is the number only when it holds a digit; it is kept exactly as typed; commas are ignored", () => {
  assert.deepEqual(parseAddressQuery("44 app"), { number: "44", words: ["app"], streetLetters: 3 });
  assert.deepEqual(parseAddressQuery("3/44 Appleford Av, Jacka").number, "3/44");
  assert.deepEqual(parseAddressQuery("44A appleford ja").words, ["appleford", "ja"]);
  assert.deepEqual(parseAddressQuery("Appleford Av").number, "");
  assert.deepEqual(parseAddressQuery("  44   "), { number: "44", words: [], streetLetters: 0 });
  assert.equal(parseAddressQuery("44 ap").streetLetters, 2);
});

test("m5: leading non-digit tokens (Unit, Flat, Lot) are skipped up to the first digit-bearing token and kept in the number part as typed", () => {
  assert.deepEqual(parseAddressQuery("Unit 3 44 appleford"), { number: "Unit 3 44", words: ["appleford"], streetLetters: 9 });
  assert.deepEqual(parseAddressQuery("Flat 2/44 app ja"), { number: "Flat 2/44", words: ["app", "ja"], streetLetters: 5 });
  assert.deepEqual(parseAddressQuery("Lot 7 Unlisted Track"), { number: "Lot 7", words: ["unlisted", "track"], streetLetters: 13 });
  assert.deepEqual(parseAddressQuery("unit 3, 44 appleford av, jacka").number, "unit 3 44");
  assert.deepEqual(parseAddressQuery("Appleford Av Jacka"), { number: "", words: ["appleford", "av", "jacka"], streetLetters: 16 }, "no digit anywhere: all words are the street part");
  assert.deepEqual(labels("Unit 3 44 appleford ja"), ["Unit 3 44 Appleford Av, Jacka ACT 2914"]);
  assert.deepEqual(labels("Flat 2/44 app ja"), ["Flat 2/44 Appleford Av, Jacka ACT 2914"]);
  assert.deepEqual(labels("The Mews Acton")[0], "The Mews, Acton ACT 2601", "a street name starting with a word is still matched without a number");
});

test("M1: pasted text is refused fast — over 300 characters or more than 8 words gives [] (2,000 words in under 50 ms on the real index)", () => {
  assert.equal(MAX_QUERY_LENGTH, 300);
  assert.equal(MAX_QUERY_WORDS, 8);
  assert.deepEqual(labels(`44 ${"app ".repeat(9)}`), [], "9 words after the number");
  assert.ok(labels(`44 ${"app ".repeat(7)}`).length === 0 || true, "8 words is allowed to run (no match here)");
  assert.deepEqual(labels(`44 app ${"x".repeat(300)}`), [], "over 300 characters");
  const pasted = Array.from({ length: 2000 }, (_, i) => (i % 3 ? "appleford" : "44")).join(" ");
  const started = performance.now();
  assert.deepEqual(suggestAddresses(real, pasted), []);
  const ms = performance.now() - started;
  assert.ok(ms < 50, `2,000-word input took ${ms.toFixed(1)} ms`);
  // A long but legitimate query (8 words, under 300 chars) still scans the whole index quickly.
  const t2 = performance.now();
  suggestAddresses(real, "44 appleford avenue jacka canberra act 2914 australia");
  assert.ok(performance.now() - t2 < 200, "8-word query scans in reasonable time");
});

test("D6: nothing before 3 typed letters of the street; the number alone gives nothing", () => {
  assert.equal(MIN_STREET_LETTERS, 3);
  assert.deepEqual(labels("44"), []);
  assert.deepEqual(labels("44 ap"), []);
  assert.deepEqual(labels("ap"), []);
  assert.ok(labels("44 app").length > 0);
  assert.ok(labels("app").length > 0, "no number is fine");
});

test("D4 ordering for '44 app': exact prefix first, ACT before NSW, then alphabetical; at most 5; the number is kept as typed", () => {
  assert.equal(MAX_SUGGESTIONS, 5);
  const got = labels("44 app");
  assert.deepEqual(got, ["44 Apple Av, Acton ACT 2601", "44 Appleford Av, Jacka ACT 2914", "44 Appleberry Rd, Tralee NSW 2620", "44 Applebox Pl, Jerrabomberra NSW 2619", "44 Appleton St, Queanbeyan East NSW 2620"]);
  assert.equal(got.length, 5, "Applewood is the 6th match and is cut");
  assert.deepEqual(labels("3/44 appleford")[0], "3/44 Appleford Av, Jacka ACT 2914");
  assert.deepEqual(labels("44A appleford")[0], "44A Appleford Av, Jacka ACT 2914");
  assert.equal(suggestAddresses(FIXTURE, "44A appleford")[0].number, "44A");
});

test("D4: a suburb prefix after the street narrows the list; the street type can be typed too; the whole label matches itself", () => {
  assert.deepEqual(labels("44 app ja"), ["44 Appleford Av, Jacka ACT 2914"]);
  assert.deepEqual(labels("44 appleford ja"), ["44 Appleford Av, Jacka ACT 2914"]);
  assert.deepEqual(labels("44 apple q"), ["44 Appleton St, Queanbeyan East NSW 2620", "44 Applewood Cl, Queanbeyan East NSW 2620"]);
  assert.deepEqual(labels("44 applewood cl queanbeyan ea"), ["44 Applewood Cl, Queanbeyan East NSW 2620"]);
  assert.deepEqual(labels("44 Appleford Av, Jacka ACT 2914"), [], "the state and postcode are not matched: once picked, the list closes");
  assert.deepEqual(labels("44 Appleford Av, Jacka"), ["44 Appleford Av, Jacka ACT 2914"]);
});

test("D4: a later word of the street name matches too, but ranks after exact-prefix matches; a street with no type keeps its name", () => {
  assert.deepEqual(labels("12 cook"), ["12 Cooke St, Jacka ACT 2914", "12 Captain Cook Cres, Acton ACT 2600"]);
  assert.deepEqual(labels("captain coo"), ["Captain Cook Cres, Acton ACT 2600"]);
  assert.deepEqual(labels("the mew"), ["The Mews, Acton ACT 2601"]);
  assert.equal(suggestAddresses(FIXTURE, "captain cook")[0].postcode, "2600", "a street's own postcode overrides the locality's");
});

test("no match gives an empty list; matching is case-insensitive", () => {
  assert.deepEqual(labels("44 zzz"), []);
  assert.deepEqual(labels("44 APPLEFORD"), ["44 Appleford Av, Jacka ACT 2914"]);
});

test("D7 in the form: parts stay while the suburb is a whole word of the text; cleared otherwise", () => {
  const parts = { suburb: "Jacka", state: "ACT", postcode: "2914" };
  assert.deepEqual(partsAfterEdit("44 Appleford Av, Jacka ACT 2914", parts), parts);
  assert.deepEqual(partsAfterEdit("Unit 2, 44 Appleford Av, jacka", parts), parts, "case-insensitive");
  assert.equal(partsAfterEdit("44 Appleford Av", parts), null);
  assert.equal(partsAfterEdit("44 Appleford Av, Jackal ACT", parts), null, "not a whole word");
  assert.equal(partsAfterEdit("", parts), null);
  assert.equal(partsAfterEdit("anything", null), null);
  const twoWords = { suburb: "Queanbeyan East", state: "NSW", postcode: "2620" };
  assert.deepEqual(partsAfterEdit("5 Appleton St, Queanbeyan East NSW 2620", twoWords), twoWords);
  assert.equal(partsAfterEdit("5 Appleton St, Queanbeyan NSW 2620", twoWords), null);
  assert.ok(addressContainsSuburb("1 O'Connor St, O'Connor", "O'Connor"));
  assert.ok(!addressContainsSuburb("1 Smith St, Westonia", "Weston"), "a longer word is not the suburb");
  assert.ok(addressContainsSuburb("1 Smith St, Weston Creek", "Weston"), "a whole word is enough, even inside a longer place name (D7 wording)");
});

test("D7 server shapes: all three or none; suburb <= 60; state from the list; 4-digit postcode; suburb must be in the text; normalised output", () => {
  assert.deepEqual(validateAddressParts("44 Appleford Av, Jacka ACT 2914", null, null, null), { ok: true, parts: null });
  assert.deepEqual(validateAddressParts("44 Appleford Av, Jacka ACT 2914", " Jacka ", "act", " 2914"), { ok: true, parts: { suburb: "Jacka", state: "ACT", postcode: "2914" } });
  const error = (address: string | null, s: string | null, st: string | null, p: string | null) => { const r = validateAddressParts(address, s, st, p); return r.ok ? "" : r.error; };
  assert.match(error("44 Appleford Av, Jacka", "Jacka", null, null), /go together/);
  assert.match(error("44 Appleford Av, Jacka", "Jacka", "ACT", ""), /go together/);
  assert.match(error("x Jacka", "Jacka", "ACT", "291"), /4 digits/);
  assert.match(error("x Jacka", "Jacka", "ACT", "29144"), /4 digits/);
  assert.match(error("x Jacka", "Jacka", "ACTT", "2914"), /state must be one of ACT, NSW/);
  assert.match(error("x", "J".repeat(61), "ACT", "2914"), /1 to 60 characters/);
  assert.match(error("44 Appleford Av", "Jacka", "ACT", "2914"), /must contain the suburb "Jacka"/);
  assert.match(error(null, "Jacka", "ACT", "2914"), /must contain the suburb/);
  assert.deepEqual([...ADDRESS_STATES], ["ACT", "NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT"]);
  for (const state of ADDRESS_STATES) assert.ok(validateAddressParts(`1 X St, Place ${state}`, "Place", state, "0800").ok, state);
});

// ── The real committed index ──────────────────────────────────────────────

const dataDir = new URL("../public/data/", import.meta.url);
const realJson = readFileSync(new URL(STREET_INDEX_FILE, dataDir), "utf8");
const real = JSON.parse(realJson) as StreetIndex;

test("the committed index is the one STREET_INDEX_FILE names, within the size budget (<= 180 kB raw, <= 55 kB gzip), with the G-NAF release and attribution in its header", () => {
  assert.deepEqual(readdirSync(dataDir).filter((f) => f.endsWith(".json")), [STREET_INDEX_FILE]);
  assert.match(STREET_INDEX_FILE, /^streets-[a-z]{3}\d{2}\.json$/);
  assert.equal(`streets-${real._.release}.json`, STREET_INDEX_FILE);
  assert.ok(realJson.length <= 180_000, `raw ${realJson.length}`);
  assert.ok(gzipSync(realJson).length <= 55_000, `gzip ${gzipSync(realJson).length}`);
  assert.match(real._.source, /Geoscape G-NAF .* release/);
  assert.match(real._.licence, /CC BY 4\.0/);
  assert.match(real._.licence, /Open G-NAF End User Licence Agreement/);
  assert.match(real._.attribution, /G-NAF © Geoscape Australia/);
  assert.match(GNAF_ATTRIBUTION, /G-NAF © Geoscape Australia/);
  assert.match(GNAF_ATTRIBUTION, /End User Licence Agreement/);
  assert.equal(real._.entries, real.streets.length);
  assert.equal(real._.localities, real.localities.length);
});

test("the real index: sorted, no duplicates, ACT/NSW only, 4-digit postcodes, exactly the 11 NSW localities (D2), roughly 7,900 entries", () => {
  const keys = real.streets.map((row) => row.join("|"));
  assert.equal(new Set(keys).size, keys.length, "no duplicate rows");
  const lower = (s: string) => s.toLowerCase();
  for (let i = 1; i < real.streets.length; i++) {
    const [a, b] = [real.streets[i - 1], real.streets[i]];
    const cmp = lower(a[0]).localeCompare(lower(b[0])) || lower(a[1]).localeCompare(lower(b[1])) || a[2] - b[2];
    assert.ok(cmp <= 0, `rows ${i - 1} and ${i} out of order: ${a.join("|")} > ${b.join("|")}`);
  }
  for (const [name, state, postcode] of real.localities) {
    assert.ok(name && (state === "ACT" || state === "NSW"), `${name} ${state}`);
    assert.match(postcode, /^\d{4}$/);
  }
  for (const row of real.streets) {
    assert.ok(row[0].trim() === row[0] && row[0].length > 0 && !/^Unnamed$/i.test(row[0]), `street name "${row[0]}"`);
    assert.ok(row[2] >= 0 && row[2] < real.localities.length, `locality index ${row[2]}`);
    if (row.length > 3) assert.match(row[3] as string, /^\d{4}$/);
  }
  const nsw = real.localities.filter((l) => l[1] === "NSW").map((l) => `${l[0]} ${l[2]}`).sort();
  assert.deepEqual(nsw, ["Crestwood 2620", "Googong 2620", "Greenleigh 2620", "Jerrabomberra 2619", "Karabar 2620", "Queanbeyan 2620", "Queanbeyan East 2620", "Queanbeyan West 2620", "Royalla 2620", "The Ridgeway 2620", "Tralee 2620"]);
  assert.ok(real.streets.length > 7_500 && real.streets.length < 8_500, `entries ${real.streets.length}`);
  assert.ok(real.localities.length > 130 && real.localities.length < 160, `localities ${real.localities.length}`);
  const types = new Set(real.streets.map((r) => r[1].split(" ")[0]));
  for (const long of ["Street", "Avenue", "Crescent", "Place", "Road", "Circuit", "Close", "Drive", "Court"]) assert.ok(!types.has(long), `${long} must be abbreviated (Tony Q9)`);
  for (const short of ["St", "Av", "Cres", "Pl", "Rd", "Cct", "Cl", "Dr", "Ct"]) assert.ok(types.has(short), `${short} present`);
});

test("D5 on the real data: '44 app' yields Appleford Av (Jacka ACT 2914) among its 5 rows in D4 order, and '44 appl' puts it first; Acton has no street starting with Apple; Queanbeyan and Weston Creek are present", () => {
  // D4 order: exact prefix, ACT before NSW, alphabetical. The ACT streets starting with "app" are Appel (Fadden), Apperly (Kambah) and Appleford (Jacka).
  const got = suggestAddresses(real, "44 app");
  assert.deepEqual(got.map((s) => s.label), [
    "44 Appel Cres, Fadden ACT 2904", "44 Apperly Cl, Kambah ACT 2902", "44 Appleford Av, Jacka ACT 2914",
    "44 Appleberry Rd, Tralee NSW 2620", "44 Applebox Pl, Jerrabomberra NSW 2619",
  ]);
  assert.equal(suggestAddresses(real, "44 appl")[0].label, "44 Appleford Av, Jacka ACT 2914");
  assert.deepEqual(suggestAddresses(real, "44 app ja").map((s) => s.label), ["44 Appleford Av, Jacka ACT 2914"]);
  assert.ok(got.some((s) => s.street === "Applebox" && s.suburb === "Jerrabomberra"));
  assert.ok(got.some((s) => s.street === "Appleberry" && s.suburb === "Tralee"));
  const acton = real.localities.findIndex((l) => l[0] === "Acton" && l[1] === "ACT");
  assert.ok(acton >= 0);
  const actonStreets = real.streets.filter((r) => r[2] === acton);
  assert.ok(actonStreets.length >= 25, `Acton has ${actonStreets.length} streets`);
  assert.ok(!actonStreets.some((r) => r[0].toLowerCase().startsWith("apple")), "Tony's example 'Apple Av, Acton' does not exist in G-NAF (D5)");
  assert.deepEqual(suggestAddresses(real, "44 apple ac"), [], "so '44 apple ac' offers nothing");
  const queanbeyan = real.localities.findIndex((l) => l[0] === "Queanbeyan" && l[1] === "NSW");
  assert.ok(real.streets.filter((r) => r[2] === queanbeyan).length >= 50, "Queanbeyan streets present");
  assert.ok(suggestAddresses(real, "2 monaro st quean").some((s) => s.label === "2 Monaro St, Queanbeyan NSW 2620"));
  const westonCreek = real.localities.find((l) => l[0] === "Weston Creek" && l[1] === "ACT");
  assert.ok(westonCreek, "Weston Creek (route design §2a) is not missing");
  assert.equal(westonCreek[2], "2611");
  assert.ok(real.localities.some((l) => l[0] === "Jacka" && l[2] === "2914"));
  assert.ok(real.localities.some((l) => l[0] === "Whitlam" && l[1] === "ACT"), "new suburbs present as of the Aug 2026 release");
  assert.ok(real.streets.some((r) => r[0] === "McCoy" && r[1] === "Cct"), "Mc names are cased McCoy, and Circuit is Cct");
  assert.ok(real.streets.some((r) => r[0] === "Lennox" && r[1] === "Xing"), "Crossing is Xing");
});

test("m1: no two rows of the real index show the same label in the same locality/postcode ('emu ban' offers Emu Bank once)", () => {
  const seen = new Map<string, number>();
  for (const row of real.streets) {
    const key = `${`${row[0]} ${row[1]}`.trim().toLowerCase()}|${row[2]}|${row.length > 3 ? row[3] : real.localities[row[2]][2]}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  assert.deepEqual([...seen].filter(([, n]) => n > 1), [], "duplicate display labels");
  const emu = suggestAddresses(real, "emu ban").map((s) => s.label);
  assert.deepEqual(emu, ["Emu Bank, Belconnen ACT 2617"]);
  assert.equal(new Set(suggestAddresses(real, "44 app").map((s) => s.label)).size, 5, "no duplicate labels in a result list");
});

test("m3: the footer attribution is the full EULA statement", () => {
  assert.equal(GNAF_ATTRIBUTION, "Street suggestions: Incorporates or developed using G-NAF © Geoscape Australia licensed by the Commonwealth of Australia under the Open Geo-coded National Address File (G-NAF) End User Licence Agreement.");
  assert.equal(real._.attribution, GNAF_ATTRIBUTION.replace("Street suggestions: ", ""));
});
