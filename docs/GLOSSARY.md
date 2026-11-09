# 桌面用语表 / Desktop glossary

One set of words for the owner, people and agents (owner-approved 2026-11-05). Names follow the zh-CN UI
text, then `docs/DESIGN.md` and `docs/design/026-panel-names.md`; older or other names are in parentheses
as aliases. Code identifiers are listed only so you can find things; nothing in code was renamed for this
file. Component paths are under `apps/desktop/src/renderer/src/`. A picture version for the owner, with
the same names on a screenshot: [`docs/glossary-map.html`](glossary-map.html).

Term words such as 智能体 / 主管 / Shelf come from Settings → 通用 → 用语 (`lib/terms.ts`). This owner
uses Maid / Chief Maid / Maidling, so screens may read 「44 个 Maid」 where the default is 「44 个智能体」.

## Where things are

```
┌ 窗口顶栏 ──────────────────────────────────────────────────────────────────────────────┐
│ Logo · 主机选择「所有主机」· 入口图标… ⋯ │ ⌘K 搜索 │ 启动器… · ＋ · Shelf 开关 │
├ 侧栏 ───────────┬ 会话 ──────────────────────────────────┬ Shelf ──────────────────────┤
│ 搜索            │ 会话顶栏：头像 名字 角色 状态 🔔 ⋯       │ Rail │ 页：项目视图          │
│ 项目分组        │          项目 · 主机 · 路径 · 分支      │ (页签│  计数 · 主管卡        │
│  ├ 主管行       │ 工具条（搜索·书签·批注）… 状态胶囊        │  栏) │  运行中 · 最近活跃     │
│  ├ 智能体行     │ 时间线                                  │      │  空闲 N               │
│  ├ 离线 N · 全部│                                         │      │  动态                 │
│  └ 还有 N 个    │ 状态行：需要你 · 委托 2 · 闹钟 1         │      │                       │
│ 文件夹          │ 接下来（队列卡）                         │      │                       │
│                 │ 输入框                                  │      │                       │
│ 身份 · 设置     │ 输入框底栏：＋ 权限 规则 │ Profile 配额 模型 │ │                       │
├─────────────────┼ 托盘：钉住/最近的头像 │ 应用 │ 后台操作 · 通知中心 ┼──────────────────────┤
└──────────── 桌面（最底层，卡片之间露出来的部分）──────────────────────────────────────┘
```

## 窗口外框 Window frame

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 窗口顶栏 | title bar | The row at the very top of the window. | `components/TitleBar.tsx` |
| 主机选择（所有主机 / 本机） | host switcher | Picks which hosts the window shows. | `TitleBar.tsx` `HostSwitcher` |
| 入口图标（钉住的导航） | nav entries | Pinned page icons: 新建, 快速启动, 委托, 审批… The rest are under ⋯. | `components/SidebarNav.tsx`, `lib/navPins.ts` |
| ⌘K 搜索（快速切换） | quick switcher | Search box to jump to agents, services, 成果 and pages. | `modules/quick-switch` |
| 窗口布局（恢复默认布局） | layout reset | 「恢复默认布局」, the last item of the ＋ menu; there is no title-bar layout button any more (removed 2026-11-05). | `lib/sideMenus.tsx` `launcherMenu`, `lib/layoutReset.ts` |
| 启动器 | launchers | Pinned tool icons on the right of the 窗口顶栏 (侧边对话, 浏览器, 终端…) and ＋ (every component, 新的一列, and 恢复默认布局 last). | `components/side/TitleBarLaunchers.tsx` |
| 桌面 | desktop | The bottom layer behind every card: 名片, 时钟, 需要你, 用量, 固定的磁贴. 显示桌面 = Ctrl+Shift+D. | `modules/home/Desktop.tsx` |
| 另一个窗口（主窗口 = 原来那个） | desk window | A conversation moved into a second app window. Code calls it *desk*. | `components/DeskWindows.tsx`, `lib/deskWindows.ts` |
| 工作区 | workspace | One 会话 together with its Shelf. Up to two sit side by side. | `lib/workspaces.ts` |
| 系统托盘（设置里旧写法：托盘） | system tray (OS) | The OS notification-area icon with its menu and badge. **Not** the 托盘 under the conversation. | `main/shell.ts`, `shared/shell.ts` |

