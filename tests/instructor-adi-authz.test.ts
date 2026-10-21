import { test } from "node:test";
import assert from "node:assert/strict";
import { openTestD1 } from "../lib/db.ts";
import { handle, patchInstructor } from "../lib/api.ts";
import { listInstructors, updateInstructorAdiNumber, ValidationError } from "../lib/repo.ts";

// Seeded by lib/schema.ts: Tony and Anna, both active. Only the trusted `x-instructor-id` identifies the actor.
const patchRequest = (adiNumber: string, instructorHeader?: string, bodyActor?: string) =>
  new Request("http://localhost/api/instructors/x", {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(instructorHeader ? { "x-instructor-id": instructorHeader } : {}) },
    body: JSON.stringify({ adiNumber, ...(bodyActor ? { actingInstructorId: bodyActor } : {}) }),
  });

async function twoInstructors() {
  const db = openTestD1(":memory:");
  const list = await listInstructors(db);
  const tony = list.find((i) => i.fullName === "Tony")!;
  const anna = list.find((i) => i.fullName === "Anna")!;
  return { db, tony, anna };
}
const adiOf = async (db: Awaited<ReturnType<typeof openTestD1>>, id: string) => (await listInstructors(db)).find((i) => i.id === id)?.adiNumber ?? null;

test("a signed-in instructor can set their OWN ADI number", async () => {
  const { db, tony } = await twoInstructors();
  const res = (await patchInstructor(db, tony.id, patchRequest("604", tony.id))) as { instructor: { adiNumber: string } };
  assert.equal(res.instructor.adiNumber, "604");
  assert.equal(await adiOf(db, tony.id), "604");
});

test("a signed-in instructor cannot change ANOTHER active instructor's ADI number, and nothing is written", async () => {
  const { db, tony, anna } = await twoInstructors();
  await updateInstructorAdiNumber(db, anna.id, "358");
  await assert.rejects(() => patchInstructor(db, anna.id, patchRequest("999", tony.id)), (e) => e instanceof ValidationError && /Only Anna can change their own ADI number/.test(e.message));
  assert.equal(await adiOf(db, anna.id), "358");
});

test("a client-submitted actingInstructorId in the body cannot replace the verified header", async () => {
  const { db, tony, anna } = await twoInstructors();
  await updateInstructorAdiNumber(db, anna.id, "358");
  await assert.rejects(() => patchInstructor(db, anna.id, patchRequest("999", tony.id, anna.id)), ValidationError);
  assert.equal(await adiOf(db, anna.id), "358");
});

test("with no verified identity (local dev / tests) the number can still be set, as before", async () => {
  const { db, anna } = await twoInstructors();
  await patchInstructor(db, anna.id, patchRequest("358"));
  assert.equal(await adiOf(db, anna.id), "358");
});

test("an unknown acting instructor is refused and nothing is written", async () => {
  const { db, anna } = await twoInstructors();
  await assert.rejects(() => patchInstructor(db, anna.id, patchRequest("358", "no-such-instructor")), /Acting instructor not found/);
  assert.equal(await adiOf(db, anna.id), null);
});

test("an INACTIVE instructor's number can be set by an active one (nobody else can)", async () => {
  const { db, tony, anna } = await twoInstructors();
  await db.prepare("UPDATE instructors SET status = 'inactive' WHERE id = ?").bind(anna.id).run();
  await patchInstructor(db, anna.id, patchRequest("358", tony.id));
  assert.equal(await adiOf(db, anna.id), "358");
});

test("validation still applies: an empty number is rejected even for the instructor themselves", async () => {
  const { db, tony } = await twoInstructors();
  await assert.rejects(() => patchInstructor(db, tony.id, patchRequest("  ", tony.id)), /ADI number is required/);
});

test("the route wrapper answers a refused change with HTTP 400 and the message, and writes nothing", async () => {
  const { db, tony, anna } = await twoInstructors();
  await updateInstructorAdiNumber(db, anna.id, "358");
  const res = await handle(() => patchInstructor(db, anna.id, patchRequest("999", tony.id)));
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: string }).error, /Only Anna can change their own ADI number/);
  assert.equal(await adiOf(db, anna.id), "358");
});

test("the route wrapper answers an allowed change with HTTP 200", async () => {
  const { db, tony } = await twoInstructors();
  const res = await handle(() => patchInstructor(db, tony.id, patchRequest("604", tony.id)));
  assert.equal(res.status, 200);
  assert.equal(await adiOf(db, tony.id), "604");
});
