# Security policy

## Reporting a vulnerability

Do not open a public issue containing credentials, private project content, or a
working exploit. Until a private GitHub security contact is configured, report
only a minimal non-sensitive description and request a private channel.

## Security model

Grok Desk starts the locally installed Grok Build binary and displays agent
content. It cannot make an untrusted project safe by itself.

- Review a project before granting it to a session.
- Treat project instructions, tool output, links, and generated commands as
  untrusted.
- Use Grok Build permission rules and sandbox modes appropriate for the project.
- Keep projects under version control and review the Changes view before commit.
- Do not include secrets in prompts or diagnostics exports.

Whether a tool requires approval is decided by Grok Build. Read-only operations
may execute without a prompt. Grok Desk must not claim otherwise.

## Supported versions

Security fixes are provided for the latest released Grok Desk version. Grok Build
itself is an external dependency and should also be kept current.

