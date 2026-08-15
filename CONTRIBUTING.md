# Contributing

Contributions are welcome when they preserve the product boundary: Grok Desk is
a local ACP client and CLI host, not an alternative authentication or entitlement
system.

## Development

1. Install Node.js 20+, Rust stable, Windows C++ Build Tools, and Grok Build.
2. Run `npm ci` and `npm run tauri dev`.
3. Keep commands as executable-plus-argument arrays; never introduce a shell
   string bridge for agent-provided content.
4. Canonicalize and root-check every frontend-supplied workspace path.
5. Do not persist or log passwords, tokens, cookies, authorization headers, or
   unredacted environment variables.

Before opening a pull request, run the commands documented in
[docs/TESTING.md](docs/TESTING.md). Include tests for protocol parsing, security
boundaries, and failure states that your change affects.

## Changes and releases

Use focused commits and update `CHANGELOG.md` for user-visible changes. Release
artifacts are built only from version tags after the Windows CI job succeeds.
