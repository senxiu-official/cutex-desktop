# 023 审批结果在下一步送到忙着的智能体

状态：**待定**（10-22，等主人看；只是方案，没有实现）。来源：0.2 清单 #31「主人批准（approvals）通知仍是回合结束后送达（safety grants 已改为下一步）；要改需要动闹钟协议」，主人：查。

## 问题

智能体请求审批（起服务、改服务生命周期、静态目录、换 Profile、打开浏览器……），你在桌面上批准或拒绝。如果它这时正在跑一个长回合，**要等这一回合结束**才知道结果，常常白等或者绕路。安全授权（safety grants）在 655d1e0 已经改成**下一步**就读到。

### 为什么两者不一样（已查清）

- **安全授权**走的是「主人输入」通道：`cutex/userInput/submit`，策略 `auto`（`src/management/v2/safety_checks.rs:405-425`）。智能体忙时：Codex 用 `turn/steer` 插进当前回合；Claude 适配器支持 `input.sameTurnSteering` 时同样插进当前回合，否则排到下一回合（`src/cli_app/app_server_user_input.rs:446-509, 1430-1437`）。
- **审批结果**走的是**闹钟**：`approvals::queue_decision_notice` → `alarms::set_system_notice("cutex.approvals", "<审批号>:<approved|denied>", …)`（`src/management/v2/approvals.rs:314-327`）。闹钟变成发送方为「Cutex Alarm」、模式 `AfterTurn` 的总线消息（`src/agent_bus/client.rs:284-299`）。
- 闹钟**被硬性规定只在回合结束后送达**：`delivery::always_after_turn`（`src/agent_bus/delivery.rs:75-81`，任务 01 / d657ffb：你自己设的提醒不该打断正在做的事）。两种运行时都执行这条：
  - Codex：`busy_wake_candidate` 对闹钟返回 false（`src/app_server/bus_bridge_external.rs:799-804`），忙时一直扣着（`:988-994`）；闹钟投影只接受 after-turn（`src/app_server/bus_bridge.rs:1157, 1174`）。
  - Claude：`busy_delivery::candidate` 对闹钟返回 false（`src/cli_app/claude_busy_delivery.rs:15-19`），忙时跳过（`src/cli_app/claude_runtime.rs:444-450`）；入口只接受 after-turn 的闹钟（`src/cli_app/claude_ingress.rs:71-74`）。
- 所以：**审批结果搭了闹钟的车，也就继承了「只在回合后」**。655d1e0 没碰这条路，因为安全授权本来就不用闹钟。
- 同类问题还有：**主人通知的回复**（`owner_notify.rs:276`）和**主人唤醒**（`agent_bus_wake.rs:74`）忙时用 `queue`，也是回合后；**委托审核被拒**走委托结果通道，下一步才到，但先要等 `wake_busy_wait`（缺省 120 秒）。
- 不受影响的：审批时智能体正卡在「等审批」的调用里（approval-wait）→ 结果直接作为那次调用的返回值，立刻就到，不另发通知。

## 做法

**A. 照 655d1e0 改成「主人输入」**：`queue_decision_notice` 不再设闹钟，改为提交一条主人输入（`clientUserMessageId = approval-decision-<审批号>:<结果>`，策略 `auto`，离线时也送）。
- 好：和安全授权完全一样，Codex 下一步、Claude（新适配器）下一步。
- 坏：在对话里显示成**主人发的消息**（其实是 cutex 发的）；另外两个调用点在 Agent Bus 进程里（持有调用送不到时、孤儿审批的交接，`agent_bus/server.rs:1367`、`approvals.rs:233`），不能直接调 Management 的提交，需要一个持久的发件箱让 Management 来取。

**B. 留在闹钟通道，但给审批结果开例外（推荐）**：给这类系统通知一个单独的发送种类（如 `sender_kind = ApprovalNotice`，或「`cutex.approvals` 名下的系统通知」），把 `always_after_turn` 收窄为**只管你自己设的提醒**；审批结果当作「下一步候选、零等待」——和 Claude 后台任务结束通知今天的做法一样（`claude_task_wait` 返回 0，`claude_runtime.rs:912-920`）。
- 需要同时改：Codex 的闹钟投影接受 `soon`、Claude 入口校验接受 `soon`、管理端 `bus_admission_timing` / `afterTurnOnly` 显示。
- 好：显示仍是「cutex 系统通知」，不冒充主人；两个进程都能发（都已经能设系统通知）；重试、回执、去重全部沿用闹钟现有机制。
- 坏：动的是闹钟协议，要补两种运行时的测试。

**C. 顺手把另外两个也改成下一步**：主人通知的回复、主人唤醒从 `queue` 改成 `auto`（真是主人说的话，走主人输入没问题）。

