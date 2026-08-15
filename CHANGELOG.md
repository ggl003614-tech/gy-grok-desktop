# Changelog

## 0.1.1 - 2026-08-13

- Fixed the account-connect crash: the GUI no longer launches interactive
  `grok login` (that TUI aborts with BEX64 / c0000409 when it has no console).
- Startup now probes the existing official CLI session via ACP `cached_token`.
  Already-logged-in users see the account dialog instead of a second login.
- GUI login is device-code only, with a visible code and official URL opener.
- Resolve `grok.exe` from `%USERPROFILE%\.grok\bin` so Start Menu launches work.
- Added cancel-login, release logging, a panic log, and a React error boundary.

## 0.1.0 - 2026-08-13

- First Windows community-preview release.
- Added official CLI login flows and authenticated subscription metadata.
- Added ACP streaming chat, permissions, tools, plans, usage, session recovery,
  dynamic model selection, and model-specific reasoning effort.
- Added ConPTY Grok CLI, safe project files/search, Git status and Diff views,
  CLI management probes, settings, themes, command palette, and diagnostics.
- Added SQLite presentation metadata, bounded transports, path validation, and
  secret redaction.
- Added original Grok Desk icon and Windows portable/NSIS/MSI artifacts.
