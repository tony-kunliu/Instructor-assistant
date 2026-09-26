import { CORE_COMPETENCY_IDS, type LearnerProgress, type ReviewState } from "@/lib/competency.ts";
import type { CompletionSummary } from "@/lib/types.ts";

function reviewLabel(status: ReviewState, remaining: number): string {
  if (status === "achieved") return "Achieved";
  if (status === "ready") return "Ready to assess";
  return `Locked · ${remaining} remaining`;
}

export default function CompetencyProgressCard({ progress, completion }: { progress: LearnerProgress; completion: CompletionSummary | null }) {
  return (
    <section className="card progress">
      <h2>CBT&amp;A Progress</h2>
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
          <b>{progress.finalDrive23.status === "achieved" ? "Achieved" : "Ready to assess"}</b>
        </li>
      </ul>
      {completion ? (
        <p className="status ok">
          CBT&amp;A Completed — Lesson #{completion.completingLessonNo} · {completion.instructorName} · {completion.totalLessons} lessons ·{" "}
          {completion.cumulativeHours} h · {completion.cumulativeKm} km
        </p>
      ) : null}
    </section>
  );
}
