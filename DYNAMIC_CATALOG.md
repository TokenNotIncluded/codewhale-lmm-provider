# Native OAuth model catalog

This migration branch declares one public OAuth provider. Codewhale owns authorization, token storage, refresh and transport. The plugin does not execute a companion CLI, local proxy, model export, or models.dev downloader.

The intended server contract is `GET /api/oauth2/openai/v1/models` and `POST /api/oauth2/openai/v1/chat/completions`. The catalog contains exact group-bound model IDs and display names. The host must preserve the selected ID; it must not invent a default group or retry another group. Server authorization and billing remain authoritative.

Public metadata matching and the local metadata cache from the former companion runtime are removed with that runtime. Native declarations cannot execute that JavaScript. Host-visible metadata must come from the actual standard catalog and supported host fields; missing prices or capabilities remain unknown. No model name proves a transport, price, context limit or tool capability. Chat Completions and its stream are the only declared transport.

## Integration status

The [native host capability](https://github.com/codewhale-hq/Codewhale/pull/6805) is merged. The [installation and login contribution](https://github.com/LIghtJUNction/Codewhale/pull/1) is merged in the user's fork review branch at `fa70769eb5e03ca0875b7b8044d019a568230e0c`; this does not establish that an installed official binary includes it. Its [provider contract](https://github.com/LIghtJUNction/Codewhale/blob/fa70769eb5e03ca0875b7b8044d019a568230e0c/docs/PLUGIN_PROVIDERS.md) binds reviewed endpoints and OAuth configuration to host-owned credentials.

The [historical Go server implementation](https://github.com/TokenNotIncluded/lmm-api/pull/672) merged as `5d7fab5d432025d59d69490501f2a1d57e47fb1c`. Current Rust Core main `3d1c09d5e0424b44603686f7419e76f790b2bb5c` does not expose those group-bound standard paths. [Draft Core PR #11](https://github.com/TokenNotIncluded/lmm-api-source/pull/11) adds the provider client identity and bounded budget but does not add those routes. Replacing the base URL with ordinary `/v1` would not preserve the group-bound ID contract.

The declaration and source package can be checked locally. Release still requires the current Rust server routes, an actual supported host, browser consent, account-scoped model refresh, streaming and cancellation, local logout and remote revocation behavior, and billing reconciliation under the intended test authority. Static package tests and historical Go tests do not substitute for that evidence. This branch has not published a package, enabled production OAuth, changed a parent gitlink, or deployed a service.
