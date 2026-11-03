# 022 项目事件流（Project 视图的「动态」）

状态：**待定**（10-22，等主人看；只是方案，没有实现）。来源：0.2 清单 #30「Project 视图的项目事件流（历史动态、所有智能体的子智能体 / 后台命令）需要后端」，主人：查。

## 问题

Project 视图想回答两件事：**这个项目最近发生了什么**（谁跑了哪些回合、委托来回、审批、成果、出错），以及**现在有什么在后台跑**（每个智能体的子智能体、后台命令、作业）。cutex 今天没有任何「按项目」的事件记录。

### 现在 cutex 有什么（2026-10-22，feat/desktop-api）

| 来源 | 存在哪 | 带项目吗 | 保留多久 | 现成接口 |
|---|---|---|---|---|
| Management v2 事件日志（所有原生通知 + `cutex/...` 事件） | `runtime/management-v2/events.jsonl` | **否**，只有 `cutexSessionId` | 按大小：32 MiB × 3 个文件，与时间无关 | `GET /v2/events`（只能向后翻、一次一个会话、先扫后过滤）+ `/v2/events/stream`（SSE） |
| 委托（asks） | `runtime/asks/asks-v1.json`，结束 30 天后归档到 `archive/records-*.jsonl.gz` | **是**（`AskRecord.project_id`） | 30 天 + 归档 365 天 | `GET /v2/asks?project=`、`cutex/ask/*` 事件 |
| 工作流 | `runtime/workflows/runs.sqlite3` | **是** | 30 天 | `GET /v2/workflows/runs?projectId=`（仅主人） |
| 成果、批注 | artifact store / `notes.sqlite3` | 按会话，可按项目查 | 各自 | `/v2/artifact-store?project=`、`/v2/notes` |
| 回合窗口 `turn_windows` | artifact store（SQLite） | **是**（`project_id`，按 `(project_id, started_at)` 建了索引） | 7 天；**只有开了成果自动捕获才写** | 无 |
| 主人通知 | `runtime/owner-notify/` | 按会话 | 30 天 / 2000 条 | `/v2/owner-notifications` |
| 用量账本 | `usage-ledger/YYYY-MM.jsonl` | 否（查询时按**当前**成员归项目） | 未清理 | 只有汇总 `GET /v2/usage` |
| Claude 后台任务（子智能体 `local_agent` / 后台命令 `local_bash`） | 只有**结束时**变成一条 Agent Bus 消息（`ctask-…`，`agent_bus/claude_task.rs`） | 否 | 随总线消息归档 | 停止：`claude/tasks/stop` |
| Codex 子智能体线程 | 写进父会话的事件流（`subagent_lineage.rs`）；父子关系**只在进程内存里** | 否 | 跟事件日志 | — |
| Codex 后台终端 | **cutex 没有记录**，只有原生请求 `thread/backgroundTerminals/list|terminate` | 否 | — | 只有直通请求 |
| 作业（job service） | 独立守护进程 `runtime/job-service/v1/` | 否（按会话） | 守护进程自管 | `POST /v2/job-service/management-query`；结束时 `cutex/jobService/terminalObserved` |
| 闹钟 | `runtime/alarms/alarms.json` | 否 | 未清理 | `/v2/alarms`、`cutex/alarms/changed` |
| 主机摘要 `summary.sqlite3` | 派生表 + 带序号的日志 | 行里有 `projectId` | 7 天 / 10 万行 | `GET /v2/summary`、`/v2/summary/events`（SSE，序号当游标）——**最接近要做的东西，可当模板** |

项目成员关系在 Agent Management store（`current_project_memberships`），**只有当前值、没有历史**：一个智能体换了项目，过去的事件就分不清当时属于哪个项目。

缺口：① 事件不带项目；② 没法一次查多个会话、没法「最新的 N 条」或按时间段；③ 各来源保留期不一（7 天 / 30 天 / 按大小）；④ 后台工作几乎没记录（Claude 只有结束、Codex 后台终端完全没有、子智能体父子关系在内存）；⑤ 默认没有按项目的回合记录。

## 做法

**A. 查询时拼接**：新接口在请求时把各来源（委托、工作流、成果、主人通知、作业、闹钟……）按项目各查一遍再合并。
- 好：不加存储。
- 坏：回合、子智能体、后台命令这些最想看的东西根本没有来源；各来源保留期不同，翻页游标难做；每次都要扫多个存储。

