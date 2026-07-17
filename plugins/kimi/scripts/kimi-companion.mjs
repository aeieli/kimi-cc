#!/usr/bin/env node
// kimi-companion: CLI bridge between Claude Code slash commands and the Kimi CLI.
// Each subcommand runs one non-interactive `kimi -p` turn (tracked as a job in
// the per-repo state dir) and prints either rendered Markdown or --json.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeArgv, parseArgs } from "./lib/args.mjs";
import { expandHome, readStdinIfPiped } from "./lib/fs.mjs";
import { collectReviewContext, resolveReviewTarget } from "./lib/git.mjs";
import {
  SESSION_ID_ENV,
  buildStatusSnapshot,
  cancelJob,
  createJobRecord,
  enrichJob,
  filterJobsForCurrentSession,
  matchJobReference,
  patchJob,
  resolveCancelableJob,
  resolveResultJob,
  runTrackedJob,
  sortJobsNewestFirst,
} from "./lib/jobs.mjs";
import {
  getKimiAuthStatus,
  getKimiAvailability,
  runKimiPrompt,
  stagePrompt,
} from "./lib/kimi.mjs";
import { spawnDetached } from "./lib/process.mjs";
import { interpolateTemplate, loadPromptTemplate } from "./lib/prompts.mjs";
import {
  formatKimiResumeCommand,
  parseStructuredOutput,
  renderCancelReport,
  renderJobStatusReport,
  renderReviewResult,
  renderSetupReport,
  renderStatusReport,
  renderStoredJobResult,
  renderTaskResult,
  renderTransferResult,
} from "./lib/render.mjs";
import { loadConfig, loadState, readJobFile, resolveStateDir, saveConfig } from "./lib/state.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPANION_PATH = fileURLToPath(import.meta.url);

const USAGE = `Usage:
  node kimi-companion.mjs setup [--enable-review-gate|--disable-review-gate] [--json]
  node kimi-companion.mjs review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <alias>] [--json]
  node kimi-companion.mjs adversarial-review [--wait|--background] [--base <ref>] [--scope <auto|working-tree|branch>] [--model <alias>] [--json] [focus text]
  node kimi-companion.mjs task [--background] [--read-only] [--resume-last|--fresh] [--model <alias>] [--json] [prompt]
  node kimi-companion.mjs transfer [--source <claude-jsonl>] [--json]
  node kimi-companion.mjs status [job-id] [--all] [--wait] [--json]
  node kimi-companion.mjs result [job-id] [--json]
  node kimi-companion.mjs cancel [job-id] [--json]
`;

const TRANSCRIPT_PATH_ENV = "KIMI_COMPANION_TRANSCRIPT_PATH";
const STOP_GATE_MARKER = "Run a stop-gate review of the previous Claude turn.";

class CompanionError extends Error {}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function printPayload(payload, rendered, json) {
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(rendered);
  }
}

function resolveContext(options) {
  const cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateDir = resolveStateDir(cwd);
  return { cwd, workspaceRoot, stateDir };
}

function requireKimi() {
  const availability = getKimiAvailability();
  if (!availability.available) {
    throw new CompanionError(
      "The kimi CLI is not installed or not on PATH. Install Kimi Code first, then run /kimi:setup again.",
    );
  }
  return availability;
}

function readReviewSchema() {
  return fs.readFileSync(path.join(PLUGIN_ROOT, "schemas", "review-output.schema.json"), "utf8");
}

function composeReviewInput(context) {
  const parts = [];
  for (const section of context.sections) {
    parts.push(`## ${section.title}\n${section.body}`);
  }
  if (context.inlineDiff) {
    parts.push(`## ${context.inlineDiff.title}\n${context.inlineDiff.body}`);
  }
  return parts.join("\n\n") || "(no repository changes detected)";
}

function collectionGuidance(context) {
  if (context.inputMode === "inline-diff") {
    return "The full diff is included below; review it directly.";
  }
  return [
    "The change is too large to inline. Inspect the target diff yourself with read-only git commands",
    "(for example `git status`, `git diff --cached`, `git diff`, or `git diff <base>...HEAD`) run from the workspace root.",
    "Do not modify anything.",
  ].join("\n");
}

