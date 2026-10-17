# 桌面插槽与模块约定（v1.15）

> **公开仓库说明 / Public repository note.** 本文是维护者开发时的设计记录，保留原样。文中引用的内部笔记和工作副本
> （`docs/research/…`、`docs/reviews/…`、`docs/handoff/…`、`TODO.md`、`PROGRESS.md`、`PLAN.md`、`upstream/…`、
> `refs/…`、`.claude/…`）不随本仓库发布，只作历史记录，不是链接。文中的「主人」指项目维护者。This is a maintainers'
> design record; the internal notes it cites are not published with this repository.

迁移变更日志（2026-10-09，`gpt/merge-20261009`）：中立源码 SDK/host 替换宿主引擎，原 v1 插槽/生命周期/偏好保持；v1.1 新增动态 `addModules` / `removeModule`（§15），用于隔离外部插件。API 版本与声明快照随实现提交。

设置导航第一批（2026-10-09，`feat/settings-batch1`，`docs/research/settings-design-review-20261009.md` §2）：设置组改为 `app` / `connection` / `agents` / `tools` / `data` / `system`（删 `capabilities` / `integrations` / `planned` 和 `plannedApi`）；页面 id 改名 `capsule` → `status`、`connection` → `hosts` + `remote`（`remote-access` 自己的页）、`security` → `collab`；删 `memory`（连同 `memory` 模块）和 `agentBus`（`agent-bus` 改为 `collab` 页末的分区）；`updater` 分区从 `about` 移到 `general`。不兼容旧深链名（主人规则：直接改名，调用处一并改）。

v1.2（2026-10-09，`feat/contract-v12`）：状态胶囊变成可关闭的模块 `status-capsule`；新增状态展示位置（`conversation.statusSurface`，固定 `bar` / `capsule`）、实际位置解析（requested / effective）、窄接口 `reveal` 和受信任的 `conversation.overlay`（§16）。可选依赖与模块详情延后（§16.9）。

v1.3（2026-10-09，`feat/notifications-p0`）：新插槽 `notify.method`（设备端通知方式，§17）；锁定的核心模块 `notifications` 执行主机的两张表（事件 → 等级、等级 → 通知方式，cutex `notification-levels`），拥有 设置 → 应用 → 通知。退役服务 `services.notify.os`（§7）。

v1.4（2026-10-09，`feat/side-p0`；RFC `docs/research/right-panel-rfc-20261009.md`）：右侧区 `side.component`（§18，取代 B 档草案 `conversation.sidePane`；P0 落地外壳容器、`workspace` / `diff` 模块、`subagents.thread`、状态分类适配 `status:<id>`）；会话两侧与引用（§19：`conversation.gutter`、`timeline.turnAttachment`、`ref.action`、`ref.target` 已声明，宿主随 P1a 接入）；服务 `services.side` / `.timeline` / `.refs`；`StatusItem.icon` / `side`、`OverlayLayout.side`、`PageItem.refParams`。

v1.5（2026-10-10，`feat/multi-host-p0`；RFC `docs/research/multi-host-rfc-20261009.md` §9.1、§12）：多主机 P0——宿主同时连着多台主机，
界面一次显示一台（**焦点主机** = 范围里的那台）。宿主输入从一台主机变成 `HostsInput`（焦点 + 其他已连接主机 + 范围，`setHosts`）；
模块级 `requires` 任一已连接主机满足即激活，新 `requires.focusHost` 只看焦点主机；条目按范围内的主机求值；新 `ctx.hosts`
（已连接主机，可订阅，变化不重启）和 `services.daemonFor(hostId)`；`side.component` 的 `follow` 绑定带 `hostId`（§4、§6、§7、§18.5）。

v1.6（2026-10-10，Claude 账户并入 Profile 页）：新插槽 `profile.fieldAction`（§20）——模块在 profile 编辑器和「添加 profile」表单里、
它拥有的 profile 字段旁放一个动作（claude-accounts：Claude 账户选择旁的「+ 添加订阅」），动作把值放进草稿。Claude 账户不再是
单独的设置页，而是 Profile 页列表后的 `settings.section`（页面 `profiles` 现在渲染 `<SettingsSections page="profiles" />`）。

v1.7（2026-10-10，成果库 P0，`feat/artifacts`；设计 `docs/research/research-paradigm-design-20261010.md` §3.6）：Markdown 认
`cutex:<种类>/<key>` 链接和图片（§19.6）：核心把它变成 `CutexRef { kind, key }` 交给 `refs.open`，只认这个形式、不点名模块。
`ref.target` 条目加两个可选字段：`useLink`（链接 chip 的提示、徽标、图标）与 `thumbnail`（图片链接的缩略图字节）。新模块 `artifacts`
（成果）是第一个提供者（种类 `artifact`）；新页组 `artifacts`（§18.6）。

v1.8（2026-10-11）：`GutterItem.anchor`（§19.3）。

v1.9（2026-10-11，`feat/keep-mounted`；内嵌浏览器 I3 前置，`docs/research/browser-inapp-i1-revision-reply-20261011.md` §2.3）：
「保持挂载」钩子——`SideBodyProps.keepMounted(hold)` / `held`（§18.13）。`keepAlive: "hidden"` 的组件可以要求某个实例在持有
活的东西（租约等）期间一直挂载：不参与离屏 LRU、绑定不可见或视图范围切到别的主机时仍挂载（隐藏）。离屏 LRU 的个数从常量变成设置
`sideKeepHidden`（★4，1–12），持有上限是设置 `sideKeepMounted`（★4，1–8，与 LRU 分开计）。

v1.10（2026-10-11，`feat/side-open-held`；内嵌浏览器 I3 硬停 `browser-inapp-i3-hard-stop-20261011.md` §2）：「后台打开并持有」——
`services.side.openHeld(kind, params, opts?)` / `releaseHold(locator, opts?)`（§18.14）。一个调用里原子地建（或复用）卡片并拿到第一个持有，
不显示、不聚焦、不切页 / 范围 / 选中 agent；Body 第一次渲染就是 `held: true`。拒绝时布局与持有都不变，返回类型化原因。

v1.11（2026-10-12，`feat/titlebar-launchers`；主人决定 2026-10-12）：标题栏右侧变成右侧组件**种类**的启动栏（Chrome 侧面板固定模型）——
[固定的启动器…] [＋] [右栏开关]。`side.component` 的 `launcher` 加可选 `pin?: "default" | "never"` 与 `newParams?()`，去掉 app 内部字段
`button`（§18.2、§18.3）。原标题栏的页操作（钉住、⤢ ⛶ ⋯）移到页按钮那一道顶部（「收起侧栏」下面）和 ＋ → 本页。

v1.12（2026-10-12，`feat/project-artifacts-services`；主人 2026-10-12「项目页面是不是也能添加成果库和服务？」，界面由 lead 定）：新插槽
`project.tab`（§21）——模块给项目页加一个标签（成果库 = `artifacts`、服务 = `services`），可选给概览一句计数（「3 个成果 · 2 个服务」）。
项目页与侧栏项目菜单「打开项目页面」只列项目所在主机支持的条目。
v1.13（2026-10-13，`feat/timeline-intro`；主人需求：会话从头可见时显示「开场」——所用 profile 的立绘 + 开场白，
像游戏角色登场）：新插槽 `timeline.intro`（A 档，`unavailable: "hide"`，§19.3）——会话开头真的在屏幕上
（没有更早的历史要加载：`hiddenTurns === 0` 且没有更早一页的游标）时，在第一个回合之上显示的**开场**；
每个会话最多显示一项，按 `order` 取第一个可用的。条目只拿只读信息（会话 id、主机、profile、显示名），
不给 store 写权限。第一个贡献者是模块 `intro`（本机立绘 / 开场白存储 + provider 默认立绘回退）。
v1.14（2026-10-15，`feat/codeblock-run`；主人 2026-10-09「shell 代码块旁加运行按钮」，TODO.md）：新插槽
`timeline.codeBlockAction`（A 档，`unavailable: "hide"`，§22）——模块在 agent 回复里的围栏代码块工具条（复制 / 下载旁）
放一个动作；宿主只给 `{ language, hostId, platform }` 让条目纯函数地决定接不接、再给代码文本。只在 agent 回复里、不在
只读时间线（归档 / 子 agent 视图）里。第一个贡献者：`terminal` 的 ▶ 运行（`terminal.runCode`）。
v1.15（2026-10-16，`feat/components-card`；可选组件规格 v2 §5，主人 2026-10-16 确认）：`ModuleRequires.component?: string`——
模块页面需要的 cutex **可选组件**（`job-service`、`claude-runtime`）。模块照旧按能力激活；它的 `main.page` 在目标主机的组件
不是 `ready` / `external` 时显示通用的组件卡片（安装 / 更新 cutex / 手动设置指南 / 源码命令 / 找主机主人 …），不显示页面主体（§12.1）。
引擎不看这个字段。第一个使用者：`jobs`（`component: "job-service"`）。

决定：主人，2026-10-09（总纲 `docs/DESIGN.md` §4.22）。读者：主线开发；GPT（按本文实现宿主包，见
`docs/research/kutex-brief-for-gpt.md` §3 A；下称 brief）。本文是约定，改格式先改本文。行号 = 2026-10-09 `main`，
路径相对 `apps/desktop/src/renderer/src/`，`components/` 下的文件省略这一层；`shared/` 指 `apps/desktop/src/shared/`。

## 1. 目的与范围

- 主线按「插槽 + 模块」组织：每个功能是一个**模块**，向命名的**插槽**贡献条目；外壳（`App` / `Sidebar` /
  `Conversation` / `Settings` / `TitleBar` / `StatusCapsule` / `Timeline` / `Composer`）只按注册表渲染，不再有按功能的分支和
  `features.has(...)`（现在约 90 处、约 40 个文件）。
- **v1 的主 renderer 只有内置模块**：仓库内、随包构建、可信。v1.1 动态登记仍只接受受信任 adapter 创建的定义，外部代码不进入主 renderer。
- **外部插件 v1.1 接入**：安装入口默认关闭，一律隔离运行（§10），与未来 MCP Apps（`ui://`）共享隔离机制，当前不声称实现完整 MCP Apps 协议。
- 三层归属（brief §1）：界面扩展 = 桌面模块 / 插件；agent 侧能力（skills / MCP / hooks）= Codex 插件，由 daemon
  安装；受信任后台 = daemon 进程外服务插件（§12）。
- 沿用 Kutex `WorkbenchHost`（API 1）的概念和名字：owner scope、生命周期、`signal` + generation、依赖与回滚、窄服务、
  `<id>.<name>`。不同处：插槽更细、按主机能力门控、多主机（§11）。
- 不做：动态布局（registerLayout / registerSurface；右侧区与两侧留白的容器由外壳提供，模块只贡献组件 / 留白条目并声明规则，§18、§19）、页面多实例（只有右侧组件有实例，§18）、模块市场、命令面板。

## 2. 模块定义

宿主核心（`modules/types.ts`、`host.ts`）不依赖 React；组件类型只在 `modules/slots.ts`（§3.2）。宿主包对插槽表泛型
（`ModuleHost<M extends Record<string, SlotItemBase>>`），本仓库用 `SlotMap` 实例化。

```ts
export type ModuleId = string;              // ^[a-z][a-z0-9-]{0,63}$ = 目录名；发布后不改（prefs 键、i18n 前缀）
export type ItemId = `${string}.${string}`; // `<moduleId>.<name>`，同一插槽内唯一
export type HostKind = "local" | "ssh";     // = shared/hosts.ts HostView.kind
export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export interface ModuleRequires {
  capabilities?: readonly string[];  // 活动主机 /v2/capabilities featureList 须全部包含
  modules?: readonly ModuleId[];     // 须为 active；决定激活顺序，依赖停 → 本模块停
  hostKinds?: readonly HostKind[];   // 省略 = 任意
  focusHost?: boolean;               // v1.5：只看焦点主机（§4）
  component?: string;                // v1.15：页面需要的 cutex 可选组件名（kebab-case，同 cutex components/<name>）；不参与激活，见 §12.1
}
export interface ModuleDefinition {
  id: ModuleId;
  titleKey: MessageKey;              // 设置 → 模块 里的名字（i18n/index.tsx MessageKey）
  descriptionKey?: MessageKey;
  requires?: ModuleRequires;
  required?: boolean;                // 核心：总是启用，开关锁定
  defaultEnabled?: boolean;          // 默认 true；required 时忽略
  contributes?: { readonly [S in SlotId]?: readonly SlotItem<S>[] }; // 静态贡献，激活时先于 activate() 登记
  activate?(ctx: ModuleContext): void | Promise<void>;               // 订阅、同步循环、动态贡献；不等网络
}
export interface ModuleContext {
  readonly id: ModuleId;
  readonly signal: AbortSignal;      // 模块停止时 abort（§6）
  readonly generation: number;       // 每次激活 +1；服务丢弃旧一代的回调
  readonly host: { readonly id: string; readonly kind: HostKind; readonly features: ReadonlySet<string> }; // 能力未加载 = 空集
  contribute<S extends SlotId>(slot: S, item: SlotItem<S>): () => void; // 返回 dispose；停止时自动 dispose
  readonly services: ModuleServices; // §7
  readonly prefs: ModulePrefs;       // §5，只限本模块命名空间
  t(key: MessageKey, vars?: Record<string, string | number>): string;
}
export type ModuleState =
  | { kind: "disabled" }             // 主人关掉
  | { kind: "unavailable"; missing: { capabilities: string[]; modules: ModuleId[]; hostKind: boolean; waiting: boolean } }
  | { kind: "activating" } | { kind: "active" } | { kind: "stopping" }
  | { kind: "failed"; error: string; at: number };
export interface ModuleStatus { state: ModuleState; lastError?: { message: string; at: number } } // 渲染 / 命令出错

export interface SlotItemBase {
  id: ItemId;
  order?: number;                                  // 升序；相同按注册表模块顺序，再按贡献顺序；核心用 100 的倍数
  requires?: { capabilities?: readonly string[] }; // 条目级门控，叠加在模块之上
  unavailable?: "hide" | "disable" | "notice";     // 不可用时的显示；默认由插槽规定（§3.2）
}
export interface SessionItemBase extends SlotItemBase {
  agentFeature?: AgentFeature;       // lib/agentFeatures.ts；显式 false 才算缺，Claude 的 sideChat 须显式 true（lacks()）
}

// 宿主的输入与输出（host.ts）
export interface HostInput { id: string; kind: HostKind; features: ReadonlySet<string> | null } // null = 能力还没加载
export interface SlotEntry<T extends SlotItemBase> {  // snapshot(slot) 的一项，已排序
  item: T; moduleId: ModuleId;
  mode: "show" | "disable" | "notice";            // show = 可用；其余 = 不可用但按该方式显示（hide 的不在快照里）
  missing: readonly string[];                      // 非 show 时：缺的能力（模块级 + 条目级）和未启用的依赖模块
  waiting: boolean;                                // 只是能力还没加载（notice 此时不显示）
}
```

宿主核心对 i18n key 类型也泛型（`ModuleDefinition<M, Svc, K extends string>`），本仓库用 `MessageKey`；`modules/slots.ts`
导出 `AppModule` 等别名和 `defineModule(def)`（只做类型检查）。

- 条目 `id` 必须以「本模块 id + `.`」开头，否则登记时抛错、模块 failed。
- 一直存在的条目放 `contributes`；依运行时数据出现的用 `ctx.contribute`。
- 名字以 `use` 开头的字段是 React hook。外壳保证顺序稳定：每个条目在自己的组件里调用，或在以条目集合为 key 的组件里
  按顺序调用（集合一变就重挂载）。

## 3. 插槽清单

资格：同一位置**现在已有 ≥2 个功能**在用才定成插槽。A = v1 定型（§3.2，迁移第 1–4 步用到）；B = 合格、迁到该区域时
定型（§3.3 草案）；C = 以后候选（单一用途或手调布局）。

### 3.1 现状盘点

| 档 | 插槽 | 现在位置 | 现有贡献者 |
|---|---|---|---|
| A | `settings.page` | `lib/settingsNav.ts:12–60`，`Settings.tsx:24–105` | 22 个设置页 |
| A | `settings.section` | `settings/AppSettings.tsx:424–425,547–549`，`settings/ConnectionSettings.tsx:393–396` | 主人通知、cutex 通知、更新、运行时包、远程访问、配对、CORS、Claude 账户（Profile 页，v1.6） |
| A | `profile.fieldAction`（v1.6，§20） | `settings/ProfileClaudeAccount.tsx`（编辑器 + 添加表单的 Claude 账户行） | claude-accounts「+ 添加订阅」 |
| A | `project.tab`（v1.12，§21） | `modules/projects/ProjectsPage.tsx`（标签栏、概览计数行），`lib/projectMenus.tsx`（打开项目页面） | artifacts 成果库、services 服务 |
| A | `conversation.status` | `lib/statusItems.ts:5–12`，`StatusCapsule.tsx:45,270–453`，`StatusBar.tsx:57–77` | 目标、进程、终端、subagents、委托、作业 |
| A | `nav.primary` | `Sidebar.tsx:373–406` | 快速对话、新建 agent、项目、服务、委托、作业、审批 |
| A | `main.page` | `App.tsx:101–121`，`store.ts:84`（`MainView`），`TitleBar.tsx:136–200`（面包屑） | 设置、项目、委托、作业、审批、服务、草稿对话、新建 agent（任务详情页 r219 删除） |
| A | `timeline.received` | `lib/receivedRows.ts:16–24`，`Timeline.tsx:276–298` | task-service 任务（旧转录）、委托请求、委托结果；兜底 = agent 消息 |
| A | `timeline.tool` | `WorkGroup.tsx:193–198`，`Timeline.tsx:301–303`，`lib/workGroups.ts:127` | subagents（collab）、旧 cutex 任务工具、委托卡片；兜底 = 普通工具行 |
| B | `composer.plus` | `ComposerTools.tsx:108–370`（`PendingChat.tsx:495` 也用） | 图片、@文件、技能引用、进程、目标、记忆、技能、MCP |
| B | `composer.slash` | `lib/slashCommands.ts:34–87,268–336` | 约 25 条（已有 `enabledBy` / `agentFeature`） |
| B | `composer.queueSection` | `Composer.tsx:936–943`（注释里已叫 Slot 0–2） | agent 留言 v2、待处理委托、委托暂停 |
| B | `menu.agent` | `lib/menus.tsx:191–244` | 核心、Claude 工具、委托暂停、运行时、生命周期 |
| B | `message.action` | `lib/menus.tsx:282–317`，`MessageActions.tsx:105–171` | 复制 / 引用 / 折叠；fork / 回退 / 编辑重发 |
| A | `side.component`（v1.4，§18） | `components/side/*`，`lib/sideLayout.ts`（原 `SidePane.tsx` 已删） | 工作区（文件、改动、预览）、diff、subagent 线程、状态分类（适配 `status:<id>`） |
| A | `conversation.gutter` / `timeline.turnAttachment` / `ref.action` / `ref.target`（v1.4，§19） | 已声明，宿主随 P1a 接入 | 书签、批注、侧聊（GPT 返工，RFC §7.14）；成果（`artifacts`：`ref.target` 种类 `artifact` + `ref.action`，v1.7）；委托（`delegations`：`ref.target` 种类 `delegation`，2026-10-13） |
| A | `timeline.intro`（v1.13，§19.3） | `Timeline.tsx` 会话开头出口 `modules/TimelineIntro.tsx` | intro（开场：profile 立绘 + 开场白） |
| A | `timeline.codeBlockAction`（v1.14，§22） | `Markdown.tsx` 的代码块（`components.code`）→ `ReplyCodeBlock.tsx`，出口 `modules/CodeBlockActions.tsx`；范围由 `Timeline.tsx` 的 agent 回复给 | terminal ▶ 运行（Copy / Download 是 streamdown 自带，不是条目） |
| B | `attention.source` | `lib/agentAttention.ts:56–73`，`lib/attentionView.ts:35–53` | 原生请求、审批、委托、主人通知 |
| B | `app.overlay` | `App.tsx:94–96` | agent 列表、作业输出、菜单 / 对话框 |
| B | `titlebar.agent` / `titlebar.action` | `TitleBar.tsx:269–271,359–362` / `:461–475` | 运行时按钮、通知铃、服务、侧栏开关、关闭设置（终端开关 v1.11 起是固定的启动器，`side.component` 的 `launcher.pin`，§18.3） |
| B | `keybinding` | `main.tsx:17`，`TitleBar.tsx:418–431`，`StatusCapsule.tsx:198–210`；说明表 `lib/shortcuts.ts:29–111` | 缩放、侧栏、终端、胶囊 |
| B | `command` | `store.signal` + `lib/uiSignal.ts`，`Composer.tsx:583–587` | 目标、后台终端、composer 弹层 |

系统通知（v1.3 起）：通知方式是插槽 `notify.method`（§17），由核心模块 `notifications` 执行；原来的服务 `services.notify.os` 和
`lib/notify.ts` 已删除。

C 档：`composer.bar`（`Composer.tsx:1053–1092`，手调布局）、`composer.panel`（`:910–913`，可并入斜杠）、
`composer.accessory`（`:972,999`，只有委托）、`timeline.insert`（主人通知卡 `Timeline.tsx:405–454`、`TurnTail` 委托段
`:93–107`，形状不同）、新时间线条目种类（`lib/timeline.ts:34–52`，纯核心）、`menu.project / tool / file`
（`lib/menus.tsx:246/319/330`）、`settings.row`（只有 `delegationSteerKeys`，`settings/AppSettings.tsx:222–226`）、通知种类表
（`settings/AppSettings.tsx:394–404`）、项目页标签（`store.ts:81`）、主机切换器、daemon 横幅、侧栏行装饰、命令面板。

### 3.2 A 档条目类型

```ts
// modules/slots.ts
import type { ComponentType, ReactNode } from "react";
type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; // lucide
export type PageParams = Readonly<Record<string, string | undefined>>;                 // JSON 安全，只在内存

export interface SettingsPageItem extends SlotItemBase {    // 默认 unavailable "hide"
  page: SettingsTab;             // 稳定深链名 = openSettings(page)；store.ts 的 SettingsTab 联合类型（新页先在那里加名字）；全局唯一
  group: SettingsGroupId;        // lib/settingsNav.ts；组顺序由外壳固定（SETTINGS_GROUP_ORDER），组内按 order
  icon: Icon; titleKey: MessageKey; // 导航名 + 面包屑
  source: SettingsSource | null; // 来源标签（原 PAGE_SOURCE）
  hintKey?: MessageKey;          // 原 PAGE_HINT
  useBadge?(): { dot?: boolean; text?: string } | null; // 其他徽标，如通用页（桌面端更新）/ 运行时页红点
  Page: ComponentType;
  keywords?: readonly MessageKey[];                 // 设置搜索（可选）：能搜到本页的词
  sections?: readonly SettingsSearchSection[];      // 设置搜索（可选）：Page 组件自己渲染的卡片，按页内顺序
  allHosts?: { capability: string };                // 主机页（可选）：两台以上在线主机有该能力时，页头主机选择器加「全部主机」；
                                                    // 页面用 lib/settingsHost useAllHostsTarget() 读主机列表；选择存模块 pref `hosts.all`（默认开）
  hostPart?: boolean;            // 有「主机」部分的 app 页（components/SettingsHostFrame 的 SettingsHostPart，作用于设置目标主机）：
                                 // 本页的 settings.section 渲染在该部分里，跟随目标主机及其所有者
}
export interface SettingsSearchSection {            // 设置搜索：页内一张卡片（见下「设置搜索」）
  anchor: string;                // 页内唯一；卡片渲染为 <Section id={settingsAnchorId(anchor)}>（lib/settingsNav.ts）
  titleKey: MessageKey;          // 卡片标题（结果显示 页 › 标题）
  keywords?: readonly MessageKey[]; // 卡片里的行标签 / 提示
  requires?: { capabilities?: readonly string[] }; // 卡片只在这些 cutex 能力下渲染（缺 → 结果置灰并写原因）
  hiddenWith?: { capabilities?: readonly string[] }; // 主机有其中任一能力时卡片不渲染（搜索里也不出现）
  access?: "owner" | "member";   // 主机页上谁能看到：owner = 只有主机所有者的连接；member = 只有其他（已分配、非待定）用户；不设 = 都能
  part?: "host";                 // 在 hostPart 页上：卡片位于主机部分（设置目标主机，仅所有者）
}
export interface SettingsSectionItem extends SlotItemBase { // 默认 unavailable "hide"
  page: SettingsTab;             // 目标页；页面用 <SettingsSections page="…" />（modules/Outlet.tsx）决定插入点（自定义 Page 也一样，如 Profile 总览的列表后），按 order
  titleKey?: MessageKey;         // unavailable "notice" 时必填：标题（来源标签固定「主机」）+「需要升级 cutex（需要 X）」；也是搜索结果标题
  keywords?: readonly MessageKey[]; // 设置搜索（可选）：分区里的行标签；有 titleKey 才能被搜到
  sections?: readonly SettingsSearchSection[]; // 设置搜索（可选）：分区自己渲染的卡片（各有 anchor）；显示时代替分区本身被搜索，notice 仍是一条结果
  Section: ComponentType;        // 只在可用时渲染，组件里不再查能力
}

export type StatusPlace = "bar" | "capsule" | "both" | "off"; // modules/slots.ts（STATUS_PLACES）
export interface StatusLine { icon: ReactNode; text: ReactNode; title: string; trailing?: ReactNode }
export interface StatusBarProps {  // 第 2 步定型；v1.2 加 reveal（§16.4）
  sessionId: string;
  inline: boolean;               // 实际位置（effective）含输入栏：画 chip；否则只接请求
  reveal(intent: "view" | "edit", openBarPanel?: () => void): RevealResult; // v1.2：宿主选位置；落到输入栏时调 openBarPanel
  /** @deprecated v1.1 */ home: "bar" | "capsule";  // 适配器按 effective 推导：只有胶囊在显示时 = "capsule"
  /** @deprecated v1.1 */ showInCapsule(): void;    // = reveal("view")，不带输入栏面板
}
export interface StatusItem<D = unknown> extends SessionItemBase {
  titleKey: MessageKey;          // 分区标题 + 设置 → 状态显示 的表格行 + 胶囊 … 菜单
  defaultPlace: StatusPlace;     // 有 Bar 才能 "bar" / "both"；v1.2 登记时检查 ⊆ 支持的位置
  supportedSurfaces?: readonly ("bar" | "capsule")[]; // v1.2；省略 = 有 Bar 则 bar，加 capsule
  useStatus(sessionId: string): { data: D; line: StatusLine; pulse?: number } | null; // null = 该类别不出现；只在放进胶囊时由胶囊调用；pulse 递增 = 实时更新，折叠胶囊边框闪一下
  Meta?: ComponentType<{ sessionId: string; data: D }>; // 分区标题右侧（时间、预算环、计数）
  Body: ComponentType<{ sessionId: string; data: D }>;
  Bar?: ComponentType<StatusBarProps>; // 状态行部分：条目对该 agent 可用时总挂载（不论放置），自己取数据；inline 时画 chip，并接本条目的请求
  barSide?: "start" | "end";     // 状态行左侧（占满剩余宽度，目标）/ 右侧（默认）
  icon?: Icon;                   // v1.4：作为右侧组件时卡片把手 / 页按钮上的图标（缺省 = 清单图标）
  side?: false | Partial<SidePlacement>; // v1.4：状态分类作为右侧组件 status:<id>（§18.9）；false = 不进右侧；缺省 { home: "workspace", order: 600 }
} // 外壳管：顺序、放置（§5）、折叠（ui.capsuleFoldedItems 存条目 id）、几何（DESIGN §4.20）、Ctrl+.、空则不显示

export interface PageTarget { page: ItemId; params?: PageParams }
export interface NavItem extends SlotItemBase {             // 默认 unavailable "disable"：能力加载前后不跳动；只有部分主机有的（作业）写 "hide"
  icon: Icon; titleKey: MessageKey;
  area?: "top" | "footer";         // 第 3 步加：放在 agent 列表上方（默认）还是底栏（⚙ 设置）
  target: PageTarget | { run(): void | Promise<void> };
  activePages?: readonly ItemId[]; // 这些页面打开时高亮；默认 = target.page
  useTitleKey?(): MessageKey | null; // 第 3 步加：实时文字（正在创建工作…）；null = titleKey
  useBadge?(): { text?: string; dot?: boolean; title?: string; attention?: boolean } | null; // 「⚠ N」/ 红点（设置）
  Menu?: ComponentType;            // 入口旁下拉（快速对话 → profile）；只在可用时渲染
}
export interface PageCrumb { text: string; to?: PageTarget; lead?: ReactNode; trail?: ReactNode } // lead / trail：项目徽标、任务编号、项目 id
export interface PageItem extends SlotItemBase {            // 默认 unavailable "hide"：打开着的页所属模块停了 → 「模块已关闭」+ 打开 模块
  Page: ComponentType<{ params: PageParams }>;
  useTitle(params: PageParams): readonly PageCrumb[]; // 面包屑：前面带 to 的可点，最后一个是页名（粗体）
  Aside?: ComponentType<{ params: PageParams }>; // 替换左栏和标题栏左列（设置导航）；有 Aside 的页标题栏右侧出现关闭按钮
} // MainView = { kind: "conversation" } | { kind: "page"; page: ItemId; params: PageParams }；对话属核心；设置 = shell.settings（params tab / profile / create）

export interface ReceivedRenderer extends SessionItemBase {
  schemas: readonly string[];    // ExternalMessage.schema（lib/timeline.ts:18），如 "cutex.delegation-ask.v1"
  Row: ComponentType<{ message: ExternalMessage; sessionId: string; readOnly: boolean }>;
} // 一个 schema 只能一个渲染器（注册表测试）；不可用 → 退回核心普通消息行（"cutex.agent-message.v1"）

export interface ToolRenderer extends SessionItemBase {
  match(item: RawItem): boolean; // RawItem = lib/timeline.ts:12；按 order 第一个匹配的赢；核心 PlainToolRow 兜底
  Row: ComponentType<{ item: RawItem; sessionId: string }>;
  standalone?(item: RawItem): boolean;         // 独立卡片，结束工作组（lib/workGroups.ts:127）
  activity?(item: RawItem): MessageKey | null; // 运行中提示（lib/turnActivity.ts TOOL_ACTIVITY）
}

export interface TimelineIntroItem extends SlotItemBase {  // v1.13（§19.3），默认 unavailable "hide"
  order?: number;                    // 升序；每个会话最多显示一项 = 第一个可用条目
  when?(props: TimelineIntroProps): boolean;  // false = 这个会话不出本条目的开场
  render(props: TimelineIntroProps): ReactNode; // 只读 props（下）；条目自己取自己的数据
}
export interface TimelineIntroProps {  // 只读信息，不给 store 写权限
  sessionId: string;
  hostId: string;                      // 会话所在主机（条目的数据按键）
  profileName: string | null;          // 会话携带的 profile 名（cutex 的 profile 引用今天就是名字；无 = 未知）
  providerKind: string | null;         // 宿主已知的 provider 类别（lib/provider 的类别名）；null = 未知，条目自行解析
  agentName: string | null;            // 会话显示名（{{name}} 占位符）
}

export interface SlotMap {
  "settings.page": SettingsPageItem; "settings.section": SettingsSectionItem;  // 第 1 步已在代码里
  "conversation.status": StatusItem<any>;  // 第 2 步已在代码里
  "conversation.statusSurface": StatusSurfaceItem; "conversation.overlay": ConversationOverlayItem; // v1.2（§16）
  "nav.primary": NavItem; "main.page": PageItem;  // 第 3 步迁时加进代码
  "timeline.received": ReceivedRenderer; "timeline.tool": ToolRenderer;  // 第 4 步已接入（§3.5、§9）
  "side.component": SideComponentItem;   // v1.4（§18）
  "conversation.gutter": GutterItem; "timeline.turnAttachment": TurnAttachmentItem; "ref.action": RefActionItem; "ref.target": RefTargetItem; // v1.4（§19），宿主 P1a
  "profile.fieldAction": ProfileFieldActionItem; // v1.6（§20）
  "project.tab": ProjectTabItem; // v1.12（§21）
  "timeline.intro": TimelineIntroItem; // v1.13（§19.3）
  "timeline.codeBlockAction": CodeBlockActionItem; // v1.14（§22）
  // B 档迁移时加入
} // 代码里的 SlotMap 只含已迁区域的插槽（其余类型是约定，迁时照此加入）
export type SlotId = keyof SlotMap;
export type SlotItem<S extends SlotId> = SlotMap[S];
export interface SlotSpec { unavailable: "hide" | "disable" | "notice";  // 该插槽条目的默认 unavailable
  placement?: { values: readonly string[]; default(item: SlotItemBase): string } } // §5
export const SLOT_SPECS: { readonly [S in SlotId]: SlotSpec } = { /* nav.primary: disable，其余 hide；conversation.status 有 placement */ };
```

