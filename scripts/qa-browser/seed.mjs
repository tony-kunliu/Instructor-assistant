// Synthetic QA data only (created through the app's own API against the local QA copy).
const B = process.env.QA_BASE;
export const TONY = "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01";
export const ANNA = "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02";
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const j = async (path, method = "GET", body) => {
  const r = await fetch(B + path, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(`${path} ${JSON.stringify(d)}`);
  return d;
};
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const ach = (ids) => Object.fromEntries(ids.map((id) => [id, "achieved"]));
const mk = async (fullName, instructorId) => (await j("/api/learners", "POST", { fullName, instructorId })).learner;
async function lessons(learner, steps) {
  let odo = 1000;
  for (const step of steps) {
    const s = odo; odo += 12;
    await j(`/api/learners/${learner.id}/lessons`, "POST", { lessonDate: "2026-09-20", startTime: "09:00", finishTime: "10:00", startOdometer: String(s), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...step });
  }
}
const assess = (ids) => ({ assessedIds: ids, achievedResults: ach(ids) });
const upToR17 = [assess(range(1, 17)), assess(["review-1-17"])];
const upToR22 = [...upToR17, assess(range(18, 22)), assess(["review-1-22"])];

const ids = {};
ids.alpha = (await mk("QA Tony Alpha", TONY)).id;
await lessons({ id: ids.alpha }, [{ taughtIds: ["1", "2"] }]);
ids.bravo = (await mk("QA Tony Bravo", TONY)).id;
ids.completed = (await mk("QA Tony Completed", TONY)).id;
await lessons({ id: ids.completed }, [...upToR22, assess(["final-drive-23"])]);
ids.fdReady = (await mk("QA Tony FD Ready", TONY)).id;
await lessons({ id: ids.fdReady }, upToR22);
ids.gateLocked = (await mk("QA Tony Gate Locked", TONY)).id;
await lessons({ id: ids.gateLocked }, [assess(range(1, 17))]);
ids.gateOpen = (await mk("QA Tony Gate Open", TONY)).id;
await lessons({ id: ids.gateOpen }, upToR17);
ids.charlie = (await mk("QA Anna Charlie", ANNA)).id;
ids.delta = (await mk("QA Anna Delta", ANNA)).id;
const { writeFileSync } = await import("node:fs");
writeFileSync(`${process.env.QA_OUT}/ids.json`, JSON.stringify(ids));
console.log("seeded", Object.keys(ids).length, "synthetic QA learners");
