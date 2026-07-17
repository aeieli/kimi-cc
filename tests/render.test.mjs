import assert from "node:assert/strict";
import test from "node:test";
import {
  formatKimiResumeCommand,
  parseStructuredOutput,
  renderReviewResult,
} from "../plugins/kimi/scripts/lib/render.mjs";

test("parseStructuredOutput parses raw, fenced, and embedded JSON", () => {
  const raw = '{"verdict":"approve","summary":"ok","findings":[],"next_steps":[]}';
  assert.equal(parseStructuredOutput(raw).parsed.verdict, "approve");

  const fenced = `Here you go:\n\`\`\`json\n${raw}\n\`\`\``;
  assert.equal(parseStructuredOutput(fenced).parsed.verdict, "approve");

  const embedded = `prefix text ${raw} suffix`;
  assert.equal(parseStructuredOutput(embedded).parsed.summary, "ok");

  const bad = parseStructuredOutput("not json at all");
  assert.equal(bad.parsed, null);
  assert.ok(bad.parseError);

  assert.equal(parseStructuredOutput("").parseError, "empty output");
});

test("renderReviewResult sorts findings by severity and formats locations", () => {
  const parsed = {
    verdict: "needs-attention",
    summary: "Two issues.",
    findings: [
      { severity: "low", title: "nit", body: "minor", file: "b.js", line_start: 3, line_end: 3 },
      { severity: "critical", title: "boom", body: "bad", file: "a.js", line_start: 1, line_end: 5 },
    ],
    next_steps: ["fix it"],
  };
  const output = renderReviewResult({
    title: "Kimi Review",
    targetLabel: "working tree diff",
    parsed,
    parseError: null,
    rawOutput: "{}",
  });
  assert.match(output, /# Kimi Review/);
  assert.match(output, /Target: working tree diff/);
  assert.match(output, /Verdict: needs-attention/);
  assert.ok(output.indexOf("[critical] boom") < output.indexOf("[low] nit"));
  assert.match(output, /\(a\.js:1-5\)/);
  assert.match(output, /\(b\.js:3\)/);
  assert.match(output, /- fix it/);
});

test("renderReviewResult falls back to raw output on parse failure", () => {
  const output = renderReviewResult({
    title: "Kimi Review",
    targetLabel: "x",
    parsed: null,
    parseError: "output was not valid JSON",
    rawOutput: "some prose review",
  });
  assert.match(output, /unstructured review/);
  assert.match(output, /some prose review/);
  assert.match(output, /Parse note/);
});

test("formatKimiResumeCommand", () => {
  assert.equal(formatKimiResumeCommand({ kimiSessionId: "session_1" }), "kimi -r session_1");
  assert.equal(formatKimiResumeCommand({}), null);
});

test("findings with unknown severity are treated as low", () => {
  const parsed = {
    verdict: "approve",
    summary: "s",
    findings: [{ severity: "weird", title: "t", body: "b", file: "f", line_start: null, line_end: null }],
    next_steps: [],
  };
  const output = renderReviewResult({ title: "t", targetLabel: "x", parsed, parseError: null, rawOutput: "" });
  assert.match(output, /\[low\] t \(f\)/);
});
