---
description: Show running and recent Kimi jobs for this repository
argument-hint: "[job-id] [--all] [--wait]"
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" status "$ARGUMENTS"`

- If the user gave no job id, render the command output as a single compact Markdown table: job id, kind, status, phase, elapsed or duration, summary, and follow-up commands (`/kimi:result <id>`, `/kimi:cancel <id>`).
- If the user gave a job id, present the full command output for that job, preserving progress lines, the Kimi session id, and the `kimi -r <session-id>` resume command.