function buildReviewPrompt(kind, context, focus) {
  const template = loadPromptTemplate(PLUGIN_ROOT, kind === "adversarial-review" ? "adversarial-review" : "review");
  return interpolateTemplate(template, {
    TARGET_LABEL: context.target.label,
    WORKSPACE_ROOT: context.workspaceRoot ?? "",
    REVIEW_COLLECTION_GUIDANCE: collectionGuidance(context),
    REVIEW_INPUT: composeReviewInput(context),
    USER_FOCUS: focus?.trim() ? focus.trim() : "(none — challenge the overall design and risk areas)",
    OUTPUT_SCHEMA: readReviewSchema().trim(),
  });
}

// Run one kimi turn as a tracked job; returns the job outcome.
async function executeKimiJob(stateDir, job, { prompt, model, sessionId, phase }) {
  const { promptArg, promptFile } = stagePrompt(stateDir, job.id, prompt);
  if (promptFile) {
    patchJob(stateDir, job.id, { promptFile });
  }
  return runTrackedJob(stateDir, job, async ({ onPhase, onProgress }) => {
    onPhase(phase ?? "running");
    const result = await runKimiPrompt(job.workspaceRoot ?? stateDir, {
      promptArg,
      model,
      sessionId,
      onEvent: (event) => {
        if (event.type === "spawned" && event.pid) {
          patchJob(stateDir, job.id, { pid: event.pid });
        } else if (event.type === "tool_call") {
          onProgress(`tool: ${event.name}`);
        } else if (event.type === "session" && event.sessionId) {
          patchJob(stateDir, job.id, { kimiSessionId: event.sessionId });
        }
      },
    });
    if (result.status !== 0) {
      const detail = result.stderr || result.error?.message || `kimi exited with code ${result.status}`;
      const error = new CompanionError(`Kimi run failed: ${detail}`);
      error.rendered = `Kimi run failed.\n\n${detail}\n`;
      throw error;
    }
    return result;
  });
}

// ---------------------------------------------------------------- setup

function handleSetup(argv) {
  const options = parseArgs(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json", "enable-review-gate", "disable-review-gate"],
    aliasMap: { C: "cwd" },
  });
  const { stateDir } = resolveContext(options);

  let config = loadConfig(stateDir);
  const actionsTaken = [];
  if (options["enable-review-gate"] && !config.stopReviewGate) {
    config = saveConfig(stateDir, { stopReviewGate: true });
    actionsTaken.push("Review gate enabled.");
  } else if (options["disable-review-gate"] && config.stopReviewGate) {
    config = saveConfig(stateDir, { stopReviewGate: false });
    actionsTaken.push("Review gate disabled.");
  }

  const nodeVersion = process.version.match(/^v(\d+)\.(\d+)\.(\d+)$/);
  const nodeOk = nodeVersion
    ? Number(nodeVersion[1]) > 18 || (Number(nodeVersion[1]) === 18 && Number(nodeVersion[2]) >= 18)
    : false;
  const node = {
    available: nodeOk,
    detail: nodeOk ? `${process.version}` : `${process.version} (need >= 18.18)`,
  };
  const kimi = getKimiAvailability();
  const auth = getKimiAuthStatus();
  const ready = node.available && kimi.available && auth.loggedIn;

  const nextSteps = [];
  if (!kimi.available) {
    nextSteps.push("Install Kimi Code CLI (see https://www.kimi.com/code/docs/en/) and ensure `kimi` is on PATH.");
  } else if (!auth.loggedIn) {
    nextSteps.push("Authenticate with: !kimi login");
  }
  if (ready) {
    nextSteps.push("Try: /kimi:review or /kimi:rescue <task>");
  }
  if (!config.stopReviewGate) {
    nextSteps.push("Optional: /kimi:setup --enable-review-gate adds a stop-time Kimi review.");
  }

  const report = {
    ready,
    node,
    kimi,
    auth: { available: auth.loggedIn, loggedIn: auth.loggedIn, detail: auth.detail, source: auth.source },
    reviewGateEnabled: config.stopReviewGate,
    actionsTaken,
    nextSteps,
  };
  printPayload(report, renderSetupReport(report), options.json);
}

