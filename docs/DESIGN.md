# cutex-desktop — Design

> **Public repository note.** This is a maintainers' design record, kept as written during
> development. It cites internal notes and working checkouts that are not published with this
> repository (`docs/research/…`, `docs/reviews/…`, `docs/handoff/…`, `TODO.md`, `PROGRESS.md`,
> `PLAN.md`, `upstream/…`, `refs/…`, `.claude/…`); those references are history, not links.
> "The owner" is the project's maintainer. The current behaviour is in the code, `README.md`,
> `docs/install/AGENT-INSTALL.md` and the cutex repository's `docs/`.

Status: draft v0.1 (2026-10-06). Decisions below were agreed with the owner in conversation.
Interface details marked _(pending verification)_ must be checked against `refs/cutex` and
`upstream/cute-codex` HEAD before implementation.

## 1. Goal

An **open-source "ChatGPT desktop / Codex app"** built on the owner's own stack:

- **cute-codex** — Codex fork whose app-server adds native features, most importantly
  **external input** (cross-session / cross-agent messages injected into a running thread),
  which normal harnesses do not support.
- **cutex** — always-on daemon: persistent agent identities, managed app-server runtimes,
  Agent Bus, projects / Director authority, delegations (asks), profiles, Management v2 API
  (the older task service was removed in cutex r219).

Not a goal: replicating every feature of commercial harnesses. v1 ships only what the owner uses.

Users: the owner, on Windows and Linux. Remote hosts are not a phase-1 goal but the architecture
must not preclude them.

## 2. Architecture

```
cutex daemon (Rust, one per machine)        ← single source of truth
  ├─ managed cute-codex app-server runtimes
  ├─ Agent Bus, delegations (asks), alarms, notifications, usage
  └─ Management v2 HTTP + SSE (127.0.0.1)
        ▲                    ▲
        │                    │
  cutex TUI / CLI      cutex-desktop (Electron)
                         main:     holds token, HTTP/SSE client, multi-daemon registry
                         preload:  narrow typed IPC bridge
                         renderer: React UI (no direct FS/PTY/network)
```

Why keep cutex as a separate daemon (instead of folding it into Electron):

- Cross-agent messages, queues, alarms, tasks must work while no window is open.
- Runtimes must survive closing the desktop; reconnect resumes via bootstrap + event cursor.
- Headless Linux hosts and the TUI keep working; no rewrite of cutex in TS.

Daemon supervision: `cutex service install` sets it up. **Linux → systemd user units**
(`cutex-agent-bus`, `cutex-management-api`); **Windows → a per-user Task Scheduler logon task**
(`\Cutex\cutex-supervisor`) running cutex's own supervisor (`cutex service run`). The separate
persistent-runtime-host project is not used or required by Cutex. The desktop detects a missing daemon
and shows diagnostics (on Windows it may start the logon task); it does not own the daemon's lifetime.

Remote (later): each machine runs its own cutex daemon; desktop connects to several daemons
(local direct, remote via SSH port-forward). Sidebar can then group by host. Requirement for v1:
nothing in the client may assume "local" — all FS/terminal/diff access goes through daemon APIs.

SSH hosts phase 1 (2026-10-07): one active daemon at a time. Pairing runs `cutex management
client-token issue` over `ssh -o BatchMode=yes` once; the client token stays in main (safeStorage).
The connection is an `ssh -N -L` forward to the remote's loopback management port, on a stable
local port so feed cursors survive reconnects. Remote mode: picked images are uploaded
(`session-attachments`), folders are browsed in-app (`fs-dir-browse`), native file / folder dialogs
for host paths are off. Phase 2 = several hosts at once, sidebar grouped by host (TODO.md).

Direct app-server mode (no cutex) is **out of scope for v1**.

## 3. Domain model

- **Agent = cutex session = one native thread.** Semantics never change.
- No `/clear` or `/new`; start over = create a new agent.
- **Fork** → creates a **new agent** (new cutex session bound to the forked thread; default name
  `"<name> (fork)"`, inherits project). Requires a cutex route _(gap)_.
- **Revert** → same agent, rolls back turns (`thread/revert`).
- Display metadata on the cutex session record (stored in the daemon, shared by all clients):
  `display_name`, `note`, `avatar` (icon / emoji / small image). Leave room for more. _(gap: note,
  avatar likely missing)_

### 3.1 Project = workspace + agent team (decided 2026-10-06)

Codex/ZCode "project" (path-keyed workspace) and the cutex "project" (agent group with Director,
members, authority) are **merged** into one concept, PyCharm-style: by default one project = one
team. The cutex wire name `project` stays and now means exactly this; no "项目组" term needed.

- **workspace_root**: the project's directory. All member agents run with cwd = workspace_root;
  scratch files go to `<root>/.agents/<agent-name>/` by convention (instructed, git-ignored), not
  per-agent cwds. Project memory is keyed by the project. _(cutex gap: field on project record;
  new agents in a project default cwd to it)_
- **Members**: cutex membership as today (one project per agent, the Director = the project's
  authority (`director_cutex_session_id`), operators).
- **Referenced agents (v1: UI only)**: external agents (other projects' members / independent
  agents) shown under the project with a "referenced" marker — e.g. derived from agent-bus
  messages exchanged with members ("this Director talked to that agent"). Not stored in cutex,
  no memory access, no authority.
- **Extra folders**: later (Codex `project_roots` supports multiple roots conceptually).
- Agents without a project stay under "Independent agents".
- **No migration** of existing agents (old `agent-home/<agent>` cwds keep working). New rules apply
  to agents created from the desktop; a one-off migration can come later if needed.
- Per-agent `CODEX_HOME` homes are incidental (profile isolation is already done per launch via
  `--auth-file` + `-c`); converging to one shared CODEX_HOME per host is a later, optional cutex
  cleanup — not required for anything in v1.

### 3.2 Memory (decided 2026-10-06) — ZCode / Claude-Code style, managed by cutex

- **Codex native memories: off** (`features.memories` stays disabled). Rationale: one global pool
  per CODEX_HOME, mined only at session start for threads idle ≥ 6 h (rare for always-on cutex
  agents), extraction runs on an arbitrary profile's model, no management API, and the current
  shared `memories/` junction across per-agent homes would corrupt it.
- **No per-profile memory.** Memory is about the user and the project, not the model; sharing it
  across providers is the point. Model-specific lessons are ordinary entries tagged `model:`.
- **Project memory** (primary): ZCode format — one fact per markdown file with frontmatter
  (`name`, `description`, `metadata.type`: user | feedback | project | reference; body with
  **Why:** / **How to apply:**, `[[links]]`), plus `MEMORY.md` one-line index. Stored by cutex
  under `~/.cutex/projects/<project-key>/memory/` (independent agents: keyed by cwd hash).
  - Write path: cutex injects a `# Memory` instruction section + current `MEMORY.md` when starting
    an agent (developer instructions); agents write files with their normal tools. No MCP in v1
    (add a write tool later for sandboxed agents).
  - Visible only to project members (not referenced agents).
  - Desktop: memory browser (project → files → preview) like ZCode, plus edit / delete / pin, and
    a "memory updated" chip in the timeline when an agent writes under the memory root.
  - Background auto-extraction after turns (ZCode trigger rules): later.
- **User-level instructions**: `$CODEX_HOME/AGENTS.md` (Codex-native user AGENTS.md), edited by
  hand in desktop Settings. No automatic global memory store in v1.

## 4. UI

Overall: left sidebar + right conversation, like every harness. Sidebar + settings ≈ cutex TUI;
conversation pane ≈ a cutex-managed session. Special pages (project/agent management, task board)
are separate views, later phases.

### 4.1 Sidebar (IM-style, not a plain session list)

```
[search]                          [+ new]
▼ ● project-a  (3 online)          project color badge + name
    ◉ Eva   [Director]  2m  •      avatar · name · role · time · unread
      note or last message preview
    ◉ Alden  ⚠ needs input
    ◉ Mika   ⟳ running
    ▸ Offline (4)                  collapsed
    ↗ Wave-Director (referenced)   UI-only: external agent that exchanged messages with members
▶ ● project-b  (1 online)
▼ Independent agents               agents with no project
    ...
```

Projects are the merged workspace+team concept (§3.1).

