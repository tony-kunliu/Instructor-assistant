// Types for the ACTGDS Integration V1 sender. See
// docs/integrations/actgds-instructor-assistant-v1.md and
// docs/integrations/lesson-upserted-v1.schema.json for the authoritative
// wire contract this mirrors exactly.

export type IntegrationEnvironment = "staging" | "production";
export type ReviewWireState = "locked" | "ready" | "achieved";
export type CbtaWireStatus = "active" | "completed";

export type LessonUpsertedPayloadV1 = {
  contract_version: 1;
  event_id: string;
  event_type: "lesson.upserted";
  occurred_at: string;
  source: { system: "instructor-assistant"; environment: IntegrationEnvironment };
  learner: { learner_id: string };
  instructor: { instructor_id: string; display_name: string };
  lesson: {
    lesson_id: string;
    lesson_number: number;
    lesson_date: string;
    start_time: string;
    finish_time: string;
    duration_minutes: number;
    distance_km: number;
    cumulative_minutes: number;
    cumulative_km: number;
    taught: string[];
    assessed: string[];
    achieved: string[];
    source_updated_at: string;
  };
  progress: {
    achieved_count: number;
    total_competencies: 22;
    review_1_17: ReviewWireState;
    review_1_22: ReviewWireState;
    final_drive_23: ReviewWireState;
    cbta_status: CbtaWireStatus;
  };
};

export type IntegrationConfig = {
  enabled: boolean;
  webhookUrl: string | null;
  webhookSecret: string | null;
  environment: IntegrationEnvironment;
};

/** Lets the caller (an API route, with access to the real Cloudflare execution context) decide how a
 * best-effort delivery attempt is scheduled — `ctx.waitUntil` in a deployed Worker, immediate/awaited in
 * tests, or fire-and-forget as a safe default. `lib/repo.ts` never imports Cloudflare-specific APIs itself
 * (matches this codebase's existing db.ts/repo.ts layering), so this indirection is how it stays that way. */
export type IntegrationHooks = {
  config: IntegrationConfig;
  fetchImpl?: typeof fetch;
  schedule?: (attempt: () => Promise<void>) => void;
};

export type OutboxStatus = "pending" | "delivered" | "permanent_failure";

export type OutboxRow = {
  id: string;
  eventId: string;
  eventType: string;
  learnerId: string;
  lessonId: string;
  sourceUpdatedAt: string;
  payloadJson: string;
  status: OutboxStatus;
  attemptCount: number;
  nextAttemptAt: string;
  lastErrorCode: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

export type DeliveryOutcome = "delivered" | "retryable" | "permanent";
