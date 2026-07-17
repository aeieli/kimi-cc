const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

export function formatKimiResumeCommand(job) {
  return job?.kimiSessionId ? `kimi -r ${job.kimiSessionId}` : null;
}

// The review schema is enforced in the prompt, not by the runtime, so be
// tolerant: accept a raw JSON body or a fenced ```json block.
export function parseStructuredOutput(rawOutput, fallback = {}) {
  const raw = String(rawOutput ?? "").trim();
  if (!raw) {
    return { parsed: null, parseError: "empty output", rawOutput: raw, ...fallback };
  }
  const candidates = [raw];
  const fenceMatch = raw.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    candidates.unshift(fenceMatch[1].trim());
  }
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of candidates) {
    try {
      return { parsed: JSON.parse(candidate), parseError: null, rawOutput: raw, ...fallback };
    } catch {
      // try next candidate
    }
  }
  return { parsed: null, parseError: "output was not valid JSON", rawOutput: raw, ...fallback };
}

function normalizeFindings(findings) {
  if (!Array.isArray(findings)) {
    return [];
  }
  return findings.map((finding) => ({
    severity: SEVERITY_ORDER.includes(finding?.severity) ? finding.severity : "low",
    title: String(finding?.title ?? "Untitled finding"),
    body: String(finding?.body ?? ""),
    file: String(finding?.file ?? "unknown"),
    line_start: Number.isInteger(finding?.line_start) ? finding.line_start : null,
    line_end: Number.isInteger(finding?.line_end) ? finding.line_end : null,
    recommendation: finding?.recommendation ? String(finding.recommendation) : null,
  }));
}

function sortFindings(findings) {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}

