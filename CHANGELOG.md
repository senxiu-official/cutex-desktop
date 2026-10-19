# Changelog

## 0.1.5 "First Take" (2026-10-20)

Two conversations side by side and the right side's pages turned into tool columns, delegations that
wait for your review approved right in the conversation, the owner's devices (three permission levels, a
notice when a new device connects as the owner, sensitive actions only on the host itself or over SSH),
host owners and connecting to someone else's host as a member, notes from agents on other hosts in Unread
messages (they can wake agents when the receiving host allows it), closing a desktop remotely, recently
finished subagents, Side chat and fork while busy for Claude agents, importing Profiles from CC Switch, a
short introduction on first use, and HTML pages over 4 MB that show after asking. Pairs with cutex 0.1.5
(several items need it; older hosts keep working without them).
两个对话可以并排打开，右侧栏的页改为并排的工具列；等你审核的委托在对话里直接批准或拒绝；主人的设备：每台设备可设为完全控制、对话和查看或只查看，有新设备以主人身份连上会提醒你，配对码等重要操作只能在主机本机或通过 SSH 进行；每台主机写明主人是谁，可以以成员身份连接别人的主机；其他主机的智能体发来的留言显示在「待读留言」里，接收方主机允许时还能唤醒智能体（默认关闭）；可以远程关闭另一台桌面；子智能体新增「最近完成」；Claude 智能体支持侧边对话和忙时分叉；可从 CC Switch 导入 Profile；首次使用有简短引导，每次更新后显示更新摘要；超过 4 MB 的成果页面可以直接显示。配合 cutex 0.1.5 使用（部分功能需要它，旧主机仍可使用）。

**Panes**

- Two conversations side by side: Ctrl/⌘-click or middle-click an agent in the sidebar, or use the
  "Open beside" button on its row, and it opens in a second conversation pane next to the one in front.
  Each pane sends, stops and shows notices for its own agent; the divider between the two can be dragged
  (double-click splits them evenly). "Open in side panel" in an agent menu and the side area's ＋ ▸ Agents
  (the host's online agents by project, the others in a submenu) open a pane beside too, also for an agent
  on another host. The layout is kept on this device.
  两个对话可以并排：在侧栏里 Ctrl/⌘ 单击、中键单击智能体，或点它那一行的「在旁边打开」，它就在当前对话旁边另开一栏；每栏的发送、停止和提示只对自己的智能体；中间的分隔条可以拖动，双击平分。智能体菜单的「在侧边打开」和侧边「＋ ▸ 智能体」也在旁边开一栏，另一台主机的智能体也可以；布局保存在本机。
- The right side's pages are now tool columns: instead of switching between pages, up to two columns stand
  side by side, each with up to three panes (what were its cards: file tree, changes, terminal, browser
  and so on). What a pane shows still follows the conversation in focus. An existing side layout is
  converted once.
  右侧栏的「页」改为工具列：不再在几页之间切换，最多两列并排显示，每列最多三个窗格（原来的卡片，如文件树、改动、终端、浏览器）；窗格内容仍跟着当前对话。原来的右侧布局会自动转换一次。

**Conversation**

- A delegation that waits for your review can be approved or denied where it shows: the recipient's queue
  row, the sender's delegation card and the side detail have Approve / Deny, the same decision as on the
  Approvals page (needs a cutex with owner approvals and a device with full control). A delegation to
  another host that waits for that host's owner says "Waiting for the owner of <host> to review" and no
  longer counts under "Needs you".
  等你审核的委托可以在对话里直接批准或拒绝：接收方的队列行、发起方的委托卡片和侧边详情里都有「批准 / 拒绝」，和审批页是同一个决定（需要完全控制的设备）；发往另一台主机、等对方主人审核的委托显示「等 <主机> 的主人审核」，不再算作「需要你」。
- Subagents: the agent's subagent status has a "Recently finished" group with its last 20 finished
  subagents (name, type, how long it ran, completed / failed / stopped); clicking one opens its thread.
  Claude subagents that ran in the background kept no transcript, so they show neither a duration nor an
  open.
  子智能体状态新增「最近完成」：列出最近 20 个已完成的子智能体（名称、类型、用时、完成 / 失败 / 已停止），点一下打开它的过程记录；在后台运行的 Claude 子智能体没有过程记录。

**Claude agents**

- Claude agents on the claude-r21 runtime get Side chat, like Codex agents, and can be forked while they
  are working; reverting still waits until the turn has ended. With an older Claude runtime Side chat stays
  unavailable and says why.
  Claude 智能体（claude-r21 运行时）支持侧边对话，忙的时候也能分叉；回退仍要等这一轮结束。旧的 Claude 运行时上侧边对话不可用，并说明原因。

**Hosts, users and devices**

- Owner devices (on a cutex that reports them): a device that connects as the owner has full control, so
  Settings → Users announces it on top (× when it is yours, Revoke when it is not) and the Users entry and
  the sidebar Settings entry get a dot. Each signed-in device shows its permission and, under Settings…, its
  projects (they follow its user's grant) and a permission that can only narrow that grant: Full control or
  As the user's grant, Chat and view, View only. A pairing code asks for the permission too; an owner code
  with full control says what it gives (single use, 5 minutes). Pairing codes, turning off approval for new
  devices and enabling or pairing linked hosts work on the host itself or over SSH; elsewhere they are locked
  and say so. Linked hosts can allow notes to wake agents here (off by default, with an hourly cap).
  主人的设备：以主人身份连接的新设备在「用户」页顶部提醒（× = 是我的设备，或吊销），导航有红点；每台已登录设备显示权限，在「设置…」里查看项目（跟随用户授权）并收窄设备权限；配对码可选权限，给主人的完全控制配对码有警示；配对码、关闭新设备审批、启用或配对互联主机只能在本机或通过 SSH 操作；互联主机可允许留言唤醒（默认关）。
- Taking a device's access away is now called Revoke (it invalidates the device's token at once); Remove
  stays for taking a host off this desktop's list.
  收回一台设备的连接权限改叫「吊销」（立即作废它的令牌）；「移除」只用于把主机从本机的主机列表里删掉。
- Settings → Hosts: the list is split into "My devices" (hosts whose owner is you) and "Devices I can
  access" (someone else's, including hosts where SSH gives you owner rights). Each host says how this
  desktop is connected (this machine, SSH: user@host, paired device) and what you are there (owner, owner
  rights, member, waiting to be assigned). Over SSH into someone else's account it says so plainly; an SSH
  host can be switched to connect as a member or as owner; adding one asks how to connect (Auto, Member,
  Owner) and says what was chosen. When this machine has no confirmed owner, "It's me" confirms you. On an
  older cutex that cannot report its owner, "This is my device" puts a host under My devices.
  设置 → 主机：分成「我的设备」和「我能访问的设备」；每台主机写明连接方式和你在那里的身份，可切换以成员 / 主人身份连接，添加时可选连接身份；本机主人未确认时可点「是我」，旧版 cutex 可手动标「这是我的设备」。
- Host ownership: the desktop reads who a host's owner is (the
  owner's name and key fingerprint, on a cutex that reports it) and can tell whether that is you. An SSH
  host can be connected as a member instead of with owner rights: the token is then issued as pending, so
  it never becomes the owner's. When adding an SSH host, the desktop picks by itself: member when the host's
  confirmed owner is someone else, owner otherwise (also on older cutex, or when the check fails). Hosts
  added before keep connecting as owner; re-pairing keeps the chosen way.
  主机归属：桌面端能读到主机的主人是谁、是不是你；SSH 主机可以「以成员身份连接」（领待分配的 token，不会直接归主人）。添加 SSH 主机时自动选择：主机已确认的主人不是你 → 成员，否则 → 主人（旧版 cutex 或检查失败时也是主人）。以前添加的主机照旧以主人身份连接，重新配对沿用原来的身份。
- Settings → Connection is reorganised around one host at a time: You · Hosts · Host · Users · Network
  proxy. Hosts is this desktop's list (my hosts and hosts I can access, add an SSH host, groups, view,
  diagnostics). Host shows the selected host's details (its owner, cutex version and system), your
  permissions there and where they come from (full control on this machine or over an SSH login, or
  granted access with a device token), this desktop's connection to it, and host links (other cutex hosts
  that can delegate to it, plus listen addresses and allowed web origins). Users shows the host's users,
  their signed-in devices, devices waiting to be assigned and the pairing code. Owner and permissions are
  told apart: signing in to someone else's account over SSH gives full control, not ownership. The old
  Users / Remote access / Peers links open the new pages.
  设置 → 连接 改为按单台主机组织：你 · 主机列表 · 主机 · 用户 · 网络代理。主机页写明主机信息（主人、版本、系统）、你的权限及来源、本地桌面应用连接和主机互联；用户页管理用户、已登录设备、待分配设备和配对码；主人和权限分开说明。