`settings.page` 用 `page` 做键而 `main.page` 用条目 id：设置页是现成的共享深链名（斜杠命令、别的模块、分区都按名字
跳），普通页面归各自模块。

**设置搜索**（2026-10-09，`feat/settings-search`）：设置导航顶部的搜索框（Ctrl+F，或焦点不在输入框时按 `/`；Esc 清空）。
只索引**声明出来的文字**，不扫 DOM：页的 `titleKey` + `keywords`、页内卡片 `sections[]` 的 `titleKey` + `keywords`、
`settings.section` 条目的 `titleKey` + `keywords`（没有 `titleKey` 的分区搜不到）。文字按当前界面语言**和另一种语言**（中文界面配英文、英文界面配中文）各解析一次
（含 `{{agent}}` 等称呼，改了称呼就按新名字搜），不区分大小写；排序：完全相同 > 前缀 > 词首 > 子串 > 多个词分别命中 >
子序列。结果按页分组（页 › 卡片，命中处高亮），回车 / 点击 = `openSettings(page)` 后滚到卡片并闪一下
（`lib/focusRequest.ts` 的 `flashElement`）。锚点：页内卡片 `id={settingsAnchorId(anchor)}`；`settings.section`
由 `<SettingsSections>` 包一层 `id={settingsAnchorId(item.id)}`，分区组件不用管；`openSettings("profiles", { anchor: <条目 id> })`
同样滚到 Profile 总览里的分区并闪一下（编辑器的「管理账户」→ Claude 账户）。可用性：关掉的模块和能力还在加载的条目不出现；
置灰的页、`notice` 分区、缺 `requires.capabilities` 的卡片显示为灰色并写原因，不能打开。实现：`lib/settingsSearch.ts`（纯函数，
有单测）、`lib/settingsSearchView.ts`（建索引 + 滚动闪烁）。字段都是可选的，旧模块不写也照常工作，只是搜不到细项。

**模型显示名**（2026-10-10，设置 → 通用 → 模型显示名）：模块把模型 id 当文字显示时用 `lib/modelDisplay` 的
`useModelName()`（或 `<ModelName>`），悬停给原始 id。只管显示：发给 cutex 的值、输入框的值、价格表的键都保持原始 id。
不是契约改动（内置模块直接 import `lib/`）。

### 3.3 B 档草案

| 插槽 | 条目要点 |
|---|---|
| `composer.plus` | `{ section: "input" \| "session"; icon; titleKey; useState?(c): { disabledReason?; checked? }; run(c) }`；`c.sessionId: string \| null`（null = 新对话草稿） |
| `composer.slash` | 现 `SlashCommandSpec` + `run(ctx: SlashContext, args)`；`enabledBy` → `requires.capabilities` |
| `composer.queueSection` | `{ Section: ComponentType<{ sessionId; busy }> }` |
| `menu.agent` | `{ group: "core" \| "runtime" \| "lifecycle" \| …; build(session, t): MenuEntry[] }`（`lib/contextMenu.ts`） |
| `message.action` | `{ kinds: ("user" \| "reply")[]; group: "safe" \| "history"; icon; labelKey; when?(m); run(m); confirm?: "armed" \| "dialog"; inBar? }`，一份列表同时喂悬停栏和右键菜单（DESIGN §4.12） |
| `attention.source` | `{ useItems(): { sessionId; reason: NeedsYouReason; ref? }[] }`（`lib/agentAttention.ts:19`） |
| `app.overlay` | `{ Overlay: ComponentType }` |
| `titlebar.agent` / `titlebar.action` | `{ Chip: ComponentType<{ session }> }` / `{ icon; titleKey; useActive?(); run() }` |
| `keybinding` | `{ keys; descKey; group: ShortcutGroup["id"]; command: ItemId; arg? }`；设置 → 键盘快捷键由它生成 |
| `command` | `{ run(arg?: string): void }`，条目 id = 命令名；取代 `signal(target, arg)` / `useUiSignal`（≈ registerCommand） |

### 3.4 初始模块划分（建议）

- 锁定：`shell`（应用组设置页含 模块 页、overlay、核心快捷键）、`conversation`（时间线兜底、composer 核心、复制 / 引用 /
  折叠）、`connection`（主机页、主机切换）、`agent-config`（Profiles / 新建默认 / 指令 / 协作）、`about`（2026-10-16：设置 → 关于
  页上的许可证、项目链接和已知问题两个 `settings.section`；列表镜像 `docs/KNOWN-ISSUES.md`，纯静态，无 daemon 数据）。
- 可关（括号里是 `requires.capabilities`；「条目级」= 只门控部分条目）：`projects`、`quick-chats`
  （`human-create-session`）、`delegations`（`agent-asks`）、`jobs`（`job-service`；导航 `unavailable: "hide"`，只有 Linux
  主机有）、`approvals`（`owner-approvals`）、`owner-notify`（`owner-messages`）、`agent-messages`（`agent-messages-v2`）、
  `task-service`（只有旧转录的时间线行，不门控）、`services`（`services`）、`subagents` / `goal` / `plan` /
  `background-terminals`（按 `agentFeature`）、`workspace`（`workspace-fs`）、`terminal`（`terminal`）、`history`（条目级
  `session-fork` / `session-history-revert`）、`codex-config`（条目级 `codex-plugins`）、`usage`、`archive`、
  `agent-bus`、`runtime-packages`（`runtime-package-upgrade`）、`updater`、`remote-access`（条目级 `listen-settings` /
  `device-pairing`，`notice`）。
- 默认关闭的内置模块：`browser`（应用内浏览器）、`plugins`（隔离插件）、`nci`（**NCI 远程作业**，2026-10-13 主人定名；
  不用 NCI 的人看不到它，不是通用的「远程作业」）。`nci` 贡献 设置 → 工具 → NCI 远程作业（页 `nci`，条目 `nci.settings`，
  `requires: inbound-mail`）：分步设置向导（① 主机上生成专用密钥 `POST /v2/nci-verification/key` ② Gadi 上的小脚本与
  authorized_keys 行 ③ Gadi 主机指纹 ④ Gadi 用户名（③④ 与密钥一起保存，`useGeneratedKey`；高级：选已有密钥文件）⑤ 收件邮箱
  ⑥ 测试连接 / 开启核对；各步完成状态由 `lib/nciSetup.ts` 从 `/v2/inbound-mail` 与 `/v2/nci-verification` 推出；需要
  `nci-verification` / `nci-host-keygen` 的步骤按能力提示）。作业页的 NCI 部分（来源标记、PBS 作业号、可能过时、手动标记结果、
  复制 PBS 作业号）仍由 `jobs` 渲染（模块不互相 import，作业页没有行扩展插槽），只在 `nci` 启用时出现
  （`useModuleEnabled("nci")`）。私钥不经过渲染进程：主机生成的从不离开 cutex，选文件的由 main 读取直接交给 cutex。
- 第 1 步（设置试点）实际落地 13 个模块（`modules/registry.ts`）：锁定的 4 个 + `codex-config`、`memory`（设置第一批删除，2026-10-09）、`agent-bus`、
  `usage`、`archive`、`owner-notify`（`owner-messages`）、`remote-access`（条目级，`notice` / CORS `hide`）、`updater`、
  `runtime-packages`（`runtime-package-upgrade`）。`shell` 拥有 应用组除「对话」外的页、系统组（模块、键盘快捷键、关于）、运行时页（2026-10-09 起是真页面：当前版本；分区 `runtime-packages.settings` 升级 agent、`runtimes.installed` 已安装的运行时（模块 `runtimes`，`runtimes-view`，`notice`））。
  `codex-config` 暂无条目级门控（插件页今天对旧 cutex 也显示，页内自己提示）。在第 1 步里关掉一个尚未整体迁移的模块
  只撤下它的设置贡献；它在别的区域的功能随各自的迁移步骤接入。
- 第 2 步（状态胶囊）加 6 个可关模块：`goal`、`plan`、`background-terminals`、`subagents`、`delegations`（`agent-asks`）、
  `jobs`（`job-service`），注册表里排在 `agent-config` 之后。`delegations` / `jobs` 第 3 步再接页面和导航。
- 第 3 步（页面与导航）加 5 个可关模块：`quick-chats`（`human-create-session`）、`projects`、`services`（`services`）、
  `approvals`（`owner-approvals`）、`task-service`（任务详情页，不门控；r219 删除该页，模块只留旧转录的时间线行），排在 `jobs` 之后；`agent-config` 加 新建 agent
  （条目级 `human-create-agent`），`shell` 加 设置 页（Aside = 设置导航）和底栏 ⚙ 设置。

### 3.5 时间线插槽（第 4 步，已接入）

2026-10-09 基线前：`ReceivedRenderer` / `ToolRenderer` 已按 §3.2 写进 `modules/slots.ts`，`SlotMap` / `SLOT_SPECS` 里有
`timeline.received` / `timeline.tool`（默认 `unavailable: "hide"`），但没有模块贡献、外壳也还不读它们——第 4 步（可交给
GPT）只需加贡献和出口，不改契约。

稳定基线后已在 `268a9e0` 接入以下贡献与出口；下述接口沿用预声明形状，未新增条目种类。

- `timeline.received`：外部输入（时间线 `received` 条目 = cute-codex ExternalInput）的行渲染器，**按 view schema 分派**
  （`ExternalMessage.schema`，如 `cutex.delegation-ask.v1`、`cutex.delegation-results.v1`、`cutex.task-assignment.v1` /
  `cutex.task-followup.v1`）。一个 schema 只能有一个渲染器（注册表测试已加）。没有可用渲染器（模块关了、缺能力 / agent
  特性、未知 schema）→ 核心的普通 agent 消息行（`cutex.agent-message.v1`），收到的东西永远不隐藏。取代
  `lib/receivedRows.ts` 的 `SCHEMA_KIND` 和 `Timeline.tsx` 里的分支。`Row` 收 `{ message, sessionId, readOnly }`
  （`readOnly` = 历史 / 归档 agent，不给回复和操作按钮）。
- `timeline.tool`：工具调用条目（时间线 `tool` 条目：commandExecution、mcpToolCall、dynamicToolCall、collab /
  subagent、agent_delegate …）的行渲染器，**按工具名分派**：按插槽顺序第一个可用且 `match(item)` 为真的赢；都不匹配 →
  核心 `PlainToolRow`。`match` 要纯且便宜（每个工具条目都跑），通常看 `item.type` 加工具 / 服务器名。`standalone(item)`
  为真 = 独立卡片、结束工作组（取代 `lib/workGroups.ts` 的 `isStandalone`）；`activity(item)` = 运行中提示（取代
  `lib/turnActivity.ts` 的 `TOOL_ACTIVITY` 对应项）。
- 两者都是 `SessionItemBase`（可带 `agentFeature`）。贡献者：`task-service`（旧转录里的任务投递、旧 Task Service 工具行）、
  `conversation`（核心，required、不门控）、`delegations`（只有委托卡片）、`subagents`（collab）、`plan`（清单条目随之搬家，
  见 §9 第 2 步暂缓 (a)）。
- **委托相关的门控边界**（2026-10-09 验收 M2 / O6，与基线一致）：委托的 ASK / 结果收到行（`cutex.delegation-ask.v1` /
  `cutex.delegation-results.v1`）**按 schema 一律渲染，不看 `agent-asks`**（`conversation.delegationAsk` /
  `conversation.delegationResults`）：schema 本身就说明 daemon 发了这种消息，旧转录在旧 cutex 上也要能读。cutex agent 工具行
  （`agent_tell`、`alarm_set`、`agent_create` / `agent_archive`、`read_overlength_content`、委托的 wait / close / read /
  progress 等及其旧名）同样是核心的一行格式（`conversation.agentTools`，`taskToolRow`）。只有结束的 `agent_delegate` 调用渲染成
  独立的委托卡片（`delegations.tool`，`standalone`）受 `agent-asks` 和模块开关门控；不可用时它退回核心的一行格式。
  上面「缺能力 → 普通消息行」的回退规则对其他贡献者照旧。

## 4. 能力门控

- 求值依据（v1.5）：**焦点主机**（界面显示的那台；P0 = 范围里唯一的主机）和**其他已连接主机**各自的 `features`
  （`/v2/capabilities` featureList）、主机 `kind`，加依赖模块状态。
  - 模块 `requires`：★ **任一已连接主机满足**（同一台主机满足全部 `capabilities` 和 `hostKinds`）即可激活——通知、审批
    同步这类后台工作要覆盖范围外的主机。`requires.focusHost: true` 的模块只看焦点主机（= v1.4 规则；外部插件：
    frame 绑在一台主机上。终端 2026-10-15 起不再用它：卡片按绑定主机自己判断能力，见 §22）。都不满足时 `missing` 报焦点主机缺什么（与 v1.4 相同）。
  - 条目可见性：全局插槽（导航、设置页、状态项、命令）★ **范围内任一主机**满足「模块能力 ∪ 条目能力」即可用，否则按
    焦点主机缺什么处理；带 session 的插槽按条目所属主机求值（P0 的条目都属焦点主机）。模块因范围外的主机而激活、
    范围内的主机不满足时，它的条目照样按 `unavailable` 处理（不会出现点进去才报错的导航）。
  - 设置分区（`settings.section`）在主机页上（`TargetHostContext` 有值：设置 → 某台主机的页）还要看**页面的目标主机**：
    范围内有主机满足但目标主机不满足「模块能力 ∪ 条目能力」时，`notice` 条目显示标题 +「需要升级 cutex」（缺目标主机
    缺的能力），其余不显示；目标主机能力还没加载时什么都不显示。应用页（没有目标主机）不变（`<SettingsSections>`，
    `lib/hostGatingView` `useHostEntryGate`）。
- 模块 `requires` 不满足 → `unavailable`（不是失败，记下缺什么），不执行 `activate`；它的静态条目中声明了
  `disable` / `notice` 的照样显示（置灰 / 提示），其余撤下；动态条目不存在。主人关掉的模块（`disabled`）什么都不显示。
- 条目 `requires.capabilities` 不满足 → 按 `unavailable`：`hide` 不显示；`disable` 置灰 + 悬停说明缺的能力；
  `notice` 显示分区标题 +「需要升级 cutex」。
- 每个 agent 的特性（`lib/agentFeatures.ts`，Claude 缺部分 Codex 功能）是第二层：只在带 session 的插槽里看条目
  `agentFeature`，`lacks()` 为真同样按 `unavailable` 处理。
- 重新求值时机：能力首次加载、重连后能力变化、换焦点主机、其他主机连上 / 断开 / 能力变化、范围变化、模块开关变化。
  **焦点主机或它的能力变化 = 全部模块按新结果停再启**（新 `generation`、新 `ctx.host`；规则故意简单，对主机不敏感的模块
  也重启）；静态贡献同批替换、引用不变，界面不重挂载。v1.5：其他已连接主机的集合 / 能力、范围变化**不重启**——只重算条目
  可见性（快照替换），因此变得可用 / 不可用的模块单独启停，`ctx.hosts` 的订阅者收到通知（范围外的主机断线重连不该让正在用
  的终端、页面重来）。
- 能力加载前：需要能力的模块 `unavailable`（`waiting: true`），不需要的立即激活。「已加载」= store 的
  `featuresKnown`（能力请求成功后 true，切主机时回到 false）；`modules/app.ts` 把 `hosts` / `features` / `featuresKnown` /
  `byHost` 换成 `HostsInput`（`{ focus, others, scope }`，能力未加载 → `features: null`）交给 `setHosts`，主机列表未到前按
  `local`。`setHost(host)` 保留（= 只有焦点主机的 `setHosts`）。
- 取代：外壳里的 `features.has` / `*_FEATURE`、`SlashCommandSpec.enabledBy`、`lib/delegationStore.ts`、`jobStore.ts`、
  `ownerNotifyStore.ts`、`runtimePackageStore.ts` 的 `supported()` 检查和 `onHostSwitch` 重置（同步循环挪进
  `activate`，靠 `signal` 停）。
- `?legacy` 预览照常：mock bridge 报旧 featureList（`dev/mockFeatures.ts`；模块自己的能力名可写在它的
  `mock.ts` `features` 里），门控逻辑同一套。
- P1（多主机范围）：范围里会有多台主机，带 session 的条目按条目所属主机求值；`HostsInput` / `ctx.hosts` 形状不变。

## 5. 启停与放置

```ts
interface ModulesPrefs {                    // localStorage "cutex-desktop.modules"，按设备
  v: 1;
  enabled: Record<ModuleId, boolean>;           // 只存主人改过的；缺省 = defaultEnabled ?? true；required 忽略
  place: Record<`${SlotId}:${ItemId}`, string>; // 放置覆盖；取值由插槽规定
}
interface ModulePrefs {                     // localStorage "cutex-desktop.module.<id>"，只经 ctx.prefs
  get<T extends Json>(key: string, fallback: T): T;
  set(key: string, value: Json): void;
  subscribe(listener: () => void): () => void;  // React 侧 useModulePref()（modules/react.ts）
}
```

- 放置：插槽在 `SlotSpec.placement`（§3.2）里声明取值和默认。v1 只有 `conversation.status`
  （值 = `StatusPlace`，默认 = `defaultPlace`），把 `ui.statusPlace` 泛化为 `place["conversation.status:<itemId>"]`；
  设置 → 状态显示 的表（`StatusPlaceTable`）和胶囊 `…` 菜单（「在胶囊里显示」勾选：放进 / 拿出胶囊，保留输入栏那一侧）
  都由条目生成。宿主 API（第 2 步）：`placement(slot, item)`（覆盖值合法则用它，否则插槽默认）、
  `setPlacement(slot, item, value)`（等于默认则删掉覆盖；非法值忽略）、`placements()`（覆盖表，稳定引用）；React 侧
  `usePlacement(slot)`。外壳经 `lib/statusItemsView.ts`（`useStatusItems(sessionId)`：可用条目 + 放置，按 agent 的
  `agentFeature` 过滤）读取。
- 设置入口：新页 **模块**（`page: "modules"`），「应用（本机）」组末尾（通知之后），来源 `local`。每模块一行：名字、
  说明、状态（已启用 / 不可用：缺 `agent-asks` 或依赖 X / 出错：错误 + 重试 / 已关闭）、开关（required 锁定，标「核心」）。
  有 `lastError` 时行下显示「最近出错」+ 重试（清掉记录）。深链到一个所属模块已关闭 / 不可用的设置页时，页面显示一行
  说明和「打开 模块」，不报错也不跳走。
- 不兼容旧键：`ui.statusPlace`、`ui.capsuleFolded`（改存条目 id）等改名写进当次迁移说明 + 一次性脚本（先例
  `docs/research/settings-prefs-migration-20261008.md`），app 里不留迁移代码。
- 出错隔离：`activate` 抛错 / reject / 超过 10 s → 该模块 `failed`（记错误），本次登记的贡献全部撤回，依赖它的变成
  `unavailable`，其他照常。每个插槽出口给每个条目实例包 ErrorBoundary：渲染出错只让该实例显示一行「<模块名> 出错：
  <message>」（不可见条目只记日志），错误记进 `lastError` 显示在 模块 页，模块继续运行（一条坏数据不该关掉整个功能）。
  命令 / 快捷键 `run` 抛错 → `services.ui.notice(…, "error")` + `lastError`。

## 6. 生命周期与作用域

1. 顺序：按 `requires.modules` 拓扑排序，同层按注册表顺序。未知依赖 / 循环 → 相关模块 `failed`，错误写明（注册表测试先在
   CI 拦住）。
2. 启动：`activating` → 新 `AbortController`、`generation + 1` → 登记静态 `contributes` → `await activate(ctx)` → `active`。
   `activating` 期间已登记的条目照常显示。生命周期按「轮」串行（启停、开关、重试各一轮）；一轮内每个模块等它的依赖
   求值完再求值，互不依赖的并行，所以一个卡住的 `activate` 只拖住依赖它的模块。主机 / 能力变化会中止正在跑的那一轮
   （卡住的 `activate` 不再等），由新一轮全部重启。
3. 停止（主人关闭 / 焦点主机或它的能力变化 / 不再有满足它的已连接主机 / 依赖停止 / 失败 / 开发时 HMR）：先停依赖它的模块（逆拓扑）→ `stopping` →
   `signal.abort()` → 按登记逆序 dispose 全部贡献和订阅 → `disabled` / `unavailable` / `failed`。
4. 作用域：模块拥有它登记的一切（静态贡献、`ctx.contribute`、`services.*` 返回的订阅），停止时全部撤销；只有模块自己开的
   计时器 / fetch 要听 `ctx.signal`。
5. generation 栅栏：abort 之后 `ctx.contribute` 抛 `AbortError`，服务的回调和写操作直接丢弃——旧主机的迟到结果不会写进
   新主机的状态。
6. 上下文冻结（同 Kutex）：带 `sessionId` 的回调拿调用当时的 sessionId，异步完成后不重读「当前选中」。
7. 页面没有实例：`PageParams` 只在内存（与今天的 `MainView` 一样），不持久化。右侧组件实例的 state 持久化，见 §18.8。
8. 主机（v1.5）：`ctx.host` = 焦点主机，激活时冻结（焦点一换就重启）。`ctx.hosts` = 已连接主机的实时视图：`list()`（焦点在前；
   每项 `id`、`kind`、`features`、`featuresKnown`、`focus`、`inScope`）、`get(id)`、`subscribe(listener)`（其他主机 / 范围变化时
   调用；模块停止时自动退订，之后调用抛 `AbortError`）。范围外主机的工作（例如按事件来源主机问通知的表）用它和
   `services.daemonFor`。

## 7. 窄服务

