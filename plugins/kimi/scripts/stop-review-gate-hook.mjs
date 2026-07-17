#!/usr/bin/env node
// Stop hook: when the review gate is enabled, run a synchronous Kimi review of
// Claude's last response. Output {"decision":"block",...} to keep Claude working
// when the gate finds problems; exit 0 silently to allow the stop.

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getKimiAvailability } from "./lib/kimi.mjs";
import { interpolateTemplate, loadPromptTemplate } from "./lib/prompts.mjs";
import { loadConfig, loadState, resolveStateDir } from "./lib/state.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPANION_PATH = path.join(PLUGIN_ROOT, "scripts", "kimi-companion.mjs");
const GATE_TIMEOUT_MS = 15 * 60 * 1000;

function readHookInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

function block(reason) {
  process.stdout.write(`${JSON.stringify({ decision: "block", reason })}\n`);
  process.exit(0);
}

function main() {
  const input = readHookInput();
  const cwd = input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

  let stateDir;
  let config;
  try {
    stateDir = resolveStateDir(cwd);
    config = loadConfig(stateDir);
  } catch {
    process.exit(0);
  }
  if (!config.stopReviewGate) {
    process.exit(0);
  }

  // Never hard-block on a missing runtime: note it and allow the stop.
  if (!getKimiAvailability().available) {
    process.stderr.write("kimi review gate: kimi CLI not available; allowing stop.\n");
    process.exit(0);
  }

  try {
    const state = loadState(stateDir);
    const active = state.jobs.find((job) => job.status === "queued" || job.status === "running");
    if (active) {
      process.stderr.write(`kimi review gate: job ${active.id} is still running in the background.\n`);
    }
  } catch {
    // ignore
  }

  const lastMessage = String(input.last_assistant_message ?? "").trim();
  if (!lastMessage) {
    process.exit(0);
  }

  const template = loadPromptTemplate(PLUGIN_ROOT, "stop-review-gate");
  const prompt = interpolateTemplate(template, {
    CLAUDE_RESPONSE_BLOCK: `Previous Claude response:\n${lastMessage}`,
  });

  const result = spawnSync(process.execPath, [COMPANION_PATH, "task", "--json", prompt], {
    cwd,
    encoding: "utf8",
    timeout: GATE_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    const detail = result.error
      ? String(result.error.message ?? result.error)
      : (result.stderr ?? "").trim().split("\n").slice(-3).join(" ");
    block(`Kimi stop-time review could not complete (${detail || "unknown error"}). Allow the stop only after checking the turn manually, or fix the gate setup with /kimi:setup.`);
    return;
  }

  let rawOutput = "";
  try {
    rawOutput = String(JSON.parse(result.stdout)?.rawOutput ?? "");
  } catch {
    block("Kimi stop-time review returned unparseable output; check /kimi:status for details.");
    return;
  }

  const firstLine = rawOutput.trim().split("\n")[0] ?? "";
  if (/^ALLOW:/i.test(firstLine)) {
    process.exit(0);
  }
  const reason = firstLine.replace(/^BLOCK:\s*/i, "").trim() || rawOutput.trim().slice(0, 400);
  block(
    `Kimi stop-time review found issues that still need fixes before ending the session: ${reason}`,
  );
}

main();