- Settings → Host → a linked host: the list of agents the other host exports stays usable with hundreds of
  them: busy ones first, in a scrolling box, and past ten a search box (name, ID, runtime) and a status
  filter with counts. Rows no longer repeat @host on every line.
  主机互联详情里「对方导出的智能体」：几百个时也能用——忙的在前、列表内滚动，超过 10 个时可按名称 / ID / 运行时搜索、按状态筛选（带数量）；每行不再重复 @主机名。
- Close a desktop remotely (on a cutex with `client-remote-close`): each desktop reports itself to the hosts
  it is connected to, and Settings → Users lists the online desktops (version, system, whose, last heartbeat,
  state). Close asks that desktop to quit after a 15-second countdown that whoever sits at it can cancel;
  only the desktop app quits, cutex, agents and services keep running. Settings → General → Allow closing
  this desktop remotely (on by default) turns it off for this desktop.
  远程关闭桌面：桌面在所连主机上报到，「用户」页列出在线的桌面；「关闭」让对方倒计时 15 秒后退出（可取消），只退出桌面应用，cutex、智能体和服务不受影响；「通用」里可关闭「允许远程关闭这个桌面」。

**Getting started**

- Getting started: a short introduction opens once on first use. It sets the language and the look (theme,
  palettes, size), explains that an agent is one session,
  as in Claude Code or Codex, with a few things Cutex adds around it, what a project and its director are,
  offers to add the first Profile when the host has none, and lets you pick how the app names agents
  (in the Chinese UI three wordings, including English "agent"; everywhere a Maid easter egg). After each update
  the new version's summary shows once. Settings → About turns that off and replays either.
  首次使用时弹出简短引导：智能体就是一个会话（和 Claude Code、Codex 里的会话一样，Cutex 在外面加了一些小东西）、项目和主管、没有 Profile 时引导添加、选择称呼（智能体 / 代理 / agent，另有 Maid 彩蛋）；每次更新后显示一次新版本摘要，可在「关于」里关闭或重新查看。

**Profiles**

- Profiles: "Import from CC Switch" lists the Claude Code and Codex providers set up in CC Switch on the
  host, grouped by app, with the current one and any provider already imported marked. Pick the ones you
  want and import them in one go; cutex copies their API keys into new profiles and only reads CC Switch.
  Providers without a key or with an OAuth login cannot be picked, and the reason is shown. Needs a cutex
  with profile-import-cc-switch.
  设置 → Profile 新增「从 CC Switch 导入」：按 Claude Code / Codex 列出主机上 CC Switch 配置的供应商，勾选后一次导入为 Profile；API key 由 cutex 复制，CC Switch 只读不改。

**Artifacts**

- Artifacts: an HTML page over 4 MB (often one with embedded audio or video) is no longer shown only as
  source. The view says how large it is and offers "Show page"; the page is then read from the host in
  4 MB windows and shown as usual, up to 256 MB (larger ones still show the source). The source stays
  visible below the prompt until you choose.
  超过 4 MB 的成果页面（常见于内嵌音频或视频）不再只显示源代码：会提示页面大小，点「显示页面」即分段读取并显示（上限 256 MB）。

**Settings**

- Settings → Conversation: rows regrouped by what they affect. Messages lists the message kinds first
  (reasoning, agent messages, images, turn summary), then the toggles; "Show notes in the timeline"
  joins it instead of a card of its own. "Fold long messages" is one three-way choice (Off, My messages
  only, Older replies too) and the threshold greys out when folding is off. Side chat is two cards,
  Side chat (which main history it sees) and Save as note (the turn the note belongs to, the prompt,
  now folded behind "Edit prompt…"), each saying when agents feel it; the side-chat model field is
  gone. Wording is tidied throughout ("title bar", "turn").
  「对话」设置页重新分组：「消息显示」先列消息类型再列开关并收入批注开关，「折叠长消息」合为三档，侧边对话拆为「侧边对话」和「记为批注」两张卡片，去掉侧边对话模型。
- Settings → Notifications → Event levels: one card grouped by what an event means for you (Waiting
  for you, Your work, Owner notifications, Other activity, Problems), each group opened by a dark band
  with one line on what it holds; every event has a plain title and a one-line description, and a
  four-level switch whose choice is highlighted, instead of a dropdown under module headings. The
  preset sits in the card's title row.
  「事件分级」按事件对你的意义分组（待你处理、你发起的任务、主人通知、其他活动、异常），每个事件有名称和一句说明，用四段选择代替下拉框。
