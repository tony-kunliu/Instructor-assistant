import { test } from "node:test";
import assert from "node:assert/strict";
import { ACT_PUBLIC_HOLIDAYS, COVERED_YEARS, lookupActHoliday } from "../lib/act-public-holidays.ts";

// Shape checks only. No test here reads the clock, so nothing fails because a calendar date passed
// (the yearly update is a BACKLOG item: see the header of lib/act-public-holidays.ts).

test("holiday table: valid dates, sorted, no duplicates, every date inside a covered year, names set", () => {
  const dates = ACT_PUBLIC_HOLIDAYS.map((h) => h.date);
  for (const h of ACT_PUBLIC_HOLIDAYS) {
    assert.match(h.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(new Date(`${h.date}T00:00:00Z`).toISOString().slice(0, 10), h.date, `${h.date} is a real date`);
    assert.ok(COVERED_YEARS.includes(Number(h.date.slice(0, 4))), `${h.date} is inside COVERED_YEARS`);
    assert.ok(h.name.trim().length > 0);
  }
  assert.deepEqual(dates, [...dates].sort());
  assert.equal(new Set(dates).size, dates.length);
  for (const year of COVERED_YEARS) assert.ok(dates.some((d) => d.startsWith(String(year))), `${year} has entries`);
});

test("holiday table: key official dates (Holidays Act 1958 s 3 + NI2026-154 + NI2026-387)", () => {
  const has = (d: string) => ACT_PUBLIC_HOLIDAYS.some((h) => h.date === d);
  for (const d of ["2026-03-09", "2026-04-25", "2026-04-27", "2026-06-01", "2026-10-05", "2026-12-28", "2027-04-25", "2027-04-26", "2027-05-31", "2027-12-27", "2027-12-28"]) assert.ok(has(d), d);
  assert.equal(has("2026-01-02"), false);
});

test("lookupActHoliday: holiday, ordinary day, and a year outside the table is never 'none'", () => {
  assert.deepEqual(lookupActHoliday("2026-03-09"), { kind: "holiday", name: "Canberra Day" });
  assert.deepEqual(lookupActHoliday("2026-03-10"), { kind: "none" });
  assert.deepEqual(lookupActHoliday("2028-03-13"), { kind: "not_loaded", year: 2028 });
  assert.deepEqual(lookupActHoliday("2025-12-25"), { kind: "not_loaded", year: 2025 });
  assert.deepEqual(lookupActHoliday("2030-01-01", [{ date: "2030-01-01", name: "X" }], [2030]), { kind: "holiday", name: "X" });
});