## 侧栏 Sidebar

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 侧栏 | sidebar | The left card with the agent list. Collapsing hides it fully; hover the left edge to peek. | `components/Sidebar.tsx`, `SidebarPeek.tsx` |
| 花名册 / 现在·全部 | roster / now-all layout | The two sidebar layouts. 花名册 is the default. | `lib/sidebarLayout.ts` |
| 项目分组 | project group | One project: a header row (★, host, 「2 运行 · 7 在线 ⚠1」 always shown) and its agents in three segments: 现在 · 最近 · 其余. | `Sidebar.tsx` `Group`, `lib/rosterTiers.ts` |
| 智能体行（大行 / 紧凑行） | agent row | Avatar, name, role, time, and a preview line on big rows. | `components/AgentRows.tsx` |
| 在线空闲 +N · 离线 +N | online idle / offline folds | A project's two folds (design 060 §5.5). Listed above them, without labels: Director, pins, needs-you / error, running, then at most 5 recently worked (7 days, online or offline). Everyone else folds by online state; listed in place (with a filter from 8). Listed rows: Director, pins, online first, then the shared name order; inside a fold: by name. Same rule in the project view. Replaces 现在 / 最近 +N / 其余 +N. | `lib/rosterTiers.ts` `placeRoster`, `lib/sidebarLayout.ts`, `Sidebar.tsx` `AgentFold` |
| 更早的项目 | older projects | An automatic folder: projects quiet for 7 days (setting), one row each, at the bottom of the list or inside a folder. Inside a folder it has a folder's header with a fixed archive icon; at the bottom of the list it is a system row (grey, 系统行样式); not renameable or deletable, never stored in `sidebarSections`. Never holds starred, open or owner-wanting projects. | `Sidebar.tsx` `OlderProjects`, `lib/folderLook.ts` `OLDER_FOLDER_LOOK` |
| 一行的项目 | one-row project | A project with nobody online (or under 其他项目 / 更早的项目) shown as one row. Hover opens nothing; a click expands it in place. | `Sidebar.tsx` `OneRowProject`, `lib/openedProjects.ts` |
| 名字排序 · 汉字读法 | name order | How names are listed everywhere: by first letter or by script; Han read as Chinese, Korean or Japanese. Follows the UI language until set (Settings → Appearance). | `cutex-client/src/nameOrder.ts`, `lib/rosterOrder.ts` |
| 按住（不重排） | roster hold | The roster does not move while the pointer or visible keyboard focus is in it; row content and header counts stay live, and everything goes in place when the owner leaves. No bar (the 「N 处有变化 · 更新」 bar was removed 2026-11-06). | `lib/rosterFreeze.ts` |
| 其他项目 | other projects | Unstarred projects in the 星标展开 layout. | `Sidebar.tsx` |
| 文件夹（代码：section） | sidebar folder | A folder the owner makes to group projects. Its header starts a little left of the project icons, with its own icon and colour (picked from its id, or chosen by the owner: folder menu 外观…), a coloured name and a thick line; its projects are indented under it (no side rule). | `lib/sidebarSections.ts`, `lib/folderLook.ts` |
| 文件夹（代码：section） | sidebar folder | A folder the owner makes to group projects. Its header starts a little left of the project icons, with its own icon and colour (picked from its id), a coloured name and a thick line; its projects are indented under it (no side rule). | `lib/sidebarSections.ts`, `lib/folderLook.ts` |
| 独立智能体 · 快速会话 | independent agents · quick chats | Agents outside any project (one group per host), and quick chats. In the sidebar they are system rows on the folder level: a folder's left edge, icon size and name type, but grey, with the meta right-aligned and, by 系统行样式, a thin grey dashed line (default) or a grey band instead of a folder's coloured line. | `Sidebar.tsx` `StandaloneTitle`, `SystemLine` |
| 系统行 · 系统行样式 | system rows · system row style | The sidebar's automatic rows on the folder level: 独立智能体, 快速会话 and the top-level 更早的项目. Settings → 左侧栏 → 系统行样式: 虚线 (default) or 灰底条. Not owner folders, not 更早的项目 inside a folder. | `prefs.systemRows`, `styles.css` 系统行样式 |
| 行间距表 | roster spacing table | The one rule for vertical gaps between sidebar rows, by the kinds of the two neighbours (folder, system row, project, one-row project; inside a block 0). Design 060 §5.6. | `styles.css` Roster spacing, `scripts/roster-gaps.mjs` |
| 恢复横幅 | restore banner | 「上次异常关机前有 N 个智能体在线」 with 全部恢复 / 选择 / 忽略. | `components/RestoreBanner.tsx` |

