# Testing

## Automated gates

Run from the repository root:

```powershell
npm ci
npm run lint
npm test
npm run build
Push-Location src-tauri
cargo fmt -- --check
cargo test
cargo clippy --all-targets -- -D warnings
Pop-Location
```

The TypeScript suite covers ACP model/effort metadata, reasoning request shape,
stream merging, tool lifecycle, usage updates, secret redaction, terminal argument
parsing, and session updates. Rust tests cover exact agent arguments, outbound ACP
validation, CLI output limits, settings allowlists/migration, terminal arguments,
Git parsing, and workspace traversal rejection.

## Real-account smoke

Use an account that is safe for development. Never automate password entry or
second-factor approval.

1. Complete official Grok login and verify the account dialog shows a subscription.
2. Create a fresh project session and receive a streamed exact-text response.
3. Switch every advertised model and reasoning effort; the request must succeed
   through `session/set_model` with `_meta.reasoningEffort`.
4. Ask for a read-only tool call, then a harmless confirmed file edit in a test repo.
5. Review working-tree and staged Diff views and restore a prior Grok session.
6. Cancel a long prompt and reconnect after terminating the ACP child process.
7. Exercise full Grok TUI keyboard input, resize, exit, and restart through ConPTY.

## New-user sandbox

On this Windows machine:

```powershell
npm run sandbox
```

That launches the portable `app\grok-desk.exe` with a blank `USERPROFILE` so the official CLI is missing and the existing Grok login is hidden. It will briefly close the running GY Grok window (single-instance mutex) and reopen it afterwards.

Grok Bot's Linux VM cannot run the Windows GUI. It *can* check that a blank Linux user can download the official CLI and that nothing on `127.0.0.1:18765` is required. Paste `scripts/sandbox-grok-bot.prompt.md` into Grok Bot, or copy `scripts/sandbox-grok-bot.sh` onto that machine and run it.

## Installer smoke

- Verify portable EXE launch.
- Perform a silent NSIS install into a disposable directory, launch the installed
  executable, then run its uninstaller.
- Perform an administrative MSI extraction and verify the application payload.
- Confirm all artifacts are unsigned (until signing is configured), compute
  SHA-256 checksums, and compare sizes against the release manifest.
