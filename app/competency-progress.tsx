import { ALL_ASSESSABLE_IDS, CORE_COMPETENCY_IDS, competencyFullName, competencyLabel, type LearnerProgress, type MilestoneInvalidation, type ReviewState } from "@/lib/competency.ts";
import type { CompletionSummary } from "@/lib/types.ts";

function invalidationMessage(invalidated: MilestoneInvalidation): string | null {
  const rolledBack = [
    invalidated.review1_17 ? "Review 1-17" : null,
    invalidated.review1_22 ? "Review 1-22" : null,
    invalidated.finalDrive23 ? "23 Final Drive" : null,
    invalidated.completed ? "CBT&A Completed" : null,
  ].filter((label): label is string => label !== null);
  if (!rolledBack.length) return null;
  return `This edit removed a prerequisite: ${rolledBack.join(", ")} no longer meets its requirements and has been reset. Please review and re-assess.`;
}

function reviewLabel(status: ReviewState, remaining: number): string {
  if (status === "achieved") return "Achieved";
  if (status === "ready") return "Ready to assess";
  return `Locked · ${remaining} remaining`;
}

function finalDriveLabel(finalDrive23: LearnerProgress["finalDrive23"]): string {
  if (finalDrive23.status === "achieved") return "Achieved";
  if (finalDrive23.status === "ready") return "Ready to assess";
  if (finalDrive23.remaining > 0) return `Locked · ${finalDrive23.remaining} competencies remaining`;
  if (!finalDrive23.review1_17Achieved) return "Locked · Review 1-17 not achieved";
  return "Locked · Review 1-22 not achieved";
}

type Props = { progress: LearnerProgress; completion: CompletionSummary | null; invalidated?: MilestoneInvalidation | null };

export default function CompetencyProgressCard({ progress, completion, invalidated }: Props) {
  const warning = invalidated ? invalidationMessage(invalidated) : null;
  return (
    <section className="card progress">
      <h2>CBT&amp;A Progress</h2>
      {warning ? <p className="status error">{warning}</p> : null}
      <p className="progress-count">{progress.achievedCount} / 22 Achieved</p>
      <div className="progress-grid">
        {CORE_COMPETENCY_IDS.map((id) => {
          const c = progress.competencies[id];
          const cls = c.achieved ? "achieved" : c.taughtCount > 0 ? "in-progress" : "not-started";
          return (
            <span key={id} className={`progress-chip ${cls}`}>
              {id}
            </span>
          );
        })}
      </div>
      <ul className="review-status">
        <li>
          <span>Review 1-17</span>
          <b>{reviewLabel(progress.review1_17.status, progress.review1_17.remaining)}</b>
        </li>
        <li>
          <span>Review 1-22</span>
          <b>{reviewLabel(progress.review1_22.status, progress.review1_22.remaining)}</b>
        </li>
        <li>
          <span>23 Final Drive</span>
          <b>{finalDriveLabel(progress.finalDrive23)}</b>
        </li>
      </ul>
      <details className="comp-legend">
        <summary>What do the numbers mean? (official ACT CBT&amp;A competency names)</summary>
        <ul>
          {ALL_ASSESSABLE_IDS.map((id) => (
            <li key={id}>
              <b>{competencyLabel(id)}</b> — {competencyFullName(id)}
            </li>
          ))}
        </ul>
      </details>
      {completion ? (
        <p className="status ok">
          CBT&amp;A Completed — Lesson #{completion.completingLessonNo} · {completion.instructorName} · {completion.totalLessons} lessons ·{" "}
          {completion.cumulativeHours} h · {completion.cumulativeKm} km
        </p>
      ) : null}
    </section>
  );
}
