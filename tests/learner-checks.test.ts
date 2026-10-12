import { test } from "node:test";
import assert from "node:assert/strict";
import {
  archivedNotCheckedReminder,
  duplicateLicenceReminder,
  licenceKey,
  missingPdfFields,
  missingPdfReminder,
  PDF_LEARNER_FIELDS,
  sameLicenceLearners,
} from "../lib/learner-checks.ts";
import type { Learner } from "../lib/types.ts";

const TONY = "i-tony";
const ANNA = "i-anna";

function learner(id: string, over: Partial<Learner> = {}): Learner {
  return {
    id,
    instructorId: TONY,
    instructorName: "Tony",
    instructorAdiNumber: null,
    fullName: `QA ${id}`,
    address: "1 QA Street",
    addressSuburb: null,
    addressState: null,
    addressPostcode: null,
    phone: "0400 000 000",
    dob: "2008-01-01",
    licenceNumber: null,
    licenceExpiry: "2030-01-01",
    eligibility: "Yes",
    transmission: "auto",
    schoolWork: "QA School",
    licenceStage: "learner",
    learnerLicenceIssuedOn: null,
    learnerLicenceFirstIssuedOn: null,
    hptPassedOn: null,
    loggedHours: null,
    loggedHoursOn: null,
    archivedAt: null, archiveReason: null, archiveNote: null, transfers: [],
    ...over,
  };
}

test("missingPdfFields: complete learner → nothing missing, no reminder", () => {
  assert.deepEqual(missingPdfFields(learner("a", { licenceNumber: "1234567" })), []);
  assert.equal(missingPdfReminder(learner("a", { licenceNumber: "1234567" }), true), null);
});

test("missingPdfFields: covers exactly the learner fields drawHeader prints, in form order with form labels", () => {
  assert.deepEqual(PDF_LEARNER_FIELDS.map((f) => f.key), ["address", "phone", "dob", "licenceNumber", "licenceExpiry", "eligibility", "schoolWork", "transmission"]);
  const empty = learner("e", { address: null, phone: null, dob: null, licenceNumber: null, licenceExpiry: null, eligibility: null, schoolWork: null, transmission: null });
  assert.deepEqual(missingPdfFields(empty), ["Address", "Phone", "DOB", "Licence number", "Licence expiry", "Eligibility", "School / Work", "Manual / Auto"]);
});

test("missingPdfFields: blank / whitespace-only strings count as missing", () => {
  assert.deepEqual(missingPdfFields(learner("w", { licenceNumber: "1", address: "   ", phone: "" })), ["Address", "Phone"]);
});

test("missingPdfReminder: one amber line; the Edit learner hint only for someone who can edit", () => {
  const l = learner("m", { licenceNumber: null, transmission: null });
  assert.deepEqual(missingPdfReminder(l, true), { id: "pdf-missing", tone: "amber", text: "Missing for the PDF: Licence number, Manual / Auto. Add them with Edit learner." });
  assert.deepEqual(missingPdfReminder(l, false), { id: "pdf-missing", tone: "amber", text: "Missing for the PDF: Licence number, Manual / Auto." });
});

test("licenceKey: trimmed, case-insensitive, inner spaces ignored; empty is empty", () => {
  assert.equal(licenceKey("  ab 12 c\t"), "AB12C");
  assert.equal(licenceKey(""), "");
  assert.equal(licenceKey("   "), "");
  assert.equal(licenceKey(null), "");
  assert.equal(licenceKey(undefined), "");
});

test("sameLicenceLearners: whitespace/case variants match; self is never counted", () => {
  const self = learner("self", { licenceNumber: "ab 123" });
  const other = learner("other", { licenceNumber: " AB123 " });
  const unrelated = learner("x", { licenceNumber: "AB1234" });
  assert.deepEqual(sameLicenceLearners(self.licenceNumber, self.id, [self, other, unrelated]).map((l) => l.id), ["other"]);
  assert.deepEqual(sameLicenceLearners("ab123", "solo", [learner("solo", { licenceNumber: "AB123" })]), []);
});

test("sameLicenceLearners: empty numbers never match (neither side)", () => {
  const noNumber = [learner("a", { licenceNumber: null }), learner("b", { licenceNumber: "" }), learner("c", { licenceNumber: "  " })];
  assert.deepEqual(sameLicenceLearners("", null, noNumber), []);
  assert.deepEqual(sameLicenceLearners("   ", null, noNumber), []);
  assert.deepEqual(sameLicenceLearners(null, null, noNumber), []);
  assert.deepEqual(sameLicenceLearners("123", null, noNumber), []);
});

test("sameLicenceLearners: archived and active both count; multiple matches sorted by name; a learner listed twice counts once", () => {
  const z = learner("z", { fullName: "QA Zed", licenceNumber: "999" });
  const b = learner("b", { fullName: "QA Bee", licenceNumber: "999", archivedAt: "2026-10-01T00:00:00.000Z" });
  const m = learner("m", { fullName: "QA Em", licenceNumber: "9 9 9", instructorId: ANNA, instructorName: "Anna" });
  const found = sameLicenceLearners("999", null, [z, b, m, z]);
  assert.deepEqual(found.map((l) => l.fullName), ["QA Bee", "QA Em", "QA Zed"]);
});

test("duplicateLicenceReminder: none → null", () => {
  assert.equal(duplicateLicenceReminder([], TONY, "panel"), null);
});

test("duplicateLicenceReminder: same instructor, active → just the name (amber)", () => {
  const r = duplicateLicenceReminder([learner("o", { fullName: "QA Other" })], TONY, "panel");
  assert.deepEqual(r, { id: "dup-licence", tone: "amber", text: "Same licence number as QA Other. Check this is not the same learner entered twice." });
});

test("duplicateLicenceReminder: archived and another instructor's learner are named as such; form says it can still be saved", () => {
  const archived = learner("a", { fullName: "QA Arch", archivedAt: "2026-10-01T00:00:00.000Z" });
  const annas = learner("b", { fullName: "QA Annas", instructorId: ANNA, instructorName: "Anna" });
  const both = learner("c", { fullName: "QA Both", instructorId: ANNA, instructorName: "Anna", archivedAt: "2026-10-01T00:00:00.000Z" });
  const r = duplicateLicenceReminder([archived, annas, both], TONY, "form");
  assert.equal(r?.tone, "amber");
  assert.equal(r?.text, "Same licence number as QA Arch (archived), QA Annas (Anna's learner) and QA Both (archived, Anna's learner). Check this is not the same learner entered twice. You can still save.");
});

test("duplicateLicenceReminder: unknown owner (no instructor picked yet) names every instructor", () => {
  const r = duplicateLicenceReminder([learner("o", { fullName: "QA Other" })], null, "form");
  assert.match(r!.text, /^Same licence number as QA Other \(Tony's learner\)\./);
});

test("archivedNotCheckedReminder: grey only while archived learners are not loaded and a number is typed", () => {
  assert.equal(archivedNotCheckedReminder("123", true), null);
  assert.equal(archivedNotCheckedReminder("  ", false), null);
  assert.equal(archivedNotCheckedReminder(null, false), null);
  assert.equal(archivedNotCheckedReminder("123", false)?.tone, "grey");
});
