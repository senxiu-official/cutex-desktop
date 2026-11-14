# 「接下来」固定状态表（Next Up registry）

Version 1.8. **Approved by the owner on 2026-11-14** ("可以用这14种"); merged by Director ctxE-Alice from two independent GPT audits (nextup-audit-a, nextup-audit-b). Any new state, label, button or action change needs approval from the owner or the Director, and an entry in the change log at the end of this file.

## 〇、固定的状态 key（v1.5，主人 2026-11-14 确定；文字可以改，key 不改）

这些 key 只是程序用的标识，不是给人或 agent 看的文字：代码里每个 key 都要有注释，写明它是什么消息、正在发生什么、你能做什么、怎么离开。凡是给人或 agent 看的地方（帮助页、悬停提示、诊断信息、工具和 agent 读到的文字），都用白话解释，不直接甩 key。界面文字（zh-CN / en）是 key 的翻译，主人还在推敲；改文字只改翻译表，不动 key。

**用词规则：** Send / 发送 = 消息还在我们这边，或正在交出；Deliver / 送达 = 已到对方、未读；Read / 读取 = 对方读进去了（读进去即离开「接下来」）。

| # | key | 当前文字 zh-CN | 当前文字 en |
|---|---|---|---|
| 1 | `sending` | 正在发送 | Sending |
| 2 | `queued` | 排队中 | Queued |
| 3 | `afterWork`（variant `timed`） | {time} 内发送 ⓘ | Sends within {time} ⓘ |
| 3′ | `afterWork`（variant `untimed`） | 本回合后发送 | Sends after this turn |
| 4 | `awaitingRead` | 已送达，待读取 | Delivered, unread |
| 5 | `passiveNote` | 待读留言 ⓘ | Unread note ⓘ |
| 6 | `held` | 已暂缓发送 | Held |
| 7 | `paused` | 暂停中，未发送 | Paused, not sent |
| 8 | `awaitingOnline` | 上线后发送 | Sends when online |
| 9 | `awaitingReconnect` | 重连后发送 | Sends after reconnect |
| 10 | `review` | 等你审核 | Awaiting your review |
| 11 | `needsAction` | 需要你处理 | Needs your action |
| 12 | `unconfirmed` | 送达未确认 | Delivery unconfirmed |
| 13 | `failed` | 发送失败 | Send failed |
| 14 | `unknown` | 状态无法识别 | Unknown status |

**提示规则（1.6）：** 每种状态悬停在文字上都显示白话解释（第一节的含义说明）。只有容易误解的状态额外带一个 ⓘ 图标，点开或悬停看完整说明：`passiveNote`（写明什么时候会被读：对方忙时在下一步读到，空闲时等它下次工作）、`afterWork` timed（忙完就发，最迟到点插入）、`unconfirmed`（重发可能让对方收到两次）、`needsAction`（为什么卡住、你能做什么）。其他状态不加图标，避免满屏图标。

下面第一节表格里的长文字是含义说明（用于悬停提示和帮助页），不是状态栏文字。

## 一、每一行只会是下面 14 种之一

