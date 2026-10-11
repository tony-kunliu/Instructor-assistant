#!/usr/bin/env node
// Read-only CBT&A progress audit: old rule (whole history, origin/staging 87f328b) vs the current rule
// (Review / Final Drive valid only from STRICTLY EARLIER lessons, lib/competency.ts). No network, no DB:
// it only reads a JSON export you made yourself and prints, per learner, both statuses and any difference.
//
//   node --experimental-strip-types scripts/audit-progress.mjs <export.json>
//   (the flag is needed before Node 22.18, which imports the .ts rule files)
//
// The export is an array of rows {learner_id, lesson_no, record_source, competency_id, action, result,
// created_at}; a wrangler `--json` result ([{ results: [...] }]) is accepted too. A read-only query that
// produces it (run it yourself, e.g. `wrangler d1 execute DB --remote --json --command "..."`):
//   SELECT e.learner_id, l.lesson_no, l.record_source, e.competency_id, e.action, e.result, e.created_at
//   FROM competency_events e LEFT JOIN lessons l ON l.id = e.lesson_id ORDER BY e.learner_id, e.created_at;
// Exit code: 0 = no differences, 1 = differences found, 2 = bad input.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computeProgress as currentRule } from "../lib/competency.ts";
import { computeProgress as oldRule } from "./audit-progress/legacy-competency.ts";

const FIELDS = ["review1_17", "review1_22", "finalDrive23"];

function summary(progress) {
  return { review1_17: progress.review1_17.status, review1_22: progress.review1_22.status, finalDrive23: progress.finalDrive23.status, completed: progress.completed };
}

/** rows -> [{ learnerId, old, current, differences: string[] }], learners in first-seen order. */
export function auditProgress(rows) {
  const byLearner = new Map();
  for (const row of rows) {
    const learnerId = String(row.learner_id);
    const lessonNo = row.lesson_no === null || row.lesson_no === undefined ? undefined : Number(row.lesson_no);
    const event = {
      competencyId: String(row.competency_id),
      action: row.action,
      result: row.result ?? null,
      lessonId: `${learnerId}#${lessonNo ?? "?"}`,
      createdAt: String(row.created_at ?? ""),
      lessonNo,
    };
    if (!byLearner.has(learnerId)) byLearner.set(learnerId, []);
    byLearner.get(learnerId).push(event);
  }
  return [...byLearner].map(([learnerId, events]) => {
    // Same order lib/repo.ts#getCompetencyEvents reads them in.
    const ordered = [...events].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    const old = summary(oldRule(ordered));
    const current = summary(currentRule(ordered));
    const differences = [...FIELDS, "completed"].filter((key) => old[key] !== current[key]).map((key) => `${key}: ${old[key]} -> ${current[key]}`);
    return { learnerId, old, current, differences };
  });
}

function parseRows(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data) && data.length && Array.isArray(data[0]?.results)) return data.flatMap((part) => part.results);
  if (Array.isArray(data)) return data;
  throw new Error("expected a JSON array of rows (or a wrangler --json result)");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node scripts/audit-progress.mjs <export.json>");
    process.exit(2);
  }
  let rows;
  try {
    rows = parseRows(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`audit-progress: ${error.message}`);
    process.exit(2);
  }
  const report = auditProgress(rows);
  const fmt = (s) => `R1-17 ${s.review1_17}, R1-22 ${s.review1_22}, FD23 ${s.finalDrive23}, completed ${s.completed}`;
  for (const { learnerId, old, current, differences } of report) {
    console.log(`${differences.length ? "DIFF" : "same"}  ${learnerId}`);
    console.log(`      old:     ${fmt(old)}`);
    console.log(`      current: ${fmt(current)}`);
    for (const line of differences) console.log(`      ! ${line}`);
  }
  const changed = report.filter((entry) => entry.differences.length).length;
  console.log(`\n${report.length} learner(s), ${changed} with differences.`);
  process.exit(changed ? 1 : 0);
}
