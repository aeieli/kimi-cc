# Kimi plugin for Claude Code

Use Kimi from inside Claude Code for code reviews or to delegate tasks to Kimi.

This plugin is for Claude Code users who want an easy way to start using Kimi Code from the workflow they already have. It mirrors the design of OpenAI's [`codex-plugin-cc`](https://github.com/openai/codex-plugin-cc), adapted for the [Kimi Code CLI](https://www.kimi.com/code/docs/en/).

## What You Get

- `/kimi:review` for a normal read-only Kimi review
- `/kimi:adversarial-review` for a steerable challenge review
- `/kimi:rescue`, `/kimi:transfer`, `/kimi:status`, `/kimi:result`, and `/kimi:cancel` to delegate work, hand off sessions, and manage background jobs

## Requirements

- **Kimi Code CLI** installed and authenticated (`kimi login`), with a Kimi membership or API key.
- **Node.js 18.18 or later**

## Install

Add the marketplace in Claude Code:

```bash
/plugin marketplace add <path-or-git-url-of-this-repo>
```

Install the plugin:

```bash
/plugin install kimi@kimi-code
```

Reload plugins:

```bash
/reload-plugins
```

Then run:

```bash
/kimi:setup
```

`/kimi:setup` tells you whether Kimi is ready. If Kimi is installed but not logged in yet, run:

```bash
!kimi login
```

After install, you should see:

- the slash commands listed below
- the `kimi:kimi-rescue` subagent in `/agents`

One simple first run is:

```bash
/kimi:review --background
/kimi:status
/kimi:result
```

## Usage

### `/kimi:review`

Runs a normal Kimi review on your current work — your uncommitted changes, or your branch compared to a base branch with `--base <ref>`.

```bash
/kimi:review
/kimi:review --base main
/kimi:review --background
```

Read-only; it will not change any files. It does not take custom focus text — use `/kimi:adversarial-review` for that.

### `/kimi:adversarial-review`

Runs a **steerable** review that questions the chosen implementation and design: assumptions, tradeoffs, failure modes, and whether a different approach would have been safer or simpler.

```bash
/kimi:adversarial-review
/kimi:adversarial-review --base main challenge whether this was the right caching and retry design
/kimi:adversarial-review --background look for race conditions and question the chosen approach
```

Read-only; it does not fix code.

### `/kimi:rescue`

Hands a task to Kimi through the `kimi:kimi-rescue` subagent — investigate a bug, try a fix, or continue a previous Kimi task.

```bash
/kimi:rescue investigate why the tests started failing
/kimi:rescue fix the failing test with the smallest safe patch
/kimi:rescue --resume apply the top fix from the last run
/kimi:rescue --model kimi-code/kimi-for-coding investigate the flaky integration test
/kimi:rescue --background investigate the regression
```

You can also just ask in natural language:

```text
Ask Kimi to redesign the database connection to be more resilient.
```

Notes:

- `--resume` continues the latest Kimi task session for this repo; `--fresh` starts a new one. With neither, the plugin offers to continue the latest task when one exists.
- Delegated tasks run `kimi -p`, which auto-approves tool calls in the workspace. Investigations that must not change files are run read-only.

### `/kimi:transfer`

Hands the current Claude Code session context over to Kimi and prints a `kimi -r <session-id>` command so you can continue the same work directly in the Kimi TUI or web UI.

```bash
/kimi:transfer
/kimi:transfer --source ~/.claude/projects/-Users-me-repo/<session-id>.jsonl
```

The plugin's `SessionStart` hook supplies the current transcript path automatically; `--source` is a manual override. The source must live under `~/.claude/projects`.

### `/kimi:status`

Shows running and recent Kimi jobs for the current repository.

```bash
/kimi:status
/kimi:status task-abc123
```

### `/kimi:result`

Shows the final stored Kimi output for a finished job, including the Kimi session id so you can reopen that run with `kimi -r <session-id>`.

```bash
/kimi:result
/kimi:result task-abc123
```

### `/kimi:cancel`

Cancels an active background Kimi job.

```bash
/kimi:cancel
/kimi:cancel task-abc123
```

### `/kimi:setup`

Checks whether Kimi is installed and authenticated, and manages the optional review gate:

```bash
/kimi:setup --enable-review-gate
/kimi:setup --disable-review-gate
```

When the review gate is enabled, a `Stop` hook runs a targeted Kimi review of Claude's response; if it finds issues, the stop is blocked so Claude can address them first.

> [!WARNING]
> The review gate can create a long-running Claude/Kimi loop and may drain usage limits quickly. Only enable it when you plan to actively monitor the session.

## Typical Flows

### Review Before Shipping

```bash
/kimi:review
```

### Hand A Problem To Kimi

```bash
/kimi:rescue investigate why the build is failing in CI
```

### Start Something Long-Running

```bash
/kimi:adversarial-review --background
/kimi:rescue --background investigate the flaky test
```

Then check in with:

```bash
/kimi:status
/kimi:result
```

## Kimi Integration

The plugin drives your local [Kimi Code CLI](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-command.html) in non-interactive mode: every job runs `kimi -p "<prompt>" --output-format stream-json` and reduces the streamed JSON events into a final result. That means:

- it uses the same Kimi install, login state, and configuration (`~/.kimi-code/config.toml`) you would use directly
- delegated tasks run under the `auto` permission policy built into `kimi -p`
- every run records its Kimi session id, so you can continue any review or task interactively with `kimi -r <session-id>`

To change the default model for the plugin, either pass `--model <alias>` per command or set `default_model` in `~/.kimi-code/config.toml`.

### Moving The Work Over To Kimi

Delegated tasks and review runs can be reopened directly in Kimi: take the session id from `/kimi:result` or `/kimi:status` and run `kimi -r <session-id>`, or pick the session from `kimi --session`.

## State and Job Management

Per-repository state (job index, job records, logs) lives in `$CLAUDE_PLUGIN_DATA/state/<repo>` when Claude Code provides a plugin data dir, otherwise in `${TMPDIR}/kimi-companion/<repo>`. A `SessionEnd` hook kills any of the session's active jobs and removes their records.

## FAQ

### Do I need a separate Kimi account for this plugin?

If you are already signed into the Kimi Code CLI on this machine, that account works here too — the plugin uses your local Kimi CLI authentication. Otherwise run `!kimi login` (or configure an API key) and check with `/kimi:setup`.

### Does the plugin use a separate Kimi runtime?

No. It delegates through your local Kimi CLI on the same machine, same repository checkout, same environment.

### How is this different from pointing Claude Code at the Kimi API directly?

[Using Claude Code with the Kimi API](https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html) replaces Claude Code's own model. This plugin keeps Claude Code as-is and adds Kimi as a delegate: Claude orchestrates, Kimi reviews and executes, and every Kimi run stays resumable in the Kimi TUI.

## Development

```bash
npm ci
npm test
```

Runs the unit and end-to-end tests (a fake `kimi` binary is used; no real Kimi calls are made). See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full development setup, project layout, and release process.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines, and please follow the [Code of Conduct](./CODE_OF_CONDUCT.md). Report security issues privately as described in [SECURITY.md](./SECURITY.md).

## License

Apache-2.0. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE): this project is adapted from OpenAI's codex-plugin-cc.