```ts
interface ModuleServices {
  app: { selection(): { sessionId: string | null; page: { page: ItemId; params: PageParams } | null };
         subscribe(listener: () => void): () => void };
  agents: {
    list(): readonly AgentSummary[]; get(sessionId: string): AgentSummary | null;
    subscribe(listener: () => void): () => void;
    features(sessionId: string): AgentFeatures | null;   // lib/agentFeatures.ts
    openConversation(sessionId: string): void;          // = store.select
    focusTurn(sessionId: string, turnId: string): void; // lib/focusRequest.ts
  };
  daemon: DaemonApi;   // shared/ipc.ts:664；只给内置模块；不含 HostApi（主机管理）
  daemonFor(hostId: string): DaemonApi;  // v1.5：那台已连接主机当前连接上的调用（只给内置模块；模块停止后调用抛 AbortError）
  events: { onHostEvent(l: (e: EventEnvelope) => void): () => void;
            onSessionEvent(l: (e: { sessionId: string; envelope: EventEnvelope }) => void): () => void };
  ui: {
    notice(text: string, tone?: "info" | "error"): void;  // = store.notify（输入框上方一行；还没有 toast）
    confirm(message: string, danger?: boolean): Promise<boolean>; prompt(title: string, initial?: string): Promise<string | null>;
    openPage(page: ItemId, params?: PageParams): void; closePage(): void; openSettings(page: string, focus?: { anchor?: string }): void;
    runCommand(id: ItemId, arg?: string): void;  // command 插槽定型后可用；之前仍用 store.signal
    showStatus(item: ItemId): void;  // 按放置打开胶囊分区或聚焦状态行 chip
  };
  side: { open(kind, params?, opts?): SideOpenResult; reveal(target): SideRevealResult; close(instanceId): void;
          closePeek(): void; list(kind): readonly SideInstanceInfo[] };   // v1.4（§18.8；target "peek" / closePeek 见 §19.4）
  timeline: { focusTurn(hostId, sessionId, turnId, opts?): Promise<FocusTurnResult> }; // v1.4（§19.7），取代预告的 agents.focusTurn
  refs: { open(ref, opts?): Promise<RefOpenResult>; here(): readonly CutexRef[]; parse(raw): CutexRef | null }; // v1.4（§19.9）
}
interface AgentSummary { id: string; name: string; color: string | null; projectId: string | null; runtime: "codex" | "claude"; online: boolean; busy: boolean }
```

- 第 1 步代码里的 `ModuleServices`（`modules/slots.ts`）只有试点用到的 `ui.notice`、`ui.openSettings`；其余服务随用到它的
  迁移步骤按上面的形状加入。第 2 步没有加 `ui.showStatus`：条目自己的请求由 `Bar` 的 `showInCapsule` 接住；等
  `command` 插槽取代 `store.signal` 时再加。第 3 步加了 `ui.openPage` / `ui.closePage`（`closePage` = 回到对话，原
  `closeSettings`）；`modules/app.ts` 导出同一个 `services` 对象，不是模块代码的组件（Composer、需要你条、设置页等）也经它跳页，
  store 里不再有 `openTasks` / `openJobs` / `openProjects` / `openServices` / `openApprovals` / `openTask` / `openNewAgent`。
- 返回 dispose 的服务调用都挂在模块作用域上，停止时自动释放。
- v1 内置模块仍可直接 import `store` / `bridge`；新代码优先 `ctx.services`，迁移某区域时顺手换掉。
- 外部插件拿不到 `daemon`：宿主按授予的权限代调一份白名单方法（§10）。
- v1.5 `daemonFor(hostId)`：给要处理范围外主机的模块（`notifications` 按事件来源主机问它的表）；调用带那台主机的连接
  epoch，主机换代后旧调用被拒（C-011 按主机）。焦点主机的调用仍走 `bridge` / `api`。
- v1.3 退役 `notify.os`（从没进 `ModuleServices` 代码）：通知不再是服务调用，见 §17。核心代码报告一次「发生了什么」
  （`lib/notifyEvents.ts` `emitNotify`），由 `notifications` 模块问主机决定、再交给 `notify.method` 条目执行。

## 8. 文件布局与约定

```
apps/desktop/src/renderer/src/modules/
  types.ts  slots.ts  host.ts     类型（types 无 React）/ SlotMap / host.ts = 在 @cutex-desktop/plugin-host 引擎之上的 adapter
                                  （无 React；保持 renderer 用的 Map / 插槽 / prefs 快照引用稳定，生命周期与回滚在引擎里）
  external.ts  ExternalBadge.tsx  外部插件模块的 `external-` id 命名空间 / 「外部」标记（§10.1）
  settingsVisibility.ts           设置 → 模块 暂不列出的模块（`plugins`，§10.1）
  app.ts                          本 app 的宿主实例：绑定 store（主机 / 能力 → setHost）、localStorage、服务；
                                  main.tsx 调 startAppModules(MODULES)，其余代码用 appModules()
  react.ts                        useSlot(slot)、useModuleStatuses()、useModuleEnabled()、useModulePref()（只放 hook）
  Outlet.tsx                      插槽出口组件（每个条目实例一个 ItemBoundary、unavailable 显示、SettingsSections）
  registry.ts                     export const MODULES: readonly AppModule[]（静态、有序；只有 main.tsx 和测试 import）
  i18n.ts  i18nCatalog.ts         宿主自己的文案（`modules.` 前缀）/ import.meta.glob 自动汇总各模块字典，供 i18n/zh-CN.ts、en.ts 展开
  <id>/index.ts                   export default defineModule({...})——只放定义，不定义组件
  <id>/*.tsx  <id>/*.test.ts      只导出组件（Fast Refresh，AGENTS.md）/ 测试
  <id>/i18n.ts                    export const zhCN = {...} as const; export const en: Record<keyof typeof zhCN, string>
                                  + declare module "../i18nCatalog" { interface ModuleMessages extends Messages {} } type Messages = typeof zhCN;
  <id>/mock.ts                    预览用的 daemon 数据：export const mock: ModuleMock（dev/mockTypes.ts）；只有 dev/ import
apps/desktop/src/renderer/src/dev/
  mockBridge.ts                   mock bridge 核心（主机、agent / 侧栏、线程 / 时间线、队列、profiles、设置）+ 合并模块 mock
  mockModules.ts  mockTypes.ts    import.meta.glob 收集 modules/*/mock.ts / ModuleMock、MockCore 类型
  mockFeatures.ts                 预览的 featureList（新 / ?legacy），与 test/modules.test.ts 共用
```

- import 边界：模块可 import `lib/`、共享 `components/`、`i18n`、`bridge`、`store`（v1）以及宿主文件（`../slots` 等）；
  **不 import 别的模块目录**，共用代码放 `lib/`。外壳文件不 import `modules/<id>/` 和 `registry.ts`（只有 `main.tsx`），
  只经 `useSlot` / `Outlet`。`test/modules.test.ts` 扫描 import 路径检查。registry 不经 `app.ts` 引入，所以设置页组件
  （被模块 import）可以反过来 import `modules/Outlet` 而不成环。
- i18n：模块 key 一律 `<id>.` 前缀（迁移时改名；key 不持久化，无兼容问题）。`i18n/zh-CN.ts` / `en.ts` 展开
  `modules/i18nCatalog.ts` 汇总的字典，`MessageKey` 仍是 `keyof typeof zhCN`，`en` 仍须 key 齐全。汇总用
  `import.meta.glob("./*/i18n.ts")`，新模块不用改 `i18nCatalog.ts`；glob 带不出每个文件的类型，所以每个模块的 i18n.ts
  用声明合并把自己的 `zhCN` 类型并进 `ModuleMessages`（见上），`MessageKey` 照样精确：漏写这段 → 用到该 key 的
  `t(...)` 编译不过；两个模块写了同一个 key 且文案不同 → 编译错误。展开时重复 key 会静默覆盖，测试检查前缀、不重复、
  不与基础词典里写的 key 重名、glob 收齐了每个模块目录、每个 i18n.ts 都有合并声明。基础词典只留外壳 / 核心或多个模块
  共用的 key（如设置框架的分组 / 来源标签、保存 / 取消、胶囊几何、发送键）。
- mock（预览）：模块的 daemon 数据放 `modules/<id>/mock.ts`，导出 `mock: ModuleMock`：`api(core)`（bridge api 方法，
  一个方法只能有一个提供者，重复时安装即抛错）、`start(core)`（定时器 / 脚本回放）、`thread(id)`（脚本化的 thread/read）、
  `cutexState(id, core)`（bootstrap 额外字段）、`settings(core)`（GET /v2/settings 额外字段，`?legacy` 不加）、
  `features`（featureList：`base` 总有，`new` 在 `?legacy` 下没有）、`profile`（模块在 daemon 侧拥有的 profile 字段，
  如 Claude profile 的 `claudeAccount`：`fields` 加进 `GET /v2/profiles` 列表和详情，`patch` 处理 PATCH 体里属于它的键、
  像 cutex 一样抛错拒绝，返回处理过的键；`POST /v2/profiles` 体里的这类键在核心建好 profile 后也走 `patch`，抛错则撤销创建）。核心经 `MockCore` 提供 `legacy`、`emit`、
  `emitCutex`、`emitHost`、`nativeEvent`、`markBusy` / `markIdle`、`unsupportedFor`、`settings`、`settingsView`。
  `dev/mockBridge.ts` 只留核心，新模块不改它。mock.ts 只 import `shared/`、`@cutex-desktop/*` 和 `dev/mockTypes`
  （`test/moduleMocks.test.ts` 扫描），只有 `dev/` import mock.ts；renderer 构建把 `dev/` 和 `mock.ts` 标成无副作用
  （`electron.vite.config.ts`），生产包里没有 mock 数据。
- 滚动条（2026-10-10）：原生滚动条全局隐藏（`styles.css` 的 `scrollbar-width: none`，不占布局宽度，内容开始溢出时
  不再被挤窄跳动），由外壳在一个固定叠加层里画细滑块（`lib/overlayScrollbarManager.ts`，纯逻辑在
  `lib/overlayScrollbars.ts`）：用户滚动或指针悬停时出现在右 / 下边缘，约 1 秒后淡出，悬停变宽，可拖动；滚动本身仍是
  原生的（滚轮、触控板、键盘、`scrollIntoView`）。模块的滚动容器照常写 `overflow-*-auto`，什么都不用做；不要再给滚动条
  留位置（`scrollbar-gutter`、为它加的右内边距），也不要自己写 `::-webkit-scrollbar`。要保留原生滚动条（组件自己画或
  自己定样式）就在元素上加 `data-native-scrollbar`：它和后代不再隐藏原生条（默认 `thin` + 主题色，可用自己的
  `scrollbar-width` / `scrollbar-color` 覆盖，例如右侧卡片标签条 `[scrollbar-width:none]` 完全不要条），外壳也不在里面
  画滑块。终端（xterm 6）自己画滑块、原生视口没有可滚内容，不用加；插件 iframe / webview 是独立文档，不受影响。
- 模块 prefs（`host.prefs(id)` / `ctx.prefs`）与引擎 `createModulePreferenceStore().forModule()` 同一错误语义：非有限 JSON
  抛 `TypeError`；存储写失败（配额、被禁用）原样抛给调用方，值不变、不通知订阅者；读失败沿用上次的值。adapter 自留一份
  实现只为读穿透 + 引用稳定（`useSyncExternalStore`）。
- 测试（vitest）：`test/moduleHost.test.ts`（假插槽表：门控、失败回滚、超时、重试、abort、generation、按主机重启、
  prefs 及其写失败语义、无效 / 重复 id 和依赖环）；`test/modules.test.ts`（注册表 id / 前缀 / 依赖、i18n、import 边界、新 / legacy / 未加载三种 featureList 下
  各插槽可见条目快照、received schema 不重复；featureList 与预览共用 `dev/mockFeatures.ts`）；`test/moduleMocks.test.ts`
  （glob 收齐 mock.ts、mock 的 import 边界、在 node 里装上 mock bridge 检查新 / `?legacy` 两种模式下模块数据合并正确）。

## 9. 迁移顺序

1. **设置（试点）**：宿主骨架（types / slots / host / react / Outlet / registry）+ `settings.page` / `settings.section` +
   模块页 + 门控。`SETTINGS_GROUPS`、`PAGE_SOURCE`、`PAGE_HINT`、`PLANNED_API`、`ICONS` 变成条目字段，`Settings.tsx`
   只剩组顺序和出口。设置重构本身已落地（815a125 基础组件、d7bfc62 导航树），试点只是把它改写成贡献。
   **已落地（2026-10-09）**，但两处按「只动试点需要的」暂缓：设置页组件仍在 `components/settings/`（模块 index import
   它们），原有 `settings.*` i18n key 未改成模块前缀（新 key 已带前缀）；搬组件 / 改 key 时再补齐「迁完」。
   （key 已在 2026-10-09 基线前整理里改完，见第 3 步之后；组件仍在 `components/settings/`。）
2. **状态胶囊**：`conversation.status` + 放置 prefs（迁移脚本）。
   **已落地（2026-10-09）**：6 个模块 `goal`（`agentFeature: goals`）、`plan`、`background-terminals`（`agentFeature:
   backgroundTerminals`）、`subagents`、`delegations`（`agent-asks`）、`jobs`（`job-service`），条目 `<id>.status`，order
   100–600。`StatusCapsule` / `StatusBar` / `StatusPlaceTable` 只遍历 `useStatusItems`（测试扫描它们不含功能名）；
   `BackgroundTasks` 拆成 后台终端 / 子 agent 两个 chip（原来合成一个「N 后台终端 · M 子代理」）；`/ps` 由后台终端接，
   没有终端时转给子 agent（`signal("ps", "agents")`）。prefs：`ui.statusPlace` → `modules.place`，`ui.capsuleFolded` →
   `ui.capsuleFoldedItems`（条目 id），脚本 `scripts/migrate-prefs-20261009-status.mjs`，说明
   `docs/research/status-prefs-migration-20261009.md`。暂缓：(a) 时间线的清单条目（`PlanCard` `ChecklistEntry`）仍在
   `components/`，按条目 id `plan.status` 读放置，随第 4 步搬进 `plan`；(b) `lib/delegationsView` / `jobsView` 的 hook
   里仍有 `features.has`（委托页、作业页、队列也在用），随第 3 步；(c) `useStatus` 在胶囊组件里按序调用，hook 本身抛错
   不在条目 ErrorBoundary 内（Meta / Body / 折叠行在）；(d) 关掉 `background-terminals` 时 `/ps` 没人接。
3. **页面与导航**：`nav.primary` + `main.page`；`MainView` 改为 `conversation | page`，`openTasks` / `openJobs` 等换成
   `services.ui.openPage`。
   **已落地（2026-10-09）**：侧栏入口（order 100–700）`quick-chats.nav`（新工作，▾ 选 profile）、`agent-config.newAgent`、
   `projects.nav`、`services.nav`、`delegations.nav`（⚠ N）、`jobs.nav`（`hide`）、`approvals.nav`（⚠ N），底栏
   `shell.settings`（红点；有落后运行时直接开 运行时）。页面 `shell.settings`、`agent-config.newAgent`、`delegations.page`、
   `jobs.page`、`quick-chats.draft`、`projects.page`、`services.page`、`approvals.page`、`task-service.task`（r219 删除）；页面组件搬进
   各模块目录（`ProjectsPage`、`ServicesPage`、`ApprovalsPage`、`JobsPage`、`TaskDetailPage`（r219 删除）、`NewAgentPage`、`PendingChat`），
   `TasksPage` 拆成 `delegations/DelegationsPage`。外壳：`App.tsx`（`MainOutlet` / `PageAsideOutlet`）、`Sidebar.tsx`（遍历
   `nav.primary`）、新文件 `components/PageTitle.tsx`（面包屑）不含功能名，`test/modules.test.ts` 扫描；`TitleBar` 换页只看
   「当前页有没有 Aside」。i18n：`projects.*` / `services.*` / `approvals.*` / `jobs.*` / `delegations.*` 整组从基础词典搬进
   模块；`nav.*` 入口名、`newAgent.*` 改名进模块（`projects.nav`、`agent-config.newAgent.*`、`quick-chats.nav` 等）。prefs：
   无（`MainView` / `PageParams` 只在内存，没有持久化的键改名，所以没有迁移脚本）。行为变化：没有 `agent-asks` 的 cutex 上
   委托入口置灰（原来显示旧 Task Service 表；那些行曾留在项目页 委托 标签，r219 起该标签没有 `agent-asks` 时只显示一句提示），新工作入口置灰（原来隐藏），都按 §13.2。
   暂缓：(a) 留在 `components/` 的共用件：`DelegationList`（项目页也用）、`TasksPage.tsx` 的 `TaskList`（r219 删除）、
   `Settings.tsx`（shell 页的实现）；(b) 基础词典里仍有 `chat.*`（草稿页与 composer 共用）、`tasks.*`（`TaskList` 共用；r219 只剩作业页用的 `tasks.noProject`）、
   `settings.*`（第 1 步暂缓）、`nav.projectSettings`（侧栏项目组头，核心）；(c) `TitleBar` 其余部分（agent 的服务 chip；
   终端开关 v1.11 起是 `terminal.pty` 的固定启动器，§18.3）属 B 档 `titlebar.*`，`App.tsx` 的 `JobOutputDialog` / `AgentListDialog` 属
   `app.overlay`，侧栏底栏的 `UpdateButton` 仍是外壳；(d) 页面内部的能力检查（`ServicesPage` / `ApprovalsPage` 的
   `supported`、`lib/delegationsView` / `jobsView`）未动；(e) 导航顺序 / 隐藏的主人覆盖（§13.4）未做；(f) 「插件」没有主页面，
   它是 `codex-config.plugins` 设置页（第 1 步已迁）。
   **基线前整理（2026-10-09，kutex-merge-plan §6 第 2、3 项）**：(1) `modules/i18nCatalog.ts` 改成 `import.meta.glob`
   自动收集 + 声明合并（§8）；(2) 第 1 步暂缓的 `settings.*` key 中只被一个模块的代码用到的 493 个搬进该模块并改成 `<id>.`
   前缀（`settings.profile.*` → `agent-config.profile.*`，`settings.ownerNotify.x` → `owner-notify.x`，
   `settings.usage.by.*` → `usage.by.*` 等：首段与模块名相同就去掉，只剩模块名的页面标题 → `<id>.page`），46 个外壳 /
   多模块共用的留在基础词典（设置框架的 `settings.title` / `group.*` / `source.*` / `back` /
   `about.attention`，`save` / `cancel` / `reload` / `loading` / `saved` / `remove*` / `pendingCutex`，`StatusCapsule` 也用的
   `capsuleCorner.*` / `capsuleEdge.*` / `capsuleSize.*`，对话页和快捷键页共用的 `sendKeys.*`，以及
   `profiles.new.title`、`profile.familyHint`、`mcp.tools`）；(3) 每模块 `mock.ts`（§8）：`delegations`、`jobs`、
   `owner-notify`、`runtime-packages`（原 `dev/mock*.ts`）、`codex-config`（原 `dev/mockPlugins.ts` + CODEX_HOME 配置请求 /
   实验特性）、`services`、`approvals`、`usage`、`task-service`（r219 删除）、`goal`、`plan`、`background-terminals`、`subagents`、
   `remote-access`（监听视图、配对、客户端 token）；(4) `timeline.received` / `timeline.tool` 预声明（§3.5）。行为不变
   （预览新 / `?legacy` 两种模式逐页比对过）。仍在 `dev/mockBridge.ts` 核心里的模块数据：profiles / 额度
   （`agent-config`，composer 等核心也用）、项目（`projects`，与侧栏快照绑在一起）、快速对话（`quick-chats`，写侧栏快照）、
   更新器（`updater`，是 preload 的 `update` 命名空间，不是 api）、指令 / 协作 / 设置读写（`/v2/settings` 是核心
   存储，`remote-access` 只贡献派生字段）、featureList 里已有模块的能力名（留在 `dev/mockFeatures.ts` 以保持
   设置 → 主机 → 诊断 里显示的顺序；新模块写在自己的 `mock.ts`）。
4. **时间线**：`timeline.received` + `timeline.tool`（插槽已预声明，§3.5）。
5. 其余 B 档：碰到时迁，迁时把类型补进 §3.2。

一个区域「迁完」= 对应外壳文件里没有功能名（`features.has`、`*_FEATURE`、功能 import）和按功能分支，只遍历
`useSlot`；贡献都在 `modules/<id>/`，门控只走 `requires`；测试覆盖顺序和门控（两套 featureList）；i18n key 已迁入模块并带
前缀（zh-CN / en 齐）；`?legacy` 预览看过（该隐藏的隐藏、该置灰的置灰）；prefs 改名有迁移说明 + 脚本；PROGRESS.md 记一笔。

### 第4步执行结果（稳定基线后，2026-10-09）

`268a9e0` 已完成 received/tool 的通用出口和按模块贡献，任务、ASK/结果、委托工具与子agent行按原插槽门控。
验收后（M2 / O6）：ASK / 结果收到行和 cutex agent 工具行改由核心 `conversation` 贡献、不门控；`delegations` 只贡献委托卡片（§3.5）。
未知schema、能力缺失、模块关闭和渲染异常回退到核心原始内容；standalone/activity也由同一选择器决定。
PlanCard/ChecklistEntry实现在plan模块，核心plan/checklist条目仍走唯一薄facade，未伪造成tool或发明新插槽。
原先第2步暂缓(a)在此完成；第3步剩余共用组件、owner-notify插入与delegation turn-tail等B/C区未扩大迁移。
本轮增加的plugins.manage属于外部桌面插件，与codex-config.plugins设置不同。

## 10. 外部插件（v1.1 隔离接入，安装入口默认关闭）

以下 JSON 是未来完整形态的设计示意；首次接入只支持 §10.1 的明确子集。可直接运行的包见 `examples/plugins/`。

```jsonc
{ "id": "nci-jobs", "name": "NCI jobs", "version": "0.1.0", "apiVersion": 1,   // 同 Kutex API 1
  "entry": "index.html",               // 在隔离 frame 里加载（Kutex：主 realm 里的 ESM）
  "styles": ["x.css"], "dependencies": [],
  "capabilities": ["entries", "views", "commands", "agents.read", "agents.open"], // 强制执行（Kutex 只是文档）
  "contributes": { "nav.primary": [], "main.page": [] },  // 新增：声明式 JSON，组件由 frame 提供
  "requires": { "cutexCapabilities": ["job-service"], "hosts": "any" },  // 新增；hosts: "local" | "any"
  "codexPlugin": "nci-jobs@cutex" }    // 新增：agent 侧 = Codex 插件，由 daemon 安装；取代 Kutex 的 "mcp"
```

- `capabilities` 取值沿用 Kutex §5.3（views / commands / entries / layouts / surfaces / agents.read / agents.open /
  browser），再加 `settings`、`status`、`daemon.<路由组>`；宿主按授予的权限过滤 RPC 方法；安装时列给主人确认，
  设置 → 模块 里可撤销。
- 隔离：`<iframe sandbox="allow-scripts">`（不加 `allow-same-origin`）或无 preload 的 `WebContentsView`；严格 CSP
  （`default-src 'none'`，脚本 / 样式只来自插件包）；没有 `window.cutex`、Node、token，看不到 app 的 localStorage / DOM。
- 通信：postMessage RPC `{ v: 1, id, method, params }` ↔ `{ v: 1, id, result } | { v: 1, id, error }`，按 schema 校验；
  daemon 调用由宿主代办，只开白名单。
- 可贡献的插槽：`main.page`、`side.component`（v1.4 起替代 `conversation.sidePane`，仍未开放）、`settings.page`（frame 内容）、`nav.primary`、`command`
  （声明 + RPC 回调）、`conversation.status`（只给数据行，宿主渲染）。时间线渲染器、composer、菜单暂不开放。v1.4 新增的插槽外部插件都不能贡献，manifest 不变。
- `requires.hosts: "local"` = 内置的 `hostKinds: ["local"]`；`"any"` = 不写。
- 与 MCP Apps（工具结果里的 `ui://` 资源，TODO.md）共用同一个 frame 宿主和 RPC。
- 绝不：桌面端往 agent 配置里写本机路径（Kutex `mcp` 字段的做法，在远程主机上无效）。

### 10.1 v1.1 首次接入边界

`plugins` 是默认关闭的内置管理模块，和 `codex-config.plugins` 的 agent 插件设置分开。它只读取 Electron 独立 userData 中
已放置的插件包并显示请求权限；没有安装/下载/市场入口，示例包位于 `examples/plugins/`，不随产品打包。

- **设置 → 模块 不列出它的开关**（验收 O4，`modules/settingsVisibility.ts` 的 `UNLISTED_MODULES`），等有真实插件和安装入口再露出。
  模块本身照常登记、默认关闭、代码全部接通；以下情况仍列出：它已经开着（以便关掉），或这台设备在 localStorage 设了
  `cutex-desktop.showUnlistedModules = "1"`（开发 / 验收用）。QA 脚本直接写 `cutex-desktop.modules` 打开它，不受影响。

- manifest 沿用上面的 `apiVersion: 1`；可选 `script` 指包内单个脚本文件（由宿主置入 frame），`styles` 指包内样式文件。
  HTML 中自行引用的脚本、远程资源不获得 CSP 放行。包路径、资源大小、id、字段和能力都由宿主校验，拒绝越界路径与符号链接。
- v1.1 增加可选 `ModuleDefinition.displayName` 和 `NavItem.title`，只表示 manifest 中的用户文本，按普通文本渲染；
  `titleKey` 仍为必填、严格 MessageKey 的翻译后备值，内置模块无需修改。SDK 声明快照同步更新，不伪造动态翻译 key。
- 首次贡献形状：`main.page: [{ id, title, order? }]`；`nav.primary: [{ id, title, page, order?, area? }]`。
  id 是包内局部 id，adapter 映射到 `external-<pluginId>.<id>`；nav 的 page 必须指本包声明的页，不能借用内置动作。
  包 id 最长55字符，避免 external- 前缀超出64字符模块限制。catalog fingerprint覆盖规范化manifest和全部资源字节；包更新必须重新授予权限。
- 首次支持声明式 `main.page` / `nav.primary`。实际可授予能力为 `views`、`entries`、`agents.read`、`agents.open`、
  `settings`（仅自己的模块偏好）。`commands`、`status`、`browser`、`daemon.*`、其他插槽及未识别能力在装载时明确拒绝，
  等有真实 adapter 和对应契约后再增加；不以声明代替实现。`codexPlugin` 只作 agent 侧引用元数据，不写本地路径或自动安装。
- grant 由主人在内置管理页明确选择，默认空集，并且与 manifest 请求取交集；撤销、禁用、切主机、卸载立即关闭旧 frame/RPC。
  `agents.read` 只返回最小元数据，`agents.open` 绑定原 host lifetime；`settings` 不得访问其他模块 localStorage 命名空间。
- 配额与节流（`modules/plugins/permissions.ts`）：插件自己的设置整体存成模块 prefs 里的一个对象，每插件最多 64 个键、
  32 KiB（UTF-8 JSON），超出返回错误；`settings.set` 的值为 `null` 即删除该键。存储写入失败（如 localStorage 配额）向插件
  返回错误，不报成功。`agents.open` 跨 frame 拿不到可信的用户手势，改为每个 frame 至少间隔 2 秒，过快的调用返回错误。
- 动态模块保留 `requires.cutexCapabilities` / `requires.hosts` 门控，不能冒用内置 id 或声明 required。frame 故障不影响其他模块。
- `external-` 是外部模块独占的 id 命名空间（`modules/external.ts`，内置模块不得使用，测试检查）。外壳按模块 id（不按插件给的
  文字）在侧栏导航条目、页面标题、设置 → 模块 的名称旁显示「外部 / External」标记（验收 O5），插件即使自称「设置」也
  不会被当成内置项。
- Electron 用独立资源协议返回宿主生成的隔离文档，iframe 始终 `sandbox="allow-scripts"`、不带 `allow-same-origin`。
  文档有自己的严格 CSP；父页面仅增加该 frame 源，不放宽父页面 `script-src`。无 preload、Node、token、通用 daemon RPC。
  浏览器协议 fixture 与真实 Electron 的 CSP/导航验收分别记录，不能互相替代。
- 父页面 CSP 只有 `frame-src cutex-plugin:`（去掉了不需要的 `'self'`）；`cutex-plugin` 特权只有 `standard` + `secure`，
  不带 `supportFetchAPI`（frame 导航不需要；没有它，任何页面对该 scheme 的 fetch 都在 Chromium 里直接失败）。
  Electron 44.5.1 实测（Windows，`protocol.handle` 注册的自定义 scheme）：`session.webRequest.onBeforeRequest` 对该 scheme
  **会触发**，子 frame 请求的 `resourceType` 为 `subFrame`，`cancel: true` 能挡住文档加载；带 `supportFetchAPI` 时 fetch
  也会以 `xhr` 经过它。所以 main 的 `onBeforeRequest`（只放行本窗口、本主人、`subFrame`）是真实生效的一层，不只是单测 mock。