**B. 项目日志（推荐）**：cutex 新增一个**派生日志**——一个后台投影器顺着 Management v2 事件日志读（和 `summary`、`activity_bridge` 同一种做法），把有意义的事件归一成「项目事件行」，**写入时按当时的成员关系打上项目号**，存进 SQLite。
- 好：一处查询、稳定游标、可以按项目 / 智能体 / 种类筛；保留期统一；以后加来源只是加映射。
- 坏：要补几个今天没有的来源（见下），多一个存储（体积可控）。

**C. 只做「现在在跑」**：只加一个「当前后台工作」接口（子智能体 / 后台命令 / 作业的实时列表），不做历史。
- 小，但满足不了「过去的动态」。

## 建议

做 **B**，并把 C 的「现在在跑」作为同一能力的一部分（历史 + 现在两块）。

### 接口（能力 `project-events`）

1. `GET /v2/projects/{projectId}/events?before=&after=&limit=&kinds=&sessionId=`
   - **新的在前**；`before=<cursor>` 往旧翻，`after=<cursor>` 取更新的（断线补齐）；`limit` 缺省 100，最大 500。
   - 游标 `pe:<seq>`（日志自增序号，不透明）；游标不是这个日志发出的（别的流、或还没发出的序号）时返回 `409 cursor_expired` 并带最早可用游标（和 `/v2/summary/events` 一致；2026-10-23 定，原写 410）。
   - `kinds` 逗号分隔（见下表的种类前缀，如 `turn,ask,background`）；`sessionId` 只看某个智能体。
2. `GET /v2/projects/{projectId}/events/stream?after=`：SSE，`Last-Event-ID` = 游标；落后太多时发 `lagged`，客户端重新拉第 1 条接口。同时在主机事件流上发 `cutex/projectEvents/appended`（参数只有 `projectId` + 最新游标，桌面据此决定要不要拉）。
3. `GET /v2/projects/{projectId}/background`：**现在**在跑的东西，按智能体分组：子智能体、后台命令、作业，每项带开始时间、描述、所属回合、能否停止（`stop` 指向现有的 `claude/tasks/stop` / `thread/backgroundTerminals/terminate` / 作业取消）。数据来自投影器维护的「进行中」表，不另存历史。

### 一行事件的样子

```json
{
  "cursor": "pe:18342",
  "at": "2026-10-22T03:12:09Z",
  "projectId": "cutex-desktop-side",
  "cutexSessionId": "cutex.1fe8…",
  "agentName": "waveline-dev-fixes",
  "kind": "background.finished",
  "status": "completed",
  "title": "cargo test --lib",
  "detail": "2901 passed, 2 failed",
  "parent": { "turnId": "c5d2…", "taskId": "bash-7", "threadId": null },
  "refs": { "askId": null, "jobId": null, "artifactId": null, "workflowRunId": null, "approvalId": null },
  "source": { "method": "claude/task/updated", "eventCursor": "c2:…" }
}
```

种类（第一版）：

| 种类 | 来源 | 备注 |
|---|---|---|
| `turn.completed` / `turn.failed` / `turn.interrupted` | 原生 `turn/completed` | **一回合一行**（开始不单独记，行里带时长、工具次数、token）；不记增量 |
| `ask.created` / `ask.answered` / `ask.failed` / `ask.closed` | `cutex/ask/*` | 两端都在项目里时只记一次 |
| `subagent.started` / `subagent.finished` | Claude `claude/task/updated`（`local_agent`）、Codex 子智能体线程 | 需要补：Claude 开始事件、Codex 父子关系落盘 |
| `background.started` / `background.finished` | Claude `local_bash`、Codex 后台终端 | 需要补：Codex 后台终端的开始 / 结束通知（见待定问题） |
| `job.started` / `job.finished` | 作业服务 | 需要补：开始事件（今天只有结束） |
| `approval.requested` / `approval.decided` | `cutex/approvals/changed` | 内容按可见性裁剪 |
| `artifact.published`、`workflow.run`、`ownerNotify.created` | 现有 `cutex/...` 事件 | — |
| `member.joined` / `member.left`、`runtime.online` / `runtime.offline` | Agent Management / runtime 事件 | 成员变更也写进日志，方便解释「为什么某智能体的旧事件在这里」 |

