// Learner intake P3 (design 2026-10-11, D13 + D17 school rule; migration 0013): how an overseas / interstate
// licence changes R2 (Competency 23 eligibility) and "Competency 23 from". Tony's rules (confirmed 2026-10-11/12):
//   interstate LEARNER time counts towards the 12 / 6-month wait (counted from its issue date);
//   interstate or overseas FULL licence held >= 12 months (issue date to drive date) removes the wait;
//   overseas LEARNER does not count; class `other` does not count; the other licence's expiry is never read;
//   hours, HPT and age are still checked. Reminders only, never a pass unless everything is met.
import { test } from "node:test";
import assert from "node:assert/strict";
import { localNow } from "../lib/calc.ts";
import { finalDriveEligibilityReminder, finalDriveEligibleFrom, finalDriveEligibleFromReminder, otherLicenceDataReminder, OTHER_FULL_LICENCE_MONTHS, SCHOOL_RULE_LABEL, type EligibilityLearner, type EligibleFrom } from "../lib/rules.ts";
import { generatedEligibility, ELIGIBILITY_DATE_KEYS } from "../lib/c23-eligibility.ts";
import { otherLicenceLabel, OTHER_LICENCE_HINT } from "../lib/other-licence.ts";

const TODAY = "2026-10-13";
// Under 25, new ACT licence issued 1 Mar 2026 (held 12 months on 1 Mar 2027), hours and HPT met.
const base: EligibilityLearner = {
  dob: "2008-05-06", licenceExpiry: null, learnerLicenceIssuedOn: "2026-03-01", learnerLicenceFirstIssuedOn: null, hptPassedOn: "2026-01-01", loggedHours: 100, loggedHoursOn: "2026-10-01",
  otherLicenceKind: null, otherLicenceClass: null, otherLicenceIssuedOn: null, otherLicencePlace: null,
};
const L = (over: Partial<EligibilityLearner>): EligibilityLearner => ({ ...base, ...over });
const nswLearner = (issuedOn: string | null, over: Partial<EligibilityLearner> = {}) => L({ otherLicenceKind: "interstate", otherLicencePlace: "NSW", otherLicenceClass: "learner", otherLicenceIssuedOn: issuedOn, ...over });
const fullLicence = (kind: "interstate" | "overseas", place: string | null, issuedOn: string | null, over: Partial<EligibilityLearner> = {}) =>
  L({ otherLicenceKind: kind, otherLicencePlace: place, otherLicenceClass: "full", otherLicenceIssuedOn: issuedOn, ...over });
const r2 = (learner: EligibilityLearner, onDate: string) => {
  const r = finalDriveEligibilityReminder(learner, onDate);
  return [r.tone, r.text] as const;
};
const ok = (r: EligibleFrom) => {
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r as Extract<EligibleFrom, { ok: true }>;
};

test("constants and labels: 12 months for a full licence, the school-rule label names Tony, the hint is Tony's sentence", () => {
  assert.equal(OTHER_FULL_LICENCE_MONTHS, 12);
  assert.equal(SCHOOL_RULE_LABEL, "school rule, confirmed by Tony");
  assert.equal(OTHER_LICENCE_HINT, "Interstate learner time counts towards the wait; an interstate or overseas full licence held 12 months removes it; overseas learner licences do not count.");
  assert.equal(otherLicenceLabel({ otherLicenceKind: "interstate", otherLicenceClass: "learner", otherLicencePlace: "NSW" }), "NSW learner licence");
  assert.equal(otherLicenceLabel({ otherLicenceKind: "interstate", otherLicenceClass: "full", otherLicencePlace: "VIC" }), "full VIC licence");
  assert.equal(otherLicenceLabel({ otherLicenceKind: "overseas", otherLicenceClass: "full", otherLicencePlace: "Germany" }), "full licence from Germany");
  assert.equal(otherLicenceLabel({ otherLicenceKind: "overseas", otherLicenceClass: "learner", otherLicencePlace: null }), "overseas learner licence");
  assert.equal(otherLicenceLabel({ otherLicenceKind: "interstate", otherLicenceClass: "full", otherLicencePlace: null }), "interstate full licence");
  assert.equal(otherLicenceLabel({ otherLicenceKind: "overseas", otherLicenceClass: null, otherLicencePlace: "Japan" }), "licence from Japan");
});

