import { test } from "node:test";
import assert from "node:assert/strict";
import { decimalHours, distanceKm, durationMinutes, formatMinutes, localNow, parseOdometer, parseTime } from "../lib/calc.ts";

test("parseTime accepts HH:MM only", () => {
  assert.equal(parseTime("09:05"), 545);
  assert.equal(parseTime("23:59"), 1439);
  assert.equal(parseTime("24:00"), null);
  assert.equal(parseTime("9:05"), null);
  assert.equal(parseTime(""), null);
});

test("durationMinutes = finish - start", () => {
  assert.equal(durationMinutes("09:00", "10:30"), 90);
  assert.equal(durationMinutes("10:30", "10:30"), null);
  assert.equal(durationMinutes("11:00", "10:00"), null);
  assert.equal(durationMinutes("09:00", ""), null);
});

test("odometer parsing and distance", () => {
  assert.equal(parseOdometer("45210"), 45210);
  assert.equal(parseOdometer(" 12 "), 12);
  assert.equal(parseOdometer("12.5"), null);
  assert.equal(parseOdometer("-1"), null);
  assert.equal(parseOdometer(""), null);
  assert.equal(distanceKm(100, 142), 42);
  assert.equal(distanceKm(100, 100), 0);
  assert.equal(distanceKm(100, 99), null);
  assert.equal(distanceKm(null, 99), null);
});

test("hour formatting", () => {
  assert.equal(formatMinutes(0), "0h");
  assert.equal(formatMinutes(60), "1h");
  assert.equal(formatMinutes(135), "2h 15m");
  assert.equal(decimalHours(90), "1.5");
  assert.equal(decimalHours(135), "2.3");
});

test("localNow uses Canberra time", () => {
  // 2026-01-15T22:30:00Z is 09:30 on 16 Jan in Canberra (AEDT, UTC+11).
  assert.deepEqual(localNow(new Date("2026-01-15T22:30:00Z")), { date: "2026-01-16", time: "09:30" });
});
