---
description: Run a read-only Kimi review of the current changes
argument-hint: "[--base <ref>] [--scope <auto|working-tree|branch>] [--model <alias>] [--wait|--background]"
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
disable-model-invocation: true
---

Run a Kimi review of the user's current work. This command is review-only: you MUST NOT modify any files or apply fixes; return Kimi's output verbatim.

## Review target

- `--base <ref>` reviews the branch diff against `<ref>`.
- `--scope working-tree|branch|auto` forces a target; `auto` (default) reviews the working tree when dirty, otherwise the branch against the default branch.
- This command does not accept custom focus text; if the user supplied any, tell them to use `/kimi:adversarial-review` instead and stop.

## Execution mode

- If the user passed `--wait`, run in the foreground.
- If the user passed `--background`, run in the background.
- Otherwise estimate the review size first with `git status --short --untracked-files=all`, `git diff --shortstat --cached`, `git diff --shortstat` (working tree) or `git diff --shortstat <base>...HEAD` (branch review). Recommend waiting only when the review is clearly tiny, roughly 1-2 files. Then use AskUserQuestion exactly once with options `Wait for results` (recommended first, with "(Recommended)" suffix, only when tiny) and `Run in background`.

## Foreground

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" review "$ARGUMENTS"
```

Return the command stdout verbatim, exactly as-is. Do not summarize, condense, or reorder it.

## Background

Run the same command with `run_in_background: true` and do not poll its output. Then tell the user:

"Kimi review started in the background. Check `/kimi:status` for progress and `/kimi:result` when it completes."
