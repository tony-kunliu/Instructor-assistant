import { currentAppMode, type AppMode } from "./app-mode.ts";

/**
 * Which data a request may see. Private mode (Tony/Anna) sees everything,
 * exactly as before; SaaS mode is limited to the verified instructor.
 */
export type Scope = { kind: "all" } | { kind: "instructor"; instructorId: string };

/** SaaS mode without an instructor id throws rather than widening the scope. */
export function scopeFor(mode: AppMode, instructorId: string | null): Scope {
  if (mode === "private") return { kind: "all" };
  if (!instructorId) throw new Error("SaaS mode requires a verified instructor id.");
  return { kind: "instructor", instructorId };
}

/** Scope for a request, from the trusted `x-instructor-id` header set by middleware. */
export function requestScope(request: Request): Scope {
  return scopeFor(currentAppMode(), request.headers.get("x-instructor-id"));
}