- Settings: Queue order ("Queued messages may pass delegations", the host's rule) moves from Input area
  to Collaboration, next to Message delivery; Input area's "Up next" card keeps a link to it, so Input
  area holds this device's settings only.
  「排队顺序」从「输入区」挪到「协作」，放在「消息投递」旁边；「接下来」面板里留一行链接，「输入区」整页只剩本地设置。
- Settings: switching pages or the host keeps the current page on screen until the new one has
  loaded (at most 0.8 s), then shows it at once instead of card by card. A "Mixed settings" page with
  host cards also names (and lets you switch) the host those cards show, next to its tag.
  切换设置页或主机时，旧页面停留到新页面加载好（最多 0.8 秒）再一次换上；混合设置页旁边显示并可切换主机部分所用的主机。
- Settings: one rule for scope tags. A page is in one place (its tag says where; no card repeats it),
  or it is "Mixed settings" as soon as one card lives elsewhere, and then every card says where it
  lives (the "Mixed: <place>" tag goes). A page tag says "Doesn't affect agents" or nothing; cards say
  how they affect agents. Mixed pages have no part headings (Browser too). Every host tag can switch
  the host for all of Settings, and the card you switched from stays where it was on screen.
  设置页标签只有一条规则：单一位置就标那里；有一张卡片在别处就是「混合设置」，每张卡片都标位置；所有主机标签都能切换主机，切换后那张卡片留在原位。
- Settings: one set of scope tags. Where: Local desktop app, cutex backend · HOST, Codex runtime ·
  HOST (was "Codex settings"); a page with one card stored elsewhere says "Mixed: <place>", a page
  whose cards are each tagged says "Mixed settings". Agents: a page says "Doesn't affect agents" only
  when none of it does; a card that does says "Agents · from next start" (new and restarted agents),
  "Agents · takes effect now" or "Access". The MCP tool tag says whose settings the card holds plus
  the tool's own line. All locales get the tags (the partial ones had English).
  设置页标签统一：位置（本地桌面应用 / cutex 后端 / Codex 运行时、混合三档）、智能体（页头只标「不影响智能体」，卡片标何时生效）、访问权限、MCP工具。
- Settings: a card's tags (where it is stored, whether agents feel it) sit on their own line under
  its description, like the page header; the title line keeps only the title and the "changed only"
  switch. New tag "MCP tool" on cards about a tool agents call (Owner notifications: owner_notify);
  clicking it names the tool.
  卡片的标签移到说明下面单独一行；新增「MCP工具」标签，点开显示工具名（主人通知：owner_notify）。
- Settings: option lists no longer mark one choice "(default)" (owner notifications' audience,
  cross-project access, hidden browser targets, side component homes); a changed row shows its
  modified mark and Restore default instead, like every other row. Owner notifications says it is the
  agents' MCP tool owner_notify and is tagged as affecting newly started agents (who gets the tool).
  选项里不再写「（默认）」，改过的行照常显示改过标记和恢复默认；「主人通知」注明是智能体调用的 MCP 工具 owner_notify，并标「新启动的智能体」。
- Settings: settings that stay on this device are tagged "Local desktop app" (was "This device"),
  next to "cutex backend · HOST" for the host's. A page with both kinds, such as Notifications, has
  no "This device + host" tag in its header any more; its cards carry their own tags. Notifications:
  the page hint says what it sets, and the event table is called Event levels.
  只存在本机的设置改标「本地桌面应用」；混合页面顶部不再显示「本设备 + 主机」；「通知」页的事件表改名「事件分级」。
- Settings → Notifications: like the other pages, no part headings; each card carries its own tag
  (Local on Alert switches, "cutex backend · HOST" with the host picker on the host's cards). Alert
  switches (permission, its switches and the tests) come first, then
  the host's rules: Notification methods (how each level reaches you), owner notifications, and
  Notification levels (which level each event gets) last, all rows shown; each says what it adjusts. Agent messages read as what
  the agent said ("Agent says “Inform”") instead of looking like a level. The empty Outbound column,
  the second "changed only" switch, the Changed tags and the Delivery row that only pointed up are
  gone; an unavailable alert window says so instead of showing a greyed switch. Per-project
  notifications and per-agent mute / force are hidden until they get their own pages, and the default
  bell level for new agents (off / on / important) is gone from the page; what is stored still applies.
  「通知」页去掉「这台设备」「主机的通知规则」两个大标题，每张卡片自己标位置；先放「提醒开关」，再放主机规则：通知方式、主人通知，最后是通知等级；按项目通知、单个智能体和「新智能体的提醒」暂时不在页面上。

**Modules**

- Module contract 1.17: `pane.kind` and `services.panes.open` (docs/desktop-modules.md §24); the side agent
  card of 1.16 is a conversation pane now. 模块契约 1.17：新增窗格种类插槽和打开窗格的服务（`pane.kind`、`services.panes.open`）；1.16 的侧边智能体卡片现在是对话窗格。

**Fixes**

- An agent's messages to you and stopped commands now work when the agent lives on another host than the
  one the window shows (for example a laptop's desktop showing a server's agent): the card with Got it /
  Reply or "Grant once" / "Don't grant" is drawn, View and the "Needs you" row jump to it, and the decision
  goes to the agent's host. Before, the card was missing ("this message is not in the loaded history") and
  its buttons would have asked the wrong host.
  在一台电脑上看另一台主机的智能体时，它的消息卡片和被拦下命令的「批准一次 / 不批准」现在会正常显示，决定也会发到智能体所在的主机；之前卡片不显示（提示「不在已加载的历史里」）。
- Unread messages: on a cutex with admission order, notes another agent left (they do not start a turn)
  show in the recipient's Unread messages again. A note from an agent on another host shows as
  name@host with an "another host" tag; paths and ids in it refer to that host.
  「待读留言」：在支持排队顺序的 cutex 上，其他智能体留下的留言（不会开始新的一轮）重新显示在接收方的「待读留言」里；另一台主机的智能体发来的留言显示为「名称@主机」并标「另一台主机」，留言里的路径和 id 指那台主机。
## 0.1.4 "First Take" (2026-10-19)

Agents that wait for you are easy to answer (a status row above the input, approval cards in the
conversation), Claude agents get Claude Code's own permission modes, skills, settings and subagent
transcripts, agent browser tabs work in the background, plus a Network proxy page, signed module
packs, theme palettes and Settings reorganised to follow the window. Pairs with cutex 0.1.4 (several
items need it; older hosts keep working without them).
等你回复的消息和审批直接出现在对话里；Claude 智能体支持 Claude Code 的权限模式、技能、设置和子智能体过程；智能体的浏览器标签可在后台操作；新增网络代理设置、签名模块包和主题配色；设置页按窗口布局重新整理。配合 cutex 0.1.4 使用（部分功能需要它，旧主机仍可使用）。

**Conversation**

- Messages waiting for you: when the open agent has messages waiting for you (it asked for a reply,
  wants you to see something, or a command is stopped for approval), the status row above the input
  starts with "Awaits your reply" / "Needs you", the message's first line and its age. Clicking it
  scrolls to the message card, loading older history when the card is further back, and focuses its
  Reply; "Reply" on the row opens the card's reply box right there; with several, "+N" lists them. The
  open agent's "Awaits … reply" status in the sidebar jumps to the message as well. Sending an ordinary
  message to the agent still does not answer the request.
  有等你回复的消息时，输入框上方的状态行显示「等你回复」、消息第一行和时间，点一下跳到那张卡片（需要时加载更早的历史），也可以直接点「回复」；侧栏里的「等…回复」状态同样可以跳转。
- Side agent view: an agent opened in the side area shows its messages to you (owner-notify cards)
  with Got it / Reply, like the main area; before, an agent showing "Awaits your reply" had nothing to
  answer there. Scrolling up while older history loads stays on the turn you were reading instead of
  jumping to the thread's first turns.
  侧边打开的智能体也会显示发给你的消息卡片（可「知道了」/「回复」）；向上翻加载更早历史时停在正在看的位置。
- Conversation search: a Search button at the conversation's top-left corner (or Ctrl+F / ⌘F) searches
  the open agent's messages and replies and jumps to the turn of a hit, paging older history in when
  needed. Works for Claude agents and Codex agents on native 0.160+ (cutex `thread-search-occurrences`);
  the button is hidden on older cutex. 对话内搜索：点对话左上角的「搜索」或按 Ctrl+F / ⌘F，跳到命中的回合。
- Interrupted turns: a turn that was stopped or cut off by a runtime restart says "Interrupted" under
  its last row, live and after a reload; before, a reply cut off mid-sentence ended with nothing under
  it. Restarting the runtime while an agent works no longer leaves the turn and its tool call spinning
  forever (the turn reads "Stopped", the tool call "Interrupted"), also with older Claude runtimes that
  never report the cut-off turn: a turn still showing as running is settled when the agent's next turn
  starts, when its runtime goes offline or is replaced, and when its history is read back.
  被打断的回合末尾显示「已中断」；运行中重启运行时后，回合和工具调用不再一直转圈。
- Start runtime no longer looks like nothing happened. While cutex starts the runtime, the agent menu
  shows "Starting runtime…" (not clickable twice), the title bar's ⏻ spins and the conversation says
  it is starting (after 30 s, that it is still starting and where to look). A failed start, also an
  answer that is not online, stays on the conversation as "Starting the runtime failed: …" besides the
  dialog; the conversation's own Start link no longer swallows errors. 启动运行时有进度和失败原因，不再“没反应”。
- Composer model and effort: the effort menu offers only the levels the current model advertises; when
  it has none, or the model list does not name the current model, the menu says so instead of offering
  guessed levels the runtime then rejects. For an offline agent the model, effort and permission chips
  show "—" instead of a loading "…", and the menus say the agent must be running to read or change
  them. A refused change, or a change to an offline agent, shows as a notice ("The setting was not
  applied: …") instead of a "Failed to load from host" box over the conversation.
  推理强度菜单只列当前模型支持的档位；离线智能体的模型和推理强度显示「—」并说明需要先启动运行时；设置未生效时显示提示，不再弹错误框。

**Claude agents and Profiles**

- Claude permission modes: New agent, quick chat and a Claude agent's composer show Claude Code's own
  permission modes (Ask first / Accept edits / Plan / Auto / Full access) instead of the Codex presets.
  A new agent starts in the chosen mode (default Full access as before); in the composer the mode can
  change during a running turn, with a note on which tools the agent's write / command switches allow (a
  mode never enables a disabled tool). The same menu lists the workspace's persistent "always allow"
  rules (add / remove), approval cards offer "Always allow in this project" with the rule shown, and a
  Claude plan card offers Claude's choices: implement with edits auto-accepted, implement with manual
  approvals, keep full access / auto, or keep planning with feedback. A Claude quick chat no longer
  sends Codex-only permission fields, which cutex refused (`unsupported_launch_option`). Needs cutex
  `claude-launch-permission-mode` / `claude-permission-rules`; older hosts keep the previous UI.
  Claude 智能体在新建、快速对话和输入框里都可以选择 Claude Code 的权限模式（运行中也能改），并管理本项目的「始终允许」规则；计划卡片提供 Claude 的执行选项。
- Claude Code's own settings (cutex `claude-code-sources`): Profile → Behaviour gains "Read the
  project's Claude Code settings" (CLAUDE.md and the workspace's `.claude/` rules, subagents, commands,
  skills, hooks, permissions; project hooks do not run while "Allow commands" is off), "Read the
  account's user settings" (the Claude account's folder, not `~/.claude`) and "claude.ai connectors"
  (off by default); all apply at each agent's next start. A Claude agent's permission menu lists the
  settings sources and MCP servers it actually has, and says when a restart is needed.
  Claude Profile 可读取 Claude Code 项目和账号设置，权限菜单显示智能体实际使用的设置来源和 MCP 服务器。
