# 桌面插槽与模块约定（v1.26）

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
v1.16（2026-10-18，`feat/module-packs`；主人 2026-10-18「长痛不如短痛」）：可下载的第一方**模块包**（§23）——发布密钥签名的索引
`modules.json`（GitHub release `modules-release`），main 下载、验签、验哈希、原子解包到 `userData/modules/<id>/<version>/`、每次启动复验，
经特权 scheme `cutex-module://` 只送给主窗口主 frame；renderer 用宿主对象（`__CUTEX_MODULE_HOST__`，共享 React / zustand / app 文件）
`import()` 入口，经 §15 的 `removeModule` / `addModules` 覆盖内置版本，失败退回内置。SDK 新增 `packs.ts`（`ModulePackEntry`、
`ModulePackHost`、`MODULE_PACK_HOST_GLOBAL`、`moduleApiSatisfies` / `moduleApiVerdict`）。试点 `claude-science`。
v1.17（2026-10-20，窗格第 3 步；设计 `docs/research/panes-20261019.md` §2、§7 第 3 行，主人 2026-10-20 的决定在其开头）：**窗格**（§24）——
整个窗口是窗格的摆放：左边停靠智能体列表，工作区是对话窗格（≤ 2 列），右边是工具列（原右栏）。新插槽 `pane.kind`（A 档，
`unavailable: "hide"`）；每个 `side.component` 派生同 id 的窗格种类，每个不带 `Aside` 的 `main.page` 派生 `page:<id>`；`core.conversation`
是外壳自己的多实例种类，右栏 `conversation.agent` 并进它（固定在那个 agent 上的对话窗格）。右栏的页 → 卡片 → 标签变成工具列 → 窗格 →
标签：去掉多页切换（所有工具列同时在屏幕上），工具进最右一列、往下分到 3 行、再多变成最下面窗格的标签。新服务
`services.panes.open(kind, params, { beside?, focus?, background? })`，`services.side.open` 保留为它对工具种类的别名；`services.ui.openPage`
在聚焦的对话窗格里打开页面。§18.5 的每 agent 一份视图废止（布局全局一份）。布局只存本机 `cutex-desktop.panes`，旧 `cutex-desktop.side`
一次性迁过去并留备份键。只加不删：`side.component` / `main.page` / `services.side` 不变。
v1.18（2026-10-20，窗格第 5 步；`docs/research/home-page-20261019.md`、`panes-20261019.md` §5）：**桌面底层**（§25）——新插槽 `pane.desktop`
（A 档，`unavailable: "hide"`）：没有窗格在前面时外壳在工作区画第一个显示的条目；`NavItem` 加可选 `lead` / `useShown` / `useActive`（侧栏
最上面的固定入口、按设置显示、自己的高亮）。第一个使用者：内置模块 `home`（桌面、个人页 `home.profile`、固定到主页）。只加不删。
Shelf（2026-10-20，契约仍是 v1.18；`docs/research/canvas-principles-20261020.md` §6）：工具区改成 **Shelf**（§24.12）——会话两侧各最多一个，
每个有自己的 **Shelf Rail**（保护上限 50 页，一次显示一页）、宽度和选项（允许混排、Rail 外侧 / 内侧）；第 3 步去掉的右栏多页按这个形状回来。
模块看到的东西不变（`pane.kind`、`services.panes` / `services.side.open` 的 `page` 仍是页 id），所以不升版本。
v1.21（2026-10-21，主人：「页面应该是自己的面板」）：`main.page`（项目、委托、服务、审批、作业、工作流…；带 `Aside` 的全窗口页除外）不再盖在
会话上、挂在会话顶栏下面，而是作为**自己的窗格**开进聚焦对话的 Shelf（派生种类 `page:<id>` 交给工具引擎放置：自己的页组，按 Shelf 的混排
规则新开一页或成为标签；窗格头 = 页面入口的图标 + 面包屑 + 放大 / 全屏 / ⋯ / ×），会话照旧显示对话。新设置 外观 → 窗口与卡片 →
「页面打开位置」：{{shelf}}（缺省）/ 占用会话（页面暂时盖在会话上，带**页面自己的顶栏**，Esc / × 回到对话）。`services.ui.openPage`、
`services.panes.open("page:<id>")`、侧栏入口、⌘K、链接 / 深链都跟着这个设置；会话顶栏不再有页面面包屑（§24.4、§26.4）。类型不变，语义变了，
所以 `MODULE_API_VERSION` 1.20 → 1.21（声明快照只有版本常量）。
v1.22（2026-10-22，主人：「平台，而不是产品」；设计 030 v2 + 032）：新插槽 **`desktop.widget`**（§27）——桌面上的每一块都是一个**小组件种类**的
实例：模块声明大小（8 px 网格步长的最小 / 最大 / 缺省 / 快捷大小）、形状（卡片 / 圆 / 路径 / 无底板）、能不能放多个、缺省位置、每个实例的设置表
（外壳画表单）、刷新节奏（共用的计时器）、**来源**（模块 / 服务 / 智能体）和组件；组件拿到大小、配色、设置、减少动态效果、整理中、时间、
来源和 **`actions`**（外壳自己的打开智能体 / 页面 / 服务、确认后发给智能体）。桌面模块 `home` 把名片、时钟、需要你、用量、固定的磁贴都改成了
小组件，新模块 `world-clock` 是第一个别的模块的小组件。只加不删，`MODULE_API_VERSION` 1.21 → 1.22（声明快照只有版本常量）。
v1.23（2026-10-24，主人：「现在 grid 好像太细」→ 一格 96 px）：桌面改成**整格**的网格——一格 96 px、两格之间 16 px（`WIDGET_CELL` /
`WIDGET_GAP`），外框只能是整格。种类可以用格子给大小（`size.cells`，可选）；只写了 1.22 步长的种类照常能用：每个大小换成最近的格数
（`cellsOfSteps` / `cellSizesOf`，绝不拒绝）。组件多拿到 `cells: { w, h }`（`steps` 照旧 = px / 8）。存过的 1.22 摆放换算一次（见 §27.2）。
只加不删，`MODULE_API_VERSION` 1.22 → 1.23（声明快照只有版本常量）。
v1.24（2026-10-24，主人：「你现在的单个其实是占据 2x2」）：网格再细一半——**单位** 40 px、间距 16 px（`WIDGET_UNIT`），两个单位加一个间距正好
是 1.23 的一格，所以 1.23 的大小和摆放**正好乘 2，什么都不动**。种类可以用 `size.units` 给大小；没写就把 `size.cells` 乘 2，再没有就按步长换算
（`unitSizesOf` / `unitsOfSteps`，每边至少 2 个单位，绝不拒绝）。组件多拿到 `units: { w, h }`。整理时画**点阵**（四个单位相交处一个点，点一样大）。
只加不删，`MODULE_API_VERSION` 1.23 → 1.24（声明快照只有版本常量）。
v1.25（2026-10-24，空 Shelf 启动器）：app 层 `SideLauncher` 加可选 `category?: "content" | "tool"`，供空 Shelf 的内容／工具分组使用。
分类只是展示元数据，不改变绑定、能力门控、启动参数、固定或打开行为；未声明的旧启动器按 `tool` 分组，状态启动器由外壳另行派生。没有新插槽，`SLOT_SPECS` 的默认值／placement 快照不变。
只加不删，`MODULE_API_VERSION` 1.24 → 1.25；SDK 仍只承载中立合约，声明快照 `module-api-1.25.d.ts` 只有版本常量变化。

v1.26（2026-10-29，来源文件操作子菜单）：app 层 `RefActionItem` 加可选 `submenu(ref)`，返回菜单项数组或它的 Promise。
引用菜单将其作为正常的懒加载子菜单，悬停／→／Enter 时才解析；复用菜单的定位、滚动、可用性检查与危险操作确认。
不在每个 chip 渲染时读取详情；关闭后的异步结果不能重开菜单。`run` 保留给独立图标按钮，旧条目行为不变。
没有新插槽，默认值／placement 快照不变；`MODULE_API_VERSION` 1.25 → 1.26，SDK 声明快照只有版本常量变化。


决定：主人，2026-10-09（总纲 `docs/DESIGN.md` §4.22）。读者：主线开发；GPT（按本文实现宿主包，见
`docs/research/kutex-brief-for-gpt.md` §3 A；下称 brief）。本文是约定，改格式先改本文。行号 = 2026-10-09 `main`，
路径相对 `apps/desktop/src/renderer/src/`，`components/` 下的文件省略这一层；`shared/` 指 `apps/desktop/src/shared/`。

## 1. 目的与范围

- 主线按「插槽 + 模块」组织：每个功能是一个**模块**，向命名的**插槽**贡献条目；外壳（`App` / `Sidebar` /
  `Conversation` / `Settings` / `TitleBar` / `StatusCapsule` / `Timeline` / `Composer`）只按注册表渲染，不再有按功能的分支和
  `features.has(...)`（现在约 90 处、约 40 个文件）。
- **v1 的主 renderer 只有内置模块**：仓库内、随包构建、可信。v1.1 动态登记仍只接受受信任 adapter 创建的定义，外部代码不进入主 renderer。v1.16 起另有**签名的第一方模块包**（§23）：发布密钥签名、main 校验后才进入主 renderer，信任等于内置模块。
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
| A | `nav.primary` | `SidebarNav.tsx`：顶栏主机选择器右边一组平铺图标（`TitleBarEntries`，侧栏 v5，设计 040 §4.1）；头像栏（侧栏收起）的图标（`TopNav rail`，v1.18 `lead` 条目在最上面） | 桌面（`lead`，v1.18）、快速对话、新建 agent、项目、服务、委托、作业、审批 |
| A | `main.page` | `App.tsx:101–121`，`store.ts:84`（`MainView`），`TitleBar.tsx:136–200`（面包屑） | 设置、项目、委托、作业、审批、服务、草稿对话、新建 agent（任务详情页 r219 删除） |
| A | `timeline.received` | `lib/receivedRows.ts:16–24`，`Timeline.tsx:276–298` | task-service 任务（旧转录）、委托请求、委托结果；兜底 = agent 消息 |
| A | `timeline.tool` | `WorkGroup.tsx:193–198`，`Timeline.tsx:301–303`，`lib/workGroups.ts:127` | subagents（collab）、旧 cutex 任务工具、委托卡片；兜底 = 普通工具行 |
| B | `composer.plus` | `ComposerTools.tsx:108–370`（`PendingChat.tsx:495` 也用） | 图片、@文件、技能引用、进程、目标、记忆、技能、MCP |
| B | `composer.slash` | `lib/slashCommands.ts:34–87,268–336` | 约 25 条（已有 `enabledBy` / `agentFeature`） |
| B | `composer.queueSection` | `Composer.tsx:936–943`（注释里已叫 Slot 0–2） | agent 留言 v2、待处理委托、委托暂停 |
| B | `menu.agent` | `lib/menus.tsx:191–244` | 核心、Claude 工具、委托暂停、运行时、生命周期 |
| B | `message.action` | `lib/menus.tsx:282–317`，`MessageActions.tsx:105–171` | 复制 / 引用 / 折叠；fork / 回退 / 编辑重发 |
| A | `side.component`（v1.4，§18；v1.17 起它的实例是工具列里的窗格，§24） | `components/side/*`，`lib/sideLayout.ts`（原 `SidePane.tsx` 已删） | 工作区（文件、改动、预览）、diff、subagent 线程、状态分类（适配 `status:<id>`） |
| A | `conversation.gutter` / `timeline.turnAttachment` / `ref.action` / `ref.target`（v1.4，§19） | 已声明，宿主随 P1a 接入 | 书签、批注、侧聊（GPT 返工，RFC §7.14）；成果（`artifacts`：`ref.target` 种类 `artifact` + `ref.action`，v1.7）；委托（`delegations`：`ref.target` 种类 `delegation`，2026-10-13） |
| A | `timeline.intro`（v1.13，§19.3） | `Timeline.tsx` 会话开头出口 `modules/TimelineIntro.tsx` | intro（开场：profile 立绘 + 开场白） |
| A | `pane.kind`（v1.17，§24） | `components/PaneHost.tsx`（工作区与工具列），`lib/paneKinds.tsx`（种类表：核心 + 贡献 + 派生），`lib/paneLayout.ts` / `lib/paneStore.ts` / `lib/paneFile.ts`，`lib/paneServices.ts`（`services.panes`） | home（`home.profile` 个人页，v1.18）；派生：每个 `side.component`（同 id）、每个不带 `Aside` 的 `main.page`（`page:<id>`）；核心 `core.conversation` |
| A | `pane.desktop`（v1.18，§25） | `components/PaneHost.tsx`（单个空对话窗格的位置），`lib/paneDesk.ts`（`desktopReason`） | home（桌面：名片、时钟、需要你、用量、磁贴） |
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
                                 // 设计 006 v1：外壳按 page id 把面板页（sidebar / conversation / status / sides / tray / desktop）显示成「面板」组（PANEL_PAGES，跟在应用后面），模块的 group 不变
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
  Menu?: ComponentType;            // 入口旁下拉；侧栏 v5 起不再画（入口成了顶栏图标，用 menu）
  menu?: { open(anchor: HTMLElement): void; hintKey: MessageKey }; // 2026-10-23：顶栏图标的右键菜单（开在图标下面）；hintKey = tooltip 里一行说明。没有 = 右键是固定 / 取消固定
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

**按需加载**（2026-10-23，`lib/lazyPage`）：内置模块的 `settings.page` 的 `Page`、`settings.section` 的 `Section`（以及不常开的
`main.page`，如 agent-config 的几页）写成 `const X = lazyPage(() => import("./X").then((m) => m.X))`，条目本身（id、标题、
搜索关键字、顺序）照旧在入口包里，组件第一次打开时才加载（之后同步渲染，没有空帧）；不用 Suspense（React 会把边界内容在
fallback 出现后压 300 ms）。常开的页（审批、委托、作业、项目、服务、工作流、快速对话）保持直接导入。模块包（`claude-science`）
只能用 `packHost` 里的文件，不走这条。`test/lazyPage.test.tsx` 检查每个模块的设置页 / 分区都是 `lazyPage`。`preloadLazyPages()` 在空闲时
逐个预加载全部（设置 → 通用 → 性能 → 流畅优先，`lib/perfMode`）。

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
  doctype）；默认上限 4 MiB（= `ARTIFACT_CONTENT_MAX`），调用方可传更大的上限（分段读出的大页面，≤ 256 MiB）。没有 bootstrap bridge、MessagePort、nonce：页面能跑自己的内联脚本。`buildOfflinePageDocument(html, max, { pageApi: true })`（只有 agent 页面用）在 RTC 脚本后再放 `PAGE_API_SCRIPT`：`window.cutexPage`，只是把三种固定格式的消息 `parent.postMessage` 出去的薄包装（见下「三个口」），本身不授予任何东西。
- `./documents`（main）：`createFrameDocumentStore({ scheme })`——一次性文档（30 s 未取即过期，总数 32、每个 renderer 8），
  只出一次，响应头 `CSP; sandbox allow-scripts` + `nosniff` + `no-referrer`，URL 是该 webContents 的导航租约直到 release。
  **插件文档和 agent 页面共用 main 里同一个 store**（同一个 `cutex-plugin://frame/<id>/index.html` scheme、同一个
  `onBeforeRequest` / `will-frame-navigate` 租约检查、同一次 `releaseOwner`），所以仍只有一个 frame 宿主要审计；父页面 CSP 不变
  （`frame-src cutex-plugin:`）。多窗口（§24.17 P4）：租约的 webContents 是**画 frame 的那个窗口**（主窗口或主窗口开的一张桌子，
  main 在 prepare 时核对），只在那里能取、那个窗口没了就释放；插件文档仍只租给主窗口。store 的「每个 8」按 webContents 算，所以 agent 页面 /
  HTML 文件另按**发请求的 renderer** 合计封顶 8（`PAGE_DOCUMENTS_PER_OWNER`，`main/frames.ts`，所有窗口加起来），超过答
  `Too many prepared frame documents`：页面 + 插件文档最多 16 个，占不满共享的 32，桌子再多也挤不掉主窗口的插件 frame（和 P4 之前一样）。

agent 页面（`artifacts.view` 的 `html` 预览，`text/html` / `application/xhtml+xml` / `.html` / `.htm`）：
- renderer 只发 `{ hostId, artifactId, version }`（具体版本；`@latest` 标签先解析）到 IPC `cutex-desktop:frames`
  （`shared/frames.ts`，preload `bridge.frames`）；main（`main/frames.ts`）自己从那台主机的 `/v2/artifact-store/…/content` 取字节、
  在第一份文档之前跑 `pluginNetwork.ensure()`（WebRTC / 代理黑洞 / DoH，与插件相同），再放进共享 store。HTML 不经 renderer → main，
  token 不离开 main。外部文件已变、非 UTF-8 → 返回原因，视图改显示源代码。超过 4 MiB（`ARTIFACT_PAGE_PROMPT_BYTES`，一个内容窗口）的页面先在视图里问主人（常是内嵌音频 / 视频），主人点「显示页面」后请求带 `large: true`，main 按 4 MiB 窗口逐段读取（每段校验版本、sha256、总长和接续的 offset；cutex 在字符边界切窗口）再拼成文档，上限 256 MiB（`ARTIFACT_PAGE_MAX_BYTES`），超过仍显示源代码。
- 大页面选择不依赖 Shelf 组件实例：当前桌面会话内记忆 24 小时（从选择时起算），按最近使用保留最多 500 条。成果以 host + 成果 ID + 版本 + 字节数 + sha256 为身份；文件 HTML 以 host + workspace scope + 路径 + 字节数 + 修改时间为身份，元数据来自 main 同一次受限读取。文件的「显示页面」和「看源码」都会记住；显式点击工具栏「预览」可重新考虑源码选择。内容身份变化或记忆过期后再询问，硬上限不变；切页导致卸载不丢选择。
- 视图头上「页面 / 源代码」切换（`ViewState.code`）；页面自己跳走（链接、刷新）被 main 拦下，视图显示「已拦下 · 重新加载」。
- 不需要审批：除下面三个口外它什么都碰不到。需要联网的东西是服务（`service_register`），由主人在自己的浏览器标签里打开。

**三个口**（2026-10-21，`docs/design/004-artifact-page-bridge.md`，不改契约版本）。页面仍是不透明来源、不联网（loopback 也不行）、
没有 preload / Node / token / daemon RPC；它只能发三种固定格式的消息，每一种都由主进程检查、决定：
- 路径：页面 `parent.postMessage({ tag: "cutex-page/1", id, op, … }, "*")` → renderer 的 broker（`modules/artifacts/pageBroker.ts`，
  `PageFrame` 挂载）只收 `event.source === 这个 frame 的 window` 且 `origin === "null"` 的消息，按 `shared/pageBridge.ts` 的
  `parsePageMessage` 校验（op 白名单、字段必须正好是这些、key ≤ 256 且无控制字符、单条 ≤ 5 MiB、提交 ≤ 64 KiB、复制 ≤ 1 MiB、
  同一 frame 同时最多 8 个请求）→ IPC `cutex-desktop:frames` `{ op: "page", id: <main 发的文档 id>, call }` → main 用
  `parsePageCall` 再查一遍，按**它自己在 prepare 时绑定**到这个文档 id 的 host + artifact + version 处理（别的 renderer、已 release
  的文档 → `unavailable`）。回复只发回同一个 frame window。没有别的 op：fetch / ipc / daemon / open 一律 `invalid`。
- A 存储 `storage.get / set / remove / keys / clear`：`main/pageStorage.ts`，userData `artifact-pages/<sha256(host)前16>-<af-id>.json`，
  **每个成果一份、各版本共用**。上限是 main 里的常量：每个成果 5 MiB（key + value 的 UTF-8 字节）、所有成果合计软上限 200 MB；
  超过答 `quota_exceeded`（`scope: page | total`），**从不自动删除**；合计超限时设置里提示。主人在成果 ⋯ 菜单「清除这个页面的数据」
  或 设置 → 右侧栏与留白 → 页面数据（逐个列出、可清除）清除（IPC `pageDataUsage` / `pageDataClear`）。
- B 提交 `submit`（文本或 JSON）：main 从主机读这个版本的 `producer`（`agent`，或 `exclusive` 的自动捕获）定收件人，页面不能指定；
  没有 → `no_recipient`。然后 main 自己弹**原生**确认框（`dialog.showMessageBox`，挂在主人的窗口上；标题、发给谁、内容预览前 1200 字；
  默认按钮是「取消」；页面看不到也点不了；窗口隐藏 / 最小化 → 不弹、答 `unavailable`；5 分钟没答 = 取消；frame 关掉 = 取消）。
  点「发送」才以普通主人消息发给那个智能体（`submit … auto, startIfOffline`），开头标明「来自成果页面「名称」vN（af-…@N）：」，JSON 包在代码块里。
  限流：每个窗口同时一个确认框（`busy`）；同一成果关框后 5 s 内、或 10 分钟内已问过 5 次 → `rate_limited`。
- C 复制 `copy`：broker 只在用户手势进行中转发（`navigator.userActivation.isActive`——frame 里的点击会传到父页面——且焦点在这个
  frame 上；否则答 `no_gesture`，main 根本收不到），main 用 `clipboard.writeText` 写入，app 自己弹「已复制页面里的文字」；每个 frame
  每 500 ms 最多一次。剪贴板读取仍是关的。
- 页面 API（`window.cutexPage`，在 Cutex 外不存在，页面应判断后退回 localStorage / 复制框）：
  `storage.get(key)` → 值（JSON 解析后）或 null；`storage.set(key, value)`（JSON 序列化；`undefined` = 删除）；`storage.remove(key)`；
  `storage.keys()`；`storage.clear()`；`submit(textOrJson)` → `{ sent: boolean }`（主人取消 = `sent: false`）；`copy(text)`。
  失败时 reject 一个 `Error`，`code` 为 `invalid | too_large | quota_exceeded | busy | rate_limited | no_gesture | no_recipient | unavailable`
  （`quota_exceeded` 还带 `scope`、`limit`）。存储请求 15 s、复制 5 s 没回复 = `unavailable`；提交不超时（等主人）。
  示例页：`modules/artifacts/mockPages/decide-0.2.html`（自动保存 + 发给智能体；预览里是 demo-writer 的 `reviews/decide-0.2.html`）。
- 浏览器预览没有原生对话框：`dev/mockFrames.ts` 画一个标明「预览替身」的确认框，存储放在预览页的 localStorage，限额同 main。
- 测试：`test/pageBridge.test.ts`（schema、绑定、不确认不发、限流、无收件人、复制）、`test/pageStorage.test.ts`（隔离、5 MiB、合计、
  不驱逐、清除）、`test/pageBroker.test.ts`（来源 / origin、手势、并发上限）、`packages/opaque-frame/test/frame.test.ts`（页面 API、CSP 不变）。

导入边界（`packages/plugin-host/test/package-boundaries.test.ts`）：`plugin-sandbox` 仍只由 `modules/plugins/` 与 `main/plugins.ts`
导入；`opaque-frame` 只由 `plugin-sandbox`、`main/index.ts` / `main/plugins.ts` / `main/frames.ts` 与
`modules/artifacts/PageFrame.tsx` 导入，另有 `components/FilePageFrame.tsx`（2026-10-24：文件预览里的 HTML 文件——main 从该主机读字节，
同一个离线文档、同一个 CSP 和 `sandbox="allow-scripts"`，**没有**三个页面通道；只用文件里自带的内容，旁边的文件不加载）。浏览器预览（无 Electron）由 `vite.preview.config.ts` 的 `mock-frames` 插件扮演 main 的
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
| registerLayout（可摆放的视图区） | v1.17 `pane.kind` + 窗格布局（§24）：两层列 / 行，限额固定（≤ 6 个、每列 ≤ 3 个），不是任意平铺树 | 无自由浮动、无多窗口（弹出是第 6 步） |
| registerCommand / registerEntry | `command`（`keybinding`、`composer.slash` 引用）/ `nav.primary` | 徽标 hook、`unavailable: "disable"` |
| registerSurface | 不做，外壳固定 | — |
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
- 2026-10-18 v1.16（§23，`feat/module-packs`）：`MODULE_API_VERSION` 1.15 → 1.16。SDK 加 `packs.ts`：`ModulePackEntry`（包入口的导出：
  `moduleApi`、`module`、`messages`）、`ModulePackHost` / `MODULE_PACK_HOST_GLOBAL`（宿主对象）、`moduleApiSatisfies` / `moduleApiVerdict`
  （semver 范围对 `MODULE_API_VERSION` 求值）。插槽、`ModuleDefinition`、引擎都不变（`SLOT_SPECS` 快照不动）；包经 §15 的动态登记进入同一个宿主。
  声明快照 `module-api-1.16.d.ts`；测试：`test/modulePacks*.test.ts`（索引 / 签名 / 哈希 / 篡改 / 错误密钥 / 降级 / 中断解包 / 范围、协议、加载与回退、
  构建 → 签名 → 本机服务 → 下载 → 加载的端到端）、`packages/plugin-sdk/test/packs.test.ts`，`test/moduleSdkContract.test.ts` 有 v1.16 编译探针（`ModulePackEntry`）。
- 2026-10-20 v1.17（§24，窗格第 3 步）：`MODULE_API_VERSION` 1.16 → 1.17，只加不删。app 层：新插槽 `pane.kind`（`PaneKindItem`、`PaneKindBinding`、
  `PaneTitle`）、`ModuleServices.panes.open`（`PaneOpenOptions`、`PaneOpenResult`）；`SLOT_SPECS["pane.kind"] = { unavailable: "hide" }`。
  外壳：右栏的页变成工具列（全部同时显示，去掉页按钮 `SideLane` / `SideTabStrip`、设置「右栏布局 / 页按钮位置 / 右栏收起时 / 点击当前页图标」），
  卡片变成窗格（每列 ≤ 3 个、全部 ≤ 4 个，满了进最下面窗格做标签，可以混种类），最多 2 个工具列；放置规则（§18.6）的「otherwise 新页」
  改成「最右一列」；§18.5 每 agent 一份视图废止；`conversation.agent` 不再是右侧组件（并进 `core.conversation`，`services.side.open` 照旧
  接受它的 id）；页面在聚焦的对话窗格里打开（`MainView` 仍在，现在是聚焦窗格的页面）；布局存 `cutex-desktop.panes`，`cutex-desktop.side`
  一次性迁移（§24.7）。插槽 `side.component` / `main.page`、`services.side`、`ModuleDefinition`、引擎都不变。声明快照 `module-api-1.17.d.ts`
  （SDK 中立类型只有版本常量变化）；`test/moduleSdkContract.test.ts` 有 `pane.kind` / `services.panes` 正反例并钉住 `SLOT_SPECS`，
  `test/modules.test.ts` 钉住插槽快照与派生种类表；`test/sideLayout.test.ts` / `test/sideDrop.test.ts` 按 §24 改写（场景编号不变，见 §24.9），
  `test/panesStep3.test.ts`（工具区 JSON、页面窗格、迁移）、`test/panesStep2Store.test.ts`（页面跟着聚焦窗格）、`test/sideAgentViews.test.ts`（全局一份）。
- 2026-10-20 v1.18（§25，窗格第 5 步）：`MODULE_API_VERSION` 1.17 → 1.18，只加不删。app 层：新插槽 `pane.desktop`（`PaneDesktopItem`、
  `PaneDesktopProps`），`SLOT_SPECS["pane.desktop"] = { unavailable: "hide" }`；`NavItem` 加可选 `lead`、`useShown`、`useActive`。外壳：
  `PaneHost` 在单个空对话窗格的位置画桌面（`lib/paneDesk.ts` `desktopReason`）；`SidebarNav` 先画 `lead` 条目；`lib/paneActions.ts`
  `revealDesktop()`（侧栏「桌面」）；`lib/agentToasts.ts` 卡片可带 `ref`（显示 `ref.action` 图标按钮），`lib/services.ts` 服务行菜单加
  `ref.action`。内置模块 `home`：`pane.desktop`、`pane.kind` `home.profile`（第一个直接贡献的窗格种类）、`nav.primary` `home.nav`（lead）、
  `ref.action` `home.pin`。声明快照 `module-api-1.18.d.ts`（只有版本常量）；`test/moduleSdkContract.test.ts` 有 `pane.desktop` / `lead`
  正反例并钉住 `SLOT_SPECS`；`test/modules.test.ts` 钉住 `pane.kind` / `pane.desktop` / lead 条目快照，`lib/paneDesk.ts`、`SidebarNav.tsx`、
  `lib/navEntries.ts` 进外壳扫描；`test/homeDesktop.test.ts`（显示规则）、`test/homeStore.test.ts`、`test/homeStats.test.ts`、
  `test/homeTile.test.ts`、`test/homeModel.test.ts`。
- 2026-10-20 Shelf（§24.12，契约不升，仍是 v1.18）：工具区 → 会话两侧的 Shelf（≤ 2，每边一个），每个有 Shelf Rail（≤ 9 页、Alt+1…9、
  ＋、右键重命名 / 换图标 / 上移 / 下移 / 删除，可撤销）和 ⋯（允许混排、Rail 外侧 / 内侧、收起成小片、移到另一边、关闭，可撤销）；新 Shelf 不允许
  混排，迁来的右 Shelf 允许。拖放：页按钮（停 0.4 s 切页）、＋、空着的边缘新建 Shelf；窗格左右缘不再新开列。布局 v2（`shelves`），v1 的工具列
  和第 3 步备份的旧页迁成右 Shelf 的页。术语加 `shelf`。模块看到的仍是页 id，插槽与服务不变，所以不升版本、快照不变。
- 2026-10-20 Shelf 主人决定（§24.12，契约不变）：每个 Shelf 缺省**不允许混排**，迁来的右 Shelf 也是（存储文件 v2 → v3 一次性把已存的
  允许混排关掉，已经混放的窗格不动）；布局选项**只用一个 {{shelf}}**（单一 Shelf 模式：不再新建第二个，边缘拖放进现有 Shelf 的新页，
  移到另一边照旧），新安装缺省开、已有用户关；在 Shelf 的 ⋯ 和设置 → 右侧栏与留白里切换。
- 2026-10-21 Shelf 收起到 Rail（主人决定，§24.12，契约不变）：收起的 Shelf 不再进底部托盘，而是原地只剩它的 Shelf Rail（40 px 的竖条，在
  Shelf 的外侧），页图标和角标照旧；点一页 = 展开到那一页，再点正在显示的页 / 焦点在 Shelf 里按 Esc / Rail 底部的收起按钮 = 收起（2026-10-22 起再点正在显示的页什么都不做，§24.12.3）。⋯ 里的
  「收起成小片」改成「收起」；存储文件 v3 → v4 把已存的托盘里的 Shelf（`chip`）迁成收起（`collapsed`）。宽度平滑过渡（遵守减少动态效果）。