### 存储与保留

- `~/.cutex/runtime/project-events/journal.sqlite3`：表 `events(seq PK, project_id, session_id, at, kind, …json)`，索引 `(project_id, seq)`、`(project_id, session_id, seq)`；表 `running(...)` 存进行中的后台工作。
- 投影器状态（读到事件日志的哪个游标）存在同一库里；重启后接着读；事件日志已经轮转掉的部分只能跳过（记一行 `journal.gap`）。
- ~~保留 90 天 + 每个项目最多 5 万行；每小时清理一次。项目删除时它的行一起删。~~ **主人决定（2026-10-23）：项目动态全部保留，什么都不删**（和额度历史一样；原来的 90 天 / 每项目 5 万行清理已经去掉，cutex `8213f36`）。见「实现计划 §2」。
- 第一次启动做一次**有限回填**：委托（30 天内 + 归档）、工作流、`turn_windows`（如有）、主人通知；回合历史不回填（太贵）。

### 可见性

- 主人：全部。
- 成员 / 设备令牌：按现有 `access.rs event_visible` 的会话范围过滤；委托按两端检查；工作流仍只给主人。

### 桌面端（Project 视图）

- 新增「动态」：上面一块**正在进行**（每个智能体一行：子智能体 n 个、后台命令 n 个，展开看描述、开始时间、所在回合，主人可停止）；下面是**时间线**，按天分组，可按智能体和种类（回合 / 委托 / 子智能体 / 后台命令 / 审批 / 成果）筛选，点一行跳到对应回合、委托或成果。
- 实时：订阅 SSE；不在 Project 视图时只听主机事件里的 `cutex/projectEvents/appended`，用来给 Project 视图入口打点。
- 旧 cutex（没有 `project-events`）：「动态」只显示委托（用现有 `GET /v2/asks?project=`），并写一句「需要更新主机后端」。

## 决定

待主人。

## 规则（采纳后）

1. 项目事件按**发生当时**的成员关系归项目，之后换项目不改旧事件。
2. 一回合一行，不记增量；子智能体和后台命令各自有开始 / 结束两行。
3. 新的在前翻页，游标稳定；过期游标明确报错，不悄悄跳过。
4. ~~缺省保留 90 天，每项目 5 万行上限。~~ 全部保留，不删（主人 2026-10-23）。
5. 「正在进行」只来自运行时报告的真实状态，不靠猜；运行时下线时它的进行中项标「状态未知」。

## 工作量（估计）

- cutex 日志 + 投影器 + 3 个接口 + 可见性 + 测试：3–4 天。
- 补来源：Claude 任务开始事件（适配器已有 `claude/task/updated`，主要是映射）0.5 天；Codex 子智能体父子关系落盘 0.5 天；Codex 后台终端开始 / 结束通知 0.5–2 天（取决于 cute-codex 是否已有通知，见下）；作业开始事件 0.5 天。
- 桌面「动态」视图 + 正在进行 + 旧版回退：2–3 天。
- 合计约 7–10 天，可以分两期：先「历史（回合 + 委托 + 审批 + 成果）」，再「子智能体 / 后台命令」。

## 待定问题（问主人）

1. （已答：10-22 定 90 天，10-23 改为全部保留）保留 90 天够不够？要不要和用量一样按「最近一年」？（体积估计：活跃项目一天几百行，90 天约几 MB。）
2. 回合要不要都进时间线？还是只记「失败 / 中断」和「委托里的回合」，正常回合只计数？
3. 成员 / 设备令牌能不能看项目动态（按会话范围裁剪），还是第一版只给主人？
4. Codex 后台终端：cute-codex 是否已发出可用的开始 / 结束通知？如果没有，第一版是否接受「Codex 后台命令只在『正在进行』里出现（靠定时 list），不进历史」？
5. 「正在进行」里的停止按钮要不要第一版就做？

## 链接

- 清单：`docs/research/polish-0.2-checklist.md` #30
- cutex：`src/management/v2/repository.rs`（事件日志）、`src/management/v2/summary.rs`（模板）、`src/agent_management/projects.rs`（`current_project_id`）、`src/artifacts/store.rs`（`turn_windows`）、`src/agent_bus/claude_task.rs`、`src/cli_app/subagent_lineage.rs`、`src/management/v2/native_requests.rs`、`src/management/v2/access.rs`（`event_visible`）、`src/management/v2/capabilities.rs`
- 相关方案：005（Claude 后台子智能体）

