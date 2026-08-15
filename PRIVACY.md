# Privacy

Grok Desk is a local desktop client. It does not operate an account service and
does not receive or resell Grok subscriptions.

## Data handled by Grok Build

Prompts, selected project context, tool calls, and model responses may be sent by
the locally installed Grok Build CLI to xAI services. Their handling is governed
by the user's Grok/X account, subscription, organization, and data settings.
Grok Desk displays the authentication mode, subscription tier, and retention
metadata that Grok Build returns, but does not change those policies.

## Local data

Grok Desk stores non-secret application metadata in its Tauri application-data
directory using SQLite:

- trusted/recent workspace paths and display names;
- Grok session IDs, local titles, selected model/effort, and timestamps;
- interface, privacy, and update preferences;
- locally cached presentation messages when history saving is enabled.

The official Grok CLI owns credentials and remote conversation storage. Grok
Desk never asks for or persists passwords, browser cookies, OAuth tokens, API
keys, or payment details.

## Diagnostics

The Settings page can export a deliberately minimal JSON diagnostic containing
only app version, OS/architecture, and Grok CLI availability/version. It excludes
account identity, credentials, prompts, project paths, environment variables,
tool input/output, and conversation content.

Anonymous diagnostics are not uploaded by version 0.1.0. The disabled-by-default
preference is reserved for a future release and cannot cause an upload today.

## Removal

Uninstalling removes the application binaries. Local SQLite application data may
remain so upgrades can preserve preferences; it can be removed manually from the
Windows application-data directory. Grok CLI credentials and sessions are
separate and are managed with official `grok logout` and `grok sessions` commands.