- **CSP 之外的出网通道在 Electron 层关闭**（验收 M1，`main/pluginNetwork.ts`）。插件 frame 与 app 窗口共用 webContents
  和默认 session；CSP 管 fetch / WebSocket / EventSource / beacon / WebTransport / 媒体 / CSS / 字体，管不到 WebRTC
  （STUN/TURN 的 UDP 与 TCP、到远端候选的 ICE-TCP）和 `<link rel=dns-prefetch>`（network service 里的投机 DNS 查询）。
  所以：所有 webContents 一律 `setWebRTCIPHandlingPolicy("disable_non_proxied_udp")`（app 自己不用 WebRTC）；第一次
  `prepare` 插件文档之前，默认 session 设成指向死端口的 SOCKS 代理（`<-loopback>`，本机也不放行；dev 只放行
  `ELECTRON_RENDERER_URL` 的 host:port），network service 的 DNS 设成只走指向同一死端口的 DoH（`secure`，无明文回退）。
  失败则不发文档，下次重试。之前不动 Chromium 网络：不打开插件页的主人不受影响；打开后本次运行内 Chromium 不再出网，
  app 自身不受影响（renderer 只加载 file:// / dev server，daemon / SSH / 更新走 Node 或子进程），唯一被挡的是 Linux 上
  hunspell 拼写词典的下载。sandbox bootstrap 另外删掉 `RTC*` / `webkitRTC*` / `WebTransport` 构造器，只是纵深防御。
  `scripts/qa-plugin-egress.mjs` 是两个 Electron QA 脚本共用的探针：本机 UDP/TCP 汇点 + CDP isolated world 里的
  WebRTC（模拟插件拿到了构造器）+ 各种资源提示 + Chromium net log 判 DNS（不得有系统解析，DoH 只能去死端口）。
- **导入边界澄清**：交接书 §3.2 要求 app 接通 sandbox，而 §4.2 的“app 不 import plugin-sandbox”按核心不得耦合执行。
  唯一例外为受信任 `modules/plugins/` adapter 与 `main/plugins.ts` 资源加载器（frame 形状与一次性文档 store 2026-10-13 起在
  `@cutex-desktop/opaque-frame`，它的导入者见 §10.2）；其他 app 文件不能直接依赖 sandbox，
  app 任何位置都不依赖实验 service-plugin-host。此窄例外单列于迁移说明与边界测试，不通过全局放宽检查绕过。

内部 frame 握手/MessagePort 包络包含每次装载的身份和 channel，用于拒绝重放或错误来源；guest 只得到 `sandboxBridge.call`，
没有独立授予能力的 API。协议实现和 host lifetime 的安全回归随此接入提交。

### 10.2 共享的不透明 frame 与 agent 页面（2026-10-13，`feat/agent-side-display`；不改契约版本）

主人 2026-10-13 同意复用外部插件的隔离 frame 显示 agent 的 HTML 成果（「同意你的复用之类的，你也可以抽出来，合理就行」；
研究 `docs/research/agent-side-display-20261013.md` §3.2 A）。frame 本身抽成最小的源码包 `@cutex-desktop/opaque-frame`
（私有、无依赖、无 React / Electron / 协议 / bridge）：

- `.`（renderer）：`applyOpaqueFrame` / `createOpaqueFrame`（`sandbox="allow-scripts"`、`referrerpolicy="no-referrer"`、
  `allow` 关掉摄像头 / 麦克风 / 定位 / 剪贴板 / 全屏 / 支付）与 `onFrameNavigatedAway`（第二次 load = 页面自己跳走）；
  `plugin-sandbox` 的 `mountSandbox` 用同一个 frame 形状。
- `./page`（DOM 无关，main 用）：`buildOfflinePageDocument(html)` 与 `OFFLINE_PAGE_CSP` = `default-src 'none'; script-src
  'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none';
  object-src / frame-src / child-src / worker-src / manifest-src / base-uri / form-action 'none'`——**完全不联网，loopback 也不行**，
  不允许 `unsafe-eval`。文档开头是宿主的 charset + CSP meta + 删 `RTC*` / `WebTransport` 构造器的脚本，再接页面原文（去掉它自己的
  doctype）；上限 4 MiB（= `ARTIFACT_CONTENT_MAX`）。没有 bootstrap bridge、MessagePort、nonce：页面能跑自己的内联脚本，但没有任何可调用的东西。
- `./documents`（main）：`createFrameDocumentStore({ scheme })`——一次性文档（30 s 未取即过期，总数 32、每个 renderer 8），
  只出一次，响应头 `CSP; sandbox allow-scripts` + `nosniff` + `no-referrer`，URL 是该 webContents 的导航租约直到 release。
  **插件文档和 agent 页面共用 main 里同一个 store**（同一个 `cutex-plugin://frame/<id>/index.html` scheme、同一个
  `onBeforeRequest` / `will-frame-navigate` 租约检查、同一次 `releaseOwner`），所以仍只有一个 frame 宿主要审计；父页面 CSP 不变
  （`frame-src cutex-plugin:`）。

agent 页面（`artifacts.view` 的 `html` 预览，`text/html` / `application/xhtml+xml` / `.html` / `.htm`）：
- renderer 只发 `{ hostId, artifactId, version }`（具体版本；`@latest` 标签先解析）到 IPC `cutex-desktop:frames`
  （`shared/frames.ts`，preload `bridge.frames`）；main（`main/frames.ts`）自己从那台主机的 `/v2/artifact-store/…/content` 取字节、
  在第一份文档之前跑 `pluginNetwork.ensure()`（WebRTC / 代理黑洞 / DoH，与插件相同），再放进共享 store。HTML 不经 renderer → main，
  token 不离开 main。外部文件已变、非 UTF-8、被截断（> 4 MiB）→ 返回原因，视图改显示源代码。
- 视图头上「页面 / 源代码」切换（`ViewState.code`）；页面自己跳走（链接、刷新）被 main 拦下，视图显示「已拦下 · 重新加载」。
- 不需要审批：它什么都碰不到。需要联网的东西是服务（`service_register`），由主人在自己的浏览器标签里打开。

导入边界（`packages/plugin-host/test/package-boundaries.test.ts`）：`plugin-sandbox` 仍只由 `modules/plugins/` 与 `main/plugins.ts`
导入；`opaque-frame` 只由 `plugin-sandbox`、`main/index.ts` / `main/plugins.ts` / `main/frames.ts` 与
`modules/artifacts/PageFrame.tsx` 导入。浏览器预览（无 Electron）由 `vite.preview.config.ts` 的 `mock-frames` 插件扮演 main 的
文档服务（同一个文档、同一个 CSP 头），只为预览把 `frame-src 'self'` 加进预览页的 CSP。

同一提交（desktop-only quick wins，研究 §4）：`artifacts` 的 `conversation.overlay`（对话里的小卡片，`lib/agentToasts.ts` +
`components/AgentToasts.tsx`）和 `settings.section`（设置 → 对话 →「{{agent}}发布成果时」：自动在右侧打开 / 只提示 / 不提示），
正在看的 agent 现场发布时自动在右侧打开 `af-…@latest`（规则见 `modules/artifacts/autoOpen.ts`）；`services` 处理
`cutex/services/revealRequested`（卡片「… 想给你看：… · 打开」→ 主人登录池的浏览器标签，浏览器模块关时用服务原来的打开方式）。
都是现有插槽的条目，插槽形状、`ModuleDefinition`、SDK 类型不变，所以 `MODULE_API_VERSION` 不变、声明快照不动。

## 11. 与 Kutex WorkbenchHost 对照

| Kutex API 1 | 本约定 | 他们的宿主要补的 |
|---|---|---|
| owner scope，停用即撤销 | 模块作用域（§6.4） | — |
| discovered / disabled / activating / active / failed / stopping | 同（discovered = 在注册表里）+ `unavailable` | `unavailable` 及 `missing` 原因 |
| `ctx.signal` + generation fence | 同 | 触发源：主机 / 能力变化 → 重启 |
| dependencies；缺失 / 循环失败；部分失败只回滚本次 | `requires.modules`，同 | 依赖不可用时级联 `unavailable` |
| registerView（page / left / right / dialog / floating） | `main.page`、`side.component`（right，§18）、`app.overlay`；left = `conversation.gutter`（§19） | 无 floating |
| 视图实例（JSON state、stateVersion、migrateState） | 右侧组件实例 + 放置规则（`stateVersion` / `restore`，§18）；页面仍只在内存 | — |
| registerCommand / registerEntry | `command`（`keybinding`、`composer.slash` 引用）/ `nav.primary` | 徽标 hook、`unavailable: "disable"` |
| registerLayout / registerSurface | 不做，外壳固定 | — |
| context global / project / agent，binding fixed / follow-selection，调用时冻结 | 插槽参数带上下文（`sessionId`），外壳传当前 agent；同样冻结 | — |
| `services.agents`、`services.browser` | `services.app / agents / daemon / events / ui / notify`；无 browser | 补这些服务 |
| 字符串标题 | `titleKey: MessageKey`（类型化 i18n） | 支持 key |
| — | `required`（锁定）、`defaultEnabled`、放置覆盖、条目级 `requires` / `agentFeature` | 都要补 |
| 静态 `RuntimeAdapterDescriptor`，单机 | 活动主机的 `/v2/capabilities`，切主机重启 | 按主机能力求值 |
| 粗插槽（view / entry / surface） | 细插槽（§3） | 对 `SlotMap` 泛型，不都当视图 |

包形状（引擎是 `@cutex-desktop/plugin-host`，§15；`modules/host.ts` 是它之上的 adapter，对 renderer 保持下面这套 API）：
`createModuleHost<M, Svc, K>({ modules, slots, host, storage, services(id), scopedServices?, t?, activateTimeoutMs?, log? }) → { modules, statuses(), snapshot(slot), subscribe(l), isEnabled(id), setEnabled(id, on),
setHost(host), retry(id), reportError(id, error), prefs(id), addModules(defs), removeModule(id), placement / setPlacement /
placements, idle(), dispose() }`；`statuses()` / `snapshot()` 在内容
不变时返回同一引用（`useSyncExternalStore`），通知按微任务合并。React-free；React 绑定在本仓库 `react.ts`。

外部插件的权限执行层：**受信任的 renderer broker**（`modules/plugins/permissions.ts` + `@cutex-desktop/plugin-sandbox` 的
`createBroker`）按授予的权限放行每个 RPC 方法，并做 host lifetime、配额、节流检查；**main** 不解释插件权限，只负责插件包
指纹 / 文档归属（一次性文档、按窗口）、frame 导航限制和出网封锁（§10.1）。

## 12. 与 daemon 服务插件的关系

- 受信任后台（作业、手机通知外发、NCI / PBS / 邮件适配器）是 daemon 的**进程外**服务（Job Service 那样），由 cutex /
  persistent-runtime-host 托管；桌面端不安装、不启动它们。
- 服务在 `/v2/capabilities` 报能力名（如 `job-service`）→ `requires.capabilities` 匹配的模块亮起。模块只经 Management v2
  路由访问服务（如 `GET /v2/job-service/capabilities`），不直连。
- 服务内部的细粒度能力（如作业的 `humanOperations`）由模块自己查，用在条目显隐上，不进 `requires`。
- 服务自带界面：以后定。候选：(a) 声明式描述（列表 / 表单）由一个通用内置模块渲染；(b) 走 §10 的隔离 frame 宿主。
- 一个功能 = Codex 插件（agent 侧）+ 服务插件（后台）+ 桌面模块（界面），各自安装、各自升级，靠能力名对上
  （`docs/research/remote-jobs-plugin-brief.md` 的 A / B 两层）。
- v1.15 修正（可选组件规格 v2）：桌面端可以**请求** cutex 安装 / 移除一个可选组件（`POST /v2/components/{name}/install|remove`，
  空 body）；下载、校验签名、准备、选用、启动、重启都由 cutex 做。桌面端从不自己下载、启动组件，也不碰主机上的文件。

### 12.1 可选组件卡片（v1.15）

- 数据：`GET /v2/components`（能力 `components`，仅主机主人，在 `shared/users.ts` `OWNER_ONLY_CAPABILITIES`）、
  `POST /v2/components/{name}/install|remove`（202 `{operation}`，拒绝按值返回）、主机事件 `cutex/components/updated`（收到就重读）。
  类型与读取器在 `@cutex-desktop/cutex-client` `components.ts`，`shared/components.ts` 转出；主进程 `daemon.ts` 转发，preload 同一桥。
  渲染端 `lib/componentStore.ts`（每台主机内存状态，卡片挂载时才读、安装进行中慢速轮询兜底）。
- 出口：`modules/Outlet.tsx` `MainOutlet`——打开的页面属于有 `requires.component` 的模块时，用 `components/ComponentCard.tsx`
  `ComponentGate` 包住页面，目标主机 = 焦点主机。状态由纯函数 `lib/componentCard.ts` `componentCardState` 决定（`test/componentCard.test.ts`）：
  未连接 → 页面（页面自己显示离线）；能力未加载 / 首次读取中 → 空；非主人连接 → 「请主机主人安装」；
  没有 `components` 能力 → 「更新 cutex」（按钮打开 设置 → 主机后端更新，并把设置主机切到这台），Linux 专用组件在 Windows 主机上 →
  「不支持 Windows」（桌面端自带的小表 `KNOWN_COMPONENT_PLATFORMS`；有能力时以 cutex 的 `supported` 为准）；
  `ready` / `external` → 页面；安装进行中 → 进度（`operation.step`）；`needsUser` → 步骤（`steps` 或 `detail.steps`）；
  `restartPending` → 页面上方的横幅（旧版本还在跑，作业要看得见）；`managed: false` 或 `installFrom: none` → 「手动设置，见指南」（组件 README）；
  `installFrom: source-only` → CLI 命令 `cutex component install <name> --from-source <dir>`；`degraded` → 错误 + 重试（仍有选用版本时为横幅）；
  `notInManifest` → 「这个 cutex 版本没带，更新 cutex」；`missing` → 「安装」按钮 → 进度 → 结果；不认识的状态 → 原样显示 + 重新检查。
- 旧主机（没有 `components` 但有模块能力，例如手动部署了 Job Service 的旧 cutex）：「更新 cutex」卡片另有「仍然打开这一页」（本次运行内记住）。
- 卡片文字按组件名取 i18n（`modules.component.<name>.name|what`），未知组件用通用文字。
- 只有 `main.page` 走整页卡片。`jobs` 的状态项（胶囊、输入栏）和作业轮询另外跟随组件：`lib/componentCard` `componentUsable`
  （没有 `components` 能力 = 旧 cutex，照旧；`ready` / `external` / `restartPending` / 仍有选用版本的 `degraded` = 可用；列表未读 = 暂不可用），
  `lib/jobsView` `useJobsEnabled`、`lib/jobStore` 的 `supported()`、作业页的其他主机都看它——组件缺失时什么都不显示、不调用 Job Service。
- 紧凑形式 `ComponentNotice`（2026-10-16，`feat/components-claude`）：用到组件但不是它的页面的地方——Claude 运行时（`claude-runtime`）出现在
  设置 → Profile 的新建表单（类型选 Claude 时）、Claude Profile 详情顶部、Claude 账户分区顶部、新建智能体选了 Claude Profile 时。可用或主机说不清
  （没有 `components`）时不显示；其他状态同卡片的一行 + 同样的操作（安装、重新检查、指南、命令…）。只挡做不成的事：新建智能体在
  `componentBlocks`（missing / installing / needsUser / unmanaged / source-only / notInManifest / 不支持的平台 / 没有可用版本的 degraded）时禁用「创建」，
  并说明原因；查看、建 Profile 不挡。
- 线上形状（与 cutex 约定，2026-10-16）：POST 202 `{operation: {id, name, action: install|remove, state: running|done|failed, step, error}}`，body `{}`；
  事件 `cutex/components/updated` 带 `{name, reason: operation|state|startup, state, operation|null}`；`needsUser` 组件带顶层 `steps: string[]`；
  拒绝码 `unmanaged_install`、`component_unsupported_platform`、`component_external`、`upgrade_blocked`、`component_pinned`、`jobs_running`
  各有一句中英文说明（`modules.component.refusal.<code>`），其余显示 cutex 原文。

## 13. 已定的默认（2026-10-09，主人可改）

1. 模块开关按设备存；能力按主机求值。
2. 不可用的导航入口默认置灰（能力加载前后不跳动）；只在部分主机上有的（作业）隐藏。
3. 锁定：`shell` / `conversation` / `connection` / `agent-config`。
4. 放置覆盖 v1 只用于状态类别；导航顺序 / 隐藏以后有需要再加。
5. 模块页放在「应用（本机）」组末尾。
6. 外部插件 v1 不能贡献时间线渲染器、composer、菜单。
7. 主机或能力变化时全部模块重启（规则简单优先）。

## 14. 变更记录

- 2026-10-09 v1：初版（第 1–3 步落地）。
- 2026-10-09 基线前整理：模块 i18n 改为 `import.meta.glob` + 声明合并（§8）；模块的 `settings.*` key 迁进模块；
  每模块 `mock.ts` + `ModuleMock` / `MockCore`（§8）；`timeline.received` / `timeline.tool` 预声明（§3.5，契约同 §3.2）。
- 2026-10-09 稳定基线后：源码SDK与单一module引擎接入；v1.1动态登记、纯文本模块/导航名称、默认关闭的隔离插件adapter
  与精确权限子集（§10.1、§15）；timeline received/tool贡献及fallback接入。完整提交/验证/未验项目见
  `docs/research/gpt-migration-20261009.md`。不把本次候选交付视为Windows验收已完成。
- 2026-10-09 验收修复（M2 / O6，§3.5）：委托 ASK / 结果收到行按 schema 一律渲染、cutex agent 工具行由核心 `conversation`
  渲染，只有委托卡片受 `agent-asks` 门控。只改了哪个模块贡献哪个条目（贡献者归属与门控），插槽形状、`ModuleDefinition`、
  SDK 类型都没变，所以 `MODULE_API_VERSION` 仍是 1.1，不升版本。
- 2026-10-09 验收修复（`docs/research/gpt-migration-acceptance-20261009.md`）：插件 frame 的 WebRTC / DNS 预取出网在 Electron
  层关闭（M1）；「桌面插件」开关暂不列出（O4）；外部模块「外部」标记（O5）；插件设置配额、`agents.open` 节流、父页面
  `frame-src` 与 scheme 特权收窄、`onBeforeRequest` 实测（§10.1）；模块 prefs 错误语义统一，§8 / §11 改为 adapter 描述。
- 2026-10-09 v1.2（§16，`feat/contract-v12`）：`MODULE_API_VERSION` 1.1 → 1.2。状态胶囊抽成可关闭模块 `status-capsule`
  （默认启用）；新插槽 `conversation.statusSurface`（固定 `bar` = shell、`capsule` = status-capsule，每个 id 一个提供者，
  重复在登记前拒绝）和 `conversation.overlay`（受信任，只表达锚点 / 留白）；`StatusItem.supportedSurfaces`（可选）；
  `StatusBarProps.reveal`（`home` / `showInCapsule` 保留为适配字段）；布局、命令路由、计划清单折叠一律读实际位置。
  偏好存储不变（`bar | capsule | both | off`、胶囊几何键），无迁移脚本。可选依赖、模块详情 UI 延后。
- 2026-10-15 设置目标主机与搜索门（`fix/settings-host-scope`、`fix/settings-search-newcomer`）：`SettingsPageItem` 加可选
  `hostPart`，`SettingsSearchSection` 加可选 `access` / `part`，`SettingsSectionItem` 加可选 `sections`（§3.2）；搜索与分区渲染共用
  `lib/settingsGate.ts`，按设置目标主机判断。只是 app 层插槽的可选字段，SDK / 引擎类型不变，`MODULE_API_VERSION` 不升。
- 2026-10-15 用量「全部主机」（`feat/usage-all-hosts`）：`SettingsPageItem` 加可选 `allHosts`（§3.2），`HostPicker` 加「全部主机」行；
  只是 app 层插槽的可选字段，SDK / 引擎类型不变，`MODULE_API_VERSION` 不升。
- 2026-10-09 设置搜索（§3.2「设置搜索」，`feat/settings-search`）：`SettingsPageItem` 加可选 `keywords` / `sections`
  （新类型 `SettingsSearchSection`），`SettingsSectionItem` 加可选 `keywords`；`lib/settingsNav.ts` 加 `settingsAnchorId`。
  只是 app 层插槽的可选字段，SDK / 引擎类型不变，旧条目照常工作，所以和第一批设置导航一样 `MODULE_API_VERSION` 仍是 1.2。
- 2026-10-09 v1.3（§17，`feat/notifications-p0`）：`MODULE_API_VERSION` 1.2 → 1.3。新插槽 `notify.method`（`unavailable: "hide"`）；
  锁定核心模块 `notifications`；退役 `services.notify.os`（§3.1、§7）。声明快照 `module-api-1.3.d.ts`（SDK 类型除版本常量外不变）。
  本地开关 needsInput / turnCompleted 删除，`mutedProjects` 一次性迁到 cutex `projectOverrides`（不保留旧格式）。
- 2026-10-09 v1.4（§18、§19，`feat/side-p0`）：`MODULE_API_VERSION` 1.3 → 1.4。新插槽 `side.component`（取代 B 档草案
  `conversation.sidePane`）、`conversation.gutter`、`timeline.turnAttachment`、`ref.action`、`ref.target`（都是 `unavailable: "hide"`）；
  `services.side` / `.timeline` / `.refs`；`StatusItem.icon` / `side`、`OverlayLayout.side`、`PageItem.refParams`（可选字段）。
  P0 落地右侧区（外壳容器、页按钮、实例层、三种「右栏与对话」、设置卡片「会话两侧」）、`workspace` / `diff` 模块和 `subagents.thread`；
  §19 的宿主随 P1a。声明快照 `module-api-1.4.d.ts`（SDK 类型除版本常量外不变）。语义扩展（可持久化的组件实例、声明式放置、
  通用引用）已报主人（RFC §13 D1、D58）。
- 2026-10-09 r219（cutex 删除 Task Service，`feat/r219-cleanup`）：`task-service` 模块只留旧转录的时间线行（`timeline.received`
  `task-service.received`、`timeline.tool` `task-service.tool`，不门控），删除 `main.page` 条目 `task-service.task`（任务详情页）、
  它的 `mock.ts` 和 `task-service.crumb`；共用的 `TaskList`（`components/TasksPage.tsx`）及 `DelegationList` 的旧任务回退 /
  「历史任务（旧）」折叠删除，没有 `agent-asks` 时紧凑模式不显示、完整列表显示 `delegations.unavailable`。只是撤下一个模块
  条目和 app 层组件，插槽形状、`ModuleDefinition`、SDK 类型都没变，所以 `MODULE_API_VERSION` 不变。
- 2026-10-10 §19 宿主（P1a，`feat/side-p1a`）：`conversation.gutter`（按钮 / 弹出 / 常驻、进输入框工具行、躲胶囊）、参考卡片与核心组件
  `conversation.turnPeek`（RFC 的 `turn.peek`）、`peekTarget` 设置、`timeline.turnAttachment`（页边 / 内联）、`ref.action` 出口、
  `services.refs` 分发、`services.timeline.focusTurn`（翻页 ≤ 5、跨 agent、「回到」）、Esc 链。`modules/slots.ts` 的契约类型没变，
  `MODULE_API_VERSION` 仍是 1.4；只加了 app 层内部字段：`MenuAction.labelNode`、`FocusRequest.land` / `onDone`、`store.loadOlder` 的 `opts`
  （UI 偏好 `peekTarget` / `gutterDocked` 在 P0 已声明）。偏差与延后见 §19.12。
- 2026-10-10 v1.5（多主机 P0，`feat/multi-host-p0`；RFC `docs/research/multi-host-rfc-20261009.md` §9.1、§12）：`MODULE_API_VERSION`
  1.4 → 1.5。SDK：`ModuleRequires.focusHost`、`ModuleHostsTarget` / `HostsInput`、`ModuleHostEntry`、`ModuleHostsContext`、
  `ModuleScope.hosts` / `ModuleContext.hosts`、`ModuleEngineOptions.hosts`（可选）、`ModuleHost.setHosts`。引擎：任一已连接主机
  激活、条目按范围求值、只有焦点主机变化才全部重启（§4、§6）。app 层：`ModuleServices.daemonFor`；`SideBinding` 的 `follow`
  带 `hostId`（§18.5，旧存档读取时补成布局所属主机）；`terminal` 模块与外部插件定义 `requires.focusHost: true`；`notifications`
  改读 `ctx.hosts`。P0 范围只有一台主机，单主机行为不变（`test/singleHostSnapshot.test.ts`）。声明快照 `module-api-1.5.d.ts`。
- 2026-10-10 v1.6（§20，主人决定 Claude 账户不要单独的设置页）：`MODULE_API_VERSION` 1.5 → 1.6。新插槽 `profile.fieldAction`
  （`unavailable: "hide"`，条目 `{ field, Action }`，出口 `<ProfileFieldActions>`）；`claude-accounts` 的 `settings.page`
  `claude-accounts` 改为 Profile 页的 `settings.section` `claude-accounts.accounts`（`SettingsTab` 删 `claude-accounts`），Profile 总览
  在列表后渲染 `<SettingsSections page="profiles" />`，`openSettings("profiles", { anchor })` 滚到分区。声明快照 `module-api-1.6.d.ts`
  （SDK 类型除版本常量外不变）。`ProfileCreateRequest.claudeAccount`（`POST /v2/profiles` 已接受）让「添加 profile」也能选账户。
- 2026-10-10 叠加滚动条（§8「滚动条」）：原生滚动条全局隐藏、外壳画叠加滑块，退出标记 `data-native-scrollbar`。只是外壳
  样式约定，插槽、`ModuleDefinition`、SDK 类型都没变，不动 `MODULE_API_VERSION`。
- 2026-10-10 v1.7（§19.6，成果库 P0，`feat/artifacts`；wire 契约 `docs/research/artifacts-api-v1.md`）：`MODULE_API_VERSION` 1.6 → 1.7。
  Markdown 认 `cutex:<种类>/<key>` 链接和图片（转义 `#cutex-ref:`，只对有 `ref.target` 的种类生效，核心不点名模块）；`RefTargetItem`
  加可选 `useLink(ref)`（chip 的提示 / 徽标 / 语气 / 图标）和 `thumbnail(ref, maxBytes)`（图片链接的缩略图）。新模块 `artifacts`
  （`requires.capabilities: ["artifacts"]`）：`artifacts.library`、`artifacts.view`（新页组 `artifacts`，§18.6）、`timeline.tool`
  `artifacts.tool`（`artifact_publish` 卡片）、`ref.target` 种类 `artifact`、`ref.action`（复制链接 / 在右侧打开）。`diff.view` 加一种
  只在内存里的来源 `text`（`{ source: "text", key, title, diff }`，不恢复，§18.8），成果「对比」用它。声明快照 `module-api-1.7.d.ts`
  （SDK 类型除版本常量外不变）。
- 2026-10-11 页组登记（内嵌浏览器 I2 前置）：§18.6 页组 `browser` 由「以后」改登记 `browser.tab`。页组不是枚举、代码里没有页组快照，`side.component`
  插槽形状、`ModuleDefinition`、SDK 类型都没变，所以 `MODULE_API_VERSION` 仍是 1.7，声明 / 插槽快照不动。`browser.tab` 本身随 I2 的 `browser` 模块落地。