## 主人决定（2026-10-22）

Q1 保留 90 天（**10-23 改为全部保留**，见实现计划 §2）；Q2 所有回合（折叠成一行）；Q3 主人和成员能看；Q4 接受 Codex 后台命令第一版只在「正在进行」；Q5 停止按钮第一版就做。**开工：未答**（待主人确认）。

2026-10-23：主人批准 B（Director 转达），开工。

## 实现计划（2026-10-23，cutex 分支 `feat/next-after-r250`）

一句话：照 `summary.rs` 的样子，新加一个模块 `src/management/v2/project_events.rs`（+ `_tests.rs`），一个后台线程顺着 Management v2 事件日志读，把有用的事件变成「项目事件行」写进自己的 SQLite；三个接口读它。**不改任何已有的持久化格式**（只加新文件、新事件），回滚到 r250 / r249 时新文件被忽略。

### 1. 来源（第一期）

投影器只读 `events.jsonl`（`repository.page`，和 summary 一样每秒一次、每次最多 20 页）。每条事件先找项目号：带 `projectId` 的记录（委托、审批、成果 scope）直接用；其它按 `cutexSessionId` 查 Agent Management 的**当前**成员关系（`memory::project_for_session`，每批读一次快照）。查不到项目的事件丢掉。

| 种类 | 事件日志里的来源 | 说明 |
|---|---|---|
| `turn.completed` / `turn.failed` / `turn.interrupted` | 原生 `turn/completed`，只认会话**自己的线程**（`correlation.threadId` = 会话的原生线程） | 一回合一行：状态、时长（Claude 用 `turn.durationMs`；Codex 用同一回合 `turn/started` 与 `turn/completed` 的 `receivedAt` 差，开始时间存在投影器的小表里）、工具调用次数、第一条用户消息前 120 字作标题、出错时的错误一行。不记 token（`thread/tokenUsage/updated` 常在回合结束后才到；用量看 `/v2/usage`） |
| `subagent.started` / `subagent.finished` | `item/completed` 里 `type = subAgentActivity`（Claude 的 `local_agent` 和 Codex 都有）；Codex 另有子线程的 `thread/started`（带 `parentThreadId`） | 子线程的回合不进 `turn.*`，只算到子智能体那一行 |
| `ask.created` / `ask.answered` / `ask.failed` / `ask.closed` | `cutex/ask/created`、`/answered`、`/stateChanged`（`failed`/`interrupted`）、`/closed` | 同一委托事件会在两端会话各记一次：按 `askId + revision + 种类` 去重；项目号取 `AskRecord.projectId`，`ask.created` 时记到小表里给后面的事件用 |
| `approval.requested` / `approval.decided` | `cutex/approvals/changed`（`reason` = requested / approved / denied） | 项目号取 `ApprovalRecord.projectId`；`consumed` 不单记 |
| `artifact.published` | `cutex/artifact/published`（只记 `newVersion` 的第一版和以后每次新版本） | 项目号：项目 scope 直接用，否则按 `producer.sessionId` |
| `workflow.run` | `cutex/workflow/run/changed`，只记进入结束状态的那次 | 只给主人看（和现在一样） |
| `ownerNotify.created` | `cutex/ownerNotify/created` | 只记创建 |
| `job.finished` | `cutex/jobService/terminalObserved` | 作业开始事件今天没有，第一期不补 |
| `runtime.online` / `runtime.offline` | `cutex/runtime/online`、`/offline`、`/failed` | |
| `member.joined` / `member.left` | 没有现成事件：投影器每次处理完一批后比对成员关系快照（和上次存的比），有变化就写一行 | 「事后换项目不改旧行」由此保证：旧行的项目号在写入时就定了 |

`cutex/projectEvents/*` 是投影器自己发的，读到就跳过（避免绕圈）。

### 2. 存储

- 文件：`~/.cutex/runtime/project-events/journal.sqlite3`（私有目录，`journal_mode=DELETE`，`busy_timeout 2s`，和 summary 一样）。
- 表：
  - `meta(key, value)`：`streamId`（新库随机 UUID）、`sourceCheckpoint`（事件日志的 `(streamId, cursor)`）、`memberships`（上次的成员关系）、`initialized`。
  - `events(seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id, session_id, at, kind, dedupe TEXT UNIQUE, row TEXT)`；索引 `(project_id, seq)`、`(project_id, session_id, seq)`。`row` 是下面那一行 JSON 的完整内容。
  - `pending(key, value)`：进行中的回合开始时间、委托→项目号这类小状态，结束后删。
