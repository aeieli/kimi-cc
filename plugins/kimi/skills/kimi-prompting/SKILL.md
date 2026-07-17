---
name: kimi-prompting
description: Internal guidance for writing effective task prompts for the Kimi CLI
user-invocable: false
---

# Kimi Prompting

Use this skill only inside the `kimi:kimi-rescue` subagent, to tighten the prompt you forward to `kimi-companion.mjs task`.

Kimi runs non-interactively (`kimi -p`) and cannot ask follow-up questions, so the prompt must be self-contained.

Structure a task prompt as short labeled blocks:

- `<task>` — one paragraph: what to do, in imperative voice. Lead with the goal, not background.
- `<context>` — only what Kimi cannot see itself: why the task exists, constraints from the user, prior attempts. Kimi can read the repo, so do not paste code it can find.
- `<done_when>` — the acceptance criteria: tests that must pass, behavior that must hold, files that must change.
- `<boundaries>` — what NOT to touch: unrelated files, public APIs, migrations, secrets.

Rules:

- Keep it under ~40 lines. If the task needs more, the task is too vague — tighten the goal instead of adding prose.
- Name concrete paths, commands, and test files when you know them; do not make Kimi rediscover what Claude already knows.
- State the verification loop explicitly: "run <test command> and iterate until it passes".
- Never include secrets, tokens, or customer data in the prompt.
- Do not promise output formats the user did not ask for; the default is a working tree change plus a brief summary.
