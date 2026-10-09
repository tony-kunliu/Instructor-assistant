import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysIso, addMonthsClamped, estimateIssueFromExpiry, finalDriveEligibilityReminder, type EligibilityLearner } from "../lib/rules.ts";

// R2, Competency 23 eligibility (NI2020-703 Sch 1 Competency 23; CoP 9.2 k-l). Table-driven from the rule text.
// The "clock" is the `onDate` argument (D13): today in the panel, the draft lesson date in the form. Never Date.now().
//   Old licence (in force before 1 Jan 2020, not renewed): age >= 16y 350d and held >= 5.5 months.
//   New licence, under 25 when issued: 100 hours, held >= 12 months, HPT, age >= 17.
//   New licence, 25 or over when issued: 50 hours, held >= 6 months, HPT.

const TODAY = "2026-10-09";
const base: EligibilityLearner = { dob: "2008-05-06", licenceExpiry: null, learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null };
const L = (over: Partial<EligibilityLearner>): EligibilityLearner => ({ ...base, ...over });
/** New licence, under 25 at issue, everything met on TODAY. */
const newOk = (over: Partial<EligibilityLearner> = {}) => L({ learnerLicenceIssuedOn: "2025-09-01", hptPassedOn: "2026-01-01", loggedHours: 100, loggedHoursOn: "2026-10-01", ...over });

test("date arithmetic D12: months clamp forward, leap days, month ends", () => {
  const cases: Array<[string, number, string]> = [
    ["2025-08-31", 6, "2026-03-01"], ["2025-08-31", 5, "2026-01-31"], ["2024-02-29", 12, "2025-03-01"], ["2024-02-29", 48, "2028-02-29"],
    ["2025-09-30", 5, "2026-03-01"], ["2025-10-31", 1, "2025-12-01"], ["2025-11-30", 1, "2025-12-30"], ["2025-12-15", 1, "2026-01-15"],
    ["2028-02-29", -60, "2023-03-01"], ["2030-02-28", -60, "2025-02-28"], ["2031-03-01", -60, "2026-03-01"], ["2025-01-31", -2, "2024-12-01"],
  ];
  for (const [date, months, expected] of cases) assert.equal(addMonthsClamped(date, months), expected, `${date} + ${months} months`);
  assert.equal(addMonthsClamped("2026-02-30", 1), null);
  assert.equal(addDaysIso("2020-03-01", -1), "2020-02-29");
  assert.equal(addDaysIso("2025-12-31", 1), "2026-01-01");
  assert.equal(estimateIssueFromExpiry("2028-02-29"), "2023-03-01");
  assert.equal(estimateIssueFromExpiry("2030-10-09"), "2025-10-09");
});

test("old learner licence: age 16y 350d (17th birthday minus 15 days) and held 5.5 months (5 months + 16 days), each on its boundary day", () => {
  const old = (over: Partial<EligibilityLearner>) => L({ dob: "2003-03-10", learnerLicenceIssuedOn: "2019-01-01", ...over });
  // 17th birthday 2020-03-10 -> 16y350d on 2020-02-24.
  let r = finalDriveEligibilityReminder(old({}), "2020-02-23");
  assert.equal(r.tone, "amber");
  assert.match(r.text, /^Competency 23 not yet: age 16 years 350 days on 24 Feb 2020\.$/);
  r = finalDriveEligibilityReminder(old({}), "2020-02-24");
  assert.deepEqual([r.tone, r.text], ["plain", "Competency 23 eligibility met per entered data (old licence)."]);
  // 29 Feb birthday: the 17th birthday falls on 1 Mar 2021 in a non-leap year, so 16y350d is 14 Feb 2021.
  assert.match(finalDriveEligibilityReminder(old({ dob: "2004-02-29" }), "2021-02-13").text, /age 16 years 350 days on 14 Feb 2021/);
  assert.equal(finalDriveEligibilityReminder(old({ dob: "2004-02-29" }), "2021-02-14").tone, "plain");
  // Held 5.5 months: issued 2019-06-01 -> 2019-11-01 + 16 days = 2019-11-17.
  const held = old({ dob: "2000-01-01", learnerLicenceIssuedOn: "2019-06-01" });
  assert.match(finalDriveEligibilityReminder(held, "2019-11-16").text, /licence held 5½ months on 17 Nov 2019/);
  assert.equal(finalDriveEligibilityReminder(held, "2019-11-17").tone, "plain");
  // Month end: 30 Sep + 5 months = 30 Feb -> 1 Mar, + 16 days = 17 Mar 2020.
  const monthEnd = old({ dob: "2000-01-01", learnerLicenceIssuedOn: "2019-09-30" });
  assert.match(finalDriveEligibilityReminder(monthEnd, "2020-03-16").text, /licence held 5½ months on 17 Mar 2020/);
  assert.equal(finalDriveEligibilityReminder(monthEnd, "2020-03-17").tone, "plain");
  // Both unmet are listed together.
  assert.match(finalDriveEligibilityReminder(old({ learnerLicenceIssuedOn: "2019-12-01" }), "2020-01-02").text, /^Competency 23 not yet: licence held 5½ months on 17 May 2020; age 16 years 350 days on 24 Feb 2020\.$/);
  // An old licence needs no HPT or hours.
  assert.equal(finalDriveEligibilityReminder(old({ hptPassedOn: null, loggedHours: null }), "2020-02-24").tone, "plain");
  // Renewed old licence: held counts from the first issue when given.
  assert.equal(finalDriveEligibilityReminder(old({ dob: "2000-01-01", learnerLicenceFirstIssuedOn: "2018-01-01", learnerLicenceIssuedOn: "2019-12-01" }), "2020-01-02").tone, "plain");
  assert.equal(finalDriveEligibilityReminder(old({ dob: "2000-01-01", learnerLicenceIssuedOn: "2019-12-01" }), "2020-01-02").tone, "amber");
});

