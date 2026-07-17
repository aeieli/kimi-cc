---
description: Check that the Kimi CLI is installed and authenticated; manage the review gate
argument-hint: "[--enable-review-gate|--disable-review-gate]"
allowed-tools: Bash(node:*), Bash(npm:*), AskUserQuestion
---

Check whether Kimi is ready to use from Claude Code.

1. Run:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/kimi-companion.mjs" setup --json $ARGUMENTS
   ```

2. Present the result as a short status report: overall readiness, each check (Node.js, kimi CLI, authentication), review gate state, and the suggested next steps.

3. If the kimi CLI is missing, tell the user to install Kimi Code CLI first (see https://www.kimi.com/code/docs/en/) and re-run `/kimi:setup`.

4. If kimi is installed but not authenticated, tell the user to run `!kimi login` and then re-run `/kimi:setup`.

5. When the user passed `--enable-review-gate` or `--disable-review-gate`, confirm the new review gate state and briefly explain what it does: when enabled, a Stop hook runs a Kimi review of each Claude response and blocks the stop if it finds issues. Warn that the gate can create a long-running Claude/Kimi loop and may drain usage limits quickly, so it should only be enabled while actively monitoring the session.
