import type { D1Database } from "./d1-types.ts";
import type { Scope } from "./scope.ts";
import { markTransferRecordsChecked, NotFoundError, PaperImportError, setLearnerArchived, transferLearner, updateInstructorAdiNumber, updateLearner, ValidationError } from "./repo.ts";

/** Run a route handler body and map domain errors to JSON responses. */
export async function handle(work: () => unknown | Promise<unknown>, status = 200): Promise<Response> {
  try {
    return Response.json(await work(), { status });
  } catch (error) {
    if (error instanceof PaperImportError) return Response.json({ error: error.message, rows: error.errors }, { status: 400 });
    if (error instanceof ValidationError) return Response.json({ error: error.message }, { status: 400 });
    if (error instanceof NotFoundError) return Response.json({ error: error.message }, { status: 404 });
    console.error(error);
    return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}

/**
 * `GET /api/learners` query: `status=archived` selects the archived set; `summaries=0` skips the per-learner card
 * aggregate (the client's background archived fetch for the duplicate-licence check needs only the learners).
 * Anything else (absent, `1`, garbage) keeps the summaries, so the list can never silently lose its card data.
 */
export function parseLearnerListQuery(url: string): { archived: boolean; withSummaries: boolean } {
  const params = new URL(url).searchParams;
  return { archived: params.get("status") === "archived", withSummaries: params.get("summaries") !== "0" };
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new ValidationError("Invalid request body.");
  }
}

/**
 * Reads the request body and, when middleware resolved a verified
 * Cloudflare Access identity (Instructor Identity V1), overrides
 * `actingInstructorId` with the trusted `x-instructor-id` header it set —
 * never the other way around. A client-submitted `actingInstructorId` is
 * only honored when there is no Access identity for this request (e.g.
 * local dev, or before Access is in front for a given deployment).
 */
export async function readJsonWithActor(request: Request): Promise<Record<string, unknown>> {
  const body = await readJson(request);
  const instructorId = request.headers.get("x-instructor-id");
  if (instructorId) return { ...body, actingInstructorId: instructorId };
  return body;
}

/**
 * Reads the request body for creating a learner, defaulting `instructorId`
 * to the trusted `x-instructor-id` header (a verified Cloudflare Access
 * identity) only when the request didn't already supply one — unlike
 * `readJsonWithActor`, an explicit body value is never overridden, since a
 * signed-in instructor may deliberately be creating a learner for a
 * colleague via the dropdown. Local dev/no-Access requests fall back to
 * whatever the body says (possibly nothing, which createLearner rejects).
 */
export async function readJsonWithDefaultInstructor(request: Request): Promise<Record<string, unknown>> {
  const body = await readJson(request);
  if (String(body.instructorId ?? "").trim()) return body;
  const instructorId = request.headers.get("x-instructor-id");
  return instructorId ? { ...body, instructorId } : body;
}

/**
 * POST /api/learners body. An instructor scope (SaaS) always assigns the new learner to that instructor, ignoring
 * any submitted `instructorId`; `all` (private) is exactly readJsonWithDefaultInstructor.
 */
export async function readJsonForNewLearner(request: Request, scope: Scope): Promise<Record<string, unknown>> {
  if (scope.kind === "all") return readJsonWithDefaultInstructor(request);
  return { ...(await readJson(request)), instructorId: scope.instructorId };
}

/**
 * PATCH /api/learners/[id]: either `{ archived: boolean, reason?, note? }` (archive / restore, any active
 * instructor; reason/note optional and only with `archived: true`, migration 0010) or learner fields (edit;
 * only the learner's own instructor when signed in). The actor is the verified `x-instructor-id` header via
 * readJsonWithActor, never the body. `instructorId` is rejected by updateLearner.
 */
export async function patchLearner(db: D1Database, id: string, request: Request): Promise<Record<string, unknown>> {
  const body = await readJsonWithActor(request);
  const { archived, actingInstructorId, reason, note, ...fields } = body;
  const editing = Object.keys(fields).length > 0;
  if (archived !== undefined && editing) throw new ValidationError("Send either `archived` or learner fields, not both.");
  if (editing && (reason !== undefined || note !== undefined)) throw new ValidationError("A reason or note can only be given when archiving.");
  if (!editing) {
    if (typeof archived !== "boolean") throw new ValidationError("`archived` must be true or false.");
    return { learner: await setLearnerArchived(db, id, archived, { reason, note, actingInstructorId }) };
  }
  const result = await updateLearner(db, id, { ...fields, actingInstructorId });
  return { ...result, ...(result.changed ? {} : { message: "No changes: the details are already up to date." }) };
}

/**
 * POST /api/learners/[id]/transfer `{ toInstructorId, note? }` (learner transfer 3c T1). The actor is the verified
 * `x-instructor-id` header via readJsonWithActor, never the body when signed in. Rules: lib/repo.ts#transferLearner.
 */
export async function postLearnerTransfer(db: D1Database, id: string, request: Request): Promise<Record<string, unknown>> {
  const body = await readJsonWithActor(request);
  return { learner: await transferLearner(db, id, { toInstructorId: body.toInstructorId, note: body.note, actingInstructorId: body.actingInstructorId }) };
}

/** POST /api/learners/[id]/transfer/checked (D7 "Checked"): same verified actor rule. See lib/repo.ts#markTransferRecordsChecked. */
export async function postTransferRecordsChecked(db: D1Database, id: string, request: Request): Promise<Record<string, unknown>> {
  const body = await readJsonWithActor(request);
  return { learner: await markTransferRecordsChecked(db, id, { actingInstructorId: body.actingInstructorId }) };
}

/**
 * PATCH /api/instructors/[id] `{ adiNumber }`. The actor is the verified `x-instructor-id` header via readJsonWithActor,
 * never the body when signed in: only the instructor themselves may change their ADI number. See lib/repo.ts#updateInstructorAdiNumber.
 */
export async function patchInstructor(db: D1Database, id: string, request: Request): Promise<Record<string, unknown>> {
  const body = await readJsonWithActor(request);
  return { instructor: await updateInstructorAdiNumber(db, id, body.adiNumber, { actingInstructorId: body.actingInstructorId }) };
}