- Claude agents (cutex `claude-session-skills`, `claude-rewind-files`; Claude runtime with `fastMode` /
  `modelObservation`): the skill picker (`/`, Reference skill) lists the skills the agent actually loads
  (project `.agents/skills` / `.claude/skills`, the account's `cutex-skills`, the host's
  `~/.cutex/claude-skills`) and sends them as skill inputs; replies get "Revert to here, with files",
  which also restores files from Claude Code's checkpoints; the Fast toggle works on Opus 4.8 / Opus 5
  models; the model chip shows the model that actually answered (e.g. `opus` → `opus-5-5`).
  Claude 智能体：技能选择器、回退时同时恢复文件、Fast 模式、实际响应模型徽标。
- Import from ~/.claude/skills… (cutex `claude-skills-import`, owner), in a Claude agent's skills flyout
  and in a Claude Profile's Behaviour section (Shared skills): lists the skills of a folder on the
  agent's host (default that host user's `~/.claude/skills`; remote hosts work the same), shows which
  already exist and which cannot be imported (symlinks out of the folder, too large), and copies the
  chosen ones into the host's shared `~/.cutex/claude-skills` (a skill of the same name is skipped
  unless you choose to replace it). 从主机的 Claude 技能目录导入技能到共享目录（同名已存在时跳过，可选覆盖）。
- Claude subagents can be opened: the Spawned card of an Agent / Task call and the Subagents rows open
  the subagent's transcript (its messages, thinking and tool calls) as a read-only right-side card,
  live while it runs and still there after a restart (cutex `claude-subagent-transcripts`; an older
  cutex re-reads every 5 s). Needs a Claude runtime with `subagentTranscripts`; older ones keep
  status-only rows. Claude 智能体的子智能体可以打开查看过程（只读的右侧卡片，运行中实时更新，重启后仍在）。
- Claude Profile models: the model list no longer shows Context and Auto-compact columns of bare "—".
  Claude Code decides auto-compaction itself, so there is no Auto-compact column; the Context column
  appears with a cutex that reports the Claude runtime's nominal context windows (1M / 200K; aliases
  show "varies", since an alias resolves per account). The header names the source ("Claude runtime
  reference list · date") and says that only display names can be changed. The Effort row offers only
  the levels the selected model has (none for e.g. Haiku 4.5, with a note) and labels the unset choice
  "Model default". Claude Profile 的模型列表不再显示整列「—」，推理强度只列所选模型支持的档位。

**Approvals and permissions**

- Owner approvals show up where the agent asked: when an agent's cutex tool call needs your approval (a
  managed or persistent service, an agent on an approval-gated Profile, a workflow plan, …), its
  conversation shows the decision card in the dock above the input, with the same facts, warning, note
  and Deny / Approve as the Approvals page plus a link there, and the tool call gets a line: waiting for
  your approval → you approved / you denied. The alert for a new approval opens the agent instead of the
  Approvals page. With an older cutex whose service approvals never reached the live stream, the desktop
  reads the approval from the tool result and alerts anyway. "Persistent service" and "Static folder" (a
  static service folder outside the agent's workspace) approvals get their own labels, facts and approve
  buttons that name the grant. 智能体的工具调用需要你批准时，对话里直接出现审批卡片，工具调用下标出状态。
- With a cutex that holds the agent's call for your decision (`approval-wait`), the approval card shows
  a countdown ("Waiting for your decision · 1:42 left") and comes first: approve before it runs out and
  the agent's call simply goes on, with no retry and no message. When the hold runs out (or the agent's
  turn ended) the card leaves the conversation; the request stays on Approvals, which shows the same
  countdown. 审批卡片显示倒计时：在倒计时内批准，智能体的这次调用直接继续；超时后请求留在审批页。
- With a cutex that records who decided (`approval-decided-by`), Approve / Deny on the Approvals page
  and in the conversation send where (page or conversation card) and how (mouse, touch or keyboard) the
  decision was made, plus this desktop's version and computer name; every decision made here also
  leaves one line in the local error log, so an unexpected decision can be traced to the desktop and
  button that made it. 审批决定会记录在哪台电脑、哪个界面、用什么方式做出，便于追查意外的拒绝或批准。
- Network access and extra writable folders of a running agent can be changed from the composer's
  permission menu (workspace-write / "Auto" agents): a network switch and the folder list with "Add
  folder…" (picked on the agent's host). The change applies from the agent's next turn and is kept when
  it goes offline / online, relaunches or the host restarts. Picking a folder that contains the host's
  `~/.cutex` (for example your home folder) asks first ("This makes ~/.cutex (including Profiles and
  tokens) writable for this agent", Cancel / Add anyway), here, in New agent → Advanced and in the
  new-thread defaults; such a folder already in the list carries a small warning mark. Needs cutex
  `session-sandbox-extras`; on older hosts, Claude agents and full-access / read-only agents the menu
  shows only the current values. 运行中的智能体可以在权限菜单里开关联网、增删额外可写目录，下一轮生效并一直保留；添加包含主机 ~/.cutex 的目录前会先提示。

**Network proxy**

- Network proxy (cutex `proxy-modes`): a new page, Settings → Network proxy, split into This device and
  Host, sets this desktop's update proxy and the cutex proxy of the host picked in Settings side by
  side; they are two separate settings, never synced. Update proxy (this desktop): Follow system
  (default; Windows / macOS system proxy incl. PAC, Linux desktop settings) / No proxy / Manual URL
  (http, https, socks5; a Basic `user:password@` login is kept with safeStorage and never shown again).
  It applies only to the updater and the programs a source update runs (git / pnpm get the proxy
  without credentials), never to calls from the desktop to cutex. Host proxy (cutex): Follow system
  (shows what the host detected: environment or Windows settings; no PAC, enter it manually) / No proxy
  / Manual with a bypass list; 127.0.0.1 / localhost / ::1 are always direct; a paired device sees it
  read-only. Switching from Manual to another mode and back shows the last address again (with its
  saved login), also after the page was closed in between. Older cutex: the host card says cutex needs
  an upgrade. 新增「网络代理」设置页：本机更新代理与主机代理并排设置，互不同步；从「手动」切走再切回时之前的地址还在。
- Profile proxy (cutex `profile-proxy`): the Profile editor has a Proxy card (Inherit host / No proxy /
  Manual) with what is in effect; it saves on its own and is hidden on older hosts. The Profile overview
  card has a Proxy line with the mode, the address (password hidden) and what is in effect; clicking it
  scrolls to the proxy section. Profile 可单独设置代理；概览卡片新增「代理」一行，显示模式、地址和当前生效情况。
- Requests to cutex (the local host, SSH tunnels) never go through a proxy: the desktop adds
  127.0.0.1 / localhost / ::1 to NO_PROXY at start. An answer that looks like a proxy's (407 / 502 / 504
  without cutex's error shape, or proxy headers) says "a proxy may be in the way", and "management API
  unreachable" names the reason (e.g. ECONNREFUSED). 发往主机的请求不走代理；像是代理返回的错误会提示可能有代理挡在中间。

**In-app browser**

- Tabs an agent opens run in the background, so several agents can click, type and take screenshots in
  their own tabs at the same time while the app is minimized, hidden or showing something else. The
  tab's card shows a live thumbnail and a Bring to front button; bring it to the front to watch or take
  over, and send it back with the background button. Switching waits for the agent's current action to
  finish and reloads the same page. Tabs you opened yourself and shared with an agent still need to be
  visible for the agent to click or type. 智能体自己打开的标签页可在后台操作，多个智能体可同时使用浏览器，卡片上有实时缩略图和「切到前台」按钮。