- 一批事件 + 新游标在**一个事务**里写（重启不丢、不重复）。
- **保留**：**主人决定（2026-10-23）：项目动态全部保留，什么都不删**（和额度历史一样；原来的 90 天 / 每项目 5 万行清理已经去掉，cutex `8213f36`）。没有设置项，也没有后台清理。
  - 读取都走索引 `(project_id, seq)` / `(project_id, session_id, seq)`，翻页只读一页。host02 调试版实测（一个项目 20 个智能体，每行带 120 字预览）：

    | | 100 万行（780 MB） | 10 万行（78 MB） |
    |---|---|---|
    | 最新一页 / 中间一页 / 最旧一页（`after=0`） | 2.4 / 1.9 / 2.4 ms | 3.0 / 2.2 / 2.0 ms |
    | 只看一个智能体（`sessionId`） | 2.2 ms | 2.4 ms |
    | `kinds=delegation`（常见种类） | 2.5 ms | 2.8 ms |
    | `kinds=ask`（很少见：1 万行里 1 行） | 667 ms | 78 ms |
    | 成员只看得到 20 个智能体中的 1 个 | 26.5 ms | 26.0 ms |
    | 成员一行也看不到（最坏情况，扫完整个项目） | 9.9 s | 1.1 s |
    | 写入 1 行 | 3.0 ms | 3.3 ms |

    体积约 780 字节 / 行：活跃项目一天几百行，一年也就几十 MB。
  - 慢的只有两种：很少见的 `kinds`，和成员几乎什么都看不到的项目（要扫到底才知道没有更多）。这是**以后的建议，还没做**：
    ① 每次翻页设扫描上限（例如 2 万行），到了就返回已找到的行和一个续读游标（加字段，不改已有字段）；
    ② 加 `(project_id, kind, seq)` 索引，把前缀筛选改成范围查询。不删任何行。
  - `floors` 表和 `earliestCursor` 留着（现在总是 0 / 最早），格式和 r250 之后的第一版一样，不需要迁移。
- **事件日志已经轮转掉**（游标过期 / 流换了）：从现存最早处接着读，并写一行 `journal.gap`（每个受影响项目一行，`detail` 写「这段时间的动态缺失」）。
- **第一次启动**：把现存的整段事件日志（最多约 96 MiB，通常几天）重放一遍当作回填，行里标 `backfilled: true`，项目号用当时（即现在）的成员关系。不另外去翻委托 / 工作流的存储。

### 3. 一行的 JSON

和上文「一行事件的样子」相同，另加 `backfilled`（仅回填的行）；`source.eventCursor` 是事件日志的 `c2:` 游标，方便桌面跳到回合。

### 4. 接口（能力 `project-events` / `projectEvents`）

1. `GET /v2/projects/{projectId}/events?before=&after=&limit=&kinds=&sessionId=`
   - 新的在前；`before` 往旧翻，`after` 取更新的（这时旧的在前，便于补齐）；`limit` 缺省 100，最大 500。
   - 游标 `pe:<seq>`；回复带 `streamId`、`cursor`（最新）、`earliestCursor`、`hasMore`。
   - 游标低于该项目的 `earliestCursor`（现在不会发生：什么都不删）、高于最新游标，或 `streamId` 不符：`409 cursor_expired`（和 `/v2/summary/events`、`/v2/events` 一致），带 `streamId`、`earliestCursor`、`latestCursor`。
   - `kinds` 按前缀（`turn,ask,subagent,approval,artifact,workflow,ownerNotify,job,runtime,member,journal`）。
2. `GET /v2/projects/{projectId}/events/stream?after=`：SSE，`id:` = `pe:<seq>`，`Last-Event-ID` 续传；先补积压再推实时；25 秒心跳；订阅者太慢就发现有的 `lagged` 帧（`write_sse_lagged`），客户端回到第 1 个接口补。
3. 主机事件：每批写完后，对有新行的项目在 `cutex.host` 上发 `cutex/projectEvents/appended {projectId, cursor}`，**每个项目每 5 秒最多一次**。
4. `GET /v2/projects/{projectId}/background`：第二期（见 §6）。

