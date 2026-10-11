import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { addDaysIso, finalDriveEligibilityReminder, finalDriveEligibleFrom, finalDriveEligibleFromReminder, type EligibilityLearner, type EligibleFrom } from "../lib/rules.ts";
import { autoFillEligibility, GENERATED_ELIGIBILITY, generatedEligibility, isAppOwnedEligibility, pdfEligibility } from "../lib/c23-eligibility.ts";
import { buildCbtaChecklistPdf, createMeasurer } from "../lib/pdf-export.ts";
import { HEADER_FIELDS } from "../lib/pdf-layout.ts";
import type { Learner, Lesson } from "../lib/types.ts";

// Learner intake P1 (design 2026-10-11, D17-D18): "Competency 23 eligible from" and the PDF Eligibility auto-fill.
// Date-only arithmetic throughout (no time zone, no DST). Synthetic data only.

const TODAY = "2026-10-11";
const base: EligibilityLearner = { dob: "2008-05-06", licenceExpiry: null, learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null };
const L = (over: Partial<EligibilityLearner>): EligibilityLearner => ({ ...base, ...over });
const ok = (r: EligibleFrom) => {
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return r as Extract<EligibleFrom, { ok: true }>;
};
const reason = (r: EligibleFrom) => {
  assert.equal(r.ok, false, "expected no date");
  return (r as Extract<EligibleFrom, { ok: false }>).reason;
};

test("under 25 at issue: issue + 12 months, and not before the 17th birthday", () => {
  const licence = ok(finalDriveEligibleFrom(L({ learnerLicenceIssuedOn: "2025-11-15" })));
  assert.deepEqual([licence.date, licence.because, licence.plus, licence.estimated], ["2026-11-15", ["licence 12 months"], ["100 h", "HPT"], false]);
  const r = finalDriveEligibleFromReminder(L({ learnerLicenceIssuedOn: "2025-11-15" }), TODAY);
  assert.deepEqual([r.id, r.tone, r.text], ["c23-from", "amber", "Competency 23 from 15 Nov 2026 (licence 12 months; plus 100 h and HPT)."]);
  // The 17th birthday is later than 12 months.
  const age = ok(finalDriveEligibleFrom(L({ dob: "2009-12-20", learnerLicenceIssuedOn: "2025-06-01" })));
  assert.deepEqual([age.date, age.because], ["2026-12-20", ["age 17"]]);
  // Both on the same day.
  assert.deepEqual(ok(finalDriveEligibleFrom(L({ dob: "2009-06-01", learnerLicenceIssuedOn: "2025-06-01" }))).because, ["licence 12 months", "age 17"]);
});

test("25 or over at issue: issue + 6 months, 50 h, no age condition; exactly 25 vs 24 years 364 days", () => {
  const at25 = ok(finalDriveEligibleFrom(L({ dob: "2000-10-09", learnerLicenceIssuedOn: "2025-10-09" })));
  assert.deepEqual([at25.date, at25.because, at25.plus, at25.kind], ["2026-04-09", ["licence 6 months"], ["50 h", "HPT"], "new licence, 25 or over at issue"]);
  const day364 = ok(finalDriveEligibleFrom(L({ dob: "2000-10-09", learnerLicenceIssuedOn: "2025-10-08" })));
  assert.deepEqual([day364.date, day364.plus, day364.kind], ["2026-10-08", ["100 h", "HPT"], "new licence, under 25 at issue"]);
});

test("leap-day birthdays and month-end additions clamp forward (D12)", () => {
  // 17th birthday of 29 Feb 2008 is 1 Mar 2025.
  assert.deepEqual(ok(finalDriveEligibleFrom(L({ dob: "2008-02-29", learnerLicenceIssuedOn: "2024-01-15" }))).date, "2025-03-01");
  // 25th birthday of 29 Feb 2000 is 1 Mar 2025: issued 28 Feb = under 25, 1 Mar = 25.
  assert.deepEqual(ok(finalDriveEligibleFrom(L({ dob: "2000-02-29", learnerLicenceIssuedOn: "2025-02-28" }))).date, "2026-02-28");
  assert.deepEqual(ok(finalDriveEligibleFrom(L({ dob: "2000-02-29", learnerLicenceIssuedOn: "2025-03-01" }))).date, "2025-09-01");
  // 31 Aug + 6 months = 1 Mar; 29 Feb + 12 months = 1 Mar.
  assert.equal(ok(finalDriveEligibleFrom(L({ dob: "1990-01-01", learnerLicenceIssuedOn: "2025-08-31" }))).date, "2026-03-01");
  assert.equal(ok(finalDriveEligibleFrom(L({ dob: "2000-01-01", learnerLicenceIssuedOn: "2024-02-29" }))).date, "2025-03-01");
});

