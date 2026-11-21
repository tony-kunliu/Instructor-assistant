import assert from "node:assert/strict";
import test from "node:test";
import { mergeLicenceScan, parseLearnerLicence } from "../lib/learner-licence-text.ts";

test("a labelled Australian learner card proposes existing form values only", () => {
  const result = parseLearnerLicence(`ACT LEARNER DRIVER LICENCE
Name: Jamie Example
Address:
41 Sample Street
Belconnen ACT 2617
Licence No: 01234567
Card number: 876543211
DOB: 19 Sep 2007
Expiry date: 28/11/2030
Phone: 0412 000 000
Signature: not a field`);
  assert.deepEqual(result, {
    fullName: "Jamie Example", address: "41 Sample Street Belconnen ACT 2617",
    licenceNumber: "01234567", dob: "2007-09-19", licenceExpiry: "2030-11-28",
  });
});

test("an ACT learner card can have unlabelled name and address and split label/value lines", () => {
  assert.deepEqual(parseLearnerLicence(`DRIVER LICENCE
SAMPLESON JAMIE CHEN
12 Fiction Road
Forde ACT 2914
LIC NO.
12345678
DOB
18.04.2006
EXPIRES
3 JUN 2030`), {
    fullName: "SAMPLESON JAMIE CHEN", address: "12 Fiction Road Forde ACT 2914",
    licenceNumber: "12345678", dob: "2006-04-18", licenceExpiry: "2030-06-03",
  });
});

test("identifies separately labelled given and family names, including accents", () => {
  assert.deepEqual(parseLearnerLicence("SURNAME: O’Léary\nGiven names: Yuk-Ching Mei"), { fullName: "Yuk-Ching Mei O’Léary" });
});

test("does not substitute a card number or a guessed date; ignores contradictory candidates", () => {
  assert.deepEqual(parseLearnerLicence("Card no: 12345678\nDOB: 31/02/2007\nDate issued: 1/7/2025"), {});
  assert.deepEqual(parseLearnerLicence("Licence no: 12345678\nLicence no: 01234567"), {});
  assert.deepEqual(parseLearnerLicence("DOB: 19 Sep 2007\nExpiry: 18 Sep 2007"), { dob: "2007-09-19" });
  assert.deepEqual(parseLearnerLicence("Keep left at school\n8 Sample Way\nBelconnen ACT 2617"), {});
});

test("scans fill only empty fields and preserve the assigned instructor and manual edits", () => {
  const draft = { fullName: "Corrected Name", address: "", dob: "", licenceNumber: "OLD", licenceExpiry: "", instructorId: "adi" };
  assert.deepEqual(mergeLicenceScan(draft, { fullName: "Misread Name", address: "41 Sample Street Belconnen ACT 2617", licenceNumber: "12345678" }), {
    ...draft, address: "41 Sample Street Belconnen ACT 2617",
  });
});

test("handles ACT specimen layout, compact dates and adjacent fields with a trailing card ID", () => {
  const shared = `DRIVER LICENCE
AUSTRALIAN CAPITAL TERRITORY
JAMIE EXAMPLE
41 Fiction Street Belconnen ACT 2617 987654321
DOB: 19SEP2007`;
  for (const row of ["LICENCE NO 01234567 EXPIRY 28NOV2030", "LICENCE NO  EXPIRY DATE\n01234567  28NOV2030",
    "Licence No. 01234567 Licence Expiry 28NOV2030", "Licence No. Licence Expiry\n01234567 28NOV2030"]) {
    assert.deepEqual(parseLearnerLicence(`${shared}\n${row}`), {
      fullName: "JAMIE EXAMPLE", address: "41 Fiction Street Belconnen ACT 2617",
      licenceNumber: "01234567", dob: "2007-09-19", licenceExpiry: "2030-11-28",
    });
  }
  for (const cardId of ["987654321", "987 654 321", "9 8 7 6 5 4 3 2 1", "987-654-321", "987.654.321"]) {
    assert.deepEqual(parseLearnerLicence(`Address: 41 Fiction Street ${cardId} Belconnen ACT 2617`), {});
  }
  assert.equal(parseLearnerLicence("Address: Unit 14/25 Fiction Street Belconnen ACT 2617").address,
    "Unit 14/25 Fiction Street Belconnen ACT 2617");
  assert.deepEqual(parseLearnerLicence("Address: 41 Fiction Street Belconnen ACT 2617 Card number: 987654321"), {
    address: "41 Fiction Street Belconnen ACT 2617",
  });
});
