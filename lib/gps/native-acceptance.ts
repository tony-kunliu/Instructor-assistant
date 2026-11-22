import { CRITERIA, MIN_BACKGROUND_MS, MIN_REAL_TEST_MS } from "./analysis.ts";

type PhaseSummary = {
  activeMs: number;
  uncoveredMs: number;
  longestGapMs: number;
};

export type NativeSelfTestSummary = {
  activeMs: number;
  locked: PhaseSummary | null;
  anotherApp: PhaseSummary | null;
};

function evaluatePhase(phase: PhaseSummary | null) {
  if (
    !phase ||
    !Number.isSafeInteger(phase.activeMs) ||
    !Number.isSafeInteger(phase.uncoveredMs) ||
    !Number.isSafeInteger(phase.longestGapMs) ||
    phase.activeMs < MIN_BACKGROUND_MS ||
    phase.longestGapMs < 0 ||
    phase.longestGapMs > phase.uncoveredMs ||
    phase.uncoveredMs > phase.activeMs
  ) return null;

  const coverage = 1 - phase.uncoveredMs / phase.activeMs;
  return {
    coverage,
    longestGapMs: phase.longestGapMs,
    passed: coverage >= CRITERIA.backgroundCoverage &&
      phase.longestGapMs <= CRITERIA.backgroundMaxGapMs,
  };
}

/** Compare the prototype's two separately marked background phases. No location samples are needed. */
export function evaluateNativeSelfTest(summary: NativeSelfTestSummary) {
  const locked = evaluatePhase(summary.locked);
  const anotherApp = evaluatePhase(summary.anotherApp);
  if (
    !locked || !anotherApp ||
    !Number.isSafeInteger(summary.activeMs) ||
    summary.activeMs < MIN_REAL_TEST_MS ||
    !summary.locked || !summary.anotherApp ||
    summary.locked.activeMs + summary.anotherApp.activeMs > summary.activeMs
  ) return { verdict: "inconclusive", locked, anotherApp } as const;

  return { verdict: locked.passed && anotherApp.passed ? "pass" : "fail", locked, anotherApp } as const;
}