- 2026-10-11 v1.8（§19.3）：`GutterItem.anchor` 可选 `top | composer`，默认兼容输入框锚定。顶部入口在全宽/窄屏仍固定在会话顶角，容器负责下开浮层、状态胶囊/参考卡片/常驻列表避让。批注与书签从左侧入口进入，“全部”在列表内部；书签 v3 单独保存自动上下文与显式项目勾选。声明快照 `module-api-1.8.d.ts`（SDK 中立类型仅版本常量变化），app 插槽有编译期正反例。
- 2026-10-11 v1.9（§18.13，`feat/keep-mounted`）：`MODULE_API_VERSION` 1.8 → 1.9。`SideBodyProps` 加 `keepMounted(hold): boolean` 与 `held`；
  实例层的 `KEEP_HIDDEN = 4` 常量改为设置 `sideKeepHidden`（★4，1–12），新设置 `sideKeepMounted`（★4，1–8）。`side.component` 条目形状、
  `ModuleDefinition`、SDK 类型除版本常量外不变。声明快照 `module-api-1.9.d.ts`；`test/moduleSdkContract.test.ts` 有正反例，
  `test/sideKeep.test.ts` 覆盖规则。
- 2026-10-11 v1.10（§18.14，`feat/side-open-held`）：`MODULE_API_VERSION` 1.9 → 1.10。`services.side` 加 `openHeld` 与 `releaseHold`，
  新类型 `SideOpenHeldOptions` / `SideOpenHeldResult` / `SideOpenHeldRefusal` / `SideHoldLocator` / `SideReleaseHoldOptions`；`open()` 的选项与结果不变。
  `side.component` 条目形状、`SideBodyProps`、`ModuleDefinition`、SDK 类型除版本常量外不变。声明快照 `module-api-1.10.d.ts`；
  `test/moduleSdkContract.test.ts` 有正反例，`test/sideOpenHeld.test.ts` 覆盖语义。
- 2026-10-12 v1.11（§18.2、§18.3，`feat/titlebar-launchers`；主人决定 2026-10-12）：`MODULE_API_VERSION` 1.10 → 1.11。`side.component` 的
  `launcher` 成为具名类型 `SideLauncher`：加可选 `pin?: "default" | "never"` 和 `newParams?(): Json | null`，删掉 app 内部的 `button?: boolean`
  （侧聊、终端改用 `pin: "default"`，浏览器也是 `pin: "default"`，模块默认关闭，启用后才出现）。标题栏右侧改为启动栏
  （`components/side/TitleBarLaunchers.tsx`，取代 `TitleBarPageActions.tsx`），页操作移到页按钮那一道顶部与 ＋ → 本页；新 UI 偏好 `sideLauncherPins`
  （按设备，只存与缺省不同的选择，无迁移）；`MenuAction.toggle`（菜单行末尾的开关，菜单不关）。`ModuleDefinition`、SDK 类型除版本常量外不变。
  声明快照 `module-api-1.11.d.ts`；`test/moduleSdkContract.test.ts` 有正反例，`test/modules.test.ts` 钉住缺省固定的组件，`test/sideLaunchers.test.ts`
  覆盖固定、顺序、点击规则、窄窗口收起、徽标与门控。lead 复核（同日）：启动器对已在别的页的 multi 组件也是显示那张（不新开），新实例只来自 Ctrl/⌘ / 中键 /「新…」；
  状态分类排在工具类之后（＋ 里另起一段），按 `status:<id>` 派生来源分组，不加契约字段；`newParams` 留在 v1.11。
  主人（同日）：「新开而不替换」按浏览器习惯统一（§18.8 末）——Ctrl/⌘ / 中键 = 后台新开保留标签，加 Shift = 显示；启动器的 Alt 改成 Ctrl/⌘；
  `SideOpenOptions.background?`（v1.11，可选）。打开文件缺省改为「替换」（旧缺省一次性迁移，`sidePreviewRev`）。lead（同日）：保护预览标签里的工作——
  `SideBodyProps.keep()`（v1.11，必有成员；外壳提供，模块只调用）与替换守卫（§18.2 `transient`）；SDK 声明快照不变（`SideBodyProps` 属 app 层），
  `test/sideReplaceGuard.test.ts`。
- 2026-10-12 v1.12（§21，`feat/project-artifacts-services`；主人 2026-10-12 要项目页也有成果库和服务，界面由 lead 定）：`MODULE_API_VERSION`
  1.11 → 1.12。新插槽 `project.tab`（`unavailable: "hide"`，条目 `{ tab, order, titleKey, Body, useSummary? }`，Body 参数 `{ hostId, projectId }`）。
  项目页的五个核心标签变成插槽次序 100–500，模块标签按 `order` 插在中间（`lib/projectTabs.ts` `mergeProjectTabs`，纯函数）；只列项目所在主机
  有模块 / 条目能力的条目（`lib/projectTabsView.ts`，复用 `useHostEntryGate` / `entryGateNow`）；侧栏项目菜单「打开项目页面」的子菜单同一份。
  `artifacts` 贡献「成果库」（310，项目范围的库视图 = 侧栏卡片同一个 `LibraryPanel`，打开版本 = 右侧标签，绑定项目主机），`services` 贡献「服务」
  （320，服务页同一张表只取该项目的行）；两者都给概览计数。核心 `ProjectTab` 类型不变，页面参数 `tab` 现在也可以是模块的标签名。
  声明快照 `module-api-1.12.d.ts`（SDK 类型除版本常量外不变）；`test/moduleSdkContract.test.ts` 有正反例，`test/projectTabs.test.ts` 覆盖合并与两个过滤。
- 2026-10-13（§10.2，`feat/agent-side-display`；主人同意复用插件 frame 显示 agent 的 HTML 成果）：frame 形状、离线页面文档和一次性文档
  store 抽成 `@cutex-desktop/opaque-frame`，插件与 agent 页面共用 main 里同一个 store；`artifacts.view` 新预览类型 `html`；
  `artifacts` / `services` 各加一个 `conversation.overlay` 条目，`artifacts` 加一个 `settings.section`。只用现有插槽，插槽形状、
  `ModuleDefinition`、SDK 类型都没变，所以 `MODULE_API_VERSION` 不变，声明 / 插槽快照不动。顺带：设置 → 对话页之前没有渲染
  `page: "conversation"` 的模块分区（批注、侧聊、浏览器的设置都看不到），现在在页尾渲染。
- 2026-10-13 v1.13（§19.3，`feat/timeline-intro`；主人需求：会话从头可见时显示「开场」，profile 立绘 + 开场白）：
  `MODULE_API_VERSION` 1.12 → 1.13（合并 main 后由 1.12 改号：1.12 已给 `project.tab`）。新插槽 `timeline.intro`（`unavailable: "hide"`；条目 `{ id, order?, when?, render }`，
  props 只读：`sessionId` / `hostId` / `profileName` / `providerKind` / `agentName`）；出口在 `TimelineBody` 最上
  （`modules/TimelineIntro.tsx`，`memo` + 原始值 props：流式重渲染不波及开场），只在会话开头真的可见
  （`hiddenTurns === 0` 且无更早一页游标，且首屏不在加载 / 出错状态）且设置 → 对话 →
  「显示会话开场」开着（UI 偏好 `timelineIntro`，★开）时渲染；只读时间线（子 agent 视图、参考卡片）不挂；
  每个会话最多显示一项（按 order 第一个可用的；`when` 与 render 工厂都在条目自己的 `ItemBoundary` / 出口守卫里跑，
  按实际选中条目归因），条目按 `${hostId}\0${sessionId}` 键控——同主机内换会话必重挂载。第一个贡献者：模块
  `intro`（默认开，无能力要求）——立绘按「profile 自定义（本机，lib/introAppearance）→ provider 默认立绘
  （lib/launchArt，可选）→ 无」回退，开场白按「profile 自定义 → provider 问候语（lib/providerGreetings）」，
  占位符 `{{owner}}`（主人称呼）/ `{{name}}`（agent 显示名）。声明快照 `module-api-1.13.d.ts`（SDK 中立类型仅版本
  常量变化）；`test/timelineIntro.test.ts` 覆盖条件、选取、回退顺序、占位符与存储清洗。
- 2026-10-14（§18.1、§18.3、§18.12，`feat/side-dual-lane`；主人 2026-10-14：要回竖条 + 横向标签的双栏，至少作为选项）：设置
  「右栏布局」（UI 偏好 `sidePageBar`，★`"lane"` 竖条 + 标签页 / `"tabs"` 仅标签页）。竖条模式 = 2026-10-13 前的样子：`SideLane`
  在右栏打开时也在（顶部收起侧栏 + 页操作，收起时留位），没有 `SideTabStrip`；`sideFrame` 加输入 `pageBar`，打开的右栏另加 `LANE_EXTRA`
  （44 − 8 px 缝），卡片宽度两种模式相同。拖放、快捷键不变（细栏药丸 = y 轴）。外壳布局，不涉及插件契约：`MODULE_API_VERSION` 不变。
- 2026-10-13（§18.1、§18.3、§18.12，`feat/side-tabstrip`；主人 2026-10-12 选方案 A）：右栏打开且 ≥ 2 页时，页按钮从对话与右栏之间 44 px
  的竖向一道改成右栏顶部一行横向页标签条（`SideTabStrip.tsx`），页操作（钉住、⤢ ⛶ ⋯、收起侧栏）移到这一行最右端；竖向 `SideLane` 只在
  右栏收起时出现（「右栏收起时」= 保留），药丸位置设置只作用于它。`appearance.sidePaneWidth` 不再含那一道。拖放的药丸命中带轴
  （`lib/sideDrop.ts` `PillAxis`、`pillPageOp`），反馈在标签条上横向画。外壳布局，不涉及插件契约：`MODULE_API_VERSION` 不变，快照不动。
- 2026-10-13（§18.6、§19.6，`feat/delegation-side-detail`；主人 2026-10-13：点委托看它的信息，不要跳回很早的时间线）：`delegations`
  模块加右侧组件 `delegations.detail`（`multi`、`transient`、`defaultBinding: "host"`，key = ask id；新页组 `delegations`）和 `ref.target`
  种类 `delegation`（key = ask id，`hostId` = 记录所在主机；`open` 总是在右侧打开，主机总是引用的主机，从不换成选中 agent 的主机；2026-10-15 起（`fix/delegations-side-stale`）绑定到该主机上当前打开的 agent（`{kind:"agent"}`，没开 agent 时才绑主机），`stateVersion` 2 丢掉旧的主机绑定实例——主机绑定会让一个 agent 的委托详情出现在同主机每个 agent 旁边；
  `useLink` 给 `cutex:delegation/<id>` chip）。内容 = 时间线委托卡片展开后的同一块（`components/DelegationCard` `DelegationDetailBody`），
  上面一行 #tag 标题、委托方 → 承接方、模型、状态；标签标题「委托 #3 · 标题」。核心列表不点名模块，用 `lib/delegationOpen`
  `openDelegationDetail(host, askId)` = `refs.open({ kind: "delegation" }, { how: "page" })`，打不开（模块关着、cutex 没有委托、主机不在视图）
  时委托页退回原来的跳转。改成打开详情的点击：输入栏「委托 N」/ 胶囊里的行、委托页的标题、待处理委托与随行行的 #tag / 标题、ASK / 结果 /
  已回复行和给主人消息里的 #tag；「跳到委托卡片」留在右键 / ⋯ 菜单。时间线卡片自己仍是展开 / 收起。只用了已有插槽形状：`MODULE_API_VERSION`
  不变，快照不动。
- 2026-10-13（`feat/remote-jobs-module`；主人：功能叫「NCI 远程作业」，不是通用的「远程作业」）：新内置模块 `nci`（默认关闭，§3.4），
  拿走 `jobs` 的 设置 → 远程作业 页（改名 NCI 远程作业，页 id `remote-jobs` → `nci`，条目 `jobs.remoteSettings` → `nci.settings`），
  改成分步设置向导；作业页的 NCI 部分改为跟随 `nci` 是否启用。mock 拆分：收件邮箱 / Gadi 核对进 `modules/nci/mock.ts`（从未配置开始），
  `jobs/mock.ts` 只留作业数据。插槽形状和 SDK 未变，不升版本。
- 2026-10-15 v1.14（§22，`feat/codeblock-run`；主人 2026-10-09，TODO.md「Run button on shell code blocks」）：`MODULE_API_VERSION`
  1.13 → 1.14。新插槽 `timeline.codeBlockAction`（`unavailable: "hide"`；条目 `{ match(block), Action }`，`SessionItemBase`；
  `match` 收 `{ language, hostId, platform }`，`Action` 另收 `sessionId` / `code` / `incomplete`）。出口：`Markdown.tsx` 的
  `components.code`（→ `components/ReplyCodeBlock.tsx`）——只有 `CodeBlockScope`（`lib/codeBlockScope.ts`）给了范围的 Markdown（`Timeline.tsx` 的 agent 回复、非只读）
  才看插槽；没有匹配的条目时仍是 streamdown 默认代码块，有匹配时用 streamdown 导出的 `CodeBlock` + 下载 + 复制再接条目。
  第一个贡献者 `terminal.runCode`（▶ 运行：按主机系统挑标签、多行两步确认、复用 / 新开工作区终端）。声明快照
  `module-api-1.14.d.ts`（SDK 中立类型仅版本常量变化）；`test/moduleSdkContract.test.ts` 有正反例，`test/modules.test.ts` 钉住插槽快照，
  `test/codeBlockRun.test.ts` 覆盖标签 / 主机匹配与单行 / 多行确认。
- 2026-10-16 v1.15（§12.1，`feat/components-card`；可选组件规格 v2 §5）：`MODULE_API_VERSION` 1.14 → 1.15。`ModuleRequires` 加
  `component?: string`（引擎不看它，只由 app 的 `MainOutlet` 用来显示组件卡片）。§12 修正：桌面端可以请求 cutex 安装组件，自己从不
  下载、启动或碰文件。新增 `GET /v2/components`、`POST /v2/components/{name}/install|remove`、事件 `cutex/components/updated` 的客户端；
  `components` 进 `OWNER_ONLY_CAPABILITIES`。`jobs` 用 `component: "job-service"`。声明快照 `module-api-1.15.d.ts`（只多了 `component` 与版本常量）；
  `test/moduleSdkContract.test.ts` 有编译探针，`test/componentCard.test.ts` / `test/componentStore.test.ts` / `packages/cutex-client/test/components.test.ts` 覆盖状态与客户端。

## 15. 动态模块登记（v1.1，稳定基线后迁移）

唯一引擎为 `@cutex-desktop/plugin-host`；共享类型来自 `@cutex-desktop/plugin-sdk`，`MODULE_API_VERSION = "1.15"`（v1.2 – v1.4、v1.6 – v1.14 只改 app 层插槽，见 §16 – §22、§18.3、§18.13、§18.14、§19.3、§19.6；
SDK / 引擎的类型除版本常量外不变；v1.5 加多主机输入与 `ctx.hosts`，见 §4、§6；v1.15 加 `ModuleRequires.component`，引擎不看它，见 §12.1）。
原有内置模块定义、插槽形状、prefs key、主机和 agent 门控保持 v1 行为。

- `addModules(definitions): Promise<void>`：先校验整批 id、与现有定义的重复及合并后的依赖环；失败时整个批次不登记。
  成功时按输入顺序追加，不重新启动不受影响的现有 owner，不改变同 order 条目的既有排序。调用后的 `idle()` 等待相同生命周期队列。
  尚未存在的依赖按原有 missing-dependency 规则处理；批次内部的依赖可按拓扑激活。
- 新增两方法的校验失败均返回 rejected Promise；撤销仍在调用返回前同步失效，不因 Promise 接口而延后权限关闭。
- `removeModule(id): Promise<void>`：未知 id 为幂等空操作；`required` 模块拒绝删除。
  同步使该 owner 和所有传递依赖 owner 的 signal/service scope 失效，然后按逆拓扑清理；返回的 Promise 等待清理完成。
  被删模块的状态与贡献消失，仍登记的依赖者为 unavailable，直至依赖恢复；不停止 daemon agent。
- `modules` 是只读、实时的定义列表；新增/移除必须通知订阅者。没有修改时保留引用，既有快照/组件身份稳定。
- 移除保留显式 enabled/placement 和模块 prefs；重加相同 id 必须产生新 generation，旧 ctx 不能贡献、调用服务或接收回调。
- remove/add、切主机、dispose 和同步订阅回调之间发生重入时，较新的撤销仍优先；已经发出的外部副作用不回滚。
- 这些 API 接收可信 `ModuleDefinition`，本身不是权限授予或任意代码加载入口。外部 manifest 由内置 `plugins` adapter 校验，
  转成贡献隔离 frame 的定义；不能冒用内置 id、声明 required 或取得 renderer bridge。权限与 host/capability 门控同时生效。
- v1.1 实现提交包含 SDK `.d.ts` 输出快照、版本断言、`SLOT_SPECS` 键/默认值快照和包边界测试；不通过改旧断言隐藏回归。

临时架构例外（lead 批准，2026-10-12）：`shared/browser.ts` 中的 **browser activation signal, to be replaced by a Module API activation query**
供 browser、审批与设置读取模块激活状态；它只控制 UI 展示，不授予浏览器或 IPC 权限。后续由 lead 用 Module API 激活查询替换，本轮不扩展 Module API。
`browserOwnerErrorKey` 等纯 helper 可以继续放在 `shared/`。

## 16. 状态展示位置与可关闭的胶囊（v1.2）

依据：GPT 提案 `desktop-modules-v1.2-design-plan.md`（迁移工作区 `docs/`），主线维护者裁定范围：做 P0 / P2 / P3 和 P4 的
最小部分，P1（可选依赖）延后。本节与提案不同处以本节为准。实现：`lib/statusSurfaces.ts`（纯函数）、
`lib/statusItemsView.ts`（app 绑定）、`modules/status-capsule/`、`modules/ConversationOverlays.tsx`、`lib/overlayLayout.ts`。

### 16.1 两个固定展示位置

| surface | 提供者 | 可服务的 reveal | 说明 |
|---|---|---|---|
| `bar` | `shell`（`shell.statusBar`，核心，锁定） | view、edit | 输入框正上方的状态行；面板属于各条目的 `Bar` |
| `capsule` | `status-capsule`（`status-capsule.surface`，默认启用、可关） | view | 悬浮胶囊；只读展示 + 暂停 / 继续等小操作 |

- `conversation.statusSurface` 条目：`{ surface: "bar" | "capsule"; intents: ("view" | "edit")[]; reveal?(target) }`。
  不开放任意 surface id，不做通用布局系统。
- 一个 surface 只有一个已登记提供者：按定义（静态 `contributes`）认定，关掉的提供者也占着 id；重复在登记前拒绝
  （初始注册表：后来者 `failed`；`addModules`：整批 reject，什么都不登记），不能「后写者赢」。删除原提供者后才可由别的模块提供。
  `ctx.contribute` 动态贡献的 surface 条目不算数（解析只认定义里的那一项）。
- 提供者可用 = 它的条目在插槽快照里（`show`）。否则原因取模块状态：`disabled`、`unavailable`（主机类型 / 能力 / 硬依赖，
  详细原因仍在 设置 → 模块）、`failed`、`not-ready`（activating / stopping），没有提供者 = `absent`。

### 16.2 状态条目支持的位置

- `StatusItem.supportedSurfaces?`：声明 `bar` 必须有 `Bar`；`capsule` 用 `useStatus` / `Body`（本来必填）。
- 缺字段（v1.1 条目）由适配器推导：有 `Bar` → `["bar", "capsule"]`，否则 `["capsule"]`；不默认声称都支持。
- 登记前检查 `defaultPlace` 映射出的集合 ⊆ 支持集合（`off` 的空集总合法）；不满足 → 该模块 `failed`（初始）或整批拒绝
  （动态）。旧偏好超出支持集合时不拒绝模块：保留 requested，解析给出 `unsupported`。
- 检查挂在 `modules/host.ts` adapter 的 `validate` 选项上（`modules/app.ts` 传 `checkStatusContributions`）；中立 SDK / 引擎不变。

### 16.3 保存的选择与实际位置

偏好不变：`place["conversation.status:<itemId>"] = bar | capsule | both | off`，映射为 `{bar}`、`{capsule}`、`{bar,capsule}`、空集。

```ts
interface ResolvedPlacement {
  requested: StatusPlace;                         // 保存值，运行时从不改写
  effective: readonly ("bar" | "capsule")[];      // requested ∩ 支持 ∩ 可用提供者
  unavailable: readonly { surface: "bar" | "capsule";
    reason: "unsupported" | "absent" | "disabled" | "unavailable" | "not-ready" | "failed" }[];
}
```

| 保存的选择 | 胶囊关闭 / 失败 / 删除时的实际位置 | 保存值 |
|---|---|---|
| bar | bar | bar |
| both | bar | both |
| capsule | 无常驻展示 | capsule |
| off | 无常驻展示 | off |

- 只在胶囊里的条目不会被自动挪到输入栏；胶囊回来后自动恢复。
- 布局（胶囊是否挂载、正文留白）、chip（`inline` = effective 含 bar）、命令路由和计划清单折叠全部读 `effective`。
  没有任何实际位置时，时间线的 `update_plan` 条目显示完整清单（`shownSomewhere`）。
- 条目自身的模块 / agent 门控照旧（条目不在 `useStatusItems` 里），不伪装成 surface 原因。

### 16.4 reveal

`StatusBarProps.reveal(intent, openBarPanel?)` → `{ status: "opened"; surface } | { status: "unavailable"; unavailable[] } | { status: "stale" }`。
宿主实现：`revealStatusItem(scope, itemId, intent, openBarPanel)`（`lib/statusItemsView.ts`），核心是纯函数 `revealStatus`。

1. 作用域：调用方渲染时的 `{ hostId, sessionId }`。入口处当前主机 / 选中 agent（且在对话视图）不同 → `stale`，什么都不打开，
   也不转到新的主机 / 会话。
2. 目标顺序：effective 里能服务该 intent 的位置（`both` 仍是输入栏优先）→ 输入栏临时面板（条目支持 bar 且调用方给了
   `openBarPanel`）→ `unavailable`（带原因）。`edit` 只有 bar 能服务，所以目标编辑总在输入栏。`off` 照旧可以显式打开临时面板。
3. 胶囊的 `reveal` 只在该 agent 的胶囊视图已挂载时打开（`not-ready` 时试下一个目标，不排队）；迟到的滚动在视图换掉后不执行。
4. 调用方不得「成功但看不见」：shell 的 `BarPart` 在 `unavailable` 时给一行提示（`status.revealUnavailable`）。
5. `home` / `showInCapsule` 仍传给 v1.1 的 `Bar`，由适配器从 effective 推导（`legacyHome`）并转进同一个 `reveal`；
   不再有直接改胶囊偏好 / DOM 的第二条路径（原 `lib/statusItemsView.ts` 的 `showCapsuleSection` 已移入胶囊模块，只有
   胶囊自己和它的 `reveal` 用）。内置的目标、后台终端、子 agent 已改用 `reveal`。删除旧字段属于以后的破坏性升级。
6. `services.ui.showStatus`（§7）仍未实现：目前只有状态条目自己会发起打开，入口是 `StatusBarProps.reveal`。

### 16.5 `conversation.overlay`

- 受信任、内置专用：`{ Overlay: ComponentType<{ sessionId; reserve(layout | null) }> }`，`layout = { anchor: "top" | "bottom"; overColumn: boolean }`。
  只表达胶囊今天需要的锚点和留白：`overColumn` 时正文加上 / 下内边距，`anchor: "top"` 时长消息的吸顶「收起」下移。
- `Conversation.tsx` 经 `modules/ConversationOverlays.tsx` 按 agent 挂载每个可用条目（各自 ItemBoundary、按 session 重挂），
  不 import 胶囊，也不按模块 id 分支；条目卸载（模块关闭、渲染出错）时报告 `null`，留白随之释放。
- 胶囊自己决定是否显示（有条目的 effective 含 capsule）和保留多少空间；留白不随内容有无变化（与 v1.1 相同，不跳动）。
- 2026-10-15（UI 审阅 #1，契约版本不变，仍是内置专用）：
  - **dock**：`Conversation.tsx` 在输入框上方的正常流里提供一个 dock 元素（`lib/conversationDock.ts` 的
    `ConversationDockContext` / `useConversationDock()`），与队列、交互 dock 同一叠放。要主人动手的卡片（开网页授权卡）
    portal 进 dock，不再浮在消息上；没有 dock（`null`）时不渲染。
  - **测量**：`ConversationOverlays.tsx` 把每个条目包在 `display: contents` 的 `data-overlay-item` 元素里；
    `Conversation.tsx`（`lib/timelineReserve.ts`）按仍然浮在正文栏上的部分（收起的胶囊、书签 / 批注条）给时间线加上 / 下内边距，
    `GutterHost` 透过这层包装找条目。
  - 胶囊在栏宽 < 720px、开了侧栏，或完整胶囊会伸进正文时收成一行药丸，点开是临时 popover（点外面 / Esc 关）。

### 16.6 设置归属

- 设置 → 状态显示（`page: "status"`，设置第一批前叫「状态胶囊」/ `capsule`）仍属 `shell`：「放在哪里」表读 requested；胶囊关闭时页首说明 + 「打开 模块」，
  行下写原因（「已选择胶囊，但胶囊当前关闭」）；当前不可选的位置（胶囊 / 两者）置灰、方向键跳过，已保存的选择照样显示，
  可以改成其他可选位置。可选性只看条目支持 + 提供者已登记且可用，不要求对话视图挂载。
- 胶囊的位置、贴靠、始终显示、大小是 `status-capsule` 的 `settings.section`（同一页），模块关闭时随之隐藏；值仍存
  `ui` / 外观偏好（`capsuleCorner`、`capsuleEdge`、`capsuleAlways`、`capsuleOpen`、`capsuleFoldedItems`、`capsuleScale`），关模块不丢。
- 设置 → 模块 里胶囊一行的说明写明关闭的后果（P4 只做到这一步，没有新的模块详情界面）。

### 16.7 关闭胶囊时释放什么

关闭 = 卸载 overlay：Ctrl+. 监听、视图登记（reveal 入口）、条目 `useStatus` 订阅（例如作业的按视图轮询）和留白一起释放；
只有胶囊调用条目的 `useStatus`（测试扫描），所以关胶囊后不会变成常驻轮询。不停 daemon 作业、不清业务状态（计划、作业等模块
照常 active）、不改放置和几何偏好。重新打开：同一批条目对象回到插槽，按保存值恢复。

### 16.8 验收场景（测试：`test/statusSurfaces.test.ts`）

| 编号 | 场景 | 覆盖 |
|---|---|---|
| S1 | 胶囊启用 / 关闭 / 失败 / 删除 / 重加 × 四种保存位置 | 解析表、requested 不变、业务模块仍 active |
| S2 | 重复 surface、未知 surface、bar 无 `Bar`、默认位置不受支持 | 登记前拒绝，原提供者不被覆盖，`addModules` 整批拒绝 |
| S3 | `/goal`、`/ps` 一类打开 | view / edit 筛选，编辑总在输入栏，胶囊关时退到输入栏面板或给原因 |
| S4 | 期间切主机 / 切 agent / 胶囊视图换代 | `stale`；旧视图的释放不影响新视图 |
| S5 | 只在胶囊、胶囊关 | 时间线完整清单 |
| S6 | 关胶囊 | overlay / surface / 设置分区撤下，偏好不变，留白释放，只有胶囊调 `useStatus` |
| S7 | 关胶囊后的设置 | 深链页仍在，几何分区隐藏，不可选项 / 原因文案（中英） |

预览（新 / `?legacy`、中 / 英、浅 / 深）另记在 PROGRESS.md。