test("the 1 Jan 2020 cut-off: issued 31 Dec 2019 = old, 1 Jan 2020 = new (needs HPT and hours)", () => {
  const issued = (date: string) => L({ dob: "1990-01-01", learnerLicenceIssuedOn: date });
  assert.match(finalDriveEligibilityReminder(issued("2019-12-31"), TODAY).text, /\(old licence\)/);
  assert.equal(finalDriveEligibilityReminder(issued("2019-12-31"), TODAY).tone, "plain");
  const newer = finalDriveEligibilityReminder(issued("2020-01-01"), TODAY);
  assert.deepEqual([newer.tone, newer.text], ["grey", "Add HPT pass date and logged hours to check Competency 23 eligibility."]);
});

test("new licence, under 25 when issued: 100 hours, 12 months, HPT, age 17", () => {
  const met = finalDriveEligibilityReminder(newOk({ learnerLicenceIssuedOn: "2025-10-09" }), TODAY);
  assert.deepEqual([met.tone, met.text], ["plain", "Competency 23 eligibility met per entered data (new licence, under 25 at issue)."]);
  // 12 months held: one day short, then on the day.
  const short = finalDriveEligibilityReminder(newOk({ learnerLicenceIssuedOn: "2025-10-10" }), TODAY);
  assert.deepEqual([short.tone, short.text], ["amber", "Competency 23 not yet: licence held 12 months on 10 Oct 2026."]);
  // 100 / 99 hours.
  assert.equal(finalDriveEligibilityReminder(newOk({ loggedHours: 100 }), TODAY).tone, "plain");
  const hours = finalDriveEligibilityReminder(newOk({ loggedHours: 99 }), TODAY);
  assert.deepEqual([hours.tone, hours.text], ["amber", "Competency 23 not yet: 99 of 100 logged hours (as of 1 Oct 2026)."]);
  // The spec's example wording.
  assert.equal(
    finalDriveEligibilityReminder(newOk({ learnerLicenceIssuedOn: "2025-11-15", loggedHours: 82, loggedHoursOn: "2026-10-03" }), TODAY).text,
    "Competency 23 not yet: 82 of 100 logged hours (as of 3 Oct 2026); licence held 12 months on 15 Nov 2026.",
  );
  // Age 17 on the 17th birthday: dob 2009-10-10 -> 2026-10-10.
  const age = (onDate: string) => finalDriveEligibilityReminder(newOk({ dob: "2009-10-10", learnerLicenceIssuedOn: "2025-10-01" }), onDate);
  assert.match(age("2026-10-09").text, /age 17 on 10 Oct 2026/);
  assert.equal(age("2026-10-09").tone, "amber");
  assert.equal(age("2026-10-10").tone, "plain");
  // Leap-day 12 months: issued 29 Feb 2024 -> 1 Mar 2025.
  const leap = (onDate: string) => finalDriveEligibilityReminder(newOk({ dob: "2000-01-01", learnerLicenceIssuedOn: "2024-02-29", hptPassedOn: "2024-06-01", loggedHoursOn: "2025-02-01" }), onDate);
  assert.match(leap("2025-02-28").text, /licence held 12 months on 1 Mar 2025/);
  assert.equal(leap("2025-03-01").tone, "plain");
  // HPT recorded after the date being checked is not a pass for that date.
  assert.match(finalDriveEligibilityReminder(newOk({ hptPassedOn: "2026-10-09" }), "2026-10-08").text, /HPT passed on 9 Oct 2026, after this date/);
});

