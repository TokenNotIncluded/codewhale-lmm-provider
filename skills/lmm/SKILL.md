---
name: lmm
description: Help users export a reviewed native LMM OAuth provider for Codewhale, or use the legacy companion adapter.
---

Codewhale PR #6805 added reviewed native provider declarations:
https://github.com/codewhale-hq/Codewhale/pull/6805
Check `codewhale auth plugin-login --help` before recommending native mode.
Do not claim `/login LMM` is a supported command.

For native mode, the user signs in with `codewhale-lmm login`, lists
`codewhale-lmm models`, and runs `codewhale-lmm export-plugin --model
<exact-catalog-id> --output <new-directory>`. Install the exported directory,
not this repository's guidance-only root bundle. Follow the generated README
for validation, explicit trust, enablement and a fresh Codewhale runtime.
The user then runs `codewhale auth plugin-login --provider <exported-id>` and
`codewhale --provider <exported-id>`. Inference uses the declared default model
without `codewhale-lmm run`, a companion proxy, or temporary host configuration.

The exported manifest contains public configuration only. Its fixed group
header and original wire model come from the authorized Chat Completions
catalog. Never invent groups, model capabilities, prices or context lengths.
The model list is a reviewed snapshot, not live discovery or a spending cap.
Re-export and re-review when changing the selected model or group.

The CLI catalog login and native Codewhale login are separate. Never request,
print, inspect, copy or transfer access tokens, refresh tokens, authorization
codes, session.json, callback URLs or the host's credential store.
`codewhale-lmm status`, `balance` and `usage` address only the CLI login.
`codewhale-lmm logout` revokes only that CLI grant. `logout --local-only` removes
only CLI storage. `codewhale auth plugin-logout --provider <id>` removes only
the host's local credential; remote grant revocation requires server controls.
Do not describe any local-only action as remote revocation.

For older hosts use `codewhale-lmm run --model <exact-catalog-id>` after CLI
login. Interrupted companion rotation must not replay the old refresh token;
use logout and a new login. `unlock` must not remove a live process's lock.
Never bypass Codewhale's review/trust boundary. Do not promise Responses-only,
Messages-only, MCP marketplace, device-code or production acceptance support.