- An agent's `browser_act` scroll no longer reports "outcome unknown" when the page did scroll: the
  desktop waits briefly for the receipt and for the scroll to settle, and a same-page URL change during
  the scroll no longer loses the result. With a cutex that supports it, the result also says how far
  the page moved and whether it reached the end. 浏览器滚动实际已执行时不再误报「结果未知」，并可返回滚动距离和是否已到底。

**Profiles**

- Profile looks follow the host: with a cutex that stores them (`profile-avatar`), a Profile's picture,
  opening portrait, opening greeting and avatar themes are saved on the host, so every computer that
  connects to it shows the same (before, a picture set on one computer was missing on the others), and
  the Picture and opening card no longer says Local. The first time this desktop sees such a host,
  pictures and openings it kept for that host's Profiles are uploaded where the host has none yet and
  then removed from this computer; with an older cutex everything stays on this computer.
  Profile 头像、开场图、开场白和头像主题保存在主机上，每台连接这台主机的电脑看到的都一样；本机已有的设置会在第一次连接时自动上传。
- Avatar themes are a row of toggles, one per theme with a few of its emoji: tick several and an agent
  without its own avatar gets its default emoji from all of them, the same on every computer (at least
  one stays ticked; All ticks every theme; Restore default goes back to the model family's themes).
  Emoji avatars show more of the Profile colour (55 % instead of 30 %), so it is recognisable in the
  dark theme too. 头像主题改为多选按钮；表情头像的底色更接近 Profile 颜色。

**Sidebar**

- An online idle agent folds into "N idle" only after 30 minutes without conversation activity; one
  that just finished a turn stays a full row and moves into the fold by itself later. The Director,
  pinned agents, agents that want you, the open agent and fresh agents follow the same rules as before.
  The activity time behind this, the ordering by recency and the "5m" labels come from real
  conversation activity only (turns, messages, tool calls, file changes): a runtime start, stop,
  restart or reconnect, and renaming or changing an agent's Profile or settings, no longer make it look
  recently active. 侧栏只把空闲满 30 分钟的在线智能体收进「N 个空闲」；活动时间只算真实对话，运行时重启或重连不再刷新它。

**Settings**

- Settings pages follow the window from left to right: Left sidebar, Conversation, Input area, Status
  and Right side & margins. Conversation keeps the header and how messages show, with long
  conversations and long messages in one card. Input area has sending, the "Up next" panel, what sits
  right above the input (the "Needs you" strip) and the bottom bar below it, each saying where it is on
  screen, plus Queue order: "Queued messages may pass delegations" is the host's setting, so it has its
  own card with a host picker. Status holds where each status item shows (status row or capsule) and
  the capsule card, and other modules can add their own cards there. Conversation sides is now Right
  side & margins and also holds what happens when an agent publishes an artifact and the bookmark
  ribbon; Where components open lists only the ones you changed until Show all.
  设置页按窗口从左到右排列：左侧栏、对话、输入区、状态、右侧栏与留白；主机的排队设置单独成卡「排队顺序」，成果和书签条设置在「右侧栏与留白」。
- Settings → Sidebar & header is now Left sidebar, in four cards: Projects (with Reset order as a
  button), Agent rows, Style and Hover preview. Each row has a short description and the choices
  explain themselves on hover; the hover delay is disabled while hover preview is off. Project
  separation and Project header tint are now one setting, Project color (Icon only, Line under the
  icon, Left rail, Tinted block, Header band); a header band with the tint off becomes Line under the
  icon, which looked the same. 「侧栏与顶栏」改为「左侧栏」，分成四张卡；「项目分隔」和「项目标题着色」合并为「项目颜色」。
- Adjust in main window: the left sidebar's settings open in a small panel right beside the sidebar,
  so each change shows where it happens; Settings → Input area opens its panel right above the input
  (the status row stays visible), and Settings → Right side & margins opens one beside the right column
  (opening the column if it was closed). Open the left sidebar panel from its settings page (or that
  page's search result), or with Adjust left sidebar… in a project or section header's right-click
  menu and on the sidebar's empty area. The panels have the same rows, modified marks, Restore default
  and filter as the settings page, hold this device's settings only, close with ×, Esc or their entry
  again and stay open while you use the window.
  在主界面调整：左侧栏、输入区和右侧栏的设置可以在主界面旁的小面板里改，改了马上看得到。
- Settings page headers: every page says what it is for in one line, then shows scope tags: where the
  settings live ("This computer", "cutex backend · HOST", "Codex settings · X", or "This device + host"
  on a page with two parts) and, on reviewed pages, whether agents feel them ("Doesn't affect agents",
  "Newly started agents", "Running agents · now", "Affects access"). Click a tag for a short
  explanation; with several hosts the host half of "cutex backend · HOST" opens the host list. A
  section or card whose scope differs from its page shows its own tag, and the page's tag says that
  such a card is the exception. The header is the same height on every page, with or without an Adjust
  in main window button. General is split into Language (with Date format and Number format shown as
  planned, not working yet), Terminology (formerly Terms: one row per role for the current language
  only, labelled in two languages) and Window; the close-window hint only appears when there is no tray.
  设置页页头统一为一句说明加范围标签（存在哪里、是否影响智能体，点开有解释），各页高度一致；通用页拆成语言、术语、窗口三块。
- Settings show what you changed: a modified setting gets a small blue diamond on the card's left edge,
  and "Reset to default" appears after its label when you hover or tab into the row. The reset column
  on the right is gone, so every card has the same narrow margin on both sides. A card with changed
  settings offers "Only what you changed (n)" to hide the rest. The rows of Left sidebar show the same
  marks. 改过的设置在卡片左边框上显示小菱形，悬停时出现「恢复默认」；卡片可只看改过的设置。
- Settings previews share one "Live preview" band at the bottom of the card. Terminology shows pieces of
  the real UI (new agent entry, online count, director badge, subagents, parent agent, waiting for the
  owner) instead of a grey sentence; hovering or focusing a row turns its word blue in the preview, and
  the band's "Mark terms" switch marks them all. The font preview on Appearance uses the same band.
  设置页的预览统一成卡片底部的「实时预览」栏；术语预览改成界面片段，可一键标出全部术语。
- Input area hints are shorter: Sending says only what Enter does while an agent works (queue it until
  the turn ends, or steer it in before the next tool call), with a link to Keyboard shortcuts for the
  other keys; the "Up next" panel's Opening hints are one line for either choice, so the rows below no
  longer jump; switches say what they turn on instead of listing what on and off do.
  输入区的说明更短：「发送方式」只写智能体工作时按回车会怎样，「展开方式」的说明缩成一行，开关直接说明打开后的效果。
- Settings fixes: the bookmarks card ("show a ribbon beside bookmarked turns") was registered but never
  shown; now it is. Peers shows its page hint. Hooks that are untrusted or modified show their switch
  off ("Runs once trusted"), since they do not run. The right-pane option reads "Collapse right pane"
  in Chinese, and the rollback hint says the old release is kept on the host, not on this computer.
  设置页修复：书签设置终于能看到，未信任的钩子显示为关闭，并修正几处文案。

**Appearance**

- Theme palettes: Appearance has a palette for the light theme (Plain, Rice Paper, Mist) and one for
  the dark theme (Graphite, Smoke, Dusk, Tea, Sandalwood, Ink), picked from colour swatches. Rice Paper
  is a warm off-white; Smoke, Dusk and Tea are charcoals from a touch to fully warm, Sandalwood leans
  red-brown and Ink is true black. Both rows are always shown, and following the system switches
  between your two picks. The defaults are today's look.
  主题配色：浅色可选素白、宣纸、晨雾，深色可选石墨、烟灰、暮色、茶色、檀木、浓墨；跟随系统时自动切换。
- The window opens in your theme's colour: with a palette such as Rice Paper or Dusk (or a forced light
  or dark theme) it no longer flashes white or grey before the app draws, and the Windows caption
  buttons follow palette changes too. Launcher art is marked Legacy; it will be redone.
  窗口启动时直接用当前主题和配色的底色，不再先闪一下；Windows 标题栏按钮也跟随配色。启动页立绘标为旧版。
- Fonts: the font pickers are fields you can type into; the list opens on focus, filters as you type,
  and a font name that is not listed can be used as typed (replacing the "Custom…" entry). The Fonts
  card reads as three parts, Interface, Conversation and Code, each listing its CJK font first, then the
  non-CJK font (and size), followed by its own live preview; Code gets its own CJK font row, which only
  offers "Same as interface" for now. Appearance is regrouped into Colors, Fonts, Layout (now with
  Zoom) and Icons & avatars, with plainer descriptions.
  字体改成可输入、可筛选的下拉框；字体卡分成界面、对话、代码三段，各有实时预览；外观分区重排为颜色、字体、布局、图标与头像。
- Dragging the Zoom slider no longer rescales the window under your pointer; the zoom applies when you
  let go. Conversation width is one row: Fixed (with its slider) or Full width.
  拖动界面缩放时松手才生效；对话区宽度合成一行（固定宽度或全宽）。

**Language and terminology**

- Default role words follow one case rule: "director" is lower case mid-sentence like "agent" and
  "owner" (sentence starts and labels still capitalise it). The same for the French, Spanish,
  Portuguese, Italian and Russian defaults; German keeps its capitalised nouns. A word you set yourself
  is unchanged. The English default "sub-agent" is now "subagent" (a custom agent word still gets
  "sub-" in front), and the parent agent default is translated in Russian, French, Spanish, Portuguese,
  Italian, German and Japanese instead of showing the English words.
  默认角色词统一大小写；英文去掉子智能体一词中的连字符；7 种语言补上父智能体的译名。
- Chinese UI wording: steering has one name everywhere (the word for "cut in" rather than "insert"),
  and its hints say when the message arrives: before the next tool call, without interrupting;
  interrupt and steer is now interrupt and send. Side chat has a plainer name ("side conversation"),
  and the conversation it branches from is consistently the main conversation, also in annotations.
  The status row and the bottom bar get their own names instead of sharing one.
  中文界面把「插入」统一为「插话」，「打断并插入」改为「打断并发送」；「侧聊」改名「侧边对话」，「主聊天」统一为「主对话」；状态行和底栏各有自己的名字。

**Modules**

- Settings → Modules can download newer versions of first-party modules as signed module packs, without
  a new app release. The app checks the module index when you open the page (or click Check for
  updates) and downloads only when you choose Download / Update; nothing is downloaded automatically. A
  pack is accepted only when its index is signed with the Cutex release key and every file matches its
  signed hash; it is stored per version, checked again at every start, and replaces the built-in copy
  only while it is newer and compatible with this app. If a pack cannot be loaded, the built-in copy is
  used and the reason is shown; an older version is installed only after you confirm the downgrade. In
  this release every module stays built in; Claude Science is the first module also published as a
  pack. 「模块」设置页可以单独下载第一方模块的新版本（发布密钥签名的模块包），只在你点「下载」或「更新」时下载；加载失败时自动退回内置版本。

**Updates**

- Settings → About gets "Changelog" next to Known issues, with this desktop's own release history, shipped
  with the app (works offline), in your language where an entry has both; the installed version opens
  first and versions newer than the last one you looked at are marked New. The GitHub copies of the
  changelog and the known issues are a secondary "View on GitHub" link. About, Updates & diagnostics
  and Host backend updates lead with the current version, where it stands and the one action that
  fits; hashes, sequences, sources and channels moved under "Details". The two Project cards are merged
  into one on About. Host backend updates shows what the installed cutex release brought when this
  desktop saw its notes while it was on offer. 「关于」新增「更新记录」；三个版本页先显示当前版本和状态，技术细节收进「详细信息」。
- Self-update (source installs): an update whose pull was cut short, for example because the disk
  filled up while git was writing the new files, no longer leaves every later update refused with
  "source checkout has uncommitted changes". The next update recognises the half-written pull, discards
  exactly those files, notes it in update.log and pulls again; any other edit in the checkout is still
  refused and left alone. A pull that fails because git could not write files says to check the free
  disk space. 自更新拉取中途失败（如磁盘满）后，下次更新会丢弃半写入的文件并重试，其他本地改动仍会拒绝更新。

**Fixes**

- New agent / quick launch: an error or notice at the top of the composer (e.g. a create error
  `unsupported_profile: …`) no longer runs under the provider portraits or title; the art shrinks above
  it. 新建智能体页的错误提示不再和立绘、标题重叠。
- Usage → Model: model names that differ only in case (`GLM-5.3` / `glm-5.3`, from an older cutex or
  across hosts) add up in one series. 用量按模型：仅大小写不同的模型名合并为一项。

Known issues: [docs/KNOWN-ISSUES.md](https://github.com/senxiu-official/cutex-desktop/blob/release/docs/KNOWN-ISSUES.md) (also in Settings → About). 已知问题见此文档或「设置 → 关于」。

## 0.1.3 "First Take" (2026-10-17)

In-app browser you can actually work in, "Auto" decided by Codex's automatic reviewer, Windows
sandbox setup in one click, and copying a Profile to another host. Pairs with cutex 0.1.2 (several
items need it; older hosts keep working without them).
内置浏览器可以正常使用（HTTPS、局域网地址、和智能体共用标签、下载与网站权限）；「自动」改由 Codex 自动审批员决定；
Windows 沙箱一键设置；Profile 可复制到其他主机。配合 cutex 0.1.2 使用。

**In-app browser**

- HTTPS pages load again. Electron 44 reports a successful certificate check as `net::OK`, which the
  browser session did not accept, so every https:// page failed with `ERR_FAILED`. An invalid
  certificate is still refused. 内置浏览器的 HTTPS 网页可以正常打开了。
- A LAN or tailnet address you type in the address bar (192.168.x.x, 10.x, 100.64.0.0/10,
  `nas.local`, a tailnet DNS name) now opens directly — also with websites turned off. It is admitted
  for that tab and origin only: other pages, other tabs and agents still can't reach it or any other
  LAN / local address, and link-local / reserved addresses (169.254.x.x) and cutex control ports
  never open. 地址栏输入的局域网 / tailnet 地址直接打开，仅限该标签与该来源。
- Security: pages can no longer reach arbitrary ports on this computer. A local address (localhost /
  127.0.0.1 / [::1]) is reachable only in the tab where you (or the agent's browser tool) opened it,
  and only from that page itself; the hosts' management, message-bus and browser-proxy ports never
  open. 网页不能再访问本机任意端口；本机地址只在你自己打开它的标签里、由该页面自身访问。
- A refused address says which of four things stopped it — websites turned off (with a "Turn on
  websites" button that also retries), the internet proxy not ready ("Retry"), a LAN / tailnet / local
  address a page tried to reach on its own, or a cutex control port. 内嵌浏览器被拦时说明具体原因，只给真正能解决问题的按钮。
- Shared tab: your clicks, scrolling and reading no longer pause the agent. Its typing / clicking
  waits only while you are typing (about 1 s after your last key), and anything it saw before you
  touched the page must be looked at again first. With the window minimised the agent can still read
  the page; actions need the tab visible. An agent click that pulled focus into the page hands it back
  to where you were typing. "Pause agent" is its own button (the grant stays); "Resume" resumes the same
  agent's lease with one click. 共享标签：只有你正在打字时智能体才等待；暂停与撤销分开，继续一键恢复。
- Links and forms that open a new window (`target=_blank`, `window.open`, also POST forms such as
  "pay" or "sign in with…" buttons) open as a new tab in the same login pool after your click, with the
  full address and form data; a page opening windows on its own is blocked with a notice. A click by
  the agent opens the tab too. 新窗口改为同一登录池里的新标签（含 POST 表单）。
- Downloads you start open a save dialog (they were always cancelled before). A download by an agent
  working in a shared tab opens the same dialog, titled with the agent's name, only while the window
  is visible; a page downloading on its own is blocked with a notice. 你点的下载会弹出保存窗口；智能体的下载也要你选位置。
- A page's own site can ask for the camera, microphone, location, notifications and similar; you
  answer in a native dialog (agents and pages can't click it), and "Remember" keeps the choice for that
  exact origin and login pool — Settings → Browser → Site permissions forgets it. Cross-site frames,
  plain-http LAN pages, device access (USB / serial / HID / Bluetooth), screen sharing and fullscreen
  stay off. 网站可请求摄像头、麦克风等，由你按网站授权。
- With cutex 0.1.2 (`browser-refusal-reasons`, `browser-popup-grant`) agents get the precise reason a
  page was refused, each with its own next step, and a tab the agent's own click opened is handed to
  it under the original tab's grant (pause / revoke as usual). Older hosts keep the generic answer and
  leave such tabs to you. 新版 cutex 主机：智能体得到具体拒绝原因；它点开的新标签沿用原授权。
- In-app browser site permissions no longer hang a page. The owner's
  answer is a native dialog, which only rises with the Cutex window: when the window was behind
  another app (or the request came from a script / an agent while you were elsewhere) the dialog
  stayed out of sight, `getUserMedia` / `Notification.requestPermission()` waited forever, and every
  later prompt queued behind it. Now the browser card shows a line while its dialog is open (and how
  it ended when you were not asked), a window that is not in front flashes; an unanswered dialog
  closes after 2 minutes as a block that is not remembered (the next request asks again and is no
  longer stuck behind it); leaving or closing the page closes its dialog; a hidden / minimized window
  denies with that line instead of silently. New
  QA `scripts/qa-browser-permissions-electron.mjs` drives the real permission modules on the owner and
  agent partitions and answers the real native dialog through the OS (camera + notifications: deny,
  allow, "Remember", remembered, forget). 网页权限请求不再卡住：窗口不在前台时会提示，2 分钟未回答按阻止处理（不记住）。
- In-app browser: handing a tab to an agent now says why the grant ended instead of a bare
  "Control was revoked", e.g. the window or card is not visible (minimized, or on Windows fully covered
  by another window) or the host refused it. Agents only have `browser_*` tools when their profile has
  "Browser tools" on, they were started after that, and their runtime's facade is cutex r228 or newer.
  交给智能体失败时会显示具体原因（例如窗口不可见）。

**Permissions and approvals**

- "Auto" now uses Codex's automatic reviewer: escalations (writes outside the workspace, network
  when it is off, commands that ask to leave the sandbox) are decided by the reviewer instead of
  asking you. New agents and quick chats in Auto start with it (cutex `launch-approvals-reviewer`; on
  an older cutex the desktop sets it right after creation). A workspace thread whose approvals still
  go to you shows as Custom — click Auto to switch it. Read only keeps asking you.
  「自动」改用 Codex 自动审批员：越界操作由审批员决定，不再询问你。
- "Auto" means network on wherever you pick it: the new-agent page and a pending quick chat now turn
  network on like switching a running thread already did. The network toggle can still turn it off.
  「自动」在所有入口都开启联网。
- The reviewer's decisions show on the tool row it reviewed: "Approved by the auto-reviewer · low risk"
  or "Declined by the auto-reviewer · high risk — <reason>" (click for the full reason), a declined
  command reads "Not run (declined)" instead of a bare failure, and a review without a tool row (network
  access) gets a line of its own. 工具行显示自动审批员的决定和理由。
- The composer's permission chip tells what is in effect beyond the mode name: hover it, or open the
  menu, for who decides escalations (the reviewer / you / never asks), network on or off, and the
  extra writable directories, plus a named permission profile if one is active.
  权限按钮显示实际生效的审批方式、联网与额外可写目录。
- Approval and question cards say who is asking: "Codex sandbox" (the native sandbox; in Auto the
  reviewer answers these instead), "cutex" (managed services, the browser, Profiles, workflows —
  always yours to decide, whatever the mode), "Model question" (the model's question tool, not a
  permission) and "MCP server". Hover for what it means. 审批卡片标明来源。
- A Claude tool call that a Claude Code safety check stopped no longer reads "Failed": its row says
  "Stopped by a safety check" with the check's reason, and a folded work group counts it as stopped.
  被安全检查拦下的工具调用不再显示为失败。
- Windows hosts: when an agent has no Windows sandbox, its permission menu says "Windows sandbox not
  ready: plain commands ask too" and explains why every command asks in Auto / Read only; one click
  sets up the sandbox that needs no administrator rights (takes effect after the agent goes offline
  and online again). Settings → New agent defaults → Windows sandbox shows and sets it for new agents.
  The elevated sandbox stays a step on that host (`/setup-default-sandbox`). Needs cutex 0.1.2
  (`windows-sandbox-readiness`). Windows 沙箱就绪提示与一键设置。

**Profiles, hosts and agents**

- Copy a Profile to another host (cutex 0.1.2 `profile-transfer` on both hosts): a Profile card's
  menu gains "Copy to another host…". One dialog: target host, new name (never overwrites), and the
  credential row of the Profile's kind — an API key is copied too unless unticked, a ChatGPT login is
  never copied (log in again on the target), a Claude Profile uses the target's Claude account with the
  same name, else its default account. The settings and the key go from host to host inside the
  desktop's main process only, never to the window or the error log.
  Profile 可复制到其他主机（设置 + 可选 API key；ChatGPT 需在目标主机重新登录）。
- Kimi Code membership plan (cutex `kimi-code-plan`): api.kimi.com / api.kimi.ai count as Kimi
  Code's own API (China / international, Kimi logo; `k3` models too), the quota picker lists the new
  `kimi_code_plan` reader and the mapping mode `used_ratio`; a quota window named `month` shows as
  This month. Kimi Code 会员套餐：额度读取，月度窗口显示为「本月」。
- SSH hosts typed as `user@host[:port]` (not only `~/.ssh/config` aliases) ask for a key passphrase,
  password / one-time code or an unknown host key (with its fingerprint) in a dialog instead of
  failing; answers go only to ssh and are never saved. SSH 主机需要口令、密码或确认新主机密钥时会弹窗询问。
- Sidebar pins: a pinned agent is always a full row — never folded into "N idle", the Running rows or
  Offline N, and still listed under a collapsed project — with a 📌 after its name; pinned quick chats
  sort first. Agents are no longer bookmarked (pin them instead; existing agent bookmarks stay under All
  bookmarks). 置顶的智能体始终整行显示并带 📌；智能体改用置顶，不再加书签。
- Sidebar: a collapsed "N idle" no longer opens by itself, also while a host reconnects; an idle
  agent with a finished turn you have not seen stays in the fold as an avatar with a ✓ and the header
  counts it ("› 3 idle · 2 done"). The project menu's "Don't fold online idle" moved under Sidebar
  display ›. 收起的「N 个空闲」不再自己展开。
- Agent menu regrouped: view actions (Pin, Mark as read) · open / copy · change the agent (Rename, Edit
  info, Fork, Pause delegations…) · runtime (Stop / Restart runtime) · Archive / More. 智能体菜单按用途分组。

**Files, artifacts and previews**

- File and artifact previews show **PDF** (pages, zoom, page jump, selectable text) and **DOCX**
  (converted to sanitised HTML); other office formats and files over 10 MiB get a clear "can't
  preview here" card with type and size. 预览 PDF / DOCX；其他办公文档和超过 10 MiB 的文件显示说明卡片。
- Artifact view: one row of tabs — Preview · Source code · Origin · Compare. Source code appears for
  Markdown, HTML and CSV / TSV; Markdown renders with the chat renderer (no raw HTML or scripts).
  成果视图合并为一行标签：预览 · 源代码 · 出处 · 对比。
- HTML, PDF and image artifacts published under a label name preview again (an older cutex stored
  them as `text/plain` / `application/octet-stream`); existing artifacts are fixed without a
  migration. 以名称发布的 HTML / PDF / 图片成果可以正常预览了。
- The Files tree updates by itself after an agent edits files, and the workspace watch re-opens after
  a host reconnect; expanded folders and the selection stay. 智能体改动文件后，文件树自动刷新。
- Terminal colours are readable in both themes (a 16-colour ANSI palette per light / dark theme,
  switching live). 终端配色在浅色、深色主题下都清楚可读。
- Static services (files cutex serves) no longer offer Stop / Restart / Logs, which cutex refused with
  `not_supervised`; they can be opened or deleted. 静态服务不再显示停止 / 重启。

**Settings and updates**

- Host backend updates: a finished update becomes a short "Updated to …" note you can dismiss (the
  steps stay in Update history), and the run card, the note and Update history say what new agents
  get — a new native runtime x → y only when the release brings one, else a new runtime package
  (from cutex's own record with cutex 0.1.2 `upgrade-run-native`). 后端更新完成后变为可关闭的提示，并说明新智能体得到的运行时。
- Settings cards no longer turn into empty bars after a page updates several of them at once (seen on
  Host backend updates right after a cutex update); a card whose content fails to render shows the error
  and a Retry button. The same layout risk is gone from Profile cards, the sidebar footer, the new-agent
  page, the conversation opening and Peers → exported projects. 设置卡片不再变成空白条；出错时显示原因和「重试」。
- Settings → About → Known issues also reads the list published on the project's `release` branch,
  fetched through the same proxy settings as updates and kept for offline use; entries hide on
  versions that fixed them. 已知问题会从 GitHub 的 release 分支获取最新列表。
- Updates & diagnostics: release (binary) installs only offer check intervals of an hour or longer,
  matching the hourly limit of background checks. 发布包安装的检查间隔最短为一小时，与后台检查的每小时上限一致。
- Launcher artwork can be imported at runtime: Settings → Appearance → Launcher artwork "Import from
  folder…" / "Clear" (PNG files with the launcher's exact names, ≤ 10 MiB each); release builds, which
  bundle no artwork, can show it now. 启动页立绘可在设置 → 外观里从文件夹导入。
- Fix: a right-click / "⋯" menu no longer closes by itself while an agent streams.
  智能体输出时右键菜单不再自己关闭。

Known issues: [docs/KNOWN-ISSUES.md](https://github.com/senxiu-official/cutex-desktop/blob/release/docs/KNOWN-ISSUES.md) (also in Settings → About). 已知问题见此文档或「设置 → 关于」。

## 0.1.2 "First Take" (2026-10-16)

Optional backend components can be installed from the app. Pairs with cutex 0.1.1.
可选的后端组件（Job Service、Claude 运行时）可以在应用里安装。配合 cutex 0.1.1 使用。

- Install card for optional cutex components: the **Jobs** page offers the Job Service (Linux
  hosts), and Claude Profiles, Claude accounts and the new-agent page offer the Claude runtime. The
  card shows the install progress and, when the host still needs something from you (Python, the
  Claude Code CLI, a Claude login), the steps to do on that host. Needs cutex 0.1.1+ on a managed
  install; older hosts show "update cutex first". 可选组件的安装卡片。
- The ⚙ Settings dot in the sidebar also lights up when a host has a cutex update available, so
  you notice it without opening Settings → Host backend updates. 主机有 cutex 更新时，侧栏「设置」上出现小圆点。
- While the model request of a running turn is retried, the turn and its sidebar row show
  "Reconnecting n/5 · HTTP 524 · host" (attempt, HTTP status, provider host). 模型请求重试时显示重连进度。
- Help & docs (identity menu) works on installs from the release packages: each package carries
  `docs/QUICKSTART.md` and opens it; an app outside its release folder opens the published copy.
  帮助与文档在发布包安装上也能打开。
- Each package also carries the `skills/cutex-docs` manual for your own coding agent
  (AGENT-INSTALL §13). 每个发布包还附带 `skills/cutex-docs` 手册，供你自己的编码智能体使用。
- Pairing a Windows cutex host over SSH (e.g. from a Mac) finds `cutex.exe` under
  `%LOCALAPPDATA%\cutex\bin`. 通过 SSH 配对 Windows 主机时，能在默认安装位置找到 cutex。
- Claude agents with full access: when Claude Code's safety check blocks a command, the agent is
  told to do it another way or stop and explain, and a "Needs you" card lets you **Approve once** (that
  exact call, once, within 30 minutes) or **Don't approve**. Needs cutex 0.1.1 (`claude-safety-grants`).
  完全访问的 Claude 智能体遇到安全检查时，由你决定是否批准一次。
- Settings → Conversation: the "Up next" panel above the composer can stay expanded instead of folding
  on its own. 「接下来」面板可设为始终展开。
- A delegation result that an older cutex stored twice shows as one row.
  委托结果重复的旧记录合并成一行显示。
- Paired hosts show each person's name and avatar, refreshed when they change (cutex 0.1.1 on both
  hosts). 互联主机显示对方主人的名字和头像。
- NCI remote jobs (Gadi) are usable with cutex 0.1.1 on Linux hosts; see the ANU guide.
  NCI 远程作业可用。
- Switching an agent to "Auto" keeps the extra writable directories it already had (it used to clear
  them, so their approvals came back); the mode's hint no longer claims it asks before network access.
  切换到「自动」不再清空已放行的目录。
- A project name with Chinese (or other non-ASCII) letters gets its own id: two names that differ only
  in those letters (say "ABC" followed by two different Chinese words) no longer clash as `abc`.
  中文项目名不再因 ID 相同而冲突。
- Settings → About lists the known issues and links to the project, changelog and install guide.
  「设置 → 关于」列出已知问题。

Known issues: [docs/KNOWN-ISSUES.md](https://github.com/senxiu-official/cutex-desktop/blob/release/docs/KNOWN-ISSUES.md) (also in Settings → About). 已知问题见此文档或「设置 → 关于」。

## 0.1.1 "First Take" (2026-10-16)

The first release with downloadable, signed desktop packages. 第一个提供签名安装包的桌面端版本。

- One-click updates for installs from the release packages (Linux, Windows, macOS): the app checks
  the latest GitHub release, downloads it, verifies its minisign signature and SHA-256 inside the
  app, then switches and restarts. 发布包安装的桌面端可以在应用里一键更新。
- Updates use the computer's proxy settings, like Chrome (proxies that ask for a user name and
  password are not supported yet). 更新走系统代理设置。
- Profiles: change a profile's default model (and reasoning effort) right on the overview card.
  For Claude profiles this needs a later cutex (0.1.1+); with cutex 0.1.0 only Codex profiles
  offer it. 可以在 Profile 概览卡片上直接修改默认模型和推理强度（Claude Profile 需要 cutex 0.1.1 或更新）。
- Settings → Updates & diagnostics: links to the three repositories. 「更新与诊断」里有三个仓库的链接。
- Install guide: section B installs from the signed release binaries; the Claude Science and NCI
  modules are documented for everyone who can use them, not only ANU.
  安装指南：B 节改为从签名发布包安装；Claude Science 和 NCI 模块的说明面向所有能用的人。

0.1.0 had no desktop packages: install 0.1.1 from the release page or build from source.
桌面端 0.1.0 没有安装包：请从发布页安装 0.1.1，或从源码构建。

## 0.1.0 "First Take" (2026-10-15)

The first public release of Cutex desktop. 第一个公开版本。

It needs a cutex daemon that has Management v2. Older daemons still work: features they lack show a
"needs upgrade" notice instead of failing.
需要带 Management v2 的 cutex 守护进程；旧版仍可使用，缺少的功能会提示“需要升级”而不是报错。

- Persistent agents with live timelines. You can queue, steer, interrupt, fork and revert turns.
  Agents can delegate work to each other and ask you questions.
  常驻智能体与实时时间线：可以排队、插入、打断、分叉和回退回合；智能体之间可以委托工作，也可以向你提问。
- Projects, and several hosts over SSH with automatic pairing. You can view all hosts at once.
  Users and devices let you share a host. 项目，以及通过 SSH 自动配对的多台主机，可以同时查看所有主机；用户与设备让你共享一台主机。
- Profiles for ChatGPT, Claude and OpenAI-compatible APIs, with quota and plan where the provider
  reports them. 支持 ChatGPT、Claude 和 OpenAI 兼容 API 的 Profile，显示服务商提供的额度与套餐。
- Usage and cost across all hosts, merged by Profile. Claude Code, Codex and ZCode usage
  directories can be added. 汇总所有主机的用量与费用，按 Profile 合并；可以添加 Claude Code、Codex 和 ZCode 的用量目录。
- Modules: files, diffs, terminal, artifacts, services, in-app browser, side chat, notes, bookmarks,
  alarms, workflows. Each can be turned off. Plugins are off by default.
  模块：文件、差异、终端、成果、服务、内置浏览器、侧聊、批注、书签、闹钟、工作流，均可关闭；插件默认关闭。
- Self-updating portable installs on Windows, Linux and macOS (macOS as a front end only).
  在 Windows、Linux 和 macOS 上可自我更新的便携安装（macOS 仅作前端）。
- Chinese and English UI, plus AI translations into other languages. 中文和英文界面，另有其他语言的 AI 翻译。