// ── (a) interstate LEARNER: the wait is counted from its issue date ──

test("(a) interstate learner: 12 months (under 25) counted from the NSW issue date, one day short then on the day; the ACT date alone would say March 2027", () => {
  const l = nswLearner("2025-10-13");
  assert.deepEqual(r2(L({}), TODAY), ["amber", "Competency 23 not yet: licence held 12 months on 1 Mar 2027."]);
  assert.deepEqual(r2(l, "2026-10-12"), ["amber", "Competency 23 not yet: licence held 12 months on 13 Oct 2026 (counted from the NSW learner licence, school rule)."]);
  assert.deepEqual(r2(l, TODAY), ["plain", "Competency 23 eligibility met per entered data (new licence, under 25 at issue; school rule, confirmed by Tony: licence time counted from the NSW learner licence)."]);
  const from = ok(finalDriveEligibleFrom(l));
  assert.deepEqual([from.date, from.because, from.plus, from.estimated], ["2026-10-13", ["licence 12 months from the NSW learner licence, school rule"], [], false]);
  assert.deepEqual(finalDriveEligibleFromReminder(l, TODAY), { id: "c23-from", tone: "plain", text: "Competency 23 from 13 Oct 2026 (licence 12 months from the NSW learner licence, school rule)." });
  assert.equal(finalDriveEligibleFromReminder(l, "2026-10-12").tone, "amber");
  assert.equal(generatedEligibility(l), "C23 from 2026-10-13");
});

test("(a) interstate learner, 25 or over at the ACT issue: 6 months from the interstate date; 50 hours", () => {
  const over = nswLearner("2026-02-28", { dob: "1990-01-01", loggedHours: 50, loggedHoursOn: "2026-08-01" });
  // 28 Feb + 6 months = 28 Aug 2026.
  assert.deepEqual(r2(over, "2026-08-27"), ["amber", "Competency 23 not yet: licence held 6 months on 28 Aug 2026 (counted from the NSW learner licence, school rule)."]);
  assert.equal(r2(over, "2026-08-28")[0], "plain");
  assert.match(r2(over, "2026-08-28")[1], /25 or over at issue; school rule, confirmed by Tony: licence time counted from the NSW learner licence/);
  assert.equal(ok(finalDriveEligibleFrom(over)).date, "2026-08-28");
  // Month-end clamp (D12): 31 Aug 2025 + 6 months = 1 Mar 2026; leap day 29 Feb 2024 + 12 months = 1 Mar 2025.
  assert.equal(ok(finalDriveEligibleFrom(nswLearner("2025-08-31", { dob: "1990-01-01", learnerLicenceIssuedOn: "2026-01-10" }))).date, "2026-03-01");
  assert.equal(ok(finalDriveEligibleFrom(nswLearner("2024-02-29", { dob: "2005-01-01", learnerLicenceIssuedOn: "2025-01-10" }))).date, "2025-03-01");
});

test("(a) interstate learner with a different age band from the ACT issue date is grey 'Age band unclear', never a pass; same band is fine", () => {
  // 25th birthday 9 Oct 2025: the NSW licence was issued the day before (under 25), the ACT licence on the day (25+).
  const mixed = nswLearner("2025-10-08", { dob: "2000-10-09", learnerLicenceIssuedOn: "2025-10-09", loggedHours: 200 });
  const r = finalDriveEligibilityReminder(mixed, TODAY);
  assert.equal(r.tone, "grey");
  assert.match(r.text, /^Age band unclear: the NSW learner licence and the ACT learner licence were issued in different age bands/);
  const from = finalDriveEligibleFrom(mixed);
  assert.equal(from.ok, false);
  assert.match((from as Extract<EligibleFrom, { ok: false }>).reason, /^Age band unclear/);
  assert.equal(generatedEligibility(mixed), null);
  assert.equal(r2(nswLearner("2025-10-09", { dob: "2000-10-09", learnerLicenceIssuedOn: "2025-10-10" }), TODAY)[0], "plain", "both 25+: 6 months from 9 Oct 2025 = 9 Apr 2026");
});

