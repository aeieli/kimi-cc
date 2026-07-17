# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

Please do **not** report security vulnerabilities through public GitHub issues.

Instead, report them privately via GitHub's ["Report a vulnerability"](https://github.com/advisories) feature on this repository (Security tab → Advisories → Report a vulnerability), or by contacting the maintainers listed in `NOTICE`/`README.md` if private advisories are not enabled.

Please include:

- a description of the vulnerability and its potential impact
- steps to reproduce or a proof of concept
- the plugin version and environment (OS, Node.js, Kimi Code CLI version)

You can expect an acknowledgment within a few business days. We will coordinate with you on a fix and a disclosure timeline before publishing anything publicly.

## Scope Notes

This plugin executes your locally installed `kimi` CLI with your own credentials, in your own working directory. Keep in mind:

- Delegated tasks run `kimi -p`, which auto-approves tool calls (including file writes and shell commands) under the Kimi `auto` permission policy. Only delegate tasks you trust, in working directories you trust — the same standard you would apply to running `kimi` yourself.
- The optional review gate (`/kimi:setup --enable-review-gate`) sends Claude's assistant responses to the Kimi API. Disable it if your responses may contain data that should not leave the machine.
- `/kimi:transfer` sends a digest of your Claude Code transcript to the Kimi API.
- Job state and logs under the plugin state dir may contain prompt text and model output; they inherit the permissions of your temp/plugin-data directory.
