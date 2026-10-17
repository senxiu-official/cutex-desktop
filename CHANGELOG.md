# Changelog

## Unreleased

## 0.1.3 (2026-10-17)

In-app browser you can actually work in, 「自动」 decided by Codex's automatic reviewer, Windows
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
- A refused address says which of four things stopped it — websites turned off (with a 「开启外部网页」
  button that also retries), the internet proxy not ready (「重试」), a LAN / tailnet / local address a
  page tried to reach on its own, or a cutex control port. 内嵌浏览器被拦时说明具体原因，只给真正能解决问题的按钮。
- Shared tab: your clicks, scrolling and reading no longer pause the agent. Its typing / clicking
  waits only while you are typing (about 1 s after your last key), and anything it saw before you
  touched the page must be looked at again first. With the window minimised the agent can still read
  the page; actions need the tab visible. An agent click that pulled focus into the page hands it back
  to where you were typing. 「暂停智能体」 is its own button (the grant stays); 「继续」 resumes the same
  agent's lease with one click. 共享标签：只有你正在打字时智能体才等待；暂停与撤销分开，继续一键恢复。
- Links and forms that open a new window (`target=_blank`, `window.open`, also POST forms such as
  "pay" or "sign in with…" buttons) open as a new tab in the same login pool after your click, with the
  full address and form data; a page opening windows on its own is blocked with a notice. A click by
  the agent opens the tab too. 新窗口改为同一登录池里的新标签（含 POST 表单）。
- Downloads you start open a save dialog (they were always cancelled before). A download by an agent
  working in a shared tab opens the same dialog, titled with the agent's name, only while the window
  is visible; a page downloading on its own is blocked with a notice. 你点的下载会弹出保存窗口；智能体的下载也要你选位置。
- A page's own site can ask for the camera, microphone, location, notifications and similar; you
  answer in a native dialog (agents and pages can't click it), and 「记住」 keeps the choice for that
  exact origin and login pool — Settings → Browser → 网站权限 forgets it. Cross-site frames,
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
  allow, 「记住」, remembered, forget). 网页权限请求不再卡住：窗口不在前台时会提示，2 分钟未回答按阻止处理（不记住）。
- In-app browser: handing a tab to an agent now says why the grant ended instead of a bare
  「控制权已撤销」, e.g. the window or card is not visible (minimized, or on Windows fully covered by
  another window) or the host refused it. Agents only have `browser_*` tools when their profile has
  「浏览器工具」 on, they were started after that, and their runtime's facade is cutex r228 or newer.
  交给智能体失败时会显示具体原因（例如窗口不可见）。

**Permissions and approvals**

- 「自动」 now uses Codex's automatic reviewer: escalations (writes outside the workspace, network
  when it is off, commands that ask to leave the sandbox) are decided by the reviewer instead of
  asking you. New agents and quick chats in 自动 start with it (cutex `launch-approvals-reviewer`; on
  an older cutex the desktop sets it right after creation). A workspace thread whose approvals still
  go to you shows as 自定义 — click 自动 to switch it. 只读 keeps asking you.
  「自动」改用 Codex 自动审批员：越界操作由审批员决定，不再询问你。
- 「自动」 means network on wherever you pick it: the new-agent page and a pending quick chat now turn
  network on like switching a running thread already did. The network toggle can still turn it off.
  「自动」在所有入口都开启联网。
- The reviewer's decisions show on the tool row it reviewed: 「自动审批员已批准 · 低风险」 or
  「自动审批员已拒绝 · 高风险 — <reason>」 (click for the full reason), a declined command reads
  「未执行（已拒绝）」 instead of a bare failure, and a review without a tool row (network access) gets
  a line of its own. 工具行显示自动审批员的决定和理由。
- The composer's permission chip tells what is in effect beyond the mode name: hover it, or open the
  menu, for who decides escalations (the reviewer / you / never asks), network on or off, and the
  extra writable directories, plus a named permission profile if one is active.
  权限按钮显示实际生效的审批方式、联网与额外可写目录。
