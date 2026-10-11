import { test } from "node:test";
import assert from "node:assert/strict";
import { canberraDateTime, decimalHours, distanceKm, durationMinutes, formatMinutes, localNow, parseOdometer, parseTime } from "../lib/calc.ts";

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

test("canberraDateTime shows stored UTC timestamps in Canberra time, across daylight saving", () => {
  // Late evening UTC is already the next day in Canberra (AEDT, UTC+11, from the first Sunday of October).
  assert.deepEqual(canberraDateTime("2026-10-10T14:05:00.000Z"), { date: "2026-10-11", time: "01:05" });
  // Before DST starts (2026-10-04): AEST, UTC+10.
  assert.deepEqual(canberraDateTime("2026-10-03T13:59:00.000Z"), { date: "2026-10-03", time: "23:59" });
  assert.deepEqual(canberraDateTime("2026-10-03T14:00:00.000Z"), { date: "2026-10-04", time: "00:00" });
  // At 02:00 AEST the clock jumps to 03:00 AEDT (16:00 UTC).
  assert.deepEqual(canberraDateTime("2026-10-03T15:59:00.000Z"), { date: "2026-10-04", time: "01:59" });
  assert.deepEqual(canberraDateTime("2026-10-03T16:00:00.000Z"), { date: "2026-10-04", time: "03:00" });
  // Winter (AEST, UTC+10) and the end-of-year boundary.
  assert.deepEqual(canberraDateTime("2026-07-01T13:30:00.000Z"), { date: "2026-07-01", time: "23:30" });
  assert.deepEqual(canberraDateTime("2026-12-31T13:00:00.000Z"), { date: "2027-01-01", time: "00:00" });
  assert.equal(canberraDateTime(null), null);
  assert.equal(canberraDateTime("not a date"), null);
});