### 5. 可见性

- 主人：全部。
- 成员 / 设备令牌：路由要 `scope.sees_project(projectId)`；每一行再按 `scope.sees_session(row.sessionId)`；委托行另要 `asks.visible(askId)`；工作流行只给主人；`member.*`、`journal.gap` 对能看该项目的人都可见。
- access 表加两条 `Scoped` 规则；`the_non_owner_surface_is_exactly_the_reviewed_table` 一起改。设备令牌的 `ScopeNeed::Read` 照旧。

### 6. 第二期：「正在进行」（`/background`）

- **Claude 子智能体 / 后台命令**：`claude/task/updated` 今天**不进事件日志**（`claude_runtime.rs` 直接丢掉）。改为在那里额外发一条 cutex 事件 `cutex/claudeTask/changed {taskId, taskType, status, description, command, turnId, threadId}`（只在状态变化时），投影器据此维护 `running` 表，并在结束时写 `background.finished` / `subagent.finished`（后台命令进历史）。
- **Codex 后台终端**：照主人 Q4，只在「正在进行」里：`/background` 被请求时，对该项目在线的 Codex 运行时调用 `thread/backgroundTerminals/list`（实现：只查智能体自己的线程；cutex 没有子线程清单），结果缓存 5 秒，不进历史。
- **作业**：`job-service` 的 management-query 查该项目会话的运行中作业。
- **停止**（Q5）：每项带 `stop: {method, params}`，指向现有接口（Claude `claude/tasks/stop`、Codex `thread/backgroundTerminals/terminate`、作业取消），桌面直接调；cutex 不加新的停止接口。
- 运行时下线：它的进行中项标 `state: "unknown"`。

### 7. 测试

- 归一化：每种来源一个用例（用真实形状的 `EventEnvelope`），包括 Claude / Codex 回合、子线程回合不出 `turn.*`、委托两端去重、成员变更出 `member.*`、换项目后旧行不变、自发的 `cutex/projectEvents/*` 被跳过。
- 日志：游标往前 / 往后翻、`409 cursor_expired`、事件日志轮转后写 `journal.gap`、重启不重复（事务 + `dedupe UNIQUE`）、~~保留期与 5 万行上限~~ 超过 5 万行和 2020 年的行都还在、最早的游标一直有效（`every_row_is_kept_and_old_cursors_stay_valid`）。
- 接口：HTTP 级（主人 / 成员可见性、kinds / sessionId 过滤、SSE 续传与 lagged）；`access_tests` 表；能力列表；导出 schema（`schema/export/project-events.json`，加进 `schema_export::SCHEMAS`，用真实行做校验）。

### 8. 回滚

只新增：新目录 `runtime/project-events/`、新的 `cutex/projectEvents/appended`（第二期再加 `cutex/claudeTask/changed`）事件。旧版本对事件日志里没见过的 `cutex/...` 方法照常保存和转发（schema 只认格式），不认识新目录。回滚不需要处理，回滚扫描脚本也不用加项。

### 9. 工作量与顺序

第一期（§1–5、7）约 3 天，先做；第二期（§6）约 1.5–2 天。桌面「动态」视图另算。

## 桌面接口约定（cutex `feat/next-after-r250`：第一期 01d93d1，第二期 a36ad6f）

给做 Project「动态」视图的桌面成员。机器可读的形状：cutex `src/management/v2/schema/export/project-events.json`（`$defs`: `projectEventPage`、`projectEvent`、`appended`）。

**能力**：`features.projectEvents`（`featureList` 里 `project-events`）。没有它就走上文「旧 cutex」回退（只显示委托）。

### 读一页：`GET /v2/projects/{projectId}/events`

| 参数 | 说明 |
|---|---|
| `limit` | 1–500，缺省 100；超出范围 400 |
| `before=pe:N` | 比 N 旧的行，新的在前（往下翻页：用这一页最后一行的 `cursor`） |
| `after=pe:N` | 比 N 新的行，**旧的在前**（断线后补齐）；和 `before` 不能同时给（400） |
| `kinds` | 逗号分隔的前缀：`turn,ask,subagent,background,approval,artifact,workflow,ownerNotify,job,runtime,member,journal`；未知的 400 |
| `sessionId` | 只看某个智能体 |
| `streamId` | 可选：上次拿到的 `streamId`，不符就 409（日志被重建过） |

