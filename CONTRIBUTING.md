# Contributing to kimi-plugin-cc

Thanks for your interest in contributing! This document explains how to set up the project, make changes, and submit them for review.

## Project layout

```
.claude-plugin/marketplace.json      # Claude Code marketplace manifest
plugins/kimi/                        # the plugin itself
  .claude-plugin/plugin.json         # plugin manifest
  commands/                          # slash commands (/kimi:review, ...)
  agents/                            # the kimi-rescue subagent
  hooks/hooks.json                   # SessionStart/SessionEnd/Stop hooks
  prompts/                           # prompt templates ({{VAR}} interpolation)
  schemas/                           # review structured-output JSON schema
  scripts/kimi-companion.mjs         # main CLI entrypoint (all subcommands)
  scripts/lib/                       # small single-purpose modules
  skills/                            # internal skills for the subagent
tests/                               # node --test suite (uses a fake kimi binary)
scripts/bump-version.mjs             # version management across manifests
```

## Development setup

Requirements: Node.js >= 18.18 and (for real end-to-end runs) the [Kimi Code CLI](https://www.kimi.com/code/docs/en/) installed and authenticated.

```bash
git clone <this repo>
cd kimi-plugin-cc
npm ci
npm test
```

The test suite never calls the real Kimi API: `tests/fake-kimi-fixture.mjs` stands in for the `kimi` binary and is put on `PATH` by the test helpers.

## Making changes

- Keep modules small and single-purpose; match the existing style (plain ESM JavaScript, no dependencies — the plugin must run with a bare Node.js install).
- The plugin runs inside Claude Code on macOS, Linux, and Windows. Avoid platform-specific assumptions; guard what cannot be avoided (`process.platform` checks already exist for process groups and taskkill).
- Any change to command behavior should be reflected in the matching `commands/*.md` file — those markdown files are the instructions Claude Code follows.
- Any change to job/state file formats must stay backward-compatible with existing state dirs, or migrate them defensively (readers must tolerate missing fields).
- Add or update tests for behavior changes: `tests/*.test.mjs` run with `node --test`.

## Testing against the real Kimi CLI

The unit/e2e tests use the fake binary. Before shipping a runtime-affecting change, also smoke-test with the real CLI:

```bash
cd /tmp/some-git-repo
export CLAUDE_PLUGIN_DATA=/tmp/kimi-data
node <repo>/plugins/kimi/scripts/kimi-companion.mjs setup
node <repo>/plugins/kimi/scripts/kimi-companion.mjs review --wait
node <repo>/plugins/kimi/scripts/kimi-companion.mjs task "say hi" 
```

To exercise the plugin inside Claude Code, add the marketplace from your checkout and reload:

```bash
/plugin marketplace add /path/to/kimi-plugin-cc
/plugin install kimi@kimi-code
/reload-plugins
```

## Versioning and releases

Versions follow semver and are kept in sync across `package.json`, `package-lock.json`, `plugins/kimi/.claude-plugin/plugin.json`, and `.claude-plugin/marketplace.json`:

```bash
npm run bump-version -- 0.2.0   # set the version everywhere
npm run check-version           # verify all manifests agree (runs in CI)
```

Every user-facing change must add an entry to `CHANGELOG.md` under `Unreleased` (or the version being released).

## Commit and pull request guidelines

- Keep changes scoped: one concern per PR.
- Write commit messages in the imperative mood ("Add cancel support for queued jobs").
- Fill out the PR template; link the issue being fixed when there is one.
- CI must be green: `npm ci`, `npm run check-version`, `npm test` on Ubuntu and macOS, Node 20 and 22.

## Reporting security issues

Please do not open public issues for security vulnerabilities — see [SECURITY.md](./SECURITY.md).
