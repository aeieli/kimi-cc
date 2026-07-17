import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveWorkspaceRoot } from "./workspace.mjs";

const MAX_JOBS = 50;
const STATE_VERSION = 1;

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
  fs.writeFileSync(stateFile(stateDir), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export function upsertJob(stateDir, jobSummary) {
  const state = loadState(stateDir);
  const index = state.jobs.findIndex((job) => job.id === jobSummary.id);
  if (index === -1) {
    state.jobs.push(jobSummary);
  } else {
    state.jobs[index] = { ...state.jobs[index], ...jobSummary };
  }
  saveState(stateDir, state);
  return jobSummary;
}

export function removeJob(stateDir, jobId) {
  const state = loadState(stateDir);
  state.jobs = state.jobs.filter((job) => job.id !== jobId);
  saveState(stateDir, state);
  removeJobFiles(stateDir, jobId);
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
  fs.writeFileSync(jobFilePath(stateDir, job.id), `${JSON.stringify(job, null, 2)}\n`, "utf8");
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
  const state = loadState(stateDir);
  state.config = { ...state.config, ...config };
  saveState(stateDir, state);
  return state.config;
}

export function generateJobId(prefix = "job") {
  const time = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString("hex").slice(0, 6);
  return `${prefix}-${time}-${random}`;
}