// ---------------------------------------------------------------- review

async function handleReview(argv, kind) {
  const options = parseArgs(argv, {
    valueOptions: ["cwd", "base", "scope", "model"],
    booleanOptions: ["json", "wait", "background"],
    aliasMap: { C: "cwd" },
  });
  const { workspaceRoot, stateDir } = resolveContext(options);
  requireKimi();

  const focus = options.positionals.join(" ").trim();
  if (kind === "review" && focus) {
    throw new CompanionError(
      "/kimi:review does not take focus text. Use /kimi:adversarial-review for a steerable review.",
    );
  }

  const target = resolveReviewTarget(workspaceRoot, {
    base: options.base,
    scope: options.scope ?? "auto",
  });
  const context = { ...collectReviewContext(workspaceRoot, target), workspaceRoot };
  const prompt = buildReviewPrompt(kind, context, focus);

  const title = kind === "adversarial-review" ? "Kimi Adversarial Review" : "Kimi Review";
  const job = createJobRecord(stateDir, workspaceRoot, {
    kind,
    title,
    summary: `${title}: ${target.label}`,
  });

  const { status, outcome, error } = await executeKimiJob(stateDir, job, {
    prompt,
    model: options.model,
    phase: "reviewing",
  }).then(async (tracked) => {
    if (tracked.status === 0) {
      const kimiResult = tracked.outcome;
      const parsed = parseStructuredOutput(kimiResult.finalMessage);
      const rendered = renderReviewResult({
        title,
        targetLabel: target.label,
        parsed: parsed.parsed,
        parseError: parsed.parseError,
        rawOutput: kimiResult.finalMessage,
        kimiSessionId: kimiResult.kimiSessionId,
      });
      patchJob(stateDir, job.id, {
        result: { ...parsed, kimiSessionId: kimiResult.kimiSessionId, toolCalls: kimiResult.toolCalls.length },
        rendered,
      });
      return { status: 0, outcome: { rendered, kimiSessionId: kimiResult.kimiSessionId } };
    }
    return tracked;
  });

  if (status !== 0) {
    const finalJob = readJobFile(stateDir, job.id);
    printPayload(
      { job: finalJob, error: String(error?.message ?? error) },
      finalJob?.rendered ?? `Kimi run failed: ${String(error?.message ?? error)}\n`,
      options.json,
    );
    process.exit(1);
  }
  const finalJob = readJobFile(stateDir, job.id);
  printPayload(
    { job: finalJob, kimiSessionId: outcome.kimiSessionId },
    outcome.rendered,
    options.json,
  );
}

// ---------------------------------------------------------------- task

function resolveTaskPrompt(options) {
  if (options["prompt-file"]) {
    return fs.readFileSync(expandHome(options["prompt-file"]), "utf8");
  }
  const positional = options.positionals.join(" ").trim();
  if (positional) {
    return positional;
  }
  const stdin = readStdinIfPiped();
  return stdin.trim();
}

function findLatestTaskJob(stateDir) {
  const state = loadState(stateDir);
  const candidates = sortJobsNewestFirst(state.jobs).filter(
    (job) => job.kind === "task" && job.kimiSessionId && !job.title?.includes(STOP_GATE_MARKER),
  );
  return candidates[0] ?? null;
}

