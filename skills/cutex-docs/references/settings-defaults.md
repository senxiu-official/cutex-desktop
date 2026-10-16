# 默认值、模块、用量与其他设置

适用：用户问“新装的默认是什么”“为什么我的 agent 会问我要权限 / 为什么不问”“某个功能在哪里打开”“用量页怎么把外面的 Claude Code / Codex 算进来”“服务在哪打开”“开场立绘怎么关”。界面引文写作「中文」（English）。

## 全新安装的默认值

“全新”指第一次启动这个版本的 cutex 时 `~/.cutex` 里还没有配置和会话；已经用过的家目录保持原来的行为。下面的 daemon 端默认值都需要对应能力的 cutex，旧 cutex 仍是旧默认。

| 项目 | 全新安装 | 已有安装 |
|---|---|---|
| 新建 agent 的权限 | 「自动」（Auto）：工作区可写（workspace-write）+ 需要时询问（on-request）+ 允许联网（cutex 能力 `fresh-agent-auto-permissions`） | 保持「完全访问」（Full access）：不沙箱、从不询问、不联网（升级时 cutex 把旧默认显式写进配置） |
| 快速启动 | 不变：工作区可写 + 需要时询问，不联网 | 同左 |
| 通知预设 | 「推荐」（Recommended）；另有「安静」（Quiet）、「全部」（Everything）和「自定义」（Custom） | 升级后原来的「旧版」（Old behaviour）预设被换成「推荐」，用户自己改过的格子保留 |
| 浏览器模块 | 开 | 以前保存过模块选择的安装保持关闭，需要时到「模块」打开 |
| NCI 远程作业、Claude Science、工作流、桌面插件 | 关 | 不变 |

说明：

- **已有 agent 不受影响**：每个 agent 保存自己创建时的权限。默认值只影响之后新建的 agent。
- 想让已有安装也用「自动」：「设置」（Settings）→「新建默认」（New {{agent}} defaults）里选「自动」。改单个 agent：输入框下方的权限模式菜单（「完全访问」/「自动」/「只读」（Read only））。各选项含义见 [agents.md](agents.md#codex-的沙箱审批与网络)。
- 「新版 cutex 已不再提供旧版」：通知预设里不再有「旧版」。只有连到较旧 cutex 的主机时，才会只读显示「旧版」并提示「选一个预设即可切换」。通知设置在「设置」→「通知」（Notifications）。
- 两个默认关闭的可选模块见桌面仓库 `docs/install/ANU.md`：Claude Science（有 Claude Science 账号的人都可以用）和 NCI 远程作业（NCI / Gadi 用户）；用不到就保持关闭。NCI 远程作业在公开版本上还用不了（ANU.md 顶部的说明），用户问到时如实说明。「作业」页需要 Job Service 可选组件（cutex 0.1.1 起，仅 Linux），见 [安装升级](install-upgrade.md#可选组件claude-运行时job-service)。

## 模块的开关

「设置」→「模块」（Modules）列出可开关的功能模块。这里的开关**只存在这台电脑上**；模块需要的后端能力在主机上，主机的 cutex 不支持时页面会提示需要升级（见 [主机与用户](hosts-users.md#需要升级)）。一个模块关闭时，它的页面、侧栏入口和设置项都不显示；用户说“找不到某个功能”时，先确认对应模块是否打开。

## 用量

「设置」→「用量」（Usage），主机页面（看的是所选主机的账本）。需要那台主机的 cutex 提供用量账本；没有时页面显示「这台主机的 cutex 还不提供 Token 账本」，下面两个功能缺少能力时显示「需要升级」提示。

- **「额外目录」（Extra directories）**：把**不经过 cutex** 的 Claude Code / Codex CLI 运行也算进用量。「添加目录」（Add directory）时选类型（Claude Code 或 Codex CLI）、填主机上的目录（例如那台主机上的 `~/.claude` 或 `~/.codex`），选计费方式（「订阅（显示 API 等价价值）」（Subscription (shows API-equivalent value)）或「API 按量计费」（API, billed per token））。cutex 只读会话记录文件，约每几分钟扫描一次，导入的行和 cutex 自己的分开存；表格可按「来源」（Source）筛选。不要添加 cutex 自己的目录：界面会提示“加进来会重复计数”。删除目录要点两次，会一并清除导入的用量。需要 cutex 能力 `usage-external-sources`。
- **「按另一个模型计价」（Price as another model）**：价目表里没有价格的模型，可以按另一个模型的价格估算（「用量里的模型」（Model in usage）→「按此模型计价」（Priced as）），例如中转站给模型起了别名。只支持一层映射，不能映射到自己，最多 256 条；已在价目表里有价格的模型不能再映射。需要 cutex 能力 `usage-model-map`。
- 金额是估算：订阅制显示的是 API 等价价值，不是实际花费。

## 服务

「服务」（Services）页里的服务由 cutex 在主机上托管。点「打开」（Open）时，浏览器模块开着就在**桌面内置浏览器**的标签里打开（远程主机的服务也能打开）；内置浏览器打不开时退回系统浏览器。菜单里另有「在系统浏览器中打开」（Open in system browser）。

## 开场（立绘与开场白）

「开场」（Opening）模块在会话第一个回合上方显示所用 Profile 的立绘和开场白；新建 agent 页和快速启动页的立绘也随它开关。关掉它有两种方式：「设置」→「模块」里关「开场」，或「设置」→「对话」（Conversation）里关「显示会话开场」（Show the session opening）。两种都会同时隐藏启动页上的立绘和问候语。每个 Profile 的立绘和开场白在 Profile 的外观里设置。

## 依据

- cutex `docs/FRESH-AGENT-PERMISSIONS.md`、`docs/NOTIFICATION-LEVELS.md`（Migration from legacy）；capabilities `fresh-agent-auto-permissions`、`notification-presets-no-legacy`、`usage-external-sources`、`usage-model-map`。
- desktop `apps/desktop/src/renderer/src/modules/*/index.ts` 的 `defaultEnabled`（`nci`、`claude-science`、`workflows`、`plugins` 为 false）、`modules/browser/index.ts` 与 `modules/defaultFlips.ts`（浏览器默认开，已保存选择的安装保持关）。
- `lib/permissionModes.ts`；基础 i18n 的 `composer.mode.*`；`modules/agent-config/i18n.ts` 的 `agent-config.defaults`。
- `modules/notifications/i18n.ts` 的 `notifications.preset.*`、`legacyNote`。
- `modules/usage/i18n.ts` 的 `usage.sources.*`、`usage.map.*`、`usage.unsupported`；`modules/usage/Sources.tsx`、`modules/usage/modelMap.ts`。
- `modules/services/i18n.ts` 的 `services.open`、`services.openExternal`（提交 “services: 打开 uses an in-app browser tab”）。
- `modules/intro/i18n.ts` 的 `intro.moduleDescription`；`modules/conversation/i18n.ts` 的 `conversation.timelineIntro*`；`components/LaunchPage.tsx`。