## 会话 Conversation

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 会话（旧称 对话列） | conversation | One agent's panel: header, timeline and 输入框. | `components/Conversation.tsx` |
| 会话顶栏 | conversation header | Two lines. Line 1: name, role, state, 🔔, pane buttons. Line 2: 项目 · 主机 · 路径 · 分支 · 服务. | `components/ConversationHeader.tsx` |
| 时间线 | timeline | The messages and tool steps. | `components/Timeline.tsx` |
| 工具条（搜索 · 书签 · 批注） | tool strip | Search, bookmark and note tools at the top of the timeline. Code: *gutter*. | `components/gutter/GutterHost.tsx`, `modules/thread-search`, `bookmarks`, `notes` |
| 状态胶囊 | status capsule | **Legacy, frozen:** a floating card over the timeline listing running items. No new work goes here. | `modules/status-capsule/StatusCapsule.tsx` |
| 状态行（旧称 输入栏） | status row | The chips right above the 输入框 (目标, 委托 2, 闹钟 1…). | `components/StatusBar.tsx` |
| 需要你（小铃铛） | needs-you bell | In the 状态行: a bell and a number, only while something waits (no avatars). Opens the same list as the 通知中心. | `components/NeedsYou.tsx` `NeedsYouBell` |
| 窄条 | strip | A conversation collapsed to a thin bar. | `components/ConvStrip.tsx` |