test("(a) the age-17 condition still applies on top of the interstate time; hours and HPT too", () => {
  const young = nswLearner("2025-01-01", { dob: "2009-12-20", learnerLicenceIssuedOn: "2026-01-10" });
  assert.deepEqual(r2(young, TODAY), ["amber", "Competency 23 not yet: age 17 on 20 Dec 2026."]);
  assert.deepEqual(ok(finalDriveEligibleFrom(young)).because, ["age 17"]);
  assert.deepEqual(r2(nswLearner("2025-10-13", { loggedHours: 99 }), TODAY), ["amber", "Competency 23 not yet: 99 of 100 logged hours (as of 1 Oct 2026)."]);
  assert.deepEqual(r2(nswLearner("2025-10-13", { hptPassedOn: null }), TODAY), ["grey", "Add HPT pass date to check Competency 23 eligibility."]);
  assert.deepEqual(ok(finalDriveEligibleFrom(nswLearner("2025-10-13", { hptPassedOn: null, loggedHours: null }), TODAY)).plus, ["100 h", "HPT"]);
});

// ── (b) interstate or overseas FULL licence held 12 months removes the wait ──

test("(b) full NSW licence: 12 months from its issue date removes the wait (one day short, then on the day); expiry is never read", () => {
  const full = fullLicence("interstate", "NSW", "2025-10-13");
  assert.deepEqual(r2(full, "2026-10-12"), ["amber", "Competency 23 not yet: licence held 12 months on 1 Mar 2027 (the school rule applies from 13 Oct 2026)."]);
  assert.deepEqual(r2(full, TODAY), ["plain", "Competency 23 eligibility met per entered data (new licence, under 25 at issue; school rule, confirmed by Tony: full NSW licence held 12 months on 13 Oct 2026)."]);
  const from = ok(finalDriveEligibleFrom(full));
  assert.deepEqual([from.date, from.because], ["2026-10-13", ["full NSW licence 12 months, school rule"]]);
  assert.equal(finalDriveEligibleFromReminder(full, TODAY).text, "Competency 23 from 13 Oct 2026 (full NSW licence 12 months, school rule).");
  assert.equal(generatedEligibility(full), "C23 from 2026-10-13");
  // An expired or far-future other-licence expiry changes nothing (Q4): the rule ignores it entirely.
  for (const expires of ["2026-01-01", "2040-01-01", null]) {
    const withExpiry = { ...full, otherLicenceExpiresOn: expires } as EligibilityLearner;
    assert.deepEqual(r2(withExpiry, TODAY), r2(full, TODAY), String(expires));
    assert.equal(ok(finalDriveEligibleFrom(withExpiry)).date, "2026-10-13");
  }
});

test("(b) overseas full licence, any country, same 12 months; 25 or over too; leap day 29 Feb + 12 months = 1 Mar", () => {
  const de = fullLicence("overseas", "Germany", "2025-10-13");
  assert.deepEqual(r2(de, "2026-10-12"), ["amber", "Competency 23 not yet: licence held 12 months on 1 Mar 2027 (the school rule applies from 13 Oct 2026)."]);
  assert.deepEqual(r2(de, TODAY), ["plain", "Competency 23 eligibility met per entered data (new licence, under 25 at issue; school rule, confirmed by Tony: full licence from Germany held 12 months on 13 Oct 2026)."]);
  assert.deepEqual(ok(finalDriveEligibleFrom(de)).because, ["full licence from Germany 12 months, school rule"]);
  const older = fullLicence("overseas", "India", "2026-01-10", { dob: "1990-01-01", loggedHours: 50, learnerLicenceIssuedOn: "2026-09-01" });
  // ACT 6 months = 1 Mar 2027; full 12 months = 10 Jan 2027: the school rule wins.
  assert.equal(ok(finalDriveEligibleFrom(older)).date, "2027-01-10");
  assert.deepEqual(r2(older, "2027-01-09"), ["amber", "Competency 23 not yet: licence held 6 months on 1 Mar 2027 (the school rule applies from 10 Jan 2027)."]);
  assert.match(r2(older, "2027-01-10")[1], /25 or over at issue; school rule, confirmed by Tony: full licence from India held 12 months on 10 Jan 2027/);
  const leap = fullLicence("overseas", "France", "2024-02-29", { dob: "2000-01-01", learnerLicenceIssuedOn: "2025-01-10", hptPassedOn: "2024-06-01", loggedHoursOn: "2025-02-01" });
  assert.deepEqual(r2(leap, "2025-02-28"), ["amber", "Competency 23 not yet: licence held 6 months on 10 Jul 2025 (the school rule applies from 1 Mar 2025)."]);
  assert.equal(r2(leap, "2025-03-01")[0], "plain");
});

