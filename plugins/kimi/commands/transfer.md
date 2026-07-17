---
description: Hand the current Claude Code session context over to a resumable Kimi session
argument-hint: "[--source <claude-jsonl>]"
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" transfer "$ARGUMENTS"`

Present the command output to the user exactly as returned. Preserve the Kimi session ID and the `kimi -r <session-id>` command so the user can continue the work directly in Kimi.