## 输入区 Composer

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 输入框 | composer | Where the owner writes: 「给 {name} 发消息」. | `components/Composer.tsx` |
| 接下来（队列） | next up (queue card) | Things waiting to be handed to this agent: 排队, 留言, 委托回复, 闹钟. | `components/QueuePanel.tsx` |
| 交互卡 | interaction card | A pending approval or question, docked above the 输入框. | `components/InteractionDock.tsx` |
| 输入框底栏 | composer footer | ＋ tools, 权限模式 (完全访问…), 规则, Profile + 配额圈, 模型 · 推理强度, 上下文圈. | `components/ComposerToolbarRow.tsx` |
| 提及（@ 面板） | mention panel | `@` lists agents (the current agent's project first, then recent mentions; matches names and project names; quick chats only when typed) and the host's Profiles (two groups, 5 rows each) and files; `p@` / `m@` list only Profiles / models. A pick shows as a chip: @name, or the Profile's name · model · effort. | `components/Composer.tsx`, `lib/useProfileMentions.ts`, `components/ProfileMentionChip.tsx` |

## 托盘 Tray

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| **托盘** | **tray** | **The long strip with avatars under the conversation.** Can dock to any edge. | `components/ChipTray.tsx`, `modules/home/Dock.tsx` |
| 钉住 / 最近 | pinned / recent | Agent avatars: pinned ones, then recently open ones (6 at most). | `Dock.tsx` |
| 应用（服务 · 成果 · 页面 · 网页） | apps | Pinned items that are not agents. | `Dock.tsx` `AppOf` |
| 通知中心（需要你 N） | notification center | The tray's needs-you button, always shown (dim at 0): every agent in view waiting on the owner, the open one too (「就在这里」), as one paged list with the reason per row. | `components/NeedsYou.tsx` `TrayNeedsYou`, `lib/needsYouView.ts` |
| 返回上一个 ↶ | back | Undoes the last replace or minimise (Alt+←). | `Dock.tsx` |
| 收进托盘 | send to tray | The pane — button: the item leaves the screen and stays in the 托盘. | `pane.collapse` |

## Shelf / Rail

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| Shelf | Shelf | The tool card beside a 会话, at most one per side. The word is the same in every language. | `components/side/SideArea.tsx`, `lib/shelves.ts` |
| Rail（Shelf 的页签栏） | Rail | The Shelf's narrow strip of page icons. A collapsed Shelf is just its Rail. | `components/side/ShelfRail.tsx` |
| 页 | page | One Rail entry. Holds up to 3 窗格. | `lib/sideLayout.ts` |
| 窗格 | pane | One area of a page. Holds 标签. | `lib/sideLayout.ts` |
| 标签 / 标签行 | tab / tab row | One open component inside a 窗格, and the row that switches them. | `lib/sideLayout.ts` |
| 只看 Shelf | Shelf only | The 会话 shrinks to a 窄条 and its Shelf fills the space. | `settings.panel.shelfOnly` |
| 设置 Shelf | settings Shelf | Settings opened as a card beside the 会话. | `modules/shell` |
| 开发者模式 | developer mode | Settings → 模块: load a module being written from a folder and swap in each new build. Tagged 开发. | `modules/shell/DevModules.tsx`, `main/moduleDev.ts` |
| 本地模块 | local module | A module installed from a `.tar.gz` file (Settings → 模块 → 从文件安装…), after main's native confirm; runs with the app's own power. Tagged 本地安装. | `modules/shell/ModulePacks.tsx`, `main/modulePacks.ts` |
| 模块数据 | module data | A module's own folder on this device (`userData/module-data/<id>/`), and the Settings → 模块 list of those folders, kept or deleted when a module is removed. | `modules/shell/ModuleData.tsx`, `main/moduleData.ts` |
| 不透明 frame | opaque frame | The sandboxed, offline frame agent pages and HTML files show in. Not a module and not a plugin. (The frame *plugin* feature that also used it is retired.) | `@cutex-desktop/opaque-frame`, `main/frames.ts` |
| 主机（设置页） | Hosts page | Settings → 主机: one list of hosts, groups, what connects at launch. | `components/settings/ConnectionSettings.tsx` |
| 主机详情 | host page | One host's page, opened from a row or from the switcher's ›; its heading is the host's name. Its connection, users and devices. (Was 主机 + 用户与设备.) | `components/settings/AccessSettings.tsx` |
| 路线 | routes | A host's SSH addresses on its card, in the order they are tried; the one in use is marked. | `ConnectionSettings.tsx` |
| 添加设备 | add a device | The one way to add a phone or computer to a host: a button on 主机详情's 设备 list. Shows one 5-minute QR / 配对文字 that works over the host's LAN / Tailscale address and, if set up, the relay. (Replaces 配对设备 on hosts with users.) | `modules/users/AddDevice.tsx`, `main/pairingInvites.ts` |
| 设备申请 · 核对号码 | pairing request · check number | A device that scanned the QR and waits on top of the 设备 list: name, system, whose, scope, and the 6-digit number the phone also shows. 允许 (full control: a system dialog with the number) or 拒绝. | `modules/users/AddDevice.tsx` |
| 旧版手机 | older phone app | A fold under the QR: a one-time v1 配对码 for a phone app that cannot read the new QR yet; it skips 允许. Temporary. | `modules/users/AddDevice.tsx` |
| 我的设备 · 邀请他人 | pairing paths | The two ways into 添加设备: your own device (owner defaults), or someone else's (who, which projects, may they talk). | `components/settings/PairingParts.tsx`, `InvitePanel.tsx` |
| 我的设备（你） | my devices | Settings → 你: your devices across the connected hosts you own; merged by name + system only, revoke says per host what happened. | `MyDevices.tsx`, `lib/myDevices.ts` |
| 跨机协作 · 高级 · 全部设备 | sub-pages | Sub-pages of 主机详情: linked hosts; owner, rights, listen addresses, CORS and diagnostics; every device. | `AccessSettings.tsx`, `SettingsPageItem.subPages` |
| 互通的项目 · 可见的外部智能体 · 规则审计 · 网站权限 | sub-pages | Sub-pages of 协作 and 浏览器. The first two are an entry with a count on the page; the last two show their first rows and 全部. | `SecuritySettings.tsx`, `ApprovalRules.tsx`, `BrowserSettings.tsx` |

## 侧边组件 Side components (what goes into a Shelf)

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 组件 | side component | Anything that opens as a Shelf tab (`side.component`). | `lib/sideKinds.ts` |
| 侧边对话 | side chat | A small chat beside the main conversation. | `modules/side-chat` |
| 浏览器（标签行 · Maid 行 · 地址行） | browser | The in-app browser. Three fixed rows on top: 标签行 (tabs only), Maid 行 (always there, fixed height: 「由你操作 · 交给 Maid ▾」 or who drives the tab, with 暂停 / 继续 and 收回; a service tab adds 「关联 X ▾」 or 「打开 X」), 地址行 (back, forward, reload, address, zoom, page ⋯). | `modules/browser` |
| 终端 | terminal | The built-in terminal. | `modules/terminal` |
| 项目视图 | project view | A project's counts, its 主管 card, 需要你 / 运行中 / 最近活跃 / 其余 (the sidebar's tier rule, 30-minute window), and 动态. | `modules/project-view/ProjectView.tsx` |
| 动态 | activity | The project's day-by-day event feed with type chips. | `modules/project-view/ProjectStream.tsx` |