test("old licence (issued before 1 Jan 2020): 5½ months held (from the first issue if given) and 16 years 350 days; no hours or HPT", () => {
  const old = ok(finalDriveEligibleFrom(L({ dob: "2003-03-10", learnerLicenceIssuedOn: "2019-01-01" })));
  assert.deepEqual([old.date, old.because, old.plus, old.kind], ["2020-02-24", ["age 16 years 350 days"], [], "old licence"]);
  const held = ok(finalDriveEligibleFrom(L({ dob: "2000-01-01", learnerLicenceFirstIssuedOn: "2018-01-01", learnerLicenceIssuedOn: "2019-12-01" })));
  assert.deepEqual([held.date, held.because], ["2018-06-17", ["licence 5½ months"]]);
  assert.equal(ok(finalDriveEligibleFrom(L({ dob: "2000-01-01", learnerLicenceIssuedOn: "2019-12-01" }))).date, "2020-05-17");
  // The 1 Jan 2020 boundary.
  assert.equal(ok(finalDriveEligibleFrom(L({ dob: "2000-01-01", learnerLicenceIssuedOn: "2019-12-31" }))).kind, "old licence");
  assert.equal(ok(finalDriveEligibleFrom(L({ dob: "2000-01-01", learnerLicenceIssuedOn: "2020-01-01" }))).kind, "new licence, under 25 at issue");
});

