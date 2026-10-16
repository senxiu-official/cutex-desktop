# Changelog

## Unreleased

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