- 2026-10-21 v1.19（§26，顶栏拆分，主人选 A）：`MODULE_API_VERSION` 1.18 → 1.19，只加不删。app 层：新插槽 `window.search`
  （`WindowSearchItem`：`placeholderKey`、可选 `keys()`、`open()`），`SLOT_SPECS["window.search"] = { unavailable: "hide" }`；内置模块
  `quick-switch` 贡献 `quick-switch.search`（点 = 打开 ⌘K 快速切换）。外壳：窗口顶栏（`components/TitleBar.tsx`）只留整个窗口的东西，
  对话相关的都进每个会话自己的两行顶栏（`components/ConversationHeader.tsx`，`lib/convHeader.ts`）。声明快照 `module-api-1.19.d.ts`
  （只有版本常量）；`test/moduleSdkContract.test.ts` 有 `window.search` 正反例并钉住 `SLOT_SPECS`；`test/modules.test.ts` 钉住
  `window.search` 快照、`TitleBar.tsx` 进外壳扫描；`test/convHeader.test.tsx`（每个窗格的顶栏项、窄时收进 ⋯ 的顺序、窗口顶栏内容）。
- 2026-10-23（§19.8，设计 040 跟进，`fix/0.2-conv-followups`）：`RefActionItem` 加可选 `inline`（消息悬停浮条上总是图标；书签模块用它）。
  只是 app 层插槽的可选字段，SDK / 引擎类型不变，旧条目照常工作（不写 = 进「⋯」），所以 `MODULE_API_VERSION` 不升、快照不动。
- 2026-10-23（侧栏 v5，设计 040 §4.1，`feat/0.2-sidebar-v5`）：`nav.primary` 的顶部入口从侧栏搬到顶栏（主机选择器右边：分割线 + 平铺图标 + `CountBadge`，「⋯ 更多」= 原来的更多菜单；窄窗口只留第一个，其余收进一个带总数的 ⋯）。
  `NavItem` 加可选 `menu`（右键菜单：快速启动的 profile 列表，新建智能体也用它），`Menu` 不再画。只是 app 层插槽的可选字段，旧条目照常工作，所以 `MODULE_API_VERSION` 不升、快照不动。
- 2026-10-21 v1.20（§25.3，托盘，原则 §7）：`MODULE_API_VERSION` 1.19 → 1.20，只加不删。`PaneDesktopItem` 加 `Dock?` / `useDockCount?`，
  `PaneDesktopProps.reason` 多 `"covered"`、加 `tray?`，新类型 `PaneDockProps`。桌面成为整个工作区的底层，托盘是浮在桌面底部的程序坞
  （快捷方式 + 收起的工具窗格）。声明快照 `module-api-1.20.d.ts`（只有版本常量）。
- 2026-10-21 工作区（§24.13，契约不变）：工作区 = 对话 + 它自己的 Shelf，屏幕上 1–2 个；Shelf 按对话记（共享页「在所有对话中显示」、
  默认布局），存储文件 v4 → v5；投影 / 并排 / 替换三种同时看两个对话；侧栏、窄栏、⌘K、托盘共用的拖放规则；对话窗格的「—」= 关闭窗格，
  不再有对话小片。投影是 `conversation` 模块的 `side.component`，没有新插槽或服务。
- 2026-10-24 v1.25（§18.2，空 Shelf 启动器）：`MODULE_API_VERSION` 1.24 → 1.25，只加不删：app 层 `SideLauncher.category?: "content" | "tool"`。
  内容／工具分类只影响展示，不改变绑定、门控、参数或打开行为；省略字段的旧模块继续工作。没有新增插槽，app 的 slot 默认值快照不变；SDK 声明快照 `module-api-1.25.d.ts` 只有版本常量变化。
- 2026-10-24 v1.24（§27，设计 032 §13）：`MODULE_API_VERSION` 1.23 → 1.24，只加不删：`WIDGET_UNIT` / `WIDGET_MIN_UNITS`、`WidgetUnits`、
  `WidgetUnitSizes`、`size.units?`、`WidgetInstanceRef.units?`、`DesktopWidgetProps.units`、`unitsOfSteps` / `unitSizesOf`；`HomeDoc.desk.units`
  （每档的单位摆放；`cells` 和 `bands` 不再写，留作备份）。声明快照 `module-api-1.24.d.ts`。
- 2026-10-24 v1.23（§27，设计 032 §12，主人：一格 96 px）：`MODULE_API_VERSION` 1.22 → 1.23，只加不删：`WIDGET_CELL` / `WIDGET_GAP`、
  `WidgetCells`、`WidgetCellSizes`、`size.cells?`、`WidgetInstanceRef.cells?`、`DesktopWidgetProps.cells`、`cellsOfSteps` / `cellSizesOf`；
  `HomeDoc.desk.cells`（每档的整格摆放；`bands` 不再写，留作 1.22 的备份）。声明快照 `module-api-1.23.d.ts`（只有版本常量）。
- 2026-10-22 v1.22（§27，设计 032，主人：「平台，而不是产品」；030 v2 的看不见的网格）：`MODULE_API_VERSION` 1.21 → 1.22，只加不删：插槽
  `desktop.widget`（`modules/widgetTypes.ts`：`DesktopWidgetItem` / `DesktopWidgetProps` / `WidgetActions` / `WidgetSource` / 设置表
  `WidgetSettingField`）；`HomeDoc.desk`（cutex 原样保存主页文档里不认识的顶层键，不用改 cutex）。声明快照 `module-api-1.22.d.ts`（只有版本
  常量）；`test/moduleSdkContract.test.ts` 钉住插槽缺省和编译期的条目形状。
- 2026-10-21 v1.21（§24.4、§26.4，主人：页面是自己的面板）：`MODULE_API_VERSION` 1.20 → 1.21，类型不变、`services.ui.openPage` /
  `services.panes.open("page:<id>")` 的落点变了：缺省进聚焦对话的 Shelf，成为自己的窗格（`lib/sideComponents` 把每个不带 `Aside` 的页面
  派生成工具引擎的组件：singleton、绑焦点主机、页组 = 种类 id、`persist: false`，标题 / 图标取打开它的 `nav.primary` 条目）；外观 → 窗口与卡片
  →「页面打开位置」= 占用会话时照旧盖在聚焦的会话上，但带页面自己的顶栏（`components/PageHeader.tsx`）。会话顶栏的页面面包屑和窗口顶栏
  的页面面包屑（全窗口页除外）删掉。声明快照 `module-api-1.21.d.ts`（只有版本常量）；`test/modules.test.ts` 钉住派生的 Shelf 组件表；
  `test/pagesOwnPane.test.tsx`。

## 15. 动态模块登记（v1.1，稳定基线后迁移）

唯一引擎为 `@cutex-desktop/plugin-host`；共享类型来自 `@cutex-desktop/plugin-sdk`，`MODULE_API_VERSION = "1.25"`（v1.2 – v1.4、v1.6 – v1.14、v1.17、v1.18 只改 app 层插槽，见 §16 – §22、§24、§25、§18.3、§18.13、§18.14、§19.3、§19.6；
SDK / 引擎的类型除版本常量外不变；v1.5 加多主机输入与 `ctx.hosts`，见 §4、§6；v1.15 加 `ModuleRequires.component`，引擎不看它，见 §12.1；v1.16 加模块包入口 / 宿主对象类型和 `moduleApi` 范围求值，见 §23）。
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

> **v1.17 起被 §24 取代的部分**（窗格）：右侧区是工作区右边的**工具列**。页 = 工具列（≤ 2 列，**全部同时在屏幕上**，没有页按钮 /
> 页标签条 / 多页切换，§18.3 的页按钮、页操作、「右栏布局」等设置作废）；卡片 = 窗格（每列 ≤ 3 个、全部 ≤ 4 个，再多 = 最下面窗格的标签，
> 可以混种类，§18.4「同种组件在一页里只有一张卡片 / 永不混放」作废）；放置（§18.6）的「otherwise: 新页」改为最右一列，满了见 §24.5；
> §18.5 的每 agent 一份视图**废止**；持久化（§18.11）改存 `cutex-desktop.panes` 的工具区（§24.6）。其余照旧有效：条目类型与 Body 参数
> （§18.2）、绑定与可见性规则（§18.5 表格）、覆盖与菜单（§18.7，「页」读作「列」）、打开服务（§18.8）、状态分类（§18.9）、实例层（§18.10）、
> 保持挂载与后台持有（§18.13、§18.14）。

规范来源：RFC `docs/research/right-panel-rfc-20261009.md` §3–§5（设计理由、例子、风险都在那里）；本节是约定的摘要，
改格式先改本节。P0 实现：`feat/side-p0`。

### 18.1 术语、结构与外壳文件

| 层 | 代码 | 是什么 |
|---|---|---|
| 右侧区 | `components/side/SideArea.tsx` | 右栏（显示当前页；≥2 页时页按钮按「右栏布局」：★左边一道竖向页按钮，或顶部一行页标签）；右栏收起时可留一道 44 px 竖向页按钮；右栏宽 = `appearance.sidePaneWidth` |
| 页按钮 | `SideLane.tsx`（竖向细栏：★竖条 + 标签页时右栏打开也在，顶部带页操作；右栏收起时）、`SideTabStrip.tsx`（仅标签页时右栏打开：顶部横向页标签条 + 页操作）、`lib/sidePills.ts` | 一页一颗药丸（§18.3） |
| 页 | `SidePage` | 上下排列的卡片，带页组 `groups` 与可选名字；每 Shelf 保护上限 50 页 |
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
  `minHeight`（缺省 120）、`launcher?: { order, pin?, category?, params(), newParams?() }`（标题栏启动栏 / ＋ 菜单 / 启动页里出现；`params()` 返回 null = 现在不能开；
  v1.11 `pin`：`"default"` = 缺省固定在标题栏（主人可取消），`"never"` = 只在 ＋ 菜单，省略 = 主人固定前不在标题栏；v1.11 `newParams`：
  `multi` 组件「新开一个」的参数（Ctrl/⌘ / 中键单击、「新…」），省略 = `params()`；v1.25 `category?: "content" | "tool"`：
  空 Shelf 的内容／工具分组（仅展示；不改变启动或门控，省略按 `tool` 显示））、
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
- 2026-10-18 `SideComponentItem.tabRow?: "always"`（app 层可选字段，SDK / 引擎类型不变，`MODULE_API_VERSION` 不升；主人报「浏览器侧栏没有 tab 和新建 tab」）：只对 `multi` 组件有效——卡片头一个实例时也是标签行，最后一个标签后有 ＋（「新标签页」），打开 `launcher.newParams ?? launcher.params` 作为**这张卡片**的新标签（同页、同当前标签的绑定；先触碰当前标签，所以同页有两张同种卡片时也落到这张）。现在只有 `browser.tab` 声明它；其他组件不变（单实例 = 标题，≥ 2 个才是标签行）。
- 高度 = 比例 `share`；卡片间 8 px 缝可拖（双击均分，方向键调整），折叠卡片只剩头部；放不下时最下面的卡片先折叠。
  「放不下」= 展开的卡片的最小高度之和（加缝和折叠卡片的头部）超过页高（2026-10-27，主人：只有真放不下才折成一行）：比例算出来
  低于最小高度的卡片（缝拖到底、窗口变矮）按最小高度画，差额由其他卡片按比例让出，存的比例不变（页变高后回到原高度）；
  拖缝 / 方向键从画出来的高度开始算。
  折叠的卡片（收起的，或放不下折叠的）旁的缝照样可拖（2026-10-26）：往离开它的方向拉就展开它（至少到最小高度，之后跟着指针），
  双击 = 和相邻卡片均分，方向键朝外一下 = 展开；它的 ▾ 和双击它的标题栏也展开（放得下时回到原比例）。只有被另一张卡片「最大化」
  压成头部的卡片不响应。保留布局 / 共享的页上，模块关闭的卡片不画（不留空洞；比例留着，模块回来就回到原处）。
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

**v1.17 废止**（§24：布局全局一份，主人 2026-10-20）：下面这段「每 agent 一份视图」不再成立——工具列的开 / 关和聚焦的列对所有 agent
都一样，切 agent 不换视图，只按绑定换内容（没有当前 agent 可见内容的列不上屏幕；当前 agent 的最后内容关掉时工具区收起，
`closeIfEmptied` 照旧）；`layout.views` 不再读写，旧存档里的 `views` 只在迁移时用一次（§24.7）。原文留作记录：

~~**每个 agent 一份视图**（D27′）~~：右栏开 / 关和在看的页按 agent 记住（`layout.views[<cutex session id>] = { open, page, at }`，
没有选中 agent 时键 `∅`），切 agent = 存下旧的、换上新的；最大化 / 全屏也按 agent，只在内存。没有记录的新 agent = 收起；
恢复时它在这里已经没有内容 = 收起（例外：它自己特意打开的空右栏 / 启动页，记成 `page: null`，仍打开）；在当前 agent 上关掉它最后的
内容 = 它的右栏收起；再打开任何东西 = 重新打开。启动页（空页）属于打开它的 agent，切走时丢掉。全窗口 / 普通页面（设置等）不改选中
agent，所以保持上一个 agent 的视图。卡片 ×、关闭页只关当前 agent 看得见的实例（别的 agent 的留着）。

v1.5：每种绑定都带 `hostId`（多主机下每个实例都属于一台主机，「某台主机换代只卸载那台主机的实例」按它判断）。存档里没有 `hostId`
的 `follow`（v1.4 写的）读取时补成布局所属主机（`sanitizeLayout(raw, hostId)`；`layouts["host:<id>"]` 的 id），只往前迁，不保留旧格式。

### 18.6 放置（`lib/sideLayout.ts` `place()`，纯函数）

> 以下是最初声明语义；主人 2026-11-03 的默认开页规则覆盖该顺序，见 §24.12.2。`prefer`、覆盖和 `otherwise` 仅用于保护上限的退路；显式 page 仍是用户指定布局。

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
| `agents` | `conversation.agent`（另一个 agent 的实时对话，核心、不受门控；2026-10-18，`feat/side-agent-view`，`docs/research/side-agent-view-20261018.md`） |

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

- 2026-10-18（`feat/side-agent-view`，主人：想在右栏同时看两个 agent；设计记录 `docs/research/side-agent-view-20261018.md`）：核心组件
  `conversation.agent`（`multi`，`host` 绑定，dedupeKey = session id，`keepAlive: "hidden"`，页组 `agents`）：另一个 agent 的时间线（行操作留在主区）、
  状态行、待回答的审批 / 提问（不抢焦点）、「接下来」与一个简单输入框（Enter 发送：运行中插入，不能插入的 agent 排队；停止）；头部「在主区打开」= 与主区的
  agent 互换。主区选中的正是它时，标签显示「已在主区打开 · 换回」。入口：agent 菜单「在侧边打开」（`conversation.openAgentSide`，`agent` 引用的
  `ref.action`）、侧栏 agent 行 Ctrl/⌘ 单击 / 中键单击 / Ctrl/⌘+Enter（`lib/sideOpen.ts` `openAgentSide`；别的主机的 agent 在主区打开）。store 从「只订阅选中的
  agent」改为 N 条会话流（`retainSideAgent` / `setSideAgentVisible`，`sideAgents`）；可见的侧边 agent 算「在看」（通知、回合结束标记）。不改契约，`MODULE_API_VERSION` 不变。
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
  没有这样的回复（进行中、无回复）就在这一轮最后一行之后；宽 = 阅读列宽 − 48，按 8 px 向下取整（拖窗口时不必每一步都重画）。`TurnAttachmentProps.where` / `width` 告诉条目是哪种。
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
  图标 / 标题是拖动手柄（§18.7）：拖到药丸或列 = 钉进那页，拖到「新页」落点 = 钉进新页（到 50 页保护上限时按放置规则）；
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
  它产生的是 `turn` 引用。已有 `toRef` / `fromRef` 的：`workspace.preview`、`diff.view`、`terminal.pty`（key `pty:<id>`）、`artifacts.view`（key = 成果引用 `af-…@3` / `af-…@latest`，v1.7）、`delegations.detail`（key = ask id；模块种类 `delegation` 也打开它，2026-10-13）。服务模块的种类 `service`（key = `<slug>` 或 `<slug>/<路径>`，没有组件；`cutex:service/…` 链接在右侧内置浏览器标签里打开服务、保留路径，浏览器模块关着时退回系统浏览器，2026-10-17）。`subagents.thread` 不加（`fromRef` 带不回父 agent 的绑定，延后）。

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
| 消息悬停浮条（设计 040 第 10 步，2026-10-23）：标了 `inline` 的条目（书签）和 `useState().active` 正亮着的条目是图标（`RefActionButtons hoverBar`，复制 · 分叉 / 编辑并重发之后、「⋯」之前），其余在浮条的「⋯」里（`refActionEntries(ref, lead, skipInline)`）；消息右键菜单列全部 | `turn`（主人消息与回复；只读时间线没有） |
| 侧栏 agent 右键菜单 | `agent` |
| 右侧标签右键菜单、卡片 ⋯ / 类别图标菜单（当前显示的标签） | 组件 `toRef` 的结果（不可引用的组件没有） |
| 右侧页菜单 | `side.page`（启动页没有） |
| 模块页面标题（面包屑）右键 | `main.page`（页面有 `refParams` 时） |

- `useState(ref)` 只影响显示：菜单行（`MenuAction.labelNode`：另一个标题、✓、`disabledReason` 变灰）、图标按钮（`active` = 实心图标，另一个标题作提示，`disabledReason` = 禁用并作提示；批注：这一轮已有批注时实心）；`run` 要自己再判断一次。
- `run` 抛错 → 一行错误通知。宿主未启动时（测试、启动早期）没有条目。
- `submenu(ref)`（可选，v1.26）：菜单行显示 › 并复用正常子菜单；数组可同步给出，也可在展开时异步解析。子项仍走相同的 `available`／确认／武装确认；引用自己的主机和版本由提供者固定，不能回退到当前主机或最新版本。图标按钮仍调用 `run`。
- 服务行的引用动作延后：P2 之前没有服务的引用种类。
- `inline`（可选，2026-10-23，设计 040 跟进；主人：书签要一直在浮条上）：条目在消息悬停浮条上总是一个图标，不进浮条的「⋯」。没有它 = 在「⋯」里，只在 `active` 时也显示成图标。只影响悬停浮条，菜单照旧。宿主不点名模块。
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
| 5b | v1.21：聚焦的会话盖着页面（「页面打开位置」= 占用会话，§24.4）、焦点不在可编辑处、不在右侧 | 关掉页面，露出对话（代码里的 `close-page`，排在 Shelf / 设置 Shelf 的行之后） |
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

## 23. 可下载的第一方模块包（v1.16）

主人 2026-10-18：可选的第一方桌面模块要能在 app 里下载，做成签名的模块包（「长痛不如短痛」，直接做真的，不做过渡方案）。
lead 定的边界：包是**第一方、可信**的 renderer 代码，信任等于 app 自己的打包；只接受发布密钥签名的包；第三方代码仍然只在
不透明 frame 里（§10），本功能从不加载未签名或第三方代码；不另起模块引擎，经 §15 的动态登记进入同一个宿主。

### 23.1 来源：内置 / 包 / 内置 + 更新的包

- 一个模块的代码来源三选一：**内置**（`registry.ts`，随 app 构建，今天所有模块）、**包**（只有下载的包，app 不带）、
  **内置 + 更新的包**（app 带一份，下载的包更新时覆盖它）。
- 能做成包的模块在目录里放 `modules/<id>/pack.json`：`{ "version": "1.0.0", "moduleApi": "^1.16" }`（版本 = 这份源码的版本，
  `M.m.p`，没有预发布后缀）。内置时这个版本就是「内置版本」（renderer 用 `import.meta.glob("./*/pack.json")` 读，`modules/packVersions.ts`）。
- 生效规则（renderer，`modules/packs.ts` 纯函数 `packDecision`）：已安装、校验通过、`moduleApi` 兼容、宿主导入齐全（§23.6）、
  且**版本严格大于内置版本**（没有内置 = 任何版本）的包生效；否则用内置。包加载 / 激活失败 → 本次运行退回内置，设置里显示原因。
- 第一版：所有现有模块照旧内置。试点 = `claude-science`（默认关闭；跨目录导入最少：不被别的模块引用，只用 `lib/` / 共享组件 /
  `store` / `bridge`），同时构建成包，用来证明覆盖路径端到端可用。`nci` 落选：`jobs` 按它是否启用显示 NCI 部分，耦合更多。
- 不做：自动下载（v1 只有主人点「下载 / 更新」才下载；检查索引可以自动）、模块市场、第三方包、包之间的依赖解析（包的
  `requires.modules` 照常按 §6 处理，缺依赖就是 `unavailable`）。

### 23.2 包格式

一个包 = 一个版本 = 一个 `.tar.gz`（资产名 `<id>-<version>.tar.gz`），解开后：

```
index.js        入口，单个 ES 模块（构建时内联所有动态导入，没有懒加载 chunk）
index.css       可选：包自己的样式（§23.8）
pack.json       包清单：{ id, version, moduleApi, entry, styles, host }（与索引里这一项相同的字段，便于离线检查）
```

- tar 只允许普通文件（ustar typeflag `0` / `\0`），路径 `^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)*$`，不以 `.` 开头
  （`.signed/` 留给 main），没有 `..`、绝对路径、链接、设备、目录项以外的东西；成员集合必须与索引的 `files` **完全相同**（不多不少、
  不重复），大小与 sha256 都对上。上限：每包 ≤ 64 个文件、单文件 ≤ 4 MiB、解开总计 ≤ 16 MiB、压缩包 ≤ 16 MiB。
- 入口导出（类型 `ModulePackEntry`，SDK `packs.ts`）：

```ts
export const moduleApi: string;                      // 与索引、pack.json 相同的范围，renderer 再核对一次
export const module: ModuleDefinition;               // id = 包 id；不得 required、不得用 external- 前缀
export const messages: Record<string, Record<string, string>>; // 语言 → { "<id>.<key>": 文案 }，只许本模块前缀
```

- 包不带自己的 React / zustand / app 代码：这些经宿主对象共享（§23.6）。`lucide-react` 图标、`shared/` 与 `@cutex-desktop/*`
  的纯函数包打进包里（无状态，重复一份无害）。

### 23.3 签名索引 `modules.json`

发布渠道 = 公开桌面仓库（`senxiu-official/cutex-desktop`）的 GitHub release **`modules-release`**（对应 cutex 的 `channel-release`）：
资产 `modules.json`、`modules.json.minisig` 和各包的 `.tar.gz`。地址
`https://github.com/<owner>/<repo>/releases/download/modules-release/modules.json`；`<owner>/<repo>` 取自安装包记录的
`releasePage`（同二进制更新），没有记录（开发运行、源码安装）时用 `senxiu-official/cutex-desktop`。

```jsonc
{
  "schema": 1,
  "serial": 1760745600,               // 单调递增（生成时的 Unix 秒，且 > 上一份已发布的）；main 记住见过的最大值，更小的索引拒绝
  "generatedAt": "2026-10-18T00:00:00Z",
  "packs": [                          // 同一 id 可以有多个版本（主人可以明确选旧版）
    {
      "id": "claude-science", "version": "1.0.0", "moduleApi": "^1.16",
      "title": { "en": "Claude Science", "zh-CN": "Claude Science" },     // 可选：没内置的模块在设置里显示用
      "description": { "en": "…", "zh-CN": "…" },                         // 可选
      "entry": "index.js", "styles": [],
      "host": { "react": ["useState"], "@cutex-desktop/app/store": ["useApp"] },  // 宿主导入清单（§23.6）
      "files": [{ "path": "index.js", "size": 12345, "sha256": "…" }, { "path": "pack.json", "size": 321, "sha256": "…" }],
      "archive": { "name": "claude-science-1.0.0.tar.gz", "url": "https://github.com/…/modules-release/claude-science-1.0.0.tar.gz", "size": 6789, "sha256": "…" }
    }
  ]
}
```

- 签名：minisign（预哈希 `ED`），trusted comment 的 `file:` 必须是 `modules.json`（`main/minisign.ts` `verifyData(…, "modules.json")`），
  所以别的签名文件不能顶替索引。索引 ≤ 1 MiB、≤ 256 项。
- 信任的公钥：内置的发布密钥（`docs/install/cutex-release.pub` 与备用 `cutex-release-spare.pub`，`RELEASE_PUBLIC_KEYS`，同二进制更新与
  cutex 后端更新）。**测试密钥**（`shared/modulePacks.ts` `MODULE_PACK_TEST_PUBLIC_KEY`，私钥由公开的种子推出，任何人都能签）只在
  `!app.isPackaged`（开发运行、测试）时加入；打包后的 app 从不信任它，测试检查这一点。
- 包的 `url` 只能是 GitHub 下载主机（`DOWNLOAD_HOSTS`，同二进制更新：https、无端口、无凭据，跳转逐跳检查）；开发运行可用
  `CUTEX_DESKTOP_MODULES_INDEX=http://127.0.0.1:<port>/modules.json` 指向本机假服务（只在 `!app.isPackaged` 生效，并只放行这个源）。

### 23.4 main：检查、下载、校验、存储

`main/modulePacks.ts`（`ModulePackService`；网络 = 更新器的 `Transport`，即 `cutex-updater` 会话 + Settings → 网络代理，
插件封网后改走 Node，同 `updateNet.ts`）。

- **检查**（`check`）：下载 `modules.json` 与 `.minisig`（各有上限、超时），验签，解析并逐字段校验（`shared/modulePacks.ts`
  `parseModuleIndex`，任何一项不合格 = 整份拒绝），`serial` 不得小于见过的最大值。结果只在内存（加 `checkedAt`），不落盘；
  见过的最大 `serial` 记在 `state.json`。设置页打开时检查一次，之后主人点「检查」。
- **安装**（`install(id, version?, { allowOlder })`）：`version` 省略 = 索引里兼容的最高版本。步骤（进度事件 `download` → `verify` → `unpack`）：
  1. 下载压缩包到 `userData/modules/.download-<id>-<version>-<pid>`（`binaryUpdate.ts` 的 `download`：宣布的大小、上限、停滞超时、跳转检查）；
  2. 压缩包 sha256 = 索引；gunzip（上限）+ 严格 tar 解析（§23.2）+ 每个文件大小 / sha256 = 索引；
  3. 写进 `userData/modules/.staging-<id>-<version>-<pid>-<rand>/`，另写 `.signed/modules.json` 和 `.signed/modules.json.minisig`
     （**验过签的原始字节**），然后 `rename` 成 `userData/modules/<id>/<version>/`（同卷原子）；同版本重装先把旧目录挪开再换；
  4. 写 `state.json`（临时文件 + `rename`）：`active[id] = version`；最后删掉这个 id 的其他版本目录。
  任何一步失败：删掉下载 / staging，已有安装不变。同一时间只做一个操作（再来一个 → `busy`）。
- **降级**：目标版本低于当前已安装版本时拒绝（`downgrade_refused`），除非主人在设置里明确选了那个旧版本（`allowOlder: true`）。
  索引里看到更低的版本不会自动做任何事。
- **移除**（`remove(id)`）：删 `userData/modules/<id>/`、去掉 `active[id]`；有内置的模块退回内置。只删本 app 自己的缓存目录。
- **启动复验**：每次运行第一次 `list` 时，对每个 `<id>/<version>/`：用内置公钥重新验 `.signed/` 里的签名、在那份索引里找到 `id + version`、
  目录内容（除 `.signed/`）与 `files` 完全相同、每个文件 sha256 一致；通过的才进入「已校验」表，失败的列为 `broken`（原因 + 「移除」）。
  当前版本 = `state.json` 的 `active[id]`（存在且通过）否则通过的最高版本；其他版本目录删掉。残留的 `.download-*` / `.staging-*` 启动时删掉
  （中断的解包不会留下半个包：没 `rename` 的都在 staging）。
- **送文件时再查一次**：协议每次读文件都重算 sha256 与已校验表对比，不一致 → 404 并把这个包标成 `broken`（运行中被改也拦得住）。

### 23.5 协议与 CSP

- 特权 scheme `cutex-module`（`standard`、`secure`、`corsEnabled`；**不带** `supportFetchAPI`、`bypassCSP`），URL
  `cutex-module://pack/<id>/<version>/<path>`。main 的 `protocol.handle` 只送「已校验」表里的文件（`text/javascript` / `text/css`，
  `nosniff`、`no-store`、`Access-Control-Allow-Origin: *`——跨源模块脚本要 CORS；内容是公开的第一方代码）；其余一律 404。
- `session.defaultSession.webRequest.onBeforeRequest` 对 `cutex-module://*/*` 只放行**主窗口主 frame**、`resourceType` 为 `script` /
  `stylesheet` 的请求；插件 / agent 页面 frame（同一 webContents 的子 frame）、其他窗口、worker、`fetch` 全部取消。不透明 frame 的 CSP
  本来也不允许这个 scheme。Electron 每个 session 只保留**一个** `onBeforeRequest` 监听（后一次调用顶掉前一次），所以 `cutex-module` 与
  `cutex-plugin` 共用一个监听（过滤器列两个 scheme，按 scheme 分支；包的判断是 `main/modulePacks.ts` `modulePackRequestAllowed`），
  测试守住 default session 只注册一次。Electron 44.5.1 实测（Linux，xvfb，2026-10-18）：主 frame 的 `import()` 经过它放行，页面里的
  `fetch(cutex-module://…)` 被拒。
- 父页面 CSP（`renderer/index.html`）只加这个 scheme：`script-src 'self' cutex-module:`、`style-src 'self' 'unsafe-inline' cutex-module:`。
  `connect-src`、`frame-src` 不变。
- IPC（`shared/modulePacks.ts`，频道 `cutex-desktop:module-packs`，preload `bridge.modulePacks`，只收主窗口）：
  `state()`、`check()`、`install({ id, version?, allowOlder? })`、`remove({ id })`，都返回 `ModulePacksView`；事件 `modulePacks`
  推同一个视图（进度）。参数逐字段校验；renderer 拿不到路径、密钥、下载地址以外的任何东西，也不能让 main 读任意文件。

### 23.6 renderer：宿主对象、加载、覆盖与回退