test("new licence, 25 or over when issued: 50 hours, 6 months, HPT (no age 17 condition); 25th birthday boundary", () => {
  const over = (over2: Partial<EligibilityLearner>, onDate = "2026-03-01") =>
    finalDriveEligibilityReminder(L({ dob: "1990-01-01", learnerLicenceIssuedOn: "2025-08-31", hptPassedOn: "2025-12-01", loggedHours: 50, loggedHoursOn: "2026-02-01", ...over2 }), onDate);
  // 31 Aug + 6 months = 1 Mar 2026.
  assert.deepEqual([over({}, "2026-03-01").tone, over({}, "2026-03-01").text], ["plain", "Competency 23 eligibility met per entered data (new licence, 25 or over at issue)."]);
  assert.match(over({}, "2026-02-28").text, /licence held 6 months on 1 Mar 2026/);
  assert.equal(over({ loggedHours: 49 }).tone, "amber");
  assert.match(over({ loggedHours: 49 }).text, /49 of 50 logged hours/);
  // 25th birthday 2025-10-09: issued the day before = under 25 (100 hours), on the birthday = 25 (50 hours).
  const at25 = (issued: string) => finalDriveEligibilityReminder(L({ dob: "2000-10-09", learnerLicenceIssuedOn: issued, hptPassedOn: "2026-01-01", loggedHours: 50, loggedHoursOn: "2026-10-01" }), TODAY);
  assert.match(at25("2025-10-08").text, /50 of 100 logged hours/);
  assert.equal(at25("2025-10-09").tone, "plain");
  // 29 Feb birthday: 25th birthday is 1 Mar 2026 in a non-leap year.
  const leapDob = (issued: string) => finalDriveEligibilityReminder(L({ dob: "2000-02-29", learnerLicenceIssuedOn: issued, hptPassedOn: "2025-03-10", loggedHours: 50, loggedHoursOn: "2026-10-01" }), TODAY);
  assert.match(leapDob("2025-02-28").text, /50 of 100/);
  assert.equal(leapDob("2025-03-01").tone, "plain");
});

test("renewed new licence: differing age bands are unclear (grey, never a pass); same band uses the current issue date", () => {
  const renewed = (first: string, current: string) =>
    finalDriveEligibilityReminder(L({ dob: "2000-10-09", learnerLicenceFirstIssuedOn: first, learnerLicenceIssuedOn: current, hptPassedOn: "2026-01-01", loggedHours: 200, loggedHoursOn: "2026-10-01" }), TODAY);
  const unclear = renewed("2025-10-08", "2025-10-09");
  assert.equal(unclear.tone, "grey");
  assert.match(unclear.text, /^Age band unclear for a renewed licence: check the instrument/);
  assert.equal(renewed("2025-09-01", "2025-10-08").tone, "plain");
  assert.equal(renewed("2025-10-09", "2025-10-10").tone, "plain");
});

test("missing data is a neutral add-X note, never a pass", () => {
  const cases: Array<[string, Partial<EligibilityLearner>, string]> = [
    ["nothing at all", { dob: null }, "Add licence issue date, date of birth, HPT pass date and logged hours to check Competency 23 eligibility."],
    ["issue date only unknown, rest present", { hptPassedOn: "2026-01-01", loggedHours: 100, loggedHoursOn: "2026-10-01" }, "Add licence issue date to check Competency 23 eligibility."],
    ["new licence, no HPT", { learnerLicenceIssuedOn: "2025-01-01", loggedHours: 100, loggedHoursOn: "2026-10-01" }, "Add HPT pass date to check Competency 23 eligibility."],
    ["new licence, no hours", { learnerLicenceIssuedOn: "2025-01-01", hptPassedOn: "2026-01-01" }, "Add logged hours to check Competency 23 eligibility."],
    ["hours without a date (old data)", { learnerLicenceIssuedOn: "2025-01-01", hptPassedOn: "2026-01-01", loggedHours: 100 }, "Add logged hours as-of date to check Competency 23 eligibility."],
    ["new licence, no DOB", { dob: null, learnerLicenceIssuedOn: "2025-01-01", hptPassedOn: "2026-01-01", loggedHours: 100, loggedHoursOn: "2026-10-01" }, "Add date of birth to check Competency 23 eligibility."],
    ["old licence, no DOB", { dob: null, learnerLicenceIssuedOn: "2019-01-01" }, "Add date of birth to check Competency 23 eligibility."],
    ["invalid dob string", { dob: "2008-02-30", learnerLicenceIssuedOn: "2019-01-01" }, "Add date of birth to check Competency 23 eligibility."],
  ];
  for (const [label, over, text] of cases) {
    const r = finalDriveEligibilityReminder(L(over), TODAY);
    assert.deepEqual([r.tone, r.text], ["grey", text], label);
  }
  assert.equal(finalDriveEligibilityReminder(newOk(), "").tone, "grey");
  assert.equal(finalDriveEligibilityReminder(newOk({ loggedHoursOn: "2026-10-10" }), TODAY).tone, "grey", "hours recorded after the checked date cannot be checked for it");
});