## 卡片 Cards

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 委托卡 | delegation card | One delegation in the timeline: who to whom, state, answer. | `modules/delegations` (DESIGN §4.21) |
| 主管卡 | director card | The 主管's summary at the top of 项目视图. | `modules/project-view/DirectorPanel.tsx` |
| 成果 | artifact | A published report, figure or page. 成果卡 in the timeline. | `modules/artifacts` |
| 服务 | service | A running page or service an agent registered. | `modules/services` |
| 提示卡 / toast | toast | A short notice, sometimes with 撤销. All toasts share one float face (040 §2.1): the composer notice line, agent toasts, the Shelf toast, the desk notice. | `.float-toast` in `styles.css`; `components/AgentToasts.tsx`, `ShelfToast` |
| 浮层 | float / floating panel | Anything that floats above the cards: menus, popovers, pickers, status-row panels, tray panels, ⌘K, toasts. One look: `--float` background, e2, 12 px corners, no border, no acrylic (040 §2.1). | `.float` in `styles.css` |
| 悬停提示 | tooltip | The small inverted label after 500 ms hover. Says what a thing is; never covers the panel its own button opened. Write `data-tip="…"` on any element. | `components/Tip.tsx` |
| ⓘ 说明 | info mark | Small ⓘ next to a control whose action is not obvious; hover or focus shows the how-to text that used to sit in a native title. | `components/InfoMark.tsx` |
| 还有 N 个 | more-below count | Footer on a list float that has more rows below; the scrolling edge fades. | `components/FloatMore.tsx`, `.float-scroll` |

## 角色和状态 Agent roles and states

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 主人 | owner | The person using the app. | `lib/terms.ts` |
| 智能体（这里叫 Maid） | agent | One cutex session: one agent, one thread. | `lib/terms.ts` |
| 主管（Chief Maid；侧栏 Chief） | director | The agent that runs a project. Its sidebar tag is short. | `lib/terms.ts` |
| 副主管（Deputy Maid） | operator | The director's deputy. | `lib/terms.ts` |
| 子智能体（Maidling） | subagent | An agent's own helper inside its turn. | `modules/subagents` |
| 在线 / 离线 | online / offline | Whether its runtime is running. | `lib/agentAttention.ts` |
| 运行中 / 空闲 | running / idle | Working on a turn, or online and waiting. | 同上 |
| 需要你 | needs you | It waits on the owner: approval, question, review, or a 留言 for the owner. | `lib/agentAttention.ts` |
| 已暂停 · 出错 · 已归档 | paused · error · archived | Archived agents never show in the sidebar. | `lib/sidebar.ts` |

## 后台的东西 Background items

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 委托 | delegation | Tracked work one agent hands to another. | `modules/delegations` |
| 留言 | message | A note between agents, or between an agent and the owner, with no tracked result. | `lib/queueChips.ts` |
| 闹钟 | alarm | A reminder an agent set for later. | `modules/alarms` |
| 审批 | approval | A request that waits for the owner's yes or no. | `modules/approvals` |
| 作业（项目视图旧写法：后台任务） | job | A long command run by the Job Service (Linux hosts). | `modules/jobs` |
| 后台命令（界面标题：后台终端） | background command | A shell command an agent left running. | `modules/background-terminals` |
| 后台操作 | cutex operation | cutex's own work started from this desktop: batch online/offline, restore, stop idle and its undo, runtime-package upgrades, host-busy retries. The tray shows a button for it only while something runs or a failure is unread (spinner + 3/12, red dot); its list has per-agent results and 重试. Operations started elsewhere are not listed yet (needs a cutex API). | `components/BackgroundOperations.tsx`, `lib/backgroundOperations.ts` |
| 计划（旧称 进程） | plan | The model's update_plan checklist. | `modules/plan` |
| 目标 | goal | The objective an agent works toward, with an optional budget. | `modules/goal` |
| 工作流 | workflow | A multi-step run of several agents. | `modules/workflows` |

