---
name: kimi-result-handling
description: Internal guidance for presenting Kimi helper output back to the user
user-invocable: false
---

# Kimi Result Handling

When the helper returns Kimi output:

- Preserve the helper's verdict, summary, findings, and next steps structure.
- For review output, present findings first and keep them ordered by severity.
- Use the file paths and line numbers exactly as the helper reports them.
- Keep the Kimi session id and the `kimi -r <session-id>` resume command visible so the user can continue the run in Kimi.
- If the helper reports that Kimi failed or could not run, relay the error as-is. Do not turn a failed Kimi run into a Claude-side implementation of the same task unless the user explicitly asks.
- CRITICAL: after presenting review findings, STOP and ask the user what to do next. Do not start fixing the findings on your own — the user may want to fix them themselves, delegate the fixes back to Kimi with `/kimi:rescue`, or dismiss them.