- Row (compact, 2 lines): small avatar (custom icon or profile color + initial) with status dot,
  display name, time; second line = **latest activity** like the TUI action panel — the latest
  tool action (`$ cmd`, `✎ file`, `⚙ server.tool`) or the beginning of the latest output message,
  updated live from host events (seeded from the resource's `activity`). No cwd/path.
- **Archived agents are not in the sidebar** (always offline, rarely needed): Settings → Archive,
  reachable from the sidebar footer ("N archived").
- Ordering v1: current Director → manual pins → name. **Stable on purpose** — sorting by status
  or recency made rows jump under the cursor (needs-input only becomes known when opened; running
  flips every turn). Status lives in the dot + second line. Make it configurable later.

### 4.2 Conversation timeline

| Author | Rendering |
|---|---|
| Human (me) | right bubble |
| This agent | full-width plain markdown, tool calls as collapsible blocks |
| **Message received from another agent** | bubble styled like a human message, header `[avatar A-name →]` |
| **Message this agent sent to another** | **left** bubble too, mirrored header `[→ B-name avatar]` (only the user's own messages are right-aligned) |
| System / external (alarm, task, IM) | compact card with source icon |

Received/sent headers are mirror images so direction is obvious at a glance. Second layer = body,
plus a small tag for delivery mode (after_turn / soon / interrupt …). Clicking a name jumps to that
agent. Working indicator ("working N s"), reasoning, diff summary follow ZCode patterns.

### 4.3 Composer

Follows ZCode / common harness pattern (see owner's screenshot):

- Default **Enter = send** (starts a turn when idle, queues after the current turn when busy —
  see §7 for why). Queue panel docked above the composer:
  drag reorder, edit, delete, **"send now" = convert to steer**.
- Steer is not revocable; queued items are.
- **Interrupt (decided 2026-10-06):** while a turn runs a red "■ 停止" button is always shown
  (next to send/steer when text is typed); **Esc** in the composer interrupts when nothing is
  selected and no palette / panel / popover is open (Codex TUI behaviour); a brief "已中断"
  line confirms. **Ctrl+Shift+Enter** = cutex `interrupt` strategy (stop the turn and send this
  instead); Ctrl+Enter = steer; Enter = queue while busy. Chosen over a send-button menu: the
  composer row is already dense and the owner drives it from the keyboard.
  There is no hover tooltip over the textarea (removed 2026-10-09, owner): the key list lives only in
  Settings → 键盘快捷键 (`lib/shortcuts.ts`).
- **Pending steer:** a message steered into the running turn (disposition `steered`) shows as a
  dashed, muted bubble "已插入，等待模型读取" (keyed by the `clientUserMessageId` we send) until
  the matching `userMessage` item arrives in that turn (text match, one item per bubble, ignoring
  identical earlier messages) or the turn ends (`lib/pendingSteers.ts`). Queued messages are not
  duplicated — the queue panel already shows them.
- **Send failures:** a send shows at once (outbox, `lib/outbox.ts`) under its `clientUserMessageId`; a failed
  one keeps its place with the error and 重试 / 放回输入框 / 丢弃 (retry reuses the id, cutex dedupes).
  cutex's `503 idempotency_capacity_exceeded` (its request store is full of unresolved requests; nothing
  was recorded or forwarded) is retried first by `CutexClient.submitInput` — 3 retries after 0.4 / 1.2 /
  2.4 s (longer if `details.retryAfterMs` says so, capped at 3 s) under the same `requestId` and
  `clientUserMessageId`. Only if it still fails does the row show 发送失败 with a readable message
  (`outbox.capacityExceeded`, zh-CN + en).
- **Images:** paste, drag & drop, or `+` → 添加图片 (native file dialog in main, local host).
  Thumbnails above the textarea with remove. Pasted / dropped → `{type:"image", url:"data:…"}`
  (downscaled to ≤ 2048 px JPEG when over 8 MB), picked files → `{type:"localImage", path}`.
  Enabled only when the model's `inputModalities` has `image` (else "当前模型不支持图片").
  main re-validates every extra input item (`shared/input.ts`) before `cutex/userInput/submit`.
  User messages render image parts as thumbnails (click = full size) / file chips for paths.
- Bottom bar (rearranged 2026-10-07, Claude layout + ZCode's merged chip). Left = actions / modes:
  `+`, permission mode, and a **计划 ×** accent chip only while Plan collaboration mode is on (× = back
  to default; nothing shown in default mode). No background-terminal chip (removed 2026-10-07): the
  bar is for how the next message is sent; background terminals / subagents are conversation state
  and live where Settings → 状态显示位置 puts them (status row / capsule), with `/ps`. Right = quota ring(s)
  (popover: gauges + the profile switch list), one **profile / model** chip (profile name truncated,
  full on hover) whose single menu has the profile section on top (current + gated switch targets,
  "after this turn" while busy) and the model list below, reasoning effort, context ring (a dim ring
  until the first token report, so nothing shifts). The new-chat draft uses the same right group
  (its own profile choice; no context ring).
- **`+` (decided 2026-10-06)** holds what goes into the next message and which tools this session
  has; persistent state stays in the bottom row, session management in the title bar ⋯, and the
  slash palette is unchanged (everything is still reachable via `/`). Two sections:
  - 输入: 添加图片 (model-gated) · 引用文件 (inserts `@`) · 引用技能 › (enabled skills; picking
    one appends `$name` and binds it exactly like a palette pick).
  - 本会话工具 (state on the right): 计划模式 switch (`collaborationMode/list` +
    `thread/settings/update {collaborationMode}`; hidden without plan mode, disabled offline) ·
    目标 (status or 未设置; opens the goal card, else puts `/goal ` in the composer) · 技能 ›
    (all skills with a switch: `skills/config/write {path, enabled}` — there is no per-thread
    toggle, it writes the shared CODEX_HOME config, so it applies to all agents on next launch /
    reload; 管理… → Settings → Skills) · MCP › (`mcpServerStatus/list`, status only: no runtime
    enable / disable in the protocol; 管理… → Settings → MCP).
  - Skills / MCP go through `POST /v2/codex/requests` (no runtime needed). Web search is not
    plumbed per session by cutex, so it is not in `+`.
- **Queue lives in cutex** (`cutex/userInput/*`), not in the desktop, so it survives closing the
  window and is shared with the TUI. _(pending verification of queue ops: edit/reorder/promote)_

#### Slash-command palette and @-mentions (decided 2026-10-06)

Typing `/` as the first character opens a panel above the composer (title 命令, rows
`/name  muted description`, footer hint; same frame as the other popovers). Further characters
filter: fuzzy on the name (prefix > word start > substring > subsequence), plus description
substrings in **both** locales (ASCII queries ≥ 3 chars at a word start, CJK any substring).
↑/↓ select, Enter runs (or inserts `/cmd ` for argument commands), Tab completes, Esc hides it
for that draft; mouse works. A typed `/cmd args` runs on submit; an unknown `/…` (a path) is
sent as text. Enabled skills (`skills/list` via `/v2/codex/requests`, with the agent's cwd) are
listed as `$name`; picking one inserts `$name ` and, if still in the text on send, adds a
`{type:"skill", name, path}` input item (cute-codex skill invocation, like the TUI).
Registry, ranking and dispatch are pure (`lib/slashCommands.ts`, `SlashContext` effects).

| Command | Does | Backed by |
|---|---|---|
| `/goal [text\|clear\|pause\|resume\|edit]` | set / control the thread goal; goal line above the composer (objective, status, tokens, time; pause / resume / edit / clear) | `thread/goal/get|set|clear`, live `thread/goal/updated|cleared` |
| `/plan [text]` | toggle Plan collaboration mode (with text: switch and send) | `collaborationMode/list`, `thread/settings/update` |
| `/review [instructions]` | inline review of uncommitted changes (or custom); `enteredReviewMode` row + `exitedReviewMode` card in the timeline | `review/start` (`delivery: inline`) |
| `/compact` `/model` `/permissions` `/usage` `/status` | existing compaction / pickers / quota popover; status panel (model, effort, permissions, mode, profile, cwd, context, goal, runtime, thread) | existing |
| `/rename [name]` `/archive` `/new` `/diff` `/ps` `/stop` | menu actions (shared helpers in `lib/menus.tsx`), new-agent page, changes pane, background list, terminate every background terminal | existing; `thread/backgroundTerminals/list` + `terminate` (cutex forwards no `clean`) |
| `/copy` `/export` | last assistant / review text to the clipboard; Markdown export via a native save dialog in main (local host only) | `lib/transcript.ts` |
| `/init` | sends the Codex TUI's AGENTS.md prompt verbatim (`lib/initPrompt.ts`) | `turn/start` via submit |
| `/memories` | per-thread memory on/off, reset (confirmed), link to Settings → Memory | `thread/memoryMode/set`; `memory/reset` **not forwarded by cutex** (gap → readable error) |
| `/experimental` | feature list + toggles | `experimentalFeature/list` **not forwarded** → falls back to the `[features]` table of the shared config.toml; toggles write `features.<name>` via `config/value/write` (next launch) |
| `/mcp` `/skills` `/hooks` `/logout` | settings pages (logout → this profile's account section) | existing |
| `/fork` `/side` | listed, dimmed, not runnable | cutex gap 3 (fork-as-new-agent); `thread/fork` (ephemeral) not forwarded |

`@` at a word start opens the same popup over the agent's working directory (cutex
`/v2/sessions/{id}/fs/search`, not app-server `fuzzyFileSearch`, which cutex does not forward and
which would bypass the daemon); picking inserts the relative path as plain text (quoted if it has
spaces), exactly what the Codex TUI does — `mention` input items are for app / plugin mentions.
Not ported (TUI-only or unwanted): quit, clear, raw, tui, theme, pets, title, statusline, keymap,
vim, voice, ide, app, worktree, import, daemon, debug-config, rollout, elevate-sandbox, delete,
feedback, test-approval.

### 4.4 Interaction requests (approvals / questions)

Server→client requests from cute-codex: command approval, file-change approval, permission
request, MCP elicitation, `requestUserInput` (agent asks a question / multiple choice).
Owner mostly runs full access, so approvals are rare, but `requestUserInput` matters regardless.
**Design: copy ZCode's interaction UI** — a card docked directly above the composer (not a
modal), one pending request at a time (queue), composer hidden but draft preserved; keyboard
↑/↓/Tab, Enter, Esc, 1/2/3. `requestUserInput` (questions with options + "other") maps onto
ZCode's `ElicitationDialog` wizard. Sidebar shows ⚠ on the agent; OS notification.
See `docs/research/zcode-ui.md`.

Permission-mode audit and proposed alignment: `docs/research/permissions-gpt-20261011.md`.
The current desktop's full / auto / read-only picker does not yet distinguish native manual review
from automatic review. Permission profile, approval policy and reviewer must remain distinct, and
queued settings acceptance must not be displayed as confirmed application. The research record
defines the GPT implementation requirements and separately records Claude SDK differences; it is
not a claim that these permission changes have shipped.

Claude busy-mode feasibility and separate approval-mode design:
`docs/research/permissions-claude-busy-20261011.md`. The SDK supports live permission controls,
but the current adapter rejects busy changes. The proposal separates Claude modes from Codex
sandbox presets, keeps the picker accessible during pending approvals, and requires asynchronous,
generation-bound confirmation without blocking approval replies or stop. Not implemented yet.

### 4.5 Settings (structure decided 2026-10-06)

Full-page view (sidebar footer ⚙ is the only entry; nothing else in the footer). Left nav in
groups like ZCode; each page states its source of truth (desktop-local vs cutex vs CODEX_HOME).
Per-agent settings (profile, cwd, permissions, model, groups, visibility) are NOT here — they live
in the agent's header `⋯` → Agent settings (TUI Agent Inspector in GUI form).

| Group | Page | Contents | Source |
|---|---|---|---|
| Basics | General | language, theme (system/light/dark), OS notification when an agent needs input / finishes, launch at login | desktop-local |
| | Shortcuts | view / customise keybindings (later) | desktop-local |
| | Connection | current connection (status, tunnel, cutex version + capabilities, reconnect); hosts list (switch / test / edit / re-pair / click-twice remove), add SSH host, connect-on-launch (last used / local) | desktop (`userData/hosts.json`, safeStorage tokens) + `/v2/capabilities` |
| Agents & models | Profiles | = ZCode "model providers" + Claude "account". Overview: one card per profile (colour, name, ★ default, kind · preset, ⚠ problems, agents in use, ⋯; model · effort + quota bars), default first; click → full-width detail page (breadcrumb 设置 › Profiles › name), sections: **Connection** (base URL, wire API `responses`/`chat`, API key write-only "set/replace", or ChatGPT/Claude login status; retries / stream idle timeout / websockets under "advanced"); **Models** (catalog from `/models` discovery with refresh; per model: context window, default ✓; add model by id; edit per-model context window); **Defaults** (model, reasoning effort, context window override, auto-compact token limit); **Quota readers**; **Behaviour** (allow mid-session switch, color). Fields map to cutex `CodexProfileConfigSnapshot` + `model_catalog_json` + `ModelCatalog` | cutex profile store |
| | New agent defaults | default profile, per-profile model + reasoning, default permission mode, direct launch | cutex global settings |
| | Instructions | user-level `$CODEX_HOME/AGENTS.md` editor; agent-message prefix/suffix templates | CODEX_HOME / cutex |
| | Runtime / CLI | installed runtime bundle, cute-codex version, default CLI args, docker sudo | cutex |
| Agent capabilities | Memory | pick a project → memory browser (view / edit / delete) | cutex memory routes |
| | MCP servers | list + status / tool count; add / edit / remove (codex config); OAuth login; reload | codex config via cutex (gap 21) |
| | Skills | list (source, enabled), enable / disable, extra skill dirs | codex `skills/*` via cutex (gap 21) |
| | Hooks | read-only list | codex `hooks/list` via cutex (gap 21) |
| | Plugins | installed (enable / uninstall), browse + search with details (skills / MCP / hooks / apps, "runs code" warning), marketplaces (add / upgrade / remove), "agents follow shared plugins" toggle | codex `plugin/*` + `marketplace/*` via cutex (gap 21, capability `codex-plugins`; docs/research/codex-plugins.md) |
| Integrations | Agent bus | enabled, port | cutex global settings |
| | Notifications | desktop OS notifications (needs input / turn done; desktop-local, done) + cutex notify service | desktop + cutex global settings |
| | (Proxy) | per-profile proxy already exists in cutex (`StoredAccount.proxy`); UI later | cutex |
| Data | Usage | token ledger (range, totals, daily stacked by profile/model/agent/project, breakdown), all quota gauges, price table | `/v2/usage*`, quota routes |
| | Archive | retired agents (restore later) | `/v2/sessions?lifecycle=retired` |
| | About | desktop / cutex / cute-codex versions, licenses (ZCode NOTICE) | — |


**Context settings (owner priority).** Per profile: context window override + auto-compact token
limit. Per model (catalog entry, "edit model" dialog like ZCode): context window, max output
tokens, input types (text / image), reasoning levels (ordered) + default, "smart config" toggle =
use cutex's known-model metadata (reset to it). Presets for the window: 128K / 200K / 256K / 400K /
500K / 1M / custom; auto-compact presets 70 / 80 / 90 % of the window / custom. The composer
context-ring popover shows the effective window and links to these settings.

Profile model configurations (owner, 2026-10-11): official Codex / ChatGPT profiles can edit
their model catalog when cutex advertises `profile-model-variants` and the selected native
runtime reports `modelVariants`. A model can have several named configurations, e.g.
`Astra [400K]` and `Astra [285K]`, sharing the Profile's credentials and endpoint. The local
selection ID is distinct from `requestModel`, the actual upstream model; cutex clones native
metadata and persists the catalog, and cute-codex sends the real model ID for inference and
compaction. Profile-wide context / compaction overrides still take precedence and are never
silently cleared. Editing the catalog applies on the next runtime start; switching between
already-loaded configurations in a chat applies their limits to the next turn without a
restart; the whole active turn retains its current settings. Smaller limits preserve history
and use native compaction. Older daemons/native
runtimes retain their existing UI and cannot launch an unsupported catalog. Usage keeps the
configuration name for display and its captured actual model for pricing; later Profile edits
must not reinterpret historical model bindings. Profile remains core; no module contract change.

Secrets (tokens, API keys) are never displayed; fields show "set / not set" with replace-only.
Not taken from ZCode/Claude: subagents (cutex agents + projects cover it), commands, browser /
computer control, account, design systems.

### 4.6 Header, workspace side pane, terminal (decided 2026-10-06)

- **Header** (ZCode `WorkspaceHeader` style): avatar · name · role · project breadcrumb; second
  line note / "working N s". Middle: git branch + `+N −M` (opens Changes tab), thread goal chip.
  Right: open in editor/explorer (local host only), terminal toggle, side-pane toggle, `⋯`
  (fork, rename/note/avatar, archive, copy id). Git lives in the header; no separate context bar
  above the composer.
- **Clickable files** (how ZCode/Claude do it): (1) agents are instructed to cite files as markdown
  links relative to the workspace root, with optional `:line` (cutex adds this to launch
  instructions — gap 17); (2) the renderer intercepts link clicks whose href resolves to a path
  (relative / absolute / `file://` / `:line` / `#L12`; port ZCode `lib/markdownFileLink.ts`) and
  opens the side-pane preview instead of a browser; tool rows (`✎ file`) open the same way.
  (3) File cards under the final reply for previewable files it mentions (md/html/pdf/images —
  ZCode `AssistantPreviewCards` + `assistantFileReferences`), validated via the file API.
- **Turn summary (轮尾摘要, built 2026-10-09, `lib/turnSummary.ts` + `components/TurnSummary.tsx`)**:
  one thin muted line after a finished turn's last reply, before its action row —
  `✎ 改了 3 个文件 +12 −4 · [chip] · [chip] · +N ▸`. Data is the turn's completed `fileChange`
  items in the timeline (merged per path, moves followed; add = content lines, delete = removed
  lines), **not** `turn/diff/updated` (not in history). Link chips come from the final reply only:
  links to files changed this turn, documents (md/html/pdf/office/images) checked to exist via
  `fs-file-read`, `localhost` / `127.0.0.1` URLs and explicit Markdown http(s) links; code refs with
  a line are not chips; `[x](path "open")` links are pinned first (future harness convention).
  Expanded: a row per file (查看变更 → side-pane turn diff built from the items; 打开) and per link
  (打开方式 ▾: 侧栏预览 · 浏览器打开 · 在文件夹中显示 (local host) · 复制路径). Hidden for
  read-only turns and turns with only failed / declined changes. Setting 对话 → 轮尾摘要:
  收起 (default) / 最新一轮展开 (≤ 5 files) / 关闭.
  `thread/revert` only rewrites history, never files.
- **Undo of a turn's file changes — planned (owner, 2026-10-09; replaces the earlier "no undo"
  decision)**: needs cutex `cutex/session/files/revert {turnId, paths?, dryRun}`; the desktop runs a
  dry run first, arms (two clicks), and the revert is all-or-nothing when any file conflicts. Only
  in the turn summary's expanded state, never on the collapsed line.
- **Reply footer** (after the turn's final message, ZCode style): the turn summary above, then an
  action row: copy, **Fork** (→ new agent from this turn, gap 3), time. No 👍/👎 (nowhere to send).
- **Side pane tabs**: Files (tree rooted at project `workspace_root` / agent cwd, lazy, watched,
  Ctrl+P fuzzy search) · Preview (markdown via our Streamdown renderer, code via shiki, images;
  read-only v1) · Changes (turn diffs + git status) · Memory (later). Data via **cutex project
  file routes** (option A: works with agents offline and on remote hosts) — gap 14.
- **Right side area (2026-10-09, supersedes the single side pane; RFC
  `docs/research/right-panel-rfc-20261009.md`, contract v1.4 `desktop-modules.md` §18).** The side
  pane became a *right side area*: a lane of page pills (≥2 pages) + a column showing one page of
  stacked cards; each card holds one component kind (tab row only with several instances). Files /
  changes / preview are the `workspace` module, turn diffs the `diff` module, subagent threads
  `subagents.thread`, every status category is also a card (`status:<id>`). Instances are bound to
  follow / an agent / a workspace / a host, so another agent's preview never leaks into this one
  (pages dim instead). Cards / pages can be maximised (Ctrl+Shift+M) or made fullscreen (Shift+F11)
  without remounting. Relation to the conversation is a setting: push / **yield** (default; the
  reading column keeps its place) / float (+ pin); narrow windows get a drawer. Toggle Ctrl+Alt+B
  (the header's side-pane toggle moved to the title bar's page actions + / ⤢ / ⛶ / ⋯). P0 on
  `feat/side-p0`; drag-and-drop, terminal-as-card and the left gutter / refs (§19) follow (P1a/b).
- **Terminal**: ZCode runs `node-pty` in its own host service (deployed to the remote host over
  SSH), not via app-server. Our host service is cutex, so the PTY lives in cutex (gap 15),
  rendered with xterm.js (port ZCode `terminal/*`). Fallback if that slips: node-pty in Electron
  main for local only.
- UI reuse from ZCode: GitPane / branch switcher / diff viewer / file tree / terminal components;
  the git and fs *backends* are reimplemented in cutex (Rust, shelling out to `git`).

### 4.8 Mid-conversation profile switch (decided 2026-10-06)

- Like ZCode's mid-task model/provider switch, but **gated per profile**: profile option
  `allowSessionSwitch` (default on for API-key providers — DeepSeek, GLM, Kimi…; off for ChatGPT
  account and Claude subscription profiles). An agent can be switched only if its current profile
  allows it, and only to profiles that allow it, of the same CLI kind (codex threads can't move to
  a Claude CLI runtime).
- UX: composer profile chip popover → "Switch profile" list (allowed targets only; disabled with a
  reason otherwise). Not while a turn is running (offer "after this turn"). The model resets to the
  target profile's default; a system card "switched to GLM" is inserted in the timeline.
- Mechanics (cutex, gap 19): `cutex/session/profile/switch {profile, expectedRevision, when:
  now|afterTurn}` = existing `cutex/session/profile/set` + runtime restart resuming the same native
  thread. Cross-provider history caveat (provider-specific reasoning items) is why the gate exists.

### 4.9 Usage ledger (decided 2026-10-06)

- cutex keeps a **token ledger** (daemon-side, so it's complete even when the desktop is closed):
  one row per completed turn from native `thread/tokenUsage/updated` `last` (input, cached input,
  cache-write, output, reasoning) tagged with date, profile, provider, model, agent, project
  (gap 20). Plus periodic quota snapshots (credits / balance / window %) for trend lines.
- Optional user price table (per model: input / cached / output per 1M tokens, currency) →
  estimated cost; never presented as a bill.
- Settings → Data → **Usage** (ZCode `AppUsagePanel` style): range 7d / 30d / 90d; totals (tokens,
  est. cost, turns); daily stacked bars by profile (toggle: by model / by agent / by project);
  activity heatmap; table by agent/project; current quota gauges for all profiles with refresh.

### 4.11 MCP layering (decided 2026-10-06)

An agent's MCP servers come from three layers, merged at launch; later layers win per server name:

1. **Global** — `[mcp_servers.*]` in the shared CODEX_HOME `config.toml` (Settings → MCP; also
   what the TUI / plain codex see).
2. **Project** — servers attached to a project (e.g. a DB / issue-tracker MCP for one repo):
   stored in the cutex project record, injected by cutex at launch for members as
   `-c mcp_servers.<name>=…`, exactly how cutex already injects `cutex` / `cutex_job`.
   Edited in project settings.
3. **Agent** — per-agent additions, and per-agent **disable** of inherited servers
   (`-c mcp_servers.<name>.enabled=false`). Edited in the agent's header `⋯` → Agent settings → MCP.

Plus **cutex built-in** (`cutex`: bus / management tools, auto-approved; `cutex_job`: job tools)
— always injected by cutex, shown read-only with their tool list. Not writing project-layer
`.codex/config.toml` into repos: it needs codex project trust and leaks into non-cutex use.
Secrets in scoped servers follow the same rules (env var names, write-only values). Changes apply
on next launch; agent settings offer "restart to apply".
### 4.12 Context menus and edit & resend (decided 2026-10-06)

- **One action list per surface.** The right-click menu and the hover "⋯" button show the same
  actions (`lib/menus.tsx`). Renderer menus are custom (`lib/contextMenu.ts` + `Overlays.tsx`, with
  keyboard navigation); text inputs and selected text get Electron's native menu (Cut / Copy /
  Paste / spellcheck suggestions), because the renderer leaves those events alone.
- **Agent row / header:** Pin (local, per device) · Rename · Edit note
  (`cutex/session/metadata/update`) · Open files pane · Copy cwd / ID · Stop runtime
  (`cutex/runtime/offline`, confirmed, danger when a turn is active) · Archive / Restore
  (`cutex/session/retire|restore`, confirmed). Revision and runtime-generation fencing comes from
  the sidebar snapshot.
- **Project header:** Collapse · Copy root / ID · Project settings. Membership, Director and
  workspace root are changed only in project settings, never from a menu.
- **Messages:** Copy · Quote in composer. User messages add **Edit & resend**; agent messages add
  Fork (gap 3, disabled). **Tool rows:** Copy command / output · open changed files.
  **File links / tree / changes:** Preview · Show changes · Copy relative / absolute path ·
  Insert into composer. **Side-pane tabs:** Close file · Close pane. External links: Open in
  browser (main process, http(s) only) · Copy link.
- **Edit & resend = revert without restart.** cute-codex `thread/revert` on a *loaded* thread
  interrupts any active turn, rewrites the store and reloads the thread in place, keeping
  subscriptions (`thread_revert_interrupts_active_turn_and_keeps_thread_loaded`; already in r46).
  The old TUI revert needed a restart only because cutex used an isolated stdio endpoint that
  refuses while a live writer exists. New cutex method `cutex/session/history/revert
  {beforeTurnId, expectedRevision}` backs up the rollout and sends `thread/revert` over the live
  runtime's connection, with the isolated path as the offline fallback. Raw `thread/revert` is not
  exposed. The desktop enables the item when `/v2/capabilities` lists `session-history-revert`,
  re-bootstraps the timeline, and puts the message text back into the composer. File changes are
  not undone by a history revert; file undo is the separate, planned turn-summary revert (§4.6).

### 4.13 App top bar (decided 2026-10-06)

One row, like ZCode / Claude / ChatGPT. The native title bar and the old conversation header are
merged into `TitleBar.tsx`:

- Left (as wide as the sidebar when it is open): sidebar toggle (Ctrl+B, remembered per device) and
  the host switcher: connection dot, active host (local: daemon host id; SSH: its label + status
  while not online), and a menu with every host (local first), "Add SSH host…" and Connection
  settings. Phase 1 (2026-10-07): one active host; choosing another reconnects the whole app.
- Middle: the current agent's avatar and name, which opens the agent menu (§4.12; rename lives
  there), plus the note or cwd and the git chip (opens Changes). In Settings it shows the title.
- Right: side-pane toggle, then the window controls. Windows uses `titleBarOverlay`, so the native
  caption buttons stay, recoloured to `--surface`/`--fg` whenever the theme changes. macOS uses
  `hiddenInset` traffic lights. Linux runs frameless with drawn min/max/close buttons and
  double-click to maximize.
- The whole bar is a drag region; controls opt out with `[app-region:no-drag]`.

### 4.14 Folding tool steps and background tasks (decided 2026-10-06)

**Folding.** Each timeline item is either foldable or not.
- Foldable: commands, file edits, MCP / dynamic tools, web search, sub-agent operations, image view,
  and reasoning (2026-10-07). A reasoning row shows the **full reasoning** when the model streams it
  (raw text: Kimi / DeepSeek style), else its **summaries** (GPT, when the profile's 推理摘要 is on:
  GPT models default to none; GLM sends its full reasoning as summary parts), else no row at all (the
  live line says 推理中). Rows read 推理 · duration for both (owner 2026-10-07: no 推理摘要 label) (only when seen live; history has no times) and open to a dim, height-capped
  box that follows the stream. Settings → 通用 → 推理过程: 展开 (default) / 折叠 / 隐藏. Reasoning is
  folded with the tools but named in the summary line only when nothing else is ("推理 2 段").
  Claude agents should map their thinking the same way (TODO).
- Not foldable: agent text (commentary or final answer), user messages, agent-bus messages received
  or sent, and approvals / questions.
- A run of foldable items stays **open** until a non-foldable item follows it. An open run shows
  the newest 3 steps plus an expandable "N earlier steps" line. This also covers the tail of a
  finished or interrupted turn.
- When a non-foldable item follows, the run folds to **one summary line**, e.g. "✓ 4 commands ·
  edited 2 files · 1 tool call · 41s". With failures it shows a red ✗ and "N failed", and the failed
  steps stay visible under the line.
- A run of a single item is never folded.
- Expanding or collapsing by hand overrides the automatic state.
- A running command shows its last 3 output lines inline.
- Code: `lib/workGroups.ts` (pure, tested) and `components/WorkGroup.tsx`.

**Turn status lives at the bottom (2026-10-07).** New output appears at the end of the stream, so the
live status does too (as in Claude / ZCode): while a turn runs, its header is only the divider and
start time, and the last line of the stream is `••• 42s · 推理中`. It shows elapsed time and what
the turn is doing now (`lib/turnActivity.ts`): 等待你确认 / 等待你回答 when an approval or question is
pending; otherwise the newest live step of the trailing run — a running tool (运行命令 / 修改文件 /
调用工具 / 搜索网页 / 调度子代理, background-terminal commands excluded) or reasoning in progress
(推理中, even with no text) —; 回复中 / 撰写计划 while text streams; else 工作中 (nothing tells
more). With reasoning rows folded or hidden it adds a one-line preview of the live reasoning (full
reasoning's current paragraph, else the latest summary title). When the turn ends, the header fills
in "已工作 1m 30s" on the same row, and the reply action bar takes the live line's space: no shift
when the reply is the turn's last item (measured); a few px of margin difference when something
follows it (e.g. an agent-bus send after the answer).

**Background tasks.** Shown in the status capsule (§4.20) by default; with Settings → 通用 → 状态显示位置
= 输入框上方, "N running tasks" sits above the composer (Claude's pattern) and expands into a list:
- Background terminals come from cute-codex `thread/backgroundTerminals/list`. Each row shows the
  command, cwd, pid, CPU and RSS, plus Output (once the terminal pane exists) and Terminate
  (click-twice: the row turns red first). Terminate needs `thread/backgroundTerminals/terminate`
  on the cutex allowlist, which is a gap.
- Active sub-agents come from collabAgentToolCall states: the label is the spawn prompt, plus
  status and latest message.
- The list refreshes on timeline changes, and polls every 10 s only while something is running.

### 4.15 Turn times and compact agent messages (decided 2026-10-06)

- **Turn time.** Every "worked N" header shows a time on the right. It is relative under an hour
  ("刚刚", "12 分钟前") and a clock time after that ("11:02", "昨天 18:40", "10-03 18:40"), refreshed
  every 30 s. Hovering shows the full start → end timestamps. Code: `lib/time.ts` (tested).
- **Agent-bus messages, compact mode (default).** One collapsible line:
  `↙ 来自 [avatar] Mika · 本轮后  <one-line preview>  ›` for received messages, and
  `↗ 发给 [avatar] Mika` for sent ones.
  - Direction is shown by both the word and the arrow. Incoming arrows use the accent colour,
    outgoing arrows are grey.
  - The avatar is always the other agent's.
  - Clicking the line expands the full bubble.
- Settings → General → "agent 间消息" switches between compact and full.
- These messages are non-foldable items (§4.14), so they still close the tool run before them.

### 4.16 Codex subagents (decided 2026-10-06)

UI wording: always "subagent", never localized (no 子 agent).

cute-codex multi-agent v2 subagents are temporary helpers inside one agent. They are separate
native threads in the same app-server, and cute-codex rejects direct user input to them. They are
not cutex agents, so they never appear in the sidebar.

- **Timeline.** `collabAgentToolCall` renders like an agent-bus row (§4.15), with a robot icon in
  place of the avatar.
  - Verb + 🤖 name + task preview, e.g. 派出 (spawn), 发给 (send), 追加任务给 (follow-up), 等待
    (wait), 打断 (interrupt), 关闭 (close).
  - A finished agent adds `↙ 🤖 name 完成 <result preview>`, which expands to the full result.
  - These rows are the parent's own actions, so they are foldable items (§4.14) and count as
    "N subagent actions" in the summary.
  - Names come from `subAgentActivity.agentPath`; state comes from `agentsStates`
    (`lib/subagents.ts`).
- **Detail.** Clicking a 🤖 name opens a closable "🤖 name" tab in the side pane (since v1.4 a
  `subagents.thread` card bound to the parent agent, page group `workspace`). It is a read-only
  view of that thread's own timeline (same `TimelineBody`, with folding and turn times), showing the
  name, status and a note that subagents only take instructions from their parent. It has no
  composer. Running subagents in the background-tasks panel open the same tab.
- **cutex.** `thread/read` / `turns/list` / `items/list` are allowed on threads that descend from the
  session's bound thread (lineage checked server-side), and child notifications are forwarded. This
  is in progress on `feat/desktop-subagents` and exposed as capability `subagent-threads`. Until it
  lands, the tab shows the cutex error.

### 4.17 Arrow semantics (decided 2026-10-06)

Disclosure arrows always show **state**, never the action. Collapsed is always ▸. Expanded points
to where the revealed content is: ▾ when it opens below (work groups, messages, subagent rows,
sidebar groups), ▴ when it opens above (the running-tasks panel above the composer). Dropdown
carets (⌄ on the host switcher or agent title menu) are not disclosures and keep the menu
convention. Expanded popovers also close on Esc, on an outside click, or on a click on their label.

### 4.18 Projects and tasks pages (decided 2026-10-06)

Projects and delegations are business objects, not preferences. They are main views reached from
the top of the sidebar (Claude / ZCode pattern): **＋ New agent** (flow pending) · **Projects** ·
**Delegations** (委托; the Tasks entry before cutex asks).
Hovering a project header shows ⚙, which opens that project.

- **Projects page.** A project list on the left; the selected project's detail on the right:
  - *Basics:* name, badge (≤4 characters), palette colour and project directory
    (`set_workspace_root`).
  - *Members:* the Director is marked, members can be added or removed (`add_member` /
    `detach_member`). Changing the Director stays disabled until the owner-initiated rotation lands.
  - *MCP (project layer):* read-only for now.
  - *Project memory:* moved here from Settings.
  - *Delegations summary:* links to the Delegations page.
  - *Archive.*
  - Membership and Director changes happen only here (§4.12).
- **Delegations page (委托).** Delegations (cutex asks) across projects, grouped as needs you →
  waiting / blocked → in progress, with finished folded below and loaded on first open (50 at a
  time), searchable and filterable by agent.
  - Each row shows the status (glyph + word), a coloured `#N` tag (numbered by first appearance in
    this app run, colour derived from the id), the title with the latest activity / progress,
    requester → target avatars (click to open the agent), the time and a ⋯ menu.
  - Data comes from `GET /v2/asks` (feature `agent-asks`); a host without it shows a short note.
    The older task list (`GET /v2/projects/{id}/tasks`) and task detail page went with the task
    service in cutex r219; old transcripts still render its deliveries and tool rows.

### 4.10 i18n / theming

i18n framework from day one, `zh-CN` + `en`. Dark/light via CSS variables (follow ZCode tokens).
- **Create / archive / memory (2026-10-06).** "+ New project" at the top of the project list:
  name, badge, colour, Director (required); the client picks the slug id and sends epochs 0.
  Archive lives in a red danger zone; a project with members needs the exact name typed, an empty
  one only a confirm. Memory shows the MEMORY.md index and each file (name · type · description ·
  size) expanding to its rendered content. Member rows use the sidebar status (running / needs
  input / idle / offline).
- **Tabs (decided 2026-10-06).** Look/act and configure are separate: **Overview** (needs you —
  agents waiting for input + delegations that need the owner; in-progress delegations; team with
  the sidebar row component; memory and MCP cards), **Delegations** (委托: the global delegation
  list locked to the project — one `DelegationList` component for both), **Memory** (index +
  files), **Settings** (basics, directory, members / Director, project MCP, danger zone last). The
  sidebar ⚙ opens Settings.
- **Optional Director (2026-10-09, cutex `project-optional-director`).** A project can exist
  without a Director. "+ New project" takes name, badge, colour, an optional directory and a
  Director choice: none, an existing agent outside every project (it joins), or "a new agent as
  Director…" (opens New agent with the project preset and "Director of the project" ticked). One
  `create_project` mutation carries presentation, `workspace_root` and the optional Director.
  Settings → Members gets **Set Director** (members first, then independent agents, which join)
  while the project has none, and **Clear Director** (confirm; the agent stays a member; cutex
  refuses during a Director rotation or while Agent Operator grants exist, naming the fix). New
  agent offers **New project…** in its project list (create_project with the agent's working
  directory, then the agent joins; optionally made Director via `assign_director`). Partial
  failures keep what was created: a retry skips the steps already done, and a failed
  assign_director says the agent exists and offers retry / open. Older cutex: the Director list
  holds only agents outside every project (cutex `director_already_has_active_project`), the
  directory is a second `set_workspace_root` (epoch 1 / revision 1; on failure the project page
  link is offered), and the Director stays required. Code: `lib/projectCreate.ts`.

### 4.19 Built-in terminal (decided 2026-10-06)

- The desktop replaces the cute-codex TUI; a built-in terminal stays as the escape hatch (cutex
  CLI, `codex login --device-auth`, anything the GUI doesn't cover yet).
- It is a bottom panel in the conversation (Ctrl+` or the title-bar button), one tab per
  terminal, rooted at the agent's workspace. PTYs are cutex `terminal` (ConPTY on Windows)
  and live in the daemon: hiding the panel or closing the window only detaches; reopening
  replays the scrollback. Killing is explicit (tab ×). Height is draggable and remembered.
- Remote-safe by construction: all I/O goes through `/v2/terminals`, never a local PTY.

### 4.20 Status capsule (decided 2026-10-07, revised same day)

After ZCode's `ConversationStatusPanel`, restyled. Items 目标 / 进程 / 终端 / subagents / 委托 / 作业 are each placed
in 输入栏 (the status row above the composer) / 胶囊 / 两者 / 不显示 (Settings → 状态胶囊, or the panel's …
menu for capsule membership); the capsule shows the ones placed in it that are present, and nothing
at all when empty. It floats over the timeline (absolute; the timeline keeps its scroll; a
column-anchored capsule gets a fixed content inset). Since 2026-10-09 each category is a
`conversation.status` item of its own module (§4.22, `docs/desktop-modules.md` §9 step 2); the capsule
and the status row only iterate the slot, and a module turned off drops its category everywhere.

- **Position**: a corner (左上 / 右上 / 左下 / 右下, default 右上) against the window edge (default; on a
  wide window that is the empty margin, so it stays off the text) or the text column's edge; size
  小 / 中 / 大. Collapsed and open share the corner and the open panel grows away from it, so toggling
  never moves it. No toggle animation (an animated swap flickered). Changeable from the panel's …
  menu as well as Settings.
- **Collapsed**: one line per category in one capsule (a single line is a pill): 目标 = target mark
  (colour = status, shared with the status row: running accent with a breathing ring, done green,
  paused amber, limited / blocked red) + objective + budget ring when a budget is set; 进程 = current
  step (spinner while in progress) + done/total; 终端 = first command +N; subagents = first one's name
  + what it is doing +N; 委托 / 作业 = the first one + its state and time +N. No times for terminals /
  subagents (no reliable start time). A line opens
  the panel at its section.
- **Open**: w-80, max-h min(64dvh, 32rem), scrolls inside. No panel title: the first section header
  is the top line with … and collapse in the corner. 目标 header = time · budget ring · ⏸/▶ (✓ when
  done), a non-running state's word after the button so it never moves; body = objective. Editing
  and clearing live in the status row. 进程 = the model's `update_plan` list (latest snapshot,
  model's order, focus window with 已完成 / 待处理 disclosures). Each header folds its section
  (chevron on hover, remembered); a folded header shows that section's collapsed line, quietly.
- **Geometry**: collapsed lines and open headers share their inset (13px from the edge, first line
  centred 17px from the top), so the collapsed goal mark and the open 目标 title sit on one line;
  every header item shares one centre line.
- **委托 / 作业 sections** (2026-10-08): unfinished rows first; `✓ 已结束 · N ›` expands inline to the
  most recent finished ones (≤ 10, newest first, same rows, time = when it ended) and ends with
  「在委托页 / 作业页查看全部 ›」 (the page filtered to this agent). 作业 = cutex Job Service jobs
  (`cutex_job.submit`, Linux hosts only; feature `job-service`): row = command (or action id) ·
  state glyph + word (启动中 / 运行中 / 成功 / 退出码 N / 失败 / 已取消 / 已中断 / 结果不明; states pass
  through `lib/jobs.ts` JOB_STATES, an unknown one shows its raw name) · elapsed / duration; row click
  = read-only output viewer, sibling 取消 (armed two-click) — both only when the Job Service offers
  them (`GET /v2/job-service/capabilities` `humanOperations`). The category shows while a job runs or
  one ended < 30 min ago. No job events: polled (10 s while one runs, else 30 s, not while hidden).
  The 作业 page (nav, hidden without `job-service`) mirrors the 委托 page: project groups, agent
  filter, 进行中 / 排队 / 已结束, search, ⋯ menu.
- **Keys**: Ctrl+. toggles; Esc (focus in the panel) collapses.
- A plan update briefly highlights the collapsed capsule's border and never opens it; in the timeline
  each turn's checklist is one line, "更新了进程 2/4", expanding to the list. Native history has no plan
  snapshot (PROGRESS.md 2026-10-07): after a desktop restart 进程 stays empty until the next update.
- **Status-row popovers** open from their trigger and are only as wide as needed (goal card from the
  left, 28rem; 进程 / background from the right), so their actions stay near the click.

### 4.21 Delegation card, status table and overview (documented 2026-10-10, as built)

A delegation (委托) is a cutex ask: an agent or the owner hands a brief to a target agent; cutex
queues it, runs it as an attempt in the target's thread and returns an answer. All state lives in
cutex (`agent-asks`; `delegation-views` adds the attempt: turn id, model, activity line, progress
notes, last error, the `involving=` filter). The desktop shows it and sends the owner's commands.
Code: `lib/delegations.ts` (pure: status, buckets, order, events, transcript fallback),
`lib/delegationStore.ts` (records), `components/DelegationCard.tsx`, `components/DelegationList.tsx`,
`modules/delegations` (card, capsule category, nav entry, page). On a host without `agent-asks` the
nav entry is greyed and the page / project tab say the host has no delegations.

**Where it shows**

- **Card** in the requester's timeline: the `agent_delegate` call once it has a delegation id (before
  that an ordinary tool row), never folded into a work group.
- **Capsule / status row** category 委托 (§4.20): groups 我发出的 / 发给我的 of this agent's unfinished
  delegations, `已结束 · N` fold, link to the page filtered to the agent. A row is `#N  title  other
  party  glyph word · time` (run time while running, else the wait; finished: when it ended); a
  requester-side row goes to the card, a handler-side one to the handling turn (`delegation-views`,
  else the ASK row); 停止 (armed) on hover. Collapsed line: `委托 · Helper 运行中 12s` (first of 我发出的;
  handler side only: `承接 · Lead 的委托 #3`); header meta `最久 12m · 2 运行中`.
- **委托 page**, a project's 委托 tab and the project Overview: `DelegationList`.
- **Sidebar** 委托 entry with ⚠ N = the 需要你 count. **Queue panel** 待处理委托: delegations to this
  agent that have not started (`pendingReview` / `queued` / `admitted`), by queue position.
- Handler side: the received ASK row, a 已回复 badge on the reply and a hint in the composer while the
  running turn is a delegation turn. No card there.

**Data.** `GET /v2/asks?state=open` on connect and after every `cutex/ask/*` host event (300 ms
debounce). Events are applied at once (revision-guarded, idempotent: each arrives once per party) and
the refresh corrects them; a delegation that leaves the open list is re-read. Selecting an agent loads
its delegations once (`involving=`, else requester + target queries); 已结束 loads on first open
(`state=closed&limit=200`); the full record (`GET /v2/asks/{id}`: brief artifact, questions) and the
answer (8 KiB pages) load when a card opens. cutex purges closed records after 30 days: a card without
a record is rebuilt from the transcript (the delegate call's result, later `delegation_wait` results,
`delegation_close` calls); its times are unknown, and when the transcript says nothing the status word
is left out.

**Card.** One line, a button that opens the body:
`⇄ 委托 [avatar] Target · model  #N  title ………… [主人插话过] glyph word · time ▸`

- `#N` = `taskTag`: numbered by first appearance in this app run, colour derived from the id.
- While it runs the title gives way to the target's live activity line (when there is one) +
  `· N 个工具`. Time after the word is the attempt's run time, shown for 运行中 / 有提问 / 已完成 /
  已验收. The word is underlined (dotted) when the attempt has a last error, shown on hover.
- While held (a `hold` on a queued / admitted delegation) the word on the right is just 排队中, or 受阻
  for a red one, and a second line gives the table's word + `等了 N`. 有提问 has no second line.
- 主人插话过: the owner steered text into the delegation's turn.
- Body: 委托内容 (brief; 查看完整 when cutex stored it as an artifact) · 进度 (cutex's last 5 notes +
  live ones, HH:MM) · 提问 (each question: 已回答 / 已转给主人 / {name} 回答中) · 结果 (preview, size,
  用时, 查看完整 = the answer page by page) · actions.
- Actions (`delegationActions`; owner commands `cutex/ask/stop | retry | close` on the target's
  session, a refusal is a notice): 打开 {target} always (the handling turn with `delegation-views`,
  else the agent); 停止 while `pendingReview` / `queued` / `admitted` / `running` and no stop is
  pending (放弃中 / 停止中: cutex already queued one); 重试 while
  `interrupted`; 验收通过 while answered and awaiting acceptance; 放弃 while `interrupted` or awaiting
  acceptance. None applies once it is closed or failed / rejected / cancelled. 停止 and 放弃 are armed
  two-click (the body turns red: 再点一次确认). ⋯ and right-click open the one menu used on cards, rows
  and the capsule (`delegationMenu`): open requester / assignee, go to the card / the handling turn,
  the commands (with confirm), copy id, copy error.

**Status table.** Glyph + word, never colour alone: ○ waiting on someone, ● running (pulses), ✓ done,
✕ ended without a result, ◌ (dashed) stopped but can be resumed. `delegationStatus` takes the first
rule that matches: closed `accepted` → 已验收; a stop cutex accepted but the target has not carried out (`stopPending`: still
open, admitted / running, review `abandoned` or the attempt's `stopRequested`) → 放弃中 / 停止中;
closed `abandoned` (or review `abandoned`) → 已放弃; closed `cancelled` (execution not failed /
rejected) → 已取消; closed `stopped` (execution not interrupted) → 已停止; any other closed record
with a stale pendingReview / queued / admitted / running execution → neutral 已结束 / Ended;
then by `execution`. A `cutex/ask/closed` event can arrive before the execution refresh: closed is
authoritative for lifecycle, while the attempt remains historical detail. `completed` does not
imply success: known failed / rejected / cancelled executions keep their words. A closed answered
record cannot still await acceptance. A card's queue-hold line never overrides closure or a pending stop. The
second input is the target's runtime from the sidebar (`DelegationContext.targetOffline`, archived
agents included; unknown = online): cutex can keep an attempt `running` while its target is offline,
until reconciliation or the daemon's offline-stop settlement. The desktop does not close asks by age.
The header's N 运行中, the accent chip and the run time count exactly the rows whose word is 运行中 /
有提问 (`isDelegationRunning`). Bucket = the overview group below; `{name}` is the target's display
name; 主人 / owner is the display term (Settings → 通用 → 称呼).

| Word (zh / en) | Mark | When | Bucket |
|---|---|---|---|
| 等待你审批 / Waiting for your approval | ○ amber | `pendingReview` | 需要你 |
| 排队中 / Queued | ○ muted | `queued`, no hold, position 1 or unknown | 等待 / 受阻 |
| 排队第 N 位 / Queued · #N in line | ○ muted | `queued`, position N > 1 (its own, or the `targetBusy` hold's) | 等待 / 受阻 |
| 等 {name} 结束当前回合 / Waiting for {name} to finish its turn | ○ muted | hold `targetBusy`, position 1 | 等待 / 受阻 |
| {name} 已暂停 / {name} is paused | ○ muted | hold `paused` by the owner | 等待 / 受阻 |
| Plan 模式中 / In Plan mode | ○ muted | hold `paused` by plan mode | 等待 / 受阻 |
| {name} 离线 / {name} is offline | ○ muted, red word | hold `blocked` by `runtimeDown` | 等待 / 受阻 |
| 受阻 / Blocked | ○ muted, red word | any other hold: `blocked`, `heldByRuntime`, `runtimeUnsupported`, `profileSwitchPending`, `waitingForApproval` | 等待 / 受阻 |
| 即将开始 / Starting | ● accent | `admitted`, no hold | 进行中 |
| 运行中 / Running | ● accent | `running` | 进行中 |
| {name} 离线 / {name} is offline | ○ muted, red word | `running` (no question) and the target is offline; 停止 stays (cutex closes it as stopped once the target is back) | 等待 / 受阻 |
| 放弃中 / Abandoning (· {name} 离线 / · {name} is offline) | ○ muted (red word when offline) | still open, `admitted` / `running`, review `abandoned`: the requester abandoned it, cutex waits for the turn's end to close it; no 停止 | 等待 / 受阻 |
| 停止中 / Stopping (· {name} 离线 / · {name} is offline) | ○ muted (red word when offline) | still open, `admitted` / `running`, attempt `stopRequested` (full record only until cutex lists it); no 停止 | 等待 / 受阻 |
| 有提问 / Has a question | ● amber | hold `waitingForInput` (queued, admitted or running) | 等待 / 受阻 |
| 已完成 / Done | ✓ green | `answered`, no review | 已结束 |
| 待验收 / Awaiting acceptance | ○ amber | `answered`, review `awaitingAcceptance` | 需要你 if the requester is the owner, else 等待 / 受阻 (the agent accepts) |
| 已验收 / Accepted | ✓ green | `answered`, review `accepted` | 已结束 |
| 已要求修改 / Changes requested | ◌ muted | `answered`, review `changesRequested` | 已结束 |
| 已停止 / Stopped | ◌ grey | `interrupted` (reason `stopped` or none), or closed `stopped` | 等待 / 受阻 (重试 / 放弃); 已结束 once closed |
| 被主人停止 / Stopped by the owner | ◌ grey | `interrupted`, reason `ownerStopped` | 等待 / 受阻 |
| 运行时重启 / Runtime restarted | ◌ grey | `interrupted`, reason `runtimeRestart` | 等待 / 受阻 |
| 结果不明 / Outcome unknown | ○ amber | `interrupted`, reason `outcomeUnknown` (the target may or may not have done it) | 需要你 |
| 失败 / Failed | ✕ red | `failed` | 已结束 |
| 审批未通过 / Not approved | ✕ red | `rejected` | 已结束 |
| 已取消 / Cancelled | ✕ muted | `cancelled`, or closed `cancelled` | 已结束 |
| 已放弃 / Abandoned | ✕ muted | closed `abandoned`, or review `abandoned` once closed | 已结束 |

**Buckets** (`delegationBucket`), in page order: 需要你 = the owner must act: `pendingReview`,
outcome unknown, a result awaiting the owner's acceptance, or any open question routed to the owner
(`ownerQuestions` > 0, whatever the word says); 等待 / 受阻 = any hold, queued, interrupted (can be
retried), a result awaiting an agent's acceptance, a pending stop / abandon, or running on an offline
target; 进行中 = admitted / running without a hold;
已结束 = closed, failed / rejected / cancelled, and `answered` with nothing left to accept.

**Overview (`DelegationList`).** Rows grouped by bucket (empty groups hidden); 已结束 is a fold that
shows 50, then 再显示 N 条. Order: 需要你 / 等待 = longest wait first (by creation; `holdSince` resets
on every queue move, so it is not used); 进行中 = latest attempt start first; 已结束 = latest end first.

| Column | Shows |
|---|---|
| 状态 | glyph + word (last error on hover) |
| 委托 | `#N`, the title (click: the card in the requester's timeline; for an owner-made one the target agent), and, not compact, the latest activity line / progress note |
| 委托方 → 承接方 | requester avatar (click: open), or 主人 for the owner → target avatar + name |
| 时间 | 需要你 / 等待: time since creation. 进行中: the attempt's run time (since creation without `delegation-views`). 已结束: when it ended, relative, absolute on hover |
| ⋯ | the delegation menu (on hover; the row's right-click is the same) |

The toolbar has a search (`#N`, title, target and requester name) and an agent filter (target or
requester); `params.agent` presets it. A project locks the list to its delegations. Compact mode (the
project Overview: `only` buckets, optional `limit`) drops the toolbar, header, 已结束 and ⋯, and shows
only the target in 委托方 → 承接方; empty it says 没有需要处理的委托, and without `agent-asks` it shows
nothing (the full list says the host has no delegations).

### 4.22 模块与插槽（decided 2026-10-09）

The desktop is organised as **slots + modules**. Every feature is a module that contributes items to
named slots: nav entries, main pages, status-capsule categories, settings pages and sections,
timeline renderers, and so on. The shell renders from a registry and has no per-feature branches or
`features.has(...)` checks. The contract (types, slot inventory, gating, lifecycle, prefs, migration
order) is [`docs/desktop-modules.md`](desktop-modules.md).

- **Built-in modules are trusted.** They live in this repo and are bundled in the main renderer.
  The v1.1 contract is exported by `@cutex-desktop/plugin-sdk`; `plugin-host` implements one neutral
  lifecycle engine, while `modules/app.ts` supplies the app adapter and scoped UI services.
- **External plugins run isolated.** The default-off `plugins` module maps validated local
  manifests to dynamic modules. Code runs only in opaque `sandbox="allow-scripts"` frames, with
  per-document CSP and a private MessagePort. The parent keeps its existing script CSP. Main IPC
  admits only the exact app top frame; document URLs are one-use, owner-bound and navigation-guarded.
  Explicit fingerprint-bound permissions expose only reviewed operations, never a daemon token
  or generic API. Revocation, host changes and disposal invalidate frame authority synchronously.
  There is no installer; examples are outside product bundles. MCP Apps are not connected yet.
- **In-app browser (`browser` module, 2026-10-11; default on since 2026-10-15).** Lead decision for
  fresh installs (friends / colleagues): N2 egress was approved on 2026-10-14, agent-opened tabs
  use the separate agent partition, and owner tabs reach an agent only through an explicit grant.
  Agent browser tools still need the per-Profile opt-in (default off); while the module is off that
  Profile row says so and links to Settings → 模块. Installs that had already saved module choices
  keep the browser off (`modules/defaultFlips.ts`, once). Guests are hardened `<webview>`s
  in one of two session partitions, both **host-level pools** (not per agent):
  `persist:browser-<hostId>` for tabs the owner opens, `persist:browser-agent-<hostId>` for tabs an
  agent opens. A tab the owner grants to an agent stays in the owner partition and keeps the owner's
  logins; the grant UI says so. Plugin contexts keep zero egress and the app-level DNS block.
  **N2 exception:** a browser-only egress proxy may listen on 127.0.0.1, random
  port, with a per-run credential ≥ 128 bit that main answers only for browser partitions; no TLS
  interception, no caching; closed when the last browser tab closes or the app exits. It must pass
  X1–X3 (`docs/research/browser-inapp-alignment-reply-20261009.md`). The owner approved it for
  packaged builds on 2026-10-14: it follows the owner switch Settings → 浏览器 →「允许浏览外部网页」
  (default on, stored and enforced by main in `userData/browser-external.json`; turning it off
  closes the listener and restores the browser sessions' black-hole proxy at once). In dev runs
  `CUTEX_DESKTOP_BROWSER_EGRESS=n2|off` overrides the switch; packaged builds ignore it. LAN /
  private addresses stay refused (X2). The app-level plugin DNS / proxy lockdown is unchanged.
- **Gating.** A module declares `requires.capabilities` (`/v2/capabilities`, evaluated per active
  host), `requires.modules` and `requires.hostKinds`. If a requirement is missing, the module is
  unavailable and its items are hidden, or greyed where the slot says so.
- **Turning modules off.** Modules can be turned off in Settings → 模块; core ones are locked.
- **When a place becomes a slot.** Only when ≥2 features already use it.
- **Right side area (v1.4).** `side.component` items declare a placement rule (page group, order,
  share) instead of coordinates; the shell's pure `place()` decides pages and cards and remembers
  the owner's moves per component kind. Instances keep small serialisable state (≤ 4 KiB,
  `stateVersion` / `restore`) and persist per host in localStorage `cutex-desktop.side`. The shell
  files (`components/side/*`, `lib/side*`) name no feature (test-checked). §19 gutter / turn
  attachment / ref slots are declared; their hosts land in P1a.
- **Migration.** Features migrate when touched. The settings registry goes first (pilot; §4.5,
  `docs/research/settings-audit-20261008.md`), then the status capsule (§4.20), nav + pages, and
  timeline renderers.
- **Kutex convergence.** The module engine and independently verified fixes were migrated onto
  the frozen desktop baseline. Old WorkbenchHost/PluginHost, duplicate app and daemon copies are
  not imported. Settings, status, pages/navigation and the declared received/tool timeline slots
  use this contract. Plan/checklist retain their core item kinds and one thin compatibility facade;
  remaining owner-notify/delegation tail code is explicitly outside this step.
- **Where each kind of extension lives.**
  - UI extensions: desktop modules.
  - Agent-side capabilities: Codex plugins installed by the daemon.
  - Trusted background work: out-of-process daemon service plugins. Each one advertises a
    capability, and modules that require it light up. The imported `service-plugin-host` is only an
    injected-supervisor experiment; it does not implement or replace production cutex / PRH.

## 5. Tech stack

Electron + React 19 + TypeScript + Vite + Tailwind 4 + shadcn/ui + Zustand; pnpm workspace;
Node 24. Chosen to match ZCode so components can be ported. Tauri rejected: WebKitGTK on Linux,
and UI components would need rewriting.

## 6. Repo layout (planned)

```
apps/desktop/            Electron app (main / preload / renderer)
  src/renderer/src/modules/   built-in modules: slot types, registry, one folder per module (§4.22)
packages/protocol/       generated cute-codex v2 TS types + cutex Management v2 types
packages/cutex-client/   Management v2 client: bootstrap → SSE with cursor resume → commands
packages/ui/             components (some ported from ZCode, Apache NOTICE kept)
docs/
refs/                    read-only references (git-ignored)
```

## 7. Integration surface (cutex Management v2)

Verified at cutex a0d95b2 — full notes in `docs/research/cutex-management-v2.md`; cute-codex
protocol notes in `docs/research/cute-codex-protocol.md`.

- All HTTP/SSE from **Electron main** (no CORS; Bearer auth). Desktop uses the **root token**
  (`management_api_token`) because projects / host routes require it.
- Open agent: `bootstrap` → page `/v2/events` until `hasMore=false` → SSE `/v2/events/stream`
  with `after`; reconnect with `Last-Event-ID`; handle `stream_changed` / `cursor_expired` /
  `cutex/stream/reset` by re-bootstrapping. Lagging >1024 events drops the stream silently.
- Send: `cutex/userInput/submit` with `strategy`. **`queue` on an idle agent** (runtime
  connected, no turn running) **starts the turn at once** (disposition `started`; capability
  `queue-idle-start`, cutex `fix/queue-idle-race`) — unless the queue is paused after a stop
  (then it joins the paused queue, result `paused: true`) or an ask (委托) goes first; older items
  still waiting go out first. Before that fix an idle `queue` waited for the next turn boundary,
  so a `queue` sent just after a turn ended (the client still saw it running) could sit queued
  until the next turn end / reconnect. The composer still sends `auto` when idle (starts a turn),
  `queue` when busy (after current turn), and `auto` for Ctrl+Enter while busy (steer); the
  `cutex-client` `submitInput` has no default strategy. A queue row's 插入 (`auto`) is labelled
  立即发送 while the agent is idle (it starts a new turn); a submit with `paused: true` shows
  「已加入暂停的队列」. Queue: `userInput/queue/{list,update,remove,flush}`; `flush` delivers
  queued items now.
  Verified live against the dev daemon (`packages/cutex-client/test/smoke.live.test.ts`).
- Hidden sessions (`exposed_to_backend: false`, e.g. agents from `cutex human new`) are excluded
  from `/v2/sessions` **and** 404 on `/v2/sessions/{id}` even with the root token; they must be
  shown via `cutex/session/visibility/show {expectedRevision}` first. → cutex gap 9.
- Native ops: `app-server/requests` allowlist (turn start/steer/interrupt, thread read/list,
  settings/update, name/set, model/list, …).
- Answer approvals / requestUserInput / elicitation: `server-request-responses` with
  `If-Match: "cutex-runtime-generation:N"`.
- Sidebar data: `/v2/sessions` (+`?lifecycle=retired`), `/v2/agent-management/projects` (+ per
  project workspace), `/v2/host/sessions` for appearance (`provider`, `profileStyle`).
- Cross-agent rendering: received = native `functionCallOutput` `external_event` with
  `externalInputView` `cutex.agent-message.v1` (`senderId`, `senderName`, `deliveryMode`);
  sent = cutex event `cutex/agentBus/messageSent` (resolve recipient name via `/v2/sessions`).
  Delivery modes: `after_turn | soon | passive`.

### Gaps to add in cutex (confirmed)

1. Profile / global config CRUD, login, model discovery routes.
2. Human "new agent in cwd with profile" route (`/v2/agent-management/actions` always 403;
   creation only exists on the Agent Bus for authenticated agents).
3. Fork-as-new-agent (`thread/fork` not allowlisted, no cutex method); also `thread/revert`.
   `/side` (ephemeral fork) needs `thread/fork {ephemeral:true}` forwarded too.
23. Composer slash commands: forward `memory/reset`, `experimentalFeature/list` and
    `experimentalFeature/enablement/set` (owner-global) so `/memories` reset and `/experimental`
    work fully (desktop already calls them and shows a gap error / config.toml fallback).
4. Display metadata: writable `displayName`, `note`, `avatar` (none exist today).
5. Version / capability endpoint (`/v2/host` has no version).
6. Queue **reorder** and **promote-to-steer** (only list/update/remove/flush exist).
7. Forwarded-request validation is pinned to app-server **0.144.1** schema — check it accepts
   what the desktop sends against cute-codex 160.
8. Optional: sender display name in `cutex/agentBus/*` events (today ids only).
9. Root token should see hidden sessions (list `?includeHidden=true`, and per-id routes), since
   the desktop is the owner's full view like the TUI.
11. Project `workspace_root` (set/update via project mutations; returned in project summaries
    and workspace); creating an agent in a project defaults cwd to it.
12. Project memory store (§3.2): list/read/write/delete memory files per project over Management
    v2; inject the `# Memory` section + `MEMORY.md` into agents at launch; keep native
    `features.memories` off.
13. Per-profile quota (composer row: profile name + quota rings). cutex **already has** a
    declarative per-profile HTTP quota reader (`src/profiles/quota.rs`: custom URL + Bearer
    profile key + JSON pointers + mode remaining/used/percent/balance + reset format; `auto`
    presets for GLM/Kimi via a third-party relay `/usage` and DeepSeek balance; shared private cache; used by
    the TUI custom-limit status item). Gap = expose + generalise:
    - `GET /v2/profiles/{profile}/quota` → `{gauges: [{id,label,kind: window|balance,
      remainingPercent?, balance?, resetAt?, windowLabel?, observedAt, stale}]}` (≥0 gauges).
    - Several gauges per profile (e.g. GLM 5h + weekly): keep `options.quota` as the first, add
      `options.quotas: [Config]` extras (each with its own label/pointers), backward-compatible.
    - `GET/PUT /v2/profiles/{profile}/quota-config` (preset + configs; never returns secrets) so
      the desktop Settings can edit custom gauges.
    - ChatGPT-account profiles: also allow native `account/rateLimits/read` in forwarding.
    Context usage stays a separate ring (from `thread/tokenUsage/updated`), never merged.
14. Project file routes (§4.6, option A): `GET /v2/projects/{id}/fs/dir?path=`,
    `GET …/fs/file?path=` (text/base64, size cap), `…/fs/search?q=` (fuzzy, gitignore-aware),
    change events (`cutex/fs/changed`) via a watcher; independent agents use the session cwd
    (`/v2/sessions/{id}/fs/...`). Paths confined to the root (no traversal / symlink escape).
15. Terminal PTY in cutex: create/resize/write/kill a PTY with cwd = project root / agent cwd;
    output over SSE (or WebSocket), input via POST. Owner-only.
16. Git: `…/git/status` (branch, ahead/behind, per-file +/−), `…/git/diff?path=`. Turn file undo is planned separately: `cutex/session/files/revert
    {turnId, paths?, dryRun}` (dry run, all-or-nothing on conflict; §4.6).
17. Launch instruction: "cite files as markdown links relative to the workspace root, optional
    `:line`" (next to the `# Memory` section) so the desktop can make them clickable.
18. Settings routes (gap 1, concrete): `GET /v2/profiles` (list with provider/model/base URL/
    auth-present/default/appearance), `GET/PATCH /v2/profiles/{p}` (codex profile fields: model,
    model_provider, base URL, reasoning effort, context window / auto-compact; secrets write-only),
    `GET/PATCH /v2/settings` (global settings subset in §4.5, secrets write-only),
    `GET/PUT /v2/user-instructions` (`$CODEX_HOME/AGENTS.md`).
19. Profile switch: profile option `allowSessionSwitch` (+ in `/v2/profiles` and PATCH), method
    `cutex/session/profile/switch {profile, expectedRevision, when}` (gate + set + restart/resume),
    event `cutex/session/profileSwitched`.
20. Usage ledger: record per-turn token usage + quota snapshots; `GET /v2/usage?from&to&groupBy=`
    `day|profile|model|agent|project` (multi) → series + totals; `GET/PUT /v2/usage/prices`.
21. Codex config access: an owner-only way to run allowlisted *global* app-server methods
    (`config/read`, `config/value/write`, `config/batchWrite`, `config/mcpServer/reload`,
    `mcpServerStatus/list`, `mcpServer/oauth/login`, `skills/list`, `skills/config/write`,
    `skills/extraRoots/set`, `hooks/list`, later `plugin/*` / `marketplace/*`) against the CODEX_HOME
    that managed agents share — e.g. `POST /v2/codex/requests` backed by a cutex-owned short-lived
    app-server, so it works with no agent online. Changes apply to agents on next launch/reload.
    **Done** on `feat/desktop-codex-config` (0a2dde9): `POST /v2/codex/requests {requestId, method,
    params}` → `{result}` or `{error}`; edits the single shared CODEX_HOME (no per-profile homes —
    profiles are `--auth-file` + `-c` overrides, which win over config.toml for model/provider);
    secrets redacted as `"<redacted>"`, writes containing it rejected.
    Plugins (`feat/codex-plugins` 1f605d7, capability `codex-plugins`): `plugin/{list,read,search,install,
    uninstall}` + `marketplace/{add,remove,upgrade}` on the local catalog (config app-server runs with
    `features.remote_plugin=false`); Codex agents on their own native home launch with the shared
    `[plugins]` as `-c plugins={...}` (settings `codexPluginsFollowShared`, default on).
22. Scoped MCP (§4.11): store MCP server configs on projects and sessions (agent-level also
    `disabled: [names]`), inject at launch via `-c mcp_servers.*` (global < project < agent), CRUD
    routes `GET/PUT /v2/projects/{id}/mcp`, `GET/PUT /v2/sessions/{id}/mcp`, an effective view
    `GET /v2/sessions/{id}/mcp/effective` (layer per server), and `GET /v2/codex/managed-mcp`
    (cutex built-ins + their tool lists). **Done** on feat/desktop-codex-config (8014b60); stored in
    a sidecar `~/.cutex/scoped-mcp.json` (project-state records are deny_unknown_fields); secret env
    / header values passed via process env, not the command line.
10. Optional: emit a `cutex/session/activityUpdated` event (today `activity` changes are only
    visible by re-fetching the session resource; desktop derives previews from native events).

## 8. Sources and what we take from each

| Source | Take | Leave |
|---|---|---|
| cutex | the backend: Management v2, lifecycle, profiles, Agent Bus | cutex-mcp (agent-facing) |
| cute-codex | generated protocol types, approval/request semantics, external input | TS SDK (`codex exec`, no interactive approvals) |
| ZCode | React UI components & patterns: timeline, tool blocks, diff/git pane (`@pierre/diffs`), xterm terminal, file tree, permission/elicitation dialogs, composer + queue, workbench panes; process-split ideas | the product: Zhipu services, login, telemetry, own agent protocol, branding |
| GPT demo | hardening ideas, adapter event contract as reference | UI, full-snapshot SSE, JSON store, local HTTP server, multi-provider framing |
