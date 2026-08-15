# Architecture

## Product boundary

Grok Desk is a local ACP client and CLI host. It does not implement an agent
runtime or bypass Grok Build access controls. The locally installed `grok`
binary remains the source of truth for authentication, models, sessions, tools,
plugins, MCP servers, permissions, sandboxing, and updates.

Two complementary integration paths prevent feature loss:

1. **Native desktop path:** typed ACP v1 messages are translated into React state
   and purpose-built desktop views.
2. **CLI compatibility path:** an embedded Windows ConPTY terminal runs the real
   interactive TUI for commands and features that ACP does not expose.

## Trust boundaries

```text
React/WebView (untrusted rendered agent content)
        │ typed Tauri commands/events
        ▼
Rust host (validation, persistence, root and output limits)
        ├── ACP child: grok agent stdio
        ├── PTY child: grok interactive TUI
        ├── read-only CLI probes
        ├── confirmed mutating CLI actions
        ├── workspace/git service
        └── SQLite application metadata
```

- Agent text and tool output are data, never executable HTML.
- Frontend-provided paths and arguments are revalidated in Rust.
- Shell command strings are not accepted for management operations; Rust builds
  executable plus argument arrays.
- Workspace access uses canonical paths and fails closed outside granted roots.
- Output streams are bounded and old chunks are persisted or discarded.
- Secrets are redacted from diagnostics and never stored in application metadata.

## Backend modules

- `app_state`: lifecycle, window/session registry, task cancellation.
- `acp`: JSON-RPC transport, typed capabilities, pending request table, event
  normalization, reconnect, authentication/subscription metadata, dynamic model
  and reasoning capability discovery, and protocol logging.
- `cli`: allowlisted read probes and explicitly modeled mutating operations.
- `pty`: portable-pty/ConPTY sessions and terminal events.
- `workspace`: canonical roots, text preview, file search, metadata, and limits.
- `git`: status, branches, worktrees, and diff collection using argument arrays.
- `store`: SQLite migrations for projects, session presentation metadata,
  drafts, preferences, and diagnostics indexes.
- `redaction`: token, credential, environment, URL-query, and path-safe logging.

The backend advertises ACP filesystem or terminal client capabilities only after
their handlers and root/lifecycle enforcement are active.

## Frontend modules

- `app`: shell, navigation, error boundary, global shortcuts, command palette.
- `chat`: virtualized transcript, composer, attachments, session config.
- `tools`: tool cards, permissions, linked terminal output, duration and errors.
- `changes`: git summary and unified diff viewer.
- `files`: project tree, search, safe preview.
- `terminal`: xterm.js host for interactive Grok and tool terminals.
- `sessions`: search/load/export and project grouping.
- `extensions`: inspect, MCP, plugin, skill, agent, hook, and warning views.
- `settings`: model defaults, reasoning, permission/sandbox, memory, plan,
  subagents, appearance, diagnostics, update, and privacy.
- `store`: normalized Zustand stores; remote/backend queries remain separate
  from ephemeral view state.

## Persistence

Grok owns conversation content in its normal session store. Grok Desk stores only
presentation and application metadata:

- project grants, pins, aliases, and last-opened time;
- Grok session ID, local title override, project association, and draft;
- window/view state and non-secret preferences;
- bounded diagnostic indexes.

Deleting a Grok session is a separate, confirmed action from removing local UI
metadata.

## Compatibility

ACP wire protocol compatibility is decided by `initialize.protocolVersion` and
advertised capabilities. Unknown extension events are logged and preserved as
structured fallback cards. CLI version and capability probes are cached per app
run, not hard-coded.

Model selectors and reasoning effort are also capability-driven. For example,
Grok Build 1.0.3 currently reports different effort sets for Grok 4.6 and 4.5 in
the `session/new.models.availableModels[*]._meta` extension. The app consumes
that metadata but does not assume future versions will use the same models,
labels, defaults, context windows, or effort values.