- **宿主对象**（import map 式垫片）：`globalThis.__CUTEX_MODULE_HOST__ = { apiVersion, get(specifier) }`（常量
  `MODULE_PACK_HOST_GLOBAL`，类型 `ModulePackHost`，SDK）。表在 `modules/packHost.ts`，静态 `import * as`：
  - `react`、`react/jsx-runtime`、`react-dom`、`zustand`；
  - `@cutex-desktop/app/<路径>` = `src/renderer/src/<路径>`（去掉扩展名），只列包可以用的文件（试点用到的 `store`、`bridge`、`i18n`、
    `modules/slots`、`modules/react`、`lib/…`、`components/…`）。不列 `dev/`、`registry.ts`、别的模块目录。
  包构建时这些导入变成对宿主对象的属性读取（rollup `syntheticNamedExports`），产物里没有裸导入；每个用到的说明符和名字记进
  `host` 清单。
- **宿主导入检查**：加载前 renderer 对清单逐项检查——说明符在表里、每个名字在那个命名空间上（`default` / `*` 同理）。缺 → 不加载，
  判「需要更新 app」。这是比 `moduleApi` 更细的兼容检查：`@cutex-desktop/app/*` 是 app 内部文件，会改名；改了不升
  `MODULE_API_VERSION`，靠这个检查拦住，再加上加载失败退回内置。
- **加载**（`modules/packs.ts` `startModulePacks(host, bundled)`，`main.tsx` 在 `startAppModules` 之后调用，不挡首屏）：取 `state()`；
  对每个生效的包（§23.1）：装上宿主对象、插入样式 `<link>`、`import(entryUrl)`、核对导出（`moduleApi` 与索引相同且兼容、
  `module.id` = 包 id、非 required、非 `external-`、`messages` 只有本模块前缀）、登记文案（`i18n` `registerModuleMessages`，查找顺序：
  包文案 → app 词典 → 包的 en → app 的 en），然后 **`removeModule(id)` → `addModules([包定义])`**（§15；开关、放置、模块 prefs 都按 id 保留）。
  动态登记的模块排在注册表末尾，同 `order` 的条目排序可能变（条目都写了 `order`，实际无影响）。
- **回退**：导入 / 核对失败 → 不动内置；`addModules` 失败或包模块进入 `failed`（激活抛错 / 超时，在加载时或之后主人打开它时）→
  `removeModule(id)` → `addModules([内置定义])`，撤掉包文案，本次运行不再试这个版本。渲染出错（`lastError`）不触发回退。
- **运行中安装 / 更新 / 移除**：设置页操作完成后立即按新视图重做上面的判断：换成新版本的包（新 URL = 新的 ES 模块实例）、或退回内置。
  旧版本已求值的代码留在内存里直到重启（单文件包没有懒加载 chunk，所以删掉旧文件不影响它）。

### 23.7 兼容

- `moduleApi` 是 semver 范围（`^1.16`、`~1.16`、`>=1.16 <2`、`1.16`；空格分隔的比较式为「且」；版本 `M.m[.p]`），对 app 的
  `MODULE_API_VERSION` 求值（SDK `moduleApiSatisfies`）。不满足时：范围的下限高于 app → 「需要更新 app」；否则 → 「需要更新模块」
  （`moduleApiVerdict`）。main（列出可下载版本）和 renderer（加载前）各判一次。
- 契约规则（§14、§15）不变：插槽 / 定义 / 服务的不兼容改动升主版本，增加升次版本；包按自己构建时的 `MODULE_API_VERSION` 写 `^当前`。
- 宿主导入清单见 §23.6。

### 23.8 样式

- 包默认用 app 的样式表（Tailwind 工具类由 app 构建生成）。包里用到 app 没生成的类时，包构建用 Tailwind 只扫描这个模块的源码，
  生成 `index.css`，整份放进 cascade layer `cutex-pack`；app 在 `styles.css` 最前面（Tailwind 的 `@import` 之前）先声明层顺序
  `@layer theme, base, components, cutex-pack, utilities;`，所以包的规则**只补空缺、从不覆盖** app 的工具类（同一元素上 app 已有的类总是赢）。
  主题变量（`--color-*`）来自 app（包的样式以 `@reference` 引用 app 的 `styles.css`，不输出 theme / base）。模块在 `pack.json` 写
  `"styles": true` 才生成（`build.mjs --styles` 可强制）；试点不需要（它的类 app 本来就生成）。

### 23.9 设置 → 模块

- 每个可选（非 required）模块一行，多一段「来源」：`内置`、`内置 v1.0.0`、`已下载 v1.2.0`（生效中）、`已下载 v1.1.0（比内置旧，未使用）`、
  `已下载 v1.2.0 · 需要更新 app / 需要更新模块 / 加载失败，已用内置：<原因>`、`已下载 · 已损坏：<原因>`。
- 操作：`下载`（索引里有这个模块的兼容版本、本机没装）、`更新到 vX`（有比已装 / 内置都新的兼容版本）、`移除`（已装）、`⋯ → 安装旧版本 vY`
  （确认对话框写明是降级）。只在索引里出现、app 没内置的模块也列出（标题 / 说明取索引的 `title` / `description`）。
- 进度与错误同 主机后端更新：步骤行（下载 / 校验 / 解包，当前步骤转圈）、红字错误 + 「重试」（重试 = 原样再发一次：`lastError.retry`
  记着当时选的版本和降级确认；有错误时不再并排显示「下载 / 更新」）。页头一行：索引状态（上次检查时间、
  「检查更新」、检查失败原因；还没有发布 = 「还没有可下载的模块」）。开发运行信任测试密钥时页头标「测试密钥」。

### 23.10 构建与发布

- 包构建：`apps/desktop/scripts/module-packs/build.mjs <id…> | --all --out DIR [--styles]`（vite build，单个 ES 入口，没有 chunk，资源内联；
  esbuild 生产 JSX）→ `DIR/<id>-<version>.tar.gz` + `DIR/<id>-<version>.pack.json`（索引项，`url` 待填；`title` / `description` 取模块
  `i18n.ts` 的 `<id>.title` / `<id>.description` 的 zh-CN 与 en）。tar 内容确定（文件按路径排序、mtime 0、uid / gid 0、gzip mtime 0），
  同一份源码重建得到同样的字节（测试检查）。
  - 宿主表从 `modules/packHost.ts` 读（`import * as` 行 + `PACK_HOST_MODULES`），所以构建和 app 不会对「提供什么」有分歧；导入解析到表里的
    文件 / 包 → 虚拟模块 `host.get(spec)`（rollup `syntheticNamedExports`，`default` 是纯读取，没人导入就不读），编译后（TS / JSX 之后）
    每个模块读的名字记进 `host`（静态导入的上界：被摇掉的名字也算，检查只会更严）。
  - 拒绝：解析到 `src/renderer/src` 里、本模块目录之外、又不在宿主表里的文件（别的模块、`registry.ts`、`dev/`、没列的 app 文件），以及宿主表之外的
    `react*` / `react-dom*` / `zustand*` / `scheduler` 入口（第二份 React 会让 hooks 失效）；`src/shared`、`@cutex-desktop/*` 包、`lucide-react`
    等纯代码打进包。`mock.ts` 不进包。
  - 文案：模块 `i18n.ts` 的 `zhCN` / `en`，加上其他已翻译目录（`i18n/<locale>.ts`，zh-CN / en 以外）里这个模块前缀的条目（纯 JSON 字符串字面量）。
  - 构建后检查：恰好一个 `index.js`、没有 `import` / 动态 `import()`；当前 `MODULE_API_VERSION` 满足 `pack.json` 的范围。
- 索引：`apps/desktop/scripts/module-packs/index.mjs --packs DIR --base-url URL [--previous modules.json] --out modules.json`：合并上一份
  已发布的索引（**调用方先验签**；保留旧版本项及其 URL，所以主人能选旧版），同一 `id + version` 已发布且字节不同 → 停（换版本号）；
  `serial` = max(现在, 上一份 + 1)；写之前用 app 自己的 `parseModuleIndex` 校验（新包的 URL 必须是 GitHub 下载主机，或本机夹具的
  `http://127.0.0.1:<port>`）。`--new-list FILE` = 这次新增、需要上传的压缩包；`--test-sign` 用测试密钥签（本地端到端用）；正式签名只在 CI。
- 本地端到端（`test/modulePacksBuild.test.ts`）：真构建试点 → 测试密钥签名 → 本机 HTTP 夹具 → `ModulePackService` 检查 / 下载 / 校验 /
  入库 → 重启复验 → `cutex-module://` 送文件 → `import` → 真模块宿主经加载器换上包定义；同一份索引在打包 app 的来源下验签失败。
  渲染预览（`vite.preview.config.ts` 插件 `mock-module-packs` + `dev/mockModulePacks.ts`）同样真构建试点并导入。
- CI：公开仓库的 `.github/workflows/modules-release.yml`（`scripts/public-export/projects/cutex-desktop/ci/modules-release.yml`）：
  `workflow_dispatch`，`dry_run` 默认 true。build job 装依赖、构建包；sign job（`environment: release`，只在默认分支）用
  `MINISIGN_SECRET_KEY` / `MINISIGN_PASSWORD`（同 CI-SIGNING.md）跑 `.github/ci/modules-release.sh`：取已发布的 `modules.json` 并用
  `cutex-release.pub` 验签（并要求 trusted comment 的 `file:` = `modules.json`）、生成新索引、签名并验签，然后（非 dry run）先传包
  （release 上已有同名包 → 必须字节相同，从不覆盖）、重新下载比对，最后传 `modules.json` + `.minisig` 并比对 + 验签。没有新包 → 什么都不做。
  `modules-release` 建成**非草稿、`--latest=false`** 的 release：绝不能让它变成 latest（二进制更新器读 `/releases/latest`；上传后脚本检查，
  变成 latest 就失败）。输入 `modules` 留空 = 构建所有带 `pack.json` 的模块：已发布版本必须重建出同样字节，所以只发布某个模块时写它的 id
  （共享代码变了而版本没变的包会让索引生成停下）。导出：`project.json` 把 workflow 与脚本放到 `.github/workflows/` / `.github/ci/`，公钥已在
  `.github/ci/cutex-release.pub`。测试：`scripts/public-export/test_modules_release.py`（假 gh + 临时密钥）。
- 发布第一份 `modules-release` 要主人 / 发布步骤做的事见交付报告；本次不发布任何东西。

### 23.11 失败模式

| 情况 | 结果 |
|---|---|
| 没有网络 / GitHub 404（还没发布）/ 限流 | 检查失败或「还没有可下载的模块」；已装的包照常（离线可用） |
| 索引签名错 / 未知密钥 / `file:` 不对 / 字段不合格 / `serial` 回退 | 整份索引拒绝，显示原因；已装的包不受影响 |
| 压缩包大小 / sha256 不对、tar 有多余或缺少文件、路径越界、链接 | 安装失败，staging 删掉，已有安装不变 |
| 安装中途退出 / 断电 | 下次启动删掉 `.download-*` / `.staging-*`；`rename` 之前旧版本仍是当前版本 |
| 已装的文件被改 / 签名材料被改 | 启动复验失败 → `broken`，用内置；运行中被改 → 协议 404、标 `broken` |
| `moduleApi` 不兼容 / 宿主导入缺 | 不加载，显示「需要更新 app / 模块」，用内置 |
| 导入抛错 / 导出不合格 / 激活失败 | 本次运行退回内置，显示原因 |
| 选了比当前旧的版本 | 不确认就拒绝（`downgrade_refused`） |
| 包版本不比内置新 | 用内置，提示「比内置旧，未使用」，可移除 |

### 23.12 安全论证

- 包代码的权力 = app 自己的 renderer 代码（同一 realm，可用 `bridge`），所以唯一的门是**谁能让代码进来**：只有用内置发布公钥签过的索引
  所列、哈希逐字节一致的文件，经 main 校验、存储、送出；renderer 不能指定路径、URL 或密钥，main 不接受 renderer 给的字节。
- 签名链：发布私钥（CI secret / 主人本机）→ `modules.json`（每个文件的 sha256 与大小）→ 文件。下载通道（GitHub、代理）不可信也无妨。
  索引回放：`serial` 不回退；降级要主人明确选择；更旧的已签名包最多是「主人能选的旧版本」。
- 本地持久化：签名材料随包存放，每次启动重新验签 + 验哈希，运行中送文件再验哈希；能改 userData 的本地进程本来就能改 app 自己，
  不在威胁模型内，但改坏的包不会被送出。
- 隔离不变：外部插件 / agent 页面仍在不透明 frame（§10），它们的 CSP 不允许 `cutex-module:`，main 的 `onBeforeRequest` 也只放行主 frame；
  这个 scheme 不 `bypassCSP`、不支持 `fetch`。测试密钥只在未打包的 app 里有效。
- 第三方代码：本功能不加载任何第三方代码；包构建只从本仓库的模块源码生成，CI 只在默认分支签名。

### 23.13 未决问题（已选默认）

1. 包能不能新增 app 没有的模块（纯「包」来源）？**能**（格式和加载都支持；设置页按索引的标题列出），第一版没有这样的包。
2. 运行中更新要不要提示重启？**不需要**：直接热替换（§23.6），旧代码留在内存直到重启。
3. 宿主表要不要版本化？**不单独版本化**：靠每包的宿主导入清单精确检查 + 加载失败退回内置（§23.6）。
4. 检查频率？**设置 → 模块 打开时一次 + 手动**；不在后台定时检查（v1 不自动下载，没有需要提醒的东西）。
5. 旧版本保留几个？**只留当前一个**；要回旧版本就从索引重新下载（索引保留旧版本项）。
6. 包要不要 minAppVersion？**不要**：`moduleApi` + 宿主导入清单已经能说「需要更新 app」。
7. 内置模块的版本从哪来？**`pack.json`**；没有 `pack.json` 的模块不能被包覆盖（加载时拒绝，避免覆盖不打算做包的模块）。

## 24. 窗格（v1.17）

设计与主人决定：`docs/research/panes-20261019.md`（§1 概念、§2 契约、§4 摆放、§7 第 3、4 行；开头是主人 2026-10-20 的回答：右栏多页去掉；
布局全局一份，窗格分「跟随对话」和「固定」；布局只存本机）。本节是约定；第 4 步（小片托盘、最大化、LRU 限额、`minSize`、拖放分割合并、
键盘，§24.11）已经写进来。契约（`pane.kind`、`services.panes`）第 4 步没有变。**§24.12（Shelf，2026-10-20）取代下面说「工具列」的地方**：
工具列变成 Shelf 的页，一个 Shelf 一次显示一页；§24.3 的布局 JSON 是 v1（工具列 `area: "tools"`），存储现在是 v2（§24.12.5）。

### 24.1 概念与外壳文件

**窗格**：屏幕上的一个矩形，带标题头，可以有多个标签；每个标签是一个**实例** `{ kind, binding, params, state }`。整个窗口是窗格的摆放，
两层：一行**列**，每列竖着分若干**行**（窗格）。列分两个区域：

| 区域 | 列 | 谁管 | 宽度 |
|---|---|---|---|
| 左停靠 | 智能体列表（`core.agents`，`dock: "left"`，不参与平铺） | `Sidebar.tsx` | `sidebarWidth`，Ctrl+B 开合（第 5 步：头像细栏） |
| 工作区 | 对话窗格，≤ 2 列，每列 1 个窗格（第 2 步） | `lib/paneStore.ts`（跟着选中的 agent） | 份额，列之间的分隔条可拖 |
| 工具区 | 工具列（原右栏的页），≤ 2 列，每列 ≤ 3 个窗格（原卡片） | `lib/sideLayout.ts`（纯函数，页 = 列、卡片 = 窗格）+ `lib/sideLayoutStore.ts` | `appearance.sidePaneWidth` = **一个**工具列的宽度，两列在屏幕上时工具区 = 2 × 它（不超过对话留下的地方）；把手拖的是整个工具区；「并排 / 让位 / 悬浮 / 窄窗口抽屉」照 §18.3 |

外壳文件（不点名功能，`test/modules.test.ts` 扫描）：`components/PaneHost.tsx`（工作行）、`components/side/*`（工具列，`SideArea.tsx` 并排画出
每个工具列 = `SidePageView.tsx`）、`lib/paneLayout.ts`（布局模型、JSON 校验、工具区与 JSON 互转）、`lib/paneStore.ts`、`lib/paneFile.ts`
（存储与迁移）、`lib/paneKinds.tsx`（种类表）、`lib/paneServices.ts`（`services.panes`）。实例照旧画在根部固定层
（`SideInstanceLayer`，§18.10）：窗格只放占位，在列之间 / 行之间移动、合并、最大化都只换占位，**实例不重挂载**（终端、浏览器状态都在）。

**跟随 / 固定**：工具窗格的内容按绑定（§18.5 表格）跟着**聚焦的对话**走——文件树、改动、状态分类（`follow`），某 agent 的预览、diff、
侧聊（`agent`：那个 agent 聚焦时可见），工作区终端（`workspace`），主机级的浏览器、成果预览（`host`：固定，对那台主机的所有 agent 都在）。
对话窗格是固定的：每个绑着一个 agent。没有聚焦 agent 可见内容的窗格不上屏幕，整列都没有就整列不上屏幕（形状不变，内容按绑定）。

### 24.2 插槽 `pane.kind`

`modules/slots.ts`：

```ts
type PaneKindBinding = "agent" | "host" | "follow" | "none";
interface PaneTitle extends SideTabInfo { icon?: Icon }                // 标签、小片（第 4 步）、标题栏共用
// SideTabInfo.favicon?（2026-10-23）：标签上的网页图标，只接受内联 data:image/…（渲染层从不去取网址）；标签行像浏览器一样平分宽度、省略号、放不下进「⌄ N」（lib/tabFit.ts），太窄时模块工具条可用 lib/paneHeader 的 compact 收起次要按钮

interface PaneKindItem<S extends Json, P extends Json> extends SessionItemBase {   // 条目 id = 种类 id
  titleKey: MessageKey; icon: Icon;
  instances: "single" | "multi";
  binding: PaneKindBinding;
  parseParams(params: Json): P | null; dedupeKey?(p: P): string;
  init(p: P, previous: S | null): S; restore?(raw: Json, version: number): S | null; stateVersion?: number; persist?: boolean; // state ≤ 4 KiB
  useTitle(props: SideTabProps<S>): PaneTitle;
  Body: ComponentType<SideBodyProps<S>>; Actions?: ComponentType<SideBodyProps<S>>;
  minSize?: { w: number; h: number };   // 缺省 280 × 120
  tile?: boolean;                        // 能进平铺（缺省 true）
  dock?: "left" | null;                  // 只有智能体列表是 "left"
  popOut?: boolean;                      // 能弹出成独立窗口（第 6 步，缺省 false）
  keepAlive?: "unmount" | "hidden"; onClose?; closeConfirm?; toRef?; fromRef?; launcher?: SideLauncher;
}
```

- 是 `SideComponentItem`（§18.2）的超集，字段语义相同；不同的只有 `instances`（`single` = 原 `singleton`）、`binding`（四种模式，代替
  `defaultBinding`：`follow` = 跟着聚焦的对话；`agent` = 绑一个 agent；`host` = 绑主机；`none` = 不绑，页面）和 `useTitle`（= `useTab`）。
- `unavailable: "hide"`：模块停止 → 它的实例休眠（保留、不显示），模块回来自动恢复，同 §18.2。
- 贡献的种类由工具区放置（`lib/paneKinds.tsx` `sideItemOf` 把它当成一个 side 组件交给 §18 的引擎：页组 = 种类 id，没有这个页组的列时进最右一列，
  `binding: "none"` 按焦点主机的 `host` 绑定）。v1.17 还没有模块直接贡献 `pane.kind`。

### 24.3 布局 JSON

```json
{ "v": 1,
  "dock": { "left": { "kind": "core.agents", "mode": "open", "width": 256 } },
  "cols": [ { "w": 0.5, "rows": [ { "pane": "main", "h": 1 } ] },
            { "w": 0.5, "rows": [ { "pane": "c2", "h": 1 } ] },
            { "w": 1, "area": "tools", "id": "p1", "groups": ["workspace"], "rows": [ { "pane": "t-c2", "h": 0.4 }, { "pane": "t-c4", "h": 0.6 } ] } ],
  "panes": { "main": { "tabs": ["main"], "active": "main", "at": 1739 },
             "t-c2": { "tabs": ["t-i1"], "active": "t-i1", "at": 1700, "kind": "workspace.files", "collapsed": false } },
  "instances": { "main": { "kind": "core.conversation", "binding": { "kind": "agent", "hostId": "local", "sessionId": "…" }, "params": {}, "state": null },
                 "t-i1": { "kind": "workspace.files", "binding": { "kind": "follow", "hostId": "local" }, "params": {}, "state": null, "key": "∅", "v": 1, "pinned": false, "at": 1700 } },
  "tools": { "open": true, "focus": "p1", "overrides": {}, "seq": 4 },
  "chips": [], "focus": "main", "max": null }
```

- 工作区的列没有 `area`；工具列 `area: "tools"`，带引擎的页 id、页组、名字；**每个区域的 `w` 各自合计为 1**（工具区的像素宽度是
  屏幕上的工具列数 × `appearance.sidePaneWidth`）。每列 1–3 行，`h` 合计为 1；屏幕上 ≤ 6 个窗格；工具列 ≤ 2 个。
- 工具区的窗格 / 实例 id 前缀 `t-`（引擎的 `c…` / `i…`）；窗格的 `kind` = 它的家种类（最初为它而建的种类：排序、最小高度、菜单名），
  `collapsed` = 折叠成标题头；实例多 `key`（去重键）、`v`（state 版本）、`pinned`（保留，不是预览）、`at`（最近使用）。`tools` = 工具区开 / 关、
  聚焦的工具列、覆盖（§18.7）、id 计数。
- 绑定比种类的模式多一种 `workspace`（实例的具体绑定，§18.5）。
- 校验 `validateLayout`（不信任存档）；`splitLayout` / `joinLayout` 拆成两个区域 / 合回去；`toolPartOf` / `toolRawOf` 是引擎布局与工具区 JSON 的
  无损互转（读回经 `sanitizeLayout`）。

### 24.4 种类从哪来

| 来源 | 种类 id | instances / binding | 画在哪 |
|---|---|---|---|
| 外壳 | `core.conversation` | multi / agent（去重 = 主机 + session） | 工作区（`PaneHost` 自己画，带 `ConversationScope`） |
| `pane.kind` 条目 | 条目 id | 条目自己的 | 工具区 |
| 每个 `side.component`（含状态分类派生的 `status:<id>`，§18.9） | **同 id** | singleton → single，multi → multi；`agent` / `workspace` / `follow` → follow，`host` → host | 工具区（就是原来的 side 组件实例） |
| 每个不带 `Aside` 的 `main.page` | `page:<页面 id>` | single / none（= 焦点主机的 `host` 绑定）；params = `PageParams`，只在内存 | v1.21：工具区——聚焦对话的 Shelf 里自己的窗格（缺省）；「页面打开位置」= 占用会话时盖在聚焦的会话上 |

- 带 `Aside` 的页面（设置）**不派生**，仍是全窗口页（Aside 代替智能体列表，工具区隐藏）。
- 右栏的 `conversation.agent`（另一个 agent 的实时对话，2026-10-18）**并进 `core.conversation`**：它不再是 side 组件；agent 菜单「在侧边打开」、
  ＋ ▸ 智能体、`services.side.open("conversation.agent", { sessionId }, { binding: { kind: "host", hostId } })` 都打开一个固定在那个 agent 上的对话窗格
  （在聚焦对话的旁边；`background` = 不抢焦点）。
- **页面是自己的窗格**（v1.21，主人 2026-10-21；取代 v1.17 的「盖在对话上」）：`services.ui.openPage(page, params)`（侧栏入口 `runNav`、
  ⌘K 的页面结果 = `services.panes.open("page:<id>")`、链接 / 引用 / 深链、`lib/workspaces` `openRef` 的页面）先问 `lib/pageOpener`：
  设置 `appearance.pageOpen`（外观 → 窗口与卡片 →「页面打开位置」，本机）= `"shelf"`（缺省）时 `lib/paneServices` `openPageInShelf` 用
  `sideOpen("page:<id>", params, { reveal, focus })` 把它开进**聚焦对话的 Shelf**：`lib/sideComponents` 的组件表里每个不带 `Aside` 的页面
  （`lib/paneKinds` `pageSideItems`）是一个 singleton、绑焦点主机（`host`）、页组 = 种类 id 的组件，所以按 §24.12.2 的放置**开在自己的页**、整页高（设计 038，主人 2026-10-23；
  已经有这个页面的窗格 = 跳过去、换成新的 params；混排开关只影响「这一页满了」之后的退路），已经开着 = 换成新的 params、显示并闪一下。窗格头是普通的 Shelf 窗格头（`components/side/SideCard.tsx`）：图标和名字取
  打开这个页面的 `nav.primary` 条目（`target.page` 或 `activePages`；没有 = 通用图标、「页面」），标题 = `useTitle` 的面包屑连成一行
  （「项目 › profileCedar-agent」），放大（= 占满工作行的其余部分，§24.16）、全屏、⋯、×。正文 = `modules/Outlet` `PageContent`（模块的错误边界、
  `requires.component` 的组件卡片）。`persist: false`：页面窗格不存盘（params 只在内存，同以前）。**会话照旧显示对话**，`view` 不变
  （`MainView` 只表示「会话上盖着的页面」）；侧栏入口的高亮、审批页的「正在看」也认 Shelf 里屏幕上的页面（`lib/pageOpener`
  `kindsOnScreen` / `pageInShelfShown`）。Shelf 不接（作用域过期等）= 退回占用会话。
- **占用会话**（`appearance.pageOpen = "column"`）：页面作为聚焦对话窗格的一个标签打开、盖在对话上（对话标签还在）；每个窗格最多一个页面，
  每个页面最多在一个窗格里（在别的窗格开同一页 = 从那里移过来）。这一列的顶栏换成**页面自己的顶栏**（`components/PageHeader.tsx`：图标、
  可点的面包屑、放大 / × / ⋯，⋯ =「在 {{shelf}} 中打开」、全屏、关闭页面），不再是 agent 的顶栏。×、Esc（§19.10 第 5b 行）、`closePage`、
  普通打开 agent（`select`）= 关掉页面、露出对话。聚焦另一个窗格时 `view` 变成那个窗格的页面或对话。
- 带 `Aside` 的页面（设置 = 设置 Shelf，§24.14）两种设置下都不变。草稿对话（`quick-chats.draft`，`newQuickChat` 直接设 `view`）照旧在会话，
  带页面顶栏。

### 24.5 打开规则、服务与限额

```ts
services.panes.open(kind: string, params?: Json, opts?: { beside?: boolean; focus?: boolean; background?: boolean }): PaneOpenResult;
type PaneOpenResult = { status: "opened"; kind: string; paneId: string | null; instanceId: string | null }
  | { status: "unavailable"; reason: /* services.side.open 的原因 */ } | { status: "stale" };
```

- `core.conversation`：params `{ sessionId, hostId? }`（缺省 = 选中 agent 的主机）。普通 = 在聚焦的对话窗格里（已经开着 = 聚焦那个窗格）；
  `beside` = 在它旁边新开一列（满 2 列 = 替换另一列）；`background` = 同 `beside` 但焦点不动。
- `page:<id>`：= `services.ui.openPage`（v1.21：聚焦对话的 Shelf 里自己的窗格，`instanceId` / `paneId` = 那个窗格；占用会话 = 聚焦的对话窗格，`instanceId: null`）。
- 工具种类：= `services.side.open(kind, params, { reveal: true, focus, background })`（§18.8）。`services.side.open` 保留，是工具种类的别名
  （外加上面的 `conversation.agent`）。
- **工具放置**（主人 2026-11-03）：复用 → 预览就地替换 → 已有同种窗格的页加标签，否则填当前空页或新建 Shelf 页；不自动分屏。显式布局动作和 50 页保护上限的退路见 §24.12.2。
- **限额**（`lib/paneLayout.ts` 常量）：屏幕上 ≤ 6 个窗格（`MAX_VISIBLE_PANES`）、每列 ≤ 3 个（`MAX_ROWS`）、对话 ≤ 2 列、工具列 ≤ 2 列
  （`MAX_TOOL_COLUMNS`）、工具窗格合计 ≤ 4（`MAX_TOOL_PANES` = 6 − 2 列对话）。所有改布局的操作之后 `fitLayout` 保证限额（多出来的窗格
  变成第三个窗格的标签）；拖放要超出限额时拒绝（拖动提示「放不下了」）。第 4 步：放回小片超出限额时，最久没用的窗格收成小片（LRU，
  §24.11）；`minSize`（缺省 280 × 120；对话旁边还有对话时 `CONVERSATION_MIN_W` = 400）放不下的新工具列不建，改加标签（`place()` 的
  `roomForColumn`、拖放），两个对话 + 工具列放不下各自的最小宽度时工具区变成抽屉（`frameMins`，不再把对话挤到 280 px 以下）。
- 已经开着：聚焦并闪一下（启动器、`reveal`）。所有工具列都在屏幕上，所以启动器的「当前页」= 有这种可见窗格的列（没有 = 聚焦的列），
  规则同 §18.3（折叠 → 展开，可见 → 聚焦并闪一下）。Ctrl+Shift+1…9 = 聚焦第 n 个工具列；Ctrl+Shift+N = 新的一列（空列，放启动器）。

### 24.6 持久化

localStorage `cutex-desktop.panes` = `{ v: 1, layouts: { "host:<焦点主机>": Layout } }`：**只存本机**、按焦点主机一份、**对所有 agent 一份**。
两个 store 各写自己的区域、保留存档里另一个区域（同一个键的读改写）：`lib/paneStore.ts` 写工作区（不存页面标签），`lib/sideLayoutStore.ts`
写工具区（`prepareForSave`：不存 `persist: false`、超过 4 KiB 的 state、空的启动器列；每范围 ≤ 200 个实例、覆盖 ≤ 100 条，§18.11）。恢复时丢掉
已删除 agent 的对话窗格和工具实例、`restore` 返回 null 的实例；最大化 / 全屏不恢复；「启动时恢复」关掉时只留覆盖。