test("(b) when the ACT wait is met first, the normal result stands with no school-rule wording; the full licence never removes hours, HPT or age", () => {
  const actFirst = fullLicence("interstate", "QLD", "2026-06-01", { learnerLicenceIssuedOn: "2025-06-01" });
  assert.deepEqual(r2(actFirst, TODAY), ["plain", "Competency 23 eligibility met per entered data (new licence, under 25 at issue)."]);
  assert.deepEqual(ok(finalDriveEligibleFrom(actFirst)).because, ["licence 12 months"]);
  assert.deepEqual(r2(fullLicence("interstate", "NSW", "2025-10-13", { loggedHours: 10 }), TODAY), ["amber", "Competency 23 not yet: 10 of 100 logged hours (as of 1 Oct 2026)."]);
  assert.deepEqual(r2(fullLicence("overseas", "Japan", "2025-10-13", { hptPassedOn: "2026-10-14" }), TODAY), ["amber", "Competency 23 not yet: HPT passed on 14 Oct 2026, after this date."]);
  assert.deepEqual(r2(fullLicence("overseas", "Japan", "2020-01-01", { dob: "2009-12-20" }), TODAY), ["amber", "Competency 23 not yet: age 17 on 20 Dec 2026."]);
  assert.deepEqual(ok(finalDriveEligibleFrom(fullLicence("overseas", "Japan", "2020-01-01", { dob: "2009-12-20" }))).because, ["age 17"]);
});

// ── (c) overseas LEARNER and (d) class `other`: the normal ACT wait, with a note ──

test("(c) overseas learner: the normal ACT wait applies with the 'do not count' note, amber then plain", () => {
  const uk = L({ otherLicenceKind: "overseas", otherLicencePlace: "United Kingdom", otherLicenceClass: "learner", otherLicenceIssuedOn: "2020-01-01" });
  assert.deepEqual(r2(uk, TODAY), ["amber", "Competency 23 not yet: licence held 12 months on 1 Mar 2027. Overseas learner licences do not count towards the wait (school rule)."]);
  assert.deepEqual(r2(uk, "2027-03-01"), ["plain", "Competency 23 eligibility met per entered data (new licence, under 25 at issue). Overseas learner licences do not count towards the wait (school rule)."]);
  assert.deepEqual([ok(finalDriveEligibleFrom(uk)).date, ok(finalDriveEligibleFrom(uk)).because], ["2027-03-01", ["licence 12 months"]]);
  assert.equal(otherLicenceDataReminder(uk), null, "nothing to add: the licence is fully described and does not count");
});

test("(d) class `other` (provisional, permit…) does not count, interstate or overseas", () => {
  for (const kind of ["interstate", "overseas"] as const) {
    const p = L({ otherLicenceKind: kind, otherLicencePlace: kind === "interstate" ? "VIC" : "Canada", otherLicenceClass: "other", otherLicenceIssuedOn: "2020-01-01" });
    assert.deepEqual(r2(p, TODAY), ["amber", "Competency 23 not yet: licence held 12 months on 1 Mar 2027. Only an interstate learner licence, or an interstate or overseas full licence, counts (school rule)."], kind);
    assert.equal(ok(finalDriveEligibleFrom(p)).date, "2027-03-01");
    assert.equal(otherLicenceDataReminder(p), null);
  }
});

// ── (e) incomplete details: the ACT wait is still checked, plus a grey "add" line ──