### 16.9 延后与兼容

- **可选依赖（提案 P1）延后**：现在没有消费者需要它；状态条目不依赖胶囊，`requires.modules` 语义不变。以后另行定版。
- **模块详情（P4）**：不做新界面、不做 `inspectModule`。
- 外部插件：manifest `apiVersion: 1` 不变，不能贡献这两个新插槽，权限不扩大。
- 回退：存储没变，旧版本（1.1）读同样的 `cutex-desktop.modules` 和 ui 偏好；它不认识 `status-capsule` 模块，会忽略这个开关、
  按内置胶囊照常显示（关掉的胶囊在旧版里会重新出现）。`enabled["status-capsule"]` 留在偏好里无害。

## 17. 通知方式插槽 `notify.method`（v1.3）

依据：`docs/research/notification-levels.md`（主人 2026-10-09 批准）。主机（cutex）存两张表：事件 → 等级
（urgent / needsYou / inform / record），等级 → 通知方式（矩阵）。**设备执行主机的表**：只能在本机把设备端方式关掉，不能加。

```ts
type NotifyMethodAvailability = "ok" | "unsupported" | "needsPermission";
interface NotifyMethodItem extends SlotItemBase {        // id = <module>.<x>，order 决定同方式的提供者
  method: "desktop" | "sound" | "bigAlert";              // 设备端方式（矩阵的「本设备」列）
  titleKey: MessageKey;
  available(): NotifyMethodAvailability;                  // 同步、便宜；needsPermission 时设置页给「允许」
  requestPermission?(): Promise<void>;
  deliver(n: NotifyDelivery): void;                       // 只在主机决定 + 本机没关 + 主人没在看时调用
}
interface NotifyDelivery { key: string; event: string; eventTitle: string; level: NotificationLevel;
  title: string; body: string; agentId: string | null; agentName: string | null;
  sound: boolean;                                         // 大提醒同时带响铃（声音不再单独播）
  onClick?(): void }
```

- 插槽 `unavailable: "hide"`；同一方式取第一个可见条目（`order` 小的）。内置条目：`notifications.desktop`（Electron
  `Notification`，在 main 里显示，窗口藏到托盘时照样工作；预览里是网页通知）、`notifications.sound`、
  `notifications.bigAlert`（main 的置顶大窗，`main/ownerAlert.ts` 泛化为任意 urgent 事件）。
- 流程：核心代码 `emitNotify`（`lib/notifyEvents.ts`：key、注册的事件 id、标题 / 正文、主人是否正在看、点击动作）→
  `notifications` 模块问主机 `POST /v2/notification-levels/evaluate`（失败时用已取到的表在本地算，`decideLocally`）→
  去掉本机关掉的 / 不可用的方式（`devicePlan`）→ 调条目 `deliver`。owner_notify 记录自带 cutex 的决定（`actions`），不再问。
- 「需要你」/「侧栏标记」是固定的应用内列，P0 仍按原逻辑显示，不由插件提供。手机列由 cutex / 手机执行；外发列（webhook 等服务端方式）P1 以后。
- 没有 `notification-levels` 能力的主机（r216 及更早）：只有「本设备」分区；需要输入 / 审批照旧发桌面通知，回合结束不再通知，项目静音不可用。
- 外部插件不能贡献这个插槽（manifest `apiVersion: 1` 不变）。
- 回退到 1.2：旧版读 localStorage `cutex-desktop.notify`，迁移成功后它已被删，所以旧版回到默认开关（需要输入开、回合结束关、无静音）；
  cutex 里的 `projectOverrides` 留着无害。

## 18. 右侧区 `side.component`（v1.4）

规范来源：RFC `docs/research/right-panel-rfc-20261009.md` §3–§5（设计理由、例子、风险都在那里）；本节是约定的摘要，
改格式先改本节。P0 实现：`feat/side-p0`。

### 18.1 术语、结构与外壳文件

| 层 | 代码 | 是什么 |
|---|---|---|
| 右侧区 | `components/side/SideArea.tsx` | 右栏（显示当前页；≥2 页时页按钮按「右栏布局」：★左边一道竖向页按钮，或顶部一行页标签）；右栏收起时可留一道 44 px 竖向页按钮；右栏宽 = `appearance.sidePaneWidth` |
| 页按钮 | `SideLane.tsx`（竖向细栏：★竖条 + 标签页时右栏打开也在，顶部带页操作；右栏收起时）、`SideTabStrip.tsx`（仅标签页时右栏打开：顶部横向页标签条 + 页操作）、`lib/sidePills.ts` | 一页一颗药丸（§18.3） |
| 页 | `SidePage` | 上下排列的卡片，带页组 `groups` 与可选名字；≤ 9 页 |
| 卡片 | `SideCard.tsx` | **一种**组件的一个或多个实例；≤ 6 张 / 页（§18.4） |
| 标签 | `SideInstance` | 一个打开的实例：绑定 + 可序列化 `state` |
| 组件 | `SideComponentItem` | 模块贡献的种类（插槽 `side.component`，条目 id = 组件 id，`<模块 id>.<名字>`） |

- 外观：窗口背景 `--win` 上放卡片（`.shell-card`：`--bg`、1 px `--card-border`、14 px 圆角、`--card-shadow`），间距 8 px；侧栏、
  标题栏无边框，选中的侧栏行 / 导航项也是卡片。
- 外壳文件不点名任何功能（`test/modules.test.ts` 扫描）：`components/side/*`、`components/settings/SidesSettings.tsx`、
  `lib/side*.ts(x)`、`lib/useSideShortcuts.ts`。例外只有 `lib/sideKinds.ts` + `lib/sideOpen.ts`：核心的固定打开入口（文件链接、
  git 标签、回合「查看变更」、subagent 标签）点名组件 id。

### 18.2 条目类型与 Body 参数

`modules/slots.ts`（`SideComponentItem`、`SidePlacement`、`SideBinding`、`SideBodyProps` 等，React 类型只在这里）。要点：

- `instances: "singleton" | "multi"`；`defaultBinding: "follow" | "agent" | "workspace" | "host"`（§18.5）；`placement`（§18.6）。
- `parseParams(params)`：别的模块传来的参数（它们不能 import 本模块的类型）→ 本组件的参数，null = 拒绝。
- `dedupeKey?(params)`：同绑定同 key → 复用实例；缺省 singleton = 常量，multi = 从不复用。
- `init(params, previous)`：参数 → 初始 state（复用时用新参数再调一次）。`restore?(raw, version)`：旧 state → state，**null = 丢掉这个标签**
  （state 恒为 null 的组件不要写 `restore`）。`stateVersion` 缺省 1；`persist: false` = 不跨重启。
- `useTab(props)` → `{ title, tooltip?, busy?, attention?, unread? }`：外壳为每个绑定可见的实例跑一个隐藏探针，页按钮、标签行、提示用它
  （不在视野里的卡片也有徽标）。要便宜：只读 store / 已有缓存。
- `Body` / `Actions?` 拿 `SideBodyProps`（`lib/sideBody.ts`）：`instance`、解析后的 `hostId` / `sessionId`、`setState`（≤ 4 KiB）、
  `visible`、`active`、`mode`、`where`、`revealed`、`close()`、`open()`（缺省落到本页）、v1.11 `keep()`（预览 → 保留标签，见下 `transient`）。取数据 / 轮询只在 `visible` 时做。
- `transient`（预览：下一次打开替换它，标签与单实例卡片标题用斜体，双击标签保持打开；v1.11：Ctrl/⌘ / 中键单击直接开成保留标签（§18.8），
  组件在主人开始编辑 / 状态值得留下时调 `SideBodyProps.keep()` 自己转成保留标签（幂等；参考卡片、别的视图范围的持有实例上是空操作；
  现在的文件预览只读，还没有调用方，留给以后的编辑器）；**替换守卫**：普通打开要替换一个预览标签时，若它的组件 `closeConfirm` 对它给出警告，
  不替换——先把它转成保留标签，新的作为它旁边自己的预览标签打开（`lib/sideServices.ts`））、`keepAlive: "unmount" | "hidden"`（缺省卸载；hidden = 最近 `sideKeepHidden` 个（★4）离屏仍挂载；
  v1.9 另可用 `keepMounted` 持有，§18.13）、
  `minHeight`（缺省 120）、`launcher?: { order, pin?, params(), newParams?() }`（标题栏启动栏 / ＋ 菜单 / 启动页里出现；`params()` 返回 null = 现在不能开；
  v1.11 `pin`：`"default"` = 缺省固定在标题栏（主人可取消），`"never"` = 只在 ＋ 菜单，省略 = 主人固定前不在标题栏；v1.11 `newParams`：
  `multi` 组件「新开一个」的参数（Ctrl/⌘ / 中键单击、「新…」），省略 = `params()`）、
  `onClose?` / `closeConfirm?`（返回会结束什么；有警告时卡片 × 和关闭菜单项原地点两次确认，不弹窗）、`peekable`、`toRef` / `fromRef`（§19）。
- 门控照常：模块 `requires`、条目级 `requires` / `agentFeature`；不可用的组件实例**休眠**（保留、不显示、不占图标），模块回来自动恢复。

### 18.3 页按钮、页操作、宽度、与对话的关系

- 页按钮：一页一颗药丸，一张卡片一个图标（≤ 5，否则 4 + 「+n」），每个图标自己的徽标，药丸左端是整页的拖动把手（竖排三个点，悬停显示）；
  最后一颗后面「+」= 新页面（启动页，没放东西就离开会被丢弃）。点别的页 = 打开右栏切过去（点图标 = 同时展开那张卡片）；点当前页
  （`lib/sideLaneClick.ts` 纯函数）：折叠卡片的图标 = 展开它，可见卡片的图标 = 聚焦并闪一下那张卡片，其余 ★不动（设置「点击当前页图标」=
  收起侧栏时收起右栏，主人 2026-10-11；Ctrl+Shift+n 同一规则）。页按钮只在 ≥ 2 页时出现（只有一页时没有，收起靠标题栏开关）。放在哪里
  按设置「右栏布局」（UI 偏好 `sidePageBar`，`lib/sideFrame.ts` 的 `lane` / `strip`）：
  - ★**竖条 + 标签页**（`"lane"`，主人 2026-10-14 要回 2026-10-13 前的双栏样子）：右栏打开时也在对话与右栏之间留一道 44 px 竖向细栏
    （`SideLane.tsx`，列出各页，当前页药丸实心）；没有页标签条，选中页的标签就是各卡片头上的横向标签行（§18.4）。细栏顶部依次是收起侧栏、
    钉住（悬浮时）、⤢ ⛶ ⋯（本页），只在鼠标停在细栏上或按钮有键盘焦点时显示；右栏收起时这些位置留空，药丸开合不跳。这道细栏顶替
    8 px 的缝：打开的右栏比存的宽度宽 36 px（`LANE_EXTRA`），卡片宽度与「仅标签页」相同。全屏 / 最大化 / 悬浮 / 抽屉里细栏都在盒子左边。
    右栏收起时同下。
  - **仅标签页**（`"tabs"`，主人 2026-10-12 方案 A）：
  - 右栏打开：右栏最上面一行横向**页标签条**（`SideTabStrip.tsx`，高 32 px，在第一张卡片之上、右栏外壳内，左右与卡片对齐，不另占宽度）。
    药丸里图标从左到右；页多放不下时这一行横向滚动（滚轮也可，滚动条隐藏），当前页滚进视野。全屏时在全屏标题行（§18.4）下面，
    最大化时在工作区顶部，悬浮 / 抽屉时在浮层里。
  - 右栏收起：设置「右栏收起时」= 保留页按钮时，窗口右边缘一道 44 px 竖向细栏（`SideLane.tsx`，只有药丸和「+」，用来重新打开），
    药丸位置（顶部 / 居中 / 底部）设置只作用于这道细栏；= 全部隐藏时不显示（§18.12）。两种布局都一样。
- 拖放（`lib/sideDnd.ts` 探测 DOM，`lib/sideDrop.ts` 纯函数）：药丸命中带轴（`axis`：标签条 = x，细栏 = y），插入位置按图标沿轴的中点算
  （`pillInsertion`），整页拖到药丸上按沿轴前 / 后 28 % 排序、中间合并（`pillPageOp`）。标签条上插入线竖着画在两个图标之间，整页排序线竖在
  两颗药丸之间，说明标签显示在标签条下方（避开拖动影子）；标签条空白处 / 「+」= 新页（拖动时「+」变成虚线「新页」目标，同前）。
  从标签条拖出的行为与从细栏拖出相同。
- 标题栏右侧 = 启动栏（v1.11，`TitleBarLaunchers.tsx`，规则 `lib/sideLaunchers.ts` 纯函数，主人 2026-10-12）：[固定的启动器…] [＋] [右栏开关]。
  - 启动器 = 一种组件（不是一个实例）。缺省固定：`launcher.pin: "default"` 的组件——侧聊、终端，浏览器模块启用时的浏览器；模块停止 / 不可用 /
    `params()` 为 null 的种类不出现。顺序 = 先工具类（模块贡献的 `side.component`：侧聊、终端、浏览器、笔记、书签…），再状态分类
    （外壳派生的 `status:<id>`，§18.9：闹钟、委托、作业…；不加契约字段，按派生来源分组），各自按 `launcher.order`。固定是**按设备**的本地偏好（UI prefs `sideLauncherPins`：组件 id → 固定 / 取消，
    只存与缺省不同的选择）；＋ 菜单每行末尾有固定开关（`pin: "never"` 没有），右键标题栏启动器 =「新…」（multi）/「从标题栏取消固定」。
  - 点启动器（`launcherClickAction`）：当前页（在看的页；右栏收起时 = 打开会显示的页）有这种组件 → 与点页按钮里它的图标**完全同一条规则**
    （`lib/sideLaneClick.ts`：折叠 → 展开，可见 → 聚焦并闪一下；「点击当前页图标」= 收起侧栏时收起右栏；右栏收起 = 打开在那一页并展开）；
    当前页没有、别的页有当前 agent 看得见的实例 → 显示最近用过的那个（切到它的页 / 打开右栏、聚焦并闪一下；singleton 与 multi 一样，lead 2026-10-12）；
    哪里都没有 → 在当前页打开一张（打开右栏，聚焦）。新实例（如新 PTY）只来自 Ctrl/⌘ + 单击、中键单击（后台：不显示、不聚焦，卡片 / 页按钮闪一下；加 Shift = 显示并聚焦）或 ＋ 的「新…」行（显示；提示「Ctrl+单击」，macOS「⌘+单击」）（只对 `multi`，参数 `newParams()`，落在当前页）。
  - 徽标：这种组件当前 agent 看得见的所有实例的 `useTab` 探针之和（与页按钮同一套：红色计数 / 未读点 / 忙碌），不另轮询；当前页上可见时按钮呈按下状态。
  - ＋ = 启动菜单：全部可打开的组件（固定的在前；未固定的工具类，分隔线，未固定的状态分类；每行带固定开关）、`multi` 的「新…」（如「新终端」）、新页面（Ctrl+Shift+N）、
    本页 ▸（最大化 / 全屏 / 钉住 + 页菜单）。窄窗口：标题区剩不到 240 px 时，放不下的固定启动器收进 ＋（＋ 上一个小点），右栏开关始终显示。
  - 右栏开关：收起时只有一页则带它的徽标。
  - 页操作不在标题栏：页标签条最右端依次是钉住（悬浮时）、⤢ 本页最大化、⛶ 本页全屏、⋯ 页菜单、收起侧栏（`PanelRightClose`，= 标题栏开关 /
    Ctrl+Alt+B），只在鼠标停在这一行上或按钮有键盘焦点时显示（透明度，不挪位置；模式开着时对应按钮常显）；只有一页（没有标签条）时在
    ＋ → 本页，收起靠标题栏开关；收起时的细栏没有页操作。卡片自己的 ⤢ ⛶ ⋯ 在卡片头（§18.4）。Ctrl+Shift+M / Shift+F11 不变。
- 宽度：`appearance.sidePaneWidth`（260–1600，★420）= 右栏（卡片 + 与对话之间 8 px 的缝；2026-10-13 起不再含 44 px 页按钮那一道，
  页标签条在右栏里面；存过的值不迁移，两页以上时卡片因此宽 36 px）。两个把手（`lib/sideResize.ts`）：对话与右栏之间的缝（8 px，卡片和页标签条
  的左边缘贴着它）、每张卡片左边框 5 px 热区；双击还原默认，方向键调整（Shift ×4）。
- 「右栏与对话」（设置，`lib/sideFrame.ts` 纯函数）：**并排**（对话变窄，阅读列重新居中）、★**让位**（阅读列保持原位，`--side-shift` =
  右栏实际占的宽度，右边空白先让出来；收起时留着细栏的话只让出差值）、**悬浮**（盖在对话上；收起时细栏占的 44 px 在行内照留，开合不重排对话；页标签条「钉住」=
  改成让位，再点回到悬浮）。
  阅读列 = `.side-col`（`styles.css`）。
- 窄窗口（工作区 < 360 + 260）：一律是抽屉，盖在对话上，点对话 / Esc 关；或设置成自动收起。

### 18.4 卡片

- 卡片头：类别图标（= 卡片把手，右键 = 卡片菜单）、多于一个实例时是标签行（否则是标题）、组件的 `Actions`、悬停时 ⤢ ⛶ ⋯、
  页上多于一张卡片时折叠 ▾、×。同种组件在一页里只有一张卡片（「拆到新卡片」后才会有第二张；打开时落到最近用过的那张）。
- 高度 = 比例 `share`；卡片间 8 px 缝可拖（双击均分，方向键调整），折叠卡片只剩头部；放不下时最下面的卡片先折叠。
- 最大化（⤢，Ctrl+Shift+M）= 盖住工作区；全屏（⛶，Shift+F11）= 盖住整个窗口，自带 40 px 标题行（拖动区、三平台窗口按钮、还原）。
  对象 = 卡片（卡片上的按钮 / 焦点所在卡片）或当前页（标题栏按钮）；模式中点别的页按钮 = 跟着切页。模式不跨重启。

### 18.5 绑定与可见性

| 绑定 | 可见条件 | 用于 |
|---|---|---|
| `{ kind: "follow", hostId }` | 有选中 agent 且在那台主机（v1.5；打开时 = 布局所属主机）；内容按它重算 | 文件树、改动、状态分类 |
| `{ kind: "agent", hostId, sessionId }` | 选中的是它 | 预览、diff、subagent 线程、侧聊 |
| `{ kind: "workspace", hostId, key }` | 选中 agent 在那台主机、工作区 = key（`lib/workspace.ts` `scopeKey`） | 终端（P1b） |
| `{ kind: "host", hostId }` | 那台主机在当前范围 | 浏览器服务标签、参考卡片 |

页的**形状**（页、卡片、顺序、比例）在一个视图范围内对所有 agent 相同，**内容**按绑定显示：没有可见标签的卡片隐藏；没有当前 agent
可见卡片的页（别的 agent 的内容、只剩休眠实例）**不出现在页按钮里**（主人 2026-10-11，RFC §13 D27′，取代「变暗留在原位」）。
`host` / `workspace` / `follow` 绑定的页对它适用的每个 agent 都出现。这修掉了旧 `sidePane` 的串台。

**每个 agent 一份视图**（D27′）：右栏开 / 关和在看的页按 agent 记住（`layout.views[<cutex session id>] = { open, page, at }`，
没有选中 agent 时键 `∅`），切 agent = 存下旧的、换上新的；最大化 / 全屏也按 agent，只在内存。没有记录的新 agent = 收起；
恢复时它在这里已经没有内容 = 收起（例外：它自己特意打开的空右栏 / 启动页，记成 `page: null`，仍打开）；在当前 agent 上关掉它最后的
内容 = 它的右栏收起；再打开任何东西 = 重新打开。启动页（空页）属于打开它的 agent，切走时丢掉。全窗口 / 普通页面（设置等）不改选中
agent，所以保持上一个 agent 的视图。卡片 ×、关闭页只关当前 agent 看得见的实例（别的 agent 的留着）。

v1.5：每种绑定都带 `hostId`（多主机下每个实例都属于一台主机，「某台主机换代只卸载那台主机的实例」按它判断）。存档里没有 `hostId`
的 `follow`（v1.4 写的）读取时补成布局所属主机（`sanitizeLayout(raw, hostId)`；`layouts["host:<id>"]` 的 id），只往前迁，不保留旧格式。

### 18.6 放置（`lib/sideLayout.ts` `place()`，纯函数）

```ts
interface SidePlacement { home: string; prefer?: SidePageCandidate[]; otherwise?: "new-page" | "active-page"; order?: number; share?: number }
type SidePageCandidate = { group: string } | { containing: ItemId } | "active";
```

顺序：复用（同组件 + 同绑定 + 同 key）→ transient 就地替换 → 选页（调用方 `opts.page` → 用户覆盖 → `prefer` 依次匹配，缺省
`[{ group: home }]` → `otherwise`，缺省新页并带 `home` 页组）→ 选卡片（同种卡片加标签，否则按 `order` 插新卡片）→ 上限（9 页满 = 当前页；
6 张卡片满 = 同组另一页 → 新页 → 超出），**永不拒绝、永不混放**。`reveal` 缺省 true（打开右栏、切页、展开卡片），`focus` 缺省 false；
系统事件不新建页、不 reveal。验收场景 = RFC §4.4 的 13 个（`test/sideLayout.test.ts`）。

页组（不是枚举，新名字先登记在这里）：

| 页组 | 组件 |
|---|---|
| `workspace` | `workspace.files` / `.changes` / `.preview`、`diff.view`、`subagents.thread`、状态分类 `status:<id>`（缺省） |
| `browser` | `browser.tab`（内嵌浏览器标签，`browser` 模块，I2） |
| `chat` | 侧聊（GPT，§19） |
| `reference` | 参考卡片 / 书签（GPT，§19） |
| `artifacts` | `artifacts.library`（成果库）、`artifacts.view`（成果预览，v1.7）；对比打开的 `diff.view` 落在同一页 |
| `delegations` | `delegations.detail`（一个委托的详情，`ref.target` 种类 `delegation` 打开它，2026-10-13） |

### 18.7 覆盖、菜单与重置

- 菜单（`lib/sideMenus.tsx`）：标签 = 保持打开 / 移到页 ▸ / 移到新页面 / 拆到新卡片 / 恢复默认位置 / 关闭其他 / 关闭；
  卡片 = 移到新页面 / 移到页 ▸ / 上移 / 下移 / 折叠 / 最大化 / 全屏 / 关闭卡片；页 = 新页面… / 合并到 ▸ / 重命名… / 上移 / 下移 / 关闭页 / 重置右栏布局。
  标签菜单另有可引用组件的 `ref.action`（§19.8）；关闭项带组件的关闭警告（`closeConfirm`，如「关闭 · 终端 1 将被结束」）。
- 拖放（RFC §3.7 的表；`lib/sideDrop.ts` 纯函数 `resolveDrop` / `applyDrop`，`lib/sideDnd.ts` 指针事件与探测，无新依赖）：
  手柄 = 卡片类别图标或药丸里它的图标（整张卡片）、药丸左缘握把条（页）、标签或单实例卡片的标题（一个实例），
  以及右侧区以外的手柄 `externalDragHandle(spec)`（现在只有参考卡片的图标 / 标题，§19.4；`spec.isOrigin` = 它自己的位置，放开不做事）。
  「新页」落点 = 左缘条带（药丸道空处 + 列左缘 24 px）与右侧区以外（对话卡片 / 窗口背景；输入框与原位置不做事）。
  拖动中：盖层挡住整个窗口、实例层不接指针事件、Esc 取消且只做这一件事（§19.10）。
- 移动记成该**组件种类**的覆盖（目标页 + 它的页组，≤ 100 条）：下次打开同种组件先回那里（页没了 → 带这些组的页 → 新页）。
- 「恢复默认位置」= 忘掉覆盖并按规则重放这个实例；设置里的「组件默认位置」表按种类恢复（`restoreKindDefault`）；
  「重置右栏布局」= 清覆盖、名字、顺序、比例、折叠，按 `lastActiveAt` 重放全部实例，确定性，不关闭任何东西。

### 18.8 打开服务与内置组件

- `services.side.open(kind, params?, opts?)` → `{ status: "opened", id, page, existing } | { status: "unavailable", reason }`
  （`unknown-kind` / `module-off` / `capability` / `agent-feature` / `bad-params` / `no-agent` / `host-offline` / `stale`）；
  `opts = { page?, binding?, focus?, reveal?, pin?, background? }`（v1.11 `background`：后台打开——卡片继续显示原来的标签，不 reveal、不聚焦，
  卡片 / 页按钮闪一下；压过 `reveal` / `focus`）。`reveal(target)` 切到实例（闪一下卡片 / 页按钮，`revealed` +1）；`close(id)`、`list(kind)`；
  v1.10：`openHeld(kind, params, opts?)` / `releaseHold(locator, opts?)`（后台打开并持有，§18.14）。
  核心入口（`lib/sideOpen.ts`）打不开时一行通知说明原因，从不静默。
- P0 的组件：`workspace.files`（树 + 搜索）、`workspace.changes`（git 状态）、`workspace.preview`（transient，multi，agent 绑定）、
  `diff.view`（文件 diff / 回合 diff，multi，agent 绑定）、`subagents.thread`（只读子线程，multi，agent 绑定）。
- v1.7：`diff.view` 的第三种来源 `text`（`{ source: "text", key, title, diff }`）：调用方自己算好的统一 diff（成果两个版本的对比），
  只在内存里（同回合 diff 的 `turnTexts`），重启后不恢复；成果模块的 `artifacts.view` 用 `open("diff.view", …)` 打开在同一页。
- v1.7：`artifacts.library`（成果库，singleton，`workspace` 绑定）与 `artifacts.view`（成果预览，multi，transient，peekable，`host` 绑定，
  dedupeKey = 成果引用，固定版本和 `@latest` 是两个标签身份），页组 `artifacts`。

- 「新开而不替换」全应用统一按浏览器习惯（v1.11，主人 2026-10-12，`lib/openModifiers.ts`）：**Ctrl/⌘ + 单击、中键单击** = 新开一个保留的（非预览）标签，
  后台打开（`{ pin: true, background: true }`，当前标签留在视野里）；**Ctrl/⌘ + Shift + 单击** = 同样新开，但显示并聚焦；普通单击不变（复用 / 替换预览标签）。
  适用：Markdown 文件链接与图片、文件树（含搜索结果；聚焦的行上 Ctrl/⌘ + Enter = Ctrl/⌘ + 单击）、改动列表的 ↗、回合摘要的文件、工具行的文件、标题栏启动器（§18.3）。
  菜单项没有修饰键，照普通单击。例：a.md 开着，Ctrl+单击 b.md → b.md 成为第二个保留标签，a.md 留着且仍显示。

### 18.9 状态分类进右侧

每个 `conversation.status` 条目自动派生一个组件 `status:<条目 id>`（singleton、follow，`lib/sideComponents.tsx`）：Body = 条目的 `Body`，
Actions = `Meta`，图标 = `StatusItem.icon`；`StatusItem.side` 可改放置或写 `false` 不进右侧。不为同一内容另写组件。

### 18.10 实例层

实例不渲染在卡片里：卡片只放占位（`lib/sideSlots.ts` 登记），`components/side/SideInstanceLayer.tsx` 在 App 根部按占位的位置画固定定位的盒子
（z 39：在抽屉 / 悬浮 / 最大化 / 全屏之上，菜单之下）。移动、合并、最大化、全屏只换占位，实例不重挂载；模式期间本页其他卡片的实例隐藏保留到模式结束。
盒子按（范围，id）排序渲染（不移动 DOM，iframe 不重载）。重新测量：占位 / 工作区 ResizeObserver、窗口 resize、每次布局变更后；没有持续轮询。
挂载集合 = 在屏幕上的 + 模式期间保留的 + 最近 `sideKeepHidden` 个可保持（`keepAlive: "hidden"` 且绑定可见）的离屏实例 + 被持有的实例（§18.13）；
纯函数 `lib/sideKeep.ts` `mountPlan`。

