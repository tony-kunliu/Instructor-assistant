import assert from "node:assert/strict";
import test from "node:test";
import { waitForAbortable } from "../lib/licence-photo-ocr.ts";

test("a timeout aborts pending image preparation immediately", async () => {
  let release!: (value: string) => void;
  const decode = new Promise<string>((resolve) => { release = resolve; });
  const controller = new AbortController();
  const waiting = waitForAbortable(decode, controller.signal);
  controller.abort(new Error("Scan timed out"));
  await assert.rejects(waiting, /Scan timed out/);
  release("decoded after timeout");
  await Promise.resolve();
});

test("completed image preparation keeps its result", async () => {
  const controller = new AbortController();
  assert.equal(await waitForAbortable(Promise.resolve("decoded"), controller.signal), "decoded");
});
