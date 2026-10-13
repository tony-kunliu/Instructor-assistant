"use client";

import {
  CORE_COMPETENCY_IDS,
  POST_REVIEW_1_17_IDS,
  assessmentLockReason,
  FINAL_DRIVE_23,
  REVIEW_1_17,
  REVIEW_1_22,
  competencyFullName,
  competencyLabel,
  sortCompetencyIds,
  type AssessmentResult,
  type LearnerProgress,
} from "@/lib/competency.ts";
import { gateTag } from "@/lib/lesson-view.ts";

const SPECIAL_ASSESSMENTS = [REVIEW_1_17, REVIEW_1_22, FINAL_DRIVE_23] as const;

type Props = {
  progress: LearnerProgress;
  /** Progress from EARLIER lessons only — what every Assessed gate and the "already achieved" Taught rule are judged against (History Edit). Defaults to `progress`. */
  gateProgress?: LearnerProgress;
  taughtIds: string[];
  assessedIds: string[];
  achievedResults: Record<string, AssessmentResult>;
  onChangeTaught: (ids: string[]) => void;
  onChangeAssessed: (ids: string[]) => void;
  onChangeAchieved: (results: Record<string, AssessmentResult>) => void;
};

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** The three special assessments' validated status lives in their own progress sub-object, not the raw
 * per-competency map — a Review/Final Drive achieved in the past can be rolled back to locked/ready by a
 * later edit that invalidates its prerequisites (see lib/competency.ts#computeProgress). Only applies to
 * REVIEW_1_17 / REVIEW_1_22 / FINAL_DRIVE_23 — core competencies 1-22 are never "special locked". */
function specialStatus(id: string, progress: LearnerProgress): "locked" | "ready" | "achieved" {
  if (id === REVIEW_1_17) return progress.review1_17.status;
  if (id === REVIEW_1_22) return progress.review1_22.status;
  return progress.finalDrive23.status;
}

/** Assessment lock (Competency 18, 20, 21 and the three specials; 19 and 22 are never gated) — same rule the server enforces (lib/competency.ts#assessmentLockReason). */
function assessLocked(id: string, progress: LearnerProgress, gateProgress: LearnerProgress = progress): boolean {
  return assessmentLockReason(id, gateProgress) !== null;
}

/**
 * Taught / Assessed grids of number-only chips (Tony's decision 1: the official names stay in the result rows, the
 * tooltips and the progress card's legend), the three special assessments as full-width buttons with their gate
 * status, one result row per assessed item, then the Taught / Assessed / Achieved summary. Selection, gating and
 * result handling are exactly as before; only the presentation changed.
 */
export default function CompetencyPicker({ progress, gateProgress, taughtIds, assessedIds, achievedResults, onChangeTaught, onChangeAssessed, onChangeAchieved }: Props) {
  const taughtDisabled = (id: string) => (gateProgress ?? progress).competencies[id]?.achieved === true || assessedIds.includes(id);
  // An already-selected locked chip stays clickable so legacy data in an edit form can still be deselected.
  const assessedDisabled = (id: string) => taughtIds.includes(id) || (assessLocked(id, progress, gateProgress) && !assessedIds.includes(id));

  const handleTaughtClick = (id: string) => {
    if (taughtDisabled(id)) return;
    onChangeTaught(toggle(taughtIds, id));
  };

  const handleAssessedClick = (id: string) => {
    if (assessedDisabled(id)) return;
    const next = toggle(assessedIds, id);
    onChangeAssessed(next);
    if (!next.includes(id) && id in achievedResults) {
      const rest = { ...achievedResults };
      delete rest[id];
      onChangeAchieved(rest);
    }
  };

  const setResult = (id: string, result: AssessmentResult) => onChangeAchieved({ ...achievedResults, [id]: result });

  const achievedLabels = sortCompetencyIds(Object.keys(achievedResults).filter((id) => achievedResults[id] === "achieved")).map(competencyLabel);
  const anyLockHint = POST_REVIEW_1_17_IDS.some((id) => assessLocked(id, progress, gateProgress));

  return (
    <div className="competency-picker">
      <div className="comp-section">
        <div className="comp-head"><span className="comp-label">Taught</span><small>green = already achieved</small></div>
        <div className="chip-row numbers">
          {CORE_COMPETENCY_IDS.map((id) => {
            const achieved = progress.competencies[id]?.achieved === true;
            const name = competencyFullName(id);
            return (
              <button
                key={id}
                type="button"
                className={`chip${taughtIds.includes(id) ? " selected" : ""}${achieved ? " achieved" : ""}`}
                disabled={taughtDisabled(id)}
                aria-pressed={taughtIds.includes(id)}
                aria-label={`${id} ${name ?? ""}${achieved ? ", already achieved" : ""}`.trim()}
                title={name ?? undefined}
                onClick={() => handleTaughtClick(id)}
              >
                {id}
              </button>
            );
          })}
        </div>
      </div>

      <div className="comp-section">
        <div className="comp-head"><span className="comp-label">Assessed</span><small>{anyLockHint ? "dashed = locked for now" : "tap to assess"}</small></div>
        <div className="chip-row numbers">
          {CORE_COMPETENCY_IDS.map((id) => {
            const achieved = progress.competencies[id]?.achieved === true;
            const locked = assessLocked(id, progress, gateProgress);
            const name = competencyFullName(id);
            return (
              <button
                key={id}
                type="button"
                className={`chip${assessedIds.includes(id) ? " selected" : ""}${achieved ? " achieved" : ""}${locked ? " locked" : ""}`}
                disabled={assessedDisabled(id)}
                aria-pressed={assessedIds.includes(id)}
                aria-label={`${id} ${name ?? ""}${locked ? ", locked" : achieved ? ", already achieved" : ""}`.trim()}
                data-locked={locked ? "true" : undefined}
                title={locked ? (assessmentLockReason(id, gateProgress ?? progress) ?? undefined) : (name ?? undefined)}
                onClick={() => handleAssessedClick(id)}
              >
                {id}
              </button>
            );
          })}
        </div>
        {anyLockHint ? (
          <p className="comp-lock-hint">18, 20 and 21 can be Taught now — they can only be Assessed after 1-17 and Review 1-17 are Achieved. 19 and 22 may be Assessed at any time.</p>
        ) : null}
        <div className="chip-row special">
          {SPECIAL_ASSESSMENTS.map((id) => {
            const status = specialStatus(id, progress);
            const locked = assessLocked(id, progress, gateProgress);
            const tag = gateTag(locked ? "locked" : status);
            return (
              <button
                key={id}
                type="button"
                className={`chip wide${assessedIds.includes(id) ? " selected" : ""}${status === "achieved" ? " achieved" : ""}${locked ? " locked" : ""}`}
                disabled={assessedDisabled(id)}
                aria-pressed={assessedIds.includes(id)}
                data-locked={locked ? "true" : undefined}
                title={competencyFullName(id) ?? undefined}
                onClick={() => handleAssessedClick(id)}
              >
                <span>{competencyLabel(id)}</span>
                <span className={`gate-tag ${tag.state}`} data-state={tag.state}>{tag.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {assessedIds.length ? (
        <div className="comp-section">
          <div className="comp-head"><span className="comp-label">Assessment Result</span><small>required for each assessed</small></div>
          <ul className="result-list">
            {sortCompetencyIds(assessedIds).map((id) => (
              <li key={id}>
                <span className="result-name" title={competencyFullName(id) ?? undefined}>
                  {competencyLabel(id)}
                  {competencyFullName(id) ? <small>{competencyFullName(id)}</small> : null}
                </span>
                <span className="result-buttons">
                  <button type="button" className={`btn small${achievedResults[id] === "achieved" ? " primary" : " ghost"}`} aria-pressed={achievedResults[id] === "achieved"} onClick={() => setResult(id, "achieved")}>
                    Achieved
                  </button>
                  <button type="button" className={`btn small${achievedResults[id] === "not_achieved" ? " danger" : " ghost"}`} aria-pressed={achievedResults[id] === "not_achieved"} onClick={() => setResult(id, "not_achieved")}>
                    Not achieved
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="comp-summary">
        <b>Taught:</b> {taughtIds.length ? sortCompetencyIds(taughtIds).map(competencyLabel).join(", ") : "—"}
        <br />
        <b>Assessed:</b> {assessedIds.length ? sortCompetencyIds(assessedIds).map(competencyLabel).join(", ") : "—"}
        <br />
        <b>Achieved:</b> {achievedLabels.length ? achievedLabels.join(", ") : "—"}
      </p>
    </div>
  );
}