### 18.11 状态范围与持久化

localStorage `cutex-desktop.side` = `{ v: 1, layouts: { "host:<id>": SideLayout } }`（按设备；多主机落地后键可为 `group:<id>` / `all`）。
换主机 = 换一份布局。限额：每实例 state ≤ 4 KiB（超出只在内存）、每范围 ≤ 200 个实例（丢最旧的不可见实例）、覆盖 ≤ 100 条、
每 agent 视图（`views`，§18.5）≤ 100 条（丢最久没用的）。侧栏快照加载后丢掉绑定到已删除 agent 的实例和它们的视图。启动时恢复（设置可关）：`restore` 返回 null 的丢掉；回合 diff 不恢复；模式不恢复。

### 18.12 设置与键盘

设置 → 侧栏与顶栏 → **会话两侧**（anchor `sides`，`components/settings/SidesSettings.tsx`）：右栏宽度、右栏与对话（并排 / ★让位 / 悬浮）、
右栏布局（`sidePageBar`，★竖条 + 标签页 / 仅标签页，§18.3）、
竖条里页按钮位置（`sidePillAnchor`，★顶部 / 居中 / 底部；只作用于竖向细栏）、
右栏收起时（`sideLaneWhenHidden`，★保留页按钮 = 窗口右边缘留一道竖向细栏 / 全部隐藏）、点击当前页图标（`sideCurrentPageClick`，★不收起 / 收起侧栏）、窄窗口时（★覆盖 / 自动收起）、
打开文件（`sidePreview`，★替换预览（lead 2026-10-12 由「对话里开新标签」改回；存过旧缺省「对话里开新标签」的一次性迁到替换（`sidePreviewRev` = 1，同 `reasoningViewRev`），别的选择保留，之后再选「对话里开新标签」也保留）/ 对话里开新标签 / 每次新标签；Ctrl/⌘ / 中键单击保留，§18.8）、启动时恢复（★开）、离屏保持加载的标签（`sideKeepHidden`，★4，1–12）、持续保持加载的标签上限
（`sideKeepMounted`，★4，1–8；v1.9，§18.13）、重置右栏布局、组件默认位置表；参考卡片位置与留白常驻两行见 §19.11。

键盘（`lib/useSideShortcuts.ts`，列在 `lib/shortcuts.ts`）：Ctrl+Alt+B 右栏（空时打开文件 + 改动）、Ctrl+Shift+1…9 第 n 页（当前页再按 = 同点击当前页图标）、Ctrl+Shift+N 新页面、
Ctrl+Shift+M 最大化、Shift+F11 全屏、F6 / Shift+F6 焦点轮转（侧栏 → 对话 → 页按钮（标签条或细栏）→ 卡片）、Esc 还原模式 / 关窄窗口抽屉。
Esc 守卫：焦点在右侧（`[data-side-root]`）或右侧有层（模式、窄窗口抽屉）时，对话的 Esc 不打断回合（`lib/escInterrupt.ts`）；
P1a 起整条 Esc 链见 §19.10。

### 18.13 保持挂载（v1.9）

依据：内嵌浏览器 relay 决定（`docs/research/browser-inapp-i1-revision-reply-20261011.md` §2.3、`browser-relay-contract.md` §6）。
外壳文件 `lib/sideKeep.ts`（规则 + 小 store），接线在 `components/side/SideInstanceLayer.tsx`、`lib/sideBody.ts`；外壳不点名功能。

```ts
// modules/slots.ts — SideBodyProps（Body 与 Actions 都有）
keepMounted(hold: boolean): boolean; // true = 持有，false = 放开；返回调用后是否处于持有状态
held: boolean;                        // 现在是否被持有（响应式）
```

- **谁能用：** 只有 `keepAlive: "hidden"` 的组件。别的组件、参考卡片（`where: "peek"`）调用 `keepMounted(true)` 一律返回 false。
- **持有期间：**
  - 不参与离屏 LRU（`sideKeepHidden`），也不占它的名额；
  - 绑定不可见（D27′ 切到别的 agent、右栏收起）时仍挂载（隐藏，`visible: false`）；
  - 视图范围切到别的主机（换了一份布局）时仍挂载（隐藏）。外壳持有实例的快照来渲染它：这期间 `setState` 写在快照上，回到那个范围时写回布局；
    `close()` 只放开持有（实例留在它的布局里，随后卸载）；`visible` / `active` 恒为 false，`mode` = `normal`，`revealed` = 0。
  - 不切换视图范围、不恢复或聚焦窗口：要给主人看，组件自己用 `services.side.reveal`（只在当前范围内有效）。
- **持有结束（实例随后按普通规则卸载或留在屏幕上）：** 组件 `keepMounted(false)`；主人关闭标签（实例从它自己范围的布局里消失）；
  模块停止 / 组件不再是 `keepAlive: "hidden"`；绑定的主机被移除；绑定的主机以**新的** epoch 重连（换代）。只是断开（epoch 为空）不结束持有。
  应用退出时全部丢掉；持有只在内存，不跨重启、不进 `cutex-desktop.side`。
- **上限：** 每个窗口同时最多 `sideKeepMounted` 个（★4，1–8），与 `sideKeepHidden` 分开计。满额时 `keepMounted(true)` 返回 false，
  组件据此拒绝新的需求（浏览器：拒绝新的授予，提示主人先释放一个）。放开一个后可以再要。降低设置不赶走已有的持有，只影响之后的请求。
- **键：** 持有按（视图范围，实例 id）记。实例 id 只在一个范围的布局里唯一；两个范围里可能有同一个 id。需要跨范围唯一身份的组件
  自己在 `state` 里放一个随机键，不要只用 `(hostId, instance.id)`。
- **组件的责任：** 持有的理由消失（租约释放、主人停止、主机换代被 main 撤销）时立刻 `keepMounted(false)`；卸载时不必调用（外壳在实例
  消失时自己清掉）。`held` 由 true 变 false 而组件还认为在持有时，按「被外壳撤销」处理。
- **不做：** 浮层守卫（H3 结论：现有外壳浮层不与右栏 guest 相交，§I2a 最终通过记录）；将来加全局 z50 浮层时再议。
- **测试：** `test/sideKeep.test.ts`（持有规则、上限、撤销条件、LRU 计划）；`test/moduleSdkContract.test.ts`（类型正反例）；
  `test/modules.test.ts`（调用 `keepMounted(` 的模块必须有 `keepAlive: "hidden"` 组件；外壳不点名功能）。
- 尚未渲染的新卡片（后台打开）没有 Body，无法自己要第一个持有：用 v1.10 `openHeld`（§18.14）。

### 18.14 后台打开并持有（v1.10）

依据：内嵌浏览器 I3 硬停交回（`browser-inapp-i3-hard-stop-20261011.md` §1–§2）：未选中的 agent 调 `browser_open` 时，新卡片要在后台
建出来并真正挂载 guest；v1.9 的 `keepMounted` 只能在 Body 渲染后调用，而 `mountPlan` = 屏上 ∪ LRU ∪ 模式保留 ∪ 持有，后台新卡片哪个都不在。
外壳文件：`lib/sideServices.ts`（`sideOpenHeld` / `sideReleaseHold`）、`lib/sideKeep.ts`（纯规则 `admitHold` / `holdScopeCheck` / `releaseTicket`，
持有的 `ticket`）、`lib/sideLayoutStore.ts`（`closeInstancesIn`）。实例层不用改：持有的实例本来就在挂载集合里。

```ts
// modules/slots.ts — ModuleServices.side
openHeld(kind: ItemId, params: Json | undefined, opts?: SideOpenHeldOptions): SideOpenHeldResult;
releaseHold(hold: SideHoldLocator, opts?: { discard?: boolean }): boolean;

interface SideOpenHeldOptions { page?: string; binding?: SideBinding; hostEpoch?: string }
type SideOpenHeldResult =
  | { status: "opened"; instanceId: string; pageId: string | null; reused: boolean; hold: SideHoldLocator }
  | { status: "unavailable"; reason: SideOpenHeldRefusal }
  | { status: "stale" };
type SideOpenHeldRefusal = /* open() 的原因 */ "unknown-kind" | "module-off" | "capability" | "agent-feature" | "bad-params" | "no-agent" | "host-offline"
  | "not-holdable" | "hold-limit" | "scope-invalid" | "scope-unsupported";
interface SideHoldLocator { readonly scope: string; readonly instanceId: string; readonly token: string } // 不透明
```

- **为什么是单独的方法而不是 `open(…, { hold: true })`：** 后台打开的语义是固定的（不显示、不聚焦），选项里就不该有 `reveal` / `focus` /
  `target` / `pin`；拒绝原因也比 `open()` 多，放进 `open()` 的结果会让所有现有调用方的穷举映射（`refs.open` 等）跟着改。
- **谁能用：** 只有启用的、`keepAlive: "hidden"` 的组件（否则 `not-holdable`）；永远是右侧卡片，从不是参考卡片（peek）、不最大化 / 全屏。
  名额就是 `sideKeepMounted`，与 `keepMounted(true)` 共用同一个计数，没有单独配额。
- **原子性：** 所有检查都在改布局之前：组件不存在 / 模块停止（`module-off` / `capability` / `unknown-kind`）、参数（`bad-params`）、绑定
  （`no-agent` / `agent-feature`）、范围（下一条）、主机未连接（`host-offline`）、`init` 抛错（`bad-params`）、名额（`hold-limit`）。
  任何拒绝都不留卡片、不留持有、不动布局（同一个对象）。调用方模块已停止时，`openHeld` 照常被 guard 拒绝（抛 `AbortError`，没有副作用）。
  成功时建卡片与持有在同一个同步调用里完成，Body 第一次渲染就拿到 `held: true`，实例层立即把它算进挂载集合（右栏收起也一样）。
- **不改视图：** 永远 `reveal: false`、`focus: false`：不打开右栏、不切页、不闪、不动 `revealed`、不改最大化 / 全屏、不切视图范围、
  不切主机、不改选中 agent、不恢复或聚焦系统窗口。放置照 `place()` 规则（可能新建一页，但这页只在它绑定可见的 agent 视图里出现，§18.5）；
  预览类（transient）组件以 pinned 打开，从不就地替换别的标签。
- **范围规则（选定）：** 卡片建在**当前载入的视图范围**（焦点主机的布局 `host:<active>`）里，用调用方给的绑定（缺省 = 组件的 `defaultBinding`
  按选中 agent 填）。一份布局本来就装着所有 agent 的实例、按绑定显示（D27′ 每 agent 一份视图），所以「绑定到未选中的 agent / 主机、
  但不选中它」在当前范围里就成立，不需要写未载入的布局。具体：
  - 绑定的主机未知（不是 `local`、不在主机列表）→ `scope-invalid`；
  - 绑定的主机不在当前视图范围（`scopeHosts` ∪ 焦点主机）→ `scope-unsupported`（它的卡片属于另一份布局；**不隐式切范围**，
    也不写未载入的布局）；
  - `agent` 绑定的 agent 不在那台主机的侧栏（已删除 / 不存在；侧栏未载入时不判断）→ `scope-invalid`；
  - 主机未连接（epoch 为空）→ `host-offline`；给了 `hostEpoch` 而当前 epoch 不同 → `stale`；视图范围在调用期间变了 → `stale`。
  选这条而不是「写进目标 agent 所在的范围」：别的范围的布局不在内存里，在那里建卡片要读写 localStorage、绕过放置 / 视图规则，
  且持有的快照机制只用于「已在布局里、范围切走」的实例；而多主机下其他主机的 agent 本来就在焦点主机的布局里就地打开（§18.5）。
- **持有之后：** 与 §18.13 完全相同：Body 用 `keepMounted(false)` 放开、看 `held` 变化；主人关闭标签、模块停止、主机移除、主机以新 epoch
  重连都由外壳撤销（`held` → false）；范围切走时照样隐藏挂载；持有按（范围，实例 id）记，两个范围里相同的实例 id 是两个持有。
  Body 对已被预持有的实例调 `keepMounted(true)` 是幂等的（还是同一个持有）。
- **复用：** 同绑定同 dedupe key 的实例已存在 → 复用（`reused: true`，用新参数再 `init` 一次）并持有；它若已被持有（Body 自己的或别的
  `openHeld` 的），持有不变，返回的定位器 token 为空，什么都放不开。
- **调用方释放（超时 / 取消 / relay 换代）：** `releaseHold(locator)` 只在这个持有**仍是这次 `openHeld` 拿的那个**时放开（范围、id、token
  都对上），返回 true；Body 已经放开过（哪怕又自己重新持有）、外壳已撤销、或别的实例的持有，一律不动，返回 false。可重复调用。
  `{ discard: true }`：同时关闭这张卡片——只在它是这次 `openHeld` **新建**的时候（复用的卡片从不关闭）；不调组件的 `onClose`（调用方就是
  组件自己，自己负责收尾）。卡片所在范围已不是当前范围时，关闭记在内存里，那个范围下次载入时执行（应用退出前没再载入就随重启丢掉；
  所以组件的 `restore` 应丢掉从未确认的标签，比如 state 里的「pending」标记）。Body 从未渲染也没关系：持有和卡片都由外壳收掉，不泄漏。
  `releaseHold` 不经过 guard（调用方模块停止后也能用）：它只会减少生命周期，不授予任何东西。
- **定位器不是授权：** 它只能放开它自己那次的预持有、关闭那次新建的卡片；不能持有、显示、读取或操作任何实例。token 是外壳生成的随机值，
  伪造 / 改 scope / 改 id 都对不上。
- **浏览器的映射（I3）：** `hold-limit` → `lease_limit`；`module-off` / `capability` → 模块停止；`scope-invalid` / `scope-unsupported` /
  `host-offline` / `stale` → 目标失效（不重试、不切范围）；pending open 超时 / 取消 / relay 换代 → `releaseHold(locator, { discard: true })`。
- **测试：** `test/sideOpenHeld.test.ts`（右栏收起时后台新卡片在 `mountPlan.mounted`；满额原子拒绝且布局不变；不 reveal / focus / 选中；
  两个范围相同 id 不共享持有；超时 / 模块停止 / 主机换代的清理；伪造定位器无效）；`test/moduleSdkContract.test.ts`（类型正反例）；
  `test/modules.test.ts`（调用 `openHeld(` 的模块必须有 `keepAlive: "hidden"` 组件）。

## 19. 会话两侧与引用（v1.4，宿主 P1a）

规范来源：RFC §7（设计理由、例子）与 §10.2（P1a 范围）；本节是约定的摘要，改格式先改本节。P1a 实现：`feat/side-p1a`。
类型在 v1.4 已声明（`modules/slots.ts`），P1a 只落地宿主，契约类型未变（§14）。cutex 还没有 C-T1 单轮读 / C-T2 轮序号（RFC §7.13），
下面凡是「回落」都是没有它们时的做法。

### 19.1 结构与外壳文件

| 部分 | 代码 | 是什么 |
|---|---|---|
| 留白宿主 | `components/gutter/GutterHost.tsx` | 盖在对话卡片上的一层（只有画出来的东西接收指针）：量卡片、算几何、每侧画按钮 / 弹出 / 常驻列表，左侧画参考卡片 |
| 几何 | `lib/gutterLayout.ts`（纯） | 卡片宽、阅读宽、右侧区的让位 / 覆盖、胶囊角 → 列的位置、两侧留白宽度、按钮放哪 |
| 输入框里的按钮 | `components/gutter/ComposerTriggers.tsx` | 留白太窄时同一批按钮进输入框工具行（左侧条目在最左、右侧条目在最右） |
| 参考卡片 | `components/gutter/PeekCard.tsx`、`lib/peekStore.ts`、`lib/peekBody.ts`、`lib/peekTarget.ts`（纯） | 一次一张、只在内存、非模态 |
| 单轮组件 | `modules/conversation/TurnPeek.tsx`、`turnPeekItem.ts`、`turnPeekData.ts`；取轮 `lib/turnFetch.ts`（纯）+ `lib/turnRefs.ts` | 核心组件 `conversation.turnPeek` |
| 轮上内容 | `modules/TurnAttachments.tsx`、`lib/marginLayout.ts`、`lib/marginStack.ts`（纯） | `timeline.turnAttachment` 出口（内联 / 页边） |
| 引用 | `lib/refs.ts`（解析、内置构造、种类归属）、`lib/refServices.ts`（`services.refs` / `.timeline`） | 一个入口打开所有保存的指针 |
| 引用动作 | `lib/refActions.tsx`、`components/RefActions.tsx`、`components/RefActionLabel.tsx` | `ref.action` 的菜单行与悬停栏「⋯」 |
| 跳过去 / 回到 | `lib/jump.ts`、`lib/returnPoint.ts`（纯）、`components/gutter/ReturnChip.tsx` | `services.timeline.focusTurn` |
| Esc 链 | `lib/escChain.ts`（纯）、`lib/escLayers.ts` | 一次 Esc 只做一件事 |

外壳文件不点名功能：`components/gutter/*` 与上表 `lib/` 文件都在 `test/modules.test.ts` 的扫描列表里。锚点用 data 属性：
阅读列 `[data-timeline-root]`，按钮高度对齐 `[data-gutter-anchor="composer" | "dock" | "banner"]`（输入框 / 互动卡片 / 归档横幅），
留白里的一切 `[data-gutter-root]`（Esc 链与焦点轮转把它当作「在侧边」）。

### 19.2 留白几何与按钮

- 几何与 `.side-col` 的 CSS 同式：`columnLeft = max(0, min((C + shift − R) / 2, C − R))`（C = 卡片内容宽，R = 阅读宽度，shift = 让位的
  `--side-shift`）；右侧留白再减去悬浮 / 抽屉盖住的部分（`sideCover`）。所以「并排 / 让位 / 悬浮」不需要模式输入：`SideArea` 发布
  `shift` 与 `cover`（`publishSideFrame`），宿主自己量卡片。阅读宽度 = 全宽时没有留白。
- 列自己的左右内边距（24 px）也算空白：按钮与弹出层可以用它。留白 G + 24 ≥ 44 → 按钮在留白里，否则**进输入框工具行**（同一个
  `Trigger`，`where: "composer"`）。
- 按钮在输入框的高度（锚点见 §19.1），按 `order` 向上叠；胶囊（或别的 `conversation.overlay`）在某一侧的窗口角时，那一侧顶部 / 底部
  让出 48 px 带（`OverlayLayout.side` + `anchor`：胶囊现在报告左右，`lib/overlayLayout.ts` `edgeOverlay`）。
- 此外宿主**量胶囊实际画出来的框**（`ConversationOverlays` 外包 `[data-overlay-root]`，`display: contents`；框 = 其中最外层接收指针的元素，
  覆盖物普遍是「指针穿透的满幅框 + 可点的盒子」；ResizeObserver + MutationObserver 按帧合并，`GutterBox.overlays`）。顶部入口、常驻列表、
  参考卡片与框相交时让开（`lib/gutterLayout.ts`：`placeBelow` 移到框下方；`freeSpan` 框靠上推顶、靠下收底；参考卡片 `peekPlacement` 在
  「框下方全宽」与「框左侧收窄（≥ 240）」里取面积大的）。任何宽度、胶囊收起 / 展开、任何内容（含闹钟）都适用，不点名条目；层的 z 序不变。
- 右侧区最大化 / 全屏（对话被盖住）时整层隐藏；页面、设置、没有选中 agent 时不画（`gutterStore.geometry = null`）。

### 19.3 留白条目与回合附件

`conversation.gutter`（`GutterItem`，按 agent 的 `agentFeature` 过滤，`lib/gutterItems.ts`）：

- **按会话主机门控**（2026-10-11，宿主行为，契约不变）：模块在视图范围内任一主机满足 `requires` 即激活（§4 v1.5），但留白条目、回合附件、`ref.action`（按 ref 的 `hostId`）与右侧启动器（按所选 agent 的主机）的调用都落在**那一台**主机上，所以宿主再按该主机的能力过滤（模块 ∪ 条目 `requires.capabilities`，能力未加载时也先不显示；`lib/hostGating.ts` / `hostGatingView.ts`）。旧 cutex 没有对应路由时（`route_not_found`），批注 / 侧聊把错误显示成「需要更新 cutex」的提示，不显示原始错误码。

- **v1.8 顶部入口**：可选 `anchor: "top" | "composer"`（默认 `composer`，保持旧行为）。`top` 由容器固定在会话卡片对应侧的顶部、避开状态胶囊；全宽或窄窗口时仍保留，不移入输入框、不挤压对话。其列表向下弹出，限制在视口内；常驻列表让出顶部按钮区域。模块只声明位置，不自行实现布局。
- 批注、书签声明 `anchor: "top"`，移除主侧栏底部全局入口；各自左侧列表内部提供“查看全部”。书签首页只含本会话收藏，以及用户明确勾选项目的收藏，自动推导出的项目不是首页跨会话可见权限。内容书签默认 `refs.open(..., { how: "peek" })`，工具引用仍由容器聚焦原组件；右侧打开为显式菜单操作。
- **按钮 → 弹出**：点按钮在它上方弹出 `Body`（卡片外观，宽 `clamp(G + 24 − 16, 240, 360)`，窄留白时可以盖住一部分阅读列）；
  一次一个；点外面 / Esc（Esc 链第 1 行，`useTrackOverlay`）/ `Body` 调 `close()` 关闭，焦点回到按钮。
- **常驻**（★关，§13）：条目写了 `dockMinWidth`、留白 ≥ 它、且设置里打开（UI 偏好 `gutterDocked: string[]`，条目 id 列表）时，
  `Body` 直接常驻在留白里（`docked: true`），按钮变成「暂时收起 / 展开」（收起只在内存，重启恢复）。留白变窄 → 自动回到弹出。
  常驻列表宽度是本机 UI 偏好 `gutterDockWidth`（200–480，★260，`lib/gutterDock.ts`），在列表内侧边缘拖动 / 双击复位 / 聚焦后方向键调整，设置 → 两侧也可改；不超过留白宽度（2026-10-11 前常驻列表占满整个留白）。
- 没有 `Body` 也没有 `Trigger` 的条目不画。条目崩溃只影响自己（`ItemBoundary`）。
- **`GutterBodyProps.close()`**：把这份列表收起来，含义随 `docked` 而定。弹出（`docked: false`）= 关闭弹层，等同点外面 / Esc，焦点回到按钮。
  常驻（`docked: true`）= **收起**该条目的常驻列表，与点按钮「暂时收起」是同一个动作：`Body` 卸载（自己的状态丢失），按钮留着、再点即展开；
  收起记在内存的 `gutterStore.folded`（条目 id 列表，不分 agent / 主机、不持久、重启恢复），不改 `gutterDocked` 设置，焦点不动；常驻列表没有 Esc。
  什么时候调：主人明确要收（`Body` 自己的关闭按钮），或弹出里的一次选择已经用完弹层（先打开别处，再 `close()`）。常驻列表里的普通选择 / 动作**不要**调
  （写成 `if (!docked) close()`，`dev/devGutter.tsx`）：常驻就是要留着，收起会让它在主人指针下消失；也不要在渲染或 effect 里调。
  （纯文档补充，契约版本不变。）

`timeline.turnAttachment`（`TurnAttachmentItem`）：

- 页边盒子挂在每一轮的**第一行**（`Timeline.tsx` 的轮锚点），内联条目在这一轮**末尾**（见下）；只读时间线（子线程、参考卡片里的单轮）不挂。
- **页边**：条目写了 `margin: { side, minWidth }` 且那一侧留白 ≥ minWidth → 放在那一侧留白，与这一轮第一行对齐、随内容滚动
  （零高度锚点里的绝对定位盒子，宽 `min(G + 24 − 16, 320)`）；相邻两个会重叠时后一个往下推（文档批注式，`marginStack`，间距 8 px），
  由 ResizeObserver 驱动、按帧合并。
- 否则**内联**：在这一轮末尾——已结束的轮在最后一条回复里、轮尾摘要（「改了 N 个文件」行）之后、操作栏之前；
  没有这样的回复（进行中、无回复）就在这一轮最后一行之后；宽 = 阅读列宽 − 48。`TurnAttachmentProps.where` / `width` 告诉条目是哪种。
  （2026-10-15 起，原为「第一行下面」；宿主行为，契约版本不变。）
- 批注（`notes.turn`）不写 `margin`：只在轮尾内联，样式同轮尾摘要（「批注 · [标题] · [标题] · +N」，点开浮窗）；
  宽屏时不再飘到右侧留白（主人 2026-10-15）。`margin` 仍由书签（`bookmarks.ribbon`，左）、浏览器截图（`browser.turnShots`，右）与 `dev/devGutter.tsx` 使用。
- 只放内容；对这一轮的动作走 `ref.action`（§19.8）。

`timeline.intro`（v1.13，`TimelineIntroItem`，出口 `modules/TimelineIntro.tsx`）：

- **何时显示**：只在会话开头真的在屏幕上——`hiddenTurns === 0` 且没有更早一页的游标
  （`!older?.cursor`；`TimelineBody` 已有这两个值），且会话视图不在加载中、没有加载失败（`SessionView.loading` /
  `error`；首屏加载时时间线为空、`older` 还是 null，不挂就不会「先出现后消失」闪一下）；「显示更早」按钮或
  「更早的历史」行出现时（更早内容还没进来）不显示。0 个回合的新会话也显示。只读时间线（子 agent 视图、
  参考卡片的单轮）不挂，同回合附件。出口用 `memo` 且 props 全是原始值、store 选择器只取原始值：`TimelineBody`
  随流事件重渲染时开场不重渲染（时段与抽样在挂载时定死，流式中途不换句）。
- **每个会话最多一项**：按 `order` 升序取第一个 `mode: "show"` 且 `when(props)` 不为 `false` 的条目；`when` 与
  render 工厂的调用都在出口的守卫 / `ItemBoundary`（按实际选中条目的 `moduleId` 归因）里，抛错只影响这一块
  （标准模块出错 / 重试行）。条目以 `${hostId}\0${sessionId}` 为 key：同一主机内切换会话必然重挂载（坏图状态、
  抽样与 profile 解析不跨会话残留）。
- **props 只读**：`{ sessionId, hostId, profileName, providerKind, agentName }`——会话 id、所在主机、所用 profile（名字）、
  宿主已知的 provider 类别（`null` = 未知，条目自行解析）、会话显示名。不给 store 写权限、不给 daemon 通道
  （条目要用 daemon 数据自己取，如模块 `intro` 用 `listProfiles` 解析 provider）。
- **总开关**：设置 → 对话 → 显示（「显示会话开场」，UI 偏好 `timelineIntro`，★开）关掉时整个插槽不渲染（出口不挂任何条目）。
- 模块 `intro` 是第一个贡献者（条目 `intro.opening`）：立绘按「profile 自定义立绘（本机存储，随 Profile → 外观 编辑，
  按主机 + profile **id** 键、经 profile 列表由会话的 profile 名解析，同 profile 头像的存法；源文件 ≤ 2 MB、最长边 1024 px、
  编码后单张 ≤ 约 1 MB（质量自动降级，仍超按「太大」报错不静默丢弃）、全部立绘合计约 ≤ 3 MB（超出拒存，编辑器报失败）；
  profile 解析完成或失败之前不渲染——不先闪一版通用开场白）→ provider 默认立绘（`lib/launchArt`，检出里没有这些图就没有这一档）→
  无」回退，都没有时只显示开场白，不留空框；开场白按「profile 自定义 → provider 问候语（`lib/providerGreetings`，按语言 / 时段）」，
  占位符 `{{owner}}`（外观设置里的主人称呼）/ `{{name}}`（会话显示名；provider 问候语池的单花括号 `{name}` / `{称呼}` 沿用
  启动页语义 = 主人称呼）。样式照启动页立绘的观感，不压缩阅读列宽；窄窗口时立绘缩小、过窄只显示开场白。

