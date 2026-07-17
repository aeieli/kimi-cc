---
description: Run a steerable Kimi review that challenges the implementation and design
argument-hint: "[--base <ref>] [--scope <auto|working-tree|branch>] [--model <alias>] [--wait|--background] [focus text]"
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
disable-model-invocation: true
---

Run a Kimi adversarial review: a challenge review that questions the chosen implementation, design choices, tradeoffs, and assumptions — not just code details. This command is review-only: you MUST NOT modify any files or apply fixes; return Kimi's output verbatim.

## Review target and focus

- `--base <ref>` reviews the branch diff against `<ref>`; `--scope` forces a target; default `auto` behaves like `/kimi:review`.
- Any remaining text after the flags is the focus: specific risk areas or decisions to pressure-test (e.g. "challenge the caching and retry design").

## Execution mode

- `--wait` runs in the foreground; `--background` runs in the background.
- Otherwise estimate the review size first with `git status --short --untracked-files=all`, `git diff --shortstat --cached`, `git diff --shortstat` (working tree) or `git diff --shortstat <base>...HEAD` (branch review). Recommend waiting only when the review is clearly tiny, roughly 1-2 files. Then use AskUserQuestion exactly once with options `Wait for results` (recommended first, with "(Recommended)" suffix, only when tiny) and `Run in background`.

## Foreground

Run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" adversarial-review "$ARGUMENTS"
```

Return the command stdout verbatim, exactly as-is. Do not summarize, condense, or reorder it.

## Background

Run the same command with `run_in_background: true` and do not poll its output. Then tell the user:

"Kimi adversarial review started in the background. Check `/kimi:status` for progress and `/kimi:result` when it completes."
