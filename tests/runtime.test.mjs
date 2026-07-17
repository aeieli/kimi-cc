import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { initGitRepo, makeTempDir, makeTestEnv, runCompanion } from "./helpers.mjs";

function setupRepo() {
  const tempDir = makeTempDir();
  const env = makeTestEnv(tempDir);
  const repoDir = initGitRepo(`${tempDir}/repo`);
  return { tempDir, env, repoDir };
}

test("setup reports readiness with fake kimi on PATH", () => {
  const { env, repoDir } = setupRepo();
  const result = runCompanion(env, repoDir, ["setup", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.kimi.available, true);
  assert.equal(report.node.available, true);
  assert.equal(typeof report.reviewGateEnabled, "boolean");
});

test("task runs a prompt and records the kimi session", () => {
  const { env, repoDir } = setupRepo();
  const result = runCompanion(env, repoDir, ["task", "--json", "fix the bug"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kimiSessionId, "session_fake-0000-1111-2222");
  assert.match(payload.rawOutput, /FAKE_KIMI_REPLY: fix the bug/);
  assert.equal(payload.job.status, "completed");

  const status = runCompanion(env, repoDir, ["status", "--json"]);
  const snapshot = JSON.parse(status.stdout);
  assert.equal(snapshot.recent.length, 1);
  assert.equal(snapshot.recent[0].kimiSessionId, "session_fake-0000-1111-2222");

  const stored = runCompanion(env, repoDir, ["result"]);
  assert.equal(stored.status, 0, stored.stderr);
  assert.match(stored.stdout, /FAKE_KIMI_REPLY: fix the bug/);
  assert.match(stored.stdout, /kimi -r session_fake-0000-1111-2222/);
});

test("task failure surfaces a failed job", () => {
  const { env, repoDir } = setupRepo();
  const result = runCompanion(env, repoDir, ["task", "FAIL_ME now"]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Kimi run failed/);

  const candidate = runCompanion(env, repoDir, ["task-resume-candidate", "--json"]);
  const parsed = JSON.parse(candidate.stdout);
  // Failed runs still recorded the session hint? No: kimi exited non-zero, so
  // no resume hint was emitted and the candidate stays unavailable.
  assert.equal(parsed.available, false);
});

test("--resume-last continues the latest task session", () => {
  const { env, repoDir } = setupRepo();
  const first = runCompanion(env, repoDir, ["task", "--json", "first task"]);
  assert.equal(first.status, 0, first.stderr);

  const candidate = runCompanion(env, repoDir, ["task-resume-candidate", "--json"]);
  assert.equal(JSON.parse(candidate.stdout).available, true);

  const second = runCompanion(env, repoDir, ["task", "--json", "--resume-last", "follow up"]);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).kimiSessionId, "session_fake-0000-1111-2222");
});

test("review produces structured findings over the working tree diff", () => {
  const { env, repoDir } = setupRepo();
  const result = runCompanion(env, repoDir, ["review", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.job.status, "completed");
  assert.equal(payload.job.result.parsed.verdict, "needs-attention");
  assert.match(payload.job.rendered, /# Kimi Review/);
  assert.match(payload.job.rendered, /Target: working tree diff/);
  assert.match(payload.job.rendered, /\[high\] Unchecked error \(src\/index\.js:10-12\)/);
});

test("review rejects focus text for the plain review command", () => {
  const { env, repoDir } = setupRepo();
  const result = runCompanion(env, repoDir, ["review", "some focus text"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /adversarial-review/);
});

test("background task runs via detached worker and can be cancelled", () => {
  const { env, repoDir } = setupRepo();
  const started = runCompanion(env, repoDir, ["task", "--background", "SLEEP_MS=8000 investigate"]);
  assert.equal(started.status, 0, started.stderr);
  assert.match(started.stdout, /started in the background as (task-[a-z0-9-]+)/);
  const jobId = started.stdout.match(/started in the background as (task-[a-z0-9-]+)/)[1];

  // Wait for the worker to pick the job up.
  let statusPayload = null;
  for (let i = 0; i < 25; i += 1) {
    const status = runCompanion(env, repoDir, ["status", jobId, "--json"]);
    statusPayload = JSON.parse(status.stdout);
    if (statusPayload.status === "running") {
      break;
    }
    spawnSyncSleep(200);
  }
  assert.equal(statusPayload.status, "running");

  const cancelled = runCompanion(env, repoDir, ["cancel", jobId]);
  assert.equal(cancelled.status, 0, cancelled.stderr);
  assert.match(cancelled.stdout, new RegExp(`Cancelled ${jobId}`));

  const after = JSON.parse(runCompanion(env, repoDir, ["status", jobId, "--json"]).stdout);
  assert.equal(after.status, "cancelled");
});

test("large prompts are staged to a file and referenced by path", () => {
  const { env, repoDir } = setupRepo();
  const bigPrompt = `investigate ${"x".repeat(10 * 1024)}`;
  const result = runCompanion(env, repoDir, ["task", "--json", bigPrompt]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.ok(payload.job.promptFile, "expected a staged prompt file");
  // The fake kimi received the short wrapper prompt, not the big one.
  assert.match(payload.rawOutput, /Your task is written in the file/);
  assert.equal(fs.existsSync(payload.job.promptFile), true);
});

function spawnSyncSleep(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    // busy wait: short, test-only
  }
}