都不给 = 最新的一页。回复：

```json
{
  "projectId": "cutex-desktop-side",
  "streamId": "6f0c…",
  "cursor": "pe:18342",
  "earliestCursor": "pe:120",
  "order": "newestFirst",
  "hasMore": true,
  "events": [ /* projectEvent… */ ]
}
```

- `cursor` = 整个日志最新的游标（不只是这个项目）；`earliestCursor` = 这个项目最早可用的游标（什么都不删，所以就是最早的一行之前），`after` 比它小就 409。
- `hasMore`：这个方向上还有（你能看到的）行。
- 错误：`409 cursor_expired`（`error.details` 有 `streamId`、`earliestCursor`、`latestCursor`；做法：丢掉本地游标，重新读最新一页）；`400 invalid_request`；`404 project_not_found`（成员看不到这个项目）；`503 project_events_unavailable`（主机没在跑投影器，稍后再试）。

### 一行（`projectEvent`）

```json
{
  "cursor": "pe:18342",
  "at": "2026-10-22T03:12:09.000Z",
  "projectId": "cutex-desktop-side",
  "cutexSessionId": "cutex.1fe8…",
  "agentName": "waveline-dev-fixes",
  "kind": "turn.completed",
  "status": "completed",
  "title": "Run the tests and fix what fails",
  "detail": "All green: 2901 passed.",
  "parent": { "turnId": "c5d2…", "taskId": null, "threadId": "019a…" },
  "refs": { "askId": null, "jobId": null, "artifactId": null, "workflowRunId": null, "approvalId": null, "notificationId": null },
  "source": { "method": "turn/completed", "eventCursor": "c2:…" },
  "durationMs": 42500,
  "toolCalls": 7
}
```

- 键总在（值可以是 `null`）；`durationMs`、`toolCalls`、`backfilled`、`turnOrigin` 只在有时出现。
- `turnOrigin?: "owner" | "external"`（2026-10-29）：由 daemon 根据启动回合的明确来源记录，不以回合中的插话、被动结果或标题猜测。`owner` 为主人明确发起；`external` 包括智能体/服务/自动化发起。缺失（旧主机、旧日志、来源无法确认）按未知处理，桌面保留显示。
- 「动态」默认隐藏确认由主人发起的回合；选择「回合」筛选后可勾选「包括我发起的」，开关默认关并保存在本机。回到全部动态继续显示自主动态，保留此偏好供下次进入「回合」使用。只影响回合行，不隐藏审批、成果、委托等独立事件。没有 `project-events` 的旧主机仍使用原派生列表；支持事件但缺来源的新旧日志不推测发起者。
- `backfilled: true`：主机第一次启动时从现存事件日志补回来的行，项目号是补的时候的成员关系。
- `journal.gap`：这段时间的动态缺失（事件日志已轮转掉），显示一行提示即可。
- 跳转：回合 → `cutexSessionId` + `parent.turnId`；委托 → `refs.askId`；成果 → `refs.artifactId`；审批 → `refs.approvalId`；作业 → `refs.jobId`；主人消息 → `refs.notificationId`。

| `kind` | `status` | `title` / `detail` |
|---|---|---|
| `turn.completed` / `turn.failed` / `turn.interrupted` | 同 kind 后缀 | 第一条用户消息 / 最后的回答（失败时：错误） |
| `ask.created` / `ask.answered` / `ask.failed` / `ask.closed` | 执行状态 / 回答状态 / 关闭结果 | 委托标题 / `→ 对方`、回答预览 |
| `subagent.started` / `subagent.finished` | `null` / `completed`、`interrupted` | 子智能体路径；`parent.threadId` = 子线程，`parent.taskId` = Claude 任务号 |
| `background.started` / `background.finished` | Claude 任务状态（`pending`、`running` / `completed`、`failed`、`stopped`、`killed`、`cancelled`、`lost`） | 描述（没有就是命令）/ 命令；只有 Claude 后台命令（Codex 后台命令只在「正在进行」里） |
| `approval.requested` / `approval.decided` | `requested` / `approved`、`denied` | 审批摘要 / 种类 |
| `artifact.published` | — | 成果名 / 种类 |
| `workflow.run` | `completed`、`errored`、`stopped`、`rejected`、`expired` | 工作流名 / 停止原因（只给主人） |
| `ownerNotify.created` | 级别 | 消息前 120 字 |
| `job.finished` | 作业结束状态 | 作业号 / `exit N` |
| `runtime.online` / `runtime.offline` | 运行时状态 | — / 原因 |
| `member.joined` / `member.left` | — | — |
| `journal.gap` | — | — / 说明 |

