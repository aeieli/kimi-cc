---
description: Delegate a coding task or investigation to Kimi through the kimi-rescue subagent
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <alias>] <task>"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Hand the user's request to Kimi through the `kimi:kimi-rescue` subagent. Use the Agent tool with `subagent_type: "kimi:kimi-rescue"` and forward the user's raw request as the prompt. Do NOT call `Skill(kimi:kimi-rescue)` or `Skill(kimi:rescue)` — always use the Agent tool.

## Flags

- `--background` / `--wait` are Claude-side execution flags: strip them from the forwarded text. With `--background`, run the Agent tool itself in the background.
- `--model <alias>` is preserved and forwarded.
- `--resume` continues the latest Kimi task thread for this repo; `--fresh` forces a new thread.
- If neither `--resume` nor `--fresh` was given, first run:

  ```bash
  node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" task-resume-candidate --json
  ```

  If `available` is true, use AskUserQuestion exactly once: `Continue current Kimi thread` vs `Start a new Kimi thread` (put the recommended option first based on whether the request sounds like a follow-up), then add `--resume` or `--fresh` to the forwarded request accordingly.

## Output

The final user-visible response must be Kimi's output verbatim. The subagent is a thin forwarder only: one Bash call to `kimi-companion.mjs task ...`, returning that command's stdout as-is. Do not add your own summary before or after it.