async function runTaskJob(stateDir, job, { prompt, model, sessionId, readOnly }) {
  const effectivePrompt = readOnly
    ? `${prompt}\n\nConstraints: this is a read-only investigation. Do not modify, create, or delete any files; do not run write operations. Report findings only.`
    : prompt;
  const tracked = await executeKimiJob(stateDir, job, {
    prompt: effectivePrompt,
    model,
    sessionId,
    phase: "running",
  });
  if (tracked.status !== 0) {
    return tracked;
  }
  const kimiResult = tracked.outcome;
  const rendered = renderTaskResult({
    finalMessage: kimiResult.finalMessage,
    stderr: kimiResult.stderr,
  });
  patchJob(stateDir, job.id, {
    result: {
      rawOutput: kimiResult.finalMessage,
      kimiSessionId: kimiResult.kimiSessionId,
      toolCalls: kimiResult.toolCalls.length,
      stderr: kimiResult.stderr || null,
    },
    rendered,
  });
  return { status: 0, outcome: { rendered, kimiSessionId: kimiResult.kimiSessionId, rawOutput: kimiResult.finalMessage } };
}

async function handleTask(argv) {
  const options = parseArgs(argv, {
    valueOptions: ["cwd", "model", "prompt-file"],
    booleanOptions: ["json", "background", "read-only", "resume-last", "fresh"],
    aliasMap: { C: "cwd" },
  });
  const { workspaceRoot, stateDir } = resolveContext(options);
  requireKimi();

  const prompt = resolveTaskPrompt(options);
  if (!prompt) {
    throw new CompanionError("Task prompt is empty. Pass a prompt, e.g. /kimi:rescue fix the failing test.");
  }

  let sessionId = null;
  if (options["resume-last"]) {
    const latest = findLatestTaskJob(stateDir);
    if (!latest) {
      throw new CompanionError("No previous Kimi task found for this repository. Run without --resume-last first.");
    }
    sessionId = latest.kimiSessionId;
  }

  const isStopGate = prompt.includes(STOP_GATE_MARKER);
  const job = createJobRecord(stateDir, workspaceRoot, {
    kind: "task",
    title: isStopGate ? "Kimi Stop Gate Review" : "Kimi Rescue Task",
    summary: prompt.slice(0, 120),
    request: { prompt, model: options.model ?? null, sessionId, readOnly: Boolean(options["read-only"]) },
  });

  if (options.background) {
    patchJob(stateDir, job.id, { status: "queued" });
    const pid = spawnDetached(process.execPath, [
      COMPANION_PATH,
      "task-worker",
      "--cwd",
      workspaceRoot,
      "--job-id",
      job.id,
    ]);
    patchJob(stateDir, job.id, { pid });
    const message = `Kimi task started in the background as ${job.id}. Check /kimi:status ${job.id} for progress.\n`;
    printPayload({ job: readJobFile(stateDir, job.id), pid }, message, options.json);
    return;
  }

  const { status, outcome, error } = await runTaskJob(stateDir, job, {
    prompt,
    model: options.model,
    sessionId,
    readOnly: Boolean(options["read-only"]),
  });
  const finalJob = readJobFile(stateDir, job.id);
  if (status !== 0) {
    printPayload(
      { job: finalJob, error: String(error?.message ?? error) },
      finalJob?.rendered ?? `Kimi run failed: ${String(error?.message ?? error)}\n`,
      options.json,
    );
    process.exit(1);
  }
  printPayload(
    { job: finalJob, kimiSessionId: outcome.kimiSessionId, rawOutput: outcome.rawOutput },
    outcome.rendered,
    options.json,
  );
}

// Internal: detached worker that executes a queued background task.
async function handleTaskWorker(argv) {
  const options = parseArgs(argv, {
    valueOptions: ["cwd", "job-id"],
    booleanOptions: [],
    aliasMap: { C: "cwd" },
  });
  if (!options["job-id"]) {
    throw new CompanionError("task-worker requires --job-id.");
  }
  const { stateDir } = resolveContext(options);
  const job = readJobFile(stateDir, options["job-id"]);
  if (!job?.request) {
    throw new CompanionError(`No stored request for job ${options["job-id"]}.`);
  }
  const { status } = await runTaskJob(stateDir, job, job.request);
  process.exit(status);
}

