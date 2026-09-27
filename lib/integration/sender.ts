// Webhook delivery + retry scheduling for ACTGDS Integration V1. See
// docs/integrations/actgds-instructor-assistant-v1.md#retry-schedule.

import type { D1Database } from "../d1-types.ts";
import { signWebhookBody } from "./hmac.ts";
import { listDueOutboxRows, markOutboxDelivered, markOutboxPermanentFailure, markOutboxRetry } from "./outbox.ts";
import type { DeliveryOutcome, IntegrationConfig, LessonUpsertedPayloadV1, OutboxRow } from "./types.ts";

/** Backoff after each successive retryable failure: 1min, 5min, 30min, 2hr, 12hr. After the 5th retry fails (6 attempts total, counting the initial one), the row becomes permanent_failure. */
const RETRY_BACKOFF_MINUTES = [1, 5, 30, 120, 720];

/** `attemptCountAfterFailure` is the row's attempt_count immediately after this failed attempt (1 = the very first/immediate attempt failed). Returns null once the schedule is exhausted. */
export function backoffMinutesAfterAttempt(attemptCountAfterFailure: number): number | null {
  const index = attemptCountAfterFailure - 1;
  if (index < 0 || index >= RETRY_BACKOFF_MINUTES.length) return null;
  return RETRY_BACKOFF_MINUTES[index];
}

/** 200/202 delivered (a 202 with a pending_link body still counts as delivered — ACTGDS durably accepted it). Network errors and 429/5xx are retryable. 400/401/403 and any other 4xx (including an unsupported contract_version) are permanent. */
export function classifyDeliveryOutcome(httpStatus: number | null, networkError: boolean): DeliveryOutcome {
  if (networkError || httpStatus === null) return "retryable";
  if (httpStatus === 200 || httpStatus === 202) return "delivered";
  if (httpStatus === 429 || httpStatus >= 500) return "retryable";
  if (httpStatus >= 400 && httpStatus < 500) return "permanent";
  return "retryable";
}

export type DeliveryAttemptResult = { outcome: DeliveryOutcome; errorCode: string | null };

/** A single HTTP delivery attempt. Never throws — a thrown/rejected fetch is treated as a retryable network error, same as any other. */
export async function attemptWebhookDelivery(fetchImpl: typeof fetch, config: IntegrationConfig, payload: LessonUpsertedPayloadV1): Promise<DeliveryAttemptResult> {
  if (!config.webhookUrl || !config.webhookSecret) {
    return { outcome: "retryable", errorCode: "missing_webhook_config" };
  }
  const rawBody = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  let signature: string;
  try {
    signature = await signWebhookBody(config.webhookSecret, timestamp, rawBody);
  } catch {
    return { outcome: "retryable", errorCode: "signing_failed" };
  }
  try {
    const response = await fetchImpl(config.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-IA-Event-ID": payload.event_id,
        "X-IA-Timestamp": String(timestamp),
        "X-IA-Signature": signature,
      },
      body: rawBody,
    });
    const outcome = classifyDeliveryOutcome(response.status, false);
    return { outcome, errorCode: outcome === "delivered" ? null : `http_${response.status}` };
  } catch {
    return { outcome: "retryable", errorCode: "network_error" };
  }
}

/** Runs one delivery attempt for one outbox row and applies the resulting state transition (delivered / rescheduled / permanent_failure) to the database. */
export async function processOutboxRow(db: D1Database, config: IntegrationConfig, fetchImpl: typeof fetch, row: OutboxRow, now: Date = new Date()): Promise<DeliveryOutcome> {
  const payload = JSON.parse(row.payloadJson) as LessonUpsertedPayloadV1;
  const { outcome, errorCode } = await attemptWebhookDelivery(fetchImpl, config, payload);

  if (outcome === "delivered") {
    await markOutboxDelivered(db, row.id, now.toISOString());
    return outcome;
  }

  const attemptCount = row.attemptCount + 1;
  if (outcome === "permanent") {
    await markOutboxPermanentFailure(db, row.id, attemptCount, errorCode);
    return outcome;
  }

  const backoffMinutes = backoffMinutesAfterAttempt(attemptCount);
  if (backoffMinutes === null) {
    await markOutboxPermanentFailure(db, row.id, attemptCount, errorCode ?? "retries_exhausted");
    return "permanent";
  }
  const nextAttemptAt = new Date(now.getTime() + backoffMinutes * 60_000).toISOString();
  await markOutboxRetry(db, row.id, attemptCount, nextAttemptAt, errorCode);
  return "retryable";
}

/**
 * Processes every currently-due outbox row (status='pending', next_attempt_at <= now). Used both right
 * after an enqueue (to attempt immediate delivery of that one new row) and as a periodic retry sweep
 * (whatever mechanism schedules that — see STATUS.md for what this round does and doesn't wire up).
 */
export async function processDueOutbox(db: D1Database, config: IntegrationConfig, fetchImpl: typeof fetch, now: Date = new Date(), limit = 25): Promise<void> {
  const dueRows = await listDueOutboxRows(db, now.toISOString(), limit);
  for (const row of dueRows) {
    await processOutboxRow(db, config, fetchImpl, row, now);
  }
}
