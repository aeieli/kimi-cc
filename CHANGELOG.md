# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Job state writes are now atomic (temp file + rename) and concurrent state updates are serialized with a stale-safe directory lock, fixing lost job summaries when background tasks, cancels, and hooks race.

## [0.1.0] - 2026-07-17

Initial release. Use Kimi from Claude Code for code review and task delegation.

### Added

- `/kimi:review` — read-only Kimi review of the working tree or a branch diff (`--base <ref>`), with structured verdict/findings output.
- `/kimi:adversarial-review` — steerable challenge review with free-form focus text.
- `/kimi:rescue` — delegate coding tasks or investigations to Kimi through the `kimi:kimi-rescue` subagent; supports `--resume`/`--fresh` session continuity and `--model <alias>`.
- `/kimi:transfer` — hand the current Claude Code session context over to a resumable Kimi session (`kimi -r <session-id>`).
- `/kimi:status`, `/kimi:result`, `/kimi:cancel` — track, inspect, and cancel foreground and background jobs.
- `/kimi:setup` — readiness checks (Node.js, kimi CLI, authentication) and review-gate management.
- Optional stop-time review gate: a `Stop` hook asks Kimi to review each Claude response and blocks the stop when issues are found (off by default; enable with `/kimi:setup --enable-review-gate`).
- Session lifecycle hooks that scope jobs to the Claude session and clean them up on session end.
- Per-repository job state under `$CLAUDE_PLUGIN_DATA/state` (or `${TMPDIR}/kimi-companion`), with 50-job pruning.
- Large-prompt staging: prompts over 8 KB are written to the state dir and referenced by path to stay under OS argv limits.
- Internal skills for the rescue subagent: `kimi-cli-runtime`, `kimi-prompting`, `kimi-result-handling`.
- Test suite (`node --test`) with a fake `kimi` binary; no real API calls in tests.