function handleTaskResumeCandidate(argv) {
  const options = parseArgs(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"],
    aliasMap: { C: "cwd" },
  });
  const { stateDir } = resolveContext(options);
  const latest = findLatestTaskJob(stateDir);
  const payload = {
    available: Boolean(latest),
    kimiSessionId: latest?.kimiSessionId ?? null,
    candidate: latest
      ? {
          id: latest.id,
          status: latest.status,
          title: latest.title,
          summary: latest.summary,
          kimiSessionId: latest.kimiSessionId,
          completedAt: latest.completedAt,
          updatedAt: latest.updatedAt,
        }
      : null,
  };
  const text = latest
    ? `Latest Kimi task: ${latest.id} (${latest.status}) — session ${latest.kimiSessionId}\n`
    : "No previous Kimi task for this repository.\n";
  printPayload(payload, text, options.json);
}

// ---------------------------------------------------------------- transfer

function resolveClaudeSessionPath(source) {
  const candidate = source ?? process.env[TRANSCRIPT_PATH_ENV];
  if (!candidate) {
    throw new CompanionError(
      "No Claude transcript available. Pass --source <path-to-session.jsonl> (the session hook normally supplies it).",
    );
  }
  const expanded = expandHome(candidate);
  if (!expanded.endsWith(".jsonl")) {
    throw new CompanionError(`Transcript must be a .jsonl file: ${expanded}`);
  }
  let realPath;
  try {
    realPath = fs.realpathSync(expanded);
  } catch {
    throw new CompanionError(`Transcript not found: ${expanded}`);
  }
  const projectsRoot = path.join(os.homedir(), ".claude", "projects");
  if (path.relative(projectsRoot, realPath).startsWith("..")) {
    throw new CompanionError(`Transcript must live under ${projectsRoot}: ${realPath}`);
  }
  return realPath;
}

function extractTextContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
  }
  return "";
}

function extractTranscriptDigest(transcriptPath, { maxMessages = 30, maxBytes = 24 * 1024, perMessage = 1500 } = {}) {
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  const messages = [];
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const role = record?.message?.role ?? (record?.type === "user" || record?.type === "assistant" ? record.type : null);
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    const text = extractTextContent(record?.message?.content ?? record?.content).trim();
    if (!text) {
      continue;
    }
    messages.push(`[${role}] ${text.slice(0, perMessage)}`);
  }
  const recent = messages.slice(-maxMessages);
  let digest = recent.join("\n\n");
  while (Buffer.byteLength(digest, "utf8") > maxBytes && recent.length > 4) {
    recent.shift();
    digest = `(earlier messages omitted)\n\n${recent.join("\n\n")}`;
  }
  return digest || "(transcript contained no user/assistant text)";
}

async function handleTransfer(argv) {
  const options = parseArgs(argv, {
    valueOptions: ["cwd", "source", "model"],
    booleanOptions: ["json"],
    aliasMap: { C: "cwd" },
  });
  const { workspaceRoot, stateDir } = resolveContext(options);
  requireKimi();

  const sourcePath = resolveClaudeSessionPath(options.source);
  const digest = extractTranscriptDigest(sourcePath);
  const template = loadPromptTemplate(PLUGIN_ROOT, "transfer");
  const prompt = interpolateTemplate(template, {
    WORKSPACE_ROOT: workspaceRoot,
    SOURCE_PATH: sourcePath,
    TRANSCRIPT_DIGEST: digest,
  });

  const job = createJobRecord(stateDir, workspaceRoot, {
    kind: "transfer",
    title: "Kimi Session Transfer",
    summary: `Transfer Claude session ${path.basename(sourcePath, ".jsonl")} to Kimi`,
  });
  const { status, outcome, error } = await executeKimiJob(stateDir, job, {
    prompt,
    model: options.model,
    phase: "transferring",
  });
  const finalJob = readJobFile(stateDir, job.id);
  if (status !== 0) {
    printPayload(
      { job: finalJob, error: String(error?.message ?? error) },
      `Kimi transfer failed: ${String(error?.message ?? error)}\n`,
      options.json,
    );
    process.exit(1);
  }
  const kimiSessionId = outcome.kimiSessionId;
  if (!kimiSessionId) {
    printPayload(
      { job: finalJob, error: "kimi did not report a session id" },
      "Kimi transfer finished but no session id was reported; cannot build a resume command.\n",
      options.json,
    );
    process.exit(1);
  }
  const rendered = renderTransferResult({ kimiSessionId, sourcePath });
  patchJob(stateDir, job.id, {
    result: { kimiSessionId, sourcePath, acknowledgment: outcome.finalMessage ?? null },
    rendered: `${rendered}\nKimi acknowledgment:\n${(outcome.finalMessage ?? "").trim()}\n`,
  });
  printPayload(
    { job: readJobFile(stateDir, job.id), kimiSessionId, resumeCommand: `kimi -r ${kimiSessionId}` },
    rendered,
    options.json,
  );
}