| # | 显示（中文） | English | 什么时候出现 | 按钮 |
|---|---|---|---|---|
| 1 | 正在发送 | Sending | 消息正在往 agent 那边送 | 无 |
| 2 | 排队等待 | Queued | 前面还有别的消息，或在等几条结果合并一起送 | 你的消息：插话 / 立即发送 / 编辑 / 删除；别人的消息：暂缓这条 / 放弃 / 查看委托 |
| 3 | 忙完或到点后送达（有倒计时）／忙完后送达（设为一直等时） | Sends when free or when time is up / Sends when free | 对方正在干活：干完就送；行末倒计时先到，就在它下一次调用工具的间隙插进去（转为第 4 种） | 暂缓这条 / 放弃 / 查看委托；你的消息多一个：打断并发送 |
| 4 | 等待读取 | Waiting to be read | 已经送到，对方还没读进去 | 放弃 / 查看委托；你的消息多一个：打断并发送 |
| 5 | 下次工作时读取 | Read during next work | 留言类消息，不会主动叫醒对方 | 现在读取 / 放弃 |
| 6 | 已暂缓 | On hold | 你点了「暂缓这条」 | 允许发送 / 放弃 |
| 7 | 已暂停 | Paused | 这个 agent 被暂停了 | 继续 / 查看详情 |
| 8 | 等待上线后发送 | Send when online | 对方离线 | 启动（能启动时）/ 放弃 / 查看委托 |
| 9 | 等待重新连接 | Waiting to reconnect | 连接断了，会自动恢复 | 查看原因 / 放弃 |
| 10 | 等你审核 | Awaiting your review | 委托需要你批准才能开始 | 批准 / 拒绝 / 查看委托 |
| 11 | 需要你处理 | Needs your action | 卡住了，不会自己好（积压太久、对方不支持、版本不对等） | 允许发送（能放行时）/ 查看原因 / 放弃 |
| 12 | 送达未确认 | Delivery not confirmed | 不知道对方收到没有 | 重新发送（会提示「可能收到两次」）/ 放弃 / 查看原因 |
| 13 | 发送失败 | Could not send | 确定没送到 | 重新发送 / 放回输入框 / 放弃 / 查看原因 |
| 14 | 状态无法识别，消息已保留 | Status unknown; message kept | 后端发来这张表里没有的状态 | 刷新状态 / 查看详情 |

补充规则：
- 倒计时保持现在的界面样子（主人 2026-11-14：满意，前提是稳定），是附加在行末尾的项目，不是单独的状态；**不能替换按钮**。
- 某个按钮当下不能用时，显示成灰的并说明原因，不会悄悄消失。
- 已读、已放弃、已被替代的消息直接离开「接下来」，不留空行。

## 二、以后不再出现的字

对方正忙 · 主机正忙 · 等待插入时机 · 合并结果（像按钮，其实只是在等） · 已接收 · 已登记 · 积压过久等你放行（改为第 11 种，并且真有放行按钮）。

## 三、不是消息、但也放在面板里的固定控件（同样登记，不能随意加）

- 已安排稍后继续：取消本次继续
- 重置券：用一张（保留原来的确认）
- 批准通知等待送达：只显示，不吞掉「放弃」
- 清理所有未确认：会写明包括时间线里的
- 释放占用：要点两次确认
- 智能体已暂停：继续（恢复整个 agent；1.8 加入，保持以前就有的入口）
- 旧主机的暂停队列：继续 / 放回输入框 / 全部放弃（只在没有输入台账的旧主机上出现；「全部放弃」要确认；1.8 加入）

## 四、审计查出、实现时一起修的 bug

1. 「等你审核」的委托在「接下来」里没有批准 / 拒绝按钮。
2. 有倒计时的行会把「放弃」按钮一起藏掉。
3. 「积压过久，等你放行」没有放行按钮。
4. 「重新发送」有时点了会被后端拒绝，或者停在没有出口的状态。
5. 你自己的排队消息在重连时按钮可能全部消失。
6. 桌面端的协议少了后端已有的两个状态，会露出原始代码。

## 五、每一行都必须能被处置（主人 2026-11-14）

不要求一定送进模型，但每一行必须有合理的处置。规则（可自动测试）：

1. 每一行至少有一个**现在能点**的处置按钮（放弃、清除也算），这个按钮不依赖对方在线、对方继续干活、解除暂停或原文还在；或者
2. 有一个**不会续期的绝对期限**，到期后自动转成有处置按钮的状态（第 11 / 12 / 13 种）。

另外：处置一旦成功，这一行不会因为迟到的回执、重连、重启或重建账本再冒出来；按钮失败（忙、冲突、原文过期）后这一行仍然有处置按钮；同一批里处置一条，其余的仍可处置。

为此对按钮做的补充（Director 批准，1.4）：
- 第 1 种：超过绝对期限仍未结束，转为第 12 种（送达未确认）。
- 第 7 种：加「放弃」。
- 第 13 种：失败的行不再 15 分钟后自动隐藏，一直留到你处置。
- 第 14 种：加「清除此提示」（本机持久记录，不声称撤回）。
- 所有「放弃」：对方忙时先记下你的决定，空出来立即执行，不再只回一句“稍后再试”。
- 面板控件「重置券」：加「收起」，不用券也能移走。

