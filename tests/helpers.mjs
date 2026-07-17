import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const COMPANION_PATH = path.join(REPO_ROOT, "plugins", "kimi", "scripts", "kimi-companion.mjs");
export const FIXTURE_PATH = path.join(REPO_ROOT, "tests", "fake-kimi-fixture.mjs");

export function makeTempDir(prefix = "kimi-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

// Install the fake kimi binary into <temp>/bin and return env overrides that
// put it on PATH and isolate plugin state into <temp>/data.
export function makeTestEnv(tempDir) {
  const binDir = path.join(tempDir, "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const kimiPath = path.join(binDir, "kimi");
  fs.copyFileSync(FIXTURE_PATH, kimiPath);
  fs.chmodSync(kimiPath, 0o755);
  return {
    ...process.env,
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
    CLAUDE_PLUGIN_DATA: path.join(tempDir, "data"),
    KIMI_COMPANION_SESSION_ID: "test-session",
  };
}

export function initGitRepo(dir) {
  const git = (args) =>
    spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  fs.mkdirSync(dir, { recursive: true });
  git(["init"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "index.js"), "export const answer = 42;\n");
  git(["add", "."]);
  git(["commit", "-m", "initial"]);
  // Dirty the working tree so reviews target it.
  fs.writeFileSync(path.join(dir, "src", "index.js"), "export const answer = 43;\n");
  return dir;
}

export function runCompanion(env, cwd, args, { timeout = 30000 } = {}) {
  const result = spawnSync(process.execPath, [COMPANION_PATH, ...args], {
    cwd,
    env,
    encoding: "utf8",
    timeout,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}