test("estimated issue date (expiry − 5 years): ≈ with the ±14-day range, ~ in the PDF value", () => {
  const est = L({ licenceExpiry: "2030-11-15" });
  const r = ok(finalDriveEligibleFrom(est));
  assert.deepEqual([r.date, r.estimated, r.earliest, r.latest], ["2026-11-15", true, "2026-11-01", "2026-11-29"]);
  assert.equal(finalDriveEligibleFromReminder(est, TODAY).text, "Competency 23 from ≈ 15 Nov 2026, between 1 and 29 Nov (licence 12 months; issue date estimated from the licence expiry; plus 100 h and HPT).");
  assert.equal(generatedEligibility(est), "C23 from ~2026-11-15");
  // Range across two months.
  assert.match(finalDriveEligibleFromReminder(L({ licenceExpiry: "2030-11-05" }), TODAY).text, /^Competency 23 from ≈ 5 Nov 2026, between 22 Oct and 19 Nov \(/);
  // Range across a year end.
  assert.match(finalDriveEligibleFromReminder(L({ licenceExpiry: "2031-01-03" }), TODAY).text, /^Competency 23 from ≈ 3 Jan 2027, between 20 Dec 2026 and 17 Jan 2027 \(/);
  // The 17th birthday decides in every reading: no range, still marked as estimated.
  const ageWins = L({ dob: "2009-12-20", licenceExpiry: "2030-06-01" });
  assert.equal(finalDriveEligibleFromReminder(ageWins, TODAY).text, "Competency 23 from ≈ 20 Dec 2026 (age 17; issue date estimated from the licence expiry; plus 100 h and HPT).");
  assert.equal(generatedEligibility(ageWins), "C23 from ~2026-12-20");
  // A typed issue date wins over the estimate.
  assert.equal(generatedEligibility(L({ licenceExpiry: "2030-11-15", learnerLicenceIssuedOn: "2025-11-20" })), "C23 from 2026-11-20");
});

test("never a false date: borderline estimates, missing DOB, unclear band, inconsistent or expiring licence give a grey reason", () => {
  const grey = (learner: EligibilityLearner) => {
    const r = finalDriveEligibleFromReminder(learner, TODAY);
    assert.equal(r.tone, "grey", r.text);
    assert.equal(generatedEligibility(learner), null);
    return r.text;
  };
  // Estimate within 14 days of 1 Jan 2020 (old/new) or of the 25th birthday (band).
  assert.match(grey(L({ licenceExpiry: "2025-01-05" })), /^Borderline: the licence issue date estimated from the licence expiry \(5 Jan 2020\) could be a few days out/);
  assert.match(grey(L({ dob: "2000-10-09", licenceExpiry: "2030-10-01" })), /^Borderline:/);
  assert.equal(grey(L({ dob: null, learnerLicenceIssuedOn: "2025-01-01" })), "Add date of birth to work out the Competency 23 date.");
  assert.equal(grey(L({ dob: "2008-02-30", learnerLicenceIssuedOn: "2025-01-01" })), "Add date of birth to work out the Competency 23 date.");
  assert.equal(grey(L({ dob: null })), "Add the licence issue date (or expiry) and date of birth to work out the Competency 23 date.");
  assert.equal(grey(L({})), "Add the licence issue date (or expiry) to work out the Competency 23 date.");
  assert.match(grey(L({ dob: "2000-10-09", learnerLicenceFirstIssuedOn: "2025-10-08", learnerLicenceIssuedOn: "2025-10-09" })), /^Age band unclear for a renewed licence/);
  assert.match(grey(L({ learnerLicenceFirstIssuedOn: "2025-12-01", learnerLicenceIssuedOn: "2025-11-01" })), /^Licence dates look inconsistent/);
  assert.match(grey(L({ learnerLicenceIssuedOn: "2025-11-15", licenceExpiry: "2026-06-01" })), /^The learner licence expires 1 Jun 2026, before the Competency 23 date \(15 Nov 2026\)/);
  assert.equal(reason(finalDriveEligibleFrom(L({ dob: null, licenceExpiry: "2030-01-01" }))), "Add date of birth to work out the Competency 23 date.");
});

test("hours and HPT: listed as 'plus …' until met per the entered data; plain only when the date has passed and nothing is left", () => {
  const issued = (over: Partial<EligibilityLearner>) => L({ learnerLicenceIssuedOn: "2025-09-01", ...over });
  const plus = (over: Partial<EligibilityLearner>) => ok(finalDriveEligibleFrom(issued(over))).plus;
  assert.deepEqual(plus({}), ["100 h", "HPT"]);
  assert.deepEqual(plus({ hptPassedOn: "2026-01-01" }), ["100 h"]);
  assert.deepEqual(plus({ loggedHours: 100, loggedHoursOn: "2026-10-01" }), ["HPT"]);
  assert.deepEqual(plus({ loggedHours: 99, loggedHoursOn: "2026-10-01", hptPassedOn: "2026-01-01" }), ["100 h"]);
  assert.deepEqual(plus({ loggedHours: 100, hptPassedOn: "2026-01-01" }), ["100 h"], "hours without an as-of date are not counted as met");
  assert.deepEqual(plus({ loggedHours: 100, loggedHoursOn: "2026-10-01", hptPassedOn: "2026-01-01" }), []);
  assert.deepEqual(plus({ dob: "1990-01-01", loggedHours: 50, loggedHoursOn: "2026-10-01", hptPassedOn: "2026-01-01" }), [], "25 or over needs 50 h");
  assert.deepEqual(plus({ dob: "1990-01-01", loggedHours: 49, loggedHoursOn: "2026-10-01" }), ["50 h", "HPT"]);

  const all = issued({ loggedHours: 100, loggedHoursOn: "2026-10-01", hptPassedOn: "2026-01-01" });
  const met = finalDriveEligibleFromReminder(all, TODAY);
  assert.deepEqual([met.tone, met.text], ["plain", "Competency 23 from 1 Sep 2026 (licence 12 months)."]);
  assert.equal(finalDriveEligibleFromReminder(all, "2026-08-31").tone, "amber", "date still ahead");
  assert.equal(finalDriveEligibleFromReminder(issued({ hptPassedOn: "2026-01-01" }), TODAY).tone, "amber", "hours still missing");
  assert.equal(finalDriveEligibleFromReminder({ ...all, licenceExpiry: "2026-10-10" }, TODAY).tone, "amber", "an expired licence is never plain");
  // An estimate is plain only when the latest reading has passed.
  assert.equal(finalDriveEligibleFromReminder(L({ licenceExpiry: "2030-10-05", loggedHours: 100, loggedHoursOn: "2026-10-01", hptPassedOn: "2026-01-01" }), TODAY).tone, "amber");
  assert.equal(finalDriveEligibleFromReminder(L({ licenceExpiry: "2030-09-20", loggedHours: 100, loggedHoursOn: "2026-10-01", hptPassedOn: "2026-01-01" }), TODAY).tone, "plain");
});

test("consistent with R2: the day before the date R2 is not yet met, on the date R2 is met (unchanged R2 verdicts)", () => {
  const cases: Array<Partial<EligibilityLearner>> = [
    { learnerLicenceIssuedOn: "2025-11-15" },
    { dob: "2009-12-20", learnerLicenceIssuedOn: "2025-06-01" },
    { dob: "2000-10-09", learnerLicenceIssuedOn: "2025-10-09" },
    { dob: "2000-10-09", learnerLicenceIssuedOn: "2025-10-08" },
    { dob: "2008-02-29", learnerLicenceIssuedOn: "2024-01-15" },
    { dob: "1990-01-01", learnerLicenceIssuedOn: "2025-08-31" },
    { dob: "2003-03-10", learnerLicenceIssuedOn: "2019-01-01" },
    { dob: "2000-01-01", learnerLicenceFirstIssuedOn: "2018-01-01", learnerLicenceIssuedOn: "2019-12-01" },
  ];
  for (const over of cases) {
    const learner = L({ hptPassedOn: "2017-01-01", loggedHours: 120, loggedHoursOn: "2017-01-01", ...over });
    const { date } = ok(finalDriveEligibleFrom(learner));
    const label = JSON.stringify(over);
    assert.equal(finalDriveEligibilityReminder(learner, addDaysIso(date, -1) as string).tone, "amber", label);
    assert.equal(finalDriveEligibilityReminder(learner, date).tone, "plain", label);
  }
});

test("auto-fill ownership: empty or generated follows the dates; the instructor's own text is never overwritten", () => {
  assert.ok(GENERATED_ELIGIBILITY.test("C23 from 2026-11-15"));
  assert.ok(GENERATED_ELIGIBILITY.test("C23 from ~2026-11-15"));
  for (const own of ["Eligible", "C23 from 2026-11-15 (checked)", "c23 from 2026-11-15", " C23 from 2026-11-15", "C23 from 15 Nov 2026", "C23 from ≈2026-11-15"]) {
    assert.equal(GENERATED_ELIGIBILITY.test(own), false, own);
    assert.equal(isAppOwnedEligibility(own), false, own);
  }
  const first = L({ learnerLicenceIssuedOn: "2025-11-15" });
  // Empty → generated.
  const filled = autoFillEligibility("", first);
  assert.equal(filled, "C23 from 2026-11-15");
  // Regenerated after the issue date changes (still app-owned).
  assert.equal(autoFillEligibility(filled, { ...first, learnerLicenceIssuedOn: "2025-12-01" }), "C23 from 2026-12-01");
  // A stale estimate is refreshed to the exact date once the issue date is typed.
  assert.equal(autoFillEligibility("C23 from ~2026-01-01", first), "C23 from 2026-11-15");
  // Manual text stays, even with a computable date.
  assert.equal(autoFillEligibility("Eligible per Tony", first), "Eligible per Tony");
  // Cleared when no date can be worked out (only while app-owned); blank counts as empty.
  assert.equal(autoFillEligibility("C23 from 2026-11-15", L({ dob: null, learnerLicenceIssuedOn: "2025-11-15" })), "");
  assert.equal(autoFillEligibility("   ", first), "C23 from 2026-11-15");
  assert.equal(autoFillEligibility("Manual", L({ dob: null })), "Manual");
});

test("PDF Eligibility value: recomputed at export while empty or generated, own text unchanged, empty when not computable", () => {
  const withElig = (eligibility: string | null, over: Partial<EligibilityLearner> = {}) => ({ ...L({ learnerLicenceIssuedOn: "2025-11-15", ...over }), eligibility });
  assert.equal(pdfEligibility(withElig(null)), "C23 from 2026-11-15");
  assert.equal(pdfEligibility(withElig("")), "C23 from 2026-11-15");
  assert.equal(pdfEligibility(withElig("C23 from 2026-01-01")), "C23 from 2026-11-15", "stale generated value refreshed");
  assert.equal(pdfEligibility(withElig("Eligible")), "Eligible");
  assert.equal(pdfEligibility(withElig(null, { dob: null })), "");
  assert.equal(pdfEligibility(withElig("C23 from 2026-01-01", { dob: null })), "", "a generated value that can no longer be computed is not printed");
  assert.equal(pdfEligibility(withElig(null, { learnerLicenceIssuedOn: null, licenceExpiry: "2030-11-15" })), "C23 from ~2026-11-15");
});

const subsetFont = readFileSync(new URL("../public/fonts/NotoSansSC-Subset.otf", import.meta.url));
const templateBytes = readFileSync(new URL("../public/pdf-template/adi-cbta-checklist.pdf", import.meta.url));

test("generated value fits the 94-pt Eligibility box at 8 pt and every character is in the compact font", () => {
  const box = HEADER_FIELDS.eligibility;
  const measurer = createMeasurer(subsetFont);
  const widest = "C23 from ~2088-08-28";
  assert.ok(measurer.widthOfTextAtSize(widest, 8) <= box.x1 - box.x0 - 4, `${measurer.widthOfTextAtSize(widest, 8)} pt`);
  const f = fontkit.create(subsetFont as unknown as Buffer);
  for (const ch of "C23 from ~0123456789-") assert.ok(f.hasGlyphForCodePoint(ch.codePointAt(0)!), `U+${ch.codePointAt(0)!.toString(16)} ${ch}`);
});

const pdfLearner: Learner = {
  id: "learner-qa", instructorId: "instructor-1", instructorName: "QA Instructor", instructorAdiNumber: "ADI-9", fullName: "QA Eligible From",
  address: "1 QA St", phone: "0400 000 000", dob: "2008-05-06", licenceNumber: "QA1", licenceExpiry: "2030-11-15", eligibility: null,
  transmission: "auto", schoolWork: null, licenceStage: "learner", learnerLicenceIssuedOn: null, learnerLicenceFirstIssuedOn: null, hptPassedOn: null, loggedHours: null, loggedHoursOn: null,
  archivedAt: null, archiveReason: null, archiveNote: null,
};
const pdfLesson: Lesson = {
  id: "lesson-1", learnerId: "learner-qa", instructorId: "instructor-1", lessonNo: 1, lessonDate: "2026-01-01", startTime: "09:00", finishTime: "09:30",
  startOdometer: 10, finishOdometer: 15, durationMinutes: 30, distanceKm: 5, cumulativeMinutes: 30, cumulativeKm: 5,
  taught: "1", competenciesAssessed: null, achieved: null, location: "QA", comments: null, adiSignature: null, learnerSignature: null,
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: null, updatedByInstructorId: null, updatedByInstructorName: null, recordSource: "app",
  signatureStatus: "unsigned", priorInstructorLabel: null, priorLessonCount: null, revisionCount: 0, editedBeforeRevisionHistory: false,
};

function pdfText(t: TestContext, bytes: Uint8Array): string | null {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), "c23-from-")), "out.pdf");
  writeFileSync(file, bytes);
  try {
    return execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    if (process.env.REQUIRE_POPPLER === "1") assert.fail("pdftotext (poppler-utils) is required");
    t.skip("pdftotext (poppler-utils) not installed: the header text check was skipped");
    return null;
  }
}

test("PDF header: Eligibility prints the generated value with the compact font; the instructor's own text prints unchanged", async (t) => {
  const build = (learner: Learner) => buildCbtaChecklistPdf({ templateBytes, fontBytes: subsetFont, learner, lessons: [pdfLesson] });
  const auto = await build(pdfLearner);
  assert.deepEqual([auto.unsupportedChars, auto.embeddedFont, auto.fullFontStatus], [[], "compact", "not-needed"]);
  const own = await build({ ...pdfLearner, eligibility: "QA own text" });
  const autoText = pdfText(t, auto.bytes);
  if (autoText === null) return;
  assert.match(autoText, /C23 from ~2026-11-15/);
  const ownText = pdfText(t, own.bytes) as string;
  assert.match(ownText, /QA own text/);
  assert.doesNotMatch(ownText, /C23 from/);
});
