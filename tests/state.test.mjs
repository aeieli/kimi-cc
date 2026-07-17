import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  generateJobId,
  loadConfig,
  loadState,
  readJobFile,
  saveConfig,
  saveState,
  upsertJob,
  writeJobFile,
} from "../plugins/kimi/scripts/lib/state.mjs";
import { makeTempDir } from "./helpers.mjs";

test("state round-trips jobs and config", () => {
  const dir = makeTempDir();
  const state = loadState(dir);
  assert.deepEqual(state.jobs, []);
  assert.equal(state.config.stopReviewGate, false);

  state.jobs.push({ id: "job-1", updatedAt: "2026-01-01T00:00:00Z" });
  state.config.stopReviewGate = true;
  saveState(dir, state);

  const loaded = loadState(dir);
  assert.equal(loaded.jobs.length, 1);
  assert.equal(loaded.jobs[0].id, "job-1");
  assert.equal(loaded.config.stopReviewGate, true);

  const config = saveConfig(dir, { stopReviewGate: false });
  assert.equal(config.stopReviewGate, false);
  assert.equal(loadConfig(dir).stopReviewGate, false);
});

test("upsertJob patches by id and job files round-trip", () => {
  const dir = makeTempDir();
  upsertJob(dir, { id: "job-a", status: "queued", updatedAt: "2026-01-01T00:00:00Z" });
  upsertJob(dir, { id: "job-a", status: "running", updatedAt: "2026-01-01T00:01:00Z" });
  const state = loadState(dir);
  assert.equal(state.jobs.length, 1);
  assert.equal(state.jobs[0].status, "running");

  const job = { id: "job-a", status: "running", result: { rawOutput: "hi" } };
  writeJobFile(dir, job);
  assert.deepEqual(readJobFile(dir, "job-a"), job);
  assert.equal(readJobFile(dir, "missing"), null);
});

test("saveState prunes beyond 50 jobs and removes their files", () => {
  const dir = makeTempDir();
  const state = loadState(dir);
  for (let i = 0; i < 55; i += 1) {
    const id = `job-${String(i).padStart(3, "0")}`;
    state.jobs.push({ id, updatedAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}Z` });
    writeJobFile(dir, { id });
  }
  saveState(dir, state);
  const loaded = loadState(dir);
  assert.equal(loaded.jobs.length, 50);
  // Oldest five pruned; newest kept.
  assert.equal(fs.existsSync(path.join(dir, "jobs", "job-000.json")), false);
  assert.equal(fs.existsSync(path.join(dir, "jobs", "job-054.json")), true);
});

test("generateJobId produces prefixed unique ids", () => {
  const a = generateJobId("task");
  const b = generateJobId("task");
  assert.match(a, /^task-[a-z0-9]+-[a-f0-9]{6}$/);
  assert.notEqual(a, b);
});
