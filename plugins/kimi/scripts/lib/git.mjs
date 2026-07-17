import fs from "node:fs";
import path from "node:path";
import { isProbablyText } from "./fs.mjs";
import { runCommand } from "./process.mjs";

const MAX_UNTRACKED_FILE_BYTES = 24 * 1024;
const INLINE_DIFF_MAX_FILES = 2;
const INLINE_DIFF_MAX_BYTES = 256 * 1024;

function git(cwd, args, options = {}) {
  return runCommand("git", args, { cwd, timeoutMs: 60000, ...options });
}

export function isGitRepository(cwd) {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).stdout.trim() === "true";
}

function changedWorkingTreeFiles(cwd) {
  const staged = git(cwd, ["diff", "--cached", "--name-only"]).stdout.trim();
  const unstaged = git(cwd, ["diff", "--name-only"]).stdout.trim();
  const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"]).stdout.trim();
  return { staged, unstaged, untracked };
}

export function hasUncommittedChanges(cwd) {
  const { staged, unstaged, untracked } = changedWorkingTreeFiles(cwd);
  return Boolean(staged || unstaged || untracked);
}

export function detectDefaultBranch(cwd) {
  const head = git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head.status === 0 && head.stdout.trim()) {
    return head.stdout.trim().replace(/^origin\//, "");
  }
  for (const candidate of ["main", "master", "trunk"]) {
    if (git(cwd, ["rev-parse", "--verify", "--quiet", candidate]).status === 0) {
      return candidate;
    }
    if (git(cwd, ["rev-parse", "--verify", "--quiet", `origin/${candidate}`]).status === 0) {
      return candidate;
    }
  }
  return null;
}

// Decide what a review should cover. Mirrors the reference plugin: an explicit
// --base or --scope wins; otherwise a dirty working tree reviews the working
// tree, and a clean one reviews the branch against the default branch.
export function resolveReviewTarget(cwd, { base, scope } = {}) {
  if (base) {
    return {
      mode: "branch",
      label: `branch diff against ${base}`,
      baseRef: base,
      explicit: true,
    };
  }
  if (scope === "working-tree") {
    return { mode: "working-tree", label: "working tree diff", explicit: true };
  }
  if (scope === "branch") {
    const defaultBranch = detectDefaultBranch(cwd);
    if (!defaultBranch) {
      throw new Error("Could not detect the default branch. Pass --base <ref> explicitly.");
    }
    return {
      mode: "branch",
      label: `branch diff against ${defaultBranch}`,
      baseRef: defaultBranch,
      explicit: true,
    };
  }
  if (hasUncommittedChanges(cwd)) {
    return { mode: "working-tree", label: "working tree diff", explicit: false };
  }
  const defaultBranch = detectDefaultBranch(cwd);
  if (!defaultBranch) {
    throw new Error(
      "Working tree is clean and no default branch was detected. Pass --base <ref> to pick a review target.",
    );
  }
  return {
    mode: "branch",
    label: `branch diff against ${defaultBranch}`,
    baseRef: defaultBranch,
    explicit: false,
  };
}

function probeOutputSize(cwd, args) {
  // Run with a hard cap; one byte over the cap means "too large".
  const result = runCommand("git", args, {
    cwd,
    timeoutMs: 60000,
    maxBuffer: INLINE_DIFF_MAX_BYTES + 1,
  });
  if (result.error && result.error.code === "ENOBUFS") {
    return { output: null, tooLarge: true };
  }
  return { output: result.stdout ?? "", tooLarge: false, status: result.status };
}

function readUntrackedFileSnippet(cwd, relativePath) {
  const absolutePath = path.join(cwd, relativePath);
  try {
    const stat = fs.statSync(absolutePath);
    if (!stat.isFile() || stat.size > MAX_UNTRACKED_FILE_BYTES) {
      return null;
    }
    if (!isProbablyText(absolutePath)) {
      return null;
    }
    return fs.readFileSync(absolutePath, "utf8");
  } catch {
    return null;
  }
}