## 智能体菜单 Agent menu

The right-click menu of an agent (侧栏 row, 会话顶栏 ⋯, 全部智能体). Words that sound alike, kept apart (2026-11-05).
Menu rows (owner rule): a label never explains itself; a note goes behind the row's ⓘ. **…** means a dialog follows where
you fill in or choose something before anything happens (编辑信息…, 轮换主管…, 新建分区…); a yes/no confirmation, a row that
acts at once, and a submenu row with › get none.

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 在侧栏置顶 | pin to top of sidebar | Keeps the agent at the top of its 项目分组 in the 侧栏. Not the 托盘. | `lib/menus.tsx` `agentMenu` |
| 钉到托盘 ✓ | pin to tray | Adds it to the 托盘's 钉住 group; the ✓ says it is there, a click takes it off. | `modules/home` (`home.pin` ref action) |
| 并排打开（旧称 在侧边打开 / 在旁边打开） | open side by side | A second 工作区 beside this one, the same as Ctrl/⌘ + click on a 侧栏 row. | `modules/conversation` ref action |
| 投影到当前 Shelf | project into this Shelf | Its live conversation as a 窗格 in the open 会话's Shelf. | `modules/conversation` ref action |
| 显示名称（在 编辑信息… 里；旧称 重命名） | display name | The first field of 编辑信息…, the name only the owner sees. It never changes the agent's own name (what 复制 › 名字 copies); other agents use the own name, and an @-mention sends it (the chip still shows the display name). An agent without an own name is listed under its display name. | `components/AgentInfoDialog.tsx`, `lib/agentAlias.ts` |
| 自己的名字 · 改名 · 改名记录（在 编辑信息… 里，显示名称下面） | own name · rename · name history | The name other agents use to find, delegate to and mention it (cutex formal agent name). Owner only, on hosts with cutex `formal-agent-name-rename-v1`: 改名 with an in-place second click; no restart, a running agent gets a quiet note, the old name stays reserved in the project and anyone using it gets a note. A case-only change (eva → Eva) is a rename too. An archived agent can be renamed too and stays archived (已归档 tag); if 恢复 is refused because its name is now taken or reserved, the message says whose and offers 改名…. 改名记录 is cutex's permanent log, 50 per page. The session ID never changes; a display name the owner set stays. Not the display name. | `components/AgentOwnName.tsx`, `lib/agentRename.ts`, `shared/agentRename.ts` |
| 打开 › · 设置 › | open · settings | 打开 ›: 打开文件面板, 打开所在项目, the window rows. 设置 ›: a Claude agent's tool switches and 额度用完后自动继续 (one row alone stays at the top level). | `lib/menus.tsx` |
| 头像 › | avatar | 跟着 Profile 变, 重置为当前风格, 显示 / 隐藏头像 in one submenu. | `lib/menus.tsx` `avatarItem` |
| 暂停智能体 / 暂停接收委托 | pause agent / pause incoming delegations | The first holds every new turn: before the next tool call on runtimes with a tool gate (newer Claude, native), at the end of the turn on DSH, Kimi and older ones. The second holds only new delegations to it; the conversation goes on. | `lib/agentPause.ts`, `lib/menus.tsx` |

## Code-only notes

These are code names only; users don't see them.

- **dock:** `InteractionDock` and `ConversationDockContext` are the area above the 输入框, but `modules/home/Dock.tsx` is the 托盘.
- **desk:** in code, another app window is a *desk* (`DeskWindows`, `deskStore`). Unrelated to 桌面 (`modules/home`).
- **gutter:** the 工具条 lives in `conversation.gutter`; `GutterHost` also draws reference cards beside the timeline.
- **status bar:** `StatusBar.tsx` is the 状态行, not a window status bar.
