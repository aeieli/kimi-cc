#!/usr/bin/env node
// Fake `kimi` binary for tests. Emits stream-json events like the real CLI:
// a tool call, an assistant message, and a session.resume_hint meta event.
// Behaviors toggled via the prompt text:
//   contains "FAIL_ME"      -> exit 1 with an error on stderr
//   contains "SLEEP_MS=<n>" -> sleep n ms before answering (for cancel tests)
//   contains "FAIL_ME"      -> exit 1 with an error on stderr
//   contains "SLEEP_MS=<n>" -> sleep n ms before answering (for cancel tests)
//   contains "REVIEW_JSON" or the review schema's "verdict" key
//                           -> answer with a structured review JSON object

const args = process.argv.slice(2);
const promptIndex = args.indexOf("-p");
const prompt = promptIndex === -1 ? "" : (args[promptIndex + 1] ?? "");
const sessionIndex = args.indexOf("--session");
const requestedSession = sessionIndex === -1 ? null : args[sessionIndex + 1];

if (args.includes("--version")) {
  process.stdout.write("0.26.0\n");
  process.exit(0);
}
if (args.includes("--help")) {
  process.stdout.write("Usage: kimi [options]\n  -p, --prompt <prompt>  Run one prompt non-interactively\n");
  process.exit(0);
}
if (requestedSession === "bogus-id-123") {
  process.stderr.write('error: failed to run prompt: Session "bogus-id-123" not found.\n');
  process.exit(1);
}
if (prompt.includes("FAIL_ME")) {
  process.stderr.write("error: failed to run prompt: simulated failure.\n");
  process.exit(1);
}

const sleepMatch = prompt.match(/SLEEP_MS=(\d+)/);
const sleepMs = sleepMatch ? Number(sleepMatch[1]) : 0;

const sessionId = requestedSession ?? "session_fake-0000-1111-2222";

let finalText;
const wantsReviewJson = prompt.includes("REVIEW_JSON") || prompt.includes('"verdict"');
if (wantsReviewJson) {
  finalText = JSON.stringify({
    verdict: "needs-attention",
    summary: "One real issue found.",
    findings: [
      {
        severity: "high",
        title: "Unchecked error",
        body: "The error path is swallowed.",
        file: "src/index.js",
        line_start: 10,
        line_end: 12,
        confidence: 0.8,
        recommendation: "Handle the error explicitly.",
      },
    ],
    next_steps: ["Add a regression test."],
  });
} else {
  finalText = `FAKE_KIMI_REPLY: ${prompt.slice(0, 80)}`;
}

function emit() {
  if (!wantsReviewJson) {
    process.stdout.write(
      `${JSON.stringify({ role: "assistant", tool_calls: [{ type: "function", id: "tool_1", function: { name: "Bash", arguments: "{}" } }] })}\n`,
    );
    process.stdout.write(`${JSON.stringify({ role: "tool", tool_call_id: "tool_1", content: "ok" })}\n`);
  }
  process.stdout.write(`${JSON.stringify({ role: "assistant", content: finalText })}\n`);
  process.stdout.write(
    `${JSON.stringify({
      role: "meta",
      type: "session.resume_hint",
      session_id: sessionId,
      command: `kimi -r ${sessionId}`,
      content: `To resume this session: kimi -r ${sessionId}`,
    })}\n`,
  );
  process.exit(0);
}

if (sleepMs > 0) {
  setTimeout(emit, sleepMs);
} else {
  emit();
}
