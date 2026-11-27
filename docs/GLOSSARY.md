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
| 入口图标（钉住的导航） | nav entries | Pinned page icons: 新建, 快速启动 (starts a 快速会话), 委托, 审批… The rest are under ⋯. | `components/SidebarNav.tsx`, `lib/navPins.ts` |
| ⌘K 搜索（快速切换） | quick switcher | Search box to jump to agents, services, 成果 and pages. | `modules/quick-switch` |
| 窗口布局（恢复默认布局） | layout reset | 「恢复默认布局」, the last item of the ＋ menu; there is no title-bar layout button any more (removed 2026-11-05). | `lib/sideMenus.tsx` `launcherMenu`, `lib/layoutReset.ts` |
| 启动器 | launchers | Pinned tool icons on the right of the 窗口顶栏 (侧边对话, 浏览器, 终端…) and ＋ (every component, 新的一列, and 恢复默认布局 last). | `components/side/TitleBarLaunchers.tsx` |
| 桌面 | desktop | The bottom layer behind every card: 名片, 时钟, 需要你, 用量, 固定的磁贴. 显示桌面 = Ctrl+Shift+D. | `modules/home/Desktop.tsx` |
| 另一个窗口（主窗口 = 原来那个） | desk window | A conversation moved into a second app window. Code calls it *desk*. | `components/DeskWindows.tsx`, `lib/deskWindows.ts` |
| 项目看板（卡片 · 缩略视图） | project board | A separate read-only window for a second (portrait) screen: one card per project — health, the 主管 and what it does, counts, 今天完成, the first problem; 缩略视图 = shrunken 项目视图 in two columns. Opened from the system tray menu or Settings → 通用 → 窗口; reads nothing while closed or minimised; a click opens the target in the main window. Not a desk window. | `main/board.ts`, `shared/boardModel.ts`, `renderer/src/board/` |
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
| 未分组 | ungrouped | An automatic 系统行 directly above 独立智能体: the projects in no 文件夹 (and 其他项目), shown only while there are owner folders and at least one project is in none. A folder header in the system look with a fixed open-folder icon: totals, count, fold (kept). Sticky like every group, so below the list it waits in the bottom stack, one click away. Dropping a project from a folder on it takes the project out of that folder. Not renameable or deletable, never stored in `sidebarSections`; a starred 独立智能体 stays at the top. Not in 现在·全部. Owner 2026-11-18. | `Sidebar.tsx` `UngroupedProjects`, `lib/folderLook.ts` `UNGROUPED_FOLDER_LOOK` |
| 一行的项目 | one-row project | A project with nobody online (or under 其他项目 / 更早的项目) shown as one row. Hover opens nothing; a click expands it in place. | `Sidebar.tsx` `OneRowProject`, `lib/openedProjects.ts` |
| 名字排序 · 汉字读法 | name order | How names are listed everywhere: by first letter or by script; Han read as Chinese, Korean or Japanese. Follows the UI language until set (Settings → Appearance). | `cutex-client/src/nameOrder.ts`, `lib/rosterOrder.ts` |
| 按住（不重排） | roster hold | The roster does not move while the pointer or visible keyboard focus is in it; row content and header counts stay live, and everything goes in place when the owner leaves. No bar (the 「N 处有变化 · 更新」 bar was removed 2026-11-06). | `lib/rosterFreeze.ts` |
| 其他项目 | other projects | Unstarred projects in the 星标展开 layout. | `Sidebar.tsx` |
| 文件夹（代码：section） | sidebar folder | A folder the owner makes to group projects. Its header starts a little left of the project icons: its own icon and colour (picked from its id, or chosen by the owner: folder menu 外观…), the name in that colour, then right-aligned the totals (needs-you, updates, running) and the project count — no line (owner 2026-11-18: the same in place as stuck at an edge). Its projects are indented under it (no side rule). | `lib/sidebarSections.ts`, `lib/folderLook.ts` |
| 独立智能体 · 快速会话 | independent agents · quick chats | Agents outside any project (one group per host), and quick chats. In the sidebar they are system rows on the folder level: a folder's left edge, icon size and name type, but grey, with the meta right-aligned and, by 系统行样式, a thin grey dashed line (default) or a grey band instead of a folder's coloured line. | `Sidebar.tsx` `StandaloneTitle`, `SystemLine` |
| 系统行 · 系统行样式 | system rows · system row style | The sidebar's automatic rows on the folder level: 未分组, 独立智能体, 快速会话 and the top-level 更早的项目. Grey icon and name, the meta right-aligned like a folder header. Settings → 左侧栏 → 系统行样式: 无线 (default since 2026-11-18), 虚线 (a dashed line between name and meta) or 灰底条. Not owner folders, not 更早的项目 inside a folder. | `prefs.systemRows`, `styles.css` 系统行样式 |
| 吸附标题 | sticky headers | 花名册 only (not 现在·全部, off while searching). Every 文件夹 and 系统行 (未分组, 独立智能体, 快速会话, top-level 更早的项目) header stays on screen (owner 2026-11-18 「我始终能看见所有分区标题」): the headers of groups above the view stack at the list's top edge in list order, those below stack at the bottom edge, and the rows of the group you are in scroll between them. A nested header (更早的项目 in a folder, 项目分组) sticks just under the top stack. A click on a header in either stack brings its group into view (opening it if folded) instead of folding it. It is the same element in place and stacked — nothing is drawn twice: same icon and colour, look, counts, right-click menu, drop target, hover and focus; only its position changes. Both stacks together take at most 60% of the list; only on a small window does that leave 文件夹 out (系统行 kept first): those scroll with the list (under the stacks) and, while they cannot be seen, are listed in one 「还有 N 个分组」 row in the bottom stack, whose menu brings each into view. Owner 2026-11-17 / 11-18; replaces the title dock. | `components/RosterStick.tsx`, `lib/rosterStick.ts`, `styles.css` sticky headers |
| 连不上的主机 | unreachable hosts | A host that is switched off or not online leaves the 花名册: its groups, its last (cached) rows and its host row; they come back when it is online again. 现在·全部 still shows its last rows, greyed. If every host of the view is unreachable, the empty 花名册 says so. The footer's host / account switcher (⌃⌄ next to the owner's name) gets a small dot: red if a host that should be connected is not, grey if only switched-off ones. Its menu lists each such host as 「连不上 · 重连」 (「未连接 · 连接」 when switched off), then 主机设置. Owner 2026-11-17. | `lib/hostReach.ts`, `components/IdentityMenu.tsx` |
| 行间距表 | roster spacing table | The one rule for vertical gaps between sidebar rows, by the kinds of the two neighbours (folder, system row, project, one-row project; inside a block 0). Design 060 §5.6. | `styles.css` Roster spacing, `scripts/roster-gaps.mjs` |
| 在消息记录里搜 · 在页面中打开（旧称 查找旧任务 · 在页面中查找） | search message history · open in a page | Design A (owner 2026-11-27): while the sidebar search has text, a row 「在消息记录里搜「…」」 (with a one-line hint: it searches what was written, not names) and the text link 在页面中打开 sit above the 名字匹配 heading (name / preview matches, the agent rows). The sidebar shows at most 5 message-history results, then 「在页面中看全部 N 条」. 筛选 is one button beside the field (with a count of set conditions); its panel under the field groups conditions by effect: 工作目录 (names and message history), then 消息记录: 含已归档 (checkbox, owner connections only) · 发送方 · 类型 · 时间. Set conditions stay as removable chips while the panel is closed. The search itself (cutex session-search-v1): matching turns of the hosts in view, newest first, each with its time when the host sends one; Filters 发送方 · 类型 · 时间: on hosts with cutex session-search-v2 the host applies them, results carry their turn time, kind (委托 / 结果) and sender, and the host visits agents newest first (by last update, not strict turn order); a set filter leaves older hosts out and names them. Without a v2 host 发送方 stays greyed with why. 在页面中查找 opens the same text as a page (a Shelf tab by default): host / project (the host applies it on v2) / agent filters, time (presets or 自定义 dates) · type · sender (greyed with why without v2), results by time or by agent, the selected turn previewed with 打开对话 at that turn; ↑↓ Enter Esc. Owner 2026-11-26. | `components/SidebarSessionSearch.tsx`, `modules/session-search`, `lib/sessionSearchStore.ts` |
| 恢复横幅 | restore banner | 「上次异常关机前有 N 个智能体在线」 with 全部恢复 / 选择 / 忽略. | `components/RestoreBanner.tsx` |