// ── D21: estimated issue date ──

test("D21: no typed issue date -> estimated from the licence expiry minus 5 years, always labelled, never exact", () => {
  const est = (expiry: string, over: Partial<EligibilityLearner> = {}, onDate = TODAY) =>
    finalDriveEligibilityReminder(newOk({ learnerLicenceIssuedOn: null, licenceExpiry: expiry, ...over }), onDate);
  // Expiry 2030-01-15 -> issued 2025-01-15: 12 months passed long ago, far from every threshold.
  const met = est("2030-01-15");
  assert.deepEqual([met.tone, met.text], ["plain", "Competency 23 eligibility met per entered data (new licence, under 25 at issue; licence issue date estimated from the licence expiry (15 Jan 2025))."]);
  const notYet = est("2030-01-15", { loggedHours: 90 });
  assert.equal(notYet.tone, "amber");
  assert.match(notYet.text, /^Competency 23 not yet: 90 of 100 logged hours \(as of 1 Oct 2026\)\. \(licence issue date estimated from the licence expiry \(15 Jan 2025\)\)$/);
  // A typed issue date overrides the estimate and the label disappears.
  const typed = est("2099-01-01", { learnerLicenceIssuedOn: "2025-10-09" });
  assert.deepEqual([typed.tone, typed.text], ["plain", "Competency 23 eligibility met per entered data (new licence, under 25 at issue)."]);
  // 29 Feb expiry: estimate is 1 Mar 2023 (D12).
  assert.match(est("2028-02-29", { loggedHours: 1 }).text, /issue date estimated from the licence expiry \(1 Mar 2023\)/);
  // Both issue date and expiry empty: neutral note.
  assert.equal(finalDriveEligibilityReminder(newOk({ learnerLicenceIssuedOn: null }), TODAY).text, "Add licence issue date to check Competency 23 eligibility.");
  // Estimate but HPT/hours missing: add-X, not borderline.
  assert.equal(est("2030-01-15", { hptPassedOn: null }).text, "Add HPT pass date to check Competency 23 eligibility.");
});

test("D21 borderline: 12 months held threshold at +/-14 and +/-15 days", () => {
  // onDate 2026-10-09. Estimate E (= expiry - 5y); 12 months held on E + 12m. Result flips if E moves 14 days.
  const run = (expiry: string) => finalDriveEligibilityReminder(newOk({ learnerLicenceIssuedOn: null, licenceExpiry: expiry }), TODAY);
  const border = (expiry: string) => {
    const r = run(expiry);
    assert.equal(r.tone, "amber", expiry);
    assert.match(r.text, /^Borderline, check the licence card:/, expiry);
    assert.match(r.text, /estimated from the licence expiry/, expiry);
  };
  border("2030-09-26"); // held on 2026-09-26: met by 13 days, +14 days flips it
  assert.equal(run("2030-09-25").tone, "plain", "met by 14 days: stable");
  assert.equal(run("2030-09-25").text.includes("Borderline"), false);
  border("2030-10-23"); // held on 2026-10-23: unmet by 14 days, -14 days flips it
  const stable = run("2030-10-24"); // unmet by 15 days: stable "not yet"
  assert.equal(stable.tone, "amber");
  assert.match(stable.text, /^Competency 23 not yet: licence held 12 months on 24 Oct 2026\./);
});

