---
name: lmm
description: Set up and troubleshoot the native LMM provider in Codewhale without handling credentials.
---

# LMM native provider

The bundle registers provider `lmm`. Codewhale owns browser authorization,
credential storage, refresh and model requests. This skill is guidance only.

After the user reviews and enables the plugin, start a new Codewhale session.
Ask the user to run `/login lmm`, or select LMM in `/login` or `/provider`.
The host opens the browser and then the model picker. The user explicitly chooses
one `group / model` entry. `/model` changes the model. Never silently change groups.

Do not ask the user to paste API keys, tokens, authorization codes, callback URLs
or credential files. Do not read host or old companion credentials. Do not run
shell commands to imitate login, accept trust receipts, export another plugin
or launch a local proxy. Do not issue a model request as an automatic test:
model requests can create charges.

`/logout lmm` removes the host's local LMM credential only. For remote revocation,
the user must use LMM's authorization management page. Bare `/logout` applies to
the Codewhale account. `/login status` is not an LMM balance or grant display.

If `/login lmm` or `codewhale install` is missing, the host needs the native-login
changes linked in README. If the native models route returns 404, the server needs
PR #672. If the catalog is empty, check live authorized groups and model access;
do not invent model IDs, prices or a default group. After a catalog fetch error,
use the host's existing provider/model refresh interface, not a second login tool.

Host base: https://github.com/codewhale-hq/Codewhale/pull/6805
Host contribution (fork review): https://github.com/LIghtJUNction/Codewhale/pull/1
Server: https://github.com/TokenNotIncluded/api.lmm.best/pull/672

Supported protocol: Chat Completions and its stream. No device-code login,
Responses-only transport, executable authorization callbacks or MCP permissions.
