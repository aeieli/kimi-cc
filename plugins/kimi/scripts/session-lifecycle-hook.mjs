#!/usr/bin/env node
// Session lifecycle hook: on SessionStart, export the Claude session identity
// into CLAUDE_ENV_FILE so every later companion invocation is scoped to this
// session; on SessionEnd, kill this session's active jobs and drop its state.

import fs from "node:fs";
import { cleanupSessionJobs } from "./lib/jobs.mjs";
import { resolveStateDir } from "./lib/state.mjs";

function readHookInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return {};
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function main() {
  const eventName = process.argv[2] ?? "";
  const input = readHookInput();
  const cwd = input.cwd || process.cwd();

  if (eventName === "SessionStart") {
    const envFile = process.env.CLAUDE_ENV_FILE;
    if (!envFile) {
      return;
    }
    const lines = [];
    if (input.session_id) {
      lines.push(`export KIMI_COMPANION_SESSION_ID=${shellQuote(input.session_id)}`);
    }
    if (input.transcript_path) {
      lines.push(`export KIMI_COMPANION_TRANSCRIPT_PATH=${shellQuote(input.transcript_path)}`);
    }
    if (process.env.CLAUDE_PLUGIN_DATA) {
      lines.push(`export CLAUDE_PLUGIN_DATA=${shellQuote(process.env.CLAUDE_PLUGIN_DATA)}`);
    }
    if (lines.length > 0) {
      fs.appendFileSync(envFile, `${lines.join("\n")}\n`, "utf8");
    }
    return;
  }

  if (eventName === "SessionEnd") {
    const sessionId = input.session_id || process.env.KIMI_COMPANION_SESSION_ID;
    try {
      const stateDir = resolveStateDir(cwd);
      cleanupSessionJobs(stateDir, sessionId);
    } catch {
      // cleanup must never block session end
    }
  }
}

main();