test("(e) class or issue date missing while (a)/(b) could apply: R2 unchanged, otherLicenceDataReminder is the grey line; absent otherwise", () => {
  const grey = { id: "r2-other", tone: "grey", text: "Add the licence type and issue date to check the school rule." };
  const cases: Array<[string, Partial<EligibilityLearner>]> = [
    ["interstate, no class", { otherLicenceKind: "interstate", otherLicencePlace: "NSW" }],
    ["overseas, no class", { otherLicenceKind: "overseas", otherLicencePlace: "Germany" }],
    ["interstate learner, no date", { otherLicenceKind: "interstate", otherLicenceClass: "learner" }],
    ["interstate full, no date", { otherLicenceKind: "interstate", otherLicenceClass: "full" }],
    ["overseas full, no date", { otherLicenceKind: "overseas", otherLicenceClass: "full" }],
    ["overseas full, invalid date", { otherLicenceKind: "overseas", otherLicenceClass: "full", otherLicenceIssuedOn: "2026-02-30" }],
  ];
  for (const [label, over] of cases) {
    const l = L(over);
    assert.deepEqual(otherLicenceDataReminder(l), grey, label);
    assert.deepEqual(r2(l, TODAY), ["amber", "Competency 23 not yet: licence held 12 months on 1 Mar 2027."], label);
    assert.equal(ok(finalDriveEligibleFrom(l)).date, "2027-03-01", label);
  }
  for (const [label, over] of [["not recorded", {}], ["none", { otherLicenceKind: "none" }], ["complete learner", { otherLicenceKind: "interstate", otherLicenceClass: "learner", otherLicenceIssuedOn: "2025-10-13" }], ["complete full", { otherLicenceKind: "overseas", otherLicenceClass: "full", otherLicenceIssuedOn: "2025-10-13" }]] as Array<[string, Partial<EligibilityLearner>]>) {
    assert.equal(otherLicenceDataReminder(L(over)), null, label);
  }
  // The learner fields are optional on EligibilityLearner: older callers without them behave as "not recorded".
  const { otherLicenceKind: _k, otherLicenceClass: _c, otherLicenceIssuedOn: _i, otherLicencePlace: _p, ...legacy } = base;
  void _k; void _c; void _i; void _p;
  assert.deepEqual(r2(legacy, TODAY), r2(L({}), TODAY));
  assert.equal(otherLicenceDataReminder(legacy), null);
});

// ── estimated ACT issue date, old licence, borderline, expiry ──

test("estimated ACT issue date (expiry − 5 years) with an interstate learner licence: the band comes from the estimate, the wait from the interstate date (≈, no range)", () => {
  const est = nswLearner("2025-10-13", { learnerLicenceIssuedOn: null, licenceExpiry: "2031-03-01" });
  const from = ok(finalDriveEligibleFrom(est));
  assert.deepEqual([from.date, from.estimated, from.earliest, from.latest, from.because], ["2026-10-13", true, "2026-10-13", "2026-10-13", ["licence 12 months from the NSW learner licence, school rule"]]);
  assert.equal(finalDriveEligibleFromReminder(est, TODAY).text, "Competency 23 from ≈ 13 Oct 2026 (licence 12 months from the NSW learner licence, school rule; issue date estimated from the licence expiry).");
  assert.equal(generatedEligibility(est), "C23 from ~2026-10-13");
  assert.deepEqual(r2(est, TODAY), ["plain", "Competency 23 eligibility met per entered data (new licence, under 25 at issue; school rule, confirmed by Tony: licence time counted from the NSW learner licence; licence issue date estimated from the licence expiry (1 Mar 2026))."]);
  // A borderline estimate (within 14 days of the 25th birthday) stays borderline: the school rule never hides it.
  const border = nswLearner("2024-01-01", { dob: "2000-10-09", learnerLicenceIssuedOn: null, licenceExpiry: "2030-10-01", loggedHours: 200 });
  assert.match(r2(border, TODAY)[1], /^Borderline, check the licence card/);
  assert.equal(finalDriveEligibleFrom(border).ok, false);
});

test("old ACT licence (before 1 Jan 2020): 5½ months counted from the interstate learner date; a full licence held 12 months still removes that wait", () => {
  const old = nswLearner("2019-01-01", { dob: "2000-01-01", learnerLicenceIssuedOn: "2019-12-01", hptPassedOn: null, loggedHours: null, loggedHoursOn: null });
  // 1 Jan 2019 + 5 months + 16 days = 17 Jun 2019.
  assert.deepEqual(r2(old, "2019-12-02"), ["plain", "Competency 23 eligibility met per entered data (old licence; school rule, confirmed by Tony: licence time counted from the NSW learner licence)."]);
  assert.equal(ok(finalDriveEligibleFrom(old)).date, "2019-06-17");
  const oldFull = fullLicence("overseas", "Japan", "2019-03-01", { dob: "2000-01-01", learnerLicenceIssuedOn: "2019-12-01", hptPassedOn: null, loggedHours: null, loggedHoursOn: null });
  // ACT 5½ months = 17 May 2020; full 12 months = 1 Mar 2020.
  assert.deepEqual(r2(oldFull, "2020-02-29"), ["amber", "Competency 23 not yet: licence held 5½ months on 17 May 2020 (the school rule applies from 1 Mar 2020)."]);
  assert.equal(r2(oldFull, "2020-03-01")[0], "plain");
  assert.equal(ok(finalDriveEligibleFrom(oldFull)).date, "2020-03-01");
});

