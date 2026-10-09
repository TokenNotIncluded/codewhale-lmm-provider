# Codewhale LMM Provider

通过 LMM 网页授权登录，在 Codewhale 中使用 LMM 模型，不需要复制 API Key。

**当前源码版本：0.1.0-alpha.3。** 支持导出原生 OAuth Provider 插件；旧的伴随 CLI 仍用于兼容不支持原生 Provider 的宿主。本版本号不代表已经发布到 npm。

## 上游 PR 与适配说明

[Codewhale PR #6805 — feat(plugins): support reviewed OAuth AI providers](https://github.com/codewhale-hq/Codewhale/pull/6805) 已于 **2026-10-06** 合并。

该 PR 增加了 `extensions.net.codewhale.providers`，以及 `codewhale auth plugin-login --provider <id>` / `plugin-logout`。登录、令牌存储、刷新和推理由 Codewhale 管理。因此，“Codewhale 插件不能注册 Provider 或 OAuth，只能使用本地代理”只适用于旧宿主，不再是当前接口的限制。接口依据：[上游原生 Provider 文档](https://github.com/codewhale-hq/Codewhale/blob/main/docs/PLUGIN_PROVIDERS.md)。

本插件复用已有的 LMM 授权目录校验，新增 `export-plugin`，把所选模型转换为可审查的原生声明。**不需要继续修改 Codewhale 核心，也不需要在原生推理时运行本地代理。** 旧代理保留为明确的兼容入口，不自动切换两套登录。

合并不等于用户安装的二进制已包含此功能。先在本机检查：

```sh
codewhale auth plugin-login --help
```

命令不存在时，使用包含 #6805 的 Codewhale 构建，或使用下方的旧版伴随模式。新 Provider 能力改变了宿主的审查规则，旧插件需要重新审查；不能复用或伪造旧信任记录。

## 安装

导出工具需要 Node.js 22+；没有第三方运行时依赖。

```sh
git clone https://github.com/TokenNotIncluded/codewhale-lmm-provider.git
cd codewhale-lmm-provider
npm install --global .
```

也可以直接运行 `node src/cli.mjs --help`。父项目通过 Git submodule 引用同一份源码。导出的原生插件只有公开声明和 README，运行时不需要本包的 Node.js 进程。

## 原生模式

先用 CLI 登录并读取真实授权目录，再选择 `models` 输出的完整 ID：

```sh
codewhale-lmm login
codewhale-lmm models
codewhale-lmm export-plugin --model '<完整 catalog id>' --output ../lmm-native-bundle
```

`--output` 必须是尚不存在的目录，且其父目录已存在。命令不覆盖现有目录、文件或符号链接。它不会安装插件、修改 Codewhale 配置、写入信任记录或发起模型推理。

输出 JSON 包含导出目录、插件名、Provider ID、分组和原始模型名。导出目录中的 README 提供对应的完整命令。每次导出固定一个分组和一个选定模型：

- `X-LMM-Group` 使用授权目录中的原始分组 ID；不会选默认分组或跨组回退。
- 原生 `model` 使用 `upstream_model`，不是 `lmm:...` 形式的目录 ID。只接受目录明确支持 Chat Completions 的模型。
- Provider ID 由 issuer 和分组生成，避免大小写不同的分组或不同部署相互覆盖。相同 issuer / 分组更换模型时，更新同一个 Provider 并重新审查。

进入导出目录，启动 Codewhale，在会话中执行以下命令；占位符以导出结果为准：

```text
/plugin install .
/plugin validate <导出的插件名>
/plugin enable <导出的插件名>
```

检查模型、分组、OAuth 地址和权限。执行 Codewhale 显示的完整 `/plugin trust ...` 命令，再次执行 `/plugin enable ...`。**启用或更新 Provider 后，退出并启动新会话。** 随后从终端登录：

```sh
codewhale auth plugin-login --provider <导出的Provider-ID>
codewhale --provider <导出的Provider-ID>
```

第二条命令使用插件声明的默认模型，沿用用户正常的 Codewhale 配置，不创建旧模式的临时配置，也不需要 `codewhale-lmm run`。

### 两套登录不能混用

用于读取目录的 CLI 登录，与 Codewhale 原生登录是不同的令牌存储和授权。导出不会复制 access token、refresh token、`session.json` 或 API Key。原生登录必须由宿主单独完成；同一个 client ID 不代表可以共享令牌。

不再需要 CLI 查询余额、用量或重新导出时，可用 `codewhale-lmm logout` 撤销该 CLI 的授权。它不能清除或撤销宿主的独立登录。

```sh
codewhale auth plugin-logout --provider <导出的Provider-ID>
```

这条原生命令**只删除 Codewhale 的本地凭据，不撤销 LMM 服务端授权**。远端撤销需通过服务端的授权管理完成。卸载插件或修改声明也不等于远端撤销。

### 原生模式的范围

模型列表是经审查的快照，不是实时 LMM 目录。目录入口是 `/api/oauth2/catalog`，不能把宿主通用 `/v1/models` 当成等价接口。更换模型、分组或部署地址时，重新导出，并通过宿主更新、审查和启用插件。服务端仍在每次请求中检查当前授权；声明一个模型不等于服务端模型白名单，也不是消费额度限制。

目前只支持 Chat Completions，包括流式输出。不会声称支持 Responses-only、Anthropic Messages-only、MCP 市场工具或 device-code 登录。价格、上下文长度和其他未提供的能力不会写成猜测值。`balance`、`usage`、`status` 仍只管理 CLI 登录，不读取宿主私有凭据。

## 旧版伴随模式

不支持 #6805 的 Codewhale 继续使用：

```sh
codewhale-lmm login
codewhale-lmm models
codewhale-lmm run --model '<完整 catalog id>'
codewhale-lmm run --model '<完整 catalog id>' -- exec '检查这个项目的测试'
```

多个模型时不会静默选择第一个。启动时创建临时 Provider 配置，设置 `CODEWHALE_CONFIG_PATH`，向宿主传入随机本地连接凭据。不会覆盖原有配置，但也不继承原配置中的自定义运行设置。退出后清理监听和临时文件。

子进程中的 `CODEWHALE_PROFILE` / `DEEPSEEK_PROFILE` 会被清除，并拒绝 `--profile` 覆盖临时配置；不修改父进程环境。本地桥只监听 `127.0.0.1` 随机端口，拒绝浏览器 Origin、任意上游、未授权分组及不支持的路径。上游只收到 OAuth Bearer、目录中的 `X-LMM-Group` 和对应模型请求。客户端断开时取消流式请求。适配器不重试模型 POST；宿主重试仍由 Codewhale 管理。

```sh
codewhale-lmm status
codewhale-lmm balance
codewhale-lmm usage
codewhale-lmm logout
```

`status` 只读本地登录状态；`balance` 和 `usage` 读取该授权允许的账户数据。未知价格保持 `null`，不表示免费。

## CLI 环境与凭据

`LMM_ISSUER` 默认 `https://api.lmm.best`，也可使用 `--issuer`。`LMM_CODEWHALE_HOME` 指定 CLI 私有凭据目录，默认 `$CODEWHALE_HOME/lmm-provider` 或 `~/.codewhale/lmm-provider`。`LMM_CODEWHALE_BIN` 只指定旧版 `run` 启动的官方可执行文件。

CLI 的 Termux 登录优先使用 `termux-open-url`。`login --no-browser` 仅输出授权 URL；浏览器仍须能访问当前机器的回环地址。原生登录使用宿主的浏览器打开机制；手动打开 URL 可设置 `CODEWHALE_PLUGIN_OAUTH_NO_BROWSER=1`。两者都不是远程 SSH 的 device-code 登录。

CLI 凭据文件在 POSIX 上要求 `0600`，目录要求 `0700`；不同 issuer 不能混用目录。相同 OS 用户仍可能读取文件，这不是系统沙箱。CLI 尚未实现 Windows 独立 ACL 保护，不应在共享 Windows 主机上使用其登录存储。原生凭据保护由 Codewhale 的安全存储实现负责。

CLI 刷新由跨进程锁串行执行，并在请求前写入 `refresh_pending`。若响应丢失或进程崩溃，不重放可能已消费的 refresh token。重新授权前先 `logout`；远端撤销失败时保留本地凭据。`logout --local-only` 仅删除 CLI 本地凭据，不表示服务端已撤销。`unlock` 只清理已退出进程的锁，不抢占活跃进程。

## 仓库根目录的说明插件

根目录 `plugin.json` 仍是帮助 skill，不硬编码某个用户的模型和分组。安装根目录不会自动得到可用 Provider。**原生模式应安装 `export-plugin` 生成的目录**；它包含真实的 `extensions.net.codewhale.providers` 声明。不要把两者混淆，也不要在对话中提供令牌、授权码或回调 URL。

## 服务端接入

服务端必须已登记公共客户端 `lmm-codewhale`，使用授权码 + PKCE S256。回调为 `http://127.0.0.1:<动态端口>/oauth/lmm/callback`，resource 为 `${issuer}/api/oauth2`。初始 scope 为：

```text
catalog:read balance:read usage:read models:invoke
```

分组 scope 由服务端按用户明确同意的快照追加。导出器不把旧授权返回的 group scope 写成新的初始请求，不混用 Pi/DSH 的 client ID，也不添加 MCP 或账户管理权限。保留 `OAUTH_SERVER_ENABLED`、固定 issuer 和分组白名单要求，不自动启用或部署生产 OAuth。

协议依据：[LMM OAuth contract](https://github.com/TokenNotIncluded/api.lmm.best/blob/main/apps/api-go/service/oauth_contract.md)。服务端注册、插件生成或上游 PR 合并，都不等于生产环境已验收。

## 验证

```sh
npm test
npm run check
npm run pack:check
# 旧版伴随桥的官方宿主目录测试，不是新插件的原生 OAuth 验收
LMM_CODEWHALE_BIN=/absolute/path/to/codewhale npm run test:host
```

新增测试覆盖原生声明、模型与分组映射、权限收窄、UTF-8 长度边界、导出不覆盖、并发导出、取消，以及真实 HTTP 回环 OAuth / 目录到 CLI 导出的流程。测试不调用生产推理，也不写宿主信任记录。真实宿主的插件审查、原生浏览器登录、刷新、推理、撤销及账单核对仍需在可运行对应二进制的环境中验收；不能用导出测试代替这些结果。

## 独立仓库与子模块

本仓库是插件的唯一源码。父项目 `TokenNotIncluded/api.lmm.best` 通过 `packages/codewhale-lmm-provider` Git submodule 固定版本。先在本仓库提交并通过 CI，再更新父项目指针；不要复制第二份源码。服务端客户端注册仍由父项目维护和部署。

AGPL-3.0-only. 本项目不隶属于 Codewhale。