存放位置（E-G10，主人 2026-10-24 批准；`lib/paneDb.ts`）：上面这份文件放在 IndexedDB `cutex-desktop-panes`，一块一条记录（`meta`、每个范围的
布局、每个范围的默认布局 + 共享页、每个对话自己的 Shelf）。首次渲染前读进内存（`lib/paneDbBoot.ts`，整个读取一个 5 秒期限，超时 = 这次
运行用 localStorage），之后读都是同步的；写只写变了的记录（100 ms 内合成一个事务，记录带时间 `t`，旧的不盖新的；删掉的留墓碑
`{ t, del }`，有有效的戳时 7 天后清掉），其他窗口经 BroadcastChannel 马上收到。每个窗口没提交的写另记一份 localStorage 日志
`cutex-desktop.panes.journal.<窗口>`（小的时候每次变化都记，pagehide 时一定记；下次启动在下面的合并之后全部补上，内容没被那个窗口改过才删）。首次启动：旧键拷进来（别的窗口
这期间写的记录保留）、读回核对后才用，旧键原样保留。退出（pagehide）：整份文件写回旧键 `cutex-desktop.panes`（≤ 1.5M 字符时；给降级回旧版
桌面用，0.2 系列保留），哈希和最新 `t` 先写进 `cutex-desktop.panes.stamp`（戳写不下就不写拷贝）。旧键跟这个戳不一致 = 旧版桌面（或没有 IndexedDB 的一次
运行）写过它：把它跟库里不同的块合并进来，但拷贝之后在这里改过的记录（含墓碑）不动（那边没见过它们）；没有戳时只补这里从没有过的块；从不整库清空，这时窗口退出也不拿自己的拷贝盖掉它。
没有 IndexedDB / 打不开 / 核对失败 / 超时：照旧用 localStorage（超时后不再往库里写；已经写进去的拷贝 / 合并会盖戳）。

### 24.7 从 `cutex-desktop.side` 迁移（一次）

两个 store 第一次读之前都调 `migrateSideOnce()`（`lib/paneFile.ts`，幂等）：

1. 读 `cutex-desktop.side`（v1.16：页 → 卡片 → 标签，带每 agent 视图）；每个范围 `host:<id>`：
2. **聚焦的 agent** = `views` 里最近用过的那个；它在看的页成为**唯一的工具列**（没有视图记录 = 存档的 `activePage`），它的开 / 关 = 工具区的开 / 关。
3. 别的页的卡片按页的顺序并进这一列：有同种的窗格 → 成为它的标签；这一列还有空间 → 成为新窗格；否则 → 最下面窗格的标签。页组合并，
   覆盖指向这一列。**不丢任何实例**：参数 / state、去重键、保留标记、最近使用都原样带过来。
4. `conversation.agent` 卡片离开工具区，它们的 agent 成为工作区的会话（在已有对话旁边，满 2 列为止；不抢焦点）。
5. 写进 `cutex-desktop.panes` 的同一范围（已有的工作区保留；已有工具区的范围不覆盖），原值整份放到备份键 `cutex-desktop.side.v1-backup`
   （应用不再读它），删掉 `cutex-desktop.side`。

### 24.8 外壳行为摘要

- 工作区只有一个对话窗格、旁边没有工具窗格时 DOM 与以前相同（没有窗格头）；两列对话、或旁边有工具窗格时每列一个细窗格头（agent、主机、
  ⤢（悬停）、「—」、×，最后一个对话窗格没有 ×；v1.21：盖着页面的列是页面自己的顶栏，§26.4）。
- 工具区：`SideArea.tsx` 把屏幕上的工具列（`columnsOnScreen`：对聚焦 agent 有内容的列 + 聚焦的空列）并排画，列之间 8 px；每列是
  `SidePageView.tsx`（窗格、行间可拖的缝）；窗格头 = `SideCard.tsx`（标签行；混种类时用当前标签的种类画图标和操作）。工具区开着但没有
  任何窗格时显示空状态和启动器；开着、只有别的 agent 的内容时不显示。
- 拖放见 §24.11（第 4 步换成按窗格分区：四边 30 %、窗格头 / 正中、工作区最左最右）；页按钮那几行（药丸、标签条、整页拖动）的规则删了。

### 24.9 测试

`test/paneLayout.test.ts`（布局、校验、会话）、`test/panesStep4.test.ts`（小片、LRU、`minSize`、最大化、会话移动、方向键、窗格键、
Esc、两个区域的小片存取、`lib/paneActions` 的显示桌面和托盘上限）、`test/panesStep3.test.ts`（工具区 JSON 互转、两个区域的拆合、页面窗格、迁移、两个 store 互不覆盖）、
`test/panesStep2Store.test.ts`（页面跟着聚焦窗格、不存页面）、`test/sideLayout.test.ts`（§18.6 / RFC §4.4 的 13 个场景按本节改写，编号不变；
`foldPages`）、`test/sideDrop.test.ts`（第 4 步的分区：四边 30 %、合并为标签、新列、工作区边缘、对话换位、拒绝、外部把手）、`test/sideAgentViews.test.ts`（全局一份）、`test/sideLaunchers.test.ts`、
`test/modules.test.ts`（`pane.kind` 快照与派生种类表、v1.21 页面的 Shelf 组件表、外壳扫描）、`test/moduleSdkContract.test.ts`（类型正反例、`SLOT_SPECS`）、
`test/pagesOwnPane.test.tsx`（v1.21：页面是自己的窗格、占用会话的页面顶栏）。

### 24.10 延后（第 5 步起）

桌面底层与个人页已在第 5 步落地（§25）；左栏细栏、对话窗格里放工具标签（拖放拒绝「工具放在对话的右边」）、
弹出窗口（第 6 步）、`MainView` 完全退休、单击智能体时被替换的对话变小片（§4 第一条；第 4 步仍是直接替换）。

### 24.11 第 4 步：小片、最大化、拖放、键盘

