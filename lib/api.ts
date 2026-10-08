import { NotFoundError, PaperImportError, ValidationError } from "./repo.ts";

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