test("D21 borderline: 6 months held and 5.5 months held (old licence) thresholds", () => {
  const six = (expiry: string, onDate = TODAY) =>
    finalDriveEligibilityReminder(L({ dob: "1990-01-01", licenceExpiry: expiry, hptPassedOn: "2025-12-01", loggedHours: 50, loggedHoursOn: "2026-10-01" }), onDate);
  assert.match(six("2031-04-09").text, /^Borderline, check the licence card/); // est 2026-04-09, +6m = onDate exactly
  assert.equal(six("2031-03-26").tone, "plain"); // met by 14 days
  assert.match(six("2031-03-27").text, /^Borderline/); // met by 13 days
  // Old: est 2019-06-15 -> 5 months + 16 days = 2019-12-01.
  const old = (expiry: string, onDate: string) => finalDriveEligibilityReminder(L({ dob: "2000-01-01", licenceExpiry: expiry }), onDate);
  assert.match(old("2024-06-15", "2019-12-01").text, /^Borderline, check the licence card/);
  assert.equal(old("2024-06-01", "2019-12-01").tone, "plain");
  assert.match(old("2024-06-01", "2019-12-01").text, /old licence; licence issue date estimated from the licence expiry \(1 Jun 2019\)/);
});

test("D21 borderline: the 1 Jan 2020 old/new cut-off and the 25th birthday at issue", () => {
  const edge = (expiry: string) => finalDriveEligibilityReminder(L({ dob: "2000-01-01", licenceExpiry: expiry, hptPassedOn: "2020-06-01", loggedHours: 100, loggedHoursOn: "2024-05-01" }), "2024-06-01");
  assert.match(edge("2025-01-14").text, /^Borderline/);
  assert.equal(edge("2025-01-15").tone, "plain");
  assert.match(edge("2025-01-15").text, /new licence/);
  // Estimate 2020-01-14: -14 days is 2019-12-31 (old), so borderline; estimate 2020-01-15: -14 days is 2020-01-01 (new), stable.
  // From the other side: est 2019-12-18 + 14 days = 2020-01-01 (new): borderline; est 2019-12-17 + 14 = 2019-12-31 (old): stable.
  assert.match(edge("2024-12-18").text, /^Borderline/);
  assert.equal(edge("2024-12-17").tone, "plain");
  assert.match(edge("2024-12-17").text, /old licence/);
  // 25th birthday (2025-10-09) at issue.
  const age25 = (expiry: string) => finalDriveEligibilityReminder(L({ dob: "2000-10-09", licenceExpiry: expiry, hptPassedOn: "2026-01-01", loggedHours: 100, loggedHoursOn: "2026-10-01" }), TODAY);
  assert.match(age25("2030-10-22").text, /^Borderline/); // est = 2025-10-22, -14 days = 2025-10-08, the day before the 25th birthday
  assert.equal(age25("2030-10-23").tone, "plain");
  assert.match(age25("2030-10-23").text, /25 or over at issue/);
  assert.match(age25("2030-09-25").text, /^Borderline/); // est 2025-09-25, +14 days = 2025-10-09
  assert.equal(age25("2030-09-24").tone, "plain");
  assert.match(age25("2030-09-24").text, /under 25 at issue/);
});

test("D21: a borderline result is never a pass, even when every reading of the estimate would otherwise pass", () => {
  for (const expiry of ["2030-09-26", "2030-09-30", "2030-10-05"]) {
    const r = finalDriveEligibilityReminder(newOk({ learnerLicenceIssuedOn: null, licenceExpiry: expiry, loggedHours: 500 }), TODAY);
    assert.notEqual(r.tone, "plain", expiry);
  }
});

test("I1: an expired learner licence is never a pass (grey), for estimates and typed issue dates; expiry day itself is current", () => {
  const exp = "Learner licence expired 1 Jun 2024: update the licence details to check Competency 23 eligibility.";
  const empty = finalDriveEligibilityReminder(newOk({ learnerLicenceIssuedOn: null, licenceExpiry: "2024-06-01" }), TODAY);
  assert.deepEqual([empty.tone, empty.text], ["grey", exp]);
  const typed = finalDriveEligibilityReminder(newOk({ licenceExpiry: "2024-06-01" }), TODAY);
  assert.deepEqual([typed.tone, typed.text], ["grey", exp]);
  assert.equal(finalDriveEligibilityReminder(newOk({ learnerLicenceIssuedOn: "2025-09-01", licenceExpiry: TODAY }), TODAY).tone, "plain", "expiry on the checking date is still current");
  assert.equal(finalDriveEligibilityReminder(newOk({ licenceExpiry: "2026-10-10" }), TODAY).tone, "plain", "expiry tomorrow");
  assert.equal(finalDriveEligibilityReminder(newOk({ licenceExpiry: "2026-10-08" }), TODAY).tone, "grey", "expired yesterday");
});