### 实时：`GET /v2/projects/{projectId}/events/stream`

- SSE；每帧 `id: pe:N`、`event: cutex/projectEvents/event`、`data:` = 一行 `projectEvent`。也接受 `kinds`、`sessionId`、`streamId`。
- 续传：`?after=pe:N` 或 `Last-Event-ID: pe:N`；不给 = 只要以后的。游标过期 → 409（同上）。
- 25 秒一次 `: keepalive`。读得太慢会收到 `event: cutex_management_stream_error`（`code: lagged`，`lastDeliveredCursor`），然后连接关闭：用 `after=<lastDeliveredCursor>` 读第一个接口补齐，再重连。

### 提示：主机事件 `cutex/projectEvents/appended`

- 在主机事件流（`/v2/events/stream`，会话 `cutex.host`）上：`{ "projectId": "…", "cursor": "pe:N" }`，每个项目每 5 秒最多一次。成员只收到自己能看的项目的。
- 用法：不在 Project 视图时，用它给 Project 入口打点；在视图里直接用上面的 SSE。

### 可见性

主人看全部。成员 / 设备令牌：只有授权的项目；行里的智能体要在自己的范围内（没有智能体的行，如成员变动、缺口，都能看）；委托行按委托的可见性；工作流行看不到。被过滤掉的行不占 `limit`。

### 正在进行：`GET /v2/projects/{projectId}/background`（第二期）

每次请求时问这个项目每个在线智能体的运行时（同一项目 5 秒内的请求共用一次结果）。轮询即可（建议视图打开时每 5–10 秒一次，或收到 `appended` 时刷新）。

```json
{
  "projectId": "cutex-desktop-side",
  "generatedAt": "2026-10-23T03:12:09.000Z",
  "jobsAvailable": false,
  "agents": [
    {
      "cutexSessionId": "cutex.1fe8…", "agentName": "waveline-dev-fixes",
      "backend": "claude", "runtime": "online", "complete": true,
      "items": [
        { "kind": "subagent", "source": "claude", "id": "a1b2", "title": "Review the diff", "detail": null,
          "turnId": "c5d2…", "threadId": "019a…", "startedAt": "2026-10-23T03:10:00.000Z", "state": "running",
          "stop": { "kind": "native", "cutexSessionId": "cutex.1fe8…", "method": "claude/tasks/stop",
                    "params": { "threadId": "019a…", "taskId": "a1b2" } } }
      ]
    }
  ]
}
```

- `kind`：`subagent`（Claude 子智能体）、`background`（Claude 后台命令 / Codex 后台终端）、`task`（其它 Claude 任务）、`job`（作业）。`startedAt`：Claude 任务是主机第一次看到它的时间，Codex 终端没有（`null`）。
- `state`：`running` / `pending`；`unknown` = 运行时下线了，这是它最后知道的 Claude 任务（不能停）。`runtime: "offline"` 的 Codex 智能体没有条目。
- `complete: false`：运行时没答上（下线或出错），列表可能不全。Codex 只查智能体自己的线程（子线程的后台终端第一版不列）。
- `jobsAvailable: false`：这台主机没有作业服务（Windows），作业不列。
- **停止**（只有主人有 `stop`，其他人是 `null`）：
  - `kind: "native"` → `POST /v2/sessions/{cutexSessionId}/app-server/requests`，body `{"requestId": "<新 id>", "native": {"message": {"id": "<新 id>", "method": <method>, "params": <params>}}}`。Claude 的回复只表示「已请求停止」，真正结束看下一次 `/background` 或历史里的 `background.finished`。
  - `kind: "job"` → `POST /v2/job-service/cancel {"jobId", "expectedRevision"}`（409 `job_conflict` = 作业变了，刷新再试）。
- 成员：只看到自己范围内的智能体；`404 project_not_found` = 项目不存在或看不到。
- 机器可读：`project-events.json` 的 `$defs/background`、`backgroundItem`、`stop`。