### 19.4 参考卡片与 `conversation.turnPeek`

- **参考卡片**（`PeekHost`）：一个 `peekable` 组件实例，放在左侧留白（宽 `min(G + 24 − 16, 560)`），布局之外（不进页 / 卡片 / 页按钮）。
  外观同右侧卡片：类别图标 | 标题（属于别的 agent 时写「属于 X」）| ⤢ ⛶ ×；`Body` 拿 `SideBodyProps`，`where: "peek"`（只读使用）；
  底部是组件的 `Actions` 与「在右侧打开」。
- 一次一张：下一次打开替换它；同一个引用再开 = 闪一下（不重开）；只在内存，重启没有。不是对话框（`role="complementary"`），
  不抢焦点（`focus` 选项除外），关闭时焦点回到打开前的位置。关闭：×、Esc（链第 3 行）、跳过去、在右侧打开、换主机；**换 agent 不关**。
- 「在右侧打开」= 按组件的放置钉进右侧、带上卡片的 state，卡片关闭；⤢ / ⛶ = 同样钉进右侧后最大化 / 全屏那张卡片。
  图标 / 标题是拖动手柄（§18.7）：拖到药丸或列 = 钉进那页，拖到「新页」落点 = 钉进新页（已有 9 页时按放置规则）；
  同一个引用已钉着 = 找回那个实例；不记覆盖。卡片自己与整片左留白（含列的内边距）= 原位置，不做事。拖动中卡片内容变淡，卡片本身不透明。
- `services.side.open(kind, params, { target: "peek" })`：组件 `peekable` 时按 §19.5 决定去哪；不是 peekable 或放不下 = 右侧（`place()`），
  结果 `where: "peek" | "card"`。`services.side.closePeek()` 关掉它。
- 核心组件 **`conversation.turnPeek`**（RFC 里的 `turn.peek`；条目 id 必须带模块前缀，见 §19.12）：模块 `conversation`，不受门控，
  `peekable`、multi + transient（同一位置的下一个预览替换它）、host 绑定。Body = 只读 `TimelineBody`，**只有这一轮**；打开它从不选中那个 agent、从不移动主时间线、不显示更新的轮。
  底部「跳过去」（§19.7）。标题「名字 · #n · 时间」（#n 只在知道序号时）。也能作为右侧卡片（在右侧打开 / `how: "page"`）。
- 取轮顺序（`lib/turnFetch.ts`）：那个 agent 已载入的时间线（**活的**，运行中的轮会继续更新）→ 参考缓存 →（C-T1 单轮读，cutex 还没有）→
  从已载入时间线的游标往前按页读，**≤ 5 页 × 200 轮**（★，§13）。读到的页只进参考缓存（每 agent 最近 3 页、10 分钟过期、换主机清空），
  **不进主时间线**；之后的跳过去复用它们。
- 找不到时卡片显示保存的快照（纯文本 `snapshot.snippet`）+ 原因 + 重试，「跳过去」变灰：
  `reverted`（整段历史都已读过仍没有，或那个 agent 的线程已换 = 回落推断，C-T1 才能确定）/ `too-old`（5 页内没找到）/
  `unknown`（没有保存的历史）/ 主机离线 / 读取错误。

### 19.5 参考卡片放哪（`peekTarget`，纯函数）

设置「参考卡片打开位置」（UI 偏好 `peekTarget`）：★**自动** / 总在右侧 / 总在左侧。

| 条件 | 自动 | 总在右侧 | 总在左侧 |
|---|---|---|---|
| 对话被盖住（右侧最大化 / 全屏、不在对话页） | 右侧 | 右侧 | 右侧 |
| 左留白 G ≥ 320（★，§13 D49） | 左留白 | 右侧 | 左留白 |
| 左留白不够 | 右侧 | 右侧 | **浮在阅读列上**（从卡片左边起，宽 `min(420, 卡片 − 48)`） |

卡片开着时留白变窄：自动 → 移到右侧；总在左侧 → 改成浮在列上。`refs.open` 的 `how: "peek"`（「在左侧预览」）不看设置，按「总在左侧」处理。

### 19.6 `CutexRef`

- 形状见 `modules/slots.ts`（`hostId` / `kind` / `key` / `title` / `params` / `snapshot?`）。`lib/refs.ts` `parseRef` **每次**打开前都重新校验
  （保存的数据不可信）：kind `/^[a-z][a-z0-9.:-]{0,99}$/`（**只能小写**），key ≤ 2000，title ≤ 200，params ≤ 32 个平铺字符串
  （名字 `/^[A-Za-z][A-Za-z0-9_-]{0,63}$/`、每个 ≤ 8000、拒绝 `__proto__` 等），snippet 截到 500；未知字段丢掉，不做类型转换。
- 种类归属：每个种类一个提供者。内置种类 `turn` / `agent` / `main.page` / `side.page` 与所有 `side.component` id 已被占用；
  `ref.target` 声明别的种类，重复的在登记前拒绝（`checkRefContributions`）。模块关掉时种类仍归它（不被别人接管）。
- 组件引用：kind = 组件 id，所以**可引用的组件 id 只能小写**（`toRef` 存在时 `modules.test` 检查）；`conversation.turnPeek` 例外，
  它产生的是 `turn` 引用。已有 `toRef` / `fromRef` 的：`workspace.preview`、`diff.view`、`terminal.pty`（key `pty:<id>`）、`artifacts.view`（key = 成果引用 `af-…@3` / `af-…@latest`，v1.7）、`delegations.detail`（key = ask id；模块种类 `delegation` 也打开它，2026-10-13）。`subagents.thread` 不加（`fromRef` 带不回父 agent 的绑定，延后）。

**Markdown 里的 `cutex:` 链接（v1.7）**。agent 回复、报告、记忆里的 `[文字](cutex:<种类>/<key>)` 与 `![替代文字](cutex:<种类>/<key>)`
（例：`[regression.md v4](cutex:artifact/af-0123…@4)`，成果库 wire 契约 `docs/research/artifacts-api-v1.md`）：

- 解析（`lib/cutexLinks.ts`，纯函数）：`cutex:` 后到第一个 `/` 是种类（同 `REF_KIND`，只能小写），其后是 key（非空、≤ 2000、不含空白；`%xx` 解码一次，
  解码失败按原样）。不认 `cutex://`、query、fragment 以外的写法；解析不了的是普通文字。引用 = `{ hostId: 焦点主机, kind, key, title: 链接文字（≤ 200）, params: {} }`。
- 清洗：streamdown 的 `sanitize` 会去掉未知协议，所以 `Markdown.tsx` 在它之前把 `cutex:` 的 `href` / `src` 转义成片段 `#cutex-ref:<encodeURIComponent>`
  （同文件链接的 `#cutex-file:`），渲染时再还原；从不交给浏览器导航（没有可导航的 `href`，点击由我们处理）。
- **只对模块定义的种类生效**：种类要有可用的 `ref.target` 提供者（插槽快照里 `show`）。内置种类（`turn` / `agent` / `main.page` / `side.page`）和组件 id
  不能当链接打开（它们要 params，而且 agent 写的文字不该切换选中的 agent 或摆布右侧）。没有提供者（模块关着、主机没有那个能力、未知种类）→ 显示成
  灰色文字，悬停给出原链接，点了不做事。
- 链接 = chip（同文件链接的样子：图标 + 链接文字），点击 / Enter = `refs.open(ref)`（`auto`），打不开时一行通知写原因；右键 = 在左侧预览 /
  在右侧打开 / 复制链接 + 该种类的 `ref.action`。提供者的 `useLink(ref)` 可以给提示、跟在文字后的小徽标（如「有更新」「已删除」）、语气（`muted` /
  `warn`）和图标；没有 `useLink` = 原样显示链接文字。
- 图片：按「消息里的图片」设置（缩略图时）问提供者 `thumbnail(ref, maxBytes)`（`THUMBNAIL_MAX_BYTES`，懒加载、按 `hostId|kind/key` 缓存，同文件缩略图），
  得到 `{ mime, encoding, content, size, truncated }` 就显示缩略图（点 = 打开），null / 失败 / 不是图片 = 退回 chip（文字 = 替代文字）。
- 核心只认 `cutex:` 形式，不点名任何模块或种类；`Markdown.tsx` 与 `lib/cutexLinks.ts`、`components/CutexLink.tsx` 在 `test/modules.test.ts` 的扫描里。

```ts
// modules/slots.ts（v1.7，RefTargetItem 的两个可选字段）
useLink?(ref: CutexRef): RefLinkView | null;                         // hook，在链接自己的组件里调用；要便宜（批量 / 缓存）
thumbnail?(ref: CutexRef, maxBytes: number): Promise<RefImage | null>; // 图片字节；null = 不是图片 / 没了 / 太大
interface RefLinkView { tooltip?: string; badge?: string; tone?: "normal" | "muted" | "warn"; icon?: Icon }
interface RefImage { mime: string; encoding: "utf8" | "base64"; content: string; size: number; truncated: boolean } // = fs/file 的形状
```

### 19.7 跳过去与「回到」（`services.timeline.focusTurn`）

- `focusTurn(hostId, sessionId, turnId, { back? })` → `focused | not-found(reverted | too-old | unknown) | host-offline | stale`：
  记下回到位置（`back: false` 不记）→ 需要时切到那个 agent（跨 agent）→ 往主时间线里按页载入更早的历史直到这一轮出现
  （≤ 5 页 × 200，`store.loadOlder` 的 `limit` / `read` 选项，读过的页从参考缓存取）→ 滚到它并闪一下（`lib/focusRequest.ts`）。
- 翻页时底部显示「正在翻找更早的历史…」；超过 5 页 → 「太早了：用参考卡片看这一轮」（点 = 打开参考卡片）；找不到 → 一行说明。
- **「回到」chip**：在「到底部」旁边（对话底部中间），文字「回到刚才的位置」/「回到 #n」（知道序号时）/「回到 X」（跳到了别的 agent）；
  点它或 Alt+←（焦点不在文本框时）回去：同一 agent 恢复到那一轮的偏移，原来在底部则重新贴底；跨 agent 先切回去。
- 连跳只保留**第一个**位置（「回到我原来在读的地方」），没有多级栈。chip 消失（`lib/returnPoint.ts` 状态机）：用过了；在正在读的 agent 里
  发了消息；滚回离原位置一屏以内（之前离开过一屏以上）；离目标和原位置都超过三屏；从侧栏换了 agent（跳过去自己的切换不算）；换主机。

### 19.8 `ref.action` 出口

模块的 `ref.action` 条目按 `kinds` 过滤、按 order 排，同一份列表出现在（`lib/refActions.tsx` `refActionEntries`，菜单是打开时现算的）：

| 出口 | 引用 |
|---|---|
| 消息操作栏里的图标按钮（`RefActionButtons`，复制 · 分叉 / 编辑并重发之后、「…」之前；2026-10-15 起不再收进「…」）与消息右键菜单 | `turn`（主人消息与回复；只读时间线没有） |
| 侧栏 agent 右键菜单 | `agent` |
| 右侧标签右键菜单、卡片 ⋯ / 类别图标菜单（当前显示的标签） | 组件 `toRef` 的结果（不可引用的组件没有） |
| 右侧页菜单 | `side.page`（启动页没有） |
| 模块页面标题（面包屑）右键 | `main.page`（页面有 `refParams` 时） |

- `useState(ref)` 只影响显示：菜单行（`MenuAction.labelNode`：另一个标题、✓、`disabledReason` 变灰）、图标按钮（`active` = 实心图标，另一个标题作提示，`disabledReason` = 禁用并作提示；批注：这一轮已有批注时实心）；`run` 要自己再判断一次。
- `run` 抛错 → 一行错误通知。宿主未启动时（测试、启动早期）没有条目。
- 服务行的引用动作延后：P2 之前没有服务的引用种类。
- `excludeKinds`（可选，2026-10-16）：条目在这些引用种类上不出现，即使 `kinds` 包含它们（`lib/refActionApplies.ts`）。书签模块用它把 `agent` 排除：给 agent 的「收藏」并入侧栏置顶，书签只留给对话等引用。

### 19.9 `services.refs`

`refs.open(ref, { how })`：先 `parseRef`（失败 `bad-ref`），别的主机的引用 → `host-changed`，然后按种类分发：

| 种类 | `auto` | `peek`（在左侧预览） | `page`（在右侧打开） | `jump` |
|---|---|---|---|---|
| `turn`（内容） | 参考卡片，位置按 §19.5 | 参考卡片，按「总在左侧」 | 右侧卡片，聚焦 | `focusTurn`（`reverted` → `reverted`，`too-old` / `unknown` → `gone`） |
| `peekable` 组件（内容） | 参考卡片（`fromRef` 的参数） | 同左，按「总在左侧」 | `side.reveal` | 同 `auto` |
| 其他组件（工具） | `side.reveal`：找到活实例切过去并闪，关了就重开 | 同 `auto` | 同 `auto` | 同 `auto` |
| `agent` | 选中它（不在侧栏 → `gone`） | | | |
| `side.page` | 打开右栏切到那一页（不在 → `gone`） | | | |
| `main.page` | 打开页面（参数经 `refParams` 过滤；没有 `refParams` = 不可引用 → `bad-ref`；模块关了 → `module-off`） | | | |
| 其他 | 那个种类唯一的 `ref.target`：`open(ref, how)`（`jump` 当 `auto`），抛错 = `gone`；没有提供者 → `module-off` | | | |

结果：`opened`（`where: peek | card | page | timeline | selected`）/ `unavailable`（`gone | reverted | module-off | capability | host-offline |
host-changed | bad-ref`）/ `stale`。`ref.target` 从不启动 / 重启任何东西，目标删了就报 `unavailable`，不悄悄换目标。

`refs.here()`：现在屏幕上的东西的引用——选中的 agent、打开的模块页面（`main.page`，标题 = 页面 id）、可见的右侧实例（`toRef`）、当前右侧页。
`refs.parse(raw)` = `parseRef`。内置构造在 `lib/refs.ts`（`turnRef` / `agentRef` / `sidePageRef` / `mainPageRef`），外壳取「现在这一轮」用
`lib/refServices.ts` `turnRefNow`（名字、开始时间、知道时带序号与线程）。

### 19.10 Esc 链（`lib/escChain.ts`，纯函数）

一次 Esc 只做一件事，第一条匹配的行生效：

| 行 | 条件 | 动作 |
|---|---|---|
| – | 右侧区的拖放进行中（§18.7） | 取消拖放，别的都不做（`lib/sideDnd.ts` 在模块加载时注册的窗口捕获监听，先于各组件挂载时加的捕获监听看到这个键） |
| 0 | 带修饰键 / 按住重复 / 输入法组字中 | 什么都不做 |
| 1 | 菜单、对话框、弹出层（含留白弹出）、命令面板、输入框面板、待处理的互动卡片开着 | 交给它们（它们自己关） |
| 2 | 焦点所在组件自己处理了 Esc（调了 `preventDefault`：侧聊停止、搜索清空、终端……） | 交给它们 |
| 3 | 参考卡片开着且看得见（右侧区最大化 / 全屏时它被藏起：先走第 4 行，还原后它回来，下一次 Esc 才关它） | 关掉它（焦点回去） |
| 4 | 右侧区最大化 / 全屏 | 还原 |
| 5 | 窄窗口抽屉开着、焦点不在可编辑处 | 关抽屉 |
| 6 | 焦点在右侧或留白（`[data-side-root]` / `[data-gutter-root]`）、不在可编辑处 | 什么都不做：**从不打断回合** |
| 7 | 对话 | 对话自己的 Esc（`lib/escInterrupt.ts`） |

第 3–5 行由 App 级的一个监听（`lib/escLayers.ts`，经 `lib/useSideShortcuts.ts`）执行；任何一行适用时（`sideLayersActive()`，参考卡片也算），
输入框与对话的窗口监听让路。组件不要监听全局 Esc。

### 19.11 设置与键盘

设置 → 侧栏与顶栏 → 会话两侧（`SidesSettings.tsx`）新增两行：**参考卡片打开位置**（★自动 / 总在右侧 / 总在左侧，§19.5）与
**留白里常驻**（每个有 `Body` 与 `dockMinWidth` 的留白条目一个开关，★全关，写 `gutterDocked`；没有这样的条目时显示「现在没有可以常驻的留白工具」）。
两项都进设置搜索关键词。键盘：Alt+← 回到（§19.7）；Esc 见 §19.10；F6 焦点轮转把常驻列表与参考卡片算作区域（`data-focus-region`；嵌套时取最内层）。

### 19.12 与 RFC 的偏差、延后

- 组件 id 是 `conversation.turnPeek`，不是 RFC 的 `turn.peek`：条目 id 必须以模块 id 开头（`conversation` 模块拥有它）；它的引用种类仍是 `turn`。
- 几何输入用让位 shift + 覆盖宽度，不传「右栏与对话」模式（同一结果，少一个耦合）；参考卡片经 `sideLayersActive()` 进 Esc 链，没有用 `useTrackOverlay`
  （它不是第 1 行那种弹层）。
- 回落（RFC §7.13）：没有 C-T1 → 按页读 ≤ 5 页；没有 C-T2 → 序号只在整段历史都已载入时显示；「已撤销」是推断（见 §19.4）。
- `refs.open` 对 peekable 组件的 `page` 走 `side.reveal`（找回已开的实例或重开），对 `turn` 是 `side.open({ target: "page", focus: true })`。
- 延后：服务行的引用动作（P2）；`subagents.thread` 的 `toRef` / `fromRef`。书签、批注、侧聊模块按本节宿主接入（RFC §7.14 / §10.5–§10.6）。
- 浏览器预览演示（只在 dev）：`?gutter` 加载 `dev/devGutter.tsx` 的模块 `dev-gutter`（左留白「引用」列表：一组样例引用，点 = 打开，右键 = 指定方式；
  `ref.action`「复制引用（JSON）」；每第 10 轮右侧页边一条演示内容）。它的文案 `gutter.demo.*` 在主词典里，生产构建不加载这个模块。

## 20. profile 字段旁的模块动作 `profile.fieldAction`（v1.6）

主人 2026-10-10：Claude 账户不要单独的设置页，放进 设置 → Profile；在 profile 那里能直接添加 Claude 订阅。账户列表本身是
`claude-accounts` 在页面 `profiles` 的 `settings.section`（`claude-accounts.accounts`，列表之后、不折叠）；本节是另一半：
模块在 profile 编辑器和「添加 profile」表单里、它拥有的 profile 字段旁放一个动作。

```ts
export interface ProfileFieldActionItem extends SlotItemBase { // 默认 unavailable "hide"：模块关掉 / 缺能力 → 不显示
  field: ProfileOwnedField;      // = keyof ProfilePatch & keyof ProfileCreateRequest（现在只有 "claudeAccount"）
  Action: ComponentType<ProfileFieldActionProps>;
}
export interface ProfileFieldActionProps {
  pick(value: string): void | Promise<void>; // 把值放进该字段的草稿：控件重读选项并显示它，编辑器的保存条 / 表单的「创建」保存；同值再 pick = 刷新控件
  disabled: boolean;             // 字段在这里不可编辑（另一种 profile、托管 profile）
}
```

- 出口：`modules/Outlet.tsx` 的 `<ProfileFieldActions field pick disabled>`，每个条目一个 `ItemBoundary`，按 `order`。核心
  `settings/ProfileClaudeAccount.tsx` 把它放在 Claude 账户选择下面（编辑器：「管理账户」+ 动作；添加表单：动作）。
- 动作自己负责界面（`claude-accounts`：「+ 添加订阅」打开对话框 = 同一个添加表单，建好后 `pick(id)`，再显示终端登录引导；
  「完成」检查后再 `pick` 一次，选择框里的状态跟着变）。桌面端不跑登录、不碰凭据（`docs/research/claude-multi-account.md` 决定 2）。
- 「管理账户」只在 `claude-accounts.accounts` 分区可见时显示，点了 = `openSettings("profiles", { anchor: "claude-accounts.accounts" })`
  （Profile 总览把其他锚点交给 `requestSettingsReveal`，滚到分区并闪一下）。核心只认条目 id 字符串（`lib/claudeAccounts.ts`
  `CLAUDE_ACCOUNTS_SECTION`），不 import 模块。
- 测试：`test/moduleSdkContract.test.ts`（插槽默认值、编译探针）、`test/modules.test.ts`（新 / legacy 下的分区快照）、
  `test/moduleMocks.test.ts`（mock 里添加订阅 → 需要登录 → 新建 Claude profile 绑定它）。

## 21. 项目页标签 `project.tab`（v1.12）

主人 2026-10-12：「项目页面是不是也能添加成果库和服务？」界面交给 lead。项目页（`modules/projects/ProjectsPage.tsx`）不 import
别的模块（模块之间一律不互相 import），所以加一个插槽，由拥有数据的模块贡献标签。

```ts
export interface ProjectTabItem extends SlotItemBase { // 默认 unavailable "hide"
  tab: string;          // 深链名（`projects.page` 参数 `tab`）；全局唯一，不能是核心标签名
  order: number;        // 核心：overview 100、agents 200、tasks 300、memory 400、settings 500
  titleKey: MessageKey;
  Body: ComponentType<ProjectTabProps>;
  useSummary?(props: ProjectTabProps): string | null; // 概览计数行的一句（「3 个成果」）；null = 不说
}
export interface ProjectTabProps { hostId: string; projectId: string } // 项目所在主机（调用发往这里）
```

- 列哪些：模块启用且条目可见（`mode === "show"`），并且**项目所在主机**有模块 ∪ 条目的能力（`useHostEntryGate`；模块可能只因范围里
  另一台主机而激活）。重名（与核心或先到的条目同名）的条目丢弃，平序时核心在前（`mergeProjectTabs`，纯函数）。
- 打开一个现在不提供的标签（模块关了、主机没有能力、能力还在加载）显示概览；参数保留，标签回来时自动切回。
- 每个 Body 和每个 `useSummary` 各有自己的 `ItemBoundary`；概览把有话说的条目连成一行，每句是去该标签的链接，分隔点由 CSS 画，
  不说话的条目不留多余的点。
- 侧栏项目菜单「打开项目页面」的子菜单用同一份列表（`projectTabsNow(host)`，非 React）。
- 贡献者（v1.12）：`artifacts.projectTab`（`tab: "artifacts"`，310，「成果库」）——侧栏卡片的库视图（`LibraryPanel`）换成项目范围
  （`artifactStoreList({ project })`，`libraryQuery`），筛选 / 排序 / 列表网格 / 从工作区发布照旧，打开版本 = 右侧 `artifacts.view` 标签，
  绑定 `{ kind: "host", hostId }`；计数 = 一页（100）未归档的数量，超出写「100+」，主机的成果事件刷新。只列项目范围：cutex 里项目成员
  发布到项目范围（`forSession` 解析成项目），成员的会话范围成果只来自入项目之前，不另列。`services.projectTab`（`tab: "services"`，320，「服务」）
  ——服务页同一张表（`ServicesTable`）只取 `projectId` 相同的行（`projectServiceList`：问题在前，再按名字），不分项目组、不显示主机标记，
  打开 / 启停 / 日志 / 负责人菜单照旧；空态「这个项目还没有服务」。概览侧栏原有的服务小列表（核心 `ServiceLine`）保留。
- 测试：`test/moduleSdkContract.test.ts`（插槽默认值、编译探针）、`test/projectTabs.test.ts`（合并次序、重名、`libraryQuery`、
  `projectServiceList`）。

## 22. 代码块动作 `timeline.codeBlockAction`（v1.14）

主人 2026-10-09（TODO.md）：agent 回复里的 shell 代码块旁加 ▶ 运行（像 Claude 桌面端），复用内置终端。代码块由 streamdown 渲染，
复制 / 下载是它自带的；核心不点名终端模块，所以加一个插槽，模块往代码块工具条里放动作。

```ts
export interface CodeBlockActionItem extends SessionItemBase { // 默认 unavailable "hide"
  /** 纯函数、便宜：回复里每个围栏代码块都调用；true = 这个块上出现本动作。 */
  match(block: CodeBlockMatch): boolean;
  Action: ComponentType<CodeBlockActionProps>;
}
export interface CodeBlockMatch {
  language: string;               // 围栏标签，小写（```Bash → "bash"）；没有标签的块不问条目
  hostId: string;                 // 会话所在主机（调用发往这里）
  platform: HostPlatform | null;  // 该主机的系统（cutex /v2/host.platform，上次连接时；null = 不知道）
}
export interface CodeBlockActionProps extends CodeBlockMatch {
  sessionId: string;
  code: string;                   // 块的文本（去掉末尾换行）
  incomplete: boolean;            // 围栏还在流式输出（没闭合）：动作应当不可用
}
```

- **范围**：只有 agent 回复（`Timeline.tsx` `agent` 条目）且时间线不是只读（归档 agent、子 agent 视图、参考卡片）时，`Markdown`
  外面有 `CodeBlockScope`（`lib/codeBlockScope.ts`，`{ sessionId, hostId }`）；主人自己的消息、审查结果、计划、委托卡片、
  文件预览等其他 Markdown 不看插槽。
- **出口**：`Markdown.tsx` 的 `components.code`。行内代码、`mermaid` 和没有标签的块直接交给 streamdown 默认组件；有范围时按
  `components/ReplyCodeBlock.tsx` 取条目（`lib/codeBlockActions.ts` `useCodeBlockActionItems` + `lib/codeBlockScope.ts` `matchCodeBlockActions`，
出口组件 `modules/CodeBlockActions.tsx`；`Markdown.tsx` 自己仍不点名模块）：`mode === "show"`、agent 不缺 `agentFeature`、**会话主机**有模块 ∪ 条目能力
  （`useHostEntryGate`，同 §19.3）、`match` 为 true，按 `order`。没有条目 → 原样默认组件（零差异）；有 → streamdown 导出的
  `CodeBlock` + 下载 + 复制，后面接每个条目的 `Action`（各自 `ItemBoundary`）。`match` 抛错 = 不匹配（记日志）。
- 条目自己负责确认与执行；工具条按钮的观感跟复制 / 下载一致（`p-1`、14 px 图标、`text-muted-foreground`）。
- 贡献者（v1.14）：`terminal.runCode`（▶ 运行，模块 `terminal`，`requires: terminal`（2026-10-15 起不再带 `focusHost`：会话主机有
  `terminal` 才有按钮，终端卡片在绑定主机缺能力时只显示提示）；非主人连接没有 `terminal` 能力，
  所以没有按钮）。标签与主机系统要对上：Windows 主机 `powershell` / `pwsh` / `ps1` / `cmd`，Linux / macOS 主机 `bash` / `sh` / `shell` /
  `zsh`；对不上或系统未知 → 没有按钮（不显示灰按钮、不给提示）。单行块点一下就运行；多行块用两步确认（`useArmed` + `ArmedHint`，
  「再点一次运行这 N 行」），从不 `window.confirm`、从不自动运行。运行 = 打开终端卡片：这个 agent 视图里开着的终端（最近聚焦的那个）→
  工作区里还活着的终端（最新的）→ 在工作区根新开一个；然后 `terminalInput(code + "\r")`（换行按 xterm 粘贴的规则换成 `\r`）。
  没有工作目录 → 提示 `terminal.noWorkspace`。
- 测试：`test/moduleSdkContract.test.ts`（插槽默认值、编译探针）、`test/modules.test.ts`（新 / 未加载 featureList 下的插槽快照）、
  `test/codeBlockRun.test.ts`（标签 × 主机系统、单行 / 多行确认、换行转换）。
