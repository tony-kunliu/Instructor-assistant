import { test } from "node:test";
import assert from "node:assert/strict";
import { instructorLabel } from "../lib/instructor-label.ts";

const base = { id: "x", status: "active" as const };

test("Tony and Anna get their full picker labels with ADI numbers", () => {
  assert.equal(instructorLabel({ ...base, fullName: "Tony", email: "Kunliu.work@gmail.com", adiNumber: "604" }), "Tony/Kun Liu (ADI604)");
  assert.equal(instructorLabel({ ...base, fullName: "Anna", email: "yapingqu.work@gmail.com", adiNumber: "358" }), "Anna/Yaping Qu (ADI358)");
});

test("email match is case-insensitive; an ADI number already written as ADI604 is not doubled", () => {
  assert.equal(instructorLabel({ ...base, fullName: "Tony", email: "KUNLIU.WORK@GMAIL.COM", adiNumber: "ADI604" }), "Tony/Kun Liu (ADI604)");
});

test("a missing ADI number leaves the name without brackets", () => {
  assert.equal(instructorLabel({ ...base, fullName: "Anna", email: "yapingqu.work@gmail.com", adiNumber: null }), "Anna/Yaping Qu");
});

test("any other instructor keeps its stored name", () => {
  assert.equal(instructorLabel({ ...base, fullName: "ADI604", email: null, adiNumber: null }), "ADI604");
});