## 建议

做 **B + C**。委托审核被拒的 120 秒等待暂不动（那是委托结果的统一节奏，另议）。

### 送达时机

| 智能体状态 | Codex | Claude（适配器有 `externalInputDeliveries: soon`） | Claude（旧适配器） |
|---|---|---|---|
| 空闲 | 立刻开一回合 | 立刻开一回合 | 立刻开一回合 |
| 忙 | **下一步**（ExternalInput `soon`，零等待） | **下一步**（零等待） | 回合结束后（和现在一样） |
| 离线 | 下次上线后第一件事 | 同左 | 同左 |

### 顺序

- 同一个智能体的多条审批结果按**决定的先后**送达（闹钟按 `at` 排，同一秒按创建顺序）；一次送达可以合并成一条「审批结果」消息，每条一行。
- 审批结果排在你**之后**设的普通提醒前面（提醒本来就要等回合结束）。
- 和这个智能体自己正在等的委托结果之间不强求顺序（各自独立送达）。

### 重复

- 每个审批每种结果只有一条通知：通知号 `<审批号>:<approved|denied>`，重复设置是空操作（现有，`approvals.rs:318`）。
- 同一审批先批准后撤销会是两条（号不同），按顺序都送到。
- 如果智能体是在「等审批」的调用里直接拿到结果的，不再另发通知（现有行为，保留）。
- 下一步送达中途断线 / 重启：沿用总线的冻结信封 + 回执对账，不会送两次；拿不准时宁可回合后再补一次，并在文字里写「（重发）」。

### 两种运行时一致

- 规则一样：忙 → 下一步、零等待；只有旧 Claude 适配器（没有 `soon`）退回回合后，并在审批列表里那条结果旁标「回合结束后送达（适配器较旧）」。
- 测试：在 `alarms_are_never_busy_wake_candidates_on_codex`、`alarms_stay_after_turn_on_busy_claude_agents` 旁边各加一条「审批结果是下一步候选、普通提醒仍是回合后」；`approvals.rs` 加「忙着的请求者在下一步收到结果，只收到一次」。

## 决定

待主人。

## 规则（采纳后）

1. 你**自己设的提醒**（闹钟）照旧只在回合结束后送达。
2. **审批结果**是 cutex 的系统通知，忙着的智能体在下一步读到，不额外等待；空闲就立刻送。
3. 主人通知的回复、主人唤醒按「主人输入」处理：忙时下一步插进去（和你直接打字一样）。
4. 每个审批每种结果最多送一次；在等审批的调用里已经拿到结果的，不再另发。

## 工作量（估计）

- B：cutex 约 1–1.5 天（发送种类 + 两种运行时的投影 / 校验 + 管理端显示 + 测试）。
- C：约 0.5 天（两处策略 + 改它们的测试）。
- 桌面：基本不用改；可选在审批列表的结果旁显示「已送达（下一步 / 回合后）」，0.5 天。
- 需要新的 Claude 适配器吗：不需要（复用已有的 `soon`）；旧适配器自动退回回合后。

## 待定问题（问主人）

1. 审批结果在对话里显示成「cutex 系统通知」（B）可以吗？还是希望和安全授权一样显示成「主人」（A）？
2. 主人通知的回复、主人唤醒（C）也要下一步插进去吗？它们是你亲手写的话，插进去会打断智能体正在想的东西。
3. 委托审核被拒目前要等 120 秒再送（委托结果的统一节奏），要不要也改成零等待？

## 链接

- 清单：`docs/research/polish-0.2-checklist.md` #31
- 安全授权：655d1e0，`docs/SAFETY-GRANTS.md`
- cutex：`src/management/v2/approvals.rs`（`queue_decision_notice`）、`src/agent_bus/alarms.rs`、`src/agent_bus/client.rs`（`send_local_alarm`）、`src/agent_bus/delivery.rs`（`always_after_turn`）、`src/app_server/bus_bridge_external.rs`、`src/app_server/bus_bridge.rs`、`src/cli_app/claude_busy_delivery.rs`、`src/cli_app/claude_runtime.rs`、`src/cli_app/claude_ingress.rs`、`src/management/v2/owner_notify.rs`、`src/management/v2/agent_bus_wake.rs`
- 文档：`docs/agent-tool-security.md`（审批通知「回合后」的说明要跟着改）、`docs/management/user-input-delivery.md`

## 主人决定（2026-10-22）：开工

Q1 审批结果显示为「cutex 系统通知」；Q2 主人通知的回复、主人唤醒也在下一步插入（和插话一样）；Q3 委托审核被拒改零等待。
