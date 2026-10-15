# 排错：先定位哪一层出错

适用：连接、Profile、provider、额度、更新器报错。先记录发生动作、完整错误码、发生时间、桌面版本、daemon 版本及所用 Profile 类型；报告中去掉 key、token、个人路径和账号信息。不要让用户发送 auth 文件。下列处理是排查建议；没有证据时不要声称已经诊断或修复。

UI 引文采用「zh-CN」（同 key 的 English）。源码路径中 desktop 的 renderer 路径以 `apps/desktop/src/renderer/src/` 为前缀，cutex 路径相对 daemon 仓库。

## daemon 连不上

**含义：**桌面没有建立到所选主机 daemon 的连接。关闭桌面不会代替停止 daemon；也不能靠反复重开窗口保证 daemon 恢复。

**处理：**

1. 在「设置」（Settings）→「主机」（Hosts）确认正在排查的主机及地址，查看「诊断」（Diagnostics）的版本与能力；对 SSH 主机可点「测试」（Test）。本机 CLI 的版本与本地 `doctor` 输出不能证明远端 daemon 的状态；远端问题须针对远端主机核查。
2. 若显示「cutex 守护进程不可用」（The cutex daemon is unavailable），核查该主机的 daemon 服务状态与日志（Linux：`systemctl --user status cutex-management-api.service`；Windows：`cutex service status`；日志位置见 [安装升级](install-upgrade.md#日志在哪里)）。这些是只读检查；重启服务、重装或重置用户状态要用户明确同意。
3. 若显示「SSH 已连通，但远程 cutex 守护进程没有响应」（SSH is up, but the remote cutex daemon does not answer），先处理远端 daemon；SSH 本身连通不等于 daemon 可用。
4. 若错误是主机名解析、SSH 拒绝 / 超时、主机密钥或端口转发失败，按该条错误排查连接。若 token 缺失或被拒绝，使用「重新配对」（Re-pair），不要在聊天里手动交换 token。
5. 解决原因后点「重新连接」（Reconnect），再核实连接状态和实际操作。

证据：desktop `docs/DESIGN.md` §2；`components/settings/ConnectionSettings.tsx`；`modules/connection/i18n.ts` 的 `connection.page`、`connection.diagnostics`；基础 `i18n/zh-CN.ts` / `en.ts` 的 `host.problem.*`、`host.test`、`host.repair`、`host.reconnect`。

## `owner_action_required: unsupported selected profile fields or types`

**含义：**cutex 启动 agent 前要解析这个 Profile 的配置（`config.toml`），解析失败时统一报这条错误。它不等价于 API key 错误或 provider 离线。常见原因：

- **cutex 比写这个 Profile 的 cutex 旧**：较旧的 cutex 遇到不认识的字段就拒绝整个 Profile（例如较新版本写入的网页搜索、provider 能力等字段）。较新的 cutex 会忽略未知的顶层字段和 `model_providers.<id>` 下的未知字段，不再因此报错。
- **即使是新版也会拒绝的内容**：凭据或命令类覆盖字段（如 `api_key`、`experimental_bearer_token`、`http_headers`、`env_http_headers`、`notify`、`chatgpt_base_url`、provider 的 `query_params`），嵌套表（如 `tools`、`tui`、`skills`）里的未知字段，以及类型不对的值（例如该写数字的地方写了字符串）。

**处理：**先确认 daemon 版本，以及报错是否紧跟 Profile 配置变更、手工编辑或 cutex 降级。旧 cutex 读新 Profile：升级那台主机的 cutex（[安装升级](install-upgrade.md#升级-cutex-与-cute-codex)）。手工改过配置：在 Profile 编辑页核对最近改过的设置，或让用户自己检查非敏感字段名与类型。不要把完整配置 / auth 文件发到聊天，不要删整份 Profile，也不要靠反复新建 agent 绕过解析错误。

证据：cutex `src/launch/selected_profile.rs` 的 `Config::parse`（`strip_unknown_keys` 后再按 `deny_unknown_fields` 的嵌套类型解析，失败统一映射为该消息）；cutex `docs/PERSISTENCE-UNKNOWN-FIELDS.md` 的 selected profile 一行。

## provider 400：`include_server_side_tool_invocations`

**含义：**provider 拒绝同一个请求中混合内置网页搜索与函数工具。不要据此给所有 provider 套固定域名规则，也不要在未验证的字段里硬塞报错所提的参数。

**处理：**在该 Profile 的「模型」（Models）里将「内置网页搜索」（Built-in web search）设为「关闭」（Off），开启「网页搜索工具」（Web search tool），再「保存」（Save）。后一个开关需要 cutex 的 `profile-search-tool` 能力，而且仅支持 Codex API-key Profile。让用户选择合适时间重启或新建 agent，以加载工具；再进行一次带来源链接的搜索验证。仅保存配置不会使当前已运行的 agent 立即恢复搜索；如果还没到下一次启动，应明确报告配置已保存、效果尚未验证，不要宣称已经修复。看不到开关时检查 daemon capability 和 Profile 类型。完整区别见 [Profile](profiles.md#两个网页搜索开关)。

证据：cutex `docs/PROFILE-SEARCH-TOOL.md`；desktop `components/settings/ProfileModelFields.tsx` 和对应 `agent-config.profile.webSearch*` / `searchTool*` i18n keys。

## `rate_limit`、`rateLimitExceeded`、`usageLimitExceeded` 或额度耗尽

**含义：**provider 对请求施加了用量或速率限制。必须结合 provider 返回的信息与账户读数判断是短时速率还是额度窗口耗尽；不要从错误名称猜测余额或重置时间。

**处理：**打开对应 Profile 的「额度读取」（Quota readers），点「刷新」（Refresh），检查读数时间、剩余额度和重置时间。无读数不表示有额度；查询失败也不等于余额为零。若错误给出可用的等待时间，等候后再试；持续耗尽则由用户处理账户额度或选择自己已有可用的 Profile。不要自动购买、换账号或持续重试。

Claude 的「额度用完后自动继续」（Continue after usage limit）只有在当前 daemon / agent 支持并已启用时才适用；不要承诺所有 `rate_limit` 都会自动恢复。若用的是 cutex 搜索工具且返回 `rate_limited`，这是每个 agent 每滚动一小时 20 次的搜索调用限制，按 `retryAfterSeconds` 等待，失败尝试也占次数。

证据：cutex `src/management/v2/quota_continue.rs` 的 `quota_failure`、`exhausted_reset_from_rate_limits`；`docs/PROFILE-SEARCH-TOOL.md` 的 Security and cost；desktop `components/settings/ProfileQuota.tsx` 与基础 i18n 的 `quotaContinue.menu`。

## `503` 来自 provider

**含义：**先确认失败响应来自模型 provider。HTTP 503 本身不够定位：cutex 自己的容量、存储或其他服务也可能返回 503。若有 `provider_error` + `providerStatus: 503`，这是明确的 provider 状态证据。

**处理：**记录脱敏后的 provider 错误与时间，检查 provider 的服务状态；过一段时间做一次有限重试。不要把 provider 的暂时不可用直接当成 cutex 数据损坏，不要清空会话、重装 daemon 或反复更换 key。如果响应来自 cutex，它会带 cutex 自己的错误码，按错误码排查：例如 `idempotency_capacity_exceeded`（cutex 暂时忙，稍后重试）、`no_trusted_keys`（「后端更新」页面，见 [安装升级](install-upgrade.md#升级-cutex-与-cute-codex)，属预期）。看不出来源时，如实告诉用户“无法确定这个 503 来自 provider 还是 cutex”，并请他提供桌面 `logs/errors.jsonl` 里对应的那一行（脱敏后），不要猜。

证据：cutex `src/agent_bus/web_search.rs` 的 provider 非成功状态处理与 `providerStatus` 输出；desktop `docs/DESIGN.md` 对 `503 idempotency_capacity_exceeded` 的描述；cutex `docs/backend-upgrade.md` 的 `no_trusted_keys` (503)。上述等待 / 核查服务状态是排查建议，不是保证 provider 会在某个时间恢复。

## 更新器显示「不支持自动更新」

位置：「设置」（Settings）→「更新与诊断」（Updates & diagnostics）。标签是「不支持自动更新」（Automatic updates not available），下方一行写具体原因：

| 原因（zh-CN / en） | 含义与处理 |
|---|---|
| 「开发运行（electron + 源码目录）不会自我更新」（A dev run … does not update itself） | 从源码直接运行的开发版，本来就不自更新。 |
| 「这份安装包没有可用的更新源…」（This package has no update source…） | 安装目录里没有 `src` 克隆。按 AGENT-INSTALL §7 重装成便携安装，或按 §9 手动更新。 |
| 「需要先安装 git 才能自动更新」（Install git to enable automatic updates） | 本机没有 git。装 git 后点「重试」（Retry）。 |
| 「暂时连不上更新源…」（Can't reach the update source right now…） | 网络或更新源暂时不可达，会自动隔一段时间再试。 |
| 「更新源上还没有这个通道的分支…」（The update source has no branch for this channel yet…） | 所选通道（正式版 = `release`）还没发布到更新源。等发布，或核对 `src` 的远端地址；不是故障。 |
| 「这份安装不在 <目录>/releases/<版本> 结构下，或打包时没有记录版本信息」（This install is not in the <folder>/releases/<version> layout…） | 不是从 `<安装目录>/current` 启动的，或不是用安装脚本打的包。从 `current` 启动，或按 AGENT-INSTALL §7 重装。 |

这些都不表示 daemon 停止工作，也不证明已经是最新版。不要手工伪造 release 元数据或擅自切换安装目录来消除提示。通道与手动更新见 [安装升级](install-upgrade.md#升级桌面端)。

证据：desktop `apps/desktop/src/main/updater.ts`、`apps/desktop/src/shared/update.ts` 的 `UpdateUnsupportedCode`、`parseReleaseInfo` / `installLayout`；`modules/updater/i18n.ts` 的 `updater.updateCheck.unsupported`、`updater.unsupported.*`。

## 「需要升级」/ 功能不见了

**含义：**所选主机的 cutex 缺少这个功能需要的能力，或者对应的桌面模块被关掉了。

**处理：**先看提示：写着「需要升级」「需要 {feature}」的，是**那台主机的** cutex 太旧，按 [安装升级](install-upgrade.md#升级-cutex-与-cute-codex) 升级它；只更新桌面无效。没有任何提示、整个入口都没有的，到「设置」→「模块」（Modules）看对应模块是否开着。多台主机时先确认页面的主机选择器选的是哪台。详见 [主机与用户](hosts-users.md#需要升级)、[设置与默认值](settings-defaults.md#模块的开关)。

## 需要进一步报告时

「更新与诊断」（Updates & diagnostics）中的「错误日志」（Error log）提供「打开日志文件夹」（Open log folder）。先筛选此次错误并脱敏，再提交最小必要片段；不要默认上传整个日志目录。对尚未复现的问题明确区分观察、推测与已验证的修复。

证据：desktop `modules/updater/i18n.ts` 的 `updater.errorLog*`。