- Approval and question cards say who is asking: 「Codex 沙箱」 (the native sandbox; in 自动 the
  reviewer answers these instead), 「cutex」 (managed services, the browser, Profiles, workflows —
  always yours to decide, whatever the mode), 「模型提问」 (the model's question tool, not a
  permission) and 「MCP 服务器」. Hover for what it means. 审批卡片标明来源。
- A Claude tool call that a Claude Code safety check stopped no longer reads 「失败」: its row says
  「已拦截（安全检查）」 with the check's reason, and a folded work group counts it as stopped.
  被安全检查拦下的工具调用不再显示为失败。
- Windows hosts: when an agent has no Windows sandbox, its permission menu says
  「Windows 沙箱未就绪：普通命令也会询问」 and explains why every command asks in 自动 / 只读; one click
  sets up the sandbox that needs no administrator rights (takes effect after the agent goes offline
  and online again). Settings → 新建默认 → Windows 沙箱 shows and sets it for new agents. The elevated
  sandbox stays a step on that host (`/setup-default-sandbox`). Needs cutex 0.1.2
  (`windows-sandbox-readiness`). Windows 沙箱就绪提示与一键设置。

**Profiles, hosts and agents**

- Copy a Profile to another host (cutex 0.1.2 `profile-transfer` on both hosts): a Profile card's
  menu gains 「复制到其他主机…」 / "Copy to another host…". One dialog: target host, new name (never
  overwrites), and the credential row of the Profile's kind — an API key is copied too unless
  unticked, a ChatGPT login is never copied (log in again on the target), a Claude Profile uses the
  target's Claude account with the same name, else its default account. The settings and the key go
  from host to host inside the desktop's main process only, never to the window or the error log.
  Profile 可复制到其他主机（设置 + 可选 API key；ChatGPT 需在目标主机重新登录）。
- Kimi Code membership plan (cutex `kimi-code-plan`): api.kimi.com / api.kimi.ai count as Kimi
  Code's own API (国内 / 海外, Kimi logo; `k3` models too), the quota picker lists the new
  `kimi_code_plan` reader and the mapping mode `used_ratio`; a quota window named `month` shows as
  本月 / This month. Kimi Code 会员套餐：额度读取，月度窗口显示为「本月」。
- SSH hosts typed as `user@host[:port]` (not only `~/.ssh/config` aliases) ask for a key passphrase,
  password / one-time code or an unknown host key (with its fingerprint) in a dialog instead of
  failing; answers go only to ssh and are never saved. SSH 主机需要口令、密码或确认新主机密钥时会弹窗询问。
- Sidebar pins: a pinned (置顶) agent is always a full row — never folded into 「N 个空闲」, the 运行中
  rows or 离线 N, and still listed under a collapsed project — with a 📌 after its name; pinned quick
  chats sort first. Agents are no longer bookmarked (pin them instead; existing agent bookmarks stay
  under 全部书签). 置顶的智能体始终整行显示并带 📌；智能体改用置顶，不再加书签。
- Sidebar: a collapsed 「N 个空闲」 no longer opens by itself, also while a host reconnects; an idle
  agent with a finished turn you have not seen stays in the fold as an avatar with a ✓ and the header
  counts it (「› 3 个空闲 · 2 完成」). The project menu's 「在线空闲不收起」 moved under 侧栏显示 ›.
  收起的「N 个空闲」不再自己展开。
- Agent menu regrouped: view actions (置顶, 标为已读) · open / copy · change the agent (重命名, 编辑信息,
  分叉, 暂停委托…) · runtime (停止 / 重启运行时) · 归档 / 更多. 智能体菜单按用途分组。

**Files, artifacts and previews**

- File and artifact previews show **PDF** (pages, zoom, page jump, selectable text) and **DOCX**
  (converted to sanitised HTML); other office formats and files over 10 MiB get a clear "can't
  preview here" card with type and size. 预览 PDF / DOCX；其他办公文档和超过 10 MiB 的文件显示说明卡片。
