# Grok Desk production acceptance matrix

This document is the release gate for the production phase. “Complete” means the
behavior is implemented, exercised against a real Grok Build subscription, covered
by an appropriate automated check, and documented. A visual shell around one ACP
happy path is not sufficient.

The reference product is the Codex desktop experience, but Grok Desk can only
expose behavior that Grok Build, ACP, Windows, and the user account actually
support. Differences must be explicit in the UI instead of being hidden.

## 1. CLI completeness

- [ ] A first-class embedded terminal runs the interactive `grok` TUI through
      Windows ConPTY, with resize, keyboard input, ANSI color, clipboard, clean
      shutdown, and restart.
- [ ] Advanced users can launch the exact CLI with a selected project, model,
      session, worktree, permission mode, sandbox, rules, tools, memory, plan,
      subagents, agent profile, and reasoning effort.
- [ ] Read-only GUI surfaces exist for `grok version`, `models`, `inspect
      --json`, `sessions list/search`, `mcp list --json`, `plugin list
      --json`, `worktree list --json`, `leader list`, and `update --check
      --json`.
- [ ] Mutating CLI operations are available only behind action-specific user
      confirmation and show the exact command/effect before execution.
- [ ] Unsupported or newly added CLI behavior remains reachable from the embedded
      terminal.

## 2. ACP client

- [ ] First-run onboarding distinguishes CLI missing, logged out, credential
      expired, authenticated, subscription recognized, and a successfully created
      Build session.
- [ ] Login supports the installed CLI's browser/OAuth and device-code flows,
      returns to the app after completion, and never asks the GUI to store a
      password or token.
- [ ] Account identity, authentication mode, team/ZDR metadata when present, and
      subscription tier are read from the authenticated ACP response and displayed
      with privacy-safe defaults.
- [ ] Initialization and authentication negotiate capabilities rather than
      assuming them.
- [ ] New, load, cancel, and reconnect session flows work.
- [ ] Text, image, resource, thought, plan, tool-call, usage, command, mode, and
      configuration updates have typed handling and safe unknown-event fallback.
- [ ] Session modes and config options (model, reasoning, permission-related
      selectors exposed by the agent) can be rendered and changed.
- [ ] Available models, context limits, current model, reasoning support, current
      effort, and allowed effort values come from ACP model metadata. Unsupported
      controls are hidden or disabled instead of guessed.
- [ ] Permission requests preserve every option sent by the agent, support
      cancellation, and never silently auto-approve.
- [ ] Client-mediated filesystem calls enforce canonical project roots and reject
      traversal, junction, symlink, and out-of-root access.
- [ ] Client-mediated terminals support create/output/wait/kill/release with
      bounded output and lifecycle cleanup.
- [ ] Broken pipes, malformed JSON, process crashes, timeouts, expired auth, and
      incompatible protocol versions produce actionable recovery UI.

## 3. Sessions and workspaces

- [ ] Multiple projects and multiple conversations can remain open without
      cross-session event leakage.
- [ ] Grok-persisted sessions can be listed, searched, loaded, renamed locally,
      exported, and deliberately deleted.
- [ ] Session metadata, drafts, UI state, pinned projects, and recent activity
      survive application restart.
- [ ] Worktree creation, selection, status, and cleanup are visible; destructive
      cleanup requires confirmation.
- [ ] A project trust prompt appears before first use and clearly explains what
      Grok may read or modify.

## 4. Coding workflow

- [ ] Workspace file tree supports search, refresh, ignore rules, and safe text
      preview.
- [ ] Git status, branch, changed files, staged/unstaged state, and unified diffs
      are visible.
- [ ] Diff rendering supports additions, deletions, context, binary/large-file
      fallback, and refresh after tool execution.
- [ ] Tool cards display meaningful names, input, output, status, duration,
      terminal linkage, and errors without leaking secrets by default.
- [ ] Long-running commands stream output, can be cancelled, and cannot grow
      memory without bound.
- [ ] Markdown, GFM tables, code blocks, links, copied code, images/resources,
      and very long conversations render correctly.

## 5. Desktop product quality

- [ ] Production navigation covers Chat, Changes, Files, Terminal, Sessions,
      Extensions, and Settings.
- [ ] Command palette and documented keyboard shortcuts cover core workflows.
- [ ] Dark and light themes, responsive window sizes, high-DPI scaling, keyboard
      focus, accessible names, reduced motion, and screen-reader basics are tested.
- [ ] Empty, loading, offline, unauthenticated, incompatible, and crash states are
      intentionally designed.
- [ ] Notifications, update check, diagnostics export, privacy notice, license,
      attribution, and reset controls are present.
- [ ] No development server, console noise, remote font dependency, or test data
      ships in the release.

## 6. Test and security gates

- [ ] TypeScript lint, typecheck, unit tests, and component tests pass.
- [ ] Rust format, clippy with warnings denied, and unit/integration tests pass.
- [ ] Mock ACP end-to-end tests cover success, permissions, malformed events,
      cancellation, reconnection, session load, and terminal/file callbacks.
- [ ] Real-account smoke scenarios cover new/load session, streaming, tool calls,
      cancellation, diff refresh, restart persistence, expired/absent auth,
      subscription validation, model switching, and reasoning-effort switching.
- [ ] Root-boundary, command-argument, redaction, path encoding, and output-limit
      security tests pass on Windows.
- [ ] Cold start, idle memory, long transcript, and burst-event performance have
      recorded thresholds.

## 7. Distribution and GitHub

- [ ] The app has original production logo/icon assets at all Windows sizes.
- [ ] Portable application binary, NSIS EXE, and MSI artifacts are generated.
- [ ] Installation, upgrade, uninstall, first-run, and clean-machine prerequisites
      are tested.
- [ ] Release artifacts have SHA-256 checksums; unsigned/code-signing limitations
      are stated without ambiguity.
- [ ] README, architecture, security, privacy, contributing, changelog, issue
      templates, screenshots, and release notes are present.
- [ ] Git history is intentional, checks pass on GitHub Actions, a public/private
      repository exists as the user selected, and a tagged GitHub Release contains
      the verified artifacts.

## Release decision

Every required row above must be complete or be moved to a documented “Known
limitation” that is caused by an upstream Grok Build/ACP boundary and has an
honest fallback. The goal is not complete while only local source code exists.

Primary references:

- [SpaceXAI Grok Build CLI reference](https://docs.x.ai/build/cli/reference)
- [SpaceXAI headless and ACP guide](https://docs.x.ai/build/cli/headless-scripting)
- [Agent Client Protocol](https://agentclientprotocol.com/)
