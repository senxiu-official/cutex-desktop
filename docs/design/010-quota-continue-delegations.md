# 010 额度用完后，委托自己接着跑

状态：**实现中**（quota-continue-fix，10-21；cutex 41382bf 未部署，桌面改动未提交）。来源：主人 10-21 报告「Claude 智能体撞额度后没有自动回复」（host02 waveline-dev-fixes 等 4 个，profileElm，r246）。

## 问题

10:43 四个 waveline-dev-* Claude 智能体收到委托，第一次投递都撞上 Claude 额度（rate_limit）。cutex 已有「额度用完后自动继续」：把委托放回队列（显示受阻·额度），等额度重置后再投一次。实际情况：

1. **重置后没有自己继续。** 失败的回合会让 Claude 运行时关上「输入闸门」（失败 / 中断后要你先看一眼再继续）。cutex 在重置时发现「有委托要重投」，就不发自己的「继续」，但也没有打开闸门。重投被闸门挡回，变成「委托已暂停，等你恢复」。11:34–11:35 你逐个点了恢复，它们才跑起来（等了 4–20 分钟）。
2. **有两个在额度重置前就去试了。** 最先撞额度的两个智能体当时读不到重置时间，只能估计 30 分钟后试一次（11:14）。而同一账号的另外两个 10 秒后就读到了真实重置时间（11:30）。
3. **文字误导。** 失败原文是「the failed input is not automatically retried」（运行时本身确实不重试），但 cutex 会重投。
4. **委托卡片只写「受阻」**，不说是额度、也不说几点继续。

## 做法

- A：重置时，如果要重投的是委托，cutex 先把闸门打开（只开运行时自己关的闸门；你手动暂停 / 停止的不动），委托随后自己投出去。
- B：同一账号的智能体共用已知的重置时间：一个读到了，其他还在「估计」的跟着改；后来撞额度又读不到的，直接用它；估计的那次到点时，如果账号用量记录仍显示没恢复，就等到它写的重置时间。
- C：委托的错误文字后面加一句「cutex 会在额度重置后自动重投」（运行时的原文不改）。
- D：委托卡片第二行：「额度用完 · 约 HH:MM 自动继续」（时间来自 `GET /v2/quota-auto-continue`；还没有时间时写「额度用完 · 重置后自动继续」），不再标红「受阻」。

## 建议

全做（A 是这次的根因；B、C、D 都是小改动，减少「卡住了吗？」的疑问）。

## 决定

待主人确认（A–D 已按建议实现，未部署）。

## 规则

- 额度自动继续到点时：委托在等重投 → 打开运行时关的输入闸门，结束「运行时闸门」暂停（原因 `quotaReset`），不另发「继续」；你的暂停 / 停止优先，不动。
- 已经排队了「打开闸门」时，投递被闸门挡回不再变成暂停，5 秒后重试。
- 同一 Claude 账号的已知重置时间对该账号上所有在等的智能体生效；估计的试探不早于已知的重置。
- 因额度放回队列的委托，错误文字结尾注明会自动重投。
- 桌面：受阻原因是额度（`blocked(quota)`）时写「额度用完 · 约 HH:MM 自动继续」，语气为等待，不是错误。

## 链接

- cutex：`src/cli_app/claude_quota_continue.rs`（fire / schedule_after_failure）、`src/asks/control.rs`（`quota_reset_reopen`）、`src/asks/scheduler.rs`（`refuse_busy_attempt`）、`src/management/v2/quota_continue.rs`（共享重置时间）、`src/asks/observe.rs`（错误文字）。
- 桌面：`lib/delegations.ts`（`quota` 状态）、`components/DelegationCard.tsx`（`QuotaHoldLine`）、i18n `delegation.status.quota` / `quotaAt`。
- 证据：host02 `runtime/asks/asks-v1.json`（四个委托 attempt 1 10:43 失败，attempt 2 11:34:41–11:35:38）、`runtime/quota-continue/state-v1.json`（11:14:18 / 11:14:58 估计试探，11:30:50 / 11:31:53 真实重置，全部 `skipped asksRedelivered`）、各智能体 `management-events.jsonl`（10:43 到 11:35 之间没有任何投递）。
