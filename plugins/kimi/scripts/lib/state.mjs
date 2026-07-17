import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const MAX_JOBS = 50;
const STATE_VERSION = 1;
const LOCK_STALE_MS = 10000;
const LOCK_TIMEOUT_MS = 3000;
const LOCK_RETRY_MS = 15;

let tempFileCounter = 0;

function sanitizeSlug(input) {
  const slug = input.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "workspace";
}

export function resolveStateRoot() {
  const pluginData = process.env.CLAUDE_PLUGIN_DATA;
  if (pluginData) {
    return path.join(pluginData, "state");
  }
  return path.join(os.tmpdir(), "kimi-companion");
}

export function resolveStateDir(cwd = process.cwd()) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonicalRoot = workspaceRoot;
  try {
    canonicalRoot = fs.realpathSync(workspaceRoot);
  } catch {
    // keep unresolved path
  }
  const slug = sanitizeSlug(path.basename(canonicalRoot));
  const hash = crypto.createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 16);
  return path.join(resolveStateRoot(), `${slug}-${hash}`);
}

function stateFile(stateDir) {
  return path.join(stateDir, "state.json");
}

function jobsDir(stateDir) {
  return path.join(stateDir, "jobs");
}

export function jobFilePath(stateDir, jobId) {
  return path.join(jobsDir(stateDir), `${jobId}.json`);
}

export function jobLogPath(stateDir, jobId) {
  return path.join(jobsDir(stateDir), `${jobId}.log`);
}

// Same-directory temp file + rename: readers never see a truncated file.
function writeFileAtomicSync(target, data) {
  const temp = `${target}.${process.pid}.${tempFileCounter}.tmp`;
  tempFileCounter += 1;
  fs.writeFileSync(temp, data, "utf8");
  fs.renameSync(temp, target);
}

function lockDirPath(stateDir) {
  return path.join(stateDir, "state.lock");
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isStaleLock(lockDir) {
  try {
    return Date.now() - fs.statSync(lockDir).mtimeMs > LOCK_STALE_MS;
  } catch {
    // already gone
    return false;
  }
}

// mkdir is atomic: EEXIST means another process holds the lock. Returns false
// when the wait budget ran out — better to proceed unlocked than deadlock.
function acquireLock(stateDir) {
  fs.mkdirSync(stateDir, { recursive: true });
  const lockDir = lockDirPath(stateDir);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      fs.mkdirSync(lockDir);
      return true;
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
    if (isStaleLock(lockDir)) {
      try {
        fs.rmdirSync(lockDir);
      } catch {
        // another contender removed it first
      }
      continue;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    sleepSync(LOCK_RETRY_MS);
  }
}

function withLock(stateDir, fn) {
  const acquired = acquireLock(stateDir);
  try {
    return fn();
  } finally {
    if (acquired) {
      try {
        fs.rmdirSync(lockDirPath(stateDir));
      } catch {
        // removed already, e.g. stolen as stale
      }
    }
  }
}

export function loadState(stateDir) {
  try {
    const raw = fs.readFileSync(stateFile(stateDir), "utf8");
    const state = JSON.parse(raw);
    if (state && typeof state === "object") {
      return {
        version: STATE_VERSION,
        config: { stopReviewGate: false, ...(state.config ?? {}) },
        jobs: Array.isArray(state.jobs) ? state.jobs : [],
      };
    }
  } catch {
    // missing or corrupt state starts fresh
  }
  return { version: STATE_VERSION, config: { stopReviewGate: false }, jobs: [] };
}

export function saveState(stateDir, state) {
  fs.mkdirSync(jobsDir(stateDir), { recursive: true });
  const jobs = [...state.jobs]
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, MAX_JOBS);
  const pruned = new Set(jobs.map((job) => job.id));
  for (const job of state.jobs) {
    if (!pruned.has(job.id)) {
      removeJobFiles(stateDir, job.id);
    }
  }
  const payload = { version: STATE_VERSION, config: state.config, jobs };
  writeFileAtomicSync(stateFile(stateDir), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export function upsertJob(stateDir, jobSummary) {
  return withLock(stateDir, () => {
    const state = loadState(stateDir);
    const index = state.jobs.findIndex((job) => job.id === jobSummary.id);
    if (index === -1) {
      state.jobs.push(jobSummary);
    } else {
      state.jobs[index] = { ...state.jobs[index], ...jobSummary };
    }
    saveState(stateDir, state);
    return jobSummary;
  });
}

export function removeJob(stateDir, jobId) {
  withLock(stateDir, () => {
    const state = loadState(stateDir);
    state.jobs = state.jobs.filter((job) => job.id !== jobId);
    saveState(stateDir, state);
    removeJobFiles(stateDir, jobId);
  });
}

function removeJobFiles(stateDir, jobId) {
  for (const file of [jobFilePath(stateDir, jobId), jobLogPath(stateDir, jobId)]) {
    try {
      fs.unlinkSync(file);
    } catch {
      // already gone
    }
  }
}

export function writeJobFile(stateDir, job) {
  fs.mkdirSync(jobsDir(stateDir), { recursive: true });
  writeFileAtomicSync(jobFilePath(stateDir, job.id), `${JSON.stringify(job, null, 2)}\n`);
}

export function readJobFile(stateDir, jobId) {
  try {
    const raw = fs.readFileSync(jobFilePath(stateDir, jobId), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function loadConfig(stateDir) {
  return loadState(stateDir).config;
}

export function saveConfig(stateDir, config) {
  return withLock(stateDir, () => {
    const state = loadState(stateDir);
    state.config = { ...state.config, ...config };
    saveState(stateDir, state);
    return state.config;
  });
}

export function generateJobId(prefix = "job") {
  const time = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString("hex").slice(0, 6);
  return `${prefix}-${time}-${random}`;
}