export function renderReviewResult({ title, targetLabel, parsed, parseError, rawOutput, kimiSessionId }) {
  const lines = [`# ${title}`, ""];
  if (targetLabel) {
    lines.push(`Target: ${targetLabel}`, "");
  }
  if (!parsed) {
    lines.push("Kimi returned an unstructured review:", "", rawOutput || "(no output)");
    if (parseError) {
      lines.push("", `> Parse note: ${parseError}`);
    }
    return `${lines.join("\n")}\n`;
  }
  const verdict = parsed.verdict === "approve" ? "approve" : "needs-attention";
  lines.push(`Verdict: ${verdict}`, "");
  if (parsed.summary) {
    lines.push(String(parsed.summary), "");
  }
  const findings = sortFindings(normalizeFindings(parsed.findings));
  if (findings.length > 0) {
    lines.push("Findings:", "");
    for (const finding of findings) {
      const location =
        finding.line_start !== null
          ? `${finding.file}:${finding.line_start}${finding.line_end && finding.line_end !== finding.line_start ? `-${finding.line_end}` : ""}`
          : finding.file;
      lines.push(`- [${finding.severity}] ${finding.title} (${location})`);
      if (finding.body) {
        lines.push(`  ${finding.body}`);
      }
      if (finding.recommendation) {
        lines.push(`  Recommendation: ${finding.recommendation}`);
      }
    }
    lines.push("");
  } else {
    lines.push("Findings: none.", "");
  }
  if (Array.isArray(parsed.next_steps) && parsed.next_steps.length > 0) {
    lines.push("Next steps:", "");
    for (const step of parsed.next_steps) {
      lines.push(`- ${String(step)}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderTaskResult({ finalMessage, stderr }) {
  const lines = [];
  if (finalMessage?.trim()) {
    lines.push(finalMessage.trim());
  } else {
    lines.push("(Kimi produced no final message.)");
  }
  if (stderr?.trim()) {
    lines.push("", "stderr:", "```", stderr.trim().split("\n").slice(-20).join("\n"), "```");
  }
  return `${lines.join("\n")}\n`;
}

export function renderSetupReport(report) {
  const lines = ["# Kimi Setup", ""];
  lines.push(`Status: ${report.ready ? "ready" : "not ready"}`, "");
  lines.push("Checks:", "");
  const check = (label, item) => {
    const mark = item?.available || item?.loggedIn ? "ok" : "missing";
    lines.push(`- ${label}: ${mark} — ${item?.detail ?? ""}`);
  };
  check("Node.js", report.node);
  check("kimi CLI", report.kimi);
  check("Authentication", report.auth);
  lines.push("");
  lines.push(`Review gate: ${report.reviewGateEnabled ? "enabled" : "disabled"}`, "");
  if (report.nextSteps?.length) {
    lines.push("Next steps:", "");
    for (const step of report.nextSteps) {
      lines.push(`- ${step}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function jobRow(job) {
  const session = job.kimiSessionId ? `\`${job.kimiSessionId}\`` : "-";
  const summary = (job.summary ?? job.title ?? "").replace(/\|/g, "\\|").slice(0, 60);
  return `| ${job.id} | ${job.kindLabel} | ${job.status} | ${job.phase ?? "-"} | ${job.elapsed ?? "-"} | ${session} | ${summary} |`;
}

export function renderStatusReport(snapshot) {
  const lines = ["# Kimi Status", ""];
  lines.push(`Review gate: ${snapshot.config?.stopReviewGate ? "enabled" : "disabled"}`, "");
  if (snapshot.running.length > 0) {
    lines.push("Active jobs:", "");
    lines.push("| Job | Kind | Status | Phase | Elapsed | Kimi Session | Summary |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const job of snapshot.running) {
      lines.push(jobRow(job));
    }
    lines.push("");
  } else {
    lines.push("No active jobs.", "");
  }
  if (snapshot.latestFinished) {
    lines.push(`Latest finished: ${snapshot.latestFinished.id} (${snapshot.latestFinished.status})`, "");
  }
  if (snapshot.recent.length > 0) {
    lines.push("Recent jobs:", "");
    lines.push("| Job | Kind | Status | Phase | Elapsed | Kimi Session | Summary |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const job of snapshot.recent) {
      lines.push(jobRow(job));
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderJobStatusReport(job) {
  const lines = [`# Kimi Job ${job.id}`, ""];
  lines.push(`- Kind: ${job.kindLabel}`);
  lines.push(`- Status: ${job.status} (${job.phase ?? "-"})`);
  lines.push(`- Summary: ${job.summary ?? job.title}`);
  if (job.elapsed) {
    lines.push(`- Elapsed: ${job.elapsed}`);
  }
  if (job.kimiSessionId) {
    lines.push(`- Kimi session: \`${job.kimiSessionId}\``);
    lines.push(`- Resume in Kimi: \`${formatKimiResumeCommand(job)}\``);
  }
  if (job.errorMessage) {
    lines.push(`- Error: ${job.errorMessage}`);
  }
  lines.push("");
  if (job.progressPreview?.length) {
    lines.push("Progress:", "");
    for (const line of job.progressPreview) {
      lines.push(`- ${line}`);
    }
    lines.push("");
  }
  if (job.status === "completed" || job.status === "failed") {
    lines.push(`Result: /kimi:result ${job.id}`, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderStoredJobResult(job) {
  const lines = [];
  if (job.rendered) {
    lines.push(job.rendered.trimEnd());
  } else if (job.result?.rawOutput) {
    lines.push(job.result.rawOutput);
  } else if (job.errorMessage) {
    lines.push(`Job ${job.id} ${job.status}: ${job.errorMessage}`);
  } else {
    lines.push(`Job ${job.id} ${job.status}. No stored output.`);
  }
  if (job.kimiSessionId) {
    lines.push("", `Kimi session ID: ${job.kimiSessionId}`, `Resume in Kimi: ${formatKimiResumeCommand(job)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderCancelReport(job, killed) {
  const lines = ["# Kimi Cancel", ""];
  lines.push(`Cancelled ${job.id}${killed ? "" : " (process was already gone)"}.`, "");
  lines.push(`Check /kimi:status ${job.id} for details.`, "");
  return `${lines.join("\n")}\n`;
}

export function renderTransferResult({ kimiSessionId, sourcePath }) {
  const lines = [
    "Transferred the Claude session context into a Kimi session.",
    "",
    `Kimi session ID: ${kimiSessionId}`,
    `Resume in Kimi: kimi -r ${kimiSessionId}`,
  ];
  if (sourcePath) {
    lines.push(`Source transcript: ${sourcePath}`);
  }
  return `${lines.join("\n")}\n`;
}
