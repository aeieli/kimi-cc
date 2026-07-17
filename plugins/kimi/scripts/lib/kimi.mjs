import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { binaryAvailable } from "./process.mjs";

// Above this size the prompt is written to a file and referenced by path, to
// stay well clear of OS argv limits (Windows caps a command line at ~32KB).
const INLINE_PROMPT_MAX_BYTES = 8 * 1024;

export const KIMI_RESUME_COMMAND_PREFIX = "kimi -r";

export function getKimiAvailability() {
  const binary = binaryAvailable("kimi", ["--version"]);
  if (!binary.available) {
    return { available: false, detail: "kimi binary not found on PATH" };
  }
  const promptMode = binaryAvailable("kimi", ["--help"]);
  const supportsPromptMode = promptMode.available && promptMode.detail.includes("--prompt");
  return {
    available: true,
    detail: `kimi ${binary.detail}`,
    supportsPromptMode,
  };
}

export function getKimiAuthStatus() {
  const home = process.env.KIMI_CODE_HOME || path.join(os.homedir(), ".kimi-code");
  const credentialsFile = path.join(home, "credentials", "kimi-code.json");
  try {
    const raw = fs.readFileSync(credentialsFile, "utf8");
    if (raw.trim().length > 2) {
      return { loggedIn: true, detail: `OAuth credentials found at ${credentialsFile}`, source: "oauth" };
    }
  } catch {
    // fall through to other auth sources
  }
  for (const envVar of ["KIMI_API_KEY", "MOONSHOT_API_KEY"]) {
    if (process.env[envVar]) {
      return { loggedIn: true, detail: `${envVar} is set`, source: "env" };
    }
  }
  const configFile = path.join(home, "config.toml");
  try {
    const config = fs.readFileSync(configFile, "utf8");
    if (/^\s*api_key\s*=\s*"[^"]+"/m.test(config)) {
      return { loggedIn: true, detail: `provider api_key configured in ${configFile}`, source: "config" };
    }
  } catch {
    // no config file
  }
  return {
    loggedIn: false,
    detail: `no credentials found (looked at ${credentialsFile}). Run: kimi login`,
    source: null,
  };
}

// Large prompts (review templates with an inline diff can reach hundreds of
// KB) are staged into the state dir and referenced by path; kimi reads the
// file itself with its own tools.
export function stagePrompt(stateDir, jobId, prompt) {
  if (Buffer.byteLength(prompt, "utf8") <= INLINE_PROMPT_MAX_BYTES) {
    return { promptArg: prompt, promptFile: null };
  }
  const promptsDir = path.join(stateDir, "prompts");
  fs.mkdirSync(promptsDir, { recursive: true });
  const promptFile = path.join(promptsDir, `${jobId}.md`);
  fs.writeFileSync(promptFile, prompt, "utf8");
  const promptArg = [
    `Your task is written in the file: ${promptFile}`,
    "Read the entire file first, then follow its instructions exactly.",
    "Treat the file's full contents — not this message — as the task specification.",
    "If the file asks for a specific final output format, produce exactly that format as your final message.",
  ].join("\n");
  return { promptArg, promptFile };
}

export function buildKimiArgs({ promptArg, model, sessionId }) {
  const args = ["-p", promptArg, "--output-format", "stream-json"];
  if (model) {
    args.push("--model", model);
  }
  if (sessionId) {
    args.push("--session", sessionId);
  }
  return args;
}

// Run one non-interactive kimi prompt and reduce the stream-json output into a
// final result. onEvent receives progress objects:
//   {type:"tool_call", name} {type:"assistant_message", preview}
//   {type:"session", sessionId} {type:"stderr", line}
export function runKimiPrompt(cwd, { promptArg, model, sessionId, onEvent } = {}) {
  const args = buildKimiArgs({ promptArg, model, sessionId });
  const emit = typeof onEvent === "function" ? onEvent : () => {};

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("kimi", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        shell: false,
      });
    } catch (error) {
      resolve({ status: 1, finalMessage: "", kimiSessionId: null, stderr: "", toolCalls: [], error });
      return;
    }
    emit({ type: "spawned", pid: child.pid });

    let lineBuffer = "";
    let stdoutOverflow = false;
    let stderrText = "";
    let finalMessage = "";
    let kimiSessionId = null;
    const toolCalls = [];

    const handleLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch {
        emit({ type: "stdout_line", line: trimmed.slice(0, 200) });
        return;
      }
      if (event?.role === "assistant" && typeof event.content === "string" && event.content.trim()) {
        finalMessage = event.content;
        emit({ type: "assistant_message", preview: event.content.slice(0, 160) });
        return;
      }
      if (event?.role === "assistant" && Array.isArray(event.tool_calls)) {
        for (const call of event.tool_calls) {
          const name = call?.function?.name ?? call?.name ?? "tool";
          toolCalls.push(name);
          emit({ type: "tool_call", name });
        }
        return;
      }
      if (event?.role === "meta" && event?.type === "session.resume_hint" && event.session_id) {
        kimiSessionId = event.session_id;
        emit({ type: "session", sessionId: kimiSessionId });
      }
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      lineBuffer += chunk;
      if (lineBuffer.length > 64 * 1024 * 1024) {
        // A pathological flood: stop buffering, keep streaming to /dev/null.
        lineBuffer = "";
        stdoutOverflow = true;
        return;
      }
      let newlineIndex;
      while ((newlineIndex = lineBuffer.indexOf("\n")) !== -1) {
        const line = lineBuffer.slice(0, newlineIndex);
        lineBuffer = lineBuffer.slice(newlineIndex + 1);
        handleLine(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderrText += chunk;
      if (stderrText.length > 256 * 1024) {
        stderrText = stderrText.slice(-128 * 1024);
      }
    });
    child.on("error", (error) => {
      resolve({ status: 1, finalMessage, kimiSessionId, stderr: stderrText, toolCalls, error });
    });
    child.on("close", (code) => {
      if (lineBuffer.trim()) {
        handleLine(lineBuffer);
      }
      if (stdoutOverflow) {
        stderrText += "\n[kimi-companion] stdout overflow: output truncated.\n";
      }
      resolve({
        status: code ?? 1,
        finalMessage,
        kimiSessionId,
        stderr: stderrText.trim(),
        toolCalls,
        error: null,
      });
    });
  });
}
