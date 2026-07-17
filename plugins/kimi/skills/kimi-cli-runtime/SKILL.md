---
name: kimi-cli-runtime
description: Internal helper contract for calling the kimi-companion runtime from Claude Code
user-invocable: false
---

# Kimi Runtime

Use this skill only inside the `kimi:kimi-rescue` subagent.

Primary helper:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" task "<raw arguments>"
```

Contract:

- One Bash call per delegation. Do not batch, chain, or wrap the call.
- The helper runs `kimi -p` non-interactively; it auto-approves tool calls in the task's working directory. Add `--read-only` for investigations that must not change files.
- Strip `--background` and `--wait` — they are handled by the caller, not the runtime.
- `--resume` becomes `--resume-last` (continues the latest Kimi task session in this repo). `--fresh` passes no resume flag.
- `--model <alias>` passes through to `kimi -m <alias>`.
- Session continuity: the runtime records the Kimi session id of every run; `kimi -r <session-id>` reopens that session in the Kimi TUI.
- The helper prints the task's final output on stdout. Return it verbatim.
- If the Bash call fails or Kimi cannot be invoked, return stderr verbatim and nothing else.