- Artifact view: one row of tabs — 预览 · 源代码 · 出处 · 对比 (Preview · Source code · Origin ·
  Compare). 源代码 appears for Markdown, HTML and CSV / TSV; Markdown renders with the chat renderer
  (no raw HTML or scripts). 成果视图合并为一行标签：预览 · 源代码 · 出处 · 对比。
- HTML, PDF and image artifacts published under a label name preview again (an older cutex stored
  them as `text/plain` / `application/octet-stream`); existing artifacts are fixed without a
  migration. 以名称发布的 HTML / PDF / 图片成果可以正常预览了。
- The 文件 tree updates by itself after an agent edits files, and the workspace watch re-opens after
  a host reconnect; expanded folders and the selection stay. 智能体改动文件后，文件树自动刷新。
- Terminal colours are readable in both themes (a 16-colour ANSI palette per light / dark theme,
  switching live). 终端配色在浅色、深色主题下都清楚可读。
- Static services (files cutex serves) no longer offer 停止 / 重启 / 日志, which cutex refused with
  `not_supervised`; they can be opened or deleted. 静态服务不再显示停止 / 重启。

**Settings and updates**

- Host backend updates: a finished update becomes a short "Updated to …" note you can dismiss (the
  steps stay in Update history), and the run card, the note and Update history say what new agents
  get — a new native runtime x → y only when the release brings one, else a new runtime package
  (from cutex's own record with cutex 0.1.2 `upgrade-run-native`). 后端更新完成后变为可关闭的提示，并说明新智能体得到的运行时。
- Settings cards no longer turn into empty bars after a page updates several of them at once (seen on
  主机后端更新 right after a cutex update); a card whose content fails to render shows the error and a
  重试 button. The same layout risk is gone from Profile cards, the sidebar footer, the new-agent page,
  the conversation opening and 互联 → exported projects. 设置卡片不再变成空白条；出错时显示原因和「重试」。
- Settings → About → Known issues also reads the list published on the project's `release` branch,
  fetched through the same proxy settings as updates and kept for offline use; entries hide on
  versions that fixed them. 已知问题会从 GitHub 的 release 分支获取最新列表。
- Updates & diagnostics: release (binary) installs only offer check intervals of an hour or longer,
  matching the hourly limit of background checks.
- Launcher artwork can be imported at runtime: 设置 → 外观 → 启动页立绘 「从文件夹导入…」 / 「清除」
  (PNG files with the launcher's exact names, ≤ 10 MiB each); release builds, which bundle no
  artwork, can show it now. 启动页立绘可在设置 → 外观里从文件夹导入。
- Fix: a right-click / "⋯" menu no longer closes by itself while an agent streams.
  智能体输出时右键菜单不再自己关闭。

Known issues: [docs/KNOWN-ISSUES.md](https://github.com/senxiu-official/cutex-desktop/blob/release/docs/KNOWN-ISSUES.md) (also in Settings → About). 已知问题见此文档或「设置 → 关于」。

## 0.1.2 (2026-10-16)

Optional backend components can be installed from the app. Pairs with cutex 0.1.1.
可选的后端组件（Job Service、Claude 运行时）可以在应用里安装。配合 cutex 0.1.1 使用。

- Install card for optional cutex components: the **Jobs** page offers the Job Service (Linux
  hosts), and Claude Profiles, Claude accounts and the new-agent page offer the Claude runtime. The
  card shows the install progress and, when the host still needs something from you (Python, the
  Claude Code CLI, a Claude login), the steps to do on that host. Needs cutex 0.1.1+ on a managed
  install; older hosts show "update cutex first". 可选组件的安装卡片。
- The ⚙ Settings dot in the sidebar also lights up when a host has a cutex update available, so
  you notice it without opening Settings → 主机后端更新. 主机有 cutex 更新时，侧栏「设置」上出现小圆点。
- While the model request of a running turn is retried, the turn and its sidebar row show
  「正在重连 n/5 · HTTP 524 · host」 (attempt, HTTP status, provider host). 模型请求重试时显示重连进度。
- Help & docs (identity menu) works on installs from the release packages: each package carries
  `docs/QUICKSTART.md` and opens it; an app outside its release folder opens the published copy.
  帮助与文档在发布包安装上也能打开。
- Each package also carries the `skills/cutex-docs` manual for your own coding agent
  (AGENT-INSTALL §13).
- Pairing a Windows cutex host over SSH (e.g. from a Mac) finds `cutex.exe` under
  `%LOCALAPPDATA%\cutex\bin`.
- Claude agents with full access: when Claude Code's safety check blocks a command, the agent is
  told to do it another way or stop and explain, and a 「需要你」 card lets you **批准一次** (that exact
  call, once, within 30 minutes) or **不批准**. Needs cutex 0.1.1 (`claude-safety-grants`).
  完全访问的 Claude 智能体遇到安全检查时，由你决定是否批准一次。
- Settings → 对话: the 「接下来」 panel above the composer can stay expanded instead of folding on
  its own. 「接下来」面板可设为始终展开。
- A delegation result that an older cutex stored twice shows as one row.
  委托结果重复的旧记录合并成一行显示。
- Paired hosts show each person's name and avatar, refreshed when they change (cutex 0.1.1 on both
  hosts). 互联主机显示对方主人的名字和头像。
- NCI remote jobs (Gadi) are usable with cutex 0.1.1 on Linux hosts; see the ANU guide.
  NCI 远程作业可用。
- Switching an agent to 「自动」 keeps the extra writable directories it already had (it used to clear
  them, so their approvals came back); the mode's hint no longer claims it asks before network access.
  切换到「自动」不再清空已放行的目录。
- A project name with Chinese (or other non-ASCII) letters gets its own id: 「ABC中文一」 and
  「ABC中文二」 no longer clash as `abc`. 中文项目名不再因 ID 相同而冲突。
- Settings → About lists the known issues and links to the project, changelog and install guide.
  「设置 → 关于」列出已知问题。

Known issues: [docs/KNOWN-ISSUES.md](https://github.com/senxiu-official/cutex-desktop/blob/release/docs/KNOWN-ISSUES.md) (also in Settings → About). 已知问题见此文档或「设置 → 关于」。

## 0.1.1 (2026-10-16)

The first release with downloadable, signed desktop packages. 第一个提供签名安装包的桌面端版本。

- One-click updates for installs from the release packages (Linux, Windows, macOS): the app checks
  the latest GitHub release, downloads it, verifies its minisign signature and SHA-256 inside the
  app, then switches and restarts. 发布包安装的桌面端可以在应用里一键更新。
- Updates use the computer's proxy settings, like Chrome (proxies that ask for a user name and
  password are not supported yet). 更新走系统代理设置。
- Profiles: change a profile's default model (and reasoning effort) right on the overview card.
  For Claude profiles this needs a later cutex (0.1.1+); with cutex 0.1.0 only Codex profiles
  offer it.
- Settings → 更新与诊断: links to the three repositories.
- Install guide: section B installs from the signed release binaries; the Claude Science and NCI
  modules are documented for everyone who can use them, not only ANU.

0.1.0 had no desktop packages: install 0.1.1 from the release page or build from source.

## 0.1.0 "First Take" (2026-10-15)

The first public release of Cutex desktop. 第一个公开版本。

It needs a cutex daemon that has Management v2. Older daemons still work: features they lack show a
"needs upgrade" notice instead of failing.

- Persistent agents with live timelines. You can queue, steer, interrupt, fork and revert turns.
  Agents can delegate work to each other and ask you questions.
- Projects, and several hosts over SSH with automatic pairing. You can view all hosts at once.
  Users and devices let you share a host.
- Profiles for ChatGPT, Claude and OpenAI-compatible APIs, with quota and plan where the provider
  reports them.
- Usage and cost across all hosts, merged by Profile. Claude Code, Codex and ZCode usage
  directories can be added.
- Modules: files, diffs, terminal, artifacts, services, in-app browser, side chat, notes, bookmarks,
  alarms, workflows. Each can be turned off. Plugins are off by default.
- Self-updating portable installs on Windows, Linux and macOS (macOS as a front end only).
- Chinese and English UI, plus AI translations into other languages.
