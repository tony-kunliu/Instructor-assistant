// Builds the lesson.upserted v1 payload against the canonical schema
// (docs/integrations/lesson-upserted-v1.schema.json — byte-identical to
// ACTGDS's `tony-kunliu/actgds.com` copy, contract_schema_sha256
// c43d28164bb1c5c0e316e2d2f1cee77ad627508ef7dca4d58516adab8852b7e6; ACTGDS
// is the canonical authority, this repo copies it, never redefines it —
// see docs/integrations/actgds-instructor-assistant-v1.md). Pure/DB-free by
// design — everything it needs is passed in — so it's unit-testable
// without D1 and keeps lib/repo.ts's own persistence logic decoupled from
// the wire format.

import { FINAL_DRIVE_23, REVIEW_1_17, REVIEW_1_22, type LearnerProgress } from "../competency.ts";
import type { IntegrationEnvironment, LessonUpsertedPayloadV1 } from "./types.ts";

/** Internal ids use hyphens (review-1-17); the wire contract uses underscores (review_1_17). Core ids (1-22) pass through unchanged. */
function toWireCompetencyId(id: string): string {
  if (id === REVIEW_1_17) return "review_1_17";
  if (id === REVIEW_1_22) return "review_1_22";
  if (id === FINAL_DRIVE_23) return "final_drive_23";
  return id;
}

/** The canonical schema caps every stable id at 128 chars and display_name at 200 (docs/integrations/lesson-upserted-v1.schema.json). Every real id here is a UUID (36 chars) and every real display_name is a short instructor name, so this never actually truncates in practice — it exists so a future data change can never silently produce a schema-invalid (and therefore permanently-rejected) payload. */
function clamp(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export type BuildLessonUpsertedInput = {
  environment: IntegrationEnvironment;
  learnerId: string;
  instructorId: string;
  instructorDisplayName: string;
  lesson: {
    id: string;
    lessonNo: number;
    lessonDate: string;
    startTime: string;
    finishTime: string;
    durationMinutes: number;
    distanceKm: number;
    cumulativeMinutes: number;
    cumulativeKm: number;
    createdAt: string;
    updatedAt: string | null;
  };
  taughtIds: string[];
  assessedIds: string[];
  achievedIds: string[];
  progress: LearnerProgress;
  /** Overridable for deterministic tests; defaults to a fresh uuid/now. */
  eventId?: string;
  occurredAt?: string;
};

export function buildLessonUpsertedPayload(input: BuildLessonUpsertedInput): LessonUpsertedPayloadV1 {
  const cbtaStatus = input.progress.completed ? "completed" : "active";
  return {
    contract_version: 1,
    event_id: input.eventId ?? crypto.randomUUID(),
    event_type: "lesson.upserted",
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    source: { system: "instructor-assistant", environment: input.environment },
    learner: { learner_id: clamp(input.learnerId, 128) },
    instructor: { instructor_id: clamp(input.instructorId, 128), display_name: clamp(input.instructorDisplayName, 200) },
    lesson: {
      lesson_id: clamp(input.lesson.id, 128),
      lesson_number: input.lesson.lessonNo,
      lesson_date: input.lesson.lessonDate,
      start_time: input.lesson.startTime,
      finish_time: input.lesson.finishTime,
      duration_minutes: input.lesson.durationMinutes,
      distance_km: input.lesson.distanceKm,
      cumulative_minutes: input.lesson.cumulativeMinutes,
      cumulative_km: input.lesson.cumulativeKm,
      taught: input.taughtIds.map(toWireCompetencyId),
      assessed: input.assessedIds.map(toWireCompetencyId),
      achieved: input.achievedIds.map(toWireCompetencyId),
      // Never null: an unedited lesson falls back to createdAt.
      source_updated_at: input.lesson.updatedAt ?? input.lesson.createdAt,
    },
    progress: {
      achieved_count: input.progress.achievedCount,
      total_competencies: 22,
      review_1_17: input.progress.review1_17.status,
      review_1_22: input.progress.review1_22.status,
      final_drive_23: input.progress.finalDrive23.status,
      cbta_status: cbtaStatus,
    },
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * True when two serialized lesson.upserted payloads say exactly the same thing to the receiver — every
 * contract-visible field equal — differing only in per-event identity/version bookkeeping (event_id,
 * occurred_at, lesson.source_updated_at). Fails closed: anything unparseable, or of another shape, is
 * "different", so a caller that uses this to skip a redundant event can only ever skip a genuine no-op.
 */
export function sameContractState(payloadJsonA: string, payloadJsonB: string): boolean {
  try {
    const strip = (json: string): string => {
      const payload = JSON.parse(json) as Record<string, unknown>;
      if (!payload || typeof payload !== "object" || typeof payload.lesson !== "object" || payload.lesson === null) throw new Error("unexpected shape");
      const { event_id: _eventId, occurred_at: _occurredAt, lesson, ...rest } = payload;
      const { source_updated_at: _sourceUpdatedAt, ...lessonRest } = lesson as Record<string, unknown>;
      return canonicalJson({ ...rest, lesson: lessonRest });
    };
    return strip(payloadJsonA) === strip(payloadJsonB);
  } catch {
    return false;
  }
}