## 会话 Conversation

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 会话（旧称 对话列） | conversation | One agent's panel: header, timeline and 输入框. | `components/Conversation.tsx` |
| 会话顶栏 | conversation header | Two lines. Line 1: name, role, state, 🔔, pane buttons. Line 2: 项目 · 主机 · 路径 · 分支 · 服务. | `components/ConversationHeader.tsx` |
| 回合 | turn | One pass of the agent working in a 会话: from a message (yours, a delegation result, a wake) until it ends or is interrupted. Always 回合, never 轮 / 轮次 / 本轮: 一个回合, 本回合, 当前回合, 下一回合, 新回合, 第 {n} 个回合; a turn 开始 (not 开 / 触发); the current-turn control is 中断 (owner 2026-11-25). | `components/Timeline.tsx` |
| 时间线 | timeline | The messages and tool steps. | `components/Timeline.tsx` |
| 项目记忆行 | memory edit row | A 时间线 row of its own for an agent's edits to the project memory files: 「更新项目记忆 · 名字」 (新增 / 删除项目记忆 likewise). All of a 回合's memory edits are one row, with 「共 N 条」 and 「及索引」 when MEMORY.md changed too. Click: each file's changes and 在记忆页打开. | `modules/projects/MemoryEditRow.tsx` |
| 操作栏 | action bar | The small floating bar under a finished reply (复制 · 分叉 · 书签 · ⋯) and under your own message (复制 · 回退并编辑 · 书签 · ⋯), on hover. It shows the actions you pinned, in pin order; ⋯ lists every action with 固定到操作栏 / 从操作栏取消固定, and right-clicking a pinned icon unpins it. Each bar keeps its own pins, synced across your devices like the window bar's. | `components/MessageActions.tsx`, `lib/turnBarPins.ts` |
| 工具条（搜索 · 书签 · 批注） | tool strip | Search, bookmark and note tools at the top of the timeline. Code: *gutter*. | `components/gutter/GutterHost.tsx`, `modules/thread-search`, `bookmarks`, `notes` |
| 状态胶囊 | status capsule | Optional module (模块 page; off for new installs, existing installs keep theirs): a floating card over the timeline listing running items. While it is off, items placed in it show in the 状态行. Its settings (items, position, size) are its own module page (模块 → 状态胶囊 → 设置). No new work goes here. | `modules/status-capsule/StatusCapsule.tsx` |
| 状态行（旧称 输入栏） | status row | The chips right above the 输入框 (目标, 委托 2, 闹钟 1…). Which items show: 会话 → 输入 →「状态行里显示」 (the 状态显示 page is gone, 2026-11-28). | `components/StatusBar.tsx` |
| 需要你（小铃铛） | needs-you bell | In the 状态行: a bell and a number, only while something waits (no avatars). Opens the same list as the 通知中心. | `components/NeedsYou.tsx` `NeedsYouBell` |
| 窄条 | strip | A conversation collapsed to a thin bar. | `components/ConvStrip.tsx` |