**主机支持 input-disposal-v1 时（1.9，Director ctxE-Alice）：** 所有「放弃」「忽略此通知」「放回输入框」都走只要输入编号的处置（任何状态、任何类型都能用，不再看这一行当时提供哪些操作）；第 1 种和第 14 种也加「放弃」；第 10 种仍以「拒绝」作为处置，不另加按钮。主机已经记下但还没执行完时，这一行的按钮变灰（沿用「正在处理」提示），桌面端会重新读取这一条，直到它执行完、这一行消失（不会自己再发一次处置）；不加新状态。

**行的身份（1.7，Director）：** 一行对应一次具体投递（occurrence），不是一个委托编号。同一个委托再次被打开、追加修订或重试，是新的一次投递，有自己的身份（关联原 askId），按现有状态正常进入「接下来」；你处置掉的那一次永远不会再出现。

**待读留言什么时候读（核实于 2026-11-14）：** 留言不会叫醒对方，也不会自己开新一回合。对方正在工作时，会在它下一次思考（模型请求）前读到；工具调完后写最终回复通常也算一次，所以多半在本回合就读了。只有本回合恰好没有下一次思考时，留言才会留到对方下次开工，这期间一直显示「待读留言」，可以点「现在读取」或「放弃」。

## 六、怎么保证以后不再冒出新东西

- 帮助里有一页「接下来里的状态」，列出全部状态、意思和按钮，由同一张代码表生成，不会和界面对不上；「接下来」标题旁有入口。

- 桌面端只保留一张代码表（`lib/inputLedger/nextUpRegistry.ts`），所有显示都只从这里取。
- 测试会对照后端实际发的全部状态：后端多了一个状态而表里没有，测试就失败，合不进去。
- 表一改，快照测试就失败，必须附上批准记录（谁、哪天、为什么）才能更新。

## 变更记录 / Change log

| Version | Date | Approved by | Change |
|---|---|---|---|
| 1 | 2026-11-14 | owner | Initial closed set of 14 row states and panel controls |
| 1.1 | 2026-11-14 | owner | Countdown keeps its current look (a row-end add-on); it must be stable and never replace the buttons |
| 1.2 | 2026-11-14 | owner | Alarms no longer always wait for the turn end (design mistake); they follow the same busy-wait as other messages (state 3 with countdown, then 4). Approval notices stay immediate. Backend change in the next kit |
| 1.3 | 2026-11-14 | owner | State 3 label says both exits (free / time up); fixed variant without the time-up part only when wait is set to forever. Every state and its explanation is listed in the app Help, generated from the same code table |
| 1.4 | 2026-11-14 | Director (per owner requirement) | Disposal guarantee (section 五): state 1 deadline to 12, Dismiss on 7, failed rows stay until handled, Clear on 14, durable dismiss intent when busy, Hide on reset credit. From audits EXITS A/B |
| 1.5 | 2026-11-14 | owner | Fixed state keys (section 〇) and Send/Deliver/Read wording rule; short labels are the current translation, still being tuned by the owner |
| 1.6 | 2026-11-14 | owner (labels) / Director (icon set) | passiveNote label 待读留言 / Unread note; info icon (ⓘ) on passiveNote, afterWork timed, unconfirmed, needsAction; hover explanation on every state |
| 1.7 | 2026-11-14 | Director | Row identity is per occurrence (askId + occurrence); disposed occurrences never return; new occurrences use existing states. Passive-note read timing verified and documented |
| 1.8 | 2026-11-14 | Director | Panel controls: agent-paused Resume (kept from before); legacy-host paused queue Resume / Move to composer / Dismiss all (legacy only, confirm) |
| 1.9 | 2026-11-14 | Director (ctxE-Alice) | Host input-disposal-v1: every Dismiss / Ignore / Move to composer uses the id-only `cutex/input/dispose` (works in any state for any kind; never waits for the row's offered actions); states 1 and 14 also get Dismiss on such a host; state 10 keeps Reject as its disposal. A dispose accepted but not applied yet greys the row's buttons (existing "Working on it" reason) and the desktop re-reads the input until the row leaves (it never re-sends the dispose by itself); no new state. Row identity = the input id (the host's per-occurrence id, `askId::input-N`; occurrence 0 keeps askId); askId stays the delegation link |
