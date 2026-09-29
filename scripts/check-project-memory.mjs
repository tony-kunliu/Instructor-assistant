#!/usr/bin/env node
// Project Memory Guard — validates the repo's living documentation
// (README.md/AGENTS.md/STATUS.md/TASK.md), nothing else. See AGENTS.md's
// "Definition of Done" rule: a task that merges into staging/main isn't
// complete until this check passes. Exits non-zero with a clear reason on
// any failure; never touches files.

import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const failures = [];

function fail(message) {
  failures.push(message);
}

function readFile(relPath) {
  return readFileSync(new URL(relPath, ROOT), "utf8");
}

// A. Required files exist.
const REQUIRED_FILES = ["README.md", "AGENTS.md", "STATUS.md", "TASK.md"];
for (const relPath of REQUIRED_FILES) {
  if (!existsSync(new URL(relPath, ROOT))) {
    fail(`Missing required file: ${relPath}`);
  }
}
if (failures.length > 0) {
  reportAndExit();
}

const statusText = readFile("STATUS.md");
const taskText = readFile("TASK.md");

// B. Size limits.
const SIZE_LIMITS = [
  { relPath: "STATUS.md", text: statusText, maxBytes: 10 * 1024 },
  { relPath: "TASK.md", text: taskText, maxBytes: 4 * 1024 },
];
for (const { relPath, text, maxBytes } of SIZE_LIMITS) {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxBytes) {
    fail(`${relPath} is ${bytes} bytes, over the ${maxBytes}-byte limit — trim it back to current-state-only content (see AGENTS.md's Definition of Done).`);
  }
}

// C. Stale post-merge wording guard — a short, stable list of phrases that
// only ever make sense while a PR is still open. If a merge lands without
// updating these files, one of these phrases is the tell.
const STALE_PHRASES = ["awaiting review", "awaiting merge", "not yet merged into staging", "review/merge this documentation", "review and merge docs cleanup"];
for (const { relPath, text } of [
  { relPath: "STATUS.md", text: statusText },
  { relPath: "TASK.md", text: taskText },
]) {
  const lower = text.toLowerCase();
  for (const phrase of STALE_PHRASES) {
    if (lower.includes(phrase)) {
      fail(`${relPath} contains stale post-merge wording: "${phrase}" — update it to reflect the current merged state.`);
    }
  }
}

// D. Integration current-state sanity — check for the most stable key
// tokens only, not exact sentences, so normal wording changes don't break
// this check.
const INTEGRATION_TOKENS = [
  { label: "cross-repo compatibility PASS", pattern: /cross-repo compatibility[^\n]*pass/i },
  { label: "Integration enabled: NO", pattern: /integration enabled[^\n]*no/i },
  { label: "migration 0005 not applied", pattern: /migration[^\n]*0005[^\n]*not applied/i },
  { label: "coordinated non-Production Integration V1 QA PASS", pattern: /coordinated non-production integration v1 qa[^\n]*pass/i },
  { label: "Production rollout not authorized", pattern: /production rollout is not authorized/i },
];
for (const { label, pattern } of INTEGRATION_TOKENS) {
  if (!pattern.test(statusText)) {
    fail(`STATUS.md is missing the Integration current-state token: ${label}`);
  }
}

reportAndExit();

function reportAndExit() {
  if (failures.length > 0) {
    console.error("Project Memory Guard FAILED:\n");
    for (const message of failures) console.error(`  - ${message}`);
    console.error("\nSee AGENTS.md's Definition of Done and Documentation rules.");
    process.exit(1);
  }
  console.log("Project Memory Guard: PASS");
}
