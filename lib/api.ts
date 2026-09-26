import { NotFoundError, ValidationError } from "./repo.ts";

/** Run a route handler body and map domain errors to JSON responses. */
export async function handle(work: () => unknown | Promise<unknown>, status = 200): Promise<Response> {
  try {
    return Response.json(await work(), { status });
  } catch (error) {
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