## 输入区 Composer

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 输入框 | composer | Where the owner writes: 「给 {name} 发消息」. | `components/Composer.tsx` |
| 图片编辑（编辑… · 编辑后附加 · 恢复原图） | image editor (Edit… · Edit and attach · Restore original) | A full-window overlay over one image: 裁剪 (自由 / 1:1 / 4:3 / 3:4 / 16:9 / 9:16, Enter applies), 向左 / 向右旋转, 画笔, 荧光笔, 箭头, 矩形, 椭圆, 文字, 打码, colour and 细 / 中 / 粗, 撤销 / 重做 / 重置 (Ctrl+Z / Ctrl+Shift+Z), Ctrl+Enter or Enter saves, Esc cancels (with edits: press twice). From a 输入框 attachment (hover pencil or right-click 编辑…), saving replaces it with the edited PNG; the original stays until send, so 恢复原图 (right-click or in the editor) puts it back. From the enlarged image view (编辑后附加), saving attaches the copy to the open agent's 输入框. Kept under the agent's image size limit (scaled down on export). The tool bar starts under the window buttons' band (`captionBand`, as the enlarged view), clear of the caption buttons. Not 画图 / 标注工具. | `components/ImageEditor.tsx`, `lib/imageEdit.ts` |
| 接下来（队列） | next up (queue card) | Things waiting to be handed to this agent: 排队, 留言, 委托回复, 闹钟. | `components/QueuePanel.tsx` |
| 交互卡 | interaction card | A pending approval or question, docked above the 输入框. | `components/InteractionDock.tsx` |
| 输入框底栏 | composer footer | ＋ tools, 权限模式 (完全访问…), 规则, Profile + 配额圈, 模型 · 推理强度, 上下文圈. | `components/ComposerToolbarRow.tsx` |
| 提及（@ 面板） | mention panel | `@` lists agents (the current agent's project first, then recent mentions; matches names and project names; quick chats only when typed) and the host's Profiles (two groups, 5 rows each) and files; `p@` / `m@` list only Profiles / models. A pick shows as a chip: @name, or the Profile's name · model · effort. | `components/Composer.tsx`, `lib/useProfileMentions.ts`, `components/ProfileMentionChip.tsx` |
| 功能 Profile | Feature Profile | A host's model endpoint that only app features use (输入优化 first): name, API type (OpenAI Responses / Anthropic Messages), base URL, model, 额度类型 (订阅窗口 · 周期额度 · 余额 · 按量付费; display only) and a write-only API key (shown only as set, or ⚠ 未设置 API key; 更换 API key replaces it). 测试连接 / Test connection (hosts with `feature-profile-test-v1`): one request with a saved row's stored key, or with the form's typed draft (nothing saved); inline ✓ 可以连上 · N ms · model, or the reason in plain words. Never an agent's Profile: not among the Profile cards, pickers, @ or agent creation, and agents can't see it. Settings → 智能体 → Profile, its own card 功能 Profile after the agent Profiles' cards, sub-page 全部 N 个 (owner 2026-11-26; a page of 工具 before, old links land there); cutex `feature-profiles` (owner 2026-11-25). Not 应用 Profile / 工具 Profile. | `modules/feature-profiles`, `lib/featureProfiles.ts`, `shared/featureProfiles.ts` |
| 输入优化（模板：提示词增强 · 纠错学习 · 自定义） | Input Refinement (templates: Prompt enhance · Correction learning · custom) | An optional module (设置 → 模块) that rewrites the 输入框 draft or its selection with a template the owner picks (the wand button, Ctrl+Shift+E = the last template, Ctrl+Alt+Shift+E = pick one): original and rewrite side by side, 「还可以补充」 as checkboxes (直接加上 appends them without a model call; 重新整理 asks again), 第 N 版 to switch versions, 采用 changes the draft as one undo step. 纠错学习 lists each change with its category, a one-line explanation and 「取决于你的意思」 choices; 错题本 is reserved, not built. Templates live on the host (cutex `text-rewrite-v2`; built-ins can only change their model, copy them to edit the prompt); older hosts get 提示词增强 only. Settings → 会话 → 输入 → 输入优化 (a card; templates on its detail page). Owner 2026-11-26. Not 提示词改写 / 写作助手. | `modules/input-refinement`, `lib/composerActions.ts` (slot `composer.action`), `shared/textRewriteV2.ts` |
| 个人助理 | Personal Assistant | An agent the owner sets up to arrange work across chosen projects (on any paired host; cross-host by nature, owner 2026-11-25). It drafts requests for each project's Director, which go out only after the owner confirms, and never does project work itself. A normal agent since 2026-11-27 (any runtime, 自动 by default, 完全访问 optional; old ones say 旧版). Title-bar button: click = the 默认助理's conversation, right-click = a popover of what waits (also offered in 新建智能体). The word is a term (`{{assistant}}`, Settings → 通用 → 用语; the Maid wording says Lady's Maid). Not 助手 / 管家. | `modules/personal-assistants` |
| 助理请求（发给主管 · 取消请求） | assistant request (Send to Director · Cancel request) | A request a 个人助理 drafted for a project's Director; it waits for the owner as 待确认 first, then shows 进行中 / 已结束. | `modules/personal-assistants` |
| 今日 | Today | The assistant-only right view of a 个人助理's conversation (in the project view's place: its coordination project is internal): 待你确认 (cards with 发给主管 / 取消请求), 在办 by project · host, 简报, 提醒 (＋ 添加), 记一下 (a note into 备忘 the assistant reads). A collapsible band over the conversation in portrait / narrow windows. Not 首页 / 前台 / 日报. | `modules/personal-assistants/TodayView.tsx` |
| 默认助理 | default assistant | The 个人助理 the title-bar button opens; the first one created, switchable (设置 → 今日 · 设为默认, or the popover's 切换默认助理). | `modules/personal-assistants/defaultAssistant.ts` |
| 范围规则（只看 · 协调 · 代你确认） | scope rules (Observe · Coordinate · Confirm for you) | A 个人助理's role per project, set per project or by a rule over a scope: 全部项目 / 文件夹 (a sidebar project group, e.g. 「科研 Research」) / 主机 / 项目; the most specific wins. 协调 when no rule; 代你确认 (routine requests go to the Director without asking) is never on by default, and saving it lists the projects first. Each project says which rule set it. | `modules/personal-assistants/ScopeRulesCard.tsx` |
| 简报时间 | brief times | When a 个人助理 writes its 简报 (shown in 今日): off by default, one or more times a day. | `modules/personal-assistants/TodaySettings.tsx` |

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
| 模块分组 | module groups | Settings → 模块 → 全部模块 in groups by use, in this order: 自装模块 (packs the app does not know) · 工作 · 浏览与资料 · 沟通与通知 · 输入 · 主机与运行时 · 个人 · 开发者工具 · 核心模块 (folded, not switchable; every required module is only here, the 必需 ones — 项目 审批 归档 存储 — first, owner 2026-11-28). Within a group the most used first, optional modules at its end; never by name. Each row also says 出现在 (from its `contributes`) and 默认开 / 默认关. Owner 2026-11-26. | `shared/moduleGroups.ts`, `modules/moduleCatalog.ts` |
| 一键设置 · 精简 / 推荐 / 全部 | quick setup · Lean / Recommended / Everything | The presets over the module list: 精简 keeps what day-to-day work needs, 推荐 is each module's default, 全部 turns on every installed module. Asks in place first (开启 N 个，关闭 M 个), then 撤销 undoes it. Never changes required or optional modules; keeps on what a module staying on needs. | `modules/moduleCatalog.ts` |
| 可选模块 · 可选 · 随应用提供 / 可选 · 未下载 | optional module · included / not downloaded | A module few people use: off on new installs. 随应用提供: built in this version, with a switch. 未下载: only in the module index, with 下载. | `shared/moduleMetadata.ts`, `modules/moduleTags.ts` |
| 必需 · 被 X 依赖 | required · needed by X | 必需: a module locked on (`required: true`) yet listed with its use, with a lock and one line on why — 项目, 归档, 存储, 审批 (module-dependencies-20261126). 被 X 依赖: the modules on now that need it (`requires.modules`); turning it off asks to turn them off too, turning a module on turns on what it needs. | `shared/moduleGroups.ts`, `modules/moduleCatalog.ts` |
| 模块目录 | module catalog | `docs/module-catalog.{zh-CN,en}.md`: every module's group, what it does, where it shows up, default and 精简 choice, generated from the code (`node apps/desktop/scripts/module-catalog.mjs`) and checked by `test/moduleCatalog.test.ts`. | `docs/module-catalog.*.md` |
| 随应用的字体 · 中文字体包 | bundled fonts · Chinese font pack | Settings → 外观 → 字体: seven Latin fonts come with the app (first in the lists). Four large Chinese fonts are the 中文字体包: 下载并安装 (one archive from the `fonts-zh-1` release, size and SHA-256 pinned in the catalog) or 导入字体包… from a folder, into `userData/fonts/` (Settings → 外观 → 中文字体包), loaded only when chosen; the picker shows each choice in its own font. | `shared/fontCatalog.ts`, `main/fontPack.ts`, `FontPackSettings.tsx` |
| 不透明 frame | opaque frame | The sandboxed, offline frame agent pages and HTML files show in. Not a module and not a plugin. (The frame *plugin* feature that also used it is retired.) | `@cutex-desktop/opaque-frame`, `main/frames.ts` |
| 主机（设置页） | Hosts page | Settings → 主机: one list of hosts, groups, what connects at launch. | `components/settings/ConnectionSettings.tsx` |
| 主机详情 | host page | One host's page, opened from a row or from the switcher's ›; its heading is the host's name. Its connection, users and devices. (Was 主机 + 用户与设备.) | `components/settings/AccessSettings.tsx` |
| 运行时配置（旧称 Codex 配置） | Runtime configuration | One switchable module (主机与运行时 in 模块; 精简 turns it off). Its Settings page sits right after 运行时: 插件 · 钩子 (Codex), 跟随主机共享配置 (Maid), 技能 · MCP 服务器 as detail pages (old page ids and links unchanged). 技能 lists one host's skills by runtime: Codex · Claude, then DSH · Kimi read-only behind their host flags (`runtime-skills`, `-dsh`, `-kimi`); cards by origin, a row's source as a short label with the raw id as tooltip. MCP stays Codex-only (no runtime API). Owner 2026-11-28. | `modules/codex-config`, `components/settings/RuntimeConfigSettings.tsx`, `lib/runtimeSkillsView.ts` |
| 复制到… | Copy to… | On a personal Codex / Claude skill row: copies it to the other runtime on the same host. A preview first (files; scripts folded and marked as code; setting differences; why it is blocked); a taken name is 跳过 by default, 覆盖 is an explicit choice with its own preview; the phrase the host asks for (`copy <name>` / `overwrite <name>`) is typed; one action id per preview, so 重试 after a lost answer replays. Shown disabled with why on other rows. cutex `runtime-skill-copy`. Owner 2026-11-28. | `components/SkillCopyDialog.tsx`, `shared/runtimeSkills.ts` |
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
| 跨主机同步 | sync across hosts | Settings → 浏览器 → 浏览器身份: every host sees the same identities (names, colours, additions and deletions only; never logins, site data, passwords or history). One switch per host; a host whose cutex lacks it, or a connection without full management access, shows the reason instead. An identity deleted on another host asks 清除 / 暂不 for its data on this computer. | `modules/browser/IdentitySyncSettings.tsx`, `main/browser/identity/sync.ts` |
| 终端 | terminal | The built-in terminal. | `modules/terminal` |
| 项目视图 | project view | A project's counts, its 主管 card, 需要你 / 运行中 / 最近活跃 / 其余 (the sidebar's tier rule, 30-minute window), and 动态. | `modules/project-view/ProjectView.tsx` |
| 动态 | activity | The project's day-by-day event feed with type chips. | `modules/project-view/ProjectStream.tsx` |

## 设置页的部件 Settings parts

The layout rules for these are at the top of `.claude/reports/settings-layout-audit-20261110.md`; the shared rules
for host pickers, place tags, the label line, 恢复默认 and list rows are in `docs/design/settings-rules.md`; the parts
are in `components/settings/Form.tsx`.

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 设置导航 · 分组 | settings nav · groups | The left list of settings pages, top to bottom: 你 (no heading) · 应用 (通用 外观 通知 键盘与手势) · 面板 · 连接 (主机 网络代理) · 智能体 · 工具 · 数据 · 系统 (模块 and the two update pages) · 帮助与关于 (关于 新功能 帮助). Owner 2026-11-11; the grouping is display only, page ids and links are unchanged. | `lib/settingsNav.ts` |
| 页头 | page header | A settings page's title, one-line purpose and its place / timing chips; on a page with host settings the 设置主机切换器 comes first and names the host for the whole page. | `SettingsPage` |
| 设置主机切换器 | settings host switcher | The one host picker of Settings, in the 页头 of every page with host settings: the title bar's 主机选择 look, always openable, one choice for all pages. Follows the title bar (a switch there moves it too), never drives it. Cards have no picker of their own. Owner 2026-11-28. | `SettingsHostFrame.tsx` `SettingsHostSwitcher`, `lib/settingsHost.ts` |
| 位置标签 | scope chip | Where a page's or card's settings are kept: 「桌面应用」 (kept by the desktop app) or 「主机 · {host}」 (kept by that host's cutex); a click floats the explanation. Said once: under a 设置主机切换器 no tag repeats the host's name (「主机」, 「Codex 配置」), and a card in the place the header names has none (docs/design/settings-rules.md §2). Never 此设备 / 这台桌面应用: the daemon and the desktop app can run on the same device. Running text says 「保存在桌面应用里」 (owner 2026-11-25). | `ScopeChip`, `WhereChip` |
| 分部 · 分部导航 | part · part bar | A long page's parts (会话: 消息 / 输入 / 布局 / 旁边对话与批注): a quiet heading on a rule, and the row of chips at the top that jumps to them. | `PartHeading`, `PartNav` |
| 设置卡片 | settings card | A titled group of settings: title + chips + actions on one line, a hint under it, then the card. A card holds settings; a note alone is a title + hint with no card. | `Section`, `Card` |
| 设置行 | setting row | One setting: label (+ hint or ⓘ) on the left, its control on the right; under the label in a narrow card. A picture picker sits under its label. | `SettingRow` |
| 行组 | row group | Several rows under one name inside a card (留白里常驻, 组件默认位置). | `RowGroup` |
| 列表行 | list row | One thing in a list (host, site, server, rule): a name, one grey detail line, buttons on the right. Every row has the same actions in the same places (one that does not apply: disabled, the reason as tooltip); provenance is the card title, a row shows only a short readable label with the raw id as tooltip. | `ListRow` |
| 子页面入口 · 子页面 | sub-page entry · sub-page | A row with a count and › that opens a list too long for its page; the sub-page has 「‹ 页名」 back. | `SubPageRow`, `SettingsPageItem.subPages` |
| 改过标记 · 恢复默认 | modified mark · restore default | The short accent bar at a changed row's left edge, and 「↺ 恢复默认」 in the label line after the label and its markers, shown on hover; its space is kept, so it never covers the control. | `SettingRow` `reset` |
| 详细信息 | details | A fold at a card's end for developer facts (hashes, paths). | `Details` |
| 设置同步 · 同步开关 | settings sync · sync switch | Settings → 你 → 设置同步: per category (外观, 术语与语言, 模块开关…) a 「同步」 switch for this computer, the memory host and the last sync. Modelled on IDE settings sync (design 056 §12). | `SettingsSync.tsx`, `lib/settingsSync/` |
| 本机设置 · 同步设置 | this computer's settings · synced settings | The two sides when they differ: what this computer has, and what is kept on the memory host for you. Buttons 「用同步设置」 / 「把本机设置同步上去」. Never 用户配置 / 配置. | `SettingsSync.tsx` |
| 「保留哪一份？」 | keep which? | Asked once when a category is turned on and this computer differs: 「这台电脑的设置和同步设置不一样，保留哪一份？」 — 用同步设置 / 用本机设置 / 以后再说. | `SettingsSyncAsk` |
| 已同步 | synced chip | Small chip in a settings page header when a category on that page follows the 同步设置 here; opens 设置 → 你. | `Form.tsx` `SyncedChip` |
| 记忆主机 | memory host | The host that keeps your sidebar layout and 同步设置 (your person document). Each person picks one. | `lib/userLayoutSync.ts` |

## 卡片 Cards

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 委托卡 | delegation card | One delegation in the timeline: who to whom, state, answer. | `modules/delegations` (DESIGN §4.21) |
| 主管卡 | director card | The 主管's summary at the top of 项目视图. | `modules/project-view/DirectorPanel.tsx` |
| 成果 | artifact | A published report, figure or page. 成果卡 in the timeline. | `modules/artifacts` |
| 呈阅 · 全部 · 内部 | For you · All · Internal | Artifact library views (owner 11-28): 呈阅 = marked for the owner or starred by the owner (default view); 全部 = everything; 内部 = tag on team artifacts. Purpose chips: 报告 交付物 预览稿 佐证 未标用途. | `modules/artifacts` |
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
| 整理不常用的智能体 | tidy up unused agents | 设置 → 归档 sub-page next to 已归档的智能体: active agents of the settings host filtered by days unused (3/7/14/30 or typed), project, Profile, online; 全选当前筛选的 N 个 → 归档所选 (in-place second click; restorable). Working agents, unfinished delegations, a project's Director or 副主管, cutex not allowing it, and service owners are shown with the reason and never archived; pinned and owner-paused start unticked. | `modules/archive/IdleAgents.tsx`, `modules/archive/idleFilter.ts` |
| 快捷键方案 | shortcut scheme | Settings → 键盘与手势 → 快捷键方案: a named set of window / pane keys, like an IDE keymap. The built-in 「默认（内置）」 is read-only (复制后编辑); the owner's schemes store only what they change, platform-neutral (Ctrl / ⌘) with optional per-platform keys (「macOS 单独」). 新建 / 复制 / 重命名 / 删除 / 导出 / 导入; each device has an active one. Owner 2026-11-26. | `lib/keybindingSchemes.ts`, `components/settings/KeySchemesSection.tsx` |
| 我的快捷键 | My shortcuts | The scheme the old this-desktop key changes became on first start (made active, nothing presses differently); also the scheme a programmatic change starts while 默认 is active. | `lib/keybindingSchemeStore.ts` |
| 同步到我的其他设备（快捷键方案） · 已同步 | sync to my other devices · Synced | Per scheme (default on): the scheme and a deliberate switch go to the owner's other devices through the 同步 category 快捷键方案; 已同步 shows when the category is on for this device. A scheme turned off stays on this device (仅此设备). | `lib/keybindingSync.ts` |
| 查看平台 | platform (view) | The 窗口与窗格 card's Windows / macOS / Linux switch: shows the active scheme's keys and checks conflicts as on that platform; this device's is marked 本机. | `components/settings/KeybindingsSection.tsx` |

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
| 后台应用（标签「后台应用」，en "Background app"） | background app | A program cutex runs with no port or web page (`runtime: "worker"`, capability `services-workers-v1`). Listed with the web services on 服务; its main actions are 启动后台应用 / 停止后台应用 / 重启 / 日志, and opening it from a link, pin, quick switch or the header shows it on 服务. Not the 「后台」 purpose section of 服务 (kept under that name), which is about web services the owner keeps running in the background. Named by the owner 2026-11-10. | `lib/serviceWorker.ts`, `components/WorkerBadge.tsx` |
| 计划（旧称 进程） | plan | The model's update_plan checklist. | `modules/plan` |
| 目标 | goal | The objective an agent works toward, with an optional budget. | `modules/goal` |
| 工作流 | workflow | A multi-step run of several agents. | `modules/workflows` |

## 动作与状态 Verbs and states

One meaning, one word (copy round 3, 2026-11-25). The owner asked for it without pre-approval and will
change what he dislikes. Use these words on 接下来, 委托, 留言, 闹钟, 作业, 后台操作 and the composer, and in
new text anywhere. Change list: `.claude/reports/copy-round3-changes.md`. Narrow guards:
`test/i18nTermsAudit.test.ts` ("copy round 3").

| 意思 | 中文 | English | 定义 | 不要用 / 例外 |
|---|---|---|---|---|
| send | 发送（已发送 · 未发送） | send (sent · not sent) | The desktop or an agent sends a message or request. | Not 发出 / 没发出去. A delegation is 发起 (delegate), not 发出. |
| initiate a delegation | 发起 | delegate | An agent or the owner creates a delegation. | Not 发出 / 发送 for a delegation itself; its result is 交回. |
| queue | 排队（排队中 · 重新排队） | queue (queued) | Waits in cutex's queue for its turn. | Not 入队 / 排入队列. 「输入队列」 as a place name is fine. |
| hand over | 交给（交回 for a result） | hand over (hand back) | cutex passes an item to the runtime or a recipient; it is not yet read. | Not 交付. 提交 only for submitting a result for review, a job, a delegation attempt (正在提交), or resubmitting an operation. |
| deliver | 送达（待送达 · 未送达） | deliver (delivered · not delivered) | 送达 means the item has arrived in the recipient's input. 投递 may describe the sending process (「消息投递」, the Settings section). | Not 送到 / 重投. Never promise 送达 for a retry or resend: say 发送 / 重新发送 (「系统会继续尝试发送」), because arrival is not known yet. |
| read in | 读入（已读入） | read (in) | An agent or model takes the item into its context. | Not 读到 / 读进去. The app loading data is 读取; the owner reading a notice is 已读. |
| accept | 接收（已接收） | accept | A host or runtime took the item, before any effect. | Not 收下 / 接下. Delegation status 「已接收」 is decided on fix/delegation-card-routing-ui. |
| record a request | 记下（已记下停止） | record | cutex wrote the request down; nothing happened yet. | 记为 means "mark as"; 记录 is the noun (送达记录). |
| start | 开始 | start | A turn, delegation or step begins. | 启动 only for a runtime, process, service or app. Never 开 alone. |
| continue | 继续 | continue / resume | Work goes on after a pause or wait. | 恢复 only for archives, files, connections, hidden rows and members. |
| scheduled continue | 定时继续（自动继续已到期 · 允许继续 · 已取消自动继续） | scheduled continue (auto-continue expired · allow to continue · auto-continue cancelled) | A delegation the bus wakes on its own until its run/time limit; when that runs out it waits for the owner or requester to allow another stretch (card, side detail, delegation tree). | Not 续接 / 续跑 (owner 2026-11-25). Next Up still shows a limited delegation as 等待中. |
| continuation approval | 待允许继续（允许继续 · 拒绝并停止 · 已允许，等 X 空闲后继续） | waiting to be allowed to continue (allow to continue · deny and stop · allowed; continues once X is free) | On supporting hosts, an expired stretch becomes a request to the owner or the project's Director (approvals page section 待允许继续; card and side detail). Allowing starts another stretch (up to 32 runs or 24 hours) when the handler can run; denying needs a reason, stops the delegation and tells the requester. | Same verb as 定时继续: 继续 only. Not 批准续跑. After an approval the card adds the scheduler hold (「已允许，等 X 空闲后继续 · 现在：…」); an archived handler cancels the stretch (「X 已归档，这一段自动继续已取消，不会再继续」 — restoring does not pick it up). |
| pause (owner) | 暂停 · 随中断暂停 | pause · held by your interrupt | The owner stops new work until 继续 / 放行. | Not 扣住. |
| hold | 暂缓（已暂缓） | hold (held) | An item is kept back and goes on when released: by the runtime or bus on its own, or by the owner's per-message hold on 接下来. | Not 扣住 / 扣下 / 被扣留. The per-message button that lets one held message go stays 「允许发送」. |
| release | 放行 | release | The owner lets paused items go as a group: 「放行新委托」 for the new-delegation queue, 「已放行」 as its result. | One held message uses 「允许发送」. Not for approvals; that is 批准. |
| interrupt | 中断 | interrupt | Ends the current turn. | 打断 only inside the action name 「打断并发送」. |
| stop | 停止（已请求停止 · 停止未确认） | stop | Ends a runtime, job, service, delegation or subagent. | Not 停下 / 停. An agent's pause point is 暂停, not 停下. |
| dismiss | 放弃 | dismiss / abandon | Give up an item of your own (an unsent message, a delegation). | Not 丢弃 for your own rows. |
| discard | 丢弃（已丢弃） | discard | Remove an undelivered message from cutex so it is never delivered (Agent Bus, paused queue). | Not 放弃 for these. |
| withdraw | 撤下 · 撤回 | withdraw | 撤下: take a waiting item out of a queue. 撤回: take back something already sent. | 撤销 is undo (files, rules, stop idle). |
| end follow-up | 结束跟进（已结束跟进） | end follow-up | Stop waiting for a result; nothing is stopped. | Not 不再跟踪. 「不再等待」 may explain it in a sentence. |
| approve / allow | 批准 · 允许 | approve · allow | 批准: a yes to one request. 允许: a rule or permission. | 审批 is the noun. The delegation approval UI 「委托审批」 (审核 → 审批, no 路由) is decided on fix/delegation-card-routing-ui. |
| take effect | 生效（已生效） | take effect | An approved decision or setting now applies. | approvals.state.consumed 「已生效」 is decided on fix/delegation-card-routing-ui. |
| fail | 失败 (labels) · 未能 (sentences) | failed · could not | Something was tried and did not work. | Not 没能 / 没发出去. |
| retry · resend | 重试 · 重新发送 | retry · resend | 重试: try the same operation again. 重新发送: send a message again (may arrive twice). | Not 重发 / 再发一次. 「稍后再试」 is fine as a phrase. |
| wait | 等待（等待中 · 等待继续） | waiting | Nothing to do but wait. | Not 等着. 「等 {name} …」 is fine in short labels. |
| unconfirmed | 未确认（结果未确认） | unconfirmed | The outcome is not known; the app does not guess. | Not 不明 / 不确定. |
| stuck | 卡住 | stuck | Waited much longer than it should. | Not 受阻 for waits; 需要你处理 when the owner must act. |

Also decided on fix/delegation-card-routing-ui (accent-theme-ui owns these strings): the routing review's
stale and cancelled labels and their hover (state-surfaces W3a–c).

### 语气 Tone

- Plain and natural: what the person would say across a desk. Not colloquial (停下、没发出去、扣住、等着),
  not stiff or bureaucratic (予以、进行、该).
- Short labels (buttons, tags, states): a verb or 已 + verb, no subject, no ending punctuation
  (「重新发送」「已送达」「停止未确认」). Join two facts with 「 · 」.
- Sentences (hover, hints, dialogs): say who does what, then the result; full-width 「，；：。」, and a
  full stop at the end only when there are two or more sentences. Quote UI names with 「」.
- en follows the same split: sentence case labels, no full stop on a single-clause hint.
- Say 你 for the owner, 对方 / the term word for the other agent; keep `{{agent}}` / `{{owner}}`.

## 智能体菜单 Agent menu

The right-click menu of an agent (侧栏 row, 会话顶栏 ⋯, 全部智能体). Words that sound alike, kept apart (2026-11-05).
Menu rows (owner rule): a label never explains itself; a note goes behind the row's ⓘ. **…** means a dialog follows where
you fill in or choose something before anything happens (编辑信息…, 轮换主管…, 新建分区…); a yes/no confirmation, a row that
acts at once, and a submenu row with › get none.

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 在侧栏置顶 | pin to top of sidebar | Keeps the agent at the top of its 项目分组 in the 侧栏. Not the 托盘. | `lib/menus.tsx` `agentMenu` |
| 钉到托盘 ✓ | pin to tray | Adds it to the 托盘's 钉住 group; the ✓ says it is there, a click takes it off. | `modules/home` (`home.pin` ref action) |
| 并排打开（旧称 在侧边打开 / 在旁边打开） | open side by side | A second 工作区 beside this one, the same as Ctrl/⌘ + click or middle click on a 侧栏 row or a message-history result. When the window cannot fit a second column it replaces the current one and says so. The agent menu item's ⓘ explains both (module contract 1.33 `infoKey`). | `modules/conversation` ref action |
| 投影到当前 Shelf | project into this Shelf | Its live conversation as a 窗格 in the open 会话's Shelf. | `modules/conversation` ref action |
| 显示名称（在 编辑信息… 里；旧称 重命名） | display name | The first field of 编辑信息…, the name only the owner sees. It never changes the agent's own name (what 复制 › 名字 copies); other agents use the own name, and an @-mention sends it (the chip still shows the display name). An agent without an own name is listed under its display name. | `components/AgentInfoDialog.tsx`, `lib/agentAlias.ts` |
| 自己的名字 · 改名 · 改名记录（在 编辑信息… 里，显示名称下面） | own name · rename · name history | The name other agents use to find, delegate to and mention it (cutex formal agent name). Owner only, on hosts with cutex `formal-agent-name-rename-v1`: 改名 with an in-place second click; no restart, a running agent gets a quiet note, the old name stays reserved in the project and anyone using it gets a note. A case-only change (eva → Eva) is a rename too. An archived agent can be renamed too and stays archived (已归档 tag); if 恢复 is refused because its name is now taken or reserved, the message says whose and offers 改名…. 改名记录 is cutex's permanent log, 50 per page. The session ID never changes; a display name the owner set stays. Not the display name. | `components/AgentOwnName.tsx`, `lib/agentRename.ts`, `shared/agentRename.ts` |
| 打开 › · 设置 › | open · settings | 打开 ›: 打开文件面板, 打开所在项目, the window rows. 设置 ›: a Claude agent's tool switches and 额度用完后自动继续 (one row alone stays at the top level). | `lib/menus.tsx` |
| 头像 › | avatar | 跟着 Profile 变, 重置为当前风格, 显示 / 隐藏头像 in one submenu. | `lib/menus.tsx` `avatarItem` |
| 暂停智能体 / 暂停接收委托 | pause agent / pause incoming delegations | The first holds every new turn: before the next tool call on runtimes with a tool gate (newer Claude, native), at the end of the turn on DSH, Kimi and older ones. The second holds only new delegations to it; the conversation goes on. | `lib/agentPause.ts`, `lib/menus.tsx` |

## 引导 Guide

Onboarding v3 (owner 2026-11-26): the first run ends at the first message; the rest is optional and reachable from 帮助.

| 中文 | English | 是什么 | 主要文件 |
|---|---|---|---|
| 开始使用 · 三步卡 | Get started · the three steps | 连上主机 → 准备 Profile → 发出第一条消息, then the optional step 4 自定义桌面. In the empty main area on a first run, and the page `start.page` (帮助 → 开始使用). | `modules/start/StartCard.tsx` |
| 自定义桌面 | Customize the desktop | Theme, size, animation, wording, layout and avatars in the guide (step 4 and an item of 接下来可以试试), not a Settings page. The controls are the real settings' own; 「在设置里改更多」 opens the page. The old page id `customize-desktop` lands on 外观. | `modules/start/CustomizePanel.tsx` |
| 接下来可以试试 | Try next | The card at the top of the conversation the first message went to: side by side, hand work to another agent, phone / iPad, Personal Assistant, 自定义桌面. Collapses to a chip; 帮助 brings it back. | `modules/start/TryNext.tsx` |
| 示例项目 | sample project | 帮助 → 开始使用: a small practice project in a temporary folder, set up by an agent on the owner's Profile (uses a little quota). | `modules/start/HelpSection.tsx` |
| 新功能 | What's new | Settings → 新功能: each version from 0.2 on, the same notes as the upgrade dialog, without internal build names. | `modules/onboarding/NewFeaturesPage.tsx` |

## Code-only notes

These are code names only; users don't see them.

- **dock:** `InteractionDock` and `ConversationDockContext` are the area above the 输入框, but `modules/home/Dock.tsx` is the 托盘.
- **desk:** in code, another app window is a *desk* (`DeskWindows`, `deskStore`). Unrelated to 桌面 (`modules/home`).
- **gutter:** the 工具条 lives in `conversation.gutter`; `GutterHost` also draws reference cards beside the timeline.
- **status bar:** `StatusBar.tsx` is the 状态行, not a window status bar.
