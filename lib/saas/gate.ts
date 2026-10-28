import type { D1Database } from "../d1-types.ts";
import { findSaasInstructor } from "./accounts.ts";

declare global {
  interface CloudflareEnv {
    /** SaaS edition only: free-trial length in days (positive integer). Missing or invalid means 30 (spec §7). */
    SAAS_TRIAL_DAYS?: string;
  }
}

/**
 * The SaaS edition's authorization gate (spec 2026-10-21-saas-edition-design §4, §5, §7), as pure functions that
 * middleware.ts calls only when `APP_MODE` is exactly `"saas"`. Cloudflare Access (One-time PIN, "Everyone") only
 * proves an e-mail address; everything about who may do what is decided here, failing closed:
 *
 *  - no instructor row for the e-mail → onboarding: a short allow-list passes, pages go to /welcome, API is 403;
 *  - an inactive instructor → /disabled (pages) or 403 (API), never a /welcome loop;
 *  - route guard: `/api/learners/<id>/…` only for the signed-in instructor's own learner, else 404 (never 403);
 *    transfer, another instructor's record and /gps are 404;
 *  - free trial: after `created_at` + trial days × 24 h, every non-GET `/api/*` except `POST /api/welcome` is 402.
 *
 * Nothing here imports next/server; the private edition never reaches this module.
 */

export type GateInstructor = { id: string; fullName: string };

export type GateResult =
  | { kind: "pass"; instructor?: GateInstructor }
  | { kind: "redirect"; to: "/welcome" | "/disabled" }
  | { kind: "error"; status: 402 | 403 | 404; error: string };

export type GateInput = { email: string; method: string; pathname: string; now: Date; trialDays: number };

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TRIAL_DAYS = 30;

const NOT_FOUND: GateResult = { kind: "error", status: 404, error: "not_found" };

/** `SAAS_TRIAL_DAYS`: a positive whole number of days as a string; anything else (missing, 0, negative, decimal, text) is 30. */
export function parseTrialDays(raw: unknown): number {
  if (typeof raw !== "string" || !/^\s*\d+\s*$/.test(raw)) return DEFAULT_TRIAL_DAYS;
  const days = Number(raw.trim());
  return Number.isSafeInteger(days) && days > 0 ? days : DEFAULT_TRIAL_DAYS;
}

/** Trial end as an ISO string (`created_at` + days × 24 h), or null when `created_at` is not a valid timestamp. */
export function trialEndsAt(createdAt: string, trialDays: number): string | null {
  const end = trialEndMs(createdAt, trialDays);
  return Number.isFinite(end) ? new Date(end).toISOString() : null;
}

function trialEndMs(createdAt: string, trialDays: number): number {
  return Date.parse(createdAt) + trialDays * DAY_MS;
}

/** Pages anyone with a verified e-mail may open before onboarding (and, except /welcome, while disabled). */
const OPEN_PAGES = new Set(["/terms", "/privacy", "/disabled"]);
/** Static metadata and `public/` files the app shell needs (`/_next/static|image` never reach middleware). */
const STATIC_FILES = new Set(["/manifest.webmanifest", "/icon.svg", "/icon.png", "/favicon.ico"]);
const STATIC_DIRS = ["/data/", "/fonts/", "/pdf-template/"];

function isStatic(path: string): boolean {
  return STATIC_FILES.has(path) || STATIC_DIRS.some((dir) => path.startsWith(dir) && path.length > dir.length);
}

/**
 * Normalizes a request path for the gate: percent-decoded once (as Next decodes route params), repeated slashes
 * collapsed, one trailing slash dropped. Returns null — the caller answers 404 — for malformed percent-encoding or
 * any `.`/`..` segment that survived URL normalization (e.g. one hidden behind an encoded slash), so the gate never
 * reasons about a different path than the router might resolve.
 */
export function normalizeGatePath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  let path = `/${decoded}`.replace(/\/{2,}/g, "/");
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  if (path.split("/").some((segment) => segment === "." || segment === "..")) return null;
  return path;
}

export async function saasGate(db: D1Database, input: GateInput): Promise<GateResult> {
  const email = String(input.email ?? "").trim();
  if (!email) return { kind: "error", status: 403, error: "identity_required" };
  const path = normalizeGatePath(input.pathname);
  if (path === null) return NOT_FOUND;
  const segments = path.split("/").slice(1);
  const isApi = segments[0]?.toLowerCase() === "api";
  const method = input.method.toUpperCase();

  const instructor = await findSaasInstructor(db, email);

  if (!instructor) {
    if (path === "/welcome" || OPEN_PAGES.has(path) || isStatic(path)) return { kind: "pass" };
    if (path === "/api/welcome" && method === "POST") return { kind: "pass" };
    if (path === "/api/me" && method === "GET") return { kind: "pass" };
    return isApi ? { kind: "error", status: 403, error: "onboarding_required" } : { kind: "redirect", to: "/welcome" };
  }

  if (instructor.status !== "active") {
    if (OPEN_PAGES.has(path) || isStatic(path)) return { kind: "pass" };
    return isApi ? { kind: "error", status: 403, error: "account_disabled" } : { kind: "redirect", to: "/disabled" };
  }

  if (segments[0]?.toLowerCase() === "gps") return NOT_FOUND;

  if (isApi) {
    const guard = await routeGuard(db, instructor.id, segments);
    if (guard) return guard;
    const writing = method !== "GET";
    const welcome = path === "/api/welcome" && method === "POST";
    if (writing && !welcome && !(input.now.getTime() < trialEndMs(instructor.createdAt, input.trialDays))) {
      return { kind: "error", status: 402, error: "trial_expired" };
    }
  }

  return { kind: "pass", instructor: { id: instructor.id, fullName: instructor.fullName } };
}

/** 404 for a learner that is not the signed-in instructor's, any learner transfer, or another instructor's record; null to continue. */
async function routeGuard(db: D1Database, instructorId: string, segments: string[]): Promise<GateResult | null> {
  const resource = segments[1]?.toLowerCase();
  if (resource === "learners" && segments.length > 2) {
    const learnerId = segments[2];
    if (segments.slice(3).some((segment) => segment.toLowerCase() === "transfer")) return NOT_FOUND;
    const owned = await db.prepare("SELECT 1 AS ok FROM learners WHERE id = ? AND instructor_id = ?").bind(learnerId, instructorId).first();
    return owned ? null : NOT_FOUND;
  }
  if (resource === "instructors" && segments.length > 2) {
    return segments.length === 3 && segments[2] === instructorId ? null : NOT_FOUND;
  }
  return null;
}

/**
 * The request headers to forward to the route handlers: client-supplied `x-instructor-id`, `x-instructor-name` and
 * `x-access-email` are always removed first, then only trusted values are set. The name is percent-encoded (header
 * values must be Latin-1; names may be any Unicode, e.g. 刘坤) and so is the e-mail; `/api/me` and
 * `readAccessEmail` (lib/saas/accounts.ts) decode them. `x-access-email` is set only while there is no instructor
 * (onboarding), for `POST /api/welcome`.
 */
export function forwardHeaders(request: Request, instructor: GateInstructor | null, email: string | null): Headers {
  const headers = new Headers(request.headers);
  for (const name of ["x-instructor-id", "x-instructor-name", "x-access-email"]) headers.delete(name);
  if (instructor) {
    headers.set("x-instructor-id", instructor.id);
    headers.set("x-instructor-name", encodeURIComponent(instructor.fullName));
  } else if (email) {
    headers.set("x-access-email", encodeURIComponent(email));
  }
  return headers;
}
