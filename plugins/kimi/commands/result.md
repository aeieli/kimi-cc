---
description: Show the stored final output of a finished Kimi job
argument-hint: "[job-id]"
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" result "$ARGUMENTS"`

Present the full command output to the user. Do not summarize or condense it. Preserve:

- the verdict, summary, findings, details, artifacts, and next steps
- file paths and line numbers exactly as reported
- error messages or parse errors
- follow-up commands such as `/kimi:status <id>` and `/kimi:review`
- the Kimi session id and the `kimi -r <session-id>` resume command when present
