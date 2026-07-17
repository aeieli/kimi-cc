import fs from "node:fs";
import path from "node:path";
import {
  generateJobId,
  jobLogPath,
  loadState,
  readJobFile,
  removeJob,
  saveState,
  upsertJob,
  writeJobFile,
} from "./state.mjs";
import { terminateProcessTree } from "./process.mjs";

export const SESSION_ID_ENV = "KIMI_COMPANION_SESSION_ID";

const KIND_LABELS = {
  review: "review",
  "adversarial-review": "adversarial-review",
  task: "rescue",
  transfer: "transfer",
};

export function getJobKindLabel(kind) {
  return KIND_LABELS[kind] ?? kind;
}

export function createJobRecord(stateDir, workspaceRoot, { kind, title, summary, request }) {
  const id = generateJobId(kind === "adversarial-review" ? "review" : kind);
  const now = new Date().toISOString();
  const job = {
    id,
    kind,
    kindLabel: getJobKindLabel(kind),
    title,
    summary: summary ?? title,
    status: "queued",
    phase: "queued",
    workspaceRoot,
    sessionId: process.env[SESSION_ID_ENV] ?? null,
    kimiSessionId: null,
    pid: null,
    logFile: path.relative(stateDir, jobLogPath(stateDir, id)),
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    request: request ?? null,
    result: null,
    rendered: null,
  };
  fs.mkdirSync(path.join(stateDir, "jobs"), { recursive: true });
  writeJobFile(stateDir, job);
  upsertJob(stateDir, toJobSummary(job));
  return job;
}

export function toJobSummary(job) {
  const { request, result, rendered, ...summary } = job;
  return summary;
}

export function patchJob(stateDir, jobId, patch) {
  const job = readJobFile(stateDir, jobId);
  if (!job) {
    return null;
  }
  const updated = { ...job, ...patch, updatedAt: new Date().toISOString() };
  writeJobFile(stateDir, updated);
  upsertJob(stateDir, toJobSummary(updated));
  return updated;
}