test("the ACT learner licence must still be current: an expired ACT licence is grey whatever the other licence says; the C23 date must fall before the ACT expiry", () => {
  const expired = fullLicence("interstate", "NSW", "2020-01-01", { licenceExpiry: "2026-10-12" });
  assert.deepEqual(r2(expired, TODAY), ["grey", "Learner licence expired 12 Oct 2026: update the licence details to check Competency 23 eligibility."]);
  assert.equal(finalDriveEligibleFromReminder(expired, TODAY).tone, "amber", "never plain once expired");
  const late = nswLearner("2025-10-13", { licenceExpiry: "2026-10-01" });
  assert.match(finalDriveEligibleFromReminder(late, TODAY).text, /^The learner licence expires 1 Oct 2026, before the Competency 23 date \(13 Oct 2026\)/);
});

test("parity: the day before the computed date R2 is 'not yet', on the date it is met, for every school-rule shape", () => {
  const shapes: EligibilityLearner[] = [
    nswLearner("2025-10-13"),
    nswLearner("2026-02-28", { dob: "1990-01-01", loggedHours: 50, loggedHoursOn: "2026-08-01" }),
    fullLicence("interstate", "NSW", "2025-10-13"),
    fullLicence("overseas", "Germany", "2025-10-13", { dob: "1990-01-01", loggedHours: 50, loggedHoursOn: "2026-08-01" }),
    fullLicence("overseas", "France", "2024-02-29", { dob: "2000-01-01", learnerLicenceIssuedOn: "2025-01-10", hptPassedOn: "2024-06-01", loggedHoursOn: "2025-02-01" }),
    nswLearner("2025-06-01", { dob: "2009-12-20", learnerLicenceIssuedOn: "2026-01-10" }),
  ];
  for (const learner of shapes) {
    const { date } = ok(finalDriveEligibleFrom(learner));
    const dayBefore = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) - 1)).toISOString().slice(0, 10);
    assert.equal(finalDriveEligibilityReminder(learner, dayBefore).tone, "amber", JSON.stringify(learner));
    assert.equal(finalDriveEligibilityReminder(learner, date).tone, "plain", JSON.stringify(learner));
    assert.equal(finalDriveEligibleFromReminder(learner, dayBefore).tone, "amber");
    assert.equal(finalDriveEligibleFromReminder(learner, date).tone, "plain");
  }
});

test("Canberra date boundary (AGENTS §15): the panel's 'today' flips at Canberra midnight, not UTC; the interstate 12 months turns plain at 2026-10-12T13:00Z", () => {
  // 13 Oct 2026 is AEDT (UTC+11): Canberra midnight = 12 Oct 13:00Z.
  assert.equal(localNow(new Date("2026-10-12T12:59:59Z")).date, "2026-10-12");
  assert.equal(localNow(new Date("2026-10-12T13:00:00Z")).date, "2026-10-13");
  const l = nswLearner("2025-10-13");
  assert.equal(finalDriveEligibilityReminder(l, localNow(new Date("2026-10-12T12:59:59Z")).date).tone, "amber");
  assert.equal(finalDriveEligibilityReminder(l, localNow(new Date("2026-10-12T13:00:00Z")).date).tone, "plain");
  // In winter (AEST, UTC+10) the boundary is 14:00Z.
  assert.equal(localNow(new Date("2026-06-30T13:59:00Z")).date, "2026-06-30");
  assert.equal(localNow(new Date("2026-06-30T14:00:00Z")).date, "2026-07-01");
});

test("auto-fill: the kind, type and issue date of the other licence are among the keys that refresh an app-owned Eligibility", () => {
  assert.deepEqual([...ELIGIBILITY_DATE_KEYS], ["dob", "licenceExpiry", "learnerLicenceIssuedOn", "learnerLicenceFirstIssuedOn", "otherLicenceKind", "otherLicenceClass", "otherLicenceIssuedOn"]);
});
