import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateNativeSelfTest } from "../lib/gps/native-acceptance.ts";

const healthy = { activeMs: 300_000, uncoveredMs: 0, longestGapMs: 0 };
const drive = { activeMs: 1_200_000, locked: healthy, anotherApp: healthy };

test("accepts a complete drive only when both background intervals meet the threshold", () => {
  assert.equal(evaluateNativeSelfTest(drive).verdict, "pass");
  const result = evaluateNativeSelfTest({
    ...drive,
    anotherApp: { ...healthy, uncoveredMs: 90_000, longestGapMs: 90_000 },
  });
  assert.equal(result.verdict, "fail");
  assert.equal(result.locked?.passed, true);
  assert.equal(result.anotherApp?.coverage, 0.7);
});

test("rejects a long gap even when a long interval still has enough coverage", () => {
  const result = evaluateNativeSelfTest({
    ...drive,
    locked: { activeMs: 700_000, uncoveredMs: 31_000, longestGapMs: 31_000 },
  });
  assert.ok((result.locked?.coverage ?? 0) >= 0.95);
  assert.equal(result.verdict, "fail");
});

test("leaves incomplete or inconsistent evidence inconclusive", () => {
  for (const evidence of [
    { ...drive, activeMs: 1_199_999 },
    { ...drive, locked: null },
    { ...drive, anotherApp: { ...healthy, activeMs: 59_999 } },
    { ...drive, locked: { ...healthy, longestGapMs: 1 } },
    { ...drive, locked: { ...healthy, activeMs: 1_000_000 } },
  ]) assert.equal(evaluateNativeSelfTest(evidence).verdict, "inconclusive");
});