export function appendLogLine(stateDir, jobId, line) {
  const logPath = jobLogPath(stateDir, jobId);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${line}\n`, "utf8");
}

export function appendLogBlock(stateDir, jobId, title, body) {
  const logPath = jobLogPath(stateDir, jobId);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `\n=== ${title} ===\n${body}\n`, "utf8");
}

// Wrap a runner with state bookkeeping: queued -> running -> completed/failed.
export async function runTrackedJob(stateDir, job, runner) {
  const startedAt = new Date().toISOString();
  patchJob(stateDir, job.id, {
    status: "running",
    phase: "starting",
    startedAt,
    pid: process.pid,
  });
  appendLogLine(stateDir, job.id, `job started (pid ${process.pid})`);
  try {
    const outcome = await runner({
      onPhase: (phase, extra = {}) => {
        const patch = { phase };
        if (extra.kimiSessionId) {
          patch.kimiSessionId = extra.kimiSessionId;
        }
        patchJob(stateDir, job.id, patch);
        appendLogLine(stateDir, job.id, `phase: ${phase}`);
      },
      onProgress: (line) => appendLogLine(stateDir, job.id, line),
    });
    // A concurrent cancel wins over the runner's terminal state.
    if (readJobFile(stateDir, job.id)?.status === "cancelled") {
      return { status: 1, error: new Error("Job was cancelled.") };
    }
    const completedAt = new Date().toISOString();
    patchJob(stateDir, job.id, {
      status: "completed",
      phase: "done",
      completedAt,
      pid: null,
      kimiSessionId: outcome.kimiSessionId ?? undefined,
      result: outcome.result ?? null,
      rendered: outcome.rendered ?? null,
    });
    if (outcome.rendered) {
      appendLogBlock(stateDir, job.id, "Final output", outcome.rendered);
    }
    return { status: 0, outcome };
  } catch (error) {
    if (readJobFile(stateDir, job.id)?.status === "cancelled") {
      return { status: 1, error: new Error("Job was cancelled.") };
    }
    const completedAt = new Date().toISOString();
    patchJob(stateDir, job.id, {
      status: "failed",
      phase: "failed",
      completedAt,
      pid: null,
      errorMessage: String(error?.message ?? error),
      rendered: error?.rendered ?? null,
    });
    appendLogLine(stateDir, job.id, `job failed: ${String(error?.message ?? error)}`);
    return { status: 1, error };
  }
}

export function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")));
}

export function filterJobsForCurrentSession(jobs) {
  const sessionId = process.env[SESSION_ID_ENV];
  if (!sessionId) {
    return jobs;
  }
  return jobs.filter((job) => !job.sessionId || job.sessionId === sessionId);
}

// Match a job by exact id, unique prefix, or (empty reference) newest first.
export function matchJobReference(jobs, reference) {
  const sorted = sortJobsNewestFirst(jobs);
  if (!reference) {
    return sorted[0] ?? null;
  }
  const exact = sorted.find((job) => job.id === reference);
  if (exact) {
    return exact;
  }
  const prefixMatches = sorted.filter((job) => job.id.startsWith(reference));
  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }
  if (prefixMatches.length > 1) {
    throw new Error(`Job reference "${reference}" is ambiguous (${prefixMatches.length} matches).`);
  }
  throw new Error(`No job matches "${reference}".`);
}

export function enrichJob(stateDir, job) {
  const enriched = { ...job, kindLabel: getJobKindLabel(job.kind) };
  const start = job.startedAt ? Date.parse(job.startedAt) : NaN;
  const end = job.completedAt ? Date.parse(job.completedAt) : Date.now();
  if (!Number.isNaN(start)) {
    const ms = Math.max(0, end - start);
    enriched.elapsedMs = ms;
    enriched.elapsed = formatDuration(ms);
  }
  try {
    const logPath = jobLogPath(stateDir, job.id);
    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
    enriched.progressPreview = lines
      .filter((line) => line.startsWith("[") && !line.includes("==="))
      .slice(-4);
  } catch {
    enriched.progressPreview = [];
  }
  return enriched;
}

export function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function buildStatusSnapshot(stateDir, { includeAllSessions = false, recentLimit = 8 } = {}) {
  const state = loadState(stateDir);
  const allJobs = sortJobsNewestFirst(state.jobs);
  const jobs = includeAllSessions ? allJobs : filterJobsForCurrentSession(allJobs);
  const running = jobs.filter((job) => job.status === "queued" || job.status === "running");
  const finished = jobs.filter((job) => ["completed", "failed", "cancelled"].includes(job.status));
  return {
    config: state.config,
    running: running.map((job) => enrichJob(stateDir, job)),
    latestFinished: finished[0] ? enrichJob(stateDir, finished[0]) : null,
    recent: jobs.slice(0, recentLimit).map((job) => enrichJob(stateDir, job)),
  };
}

export function resolveResultJob(stateDir, reference) {
  const state = loadState(stateDir);
  const job = matchJobReference(filterJobsForCurrentSession(state.jobs), reference);
  if (!job) {
    throw new Error("No finished jobs yet.");
  }
  if (job.status === "queued" || job.status === "running") {
    throw new Error(`Job ${job.id} is still ${job.status}. Check /kimi:status ${job.id} for progress.`);
  }
  return readJobFile(stateDir, job.id) ?? job;
}

export function resolveCancelableJob(stateDir, reference) {
  const state = loadState(stateDir);
  const active = filterJobsForCurrentSession(state.jobs).filter(
    (job) => job.status === "queued" || job.status === "running",
  );
  if (active.length === 0) {
    throw new Error("No active jobs to cancel.");
  }
  if (!reference) {
    if (active.length === 1) {
      return active[0];
    }
    throw new Error(
      `Multiple active jobs (${active.map((job) => job.id).join(", ")}). Pass a job id to cancel.`,
    );
  }
  const job = matchJobReference(active, reference);
  if (!job) {
    throw new Error("No active job matches that reference.");
  }
  return job;
}

export function cancelJob(stateDir, job) {
  const killed = terminateProcessTree(job.pid);
  patchJob(stateDir, job.id, {
    status: "cancelled",
    phase: "cancelled",
    completedAt: new Date().toISOString(),
    pid: null,
    errorMessage: killed ? "Cancelled by user." : "Cancelled by user (process already gone).",
  });
  appendLogLine(stateDir, job.id, `job cancelled (pid ${job.pid ?? "unknown"}, killed=${killed})`);
  return killed;
}

// SessionEnd cleanup: kill this session's active jobs, drop its job records.
export function cleanupSessionJobs(stateDir, sessionId) {
  if (!sessionId) {
    return { killed: 0, removed: 0 };
  }
  const state = loadState(stateDir);
  let killed = 0;
  let removed = 0;
  for (const job of state.jobs) {
    if (job.sessionId !== sessionId) {
      continue;
    }
    if (job.status === "queued" || job.status === "running") {
      if (terminateProcessTree(job.pid)) {
        killed += 1;
      }
    }
    removeJob(stateDir, job.id);
    removed += 1;
  }
  return { killed, removed };
}
