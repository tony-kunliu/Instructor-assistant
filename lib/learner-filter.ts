import type { Learner } from "./types.ts";

export type LearnerScope = "mine" | "all";

/**
 * Picker view filter only — not an authorization boundary (every signed-in
 * instructor can already open any learner). With no signed-in identity
 * (local dev), "mine" has no meaning and falls back to everyone.
 */
export function filterLearners(learners: readonly Learner[], options: { scope: LearnerScope; instructorId: string | null; query: string }): Learner[] {
  const query = options.query.trim().toLowerCase();
  return learners.filter(
    (learner) =>
      (options.scope === "all" || !options.instructorId || learner.instructorId === options.instructorId) &&
      (!query || learner.fullName.toLowerCase().includes(query)),
  );
}