// Collect the review context (status, diffs, file lists) for the prompt.
// Small diffs are inlined into the prompt; large ones are summarized and the
// reviewer is told to inspect the diff itself with read-only git commands.
export function collectReviewContext(cwd, target) {
  const sections = [];
  let changedFiles = 0;
  let diffBytes = 0;
  let inlineDiff = null;

  if (target.mode === "branch") {
    const mergeBase = git(cwd, ["merge-base", "HEAD", target.baseRef]).stdout.trim();
    const commitRange = mergeBase ? `${mergeBase}..HEAD` : "HEAD";
    const reviewRange = `${target.baseRef}...HEAD`;

    const commitLog = git(cwd, ["log", "--oneline", "--decorate", commitRange]).stdout.trim();
    const diffStat = git(cwd, ["diff", "--stat", reviewRange]).stdout.trim();
    const nameOnly = git(cwd, ["diff", "--name-only", reviewRange]).stdout.trim();
    changedFiles = nameOnly ? nameOnly.split("\n").length : 0;

    sections.push({ title: "Commit Log", body: commitLog || "(no commits)" });
    sections.push({ title: "Diff Stat", body: diffStat || "(no diff)" });
    sections.push({ title: "Changed Files", body: nameOnly || "(none)" });

    const probe = probeOutputSize(cwd, [
      "diff",
      "--binary",
      "--no-ext-diff",
      "--submodule=diff",
      reviewRange,
    ]);
    diffBytes = probe.output ? Buffer.byteLength(probe.output) : INLINE_DIFF_MAX_BYTES + 1;
    if (!probe.tooLarge && changedFiles <= INLINE_DIFF_MAX_FILES) {
      inlineDiff = { title: "Branch Diff", body: probe.output || "(empty diff)" };
    }
  } else {
    const status = git(cwd, ["status", "--short", "--untracked-files=all"]).stdout.trim();
    const staged = git(cwd, ["diff", "--cached", "--name-only"]).stdout.trim();
    const unstaged = git(cwd, ["diff", "--name-only"]).stdout.trim();
    const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"]).stdout.trim();
    const fileSet = new Set(
      [...staged.split("\n"), ...unstaged.split("\n"), ...untracked.split("\n")].filter(Boolean),
    );
    changedFiles = fileSet.size;

    sections.push({ title: "Git Status", body: status || "(clean)" });

    const stagedProbe = probeOutputSize(cwd, [
      "diff",
      "--cached",
      "--binary",
      "--no-ext-diff",
      "--submodule=diff",
    ]);
    const unstagedProbe = probeOutputSize(cwd, [
      "diff",
      "--binary",
      "--no-ext-diff",
      "--submodule=diff",
    ]);
    diffBytes =
      (stagedProbe.output ? Buffer.byteLength(stagedProbe.output) : INLINE_DIFF_MAX_BYTES + 1) +
      (unstagedProbe.output ? Buffer.byteLength(unstagedProbe.output) : INLINE_DIFF_MAX_BYTES + 1);

    if (!stagedProbe.tooLarge && !unstagedProbe.tooLarge && changedFiles <= INLINE_DIFF_MAX_FILES) {
      const parts = [];
      if (stagedProbe.output?.trim()) {
        parts.push(`## Staged Diff\n${stagedProbe.output.trim()}`);
      }
      if (unstagedProbe.output?.trim()) {
        parts.push(`## Unstaged Diff\n${unstagedProbe.output.trim()}`);
      }
      for (const file of untracked.split("\n").filter(Boolean)) {
        const content = readUntrackedFileSnippet(cwd, file);
        if (content !== null) {
          parts.push(`## Untracked File: ${file}\n${content.trimEnd()}`);
        }
      }
      inlineDiff = { title: "Working Tree Diff", body: parts.join("\n\n") || "(empty diff)" };
    } else {
      const statParts = [];
      const stagedStat = git(cwd, ["diff", "--cached", "--stat"]).stdout.trim();
      const unstagedStat = git(cwd, ["diff", "--stat"]).stdout.trim();
      if (stagedStat) statParts.push(`Staged:\n${stagedStat}`);
      if (unstagedStat) statParts.push(`Unstaged:\n${unstagedStat}`);
      if (untracked) statParts.push(`Untracked files:\n${untracked}`);
      sections.push({ title: "Change Summary", body: statParts.join("\n\n") || "(no changes)" });
    }
  }

  return {
    target,
    sections,
    inlineDiff,
    changedFiles,
    diffBytes,
    inputMode: inlineDiff ? "inline-diff" : "self-collect",
  };
}