> **0.2 变更（2026-10-22，合并 feat/0.2-tray / feat/0.2-width；本节下文的小片 / LRU / 最大化描述已过时，以此为准）**：
> - 「—」on a tool pane opens a menu: 移到另一页 ▸ (the other pages of its Shelf, plus 新的一页 when the pane isn't alone on its page, below the 50-page sanity limit) and 关闭 (confirmed in place, like ×). Tool panes never go to the tray (#7, owner 2026-10-21). 托盘 = 钉住的 + 打开着的会话（docs/design/001）。
> - 显示桌面（主人 2026-10-22 改定）：只显示桌面——侧栏卡片照常（平时显示就显示）、托盘按它的设置；**没有会话、窄条、Shelf、Shelf Rail**。会话整体收走（`emptyWork`）；Shelf 的布局不动（不再收成 Rail——Rail 常驻会把它们留在屏幕上），显示桌面期间工作区只是不画 Shelf（`components/PaneHost` `side` = `!desktopShown`）。再按一次 = 原样回来。〔原来：展开的 Shelf 收成 Rail，Rail 常驻时最右还剩一条 Rail。〕
> - LRU / limits: no pane goes to the tray any more (remove "the least recently used pane goes to the tray"); 会话收起 = 原位窄条或最小化到托盘（docs/design/002）。
> - Migration (no file version bump): stored tool chips go back into their Shelf once (`resolveChips`); one that cannot (its Shelf at the 50-page sanity limit) is closed with one notice saying how many.
> - 最大化 = 规则 2（只吃空隙，`lib/panelGrow*`，docs/design/003）；原来的「最大化」改名「独占」，在 ⋯ 里（`toggleExclusive`，两个工作区时另一个收成窄条）；全屏不变。动作预告：`lib/foretell.ts` + `components/ForetellLayer.tsx`，效果与执行同源（`lib/workspaceEffects.ts`，docs/design/008）。

外壳文件：`lib/paneActions.ts`（两个区域共用的动作：收起 / 放回 / 关小片、托盘 ≤ 8、最大化、显示桌面、窗格键、焦点窗格）、
`components/ChipTray.tsx`（托盘、「显示桌面」按钮）、`lib/paneFly.ts`（收起 / 放回时的飞行动画）、`lib/paneRoom.ts`（`minSize`）、
`lib/paneKeys.ts`（键的纯路由）；纯函数在 `lib/paneLayout.ts`（工作区）和 `lib/sideLayout.ts`（工具区）。

- **小片**：窗格头「—」把窗格收进工作区底部的托盘（飞行动画：窗格的影子飞进小片；`prefers-reduced-motion` 时不飞）。小片显示图标 /
  头像、标题、「+n」个标签、角标（忙 / 需要你的数目 / 未读，来自各标签的 `useTitle` / 侧栏的需要你）；点 = 放回原来的邻居旁边（工作区：
  左 / 右邻居、列序号、宽度份额，`Pane.home`；工具区：所在工具列 id / 组 / 名 / 序号、上 / 下邻居，`SideChip`；列已经没了就在原序号重建，
  放不下新列就进最右一列）；× = 关（要结束东西时先原地确认，同 `closeConfirm`）；中键 = ×。托盘按收起时间排；超过 `MAX_CHIPS` = 8
  时自动关最旧的，有 `closeConfirm` 提示的不自动关（存档最多 `MAX_STORED_CHIPS` = 16）。最后一个对话窗格收起后留下一个空的对话窗格
  （没有 agent = 今天的空状态），放回时它让位。打开已经在小片里的东西（单击 agent、`services.side.open` 复用同一实例、`reveal`）= 放回原位。
- **LRU**：对话窗格放回时已有 2 列 → 最久没用的对话窗格收成小片；「在旁边打开」已有 2 列 → 另一列显示它、它原来的 agent 收成小片
  （以前是直接替换）；工具窗格放回时那一列满 3 个或工具窗格满 4 个 → 那一列（或全部）里最久没用的收成小片。
- **最大化**：窗格头 ⤢、双击窗格头、Ctrl+Shift+M（聚焦的窗格）。同时只有一个；Esc 或 ⤢ 还原；不存（`joinLayout` 丢掉）。
  （2026-10-21 起：占工作行剩下的宽度，别的面板收成 Rail，另有全屏——§24.16。）
- **显示桌面**：标题栏按钮 / Ctrl+Shift+D：屏幕上的窗格（对话 + 对这个 agent 可见的工具窗格）按屏幕顺序收成小片，托盘最前面多一个
  「恢复布局」；什么都不在屏幕上时再按 = 按原样放回（焦点回到原来的对话），没有可恢复的就放回最新的小片。
- **拖放**（`lib/sideDrop.ts` 纯函数 + `lib/sideDnd.ts` 探测 / 盖层）：拖窗格头（整个窗格）或标签（一个实例），对话窗格拖它的窗格头。
  落在另一个窗格四边 30 % = 那一边分出（工具：上 / 下 = 这一列里分，左 / 右 = 旁边新的一列；放不下新列 = 改成标签）；窗格头或正中 =
  合并为标签（任何种类）；工作区最左 / 最右缘 = 新的一列（对话：最左 / 最右的会话；工具只能在最右）。规则内：对话一列一个、只能
  左右换位；工具不进对话窗格、对话不进工具区（拒绝并说明）；限额照旧拒绝。拖动时被拖的窗格变淡，目标区域高亮并写明结果，Esc 取消。
- **键盘**（`lib/useSideShortcuts.ts` → `lib/paneKeys.ts`）：Ctrl/⌘+W 关聚焦窗格的当前标签（对话窗格：关页面，否则关这一栏，最后一栏不关；
  要结束东西时先确认）；Ctrl/⌘+T 在聚焦窗格弹出启动器菜单（工具窗格：新开的作为它的标签）；Ctrl+Alt+方向键 = 换到那个方向的窗格；
  Ctrl+Shift+M 最大化 / 还原；Ctrl+Shift+D 显示桌面。终端聚焦时 Ctrl+Shift+D / M 和 Ctrl+Alt+方向键放行，Ctrl+W / T 归 shell。
  Esc 链（`lib/escChain.ts` 第 4 行）先还原最大化的窗格（对话或工具），再关参考卡片、抽屉。
- **持久化**：小片随布局存（工作区小片 = `chips` 里的窗格 id + `home`；工具区小片 = `chips` 里 `t-` 前缀的窗格，`home.column` / `above` /
  `below`），恢复时校验，已删除 agent 的小片丢掉。最大化不存。

### 24.12 Shelf（2026-10-20，契约不变）

主人方向与术语：`docs/research/canvas-principles-20261020.md` §6（Shelf、Shelf Rail、页、窗格、标签行、会话；每个 Shelf 自己的「允许混排」
和 Rail 内外侧；第 3 步删掉的右栏多页按这个形状回来）；原型 `.claude/preview-shelves.html` A 组（默认、两个 Shelf、混排关 / 开、拖到页签、
拖到边缘、Shelf 菜单、Rail 在内侧、Shelf 收起）；收起到 Rail（主人 2026-10-21）：`.claude/preview-design-v1.html` §3 方案 a（`#s3-a`、
`#s3-a+open`、「▶ 演示动画」）。

**层次**：Shelf → 页（Shelf Rail 切换，一次显示一页）→ 窗格（一页里上下最多 3 个）→ 标签（标签行切换）。

〔**2026-10-23 起改为「样子 A」**（主人选；`feat/0.2-shelf-look`）：展开的 Shelf 不再画成一张卡片。Rail 是一整条满高的卡片，朝外的一边圆角、贴窗格的一边方角；每个窗格是自己的卡片贴在 Rail 上（贴 Rail 的一边无边框、方角，朝外圆角），窗格之间是标准的 8 px 缝（`SHELF_PANE_GAP = CARD_GAP`，缝里看得见桌面，仍是拖高度的把手），Shelf 里的窗格不加阴影；每个窗格内容的外侧下角都画圆角（`SideInstanceLayer`）；亚克力按每个角分别裁。收起的 Shelf（只剩 Rail）不变。下面这段 10-21 的「一张卡片 / 1 px 线」说法作废，留作历史。拖放时真实窗格先挪到放下后的位置（`lib/dropMorph.ts`，只用 transform / clip-path；减少动态效果时只画虚线框）。〕
**一张卡片**（设计 009，主人 2026-10-21 选 A）：Shelf Rail 是 **Shelf 的页签栏**，不是单独的一种面板。整个 Shelf 是一张卡片（`.shell-card`
的材质、圆角、细边、阴影只有一份；`components/side/SideArea` `ShelfView` 的 `.shelf-card`，样式 `components/side/shelfCard.css`）：Rail 在卡片里
贴一边，和页之间一条细线（页这一栏朝 Rail 的 `border-l` / `border-r`），没有缝；页里的窗格不再各自是卡片（没有边框、圆角、阴影、自己的材质），
上下两个窗格之间是 1 px 的线（`SidePageView` `PANE_LINE`，拖动的热区仍是 9 px；`cardHeights` 的 `gap` 参数），实例层只把卡片自己的那个角
（最下面窗格离 Rail 远的那一角）画成圆角（`SideInstanceLayer` `bodyCorners`）。**收起** = 同一张卡片收窄到 Rail 宽（圆角 12 px，和侧栏的头像窄栏
一样）；**展开** = 从 Rail 那边长出来，动画是这张卡片变宽（`lib/shelfMotion` 原样）。空 Shelf 的 Rail、另一个工作区的 Rail 也是收起的 Shelf 卡片
（`data-shelf-collapsed`）。「Rail 直角」（主人想试的：只剩 Rail 时直角、展开后圆角）是开发开关 `lib/shelfCorners`（`?shelfcorners=square`、
`localStorage["cutex-desktop.shelfCorners"]`，`<html data-shelf-corners>`），缺省圆角。契约不变（`MODULE_API_VERSION` 不升）。

#### 24.12.1 模型（`lib/sideLayout.ts`）

```ts
interface Shelf {
  id: string;                         // "s<n>"（和页、窗格、实例共用 id 计数）
  side: "left" | "right";             // 会话的哪一边；每边最多一个，合计 ≤ MAX_SHELVES = 2
  width?: number;                     // 自己的宽度（不含 Rail）；没有 = appearance.sidePaneWidth（设置里的默认宽度）
  active: string | null;              // 显示的页
  options: { allowMixing: boolean; railPlacement: "outer" | "inner" };
  collapsed?: boolean;                // 收起：只剩 Shelf Rail（原地的竖条，§24.12.3）；没有 = 展开。v3 存的 `chip`（整个 Shelf 在托盘里）读作收起
}
interface SidePage { …; shelf?: string; icon?: PageIcon; kept?: boolean }   // 属于哪个 Shelf；Rail 图标；主人建的页（空也保留）
interface SideLayout { …; shelves?: Shelf[]; singleShelf?: boolean }          // 左边的在前；只用一个 Shelf（没有 = 关）
```

- 引擎原来的「页」（第 3 步叫工具列）就是 Shelf 的页；Rail 顺序 = `pages` 里这个 Shelf 的页的顺序。每页 ≤ 3 个窗格（`MAX_CARDS`），每个 Shelf
  ≤ 50 页（`MAX_SHELF_PAGES`，Alt+1…9）。没有 `shelves` 的布局（手写、旧存档）读的时候所有页归右边的 Shelf，**允许混排关**（`withShelves`
  / `shelvesOf`，归一化有缓存；所有 reducer 先归一化）。`layout.activePage` = 聚焦的页（Alt+n、启动器、`active-page` 放置都看它所在的 Shelf）。
- **限额**：每页 ≤ 3；屏幕上的工具窗格 ≤ `MAX_TOOL_PANES` = 4 只按**屏幕上的页**（每个展开的 Shelf 正在显示的页；收起的只有 Rail）算，只在加窗格时检查
  （`place`、拖放、小片放回的 LRU）；切页不合并任何东西（另一页可以各有 3 个）。旧的「合计 ≤ 4 就把最下面合并成标签」改成只保证每页 ≤ 3。
- **默认**（主人 2026-10-20）：**每个 Shelf 都不允许混排**（一个窗格的标签行只放一种东西；文件、网页、终端各成窗格），Rail 在外侧——
  从 v1.17 布局、v1.16 右栏、第 3 步备份迁来的右 Shelf 也一样（`defaultShelfOptions()` 不再有「旧布局开」的分支；之前的迁移把它设成开，
  存储 v3 一次性关掉，§24.12.5）。已经混放的窗格保持原样（不重新分组）；之后满页时放置开新页（§24.12.2），主人可以在 ⋯ 里打开。
- **只用一个 {{shelf}}**（`singleShelf`，单一 Shelf 模式 = 以前的右栏）：开着时不会有第二个 Shelf——`shelfLimit(layout)` = 1（否则
  `MAX_SHELVES`），`canAddShelf` 为假；`addShelf`、`moveToNewShelf` 不变；`applyOpen` / 小片放回（`restoreCard`）/ 撤销（`restoreRemoved`）/
  旧页恢复需要新 Shelf 时改用现有的那个；工作区边缘拖放 = 现有 Shelf 的新页（§24.12.4）；**移到另一边**照旧。打开时已经有两个 Shelf：都留着
  （不合并），只是不再新建，关掉一个就剩一个（`setSingleShelf` 只改这个标记）。缺省：**新安装开**（什么都没存过：没有 `cutex-desktop.panes`、
  `cutex-desktop.side` 和它的备份），**已有用户关**（不管有没有两个 Shelf，行为不变）；每个范围存自己的选择（`tools.singleShelf`），没存过工具区
  的范围用文件里的缺省（`singleShelfDefault()`，§24.12.5）。

#### 24.12.2 放置（主人 2026-11-03，`place()`）

普通打开（启动器、文件链接、页面、agent/tool 打开、peek 固定及窗格内打开）先复用同 kind/binding/key 的实例，临时预览仍在原位置替换。
已有同种类窗格 → 切到它所在的页，多实例加到同一个窗格的标签行；没有同种类 → 填入当前空页，否则在目标 Shelf 末尾开新页。
窗格内打开保留源工作区 / Shelf，不能借由隐式 page 参数把源页自动分屏。注册声明的 `prefer` / `otherwise` 与历史 override 都不能使普通打开自动堆叠。
只有明确的拖放、移到 / 分屏菜单、显式 page 目标才能堆叠窗格。允许混排仍只控制异种标签是否可合入同一窗格，与默认开页策略无关。
每个 Shelf 的正常使用不再受九页限制；保留 50 页的存储和布局保护上限。到达保护上限时沿用原放置退路（同种窗格、可用窗格、最下面窗格的标签），普通打开永不拒绝。
`reveal` 一个收起 Shelf 中的实例会展开并切到它所在的页。没有任何 Shelf 时，普通打开创建右 Shelf。

#### 24.12.3 外壳

- `components/side/SideArea.tsx`：工作区 = [左 Shelf][对话卡片][右 Shelf]。右 Shelf 沿用 §18.3 的框（并排 / 让位 / 悬浮 / 窄窗口抽屉 /
  最大化 / 全屏）；左 Shelf 只在行内，会话放不下各自的最小宽度（加上右 Shelf 的最小宽度）时离开屏幕，窗口变宽再回来。每个 Shelf 的框 =
  宽度 + Rail（`RAIL_WIDTH` = 40）+ 8 px 缝（收起时只有 Rail + 缝 = `COLLAPSED_SHELF_WIDTH` = 48，见下）；缝和窗格朝对话一侧的边是宽度把手（`lib/sideResize.ts`：拖动实时、松手存进布局，双击 = 回到默认
  宽度，方向键）。最大化 / 全屏时右框盖住整个工作区，显示那个窗格 / 页所在的 Shelf。
- `components/side/ShelfRail.tsx`：Shelf 卡片的页签栏，在卡片的外侧（窗口边）或内侧（对话一侧）。页按钮 = 页的图标（**两个以上窗格的页 = 胶囊**：一个竖的圆角框里按上下顺序叠着每个窗格的图标，没有把手标记——框 / 空隙拖整页，
  图标拖那个窗格；悬停框 = 整个框描淡的强调色，悬停图标 = 只亮图标；点图标 = 显示那一页并聚焦、闪一下那个窗格；设计 038）（`page.icon`，否则第一个窗格种类的图标；
  `lib/shelfIcons.ts`）+ 提示（页名 · Alt+n）；正在显示的页有底色和外缘的小竖条；需要你的数目、忙的点。然后 ＋（新页，≤ 50；新页带改名 /
  图标浮层）、最下面收起按钮（收起 / 展开，提示「· Esc」）和 ⋯（Shelf 菜单）。点页按钮：别的页 = 切过去；**正在显示的页 = 什么都不做**（主人 2026-10-22：原来是收起，太容易误点；双击它也不收起——Rail 的双击 = 最大化只在空白处）。按住拖 = 拖整页（§24.12.4）。右键页按钮：重命名 / 换图标（同一个浮层：名字输入框 + 22 个图标 + 「自动」）/ 移到上面 / 移到下面 / 拆开「窗格」（右键的图标，否则聚焦的 / 最下面的窗格，成为紧挨着的下一页）/ 合并到上一页（合起来 ≤ 3 个窗格）/ 在所有对话中显示 / 删除这一页（设计 038）。
- Rail 的页按钮列表在高度不足时独立纵向滚动（滚轮 / 触控板，无可见滚动条），上下边缘渐隐提示还有内容；头像 / 固定按钮保持固定，＋ 紧跟最后一个页按钮；仅当列表溢出时，＋ 留在滚动区域的底边，⋯ 始终固定在 Rail 底部。切换活动页自动滚入视野；拖动到列表边缘自动滚动。合组页的一整个胶囊只算一个列表项；竖屏横 Rail 使用相同的横向规则。
- 空页选择器除了内容 / 工具 / 状态，还从标题栏「更多」同一份 `nav.primary` 注册表读取可进入 Shelf 的页面（页面组）；按主机能力隐藏不可用项，跳过纯动作和有 Aside 的全窗口页。已有状态入口不重复列出；选择后显式填入该空页。
- ⋯ 菜单（`lib/shelfMenus.tsx`）：标题「右边的 {{shelf}} · n 页」；允许混排（开关，下面一行说明）；只用一个 {{shelf}}（开关，整个布局的，
  下面一行说明；有两个 Shelf 时说明「已有的两个都留着」）；{{shelf}} Rail 在外侧 / 内侧；**收起**（收起时这一项是「展开 {{shelf}}」）；
  移到左边 / 右边（那边有 Shelf 时不可用）；关闭 {{shelf}}（n 个窗格一起关，可撤销）。托盘里不再有 Shelf 小片。
- **收起到 Rail**（主人 2026-10-21；`collapseShelf` / `expandShelf` / `railPageClick` / `toggleShelfCollapsed` 在 `lib/sideLayout.ts`，
  动作在 `lib/shelves.ts`）：收起的 Shelf 原地只剩它的 Rail——一条竖条（`COLLAPSED_SHELF_WIDTH` = Rail 40 + 缝 8），在 Shelf 的外侧
  （窗口边；Rail 选了内侧也一样），是收窄到 Rail 宽的 Shelf 卡片（设计 009），**不标**正在显示的页（没有页在屏幕上）；页图标、需要你的数目、忙的点照旧，＋、收起按钮
  （这时是展开）和 ⋯ 照旧。它的页、窗格、实例都留着；页不在屏幕上（不算进 4 个工具窗格），实例按 keepAlive 规则隐藏。会话拿到让出的宽度
  （`shelfRow()`：[左 Shelf][对话][右 Shelf] 的宽度，纯函数；收起的右 Shelf 不经过 §18.3 的框，`railsOnScreen()` 给出要画的竖条）。
  **展开**：点 Rail 上的一页 = 展开到那一页；收起按钮 / ⋯ 里的「展开」= 展开到原来那页；Alt+1…9（聚焦的 Shelf 收起时）、⌘K 的页、`reveal`、
  拖放停在页按钮上也都展开。**收起**：收起按钮、⋯ →「收起」、会话顶栏的 Shelf 按钮、焦点在这个 Shelf 里（Rail、窗格头、窗格内容，不在输入框里）按
  **Esc**（`lib/escChain.ts` 第 6 行，在还原最大化和关抽屉之后；终端等自己用 Esc 的组件先拿到）。收起时如果聚焦的是它，焦点移到另一个展开的 Shelf；
  它在最大化 / 全屏就先还原。最大化 / 全屏时不画收起的竖条。
- **动画**（`lib/shelfMotion.ts`）：收起 / 展开时 Shelf 的框在两个宽度之间平滑过渡（220 ms，WAAPI），会话每帧跟着变；展开时页的内容保持最终
  宽度（被框裁掉、淡入），窗格不会每帧重排，盖在窗格上的实例等框到位再出现（`useShelfMotion`）。`prefers-reduced-motion` 时直接跳到位。
  宽度来自外壳算出的值（不量 DOM），按 Shelf 记住，竖条和完整的框互换时也接得上。显示桌面 / 恢复布局不碰收起状态。〔2026-10-22 起：显示桌面时
  Shelf 和竖条都不画（§24.11 0.2 变更）。〕
- **撤销**（`lib/shelves.ts`、`components/side/ShelfToast.tsx`）：删除页 / 关闭 Shelf 把页、窗格、实例从布局拿走（`removePage` / `removeShelf`
  返回被拿走的部分），底部提示条带「撤销」7 秒（`restoreRemoved` 放回原处：Shelf 回原来那边，那边已有 Shelf 就去空着的一边，都占了就并进那边
  的 Shelf）。组件的 `onClose`（例如结束终端进程）等提示条消失才跑；窗口关闭时立刻跑。所以这两项不再先确认。
  〔2026-10-23 起（窗口审计 #6）：拖放造成的合并 / 拆开 / 移动 / 跨工作区移页也出同一个提示条和 7 秒「撤销」（`lib/dropUndo.ts`），放回拖放前的
  排法、实例状态不变；之后又动过布局或焦点换了对话就不撤，提示「之后又动过布局，没法撤销这一步」。一次只有一个提示条：新的拖放提示会让还没过期的
  删除页撤销提前生效。主人的风险分级：这些是低风险，一次过、只给撤销。〕
- **{{shelf}} Rail 常驻**（主人 2026-10-21："the Shelf Rail could be always present — no need to hide it; make it configurable, shown by default"；设置 → 外观 → 窗口与卡片，`appearance.shelfRailAlways`，
  本机，**缺省开**）：开着时每个对话的 Shelf Rail 一直在它的位置上（Rail 内外侧、§24.15 并排时的位置照旧）：
  - **工具区关着**（`open: false`）：它的 Shelf 都画成 Rail（和收起的一样，不标正在显示的页；`workspaceShelves`，单个工作区也这样——并排时
    本来就这样，§24.15 (a)）。点页按钮 = 打开到那一页（`railPageClickNow` → `switchPage`，`open` 变真、Shelf 展开）；Rail 底部的收起 / 展开按钮
    在关着时是「展开」（`toggleShelfNow`：`collapsed` 或工具区关着都展开）。
  - **空的 Shelf**（这个对话一页都没有，或只有别的 agent 的页）：一条空 Rail（`components/side/ShelfRail.tsx` `EmptyShelfRail`，
    `data-shelf-rail-empty`）：对话的小头像 + ＋（启动器菜单，选的开进这个对话的 Shelf：`lib/convPaneControls` `shelfLauncherMenu`，和顶栏
    Shelf 按钮的「＋ 打开 {{shelf}}」同一份）；没有页、收起按钮和 ⋯。单个工作区画在会话右边；并排时画在 `workspaceRow` 的 `railAt`
    （外侧 / 永远偏右），另一个工作区的那条点头像 = 聚焦它、＋ 选了先聚焦再打开，也是工作区拖放的投影目标（`data-ws-shelf`）。没有 agent 在前面
    （桌面）时不画。
  - **另一个工作区**同样（关着的画 Rail、空的画空 Rail）。
  - **宽度**：Rail 算进行宽——单个工作区当成收起的右 Shelf（`shelfRow` `right: "collapsed"`，单列的边、`singleColumnWidth` 的 `free`、按内容的
    整组宽度都扣掉 48 px），并排时是 `RowWorkspace.rail`（`workspaceRow` 本来就为「另一个工作区的 Rail」留的位置：`fits`、铺满的份额、强制
    画成 Rail 的判断都算它）；`setShelvesTaken` 也算它。
  - **最大化 / 全屏**（§24.16）照旧：关着的工具区的 Shelf 和别的 Shelf 一样收成 Rail；空 Rail 不画。
  - 顶栏的 Shelf 按钮（§26.3）不变：展开的 = 收成 Rail，收着 / 关着的 = 展开，空的 = 启动器；Rail 一直在。
  - **关掉** = 以前的行为：空的 Shelf 没有 Rail（入口只在顶栏），单个工作区关着的工具区什么都不画（并排时关着的仍画 Rail，§24.15 (a)）。
- 新页 / 页按钮名：`pageLabel`（主人起的名，否则前两个窗格名）。主人用 ＋ 建的页、拖到 ＋ 建的页是 `kept`：空了也留在 Rail 上（显示「这一页
  还是空的」和启动器），删除才走；规则建的页空了就走（和以前一样）。

#### 24.12.4 拖放（`lib/sideDrop.ts` + `lib/sideDnd.ts`）

- **拖页按钮 = 拖整页**（主人 2026-10-22 报「页按钮拖不动了」——Shelf 有 Rail 以来（741f5a34）页按钮就没有拖动把手，第 3 步的整页拖动在
  bb63923b 删掉了；不是 0.2 的回退）：`SideDrag` `{ type: "page", pageId }`（`ShelfRail` 的页按钮用 `sideDragHandle`，短按仍是点击，放下后的
  点击被吞掉）。放在**页按钮 / 胶囊的中间**（上下各 25 % 以外）= **合并**：那一页在下面加上这一页的所有窗格，这一页消失（合起来超过 3 个窗格拒绝
  「放不下：一页最多 3 个窗格」；`mergePageInto`，目标 `mergePage`，设计 038）；放在**上 / 下 25 %** = 放到它前面 / 后面；放在 **＋** 上 = 那条 Rail 的最后。
  拖动中 ＋ 变成虚线框「新页」。胶囊里的**图标** = 拖那个窗格（`{ type: "card" }`，规则同下面的窗格拖动：放在别的页按钮上 = 进那一页，放在「新页」上 = 自己成一页）。同一个 Shelf = 只改 Rail 的顺序
  （正在显示的不变）；**另一个 Shelf**（≤ 50 页，满了拒绝「没有空间」）= 整页连同窗格移过去并在那边显示，原来的 Shelf 没页了就消失
  （`lib/sideLayout` `movePageTo`，`lib/sideDrop` `pageDropTarget` → 目标 `movePage`）。放回原位 = 什么都不做；窗格上、工作区边缘、另一个
  工作区的 Shelf 不接受（页只进 Rail；另一个工作区的页 id 是它自己的）。拖动中停在页按钮上**不**切页。反馈：要放的位置一条横线 +「移到这里」/
  「移到这个 {{shelf}}」。测试 `test/shelfPageDrag.test.tsx`。

- 窗格四边 30 %：上 / 下 = 这一页里分出（满 3 个拒绝）；左 / 右和正中、窗格头 = 合并成标签（**不再**在旁边新开一列）。
- **允许混排关**：拖到别的种类的窗格头 / 正中被拒，改成「放在它下面的新窗格」（区域标成警示色，标签行打斜纹，标签写「不允许混排（这里是
  …）· 放成新窗格」；放下后提示「可在 {{shelf}} 选项里打开允许混排」）；这一页也满了 → 拒绝「不允许混排，这一页也已满」。同种类照常合并。
- **页按钮**：停 0.4 s（`PAGE_HOVER_MS`）切到那一页（之后可以放进它的某个窗格）；放在按钮上 = 放进那一页（窗格按 `order` 进新窗格或同种窗格，
  标签进同种窗格否则新窗格），那一页显示出来；满了拒绝「这一页已满（3 个窗格）」；自己的页 = 什么都不做。**＋** = 新的一页（`kept`），≤ 50。
- **工作区最左 / 最右缘**：那边没有 Shelf → 在那边新建 Shelf（不允许混排；≤ 2；放不下新 Shelf 的宽度就拒绝）；那边有 Shelf → 它的新页。
  **只用一个 {{shelf}}** 开着、已经有 Shelf → 两边边缘都是那个 Shelf 的新页（标签「放到新的一页」，50 页满了拒绝）；不显示「新建 {{shelf}}」。
  对话窗格拖到边缘照旧是会话换位。外部把手（参考卡片）：窗格 / 页按钮 = 钉进那一页；别处 = 新页（聚焦的 Shelf）。

#### 24.12.5 存储：布局 v2（`lib/paneLayout.ts`、`lib/paneFile.ts`）

`PANE_LAYOUT_VERSION` = 2：工作列只有会话；工具区在 `shelves`：

```json
"shelves": [ { "id": "s7", "side": "right", "active": "p3", "options": { "allowMixing": false, "railPlacement": "outer" },
               "pages": [ { "id": "p1", "groups": ["workspace"], "name": "工作", "rows": [ { "pane": "t-c2", "h": 1 } ] },
                          { "id": "p3", "groups": ["browser"], "icon": "globe", "rows": [ { "pane": "t-c4", "h": 1 } ] },
                          { "id": "p9", "groups": ["user:p9"], "kept": true, "rows": [] } ] } ]
```

- 工具区状态 `tools` 多一个可选的 `singleShelf: boolean`（只用一个 {{shelf}}；没有 = 关）。
- 校验：≤ 2 个 Shelf，每边一个；每个 1–50 页，每页 0–3 行（0 只给 `kept` 页），行高合计 1；所有窗格只出现一次（屏幕上、某一页上或小片里）；
  屏幕上 ≤ 6 个窗格只数工作列（隐藏的页不在屏幕上）。工具小片的 `home.column` 多 `shelf` / `side`（Shelf 没了按原来那边重建，放不下就进那边
  或右边 Shelf 的新页）。
- **迁移**（`migrateSideOnce`，两个 store 第一次读之前都调，幂等）：
  1. 还有 `cutex-desktop.side`（v1.16）：页直接成为右 Shelf 的页（不再折成一列），聚焦 agent 在看的页在显示，允许混排关；备份键照旧。
  2. 文件 `v: 1` → `v: 2`（只一次）：每个 v1 布局的工具列成为右 Shelf 的页（`migrateLayoutV1`：列顺序 = Rail 顺序，聚焦的列在显示，允许混排关）；
     然后如果有第 3 步的备份 `cutex-desktop.side.v1-backup`，它的旧页在每个范围里**按原样回来**（`restoreLegacyPages`：页名、组、窗格的
     种类 / 标签顺序 / 当前标签 / 高度 / 折叠；还在的实例——同 id、种类、去重键、绑定——从折成的那一列移回原来的页；之后被主人关掉的不复活；
     一个都对不上的范围 = 没从它折过，旧页连同实例整页加回来，换新 id）。备份键留着不删。刚从 v1.16 迁来的范围跳过这一步（页已经是页）。
  3. 文件 `v: 2` → `v: 3`（只一次，`migrateMixingOff`，主人 2026-10-20）：每个已存 Shelf 的 `allowMixing` 改成 `false`，窗格、标签、实例都不动
     （已经混放的窗格照旧）。741f5a34 的 v2 文件分不出「迁移设的开」和「主人自己打开的开」（这个选项当天才有，没有标记），所以全部关一次；
     从 v3 起所有迁移都写关，所以之后存着的「开」一定是主人设的，不需要另外的标记字段。同一步在文件上记 `singleShelf`：这次是新安装（第 1 步
     之前什么都没存）= `true`，否则 `false`——`singleShelfDefault()` 给没存过工具区的范围当缺省；存过的范围读自己的 `tools.singleShelf`（没有 = 关）。
     旧版本读到 `v: 3` 会当成读不了（和 v2 对更旧的版本一样）。
  4. 文件 `v: 3` → `v: 4`（只一次，`migrateShelfRails`，主人 2026-10-21）：收起的 Shelf 不再是托盘里的小片，而是原地的 Rail——每个已存 Shelf
     的 `chip`（进托盘的时间）换成 `collapsed: true`，页、窗格、实例都不动。读的时候 `chip` 也当收起（`sanitizeLayout`、`toolRawOf`），存的时候
     只写 `collapsed`。

#### 24.12.6 键盘、术语、读接口

- Alt+1…8 = 聚焦的 Shelf 的前八页；Alt+9 = 最后一页（浏览器惯例）（终端聚焦时也放行，`modules/terminal/terminalState.ts` `passThroughKey`）；Ctrl+Shift+1…9 = 所有 Rail
  合起来的第 n 个页按钮（左 Shelf 在前）；Ctrl+Shift+N = 聚焦的 Shelf 的新页。聚焦的 Shelf 收起时 Alt+n 把它展开到第 n 页；焦点在展开的
  Shelf 里按 Esc 收起它（§24.12.3）。
- 术语 `shelf`（`lib/terms.ts`）：占位符 `{{shelf}}` / `{{Shelf}}` / `{{shelves}}`，所有语言缺省都是「Shelf」（复数同一个词），设置 → 术语里能改；
  措辞预设（`lib/termPresets.ts` `PRESET_TERM_IDS`）不设也不清它，改过的 Shelf 不会让措辞变成「自定义」。新界面文字一律写 `{{shelf}}`（12 种语言）。
- 读接口（`lib/shelves.ts`，给 ⌘K 快速切换等）：`listShelfPages(): ShelfPageInfo[]`（每个 Rail 上的页，左 Shelf 在前，Rail 顺序：`shelfId`、
  `side`、`pageId`、`index`（1 起，Alt+n）、`name`、`icon`、`firstKind`、`inView`、`focused`、`panes`、`shelfCollapsed`（收起到 Rail））、
  `subscribeShelfPages(listener)`、`openShelfPage(pageId): boolean`（Shelf 收起就展开、切到那页并聚焦）、`switchShelfPage(n)`。
- 契约：模块看到的仍是页 id（`services.side.open` 的 `page`、`SideBodyProps.pageId`），`services.panes.open` 没有新目标；所以 `MODULE_API_VERSION`
  不升（1.18），快照不变。想让模块把东西开到指定 Shelf / 页时再加（候选：`services.panes.open(kind, params, { shelf?: "left" | "right", page? })`，v1.19）。

#### 24.12.7 测试

`test/shelves.test.ts`（模型：页的增删改排、图标、50 页保护上限、删除和撤销、两个 Shelf、换边、关闭和撤销、收起到 Rail 和展开、宽度和选项存取、
混排开 / 关的放置；v2 存取、`migrateLayoutV1`、`restoreLegacyPages`、`migrateShelves` 与 v1.16 迁移；术语；`listShelfPages` / `openShelfPage` /
Alt+n；Shelf 外壳文件不点名功能）、`test/sideDrop.test.ts`（页按钮、＋、混排关的拒绝和改成新窗格、边缘新建 Shelf / 新页）。场景测试的改动见
`test/sideLayout.test.ts` 开头：场景在「允许混排开」的 Shelf 上跑（主人打开过的，第 4 步的行为）；「另开一列」改成第二个 Shelf；18 列上限改成
50 页保护上限；sanitize 不再折页。`test/panesStep3.test.ts` / `panesStep4.test.ts` / `panesStep2Store.test.ts` / `paneLayout.test.ts` 改成 v2 形状。
主人决定（2026-10-20）的测试在 `test/shelves.test.ts`：「只用一个 Shelf」（`addShelf` / `moveToNewShelf` 不变、移到另一边照旧、边缘拖放 =
现有 Shelf 的新页、两个 Shelf 时打开不合并、撤销 / 小片放回进现有 Shelf、`tools.singleShelf` 存取）、载入缺省（新安装开、v2 文件 / 只有
v1.16 右栏的已有用户关、范围自己存的选择优先）、`migrateMixingOff`（v2 → v3 关掉允许混排、混放的窗格不动、只一次）。
收起到 Rail（主人 2026-10-21）也在 `test/shelves.test.ts`：收起 / 展开 / 切换（页不在屏幕上、`railsOnScreen` 给竖条、焦点移到另一个 Shelf、
`reveal` 和 Alt+n 展开、`collapsed` 存取、v3 的 `chip` 读作收起）、点页按钮（收起时展开到那页、点正在显示的页不变、别的页切换）、Esc 链的
「收起 Shelf」行、行宽（`shelfRow`：收起的 Shelf 只占 48 px、会话拿到其余的；`shelfMotionFrom` 只在收起 / 展开时动）、`migrateShelfRails`
（v3 → v4，只一次；新安装直接到 v4）。
{{shelf}} Rail 常驻在 `test/shelfRailAlways.test.tsx`：缺省开 / 存的关 / 读坏值；单个工作区关着的工具区画 Rail、点页打开到那页、收起按钮展开；
空 Shelf 的空 Rail（头像、＋ 的启动器、没有页、单列的边让开它）、桌面时不画；关掉 = 以前的行为、再打开立即出现；对话最大化时关着的 Rail 收在旁边、
空 Rail 不画；顶栏 Shelf 按钮（关着 → 展开 → 收成 Rail → 展开，Rail 一直在）；并排：另一个工作区的空 Rail 在外侧、算进铺满的宽度（关掉时宽度
回到以前）、聚焦的空 Shelf 永远偏右时在它右边、另一个工作区关着的 Shelf 画 Rail；不重叠：纯函数扫描（两边空 Rail / 关着 / 展开 × 宽度 × 模式 ×
位置）和渲染扫描（800–2600 px）。`test/wsRails.test.tsx` 里「另一个工作区的空 Shelf 不占位置」的两条改在设置关时跑。

### 24.13 工作区、投影、按对话记的 Shelf（2026-10-21，契约不变）

原则 `docs/research/canvas-principles-20261020.md` §7（主人 2026-10-21）；原型 `.claude/preview-workspaces.html`。推翻 §24.12 的「布局全局一份」。

- **工作区** = 一个会话 + 它自己的 Shelf。屏幕上 1–2 个工作区。外壳文件：`lib/workspaces.ts`（打开 / 拖放规则 / 几何，纯函数 +
  拖动的 DOM 部分）、`lib/convShelves.ts`（按对话的 Shelf，纯函数）、`lib/sideLayoutStore.ts`（`switchConversation`、`peers`、
  `peekConvShelf`、`saveShelfAsDefault`）、`lib/shelfSourceContext.ts` + `lib/shelfSource.ts`（一棵子树画的是哪个对话的 Shelf）、
  `components/WorkspaceDndLayer.tsx`（拖动的高亮）、`components/side/WorkspaceRail.tsx`（只在一个对话最大化 / 全屏时画另一个工作区，
  §24.16）、`modules/conversation/Projection.tsx` + `projectionItem.ts`（投影）。外壳不点名功能（投影是 `lib/sideKinds`
  的一个众所周知的组件 id `conversation.projection`）。
- **Shelf 按对话记**：每个对话（`convKey` = 主机 + 会话）记住自己的 Shelf——页、窗格、每个 Shelf 正在显示的页、收起、宽度、聚焦的页
  （`ShelfMeta`）。实时的工具区永远是**聚焦的对话**的 Shelf：换对话时 `splitShared` 把共享页取出，剩下的作为旧对话自己的 Shelf 记住
  （内存里一份，连同不存盘的实例；也写进文件），`mergeShared` 把共享页放进新对话的 Shelf（各进自己那边的 Shelf，没有就新建），它的视图
  照原样回来。页、窗格、实例的 id 在一个范围里所有对话间唯一（同一个 `seq`），冲突时 `renumber`；**Shelf 的 id 只在一个对话里唯一**：
  每个对话的第一个 Shelf 常常都是 `s1`，共享页所在的 Shelf 在它出现的每个对话里保留同一个 id（`mergeShared`「同 id 就是同一个
  Shelf」）。所以两个工作区的 Shelf 要按「对话 + Shelf id」区分（下面「并排」）。没有自己 Shelf 的对话从**默认布局**（`template`）复制：
  只带「跟随对话」的窗格（文件、更改…），绑定某个 agent 的或主机上的东西（浏览器标签）属于打开它的那个 Shelf；没有默认布局 = 空的、关着的
  Shelf。还没有对话聚焦时显示的布局（启动、桌面）归第一个聚焦、自己没有 Shelf 的对话。Shelf ⋯「设为新对话的默认布局」= `saveShelfAsDefault`。
  每个范围最多记 `MAX_CONV_SHELVES` = 120 个对话（最久没用的先走）；agent 删了它的 Shelf 也忘掉（`pruneConvShelves`，侧栏列表变化时，至多每分钟一次）。
- **共享页**：页右键「在所有对话中显示」（`SidePage.shared`，`setPageShared`）= 在每个对话的 Shelf 里，同一个实例跟着焦点走；Rail 上有
  共享角标。取消共享 = 变成聚焦对话自己的页。
- **存储**：`lib/paneFile.ts` 文件 `v: 4` → `v: 5`（`migrateConvShelves`，只一次）：每个范围的 `convShelves[scope] = { template, shared,
  conv: { [convKey]: { part, meta, at } } }`；旧的全局工具区同时成为默认布局**和**当时聚焦的对话自己的 Shelf，什么都不丢；工作区里已存的
  对话小片关掉（agent 照旧在 cutex 里运行）。`layouts[scope]` 里的工具区从此不再读。
- **同时看 A 和 B**：
  1. **投影**（`projectInto`）：B 作为一个对话窗格出现在 A 的 Shelf 里（`conversation.projection`，multi，按 agent 去重，参数 / 状态
     `{ hostId, sessionId }`）——实时的 B 本身：它的时间线、审批 / 提问、「接下来」队列和精简的输入框，不带 B 的 Shelf。发送只到 B
     （`submit(…, { sessionId, hostId })`），Esc 在投影里永远不停聚焦对话的回合（投影在 side root 里，`lib/escInterrupt` `inSide`）。
     顶部「投影 · 在旁边打开」= `promoteProjection`（先在这个 Shelf 关掉投影，再并排打开 B）；卡片的 × 移除。B 已经作为工作区在屏幕上时
     投影只显示占位和「切过去」，不再挂第二份实时视图。agent 菜单的「投影到当前 {{shelf}}」（`conversation.projectAgent`）。
  2. **并排**（`openBesideAt`）：`[A | A 的 Shelf] [B | B 的 Shelf]`，两个会话各是一张卡片（`ConversationColumns` `split`），聚焦的有
     描边（焦点换过去时描边从外圈收进来、旧的淡出，`styles.css` `.ws-col`）。**焦点不改布局**（主人 2026-10-21，§24.15「宽度规则」）：两个
     工作区的 Shelf 都按各自对话记住的展开 / 收起和宽度画在行里，换焦点只移动描边。**两个 Shelf 都是实时的**（d2ab9da0，主人 2026-10-21）：
     - 实时布局 `layout` 仍是聚焦对话的 Shelf；屏幕上另一个对话的 Shelf 是 `sideLayoutStore` 的 **`peers[convKey]`**（`PeerShelf`：它自己的
       页 / 窗格 / 实例 `own` + `ShelfMeta`，不含共享页），实例照样挂着。`syncPeers`（窗格布局变化时，工作行也调用）按屏幕上的对话增删 peer：
       已有的原样留着，新来的从内存 / 文件 / 默认布局取（和实时布局 id 冲突时改号）。换焦点（`switchConversation`）在**同一次** `setState`
       里把新聚焦对话的 Shelf 从 `peers` 换进 `layout`、旧的换进 `peers`——同样的实例 id，什么都不卸载、不重挂。peer 的修改走 `remember` /
       `updatePeerView`，各自防抖存盘（`schedulePeerSave`）。
     - **每个 Shelf 画的是谁的**：`lib/shelfSourceContext` `ShelfSourceContext`（null = 聚焦对话的，`ShelfPeer` = 另一个对话的，带它的
       `peerView` = 自己的页 + 实时布局里的共享页 + meta）。Shelf 组件（`ShelfRail`、`SidePageView`、`SideCard`…）都经 `lib/shelfSource`
       `useShelfLayout` 读布局、经 `useSideView` 读视图上下文：另一个工作区里「跟随对话」的工具绑到**它自己的**对话（不是聚焦的那个）。
       实例层（`SideInstanceLayer`）对每个实例知道它属于哪个 Shelf（`owners`），用那个 Shelf 的布局和上下文挂它。
     - **按下即聚焦**：在另一个工作区的 Shelf 里按下 / 获得焦点（它的盒子 `data-ws-peer` 的 `onPointerDownCapture` / `onFocusCapture`）先
       `focusPeer`（同步）：那个工作区成为聚焦的，它的 Shelf 在原处变成 `layout`，于是这一下按键照常作用于它（页按钮、边缘拖宽、窗格里的点击）。
       快捷键（Alt+1–9、Esc、Ctrl+Shift+M…）永远只作用于聚焦工作区的 Shelf。
     - **跨 Shelf 拖动**（`lib/sideDnd`：指针下有 `data-ws-peer` 时按那个 Shelf 算规则，`peerDropTarget`）：窗格 / 标签拖进另一个对话的 Shelf
       （页按钮、＋、页上、那边工具区的窗格）= `movePaneToPeer`：同样的实例移过去（不重挂），焦点不动，两边各自存盘；悬停页按钮在**那边**换页
       （`updatePeerView`）。拒绝：绑定在那个对话看不到的东西上的窗格（某个 agent、某个工作区：`bound`，「这个窗格只属于这个对话…」）、放到共享页上
       （`shared`，共享页在每个 Shelf 里都一样）。
     - **共享页**只有一份实例，跟着焦点：在另一个工作区的 Shelf 里它的页显示一个占位（`ws.peerShared`「共享页显示在聚焦的工作区，点一下切过来」，
       点一下 = 按下即聚焦）。
     - 行里两个工作区的 Shelf 盒子（`SideWorkArea` 的 `WsShelfBox`，各在 `ShelfSourceContext.Provider` 下）按工作区顺序排（左边的先），**键 =
       对话 + Shelf id**（`shelfBoxKey`），换焦点盒子、窗格、占位都不动；`lib/shelfMotion` 记住的宽度、拖动会话里各 Shelf 的起始宽度也按这个键。
       （只按 Shelf id 时两个对话的 `s1` 撞键：React 留下旧盒子、画重一个、丢掉另一个——主人 2026-10-21「选中左边的对话，它的 Shelf Rail
       不见了」，`test/twoLiveShelves.test.tsx`「two Shelves of the same id」。）拖宽中的 `liveWidth` 只属于实时布局的 Shelf（另一个工作区的
       Shelf 被拖时已经先聚焦了）。换焦点不让列滑动（`glideColumns` 的键里没有焦点；动画中读到的位置等动画结束再记一次）。
     空的 Shelf 不显示。几何、放在哪一边、按内容的宽度：§24.15（`lib/workspaceRow`，取代 `splitGeometry`）。
     放不下时只在第二个工作区打开那一次把两个 Shelf 都收成 Rail（`shouldFoldShelves`，取代 `railsWhenTight`）。两个工作区放不下侧栏时侧栏自动隐藏（`sidebarAutoRail` / `useSidebarRail`；2026-10-28 起收起 = 完全隐藏、左缘临时弹出）；Ctrl/⌘+B 或「展开侧栏」那时
     只展开侧栏（到只剩一个工作区为止），不改主人的隐藏设置。屏幕上已有两个时，并排 = 那一边的工作区换成 B。
  3. **替换**（`replaceWith`）：整个工作区切到 B（B 自己的 Shelf）；A 的工作区原样记住。B 已在屏幕上 = 聚焦它。
- **拖放规则**（`startWorkspaceDrag(ref, event)`；侧栏行（含隐藏侧栏的弹出）、⌘K 行、托盘）：按下后移动 ≥ 6 px 才算拖（更短 = 原来的点击；
  拖完那一下点击被吞掉），Esc 取消。目标（`probe`）：窗口工作区的左 / 右边缘带（58 px）= **并排**；某个 Shelf（展开的、Rail、或没有 Shelf 时
  对话右侧 22%）= **投影**；对话上 / 直接点 = **替换**。`dropOutcome`（纯）：服务、成果、页总是放进目标工作区的 Shelf（`into-shelf`），边缘
  拒绝它们；把 agent 拖进它自己的 Shelf、拖到已经显示它的对话、拖到另一边已显示它的对话（松开 = 聚焦那边）都拒绝；没有 agent 的工作区（桌面）
  直接接过 agent。高亮颜色：投影蓝、并排青、替换紫、拒绝灰；区域里写「投影到 X 的 {{shelf}}」/「并排打开」/「替换」和第二行说明，顶部有图例，
  指针旁有名字 + 动作的小药丸。⌘K：回车 = 替换，⌘/Ctrl+回车 = 并排（服务 / 成果 / 页没有并排）。
- **对话窗格的「关闭」= 关闭窗格**（`closeWorkspace`；agent 照旧在 cutex 里运行，它的工作区记住；原来的「—」，现在在顶栏的 2×2 按钮块里，§26.3）；
  最后一个 = 不聚焦任何 agent，桌面露出来。
  不再有对话小片（`openBeside` 的 `noChip`）。显示桌面把对话整体收走（`emptyWork`，`useDesktop.work` 记住之前的工作区，再按一次原样回来；
  其间那些 agent 的数据流保持，恢复时不重读）；工具窗格照旧进托盘。
- **给别处调用的接口**（`lib/workspaces.ts`）：`openRef(ref: WorkspaceRef, mode: "replace" | "beside" | "project", opts?)`（`WorkspaceRef =
  { kind: "agent" | "service" | "artifact" | "page"; hostId; key; title? }`；非 agent 总是进 Shelf；没打开 = false）、
  `startWorkspaceDrag(ref, event, { onStart? })`、`isOnScreen(ref)`（agent 在某个工作区或投影在可见的页里；服务 / 成果 / 页在聚焦工作区的
  可见页里）。
- **服务和智能体**（原则 §7，主人 2026-10-21；原型 `#service`；`lib/serviceLink.ts`、`lib/serviceLinkView.ts`、`components/ServiceLinks.tsx`、
  `lib/trayPins.ts`）：服务窗格 = 应用内浏览器标签 `cutex:service/<slug>…`，主人 = `ServiceView.ownerCutexSessionId`。标签的 Actions 里有
  「打开 <主人>」（点 = 并排，▾ = 投影到这个 {{shelf}} / 替换，也能按 `startWorkspaceDrag` 拖出去）；服务没有主人、主人不在了、或就在主人自己的
  Shelf 里时不显示。会话顶栏「N 个服务」列出这个 agent 的服务（健康点）：「在 Shelf 中打开」= 放进**这个对话**的 Shelf 并关联（浏览器标签状态
  `linked` = agent 的会话 id，只是标记），已在 = 「已在 Shelf · 定位」。关联的窗格显示 agent 小头像 +「断开」：去掉关联、原处不动（不变成共享页），
  并固定到托盘 / 桌面共用的固定列表（`lib/trayPins`，`home` 模块启动时登记；撤销 toast 连同新加的固定一起撤回）；以后从托盘在别的对话里打开 =
  进那个对话的 Shelf。每个服务「和它的智能体一起打开」（默认关，`services` 模块 prefs `withAgent`，本机）：那个 agent 的对话成为聚焦对话时，
  Shelf 里还没有就打开（关联，不抢焦点）。预览：`?ws=service[&wsMenu]`、`?ws=svchdr`、`?ws=svclink[&unlink]`。
- **契约**：模块看到的仍是页 id 和 `services.panes.open` / `side.open`；投影是 `conversation` 模块的一个 `side.component`，没有新插槽和
  服务，所以 `MODULE_API_VERSION` 不因工作区升（同期的 v1.20 是托盘，§25.3）。
- 预览：`?ws=start|project|split|replace|rails`（`dev/devWorkspaces.ts`；`rails` = 第一个对话的工具区关着、旁边第二个对话的 Shelf 空着，
  §24.12.3 的 Rail 常驻，截图 `shots/rail-always/`），`&wsDrag=shelf|edge|conv` 把一行停在拖动中。截图 `shots/layout-rules/`
  （两个工作区铺满、圆角卡片和缝隙；换焦点后布局不变）。

#### 24.13.1 测试

`test/workspaces.test.ts`（`convShelves` 纯函数：键、`splitShared` / `mergeShared`、id 冲突改号、`ShelfMeta`、`renumber`、`fromTemplate`；
`sideLayoutStore`：每个对话的 Shelf 换回来时原样、新对话用默认布局、没有聚焦时 Shelf 不动、共享页一个实例跟着焦点走、v4 → v5 迁移；
`dropOutcome` 各目标、标签、并排几何（`workspaceRow` 铺满窗口）、`sidebarAutoRail`、⌘K 回车 / Ctrl+回车、`noChip`、`emptyWork`）、`test/projection.test.tsx`
（投影里的发送只到被投影的 agent，Esc 不停聚焦对话的回合，组件参数 / 去重 / 恢复）、`test/homeDesktop.test.ts` / `test/panesStep4.test.ts`
（显示桌面不再产生对话小片、再按一次原样回来）。`test/serviceLink.test.tsx`（「打开 <主人>」何时显示、点击 / ▾ / 拖动的方式，顶栏服务列表的打开 / 定位，关联角标，断开原处不动、不共享、
已固定、撤销，「和它的智能体一起打开」）。`test/twoLiveShelves.test.tsx`（两个 Shelf 都实时：另一个工作区画真的窗格、实例挂着；跟随对话的工具
绑到自己工作区的对话；换焦点不卸载、同一个 DOM 节点、只交换谁是 `layout`；peer 的实例状态 / 关闭；Alt+n 只作用于聚焦的 Shelf；在另一个
Shelf 里按下先聚焦；它的边缘拖宽只改它和它自己的列；跨 Shelf 拖动同一个实例过去不重挂、绑定的拒绝；两个对话的 Shelf 同 id 时每个盒子各一次、
带 Rail、换焦点是同一个元素、没有重复键）。

### 24.15 工作行按内容宽度、工作区的 Shelf Rail（主人 2026-10-21，契约不变）

主人报告（2026-10-21，真机两个工作区：hachimi-cutex-dev 聚焦、它的 Shelf 有一个浏览器页；cutex-waveline 的 Shelf 空）：(a) 聚焦的工作区
一点 Shelf / Rail 都没有；(b) 空 Shelf 的 waveline 右边一条空白 Rail；(c) 聚焦 waveline 之后第一个工作区的 Shelf 收成 Rail 夹在两个对话
**中间**，点它的浏览器按钮展开并把焦点跳回去——看不懂。

- **(a) 的根因**：并排时 `SideWorkArea` 仍按**单个工作区**算右 Shelf 的框（`sideFrame`，最小宽度 = 两个会话 2 × 400 + Shelf 260），
  在普通窗口（工作区 < 1060 px，例如开着设置 Shelf 或 1280 的窗口）上把 `useSide.narrow` 设成真——可并排时根本没有抽屉。Esc 链（`lib/escLayers`）
  于是走「关抽屉」那一步：`setOpen(false)` 把整个工具区关了，而 `open` 按对话记（`ShelfMeta.open`），并排那一支在 `open: false` 时什么都不画
  （`columnsOnScreen` / `railsOnScreen` 都要 `open`）。`WorkspaceRail` 不看 `open`，所以换到另一个工作区后它的 Rail 又出现，点页 =
  `switchPage` 把 `open` 设回真。修：`narrow`（以及「窄窗口时自动收起」、抽屉的点一下关闭、gutter 的遮挡）只属于单个工作区；并排时关着的工具区
  有页就画成它的 Rail（永远不会什么都没有）。测试 `test/wsRails.test.tsx`（同样的宽度单个工作区是 narrow、并排不是，Esc 链不再走关抽屉；`open:
  false` 的 Shelf 并排时画成 Rail）。
- **工作区的 Shelf Rail**（设置 → 外观 → 窗口与卡片「并排时 {{shelf}} 的位置」，`appearance.wsRailPlacement`，本机）：**外侧**（缺省）=
  左边工作区的 Shelf（展开的或 Rail）在窗口最左边、右边工作区的在最右边，永远不夹在两个对话之间；**永远偏右** = 每个工作区的 Shelf 都在它的右边。
  一个工作区时 Shelf 照旧在它自己那一边。另一个工作区的 Rail 跟着同一条规则（`WsRowContext.railAt`）。`shelfSideAt` / `workspaceRow`
  （`lib/workspaceRow.ts`，纯）给每个 Shelf 一个画在哪一边（`at`）；`components/side/SideArea` `WsShelfBox` 按它画（宽度把手在朝对话那一边，
  Rail 内外侧按画的那一边算）。
- **Rail 顶上的小头像**：每条 Shelf Rail（展开的 Shelf 的、收起的、另一个工作区的）最上面是这个 Shelf 所属对话的小头像（`RailOwner`，
  `components/side/ShelfRail.tsx`；另一个工作区的点头像 = 聚焦它）。
- **空的 Shelf 不显示 Rail**（2026-10-21 起只在「{{shelf}} Rail 常驻」关着时，§24.12.3；缺省开：空的 Shelf 有一条空 Rail，头像 + ＋）：入口在
  会话顶栏（§26.3）：「＋ 打开 {{shelf}}」= 启动器菜单，选的东西开进这个对话的 Shelf。
- **Shelf Rail 在 Shelf 的外侧 / 内侧**也在设置里（同一节，`appearance.shelfRailPlacement`）：改了就改所有 Shelf——实时的、这次会话里别的对话
  留下的、存着的（`paneFile` `setStoredShelfRails`：默认布局、共享页、每个对话的）——和以后新建的（`setNewShelfRailPlacement`，
  `defaultShelfOptions`）；每个 Shelf 的 ⋯ 仍能单独改（`sideLayoutStore` `setEveryShelfRail`）。
- **工作区宽度**（同一节，`appearance.workspaceWidth`）：**只管宽度**（主人 2026-10-21：铺满和贴边分开）。**智能**（缺省）= 一个工作区时按内容
  （会话按缺省 / 拖出来的宽度，居中，四周露出桌面），两个工作区时铺满窗口。`rowWidthMode(mode, 工作区个数)` 把它解析成按内容 / 铺满，
  `workspaceRow` 的输出带 `mode`（实际用的），`WsRowContext.mode` 也是实际的；`SideWorkArea` 的 `data-ws-width` 是实际的、`data-ws-width-setting`
  是设置；`columnHandleShown` 决定两列之间有没有分隔把手（`components/PaneResizer` `RowSplitter`）。**铺满**（铺满窗口，或智能 + 两个工作区）：
  两个会话分侧栏卡片、Shelf、Rail、托盘带之外剩下的宽度，按**主人上次拖出来的比例**（`RowInput.split` = 窗格布局 `cols[].w` 里左列的
  份额，缺省一半；`fillWidths` 给出明确的像素宽度，各不低于最小宽度）。卡片照旧有圆角、8 px 缝隙和阴影，缝里露出桌面。迁移
  （`migrateWorkspaceWidth`，`appearance.workspaceWidthRev` = `WORKSPACE_WIDTH_REV` 1）：没有修订号时存着的「按内容」是旧缺省，读成智能一次；
  铺满窗口照旧；有修订号以后选的按内容保留（每次存都写修订号）。**按内容** = 一个工作区（会话按缺省 / 拖出来的宽度 + 它的 Shelf 按自己的
  宽度）作为一组居中；两个工作区各按自己的宽度，一起居中（`columnWant`：拖出来的宽度，否则「单个对话的默认宽度」——阅读宽度 + 边框 / 工作行
  的百分比由两列分 / 全宽 = 铺满）；空出来的地方露出桌面。**铺满窗口** = 原来的「窗格铺满时占满整个窗口」的宽度部分（存着的 `fillWindow: true`
  读作铺满窗口 + 贴边显示，`parseAppearance`）：会话铺满，单个对话的默认宽度不再收窄它。
  单个工作区：行 `justify-content: center`，主卡片宽 = `singleColumnWidth`（不再用 auto 边距，Shelf 跟着会话居中）。两个工作区：
  `SideWorkArea` 算 `workspaceRow`，经 `WsRowContext` 把每列宽度给 `PaneHost` 的 `ConversationColumns`。桌面亮度在窗格铺满时（铺满窗口，
  或智能 + 两个工作区）算「窗格占满屏幕」。一个 ↔ 两个工作区切换时会话照旧滑到新位置（`lib/columnGlide`，减少动态效果时不动）。
- **贴边显示**（同一节，`appearance.edgeToEdge`，缺省关，主人 2026-10-21 从铺满窗口拆出来）：窗格铺满工作区时（铺满的行、或全宽的单个对话；
  桌面内容不在屏幕上）`<html data-edge-to-edge>`：工作行没有边距、底色是卡片色，卡片没有圆角和阴影，侧栏贴左边，桌面背景隐藏
  （`lib/workSurface` `edgeToEdge`）；按内容露出桌面时不生效。迁移（`migrateEdgeToEdge`）：没有这个字段时，`fillWindow: true` 或存着的
  铺满窗口（2026-10-21 前它就是贴边）读成开，其余关；存过一次以后照选的。
- **宽度规则**（主人 2026-10-21，原则 `canvas-principles-20261020.md` §8.1；纯函数在 `lib/workspaceRow`，拖动之间的记忆在 `lib/rowDrag`
  （只在内存），胶水在 `SideWorkArea`）：
  1. **焦点不改布局**：每个工作区的 Shelf 按自己对话的状态画（上面「并排」）；换焦点时两边的展开 / 收起、宽度、位置都不变。
  2. **放不下只处理一次**：`shouldFoldShelves` 只在工作区从 1 个变 2 个、而且按两边存着的状态放不下（`fits` 为假）时为真：实时的 Shelf
     收起（存），另一个对话的 `collapseConvShelves`（在内存的改 `ShelfMeta`，否则 `collapseOnEnter`，`peekConvView` 也读它）。窗口变窄、
     换焦点、主人自己展开都不触发。主人**展开**一个 Shelf 而放不下时（`newlyExpanded`：某个对话的某个 Shelf 从收起变成展开——状态按对话记，
     单纯换焦点不会出现在这里），收起**另一个**工作区的 Shelf。窗口变窄：会话先收窄到最小（`WS_CONVERSATION_MIN_W` 300），再放不下时
     Shelf 只**画成** Rail（`forced`，不存），宽度够了就回来。
  3. **拖一条边只改两边的两个面板**：Shelf 的边 = Shelf 和它自己的会话（另一个会话不动：拖动开始时记下行的样子（`RowSession`，
     `lib/columnGlide` `onResizeDrag`），铺满时 `pin` 让另一列保持像素宽度（`pinIndex`），按内容时只改它自己那列（松手存进
     `rowDrag.colW`；单个对话存成 `singleColumnW`）。侧栏右边 / 设置 Shelf 内边（行外面的边）：铺满时远端那列不动、紧挨着的那列让
     （行的左边缘移了 = 左边的边），按内容时整组在屏幕上不动（`shiftedLead`），先吃掉桌面空隙；能给多少由 `lib/sideResize`
     `setRowHooks` 的 `give` 说（`rowGive`，`PaneResizer` / `SettingsShelf` 拖到那里就停）。两列之间的分隔把手：只改这两列，拖动中
     `previewSplit`，松手存份额。**10-23 起推挤**（[031](design/031-edge-push.md)）：边往哪边走，那边紧挨着的面板让到最小，再拖就和后面
     直到空桌面的面板一起被推着走（那一侧空桌面变少），没有空桌面就停（`lib/workspaceRow pushEdge`）；行外面的边按内容时只吃空桌面、
     列宽不变，铺满时紧挨着的是 Shelf 就改 Shelf；永远偏右时两列之间的 Shelf 的外边代替分隔把手。
  4. **不重新居中**：按内容时拖动中没拖的那边不动；单个会话两条边对称移动、中心不动（`centredWidth`；只有一侧有 Shelf 时整组因此离开中心，
     `setPinnedLead`）。松手后不跳回居中（`rowDrag.lead`、`data-ws-lead`、行的 `padding-left`）；行自己变宽 / 变窄（窗口大小变化、
     旁边打开了别的面板，不在拖动中）时整组保持它在空隙里的相对位置（`keepLeadShare` → `rowDrag.leadShare`，2026-10-21 主人「窗口一变
     面板就乱飞」：原来这里重新居中，1 px 的变化能跳半个空隙）；工作区打开 / 关闭、工作区宽度换了时才重新居中（`resetRowDrag`）。
  5. **碰到最小宽度就停**：Shelf 的把手最多拿到它那列剩最小宽度（`setRowHooks` 的 `shelfMax`），会话之间按 `fillWidths` 的最小宽度，
     单个会话按 `SINGLE_MIN_W` 和它两边 Shelf 的位置；~~从不推开别的面板~~ 10-23 起到最小后推挤、吃空桌面（[031](design/031-edge-push.md)），
     空桌面用完才停。
  6. **窗口大小变化**：Shelf 和侧栏保持像素宽度；会话按比例缩放，铺满时保持存着的份额（不总是各一半）。
  7. **双击一条边** = 它两边的两个面板回到缺省：Shelf 的边 = Shelf 缺省宽度 + 它那列的缺省（铺满时另一列不动，按内容时忘掉 `colW`，单个对话
     `singleColumnW = 0`；`shelfReset`）；两列之间 = 各一半；单个会话的边 = 默认宽度、重新居中。
  8. 拖动中不滑动（`lib/columnGlide`，原样）；只有离散的变化滑过去。
  9. **方向键 = 一次短的拖动**（`lib/columnGlide` `keyResize`）：Shelf 的边、侧栏的边、设置 Shelf 的内边、两列之间的把手按方向键时同样开一个
     拖动会话（规则 1：只改两边的两个面板，外边只拿 `rowGive` 给得出的），立即显示，停按 `KEY_RESIZE_MS` 160 ms 后像松手一样存一次。
- **窗口大小变化时不乱飞**（主人 2026-10-21；无头 Chrome 在 mock 预览里 1920 → 1100 → 1920 每步 20 px、±10 px 来回、快速跳变量过）：
  工作行和实例层在同一帧里排好（`SideWorkArea`、`SettingsShelf` 的 ResizeObserver 用 `flushSync`；实例层在行的 layout effect 里
  `slotsRelayout` 同步重量，原来晚一帧——单个工作区 1100 → 1920 先画出铺满再画居中、页面落后窗格一帧）；行宽变化的那次渲染里 Shelf
  盒子不做宽度动画（`still`，`lib/shelfMotion`）、侧栏的自动隐藏不做宽度过渡（原来过渡带着整行逐帧移动，途中 Shelf 收起又展开）、
  列不滑动；为缺宽度而做的收起都留 `FOLD_HYSTERESIS` 48 px 回差（`lib/foldHysteresis`：Shelf 画成 Rail `held`、右 Shelf 抽屉
  `wasNarrow`、左 Shelf 离开行 `leftWasOut`、侧栏自动隐藏 `was`），在阈值附近来回拉窗口不再每像素翻一次。实例层不再把「没有框的占位」
  算成每次都变（原来 1100 px 窗口开着设置 Shelf 时无限渲染、整窗空白）。
- **太窄的时候**（2026-10-21 起见上面「宽度规则」2）：不再在窗口变窄时自动收起（原来的 `foldAt` 收一次取消）；会话收窄到最小
  （`WS_CONVERSATION_MIN_W` 300，单个 `MIN_CONVERSATION` 360），连最小也放不下时 Shelf 只画成 Rail（`forced`，不存）。
- 焦点在两个工作区之间移动时描边有过渡（`.ws-col`：旧的淡出，新的从外圈 12 px 收到 2 px，0.56 s；减少动态效果时不动）。
- 测试：`test/workspaceRow.test.ts`（一个 / 两个工作区的放置、外侧 / 永远偏右、按内容居中和各自宽度、太窄收窄再强制 Rail、铺满窗口、
  `shouldFoldShelves`（只在第二个工作区打开时）、`newlyExpanded`、`columnWant`、设置合并；智能：一个 / 两个工作区、分隔把手、旧缺省迁移；宽度规则：
  `fillWidths` 份额 / 最小宽度 / `pin`、窗口缩放保持 Shelf 像素和份额、`pinIndex`、`groupLead` / `shiftedLead`、`centredWidth`、贴边显示的缺省和迁移）、
  `test/layoutRules.test.tsx`（渲染：换焦点 Shelf 状态 / 宽度 / 位置 / 列宽都不变（展开的、收起的）、第二个工作区打开收一次之后换焦点不变、
  主人展开放不下才收另一个、放得下不收；Shelf 的边只改它那列另一列不动并停在最小宽度、松手不跳；双击回缺省另一列不动；侧栏的边只拿紧挨的列、
  窗口缩放保持份额；两列之间的把手、最小宽度、双击各一半；按内容单列的边中心不动、松手不重新居中、窗口变化才重新居中；按内容 Shelf 的边只改
  单列 / 两列里自己那列、存下；侧栏拖动时按内容整组不动；D：方向键只改 Shelf 和它那列、停按后存；窗口变窄画成 Rail 不做宽度动画、
  回差内不回来；单个工作区抽屉的回差；ResizeObserver 的更新同步排好）、`test/windowResize.test.tsx`（回差的纯函数、`keepLeadShare`、
  `keyResize` 会话、实例层没有框的占位不再死循环）、`test/sidebarPeek.test.tsx`（隐藏时无流内元素、左缘弹出盖在内容上、离开 / Esc / 打开 agent 收回、固定）、`test/wsRails.test.tsx`（根因 (a)、关着的工具区并排时的 Rail、渲染出来的放置和顺序、头像、
  空 Shelf 没有 Rail、按内容居中、窗口变窄不收、第二个工作区放不下就收、设置里改所有 Shelf 的 Rail、焦点描边的过渡；智能：一个工作区居中、
  第二个出现就铺满（贴边要另开）、放得下不收 Shelf）、`test/workspaceOverlap.test.tsx`（10,000 组以上的不重叠扫描；窗口变窄画成 Rail 不存、
  变宽回来）、`test/convPaneControls.test.tsx`（§26.3）、`test/deskGaps.test.tsx`（铺满窗口只管宽度、贴边显示单独开；设置里的智能 / 按内容 /
  铺满窗口 / 贴边显示，选的按内容重新读还在）。

### 24.14 设置 Shelf（2026-10-21，契约不变）

主人决定（2026-10-21）：设置成为一个特殊的 Shelf。

- **一个、全局**：不按对话记，最多一个；工作行的整个高度（`components/SettingsShelf.tsx`，状态 `lib/settingsShelf.ts`）。真实界面一直在旁边，改设置时直接看到效果。
- **默认在左边，夹在侧栏卡片和工作区之间**（主人 2026-10-21：不在侧栏左边，窗口顶栏的主机 / 侧栏按钮组仍对着侧栏）：设置 Shelf 渲染进自己的一个
  节点（portal），节点放在 PaneHost 里侧栏卡片后面的插槽 `SettingsShelfSlot`（侧栏停靠时）；右边、没有停靠的侧栏、最大化时放在 App 工作行的锚点
  （右边 `order: 1`，左边 `order: −1`）。换边 / 最大化 / 侧栏收起只移动这个节点，不重新挂载。存储加版本 `v: 2`：没有版本的旧布局（以前的缺省「右」
  每次拖宽 / 最大化都会存下，分不出是不是主人选的）读入时一次性改到左边并写回（`parseSettingsShelfLayout`）；之后移到右边照常记住。
- **一张卡片、正常宽度**（主人 2026-10-21：「设置给正常的宽度，不要缩太小；或者把设置的 Rail 并进去，不要拆出来」——两样都做）：
  设置分类不再是旁边单独的 Rail 卡片，而是**设置卡片里的左栏**（像原来全窗口设置的左侧导航），整个设置 Shelf 只有一张 `.shell-card`。
  卡片顶栏横跨整张卡片：面包屑（`shell.settings` 页面条目的 `useTitle`）、搜索、⇄、⤢、×；下面左栏是分类导航，右边是**页** = 分类页
  （`components/Settings` `Settings`，各模块的 `settings.page` / `settings.section` 照旧）。左栏在卡片里一直在左边（设置 Shelf 在右边时也是）。
- **布局（只存本机，`cutex-desktop.settingsShelf`）**：`width` 是整张卡片（导航 + 页）。缺省 `SETTINGS_SHELF_DEFAULT_W` = 760 px（导航
  `SETTINGS_NAV_NAMED_W` 200 + 页约 560），最窄 `SETTINGS_SHELF_MIN_W` = 640；移到另一边（顶栏 ⇄）；内侧边缘拖宽（松手存，双击 = 默认，
  方向键 ±24 = 一次短的拖动，同样只拿工作行给得出的，不低于 640）。画的时候给对话留 `SETTINGS_SHELF_ROW_KEEP` = 420 px：可分的宽度 = 工作行减去停靠的侧栏卡片、卡片四周的 8 px 间距和
  设置 Shelf 自己的 8 px 缝（`settingsShelfWidth` 纯函数；1440 px 窗口、256 px 侧栏时卡片 732、对话正好 420）。**窗口放不下两样**（可分宽度
  − 420 < 640）：设置卡片保持 640，旁边的对话拿剩下的、按它自己的窄规则收；**不自动最大化**（不在主人背后改状态，真实界面仍在旁边；
  要整窗就按 ⤢）；工作行比 640 还窄时卡片就等于工作行。**会话的 Shelf 展开时**（主人 2026-10-24：设置 Shelf 很宽时展开 Rail，Shelf
  成了窄窗口抽屉、压在对话上）：工作行报出它要的宽度（`useSettingsRowNeed`：对话最窄 + Shelf 最窄 + 收起的回弹余量 48，左边 Shelf / Rail 另算），
  卡片让到这么多（不低于 640，`settingsRowKeep`），Shelf 在行里展开；卡片让到 640 也不够时卡片不动，Shelf 照旧是抽屉，这时旁边露出的
  对话变暗（`data-drawer-scrim`），点一下就收起抽屉。最大化（⤢）= 盖住整个工作行（原来的全窗口设置：带组名的宽导航
  `SETTINGS_NAV_W` 208 在卡片外的窗口底色上，和以前一样），下面的工作行照常挂着、`inert`。设置 Shelf 占的宽度报给 `lib/workspaces`
  `setReservedWidth`（两个工作区时侧栏自动收成窄栏的判断）。存储版本 `v: 3`：v2 及以前的 `width` 是旁边有 Rail 的页卡片（缺省 600），
  读入时小于 640 的一次性改成新缺省 760 并写回（≥ 640 的照留）；v3 只会存 ≥ 640。
- **分类导航（卡片左栏）**：最上面是搜索（聚焦顶栏的搜索框；Ctrl+F、`/` 只在焦点在设置 Shelf 里或最大化时），然后分类一行一个（图标 +
  名字），组之间一条细线；底部按钮「只显示图标 / 显示分类名称」在卡片里收成图标栏（`SETTINGS_NAV_ICONS_W` 48，名字在提示里，卡片宽度
  不变、页变宽；本机记住，存储字段仍叫 `railLabels`）。只有卡片真的很窄（< `SETTINGS_NAV_FOLD_UNDER` 560 px，即工作行连 640 都放不下）
  才自动只显示图标（按钮灰掉并说明），规则 `settingsShelfLayout`。
- **不接受拖放**：根元素带 `data-no-drop`，`lib/sideDnd` / `lib/workspaces` 的 `probe` 在它上面什么都不给（连工作行边缘带伸进来的部分也不算）。
- **入口**：`services.ui.openSettings(page, focus)` / store `openSettings` 打开设置 Shelf 到那一页（已开就换页），`focus.anchor` 照旧滚到那张卡；
  `openPage("shell.settings", params)`（面包屑、模块）也进设置 Shelf；`view` 不变（不再是 `main.page`）。主机切换后设置 Shelf 留在同一页（子页回到总览）。
  ⚙（侧栏底部，`useActive` = 开着）和 **Ctrl+,** 切换开 / 关（`toggleSettingsFromNav`）。主机选择器 / 目标主机（`lib/settingsHost`）照旧，
  关闭时回到焦点主机。
- **Esc**（`lib/escChain.ts`）：5a 在主界面调整中（焦点不在输入框）= 完成调整；6a 焦点在设置 Shelf 里、或它最大化（不在输入框）= 关闭；
  都排在弹层、自己用 Esc 的组件、还原最大化、抽屉之后。设置 Shelf 算 `inSideRoot`（Esc 在那里从不打断回合），最大化 / 调整中
  `sideLayersActive()` 为真（对话的 Esc 让开）。
- **在主界面调整（取代单独的面板）**：设置页页头的「在主界面调整」（和搜索结果里的小按钮、侧栏右键「调整左侧栏…」、`services.ui.customize`）
  让真实界面里对应的区域进入编辑状态——淡描边 + 旁边一条小「完成」条（`components/CustomizeHost`，位置仍是 `placeCustomizePanel`）——设置 Shelf
  保持打开在那一页（最大化的先还原到旁边）。完成（「完成」、页头的「完成调整」、Esc、同一入口再点）= 回到之前：是这次打开的设置 Shelf 就关掉，
  原来最大化就再最大化，原来在别的页就回那一页。换到别的设置页或关掉设置 Shelf = 调整就此结束。`customize.region` 条目不再有 `Panel` / `width`
  （渲染进程内部插槽，不在 SDK）。
- **契约**：模块看到的 `settings.page` / `settings.section` / `services.ui.openSettings` / `openPage` 都不变；`main.page` 的 `Aside`（全窗口页）
  通用机制保留（设置不再走它）。`MODULE_API_VERSION` 不升（1.20），快照不变。
- 测试：`test/settingsShelf.test.tsx`（开 / 关 / 切换、导航换页和模块的页、深链、换边、拖宽和最窄、缺省 760 / 最窄 640 / 给对话留 420 /
  放不下时不最大化、导航在卡片里（一张卡片、顶栏在上、搜索在最上、组分隔线、移到右边仍在左栏）、收成图标并记住、只在 < 560 时自动收、
  最大化时宽导航在卡片外、左边插槽、旧布局移到左边、v2 小宽度一次性改成 760 并写回、Esc 链）、
  `test/customize.test.ts` / `test/customizeHost.test.ts`（调整的开始 / 完成 / 回到之前、完成条）、`test/pages.test.ts`、`test/singleHostSnapshot.test.ts`。

### 24.16 最大化与全屏：每一种面板（主人 2026-10-21，契约不变）

主人：「面板没有最大化 / 全屏吗？」（设计「怎么合理怎么来」）。取代 §24.11 里「对话窗格铺满工作区、工具区隐藏」和工具区的盖层式
最大化 / 窗口内全屏（`FullTitleRow` 删除）。外壳文件：`lib/panelFull.ts`（全屏的状态、进 / 出、和两个仓库保持一致；纯函数
`sameTarget` / `fullscreenHolds` / `restoredState`）、`components/side/SideArea.tsx`（行内的画法）、`components/PanelFullscreen.tsx`
（窗口顶栏的悬停浮出、「退出全屏 Esc」提示）、`lib/longPress.ts`。

- **三种面板**：会话（`PaneLayout.max`，原样）、整个 Shelf（新：`SideMode.shelf`——它当前的页，收起的 Shelf 也行，布局不变；
  `columnsOnScreen` 认它）、Shelf 里的一个窗格（`SideMode.card`，原样）。同时只有一个。
- **最大化 = 占工作行剩下的宽度**：侧栏卡片和托盘不变。同一个工作区的其他 Shelf 收成它们的 Rail；会话最大化时另一个工作区显示成它的
  Rail（`WorkspaceRail always`：顶上头像，Shelf 空的也显示头像，放在它原来那一边；点 = 聚焦它，最大化随之结束）；Shelf / 窗格最大化时
  对话卡片变成一条头像竖条（`ConvStrip`，对话照旧挂着、隐藏；点头像 = 全部还原并聚焦那个对话）。只是**画法**：Shelf 的 `collapsed`、
  宽度、页都不改（宽度规则里「放不下收起」的判断在最大化期间也不跑；另一个工作区的 Shelf 不论展开与否都只画成头像 Rail），所以再按一次 /
  Esc / 双击正好回到原来的样子。被收起的 Rail 上点任何
  按钮先全部还原，再做按钮自己的事（`foldedClick`）。
- **全屏 = 最大化 + 窗口的外壳让开**：侧栏也完全隐藏（2026-10-28 起与收起一致：只剩左缘细线，贴边 / logo 弹出仍能切换；不改主人的设置，`lib/windowSidebar useSidebarCollapsed`）、
  托盘自动隐藏（「托盘常驻」这期间当作关，把手留着，`TrayFrame`）、窗口顶栏移出布局，鼠标到窗口顶边 6 px 浮出（键盘焦点进去也浮出，
  往下移开就收回）、设置 Shelf 暂时不显示。进入时顶部中间出现「退出全屏 Esc」小提示约 2 秒。在侧栏里点别的 agent = 这一列换成它，
  仍然全屏。工具区的全屏仍是 `mode.kind === "fullscreen"`（别处直接设的——模块的 `side.open` 目标、参考卡片的 ⛶——也会被接管）。
- **退出 / Esc**：Esc 链第 4 行（`lib/escChain.ts`，排在弹层、自己用 Esc 的组件、参考卡片之后）先退出全屏，**回到进入前的状态**
  （之前是最大化的就还是最大化：`before = { max, mode }`），再按一次还原最大化。全屏的那个面板不再最大化（例如焦点换到另一个工作区）=
  全屏自己结束，不强行回到之前。全屏时按「放大」/ ⤢ / Ctrl+Shift+M = 直接回到普通布局。都不存盘（重启后没有最大化 / 全屏）。
- **入口**：
  - 会话：顶栏 2×2 块的「放大」= 最大化 / 还原（一个人时也可以：它占整个工作行，不再是阅读宽度）；**长按**（500 ms）= 全屏；⋯ 菜单
    第一项「全屏 / 退出全屏」；双击顶栏 = 最大化。
  - Shelf：⋯ 菜单「最大化 {{shelf}} / 还原」「全屏 / 退出全屏」（`toggleShelfMode`）；双击 Rail 的空白处（Shelf 的「顶栏」）= 最大化 / 还原。
  - Shelf 里的窗格：窗格头 ⤢ = 最大化（占剩下的宽度，和别的面板一样）、⛶ = 全屏；窗格 ⋯ 和页的菜单里也有。
  - 键：**F11** 或 **Ctrl/⌘+Shift+F** = 聚焦的面板全屏 / 回去（`lib/paneKeys` `"fullscreen"`；原来的 Shift+F11 现在是同一件事）；
    Ctrl+Shift+M 照旧最大化。终端聚焦时 Ctrl+Shift+F、Shift+F11 放行给窗口，**单独的 F11 留给 shell**（TUI 会用；`passThroughKey`）。
    F11 在渲染进程里被用掉（`preventDefault`），所以默认菜单的系统全屏不再接它（只在 mock 里验证过，Electron 真机待看）。
- **动画**：最大化 / 还原沿用工作区的重排缓动（`data-pane-relayout`，`.panel-max`），被收起的 Rail 和头像竖条淡入（`.panel-fold`），
  Shelf 盒子在全宽和 Rail 之间的宽度动画照旧（`lib/shelfMotion`）；顶栏浮出 0.18 s；`prefers-reduced-motion` 时都不动。
- 测试：`test/panelMax.test.tsx`（会话最大化：一个 / 两个工作区，Shelf 收成 Rail 但布局不变、另一个工作区的头像 Rail 在它那一边、
  点它回去；整个 Shelf（含收起的）和窗格最大化：对话变成头像竖条且仍挂着、另一个 Shelf 收成 Rail、次序；被收起的 Rail 上的按钮先还原；
  全屏：纯函数、Esc 顺序（全屏 → 最大化 → 普通）、从最大化进入再退出正好回去、工具区全屏被接管、焦点换走时自己结束、全屏时「放大」
  回普通、Esc 先给内层；键 F11 / Ctrl+Shift+F / ⌘+Shift+F 和终端放行；外壳：侧栏窄栏、托盘自动隐藏、顶栏浮出、提示一次；不存盘）、
  `test/convPaneControls.test.tsx` / `test/convHeader.test.tsx`（一个人时「放大」可用）。
- 预览截图：`shots/maximize/`（两个工作区时最大化对话、Shelf 窗格全屏）。

### 24.17 桌子窗口（多窗口 P0–P3.5、P6，2026-10-27，契约不变，设置「多窗口」默认关）

主人 2026-10-27 批准「第二张桌子」：另一个应用窗口（可放到另一块屏幕），由**主窗口的渲染进程**画（同一个 store、每会话一条流、
一个发件箱），不是第二个渲染进程。研究与取舍：`.claude/previews/multi-window/proposal.md`。

- **怎么开**：渲染端先向 main 要票（`WINDOW_CHANNEL` `desk` `ticket`，只有主窗口主框架能要，`isAppSender`），再
  `window.open("about:blank", 票名)`。main 的 `setWindowOpenHandler` 只放行 `about:blank` + 这张一次性票（10 s 内、发给这个
  webContents、用一次；`main/deskWindows.ts` `DeskRegistry`），选项全部写死：无 preload、`sandbox`、`contextIsolation`、
  `webviewTag` 只在浏览器的加固已装好时开（P5，见下）；其它一律拒绝。桌子文档继承主文档的 CSP（about:blank 继承创建者的策略容器），默认会话的出口封锁照旧。
- **样子**：`lib/deskDocument` 把主文档的 `<style>` / `<link rel=stylesheet>`（按序）、`<html>` / `<body>` 属性（主题、调色板、
  外观变量）和脚本加的字体抄进桌子文档，并用 MutationObserver 跟着改（Vite HMR、主题切换）；不用定时器。React 用 portal 画进去
  （`components/DeskWindows`），portal 容器自己监听事件，点击和键入照常。
- **main 的窗口登记**（`main/deskShell.ts`）：窗口控制带桌子 id，main 只认「这个渲染端开的、仍开着的」桌子；隐藏到托盘 = 全部隐藏，
  托盘显示 = 全部回来；任务栏角标每个窗口一份；主窗口重载 / 崩溃 / 关闭时桌子一起关（不算主人关的，位置和重开名单保留）；
  主人关桌子 = 真关，事件 `deskWindow` `closed`，对话回主窗口成小片。有桌子显示时主窗口 `setBackgroundThrottling(false)`
  （P0 实测：不关时主窗口最小化 / 被盖住，主窗口里的定时器降到 1 Hz、它的 rAF 停）。
- **位置**：`window-state.json` 变成 `{ main, desks: { <id>: … } }`（旧的单条读作 `main`），新桌子从最新的桌子 / 主窗口错开 32 px，
  在它所在的显示器上；显示器拔掉 / 改变时移回主显示器（`shared/windowBounds.ts` `restoreDeskBounds` / `refitBounds`）；
  Windows 在 `ready-to-show` 后再 `setBounds` 一次（混合 DPI）；Wayland 只给尺寸。
- **不透明 frame**：`cutex-plugin:` 请求只来自「所有者组」（主窗口 + 它开的、仍开着的桌子，`frameHostOf`），且只认**租给发请求的那个
  webContents** 的文档（P4 起，见下）。模块包：桌子主框架只可加载样式表，不加载脚本。浏览器 P5 起进桌子（见下）。
- **主人用的窗口**：原生对话框、大号提醒（显示器 + 闪烁）用有焦点的应用窗口，否则最后有焦点的，否则主窗口（`main/appWindows.ts`
  `ownerWindow`）。Ctrl+K 在每个窗口里都开，开在按键的窗口里（`lib/appWindowSet`）。
- **P1 的渲染端**：本地开关 `localStorage["cutex-desktop.multiWindow"] = "1"`（P6 起换成设置「多窗口」，见下）；对话列 ⋯「移到新窗口」、桌子里「放回主窗口」；
  一个桌子一个对话（头 + 时间线 + 输入框，自己的工作区上下文）。按窗口的侧栏 / 布局 / 选择、桌子里的 Shelf 和 Rail 是 P3。
- 测试：`test/deskWindows.test.ts`（票、放行、登记、窗口控制 id、frame 组、确认框父窗口、按桌子的位置）、
  `test/deskRenderer.test.tsx`（文档镜像、portal 事件、桌子 store、交回小片）。
- **P2：元素在哪个窗口就用哪个窗口（2026-10-27）**。桌子是主渲染端 portal 出去的，全局 `window` / `document` 永远是主窗口，
  所以菜单、对话框、提示、焦点、按键、rAF、观察器都要按元素所在的窗口来。`lib/ownerWindow`（纯 DOM：`ownerWindowOf` /
  `ownerDocumentOf` / `windowOfDocument` / `activeElementOf` / `selectionOf`，跨 realm 的 `isElement` / `isHTMLElement` /
  `isDom`，`resizeObserverFor` / `intersectionObserverFor`）；`lib/ownerContext`（`OwnerDocumentContext`，桌子根由
  `DeskWindows` 提供；`useOwnerDocument` / `useOwnerWindow` / `useOverlayRoot`，没有 DOM 时安全）；`components/OwnerLayer`
  （`OwnerLayer` 主窗口原地画、桌子 portal 进它的 body；`OwnerPortal` 总是 portal）；`lib/appWindowSet`
  （`activeAppDocument`、`queryAppWindows` / `queryAllAppWindows` 主窗口优先、`onEveryAppWindow`）；`lib/deskGuards`
  （桌子文档也装覆盖滚动条、IME、选择、动画相位、循环暂停）。全局的菜单 / 对话框记下开它的文档（`contextMenu` 的 `doc` /
  `dialogDoc`），拖动绑在开始的窗口。没有桌子时行为和以前一样。
- **守卫**：`test/ownerWindowGuard.test.ts` 按类别数 renderer 里直接用的全局 `document.` / `window.`（body、activeElement、
  hasFocus、监听、rAF、选择、matchMedia、视口、查找、观察器、realm / instanceof），只许名单里的文件、按确切次数，每条写原因
  （整个应用的存储 / 主窗口启动 / 系统偏好 / 只在主窗口的界面）。新代码用上面的帮手。
- **P3：每个窗口是完整的一张桌子（2026-10-27，主人决定）**。桌子窗口画和主窗口同一个外壳（`components/DeskWindows`
  `DeskShell`）：同一个侧栏、≤ 2 个对话列且每列自己的 Shelf + Shelf Rail + 标签、托盘、设置；智能体 HTML 页面仍不进桌子（P4），浏览器见 P5。
  - **按窗口的状态**（`lib/windowScope`）：`windowStore(make)` 每个窗口一份 zustand store，API 不变——hook 按组件所在窗口
    （`DeskContext`）取；`getState` / `setState` 用「当前窗口」= `inWindow(key, fn)` 指定的，否则「活动窗口」（主人最后聚焦 / 点 / 按键的
    窗口，`lib/windowRoute` 在每个窗口的 capture 阶段跟踪）；`subscribe` 听所有窗口并在变化的那个窗口里跑。按窗口的：布局
    `usePanes`、Shelf `useSide`（`currentConv`、存盘计时、待恢复按窗口）、`useDesktop`、`usePanelFull`、`useGrow`、`useRowDrag`、托盘
    `useTray` / `useTrayRoom` / `useTrayStage`、宽度 `useWsUi`（每个窗口自己的 resize）、`paneRoom`、设置 Shelf 槽。组件 effect 里写这些
    store 用 `useInWindow()`（一次提交里各窗口的 effect 一起跑，不能靠活动窗口）。
  - **选择按窗口**：`useApp` 的 `selectedId` / `selectedHost` / `view` 是活动窗口的；其它窗口的留在 `useWindowSelection`，`useApp` hook
    （`selectionAware`）给非活动窗口里的组件叠上它自己的那份。切到另一个窗口 = 记下离开的、`enterWindow` 把那个窗口的焦点列选中（它的
    全窗口页面如设置也回来）。非活动窗口的布局变化只更新它记下的选择，不碰全局选择。
  - **一个智能体只开一份**（`lib/windowRoute`）：`agentPlaces` = 所有窗口的对话列和托盘小片；`store.openAgent` 和 `openAgentBeside` 先问
    `routeOpen`：别的窗口的列里有 → 跳过去（main 抬起那个窗口、它成为活动窗口、那一列聚焦），不开第二份；哪儿都没开 → 在当前窗口开，
    别的窗口托盘里它的小片去掉。侧栏 / Ctrl+K / 通知点开都走这里。行菜单「在主窗口打开」/「在 桌子 N 打开」/「在新窗口打开」
    （`lib/deskActions` `openInWindow`：从原处挪走再在那个窗口打开）；拖侧栏行松手在另一个应用窗口上（按屏幕坐标，`appWindowAt`）同样。
    桌子里对话列 ⋯「放回主窗口」（只挪这一列）。
  - **存储**：布局作用域 `host:<id>/desk:<deskId>`（`paneScopeOf`；`scopeHost` 去掉桌子后缀）；对话自己的 Shelf 和默认布局仍存在主机作用域
    （`convScopeOf`，跟着对话进出桌子；一份 = 一个写者），桌子的共享页面存在桌子作用域。桌子的 Shelf id 从远处开始（`windowSeqBase`），
    和主窗口不撞。桌子名单只记 id + 焦点对话（`DESKS_STORAGE_KEY`，没有存过布局时用它起一列）；重开时按存的布局和位置回来；空桌子不重开。
    关掉桌子 = 它所有的对话（列 + 小片）回主窗口成小片。
  - **侧栏按窗口**：滚动和筛选本来就是每个侧栏自己的；收起（隐藏 + 左缘弹出）和宽度桌子各存各的（`lib/windowSidebar`，
    `cutex-desktop.deskSidebar.v1`；Ctrl+B / 边缘拖动在桌子里只改那张桌子），主窗口照旧用偏好。
  - **设置 / 主页在点的那个窗口**：设置 Shelf 记下打开它的窗口（`useSettingsShelf.win`），只有那个窗口画它；在另一个窗口按 Ctrl+, 把它挪过去。
  - **「在看」/ 需要你 / 提醒**：`lib/appFocus` = 任一应用窗口有焦点；`looksAt` 只算活动窗口里显示的（`noteShownIn` / `shownInActiveWindow`），
    `ownerNotifyStore` 的 `looking` 同样；在桌子里看着一个智能体也收回它的提醒（`appLookWindow`：所有应用窗口的 focus / blur）。
    大提醒和原生对话框本来就用有焦点的应用窗口（P1 `ownerWindow`）。
  - **缩放**：桌子里也有 Ctrl+= / − / 0；main 把缩放同时设到所有桌子（`DeskShell.setZoom`，新桌子打开时也用）。foretell 在控件所在窗口里算；
    `widenForPage` 用打开它的窗口的帧时钟。
  - 守卫：store.ts / ownerNotifyStore 的焦点判断、workspaces 的 resize、pageShelfWidth 的 rAF 不再在名单里（28 个文件 / 56 处 → 26 / 49）。
  - 测试：`test/multiWindowP3.test.tsx`（窗口 store、选择叠加、一份规则、屏幕命中、作用域键、桌子侧栏）、`test/panesStep2Store.test.ts`
    （桌子自己的布局和选择、跳过去、在桌子 N 打开、按窗口存、关掉交回小片）、`test/deskShell.test.tsx`（jsdom 第二个文档里的桌子外壳）。
  - **还没有**（P4–P7）：智能体页面进桌子（P4）；跨窗口拖列头（P7）；侧栏的「现在」高度等其它侧栏偏好仍全局。
- **P3.5：开关打开前剩下的（2026-10-27，开关仍默认关）**。
  - **托盘按窗口**：「打开但不在屏幕上」名单 `useTrayOpen`（含「返回上一个」的步骤）和工作区组 `useWorkspaceSets`（含置顶的智能体）都是
    `windowStore`，每个窗口一份，按桌子存（主窗口仍是 `cutex-desktop.trayOpen` / `cutex-desktop.trayWorkspaces`，桌子在后面加
    `.desk:<deskId>`；桌子没存过 = 空，旧名单的首次迁移只给主窗口）。一份规则：一个窗口的布局变化后，它屏幕上的智能体离开**其它**窗口的
    名单和组（订阅本来就在变化的窗口里跑）——所以别的窗口打开了托盘里那个智能体，它的小片就去掉（Director：先这样）。主机上删掉的智能体从
    每个窗口的名单里去掉。关桌子（不是退出）= `giveBackToMain` 先把桌子托盘里的名单和组并进主窗口（按时间新的在前、一个智能体一条、组按
    `MAX_RECENT` 裁），删掉桌子存的那两份，再把列和小片交回主窗口（P1 照旧）；记住的桌子重开时没回来（对话已不在）同样交给主窗口
    （`handTrayToMain`，没建过 store 时读存的那份）。托盘组件的 effect（置顶列表）用 `useInWindow()`。测试 `test/multiWindowP35.test.tsx`。
  - **拖动 / 提示画在拖动所在的窗口**：拖动的幽灵、落点、foretell 在 P2 / P3 已经跟着拖动 / 控件的文档（`OwnerLayer`）。剩下只画在主窗口的：
    宽度提示（`lib/widthTip` 记下边的文档 `doc`，`WidthTip` 用 `OwnerLayer`）；Shelf 提示条（`showShelfToast` / `showShelfNotice` 记下
    当前窗口 `win`，App 和每个桌子都挂 `ShelfToast`，只有那个窗口画；「撤销」在那个窗口里跑——以前在桌子里关 Shelf 再点主窗口的撤销会
    作用到主窗口的 Shelf）；Ctrl/⌘ + 点的选列（`useColumnPick` 记 `win`，`ColumnPickLayer` 也挂在桌子里，读那个窗口的列，`finishColumnPick`
    在那个窗口里换）；全屏提示 `FullscreenHint`（`usePanelFull` 本来就按窗口，桌子也挂一个）；落点形变的实例框按窗格自己的文档找
    （`lib/dropMorph`）；收起 / 恢复的飞行按所有窗口找窗格元素（`paneActions` `queryAllAppWindows`）；宽度拖动跟踪（`lib/dragTrace`，
    默认关）跟踪开始时的活动窗口（它的面板、帧时钟、store）；`useWsUi` 的起始宽度用 `appWindowOfKey`。
  - 守卫（`test/ownerWindowGuard.test.ts`）的前缀从 `(?<![\w.$])` 改成 `(?<![\w$]|[^.]\.)`：展开 `[...document.querySelectorAll(…)]`
    以前漏掉（6 处）。修掉 3 处（dropMorph、paneActions、StatusCapsule），`appWindowSet`（枚举窗口）和 perf-log `screen`（只采主窗口）各
    多记 1 处；`workspaces.ts`、`dragTrace.ts` 不再在名单里：26 个文件 / 49 处 → 24 / 46（按新规则原来是 26 / 52）。测试
    `test/multiWindowP35Overlays.test.tsx`（jsdom iframe 当桌子：宽度提示、提示条和它的撤销、选列、形变实例框）。
  - **重启去重**：存的布局可能让主窗口和一张记住的桌子（或两张桌子）都把同一个智能体放在列里（比如两边的存盘时间不同）。规则：
    主人在哪个窗口里按键、点击、跳过去或把东西挪过去，就把那个窗口存为活动窗口（`cutex-desktop.activeWindow.v1`，`activateWindow`）；
    只是窗口得到焦点或桌子关掉（`remember: false`）不存——退出时先关桌子、焦点回到主窗口，不能让它决定下次的去重（双屏实测 2026-10-28）。
    启动时在这次的聚焦事件改写它之前读一次
    （`readStoredActive`）。重开的桌子布局一载入（`reopenDesks` 标记 `restoring`，`deskSync` `startDesk` 在 `startPaneSync` 之后
    `takeRestoring` → `dedupeAtStart`），在已载入的窗口里：**上次的活动窗口**有它 → 它留；否则**桌子**留（第一张记住的桌子；智能体是主人
    特意挪过去的）；否则主窗口。输的窗口那一列关掉（只有一列 = 那列空着，智能体仍在侧栏和赢的窗口里；等着恢复选中它的 `restore` 作废）。
    运行时新开的桌子不去重（`moveToDesk` / `openInNewDesk` 自己挪走原处）。纯函数 `startWinner` / `startDuplicates`（`lib/windowRoute`）。
    测试：`test/panesStep2Store.test.ts`（存的是桌子 / 主窗口 / 没存时的三种结果、只有重开的桌子去重、纯规则含两张桌子）。
- **P5：应用内浏览器进桌子（2026-10-27，开关仍默认关）**。浏览器是 `<webview>`：它的嵌入者是创建这个元素的文档所在的 webContents
  （Electron 44 实测，隐藏窗口：主文档 `document.createElement` 再挂进桌子 = 嵌入者仍是主窗口，主窗口的钩子在管、但 main 不知道它画在桌子里；
  桌子文档自己创建 = 嵌入者是桌子，没有 `webviewTag` 时根本不挂）。所以：
  - **渲染端**：`BrowserBody` 用容器自己的文档创建 `<webview>`（`container.ownerDocument`）；桌子里的标签由那张桌子嵌入。main 从
    guest 本身（`hostWebContents`）知道标签在哪个窗口，不靠渲染端的标记。main 关于一个标签的事件（网页弹窗的 `new-tab`、`pressed`、
    `reveal`）在拿着这个标签的窗口里跑（`popupOpen.ts` `inBrowserTabWindow`：弹窗开在开它的标签旁边，桌子里也是）。
  - **按窗口的加固**（`main/browser/install.ts`）：一次安装，多个嵌入者——主窗口和每张加进来的桌子（`addBrowserWindow`）。每个嵌入者装同一套
    `will-attach-webview`（一次性票先作废再检查；webPreferences 整包换成固定的那份，`attachPolicy.ts` 不变）/ `did-attach-webview` / 主人输入
    钩子；票记下消耗它的窗口，回执里的 guest 必须正是那个窗口嵌入的（`hostWebContents`）。其它窗口从 webContents 出现那一刻
    （`web-contents-created`）就挂一个拒绝一切挂载的守卫（并作废票），直到被加为嵌入者；安装拆掉后也一直拒绝。加一张桌子不再拆掉别的
    （以前的单窗口安装再装一次会拆上一次）。
  - **顺序**：`DeskShell.openResponse` 只在浏览器已安装（`browserEmbeddable`）时给桌子 `webviewTag: true`；`adopt` 登记后第一件事就是
    `addBrowserWindow`，加不进去就自己拒绝这张桌子里的一切挂载。抢在 `adopt` 之前的挂载由上面的早期守卫拒绝。
  - **标签的窗口**：权限提示的原生对话框挂在标签所在的窗口，按那个窗口的可见 / 焦点（桌子最小化 = 不弹、提示主人）；下载的保存对话框由 Electron
    挂在 guest 的 owner window（= 嵌入者，桌子，实测）；智能体的下载要求标签所在的窗口在屏幕上；智能体操作的可见性 / 键盘焦点 / 焦点归还在那个
    窗口的文档里查；网页全屏退回的是那个窗口。后台 carrier 仍属主窗口，缩略图在任一应用窗口在屏幕上时画。N2 凭据只给已加入的嵌入者里的
    guest（或主窗口的 carrier）；按标签 + 来源的准入、分区（`persist:browser-<hostId>` / `persist:browser-agent-<hostId>`）不变。
  - **关桌子**：它嵌入的标签卸载（guest 关掉，租约照旧随卸载结束）、未绑定的 guest 关掉、它消耗的票作废、它的钩子移除；主窗口的标签不受影响。
  - **挪窗口 = 重载**（主人接受）：标签换了文档就重新挂载，页面重新加载（分区和登录还在）；智能体授予的标签和主窗口里一次重新挂载一样
    （租约随卸载结束，授予界面不变）。不重载的 carrier 交接以后再说。IPC 仍只从主窗口的渲染端来（桌子没有 preload）。
  - 测试：`test/multiWindowP5.test.ts`（桌子的挂载：偏好被换掉、一次性票、回执绑定窗口、网络准入；没加入的窗口一律拒绝且作废票；
    权限提示的父窗口 = 桌子、按桌子的可见性；桌子里的下载；弹窗的 new-tab 带开它的标签；N2 凭据；关桌子的清理；拆掉后拒绝；
    `DeskShell` 的 `webviewTag` 和「先加浏览器」的顺序，端到端），`test/multiWindowP5Renderer.test.tsx`（`<webview>` 由桌子文档创建；
    事件在拿着标签的窗口里跑）。
- **P4：智能体 HTML 页面和 HTML 文件在桌子里（2026-10-27，开关仍默认关）**。P1 的占位（`DeskPageNotice`）去掉；§10.2 的规则一条不放宽。
  - **租给画它的那一个窗口**：`frames` 的 `artifactPage` / `filePage` 请求可带 `deskId`；main 用 `DeskRegistry.placeFor` 解析成**那张桌子的
    webContents**（只认这个渲染端开的、仍开着的桌子，否则拒绝，什么都不读），共享 store 里的文档就租给它（store 的 `owner` 键 = 画它的
    webContents，「位置」）。`onBeforeRequest`（`frameRequestAllowed`）和桌子 / 主窗口各自的 `will-frame-navigate` 都只认租给**发请求的那个
    webContents** 的文档：主窗口的文档进不了桌子，一张桌子的进不了主窗口或另一张桌子。读主机期间桌子关了 → 不租（`placeOpen` 再查一次）。
  - **释放**：桌子关闭 / 销毁 / 主框架导航 / 渲染进程没了 → `releaseFrames(位置)`：`artifactPages.releasePlace` 作废绑在那里的页面通道（开着的
    确认框按取消关掉、什么都不发），`frameDocuments.releaseOwner(位置)` 删掉那里所有文档。主窗口重载 / 崩溃 / 关闭 → `releaseOwner(主窗口)`
    同时删掉它在所有桌子里的页面（桌子本来也一起关）。webContents id 不复用，租约不会落到以后的窗口。
  - **确认框的父窗口**：在 prepare 时就绑定（`Binding.place`），`page` 请求不再带窗口（P1 的 `deskId` 去掉，`page` 只有 `{ op, id, call }`）；
    `confirmParent(owner, place)` = 主窗口，或那张桌子（仍是这个渲染端的、仍开着），否则不弹、答 `unavailable`。同一时间仍只一个确认框（按渲染端）。
  - **渲染端**：`PageFrame` / `FilePageFrame` 用 `useDeskId()` 把桌子 id 带给 prepare；iframe 在容器自己的文档里建（`applyOpaqueFrame(doc.createElement("iframe"))`，
    属性不变）；broker 在**那个窗口**上收消息（页面的 `parent` 是桌子窗口）、仍只收这个 frame 实例 + `origin "null"`；复制的手势查 frame 所在文档
    （`frameGestureActive(frame, frame.ownerDocument)`：桌子文档的 userActivation + 焦点 + activeElement）。没有新通道、CSP / sandbox / 出口封锁不变。
  - 插件 frame 仍不进桌子：`plugin-sandbox` 握手在全局 `window` 上收（包里要改，另做）；插件文档仍只租给主窗口。
  - 预览：`?desks` 里把 demo-writer 移到桌子，点 `decide-0.2.html`：页面在桌子里画，自动保存可用，「发给智能体」的替身确认框画在桌子里
    （`dev/mockFrames` 按 prepare 时的桌子找文档）。
  - **上限**：store 的「每个 8」按 webContents 算，按桌子租以后一个 renderer 最多能占 5 × 8 = 40 > 共享的 32，主窗口的插件 frame 会拿不到文档；
    所以页面另按 renderer 合计封顶 8（`PAGE_DOCUMENTS_PER_OWNER`，§10.2），插件文档的位置留着。复审后补（2026-10-27）：IPC 的 prepare 一步
    抽成 `preparePlaced`（`main/frames.ts`）；桌子 `will-frame-navigate` 和释放的接线在假 BrowserWindow 上测；`PageFrame` 的容器文档没有
    window 时答 `failed`（不在别的窗口上挂 broker）；`placeOpen` 也查桌子的 webContents 没被销毁。
  - 测试：`test/multiWindowP4.test.tsx`（按位置租、跨窗口拒绝、CSP 不变、关桌子释放 + 确认框取消、主窗口释放、读主机时桌子关了、确认父窗口、
    没有新通道、桌子里的 PageFrame / FilePageFrame、broker 在桌子窗口上收、手势查桌子文档、`preparePlaced` 拒绝别人的 / 关了的桌子、按 renderer
    封顶）、`test/deskShellFrames.test.ts`（假 BrowserWindow：关闭 / 销毁 / 渲染进程没了 / 主框架导航都 `releaseFrames(桌子)`，子框架只认租给桌子的）、
    `test/deskWindows.test.ts`（`frameHostOf` / `placeFor` / `confirmParent`、真 store 跨窗口）。
- **P6：设置「多窗口」（2026-10-27）**。设置 → 通用 → 窗口 →「多窗口」（这台设备的界面偏好 `cutex-desktop.ui` 的 `multiWindow`，
  默认关；只在能开桌子的地方显示：Electron 应用、预览带 `?desks`）。旧的本地开关只认一次（`lib/multiWindowPref`）：还没存过这个设置时
  `"1"` = 开，载入时存成设置并删掉旧键；之后只看设置。`desksEnabled()` 读设置。
  - 关：没有「移到新窗口」/「在 桌子 N 打开」/「在主窗口打开」/「在新窗口打开」菜单项；桌子不启动，记住的桌子启动时不重开，但不删
    （`cutex-desktop.desks.v1`、各桌子的布局 / 托盘都留着，再打开后下次启动回来）。
  - 开着时关掉：只去掉菜单项；已经开着的桌子照常用到关掉（关掉照旧交回主窗口）。关着时打开：桌子马上启动（`followDesksSetting`），
    记住的桌子这时回来。
  - ~~main 不读这个设置~~（2026-10-27 起由 main 保存，见下一条）。
  - 预览：`?desks` 照旧给出模拟的桌子桥；设置里打开「多窗口」（模拟的 main 每次载入页面算一次「第一次运行」）。
- **多窗口归 main（2026-10-27，纵深防御）**。设置存在 main 的 `desktop-prefs.json`（`DesktopPrefs.multiWindow`，缺省 = 关），
  随 `ShellState.prefs` 给渲染端；渲染端只是镜像（`lib/multiWindowPref` `multiWindowOn` / `useMultiWindow` / `subscribeMultiWindow`，
  `desksEnabled()`、菜单、设置行、`followDesksSetting` 都读它；main 回答之前当关）。
  - 改动只有两条路，都经 `SHELL_CHANNEL`，非布尔值在 main 拒绝（`bad value`）：`setMultiWindow`（设置里的开关，主人操作）和
    `migrateMultiWindow`（渲染端的旧值，一次性迁移）。
  - main 关着时：`DeskRegistry.issue` 不发票、`admit` 不放行（开着时发的票关掉后也作废），不管渲染端怎么要。已经开着的桌子照常用到关掉
    （`resolve` / `frameHosts` / 窗口控制不受影响）；记住的桌子渲染端不重开，也不删。
  - 迁移（`shared/shell.ts` `openMultiWindowMigration` / `multiWindowChange`）：渲染端载入时读一次旧值（`cutex-desktop.ui` 的
    `multiWindow`，没有就看旧键 `"1"`），从本地删掉，启动时交给 main。main 只在**第一次**存这个设置的那次运行里收它：载入时
    `multiWindowMigrated` 不在就开一次迁移，并立刻把标记写盘；这次运行里第一次 `migrate`（开或关都算）或主人先动了开关，迁移就用掉。
    之后的运行、同一次运行里的重放都忽略——渲染端不能事后借迁移在主人背后打开多窗口，只有设置里的开关能改。
  - 测试：`test/multiWindowPrefMain.test.ts`（解析只认 `true`、ShellState 带它、setter 拒绝非布尔、迁移只一次且不能重放 / 跨运行、
    关着不发票不放行、关掉不拆已开的桌子、main 把开关接到 DeskShell）；`test/multiWindowP6.test.tsx` 改为跟 ShellState。
  - 测试：`test/multiWindowP6.test.tsx`（默认关、旧开关只认一次并删掉、存过的设置优先、菜单项跟设置、关着不启动不删记住的桌子、
    中途打开就启动、中途关掉不拆已开的桌子）。

## 25. 桌面底层与个人页（v1.18，窗格第 5 步）

设计与主人决定：`docs/research/home-page-20261019.md`（入口两个都要、可各自关；服务先只显示图标，模板磁贴随后；设置存在主机上；
不显示 @用户名；统计按所有主机、可以估算）、`docs/research/panes-20261019.md` §5；原型 `preview-home-page.html`（主人选「C 的背景 + A/B
的结构」，个人页和桌面分开）、`preview-shell.html`（桌面在窗格后面，名片打开个人页窗格）。

### 25.1 插槽 `pane.desktop`

```ts
interface PaneDesktopItem extends SlotItemBase {        // unavailable "hide"
  Desktop: ComponentType<{ reason: "empty" | "desktop"; hostId: string }>;
  useShowWhenEmpty?(): boolean;                          // 缺省 true
}
```

- 外壳（`components/PaneHost.tsx`）在**单个对话窗格没有 agent** 的位置画第一个显示的条目（不是窗格，是工作区的底层；工具列照旧在右边）。
  规则是纯函数 `lib/paneDesk.ts` `desktopReason`：设置页（全窗口）、两列对话或带工具窗格的会话、选中的 agent、打开的页面、首次运行引导
  都在前面时不画；「显示桌面」之后（`useDesktop.snapshot` 非空且对话窗格都空）= `"desktop"`，不看设置；否则 `useShowWhenEmpty()` 为真 =
  `"empty"`；都不是 = 今天的空状态。
- `NavItem` 加 `lead?: boolean`（画在侧栏最上面、置顶条目之前，不进「更多」、不能取消置顶）、`useShown?(): boolean`（false = 现在不画）、
  `useActive?(): boolean`（`run()` 目标的高亮）。
- `lib/paneActions.ts` `revealDesktop()`：屏幕上有窗格 = 显示桌面；没有 = 标记「主人要看桌面」（快照为空数组，不切回），打开对话后自动清掉。

### 25.2 内置模块 `home`（`modules/home`）

| 条目 | 作用 |
|---|---|
| `pane.desktop` `home.desktop` | 全幅背景（主页封面，否则启动页立绘 + 天空底色，即原型 C）上的半透明卡片：名片（头像、显示名、简介；点 = 个人页）、时钟 / 日期、「需要你」（同 `NeedsYouStrip` 的数据：需要你 + 出错）、用量条（今天 / 本周 Token、{{agents}}数、连续使用天数）、固定的磁贴；区块按设置的顺序和开关 |
| `pane.kind` `home.profile` | 个人页：single / none（进工具列）；封面、头像、显示名、简介、累计 Token（近一年）、最长 / 当前连续天数、一年的活动热力图（每天、所有主机） |
| `nav.primary` `home.nav` | `lead` 入口「桌面」= `revealDesktop()`；`useShown` = 设置 `sidebarEntry`（缺省开） |
| `ref.action` `home.pin` | 「固定到主页 / 取消固定」：种类 `agent`、`service`、`artifact`、`artifacts.view`、`browser.tab`（服务页的行菜单、对话里的服务卡片、成果标签菜单、agent 菜单、浏览器标签） |

- **存储**：`GET/PUT /v2/users/me/home`（cutex `user-home`），带 revision；编辑先在本地生效（队列里的编辑叠在最后确认的文档上），409
  `home_revision_conflict` → 重读主机上的文档、把同一个编辑再做一次（最多 3 次）。主机没有 `user-home`（或路由缺失）→ 存在本机（模块 prefs
  `local`，和书签一样）。主页主机：本机主机（已连接）否则第一台主人主机，它的设置里 `homeHost` 指向另一台已连接的主人主机时用那台。
  封面 `PUT/DELETE /v2/users/me/home/cover`（≤ 2 MiB，PNG / JPEG / WebP），图片由 main 读成 data: URL。
- **磁贴**（尺寸 s / m / w / l）：服务 = 图标 + 名字 + 运行状态点 + 主机标记；主机有 `service-tiles` 且服务给了模板时按尺寸画模板（标题、副标题、
  ≤ 3 行、图片、进度、角标、≤ 3 个操作）。模板在 main（cutex-client `readServiceTile`）和渲染进程（`modules/home/tile.ts`）各检查一次：只有文字；
  图片和操作只能是服务内的路径，操作打开 `cutex:service/<slug><path>`（应用内浏览器），从不调用接口。成果 = 图标 + 标题；agent = 头像 + 名字；
  链接 = 浏览器标签。点磁贴 = 打开对应窗格（对话进空窗格，其他进工具列）。
- **编辑主页**（桌面右侧面板 / 个人页里；桌面上的面板是工作行的一张卡片，清单 #16：`.shell-card` 的材质 / 圆角 / 阴影，贴工作行的上、右、下边
  （`lib/trayModel` `deskGeometry` 的 `panel` = 0 / 0 / 0，宽 `DESK_PANEL_W` 312 盖住桌面右栏），卡片顶栏 h-10 + 细线 + 标题 + ×）：封面（选图片 → PUT，或「使用立绘」= 删除封面）、简介、区块开关和顺序、两个入口开关、主页主机
  （多台主人主机时）；磁贴拖动排序、大小、×。
- **统计**：每台已连接主机 `/v2/usage`（按天，366 天 = cutex 上限）相加，客户端算今天、本周（周一起）、连续天数、热力图（四分位，一种颜色由浅到深）。
- 预览：`?desktop`、`?homeprofile`、`?homeedit`（`dev/devDesktop.ts`），`?nocover`、`?homeconflict`、`?legacy`（没有 `user-home`：存本机）。

### 25.3 托盘与桌面底层（v1.20，原则 §7，主人 2026-10-21）

```ts
interface PaneDesktopItem extends SlotItemBase {        // unavailable "hide"
  Desktop: ComponentType<PaneDesktopProps>;
  useShowWhenEmpty?(): boolean;
  Dock?: ComponentType<PaneDockProps>;                   // v1.20：托盘里的快捷方式
  useDockCount?(): number;                               // v1.20：几个（0 = 没有可放的）
}
interface PaneDesktopProps { reason: "empty" | "desktop" | "covered"; hostId: string; tray?: boolean }  // v1.20 "covered" / tray
interface PaneDockProps { placement: "desktop" | "overlay"; onUsed(): void }
```

- 桌面是真正的底层：外壳（`components/ChipTray.tsx` `DesktopStage`）把第一个显示的 `pane.desktop` 条目挂在整个工作区（会话 + Shelf）
  后面，一直挂着；有窗格在前面时 `reason = "covered"`（藏起来），不再画「空窗格」盖住它。（2026-10-21 起背景画在整个窗口后面、盖住时只藏内容：§25.4。）`tray` = 托盘浮在桌面底部（内容要让开）。
- 托盘 = pin-everything 的快捷方式（`Dock`，第一步只固定对话；`home` 模块：和桌面磁贴同一份固定列表，尺寸只影响桌面）+ 用「—」收起的工具
  窗格。桌面在屏幕上时浮在桌面底部；被窗格盖住时是底部中间的一条细线，鼠标停在窗口底边 / 点线 / Ctrl/⌘+J 浮到窗格上（不推开它们），用完收回
  （`lib/trayModel.ts`、`lib/trayStore.ts`）。角标来自 cutex：需要你（琥珀色，唯一带数字的）、运行中、未读、出错；服务 = 健康。每个快捷方式
  有自己的打开方式（替换 / 并排 / 投影，缺省替换，存本机），打开、拖出、「在屏幕上」都走 §24.13 的 `lib/workspaces`。
- 只加不删：v1.18 的条目照常工作（没有 `Dock` = 托盘只有收起的工具窗格；`reason` 多一个值）。声明快照 `module-api-1.20.d.ts`（只有版本常量）；
  `test/moduleSdkContract.test.ts` 有 `Dock` / `"covered"` 正反例；`test/tray.test.ts`、`test/trayStage.test.tsx`。

### 25.4 卡片下面的桌面背景、卡片材质、单个对话的宽度（主人 2026-10-21，契约不变）

- **桌面背景永远是整个窗口的底层**：外壳（`components/ChipTray.tsx` `DesktopBackground`，挂在 `App.tsx` 根的第一个子元素，根是
  `isolate`，背景 `z-index: −1`，`inert`，不接指针）把第一个显示的 `pane.desktop` 条目以 `reason = "covered"`（只画背景：主页封面，
  否则启动页立绘，否则天空渐变）画在所有卡片（侧栏卡片、会话、Shelf、Rail、窗口顶栏）后面；卡片之间的缝和四周的边距露出它，不再是平的窗口色。
  窗口顶栏在背景上加一层浅的毛玻璃（`[data-window-titlebar]`）。没有 `pane.desktop` 条目 = 仍是窗口色。
- **盖住时只藏内容**：`DesktopStage` 只在没有东西在前面时（`"empty"` / `"desktop"`）画桌面的内容（名片、磁贴、时钟、需要你、用量）；
  盖住时内容不画、盒子 `inert`，背景照旧从缝里露出来。取消了「盖住 → 整层藏起来」。`home` 模块的内容模式不再画第二份背景（只画立绘署名）。
- **编辑主页点了没反应（2026-10-21 修）**：桌面在屏幕上时工作行 `[data-side-work]`（`z-index: 1`，铺满工作区）盖在桌面层（`z 0`）上面，
  只有空的主卡片 `pointer-events: none`，工作行自己接住了所有点击——编辑主页、磁贴、名片都点不到。现在工作行 `pointer-events: none`，
  只有它的 Shelf / Rail 子元素接指针（`components/tray.css`；`test/deskGaps.test.tsx`）。
- **卡片材质**（设置 → 外观 → 窗口与卡片，本机 `appearance.cardMaterial` / `cardOpacity`）：不透明（缺省，今天的样子）/ 亚克力：
  `.shell-card`、`.sidebar-card`（两种模式）、`.shelf-rail-card`（收起的 Shelf Rail、另一个工作区的 Rail（拖放高亮时也是）、设置 Shelf 的分类 Rail）= 卡片色 × `--card-alpha`（70–95 %，
  缺省 82 %）叠在 `--acrylic-filter`（模糊，再把背后的对比度压向浅色 / 深色）后面的桌面上；菜单、弹出框不变。`lib/workSurface.ts`
  有同一组滤镜参数的对比度模型：最低不透明度下正文 ≥ 7:1，缺省下次要文字 ≥ 4.5:1（所有配色、黑 / 白 / 原色背景），默认配色在最低不透明度下
  次要文字也 ≥ 4.5:1。贴边显示时（下一条）不用亚克力。
- **窗格铺满时占满整个窗口**（2026-10-21 起拆成两样：宽度 = 「工作区宽度 → 铺满窗口」，贴边 = 「贴边显示」，§24.15；旧的 `fillWindow: true`
  读作两样都开）：贴边显示开着并且窗格铺满工作区（桌面内容不在屏幕上）时 `<html data-edge-to-edge>`：工作行没有边距、底色是卡片色，卡片没有
  圆角和阴影，侧栏贴左边，桌面背景隐藏（`edgeToEdge`）。只开铺满窗口不贴边：卡片保持圆角、缝隙、阴影。
- **单个对话的宽度**（`singleColumnWidth`）：只有一个对话（没有页面盖住、没有最大化）时主卡片宽 = 阅读宽度 + 卡片边框（文字正好铺满卡片，
  两边不留白），和它的 Shelf 一起居中（工作区宽度「按内容」，§24.15；铺满窗口时铺满），桌面从两边露出来；空间不够（差不到 24 px）= 铺满。设置「单个对话的默认宽度」：
  阅读宽度（缺省；阅读宽度 = 全宽时铺满）/ 全宽 / 自定义百分比（工作区的 30–100 %）。卡片两边的缝里有拖动边（`SingleColumnEdges`：两边一起动、
  中心不动、碰到最小宽度或两边 Shelf 要出行时停（`centredWidth`；只有一侧有 Shelf 时整组离开中心，松手后留在那里，§24.15 宽度规则 4）；
  拖动时只改卡片 / 行的 style，松开存 `appearance.singleColumnW`；方向键微调；双击 = 回到默认并重新居中），换默认方式时忘掉拖出来的宽度。
  比阅读宽度宽时阅读列照旧在卡片里居中（两侧给浮动胶囊、书签、批注、边栏）。Shelf 打开 / 关闭、第二个工作区出现 / 消失时会话滑到新位置
  （`lib/columnGlide.ts`：`[data-glide]` 的元素测量前后位置，translate + 宽度，220 ms；减少动态效果时不动；Shelf 自己收起 / 展开时已经逐帧跟着走，
  不再加第二个动画）。
- 只加不删、无新插槽，`MODULE_API_VERSION` 不变（`PaneDesktopProps` 的含义见 `modules/slots.ts` 注释）。
- 测试：`test/deskGaps.test.tsx`（背景永远在底层：几何 / 顺序 / 不接指针 / 盖住时只藏内容；编辑主页回归；材质字段、类、滤镜 = 模型、各配色对比度；
  铺满规则和 CSS；宽度计算、拖动、设置；滑动）、`test/trayStage.test.tsx`。

- **空的占位没有材质（2026-10-21 修）**：亚克力时中间空的主卡片（桌面在屏幕上时）被画成了亚克力。原因：材质规则用 `:is(...)` 列卡片，`:is()`
  取最具体的参数（`.sidebar-card[data-sidebar-mode="rail"]`），整条规则的特异性 (0,5,0) 和 `tray.css` 里清空空主卡片的规则一样；`styles.css`
  在 `tray.css` 后面（`main.tsx` 先 import App），于是材质规则赢了。现在卡片列表放在 `:where(...)` 里（(0,3,0)），任何占位规则都压得过它
  （`test/deskGaps.test.tsx` 按应用里的顺序加载两份 CSS 回归）。

### 25.6 桌面亮度（主人 2026-10-21，契约不变）

- 设置 → 外观 → 窗口与卡片 →「桌面亮度」三个滑块（0–100 %，本机 `appearance.deskEmpty` / `deskOpen` / `deskFull`，缺省 100 / 80 / 60）：
  **没有窗格时**（桌面内容在屏幕上）、**有对话或页面打开时**、**窗格占满屏幕时**（对话 / 工具窗格最大化或全屏、设置 Shelf 最大化、全窗口页面、
  工作区宽度 = 铺满窗口，或智能且两个工作区）。规则 `lib/workSurface` `deskState`；`lib/deskBrightness` `useDeskState`（`DesktopStage` 里）给 `<html>` 标
  `data-desk-state`；`components/tray.css` 用 `--desk-veil-*`（背景上一层黑色，`.window-desk::after`）和 `--desk-filter-*`（桌面内容
  `brightness()`，100 % 时为 `none`，低于 100 % 时内容里的毛玻璃卡片只模糊它自己层里的东西）。切换时 0.45 s 渐变，减少动态效果时立即切换。
- 测试：`test/deskGaps.test.tsx`（字段与范围、状态规则、渲染时的标记、CSS）。

### 25.5 托盘是停靠在边上的面板（主人 2026-10-21，契约不变）

- 主人找不到、也点不到托盘收起后的细线。现在托盘是**窗口工作区（标题栏下面：工作行 + 设置 Shelf）边上的面板**：外壳
  `components/ChipTray.tsx` `TrayFrame`（`App.tsx` 包住工作行）在停靠的那条边给它**一条自己的带**（布局的一部分，工作行拿剩下的，
  窗格变小、从不被盖住）；树的形状对每条边都一样（上 / 左用 CSS `order`），换边不重新挂载窗格。`DesktopStage` 只把「有什么可放、
  桌面是否在屏幕上、是否全窗口页面」报给 `lib/trayStore` `useTrayStage`，不再自己画托盘；桌面内容不再给托盘留底边（`tray` 恒为 false）。
- **托盘常驻**（缺省开，设置 → 外观 → 窗口与卡片，本机 `localStorage` `cutex-desktop.tray`，`lib/trayPrefs.ts`）：一直是带里的一条矮条
  （`"docked"`，带宽 `TRAY_BAND_PX` = 52）。**关**：桌面在屏幕上时同样是矮条；窗格在前面时收成一条 14 px 的带里的小胶囊把手
  （`"handle"`，整条带都能点；停一下 / 点它 / Ctrl/⌘+J → 浮到窗格上 `"overlay"`，带不变、窗格不动，用完收回，规则同 §25.3）。
  没有可放的东西、全窗口页面、设置 Shelf 最大化 = 没有托盘。规则：`lib/trayModel` `trayPlacement` / `trayBand` / `paneArea`。
  停在底部时（#36）是会话下面的卡片（`lib/trayRoom`）：**图标放不下不再退回底条**，后面的收进「… N」，点开是带名字的列表（`lib/trayFold`，
  `ChipTray` `TrayOverflow`，设计 038，主人 2026-10-23：设置 Shelf 打开时底条把侧栏、Shelf、设置 Shelf 都压矮了）。两个会话中间夹着 Shelf、
  或会话窄得放不下「… N」（只看 Shelf 的窄条）时，卡片横跨会话**和它们的 Shelf**（`"wide"`：Shelf 也在底部让出位置），从不横跨侧栏和设置 Shelf；
  只有什么都放不下时才是底条。
- **停靠在底部（缺省）/ 顶部 / 左侧 / 右侧**：左右是竖排（`aria-orientation`，↑↓ 移动）；左右时在侧栏卡片和 Shelf 外面、贴窗口边。
  拖托盘开头的把手（`[data-tray-grip]`）：四条边亮起放置区，离指针最近的那条（按工作区宽高的比例，`trayDropEdge`）高亮，松开 = 停在那里；
  Esc 取消。点把手、右键托盘空白处或把手 →「停靠在… › 底部 / 顶部 / 左侧 / 右侧」「托盘常驻」。托盘里的菜单（含 `Dock` 条目的菜单，
  `lib/trayMenu` `openTrayMenu`）朝远离那条边的方向打开。
- `Dock` 收到的 `placement`：带里 = `"desktop"`（在屏幕上，不是临时浮出），浮出 = `"overlay"`（契约 1.20 不变）。外观保持轻：小图标、
  无文字、半透明毛玻璃、圆点角标、在屏幕上的下划线（左右时在外侧的竖线）、打开方式、和桌面磁贴共用固定列表。
- 已知：`lib/workspaces` 的「两个工作区时侧栏自动收成窄栏」按窗口宽减去设置 Shelf 计算，没有减去左 / 右托盘的 52 px。
- 测试：`test/tray.test.ts`（位置规则、带宽、窗格区域不与带相交、放置边、方向键、存储解析）、`test/trayStage.test.tsx`（常驻：带在工作行旁边、
  不在里面、高度 = 带宽，换边 / 关常驻不重新挂载工作行；自动隐藏：把手是按钮、点击 / 停留 / Ctrl+J 浮出、Esc 收回、右键可开常驻；左右竖排、
  ↑↓；菜单停靠；拖把手的放置区、松开停靠、点击不开菜单、Esc 取消；本机存储读回）。

## 26. 窗口顶栏与会话顶栏（v1.19，主人 2026-10-21 选「顶栏拆分 A」）

原型 `.claude/preview-design-v1.html` §1（`#s1-a`、`#s1-a+2col`）；原则 `docs/research/canvas-principles-20261020.md` §3。

### 26.1 插槽 `window.search`

```ts
interface WindowSearchItem extends SlotItemBase {      // unavailable "hide"
  placeholderKey: MessageKey;                           // 框里的字（能搜什么）
  keys?(): string;                                      // 框尾的快捷键，按平台（"Ctrl K" / "⌘K"）
  open(): void;                                         // 点框
}
```

- 外壳（`components/TitleBar.tsx`）在窗口顶栏中间画第一个显示的条目；没有条目 = 没有搜索框。唯一贡献者：`quick-switch.search`
  （必需、锁定开启的 `quick-switch` 模块，点 = 打开快速切换面板）。

### 26.2 窗口顶栏（只留整个窗口的东西）

左：智能体列表开关（logo，Ctrl/⌘+B）+ 主机范围（`HostSwitcher`）；中：全窗口页面（带 `Aside`）的面包屑（`PageTitle`；v1.21 起别的页面的
面包屑在它自己的顶栏里，§26.4）+ 搜索框（§26.1）；右：显示桌面、
启动器栏（固定的启动器、＋ 新建 / 布局 / {{shelf}} 菜单、侧栏开关，`components/side/TitleBarLaunchers`）、窗口按钮。窗口顶栏不画任何对话的东西
（`test/modules.test.ts`、`test/convHeader.test.tsx` 检查）。

### 26.3 会话顶栏（`components/ConversationHeader.tsx`，`lib/convHeader.ts`）

- **每个**会话都有（单独一列、两列并排、旁边有工具窗格），各显示自己窗格的主机 + agent（`convHeaderInfo(sidebarOf(host), sessionId)`），
  不看选中项。第一行：头像、名字（点 = agent 菜单）、角色（{{director}}）、项目片 + 星标；右边 在线 / 离线（点 = 启动 / 停止运行时，停止点两次）、
  通知（静音菜单）、互联（这个 agent 的服务数，点 = 服务列表），然后窗格自己的 **2×2 按钮块**（主人 2026-10-21，取代一排的 ⤢ / 「—」 / ⋯；
  `lib/convPaneControls.ts`）：上排 **{{Shelf}}**（这个对话的 Shelf：展开的 = 收成 Rail，收着的 = 展开；另一个工作区的 = 先聚焦它再展开；
  空的 = 「＋ 打开 {{shelf}}」启动器菜单，选的开进这个对话的 Shelf——「{{shelf}} Rail 常驻」关着时空的 Shelf 没有 Rail，开着（缺省）时还有一条空 Rail，§24.12.3）和 **放大**（最大化 / 还原，一个人时也可以；长按 = 全屏，§24.16）；
  下排 **关闭**（× 图标，提示「关闭窗格（{{agent}}继续运行）」= `closeWorkspace`；第一次关的时候提示「已关闭，可以从侧栏或托盘找回」，只一次，
  本机记住 `cutex-desktop.paneCloseHint`）和 **⋯**（两个工作区时「移到左边 / 右边」、窄列收进来的项、这个 agent 的菜单）。顶栏只有一行时四个
  排成一行。（v1.21：没有页面的部分——页面是自己的窗格，或盖在会话上时用页面自己的顶栏，§26.4。）第二行：主机 · 目录（保留结尾）· ⎇ 分支（悬停显示 +/−）；设置「标题栏显示两行」关掉时不画。
- 分支：选中的 agent 用 App 的工作区监视（与工具列共用）；旁边那列读一次 `gitStatus`（它拿到焦点就变成共用的那份）。
- 窄列：按宽度依次把 **互联 → 通知 → 项目片** 收进 ⋯（`convHeaderFolded`，低于 560 / 500 / 440 px），⋯ 菜单按同样顺序列出收进去的项（子菜单）。
  测试 `test/convHeader.test.tsx`、`test/convPaneControls.test.tsx`（2×2 / 一行、空 Shelf 的启动器、展开 ↔ 收起、关闭的提示只一次、放大）。
- 整个顶栏是这一列的拖动把手，双击 = 最大化 / 还原（窗格第 4 步，§24.11；§24.16）；按钮都带 `data-side-nodrag`。⋯ 菜单第一项 = 全屏。
- 输入框不变。外壳文件 `PaneHost.tsx` 只引用这个组件，仍不点名任何功能。

### 26.4 页面的顶栏（v1.21，主人 2026-10-21：页面是自己的面板）

- 页面从不出现在会话顶栏下面。缺省（「页面打开位置」= {{shelf}}）它是聚焦对话 Shelf 里的一个窗格，顶栏 = Shelf 窗格头（页面入口的图标、
  面包屑连成的标题、放大 / 全屏 / ⋯ / 收起 / ×；§24.4）。
- 占用会话时这一列画 `components/PageHeader.tsx`（不是 `ConversationHeader`）：页面入口的图标、面包屑（`PageTitle` `PageCrumbs`，前面的段
  可点，右键 = `ref.action`）、放大（最大化这一列，§24.16）、×（关页面，回到对话）、⋯（在 {{shelf}} 中打开 = 关掉这里、开进 Shelf；全屏；关闭页面）。
  双击顶栏 = 放大 / 还原。单独一列和并排两列都一样（`PaneHost` 的单列分支也画它，页面不再连顶栏一起盖掉）。Esc（焦点不在输入框、不在 Shelf）
  = 关页面（`lib/escChain` `close-page`，§19.10 第 5b 行）。
- 窗口顶栏只给全窗口页面画面包屑（§26.2）。测试 `test/pagesOwnPane.test.tsx`（Shelf 窗格与它的标题 / 图标 / 正文、参数更新同一个窗格、
  侧栏入口、⌘K 的 `panes.open`、深链参数、占用会话的页面顶栏、× 和 Esc、⋯ 在 Shelf 中打开、会话顶栏没有页面部分）。

## 27. 桌面小组件 `desktop.widget`（v1.22；v1.23 整格，设计 032）

主人 2026-10-22：「平台，而不是产品」——桌面上的东西要有底层的模型、框架和接口，做几个例子，写好说明，让便宜的模型也能照着加。设计
`docs/design/032-desktop-widgets.md`（为什么这样定、来源、权限、版本）；写一个小组件的步骤 `docs/widget-authoring-guide.md`；模板
`docs/widget-template/`。

### 27.1 条目与组件（`modules/widgetTypes.ts`）

```ts
interface DesktopWidgetItem extends SlotItemBase {
  titleKey; descriptionKey?; icon;
  size: { min: [w, h]; max: [w, h]; default: [w, h]; presets?: Record<string, [w, h]>; ratio?: number; resizable?: boolean; // 单位：1.22 步长（WIDGET_STEP = 8 px）
          cells?: { min: [w, h]; max: [w, h]; default: [w, h]; presets?: Record<string, [w, h]> } };                 // v1.23：整格（WIDGET_CELL 96 px，间距 WIDGET_GAP 16 px）；没写就按 cellsOfSteps 换算
  shape?: "card" | "round" | "path" | "bare"; clipPath?: string;  // 外框对齐网格；看得见的形状可以不是矩形（030 v2 §1）
  instances?: "owner" | "module"; multiple?: boolean;            // 主人增删（存在 desk.items）/ 模块列出（useInstances，例：每个固定一个）
  defaultPlace?: { area: "header-left" | "header-right" | "side" | "main"; order: number };
  settings?: WidgetSettingField[]; defaults?: WidgetSettings | ((locale) => WidgetSettings);
  useInstances?(): WidgetInstanceRef[]; remove?(instanceId): void;
  refresh?: "minute" | "second";                                    // 共用的计时器，组件不自己开定时器
  source?: WidgetSource;                                             // { kind: "module" } | { kind: "service", hostId, slug } | { kind: "agent", hostId, sessionId, artifactId? }
  Widget: ComponentType<DesktopWidgetProps>;
}
interface DesktopWidgetProps {
  instanceId; width; height; steps: { w; h }; cells: { w; h } /* v1.23 */; theme: "light" | "dark"; settings; setSettings(next); reducedMotion; arranging; now; hostId; source;
  actions: { openAgent(hostId, sessionId); openPage(page, params?); openService(hostId, slug); sendToAgent(hostId, sessionId, text) }; // v1.22：sendToAgent 恒为 false（保留）
}
```

- 设置表字段：`text`（`maxLength`）· `number`（`min` / `max` / `step`）· `toggle` · `select`（`options`）· `timezone`（IANA）· `list`（一组平的字段，
  `min` / `max` 行，`itemDefaults`）。外壳在编辑主页的面板里画表单（`modules/home/WidgetSettingsForm.tsx`），每改一下就存；存的值按表检查，
  不合格的用缺省（`modules/home/desk.ts` `settingsOf`）。
- 组件只经自己模块的窄服务读数据、只经 `actions` 做事；整理中（`arranging`）外壳拿走指针，组件画成不可点的样子即可。外壳把组件包在
  `ItemBoundary` 里：一个小组件出错只显示那一块的错误。

### 27.2 外壳（模块 `home`）

- `modules/home/DeskSurface.tsx`：读 `desktop.widget`，主人实例来自 `HomeDoc.desk.items`，模块实例来自各种类的 `useInstances`（每个种类一个
  子组件取，避免钩子顺序随种类变）；按工作行宽度分档（窄 < 760 · 中 < 1280 · 宽）取这一档的外框：存过的、或从最近一档按贴边推导、或缺省布局
  （v1.23：`modules/home/deskCells.ts`，纯函数，整格；格子在桌面宽度里居中）。整理：长按 400 ms / 编辑主页 / 右键「整理桌面」；整理时
  格子淡淡地显出来；拖到整格上、功能块之间按 030 Q2（一样大互换、否则就近避让）、右下角按整格改大小（种类的上下限、比例）、方向键一格 /
  Shift 四格、Ctrl/⌘+方向键改大小、Delete、Ctrl/⌘+Z、Esc；每次改动写一次这一档（`HomeDoc.desk.cells[band]`，整格，带贴边）。1.22 的摆放
  （`desk.bands`，px）读的时候换算一次（`migratePxBand`：大小取最近的格数，位置按贴边取最近的格子，重叠的去最近的空地，没有就往下放），
  不写盘；主人改了这一档才写进 `cells`。`bands` 原样留着当备份（旧版本的桌面照旧读它）；右键「恢复换大格子前的摆法」= 去掉这一档的
  `cells`，重新从备份换算。
- `modules/home/desk.ts`：`HomeDoc.desk = { v: 1, items: [{ id, kind, settings? }], off?: [kind], bands: { n?|m?|w?: { width, at: { id: { x, y, w, h, ax } } } },
  cells?: { n?|m?|w?: { cols, at: { id: { x, y, w, h, ax } } } } }`（v1.23 `cells` 的数都是整格）；
  没有 `desk` 时按旧的 `blocks` 算出缺省（不写盘）；增删实例时同步旧的 `blocks.visible`，磁贴改大小时同步 `pins[].size`（最接近的快捷大小），
  还没升级的桌面照旧能显示。
- `modules/home/deskEnv.ts`：共用计时器（每种节奏一个，按整分 / 整秒对齐，第一个用的开、最后一个走了停）、配色、减少动态效果。
- 内置小组件（`modules/home/widgets.tsx`）：`home.profile`、`home.clock`（无底板，今天的样子）、`home.needs`、`home.stats`、`home.tile`（模块实例 =
  固定列表，服务的来源是那个服务）。别的模块：`world-clock.clock`（`modules/world-clock`，指南里的例子）。

### 27.3 测试

`test/deskCells.test.ts`（v1.23：整格、放下的规则、推导、缺省布局、1.22 摆放的换算、1.22 声明换算）、`test/deskLayout.test.ts`（1.22 的步长、参考线、
放下的规则、分档和贴边、缺省布局）、`test/deskModel.test.ts`（`HomeDoc.desk`、迁移、设置检查、
同步旧字段、共用计时器）、`test/deskSurface.test.ts`（实例、分档取外框）、`test/worldClock.test.tsx`（时区计算、缺省、画出来的、设置表单）、
`test/moduleSdkContract.test.ts`（插槽缺省、编译期形状）。

> **0.2 变更（2026-10-23，设计 039，feat/0.2-workspace-groups-2）**：托盘 = 钉住 | 最近（≤ 6 个工作区）| 应用。工作区 = 并排的一组对话列，
> 记在 `lib/workspaceSets.ts`（localStorage `cutex-desktop.trayWorkspaces`，由布局变化推导）；钉住的胶囊存进首页 `pins`（agent 钉住 + `members`）。
> 普通点 = 切换到那个工作区（不再替换列）；替换 = 拖放 / 列菜单「替换这一栏…」；Ctrl/⌘+点已满 = `ColumnPickLayer` 选一列。
> `MAX_CONVERSATION_COLUMNS` → `maxConversationColumns()`（设置「允许 3 列」）。`trayPrefs.grouping` 删除。‹ / › 右键 = 小菜单；手势表在 设置 → 键盘快捷键（`lib/gestures.ts`）。

## 28. 引导和提示（Guides，主人 2026-10-24）

所有教人的东西——入门引导、锚定提示、表单里的说明面板——都登记在一张表里：`lib/guides.ts` 的 `GUIDES`。入门引导（`components/OnboardingDialog`）、提示（`components/FirstUseTips`）、面板（`components/InlineGuide`）和「设置 → 帮助」（`modules/onboarding/HelpPage`）都只读这张表。

- 条目：`id`、`kind`（`onboarding` / `tip` / `inline`）、`since`（从哪个版本起出现）、可选的 `retireAfter`（最后出现的版本；之后不再出现，也不在帮助里列出）、`title` / `text`（文案键，可用 `{{agent}}` 等称呼；帮助显示 `text` 的第一行）、提示的 `anchor`（CSS 选择器）+ 可选 `when(anchor)` 进一步判断、`trigger`（`appear` 默认：锚点出现在屏幕上；`hover`：鼠标停留或获得焦点）、可选 `settings`（「打开相关设置」）和 `related`（「也看看：…」）。
- 状态（每台设备）：`localStorage["cutex-desktop.guides"]` = `{ schema: 1, seen: string[], asked: boolean }`。只记 id，所以加一条不需要迁移；退役条目的 id 留着也无害。
- 第一次有引导要出现时问一次「要看引导和提示吗？」（看 / 全部跳过）。全部跳过 = 当前版本里所有在用的条目记为已看；以后新增的条目照常出现（每条提示自带「跳过所有引导」）。帮助里「重置所有提示」把提示和面板恢复成未看，「再看一次」单独恢复一条（入门引导是直接重放）。
- 加一条提示：在 `GUIDES` 里加条目（`since` = 要发布的版本），在 `modules/onboarding/i18n.ts`、`i18n.en.ts`、`i18n/zh-Hant-CN.ts` 加 `guide.<名字>.title/text`；锚点没有稳定的 `data-*` 属性就在组件上加一个。只给行为出人意料、手势看不见、或当下就要知道后果的地方加；一次一条，小，靠着锚点，不挡操作。`test/guides.test.ts` 会检查文案和锚点都在。
- 退役一条：设 `retireAfter` 为最后一个还要显示它的版本，不要删条目（删掉后帮助和测试里也就没有了它的历史）。确定没有用户还停在那些版本时再删。
- 预览：`?tips`（提示随锚点出现）、`?tips=ask`（新设备，先问）、`?tip=<id>`（只看这一条，马上显示）、`?help`（打开帮助）、`?onboarding=ask`（新设备上的自动入门引导）。
- 主机上的选择（cutex r258 `guides.preferences`）：`lib/guidesHost` 在启动时读主人的 `skippedThrough`。还没回答过「要看引导和提示吗？」的设备才采用它：版本 ≤ `skippedThrough` 的条目记为已看；全部覆盖就不再问、入门引导记为完成；只覆盖一部分则照常问，但「全部跳过」是预选按钮。问题最多等主机 3 秒。「全部跳过」写回当前引导版本（在用条目里最新的 `since`），「重置所有提示」写回 null。每条提示看没看过仍只记在本机。
- 谁创建的（cutex r258 `session-created-by`）：侧栏行带 `data-created-by`（director / member / agent / owner / system；未知则没有）。`tip.directorCreated` 锚在主管自己建的那一行，并覆盖 `tip.minorAgent`；没有这项记录（旧 cutex、旧会话）时由 `tip.minorAgent` 解释小方块。预览：`?guidesSkipped=0.2.0`（主人在别的设备上全部跳过过）。
