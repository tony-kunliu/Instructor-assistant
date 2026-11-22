// Synthetic QA data only (created through the app's own API against the local QA copy).
const B = process.env.QA_BASE;
export const TONY = "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e01";
export const ANNA = "a1f3b6c2-2f1a-4b8e-9c6a-1a2b3c4d5e02";
const SIG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const post = async (path, instructorId, body) => {
  const r = await fetch(B + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-instructor-id": instructorId },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`${path} ${JSON.stringify(d)}`);
  return d;
};
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const ach = (ids) => Object.fromEntries(ids.map((id) => [id, "achieved"]));
async function seedLearner(fullName, instructorId, steps = []) {
  const { learner } = await post("/api/learners", instructorId, { fullName, instructorId });
  let odo = 1000;
  for (const step of steps) {
    const s = odo; odo += 12;
    await post(`/api/learners/${learner.id}/lessons`, instructorId, { lessonDate: "2026-09-20", startTime: "09:00", finishTime: "10:00", startOdometer: String(s), finishOdometer: String(odo), adiSignature: SIG, learnerSignature: SIG, ...step });
  }
  return learner.id;
}
const assess = (ids) => ({ assessedIds: ids, achievedResults: ach(ids) });
const upToR17 = [assess(range(1, 17)), assess(["review-1-17"])];
const upToR22 = [...upToR17, assess(range(18, 22)), assess(["review-1-22"])];

const ids = {};
ids.alpha = await seedLearner("QA Tony Alpha", TONY, [{ taughtIds: ["1", "2"] }]);
ids.bravo = await seedLearner("QA Tony Bravo", TONY);
ids.completed = await seedLearner("QA Tony Completed", TONY, [...upToR22, assess(["final-drive-23"])]);
ids.fdReady = await seedLearner("QA Tony FD Ready", TONY, upToR22);
ids.gateLocked = await seedLearner("QA Tony Gate Locked", TONY, [assess(range(1, 17))]);
ids.gateOpen = await seedLearner("QA Tony Gate Open", TONY, upToR17);
ids.saveErr = await seedLearner("QA Tony Save Errors", TONY, [{ taughtIds: ["1"] }]);
ids.charlie = await seedLearner("QA Anna Charlie", ANNA);
ids.delta = await seedLearner("QA Anna Delta", ANNA);
const { writeFileSync } = await import("node:fs");
writeFileSync(`${process.env.QA_OUT}/ids.json`, JSON.stringify(ids));
console.log("seeded", Object.keys(ids).length, "synthetic QA learners");
