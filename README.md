# Codewhale LMM Provider

安装一次，在 Codewhale 中运行 `/login lmm`，用浏览器授权，然后选择模型。
不需要复制 API Key，不需要另一个登录程序，也不运行本地代理。

**源码版本：0.2.0-alpha.1。尚未发布到 npm。** 本版按新的原生接口开发，
不兼容旧版 Codewhale。下面的使用流程需要宿主改动和服务端改动都可用；
PR 存在不代表已合并、已发布或已部署。

## 依赖与改动来源

[Codewhale 上游 PR #6805](https://github.com/codewhale-hq/Codewhale/pull/6805)
已于 2026-10-06 合并，提供原生 Provider 声明、浏览器授权和宿主管理的令牌。

本版还依赖以下改动：

- [Codewhale 安装与 `/login` 改进](https://github.com/LIghtJUNction/Codewhale/pull/1)。
  这是用户 fork 中的审查 PR，目标是提交给上游。当前连接向官方仓库创建 PR
  返回 403，不能把它称为已提交或已合并的上游 PR。
  [官方仓库对比入口](https://github.com/codewhale-hq/Codewhale/compare/main...LIghtJUNction:Codewhale:feat/native-plugin-login-install)。
- [LMM 服务端 PR #672](https://github.com/TokenNotIncluded/api.lmm.best/pull/672)，
  提供带分组约束的标准模型目录和请求入口。
- [本插件 PR #3](https://github.com/TokenNotIncluded/codewhale-lmm-provider/pull/3)，
  将原来的导出器替换为固定的原生插件，并删除旧登录和代理代码。

安装入口参考 [Pi 的包安装方式](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md)，
登录入口参考 [Pi 的自定义 Provider](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md)。
这是原生 Codewhale 声明，不执行 Pi 的 TypeScript 扩展。

## 安装

先确认 Codewhale 构建包含上述安装与登录改动：

```sh
codewhale install --help
```

改动合并到插件主分支后，直接安装：

```sh
codewhale install git:github.com/TokenNotIncluded/codewhale-lmm-provider
```

审查期间可先检出本 PR，再从本地安装：

```sh
git clone --branch feat/native-oauth-provider-6805 https://github.com/TokenNotIncluded/codewhale-lmm-provider.git
codewhale install ./codewhale-lmm-provider
```

不需要 `npm install`。本插件没有可执行入口、运行时依赖或安装脚本。
宿主新增的 `npm:包名@精确版本` 安装方式同样适用于原生插件包，但本版本
尚未发布，因此这里不提供尚不可用的 npm 安装命令。

安装完成后，在 Codewhale 会话中执行：

```text
/plugin validate codewhale-lmm-provider
/plugin trust codewhale-lmm-provider
```

检查屏幕显示的域名、权限和插件内容。按宿主显示的完整确认命令完成审查，
再启用：

```text
/plugin enable codewhale-lmm-provider
```

启用或更新 Provider 后，重新启动 Codewhale。安装不会自动信任插件，
也不会自动取得账号授权。以后无需反复安装；内容变更仍须重新审查。

## 登录和使用

在 Codewhale 内执行：

```text
/login lmm
```

也可以输入 `/login` 或 `/provider`，在列表中选择 `lmm`。宿主打开浏览器，
你在 LMM 页面确认账号、权限和分组。只需这一次授权。

授权成功后，宿主读取当前账号的模型目录并打开模型选择。名称显示为
“分组 / 模型”。选择后开始使用；以后用 `/model` 切换。没有预选的默认模型，
不会静默选择第一个分组，也不会在某组失败后换成另一组。

浏览器授权期间宿主会暂时暂停终端界面，返回后恢复。
浏览器必须能访问运行 Codewhale 的机器上的回环地址；这不是远程 SSH
设备码登录。拒绝授权时不会导入任何旧凭据。

模型目录为空时，检查账号已授权的分组和服务端是否有可用模型。
目录返回 404 时，先确认服务端 PR #672 已部署。
授权成功但目录读取失败时，不必再运行任何外部登录程序；回到 `/provider`
选择 LMM，并使用模型界面现有的刷新操作。

## 退出和权限

```text
/logout lmm
```

只删除 Codewhale 中 LMM 的本机登录凭据，不退出 Codewhale 账号，
也不撤销服务端授权。撤销远端访问须到 LMM 的授权管理页面操作。
`/login status` 保留 Codewhale 账号状态显示，不是 LMM 余额查询。

OAuth 令牌只由 Codewhale 保存和刷新。插件、说明 skill 和模型对话都不接收
令牌。不要在聊天、问题报告或日志中粘贴授权码、回调 URL 或凭据文件。

服务端继续检查实时授权、分组和模型可用性，并使用原有计费流程。
选择一个模型不等于设置消费上限。未知价格不代表免费。

## 旧版本迁移

本版已删除旧 CLI 的登录、会话存储、代理、模型导出、余额与用量命令，
没有兼容分支或自动回退。不再安装或运行 `codewhale-lmm`。

卸载旧的全局伴随程序，并在 LMM 授权管理中撤销不再使用的旧授权。
停用或卸载旧的每用户生成插件，再安装本版。不要把旧会话文件复制到宿主，
也不要复用旧插件的审查记录。本版不会自行读取、迁移或删除旧凭据。
余额与用量可在 LMM 网站查看。

## 接口范围

固定 Provider ID 为 `lmm`，部署地址为 `https://api.lmm.best`。
宿主调用 `/api/oauth2/openai/v1/models` 获取分组绑定的模型 ID，再将该 ID
传给同一前缀下的 `/chat/completions`。分组转换留在服务端，宿主不需要
LMM 专用补丁或公开分组请求头。

当前只支持 Chat Completions，包括其流式路径；不宣称支持 Responses-only、
Anthropic Messages-only、MCP 市场工具、设备码授权或远端撤销。
初始权限沿用公共客户端 `lmm-codewhale` 的四项：`catalog:read`、
`balance:read`、`usage:read`、`models:invoke`。分组权限由服务端在用户同意后追加。

协议依据：[LMM OAuth contract](https://github.com/TokenNotIncluded/api.lmm.best/blob/main/apps/api-go/service/oauth_contract.md)。

## 开发检查

仅开发检查需要 Node.js 22 或更新版本：

```sh
npm test
npm run check
npm run pack:check
```

测试检查原生声明、公开地址、权限、包内容和旧程序移除情况。它们不读取
用户凭据，也不调用生产服务。静态检查不能替代真实宿主的安装、审查、
浏览器授权、模型刷新、流式请求、取消、撤销和账单验收。

父项目通过 `packages/codewhale-lmm-provider` 子模块引用本仓库。合并本插件
并通过验收后，再单独更新子模块指针；不要复制另一份实现。

AGPL-3.0-only。本项目不隶属于 Codewhale。
