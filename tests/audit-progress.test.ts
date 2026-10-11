import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Node 22.13 (CI) needs the flag to import .ts files; newer Node strips types by default.
const NODE_ARGS = ["--disable-warning=ExperimentalWarning", "--experimental-strip-types"];
// @ts-expect-error plain .mjs script without type declarations
import { auditProgress } from "../scripts/audit-progress.mjs";

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
const row = (learner: string, lessonNo: number | null, id: string, minute: number, result = "achieved") => ({
  learner_id: learner, lesson_no: lessonNo, record_source: lessonNo !== null && lessonNo < 0 ? "prior_instructor" : "app", competency_id: id, action: "assessed", result,
  created_at: `2026-09-01T00:${String(minute).padStart(2, "0")}:00.000Z`,
});
// Learner "bug": the reported History Edit result (17 only in a later lesson). Learner "clean": a valid forward chain.
const ROWS = [
  ...range(1, 16).map((id) => row("bug", 1, id, 1)), row("bug", 2, "review-1-17", 2), row("bug", 3, "17", 3),
  ...range(1, 17).map((id) => row("clean", 1, id, 1)), row("clean", 2, "review-1-17", 2),
];

test("audit: reports the old whole-history rule vs the current lesson-order rule per learner", () => {
  const report = auditProgress(ROWS);
  const bug = report.find((entry: { learnerId: string }) => entry.learnerId === "bug");
  const clean = report.find((entry: { learnerId: string }) => entry.learnerId === "clean");
  assert.equal(bug.old.review1_17, "achieved");
  assert.equal(bug.current.review1_17, "ready");
  assert.deepEqual(bug.differences, ["review1_17: achieved -> ready"]);
  assert.deepEqual(clean.differences, []);
});

test("audit CLI: reads a file (plain array or wrangler --json), prints DIFF lines, exit 1 on differences, 2 on bad input", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-"));
  const plain = join(dir, "plain.json");
  const wrangler = join(dir, "wrangler.json");
  const bad = join(dir, "bad.json");
  writeFileSync(plain, JSON.stringify(ROWS));
  writeFileSync(wrangler, JSON.stringify([{ results: ROWS, success: true }]));
  writeFileSync(bad, "{}");
  for (const file of [plain, wrangler]) {
    const run = spawnSync(process.execPath, NODE_ARGS.concat(["scripts/audit-progress.mjs", file]), { encoding: "utf8" });
    assert.equal(run.status, 1, run.stderr);
    assert.match(run.stdout, /^DIFF {2}bug$/m);
    assert.match(run.stdout, /^same {2}clean$/m);
    assert.match(run.stdout, /2 learner\(s\), 1 with differences\./);
  }
  assert.equal(spawnSync(process.execPath, NODE_ARGS.concat(["scripts/audit-progress.mjs", bad]), { encoding: "utf8" }).status, 2);
});
