import type { D1Database } from "../d1-types.ts";
import { handle, readJson } from "../api.ts";
import { ValidationError } from "../repo.ts";
import { trialEndsAt } from "./gate.ts";

/**
 * SaaS edition accounts (spec 2026-10-21-saas-edition-design §4, §7). An instructor row is created only by the
 * person themself on /welcome, keyed on the e-mail Cloudflare Access verified (never anything from the body). The
 * e-mail is stored trimmed and lowercased; the SaaS database has a unique index on `lower(email)`
 * (migrations-saas/9001), which makes the create idempotent.
 */

export type SaasInstructor = { id: string; fullName: string; status: string; createdAt: string };

type Row = Record<string, unknown>;

function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/** Trimmed text of 1..max characters (code points), else a ValidationError naming the field. */
function requiredText(value: unknown, label: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new ValidationError(`${label} is required.`);
  if ([...text].length > max) throw new ValidationError(`${label} must be at most ${max} characters.`);
  return text;
}

/** The instructor for a verified e-mail (case-insensitive), whatever their status; null when there is none. */
export async function findSaasInstructor(db: D1Database, email: string): Promise<SaasInstructor | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const row = await db.prepare("SELECT id, full_name, status, created_at FROM instructors WHERE lower(email) = ?").bind(normalized).first<Row>();
  if (!row) return null;
  return { id: String(row.id), fullName: String(row.full_name), status: String(row.status), createdAt: String(row.created_at) };
}

/**
 * Creates the signed-in person's instructor row (`fullName` 1-80, `adiNumber` 1-20, both trimmed; e-mail required).
 * Idempotent: `INSERT OR IGNORE` on the `lower(email)` unique index then `SELECT`, so a repeated or concurrent
 * submit yields one row, and an existing row is returned unchanged.
 */
export async function createSaasInstructor(
  db: D1Database,
  input: { email: unknown; fullName: unknown; adiNumber: unknown },
): Promise<SaasInstructor> {
  const email = normalizeEmail(input.email);
  if (!email) throw new ValidationError("A verified e-mail is required.");
  const fullName = requiredText(input.fullName, "Full name", 80);
  const adiNumber = requiredText(input.adiNumber, "ADI number", 20);
  await db
    .prepare("INSERT OR IGNORE INTO instructors (id, full_name, adi_number, email, status) VALUES (?, ?, ?, ?, 'active')")
    .bind(crypto.randomUUID(), fullName, adiNumber, email)
    .run();
  const instructor = await findSaasInstructor(db, email);
  if (!instructor) throw new Error("Instructor could not be created.");
  return instructor;
}

/** The verified e-mail middleware forwarded during onboarding (`x-access-email`, percent-encoded); null when absent or malformed. */
export function readAccessEmail(headers: Headers): string | null {
  const raw = headers.get("x-access-email");
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).trim() || null;
  } catch {
    return null;
  }
}

/**
 * `POST /api/welcome { fullName, adiNumber }`.
 *  - Already onboarded (middleware set the trusted `x-instructor-id`, not `x-access-email`): 200 with that
 *    instructor, body ignored, nothing changed — a repeated submit (e.g. back button) is harmless.
 *  - Not yet onboarded: identity only from the middleware-set `x-access-email` (never the body); 201 with
 *    `{ instructor: { id, fullName } }`, also for a concurrent repeat (same instructor); 400 on validation errors.
 *  - Neither header, or a trusted id without an active row: 403.
 */
export async function postWelcome(db: D1Database, request: Request): Promise<Response> {
  const instructorId = request.headers.get("x-instructor-id");
  if (instructorId) {
    const row = await db.prepare("SELECT id, full_name FROM instructors WHERE id = ? AND status = 'active'").bind(instructorId).first<Row>();
    if (!row) return Response.json({ error: "forbidden" }, { status: 403 });
    return Response.json({ instructor: { id: String(row.id), fullName: String(row.full_name) } }, { status: 200 });
  }
  const email = readAccessEmail(request.headers);
  if (!email) return Response.json({ error: "A verified Cloudflare Access e-mail is required." }, { status: 403 });
  return handle(async () => {
    const body = await readJson(request);
    const instructor = await createSaasInstructor(db, { email, fullName: body.fullName, adiNumber: body.adiNumber });
    return { instructor: { id: instructor.id, fullName: instructor.fullName } };
  }, 201);
}

/**
 * `GET /api/me` body in saas mode: the trusted instructor from middleware's headers (name percent-decoded), the
 * mode, and the trial end computed from that instructor's `created_at`. `instructor: null` during onboarding, so
 * the client can send the person to /welcome.
 */
export async function saasMeBody(
  db: D1Database,
  headers: Headers,
  trialDays: number,
): Promise<{ instructor: { id: string; fullName: string } | null; mode: "saas"; trialEndsAt: string | null }> {
  const id = headers.get("x-instructor-id");
  const rawName = headers.get("x-instructor-name");
  if (!id || !rawName) return { instructor: null, mode: "saas", trialEndsAt: null };
  let fullName: string;
  try {
    fullName = decodeURIComponent(rawName);
  } catch {
    fullName = rawName;
  }
  const row = await db.prepare("SELECT created_at FROM instructors WHERE id = ?").bind(id).first<Row>();
  return { instructor: { id, fullName }, mode: "saas", trialEndsAt: row ? trialEndsAt(String(row.created_at), trialDays) : null };
}