// ---------------------------------------------------------------- status / result / cancel

async function handleStatus(argv) {
  const options = parseArgs(argv, {
    valueOptions: ["cwd", "timeout-ms", "poll-interval-ms"],
    booleanOptions: ["json", "all", "wait"],
    aliasMap: { C: "cwd" },
  });
  const { stateDir } = resolveContext(options);
  const reference = options.positionals[0] ?? null;

  if (!reference) {
    const snapshot = buildStatusSnapshot(stateDir, { includeAllSessions: Boolean(options.all) });
    printPayload(snapshot, renderStatusReport(snapshot), options.json);
    return;
  }

  const waitTimeout = Number(options["timeout-ms"] ?? 240_000);
  const pollInterval = Number(options["poll-interval-ms"] ?? 2_000);
  const deadline = Date.now() + waitTimeout;
  for (;;) {
    const state = loadState(stateDir);
    const job = matchJobReference(filterJobsForCurrentSession(state.jobs), reference);
    if (!job) {
      throw new CompanionError(`No job matches "${reference}".`);
    }
    const finished = !["queued", "running"].includes(job.status);
    if (finished || !options.wait || Date.now() >= deadline) {
      const enriched = enrichJob(stateDir, readJobFile(stateDir, job.id) ?? job);
      printPayload(enriched, renderJobStatusReport(enriched), options.json);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
}

function handleResult(argv) {
  const options = parseArgs(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"],
    aliasMap: { C: "cwd" },
  });
  const { stateDir } = resolveContext(options);
  const job = resolveResultJob(stateDir, options.positionals[0] ?? null);
  printPayload(job, renderStoredJobResult(job), options.json);
}

function handleCancel(argv) {
  const options = parseArgs(argv, {
    valueOptions: ["cwd"],
    booleanOptions: ["json"],
    aliasMap: { C: "cwd" },
  });
  const { stateDir } = resolveContext(options);
  const job = resolveCancelableJob(stateDir, options.positionals[0] ?? null);
  const killed = cancelJob(stateDir, job);
  printPayload({ job: readJobFile(stateDir, job.id), killed }, renderCancelReport(job, killed), options.json);
}

// ---------------------------------------------------------------- main

async function main() {
  const [subcommand, ...rest] = process.argv.slice(2);
  const argv = normalizeArgv(rest);
  switch (subcommand) {
    case "setup":
      handleSetup(argv);
      break;
    case "review":
      await handleReview(argv, "review");
      break;
    case "adversarial-review":
      await handleReview(argv, "adversarial-review");
      break;
    case "task":
      await handleTask(argv);
      break;
    case "task-worker":
      await handleTaskWorker(argv);
      break;
    case "task-resume-candidate":
      handleTaskResumeCandidate(argv);
      break;
    case "transfer":
      await handleTransfer(argv);
      break;
    case "status":
      await handleStatus(argv);
      break;
    case "result":
      handleResult(argv);
      break;
    case "cancel":
      handleCancel(argv);
      break;
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(USAGE);
      break;
    default:
      process.stderr.write(`Unknown subcommand: ${subcommand}\n\n${USAGE}`);
      process.exit(1);
  }
}

main().catch((error) => {
  fail(error instanceof CompanionError ? error.message : String(error?.stack ?? error));
});
