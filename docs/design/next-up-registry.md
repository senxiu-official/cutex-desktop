# 「接下来」固定状态表（Next Up registry）

Version 2.5. This registry defines the public state keys, labels, actions and disposal contract. Behavior changes are recorded with a version and bilingual wording.

## 〇、固定的状态 key

这些 key 只是程序用的标识，不是给人或 agent 看的文字：代码里每个 key 都要有注释，写明它是什么消息、正在发生什么、你能做什么、怎么离开。凡是给人或 agent 看的地方（帮助页、悬停提示、诊断信息、工具和 agent 读到的文字），都用白话解释，不直接甩 key。界面文字（zh-CN / en）是 key 的翻译；文字修改通过翻译表进行，不改变 key。

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
- 倒计时保持现在的界面样子，是附加在行末尾的项目，不是单独的状态；**不能替换按钮**。
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
- 智能体已暂停：继续这个{{agent}}（恢复整个 agent；1.8 加入，保持以前就有的入口；2.0 改名）
- 新委托已暂停：放行新委托（2.0 改名，原「继续」）
- 旧主机的暂停队列：继续 / 放回输入框 / 全部放弃（只在没有输入台账的旧主机上出现；「全部放弃」要确认；1.8 加入）

## 三之二、接下来里委托行的等待字样

处理者结束本轮、稍后自动继续的委托（主机提供 `continuationWait`），在「接下来」的委托行里只能显示下面这些字样（代码表 `NEXT_UP_DELEGATION_WAITS`）。它们都是既有的「等待中 · 约{时间}继续」的子形式，不是新状态，没有新按钮。

- 等待中 · 约{时间}继续（一小时内写「约 N 分钟后继续」，更晚写本地时间，别的日子带日期）
- 等待中 · 即将继续（到点了）
- 等待中 · 等子委托完成
- 等待中 · 等作业完成
- 等待中（没有时间）
- 等待继续（ready）

「续接已达上限」不在这里：只在委托卡片、委托列表里显示，归在「等待」一组（不算「需要你」）；「接下来」的委托行把它显示成「等待中」，悬停说明已到上限。待回答的提问、停止、关闭、已结束仍然优先于过期的等待（委托卡片、列表、接下来和处理者的输入框都一样）。等作业的委托如果还带着原来的时限，原有的「最晚 HH:MM」照旧接在后面，备注和准确时间在悬停里（不是新字样）。

## 三之三、留言送达情况的说明字样

支持便条投递诊断的主机报告留言卡在哪、在等什么、被哪条挡住。桌面只在既有的悬停、ⓘ 和详情里加说明行，再加几条操作后的提示（代码表 `lib/noteDeliveryMessages.ts`，键 `noteDelivery.*`）。**不是新状态，没有新标签，没有新按钮。**只在主机报告 `passive-note-diagnostics-v1` / `pre-turn-passive-notes-v1` / `agent-bus-read-notes-v1` 时出现，旧主机不变。

- 在等什么（`waitingFor` 的 16 个值各一句，未知的值写「在等：{code}」）；空闲对方的 `nextTurn` 写「等它下一轮读」，语气平和，不承诺送达时间。
- 现在在哪一段（消息总线 / 对方的收件箱 / 对方的上下文）及开始时间；被哪一条挡住（发送者 · 预览）；转换失败次数；上次尝试的时间（没出错也显示，已知的尝试类型写成文字）；上次出错。
- 这一轮带上 / 未确认带上的留言数（带上不等于已读；未确认的可能其实已带上），以及带留言时的整体错误。
- 「现在读取」：传所点的那几条；不支持、已不能这样读、结果不明时如实说明，不显示成已读。
- 「允许发送」仍只按后端给的按钮出现；所有者暂停 + 旧发送时机的行，悬停说明这次只解除暂停；记下了但重新投递失败时提示无需重复。
- 会话标题行：由委托结果或留言开始的一轮，文字从「正在读委托结果或留言 已占用 N 分钟」改为已有的「工作中」/ "Working"，来源和分钟数放进悬停。

同时答复的两点：

1. 「现在读取」仍只在对方空闲时出现（`notIdle` 规则不变）。
2. 委托开始的一轮（`turn.ask`，「正在做委托」+ 标题）不改。

2.3：交叉审查后的改动和缩短。

- 「未确认带上」保留不确定性：后端在提交响应丢失时也把留言放进 skipped，可能其实已带上。字样「{n} 条留言未确认带上，原因见各行」/ "{n} notes not confirmed carried; see each row"。
- 新增：带留言的整体错误「带留言出错：{errors}」/ "Carrying notes failed: {errors}"（悬停、详情，以及「现在读取」之后的提示）；上次尝试「上次尝试：{time}」「上次尝试（{kind}）：{time}」，类型「交给对方」「查对方的状态」「回合开始前带上」。去掉合并的「上次尝试 {time} 出错：{error}」，出错单独一行。
- 只缩短、意思不变：等待原因里的额度已满、旧发送时机、结果不明、转不成输入、运行时收不了、下次能读消息时、已完成；「现在读取」的三条提示；「允许发送」的两条提示；本轮来源。
- 新的错误分流只在有对应能力的主机上生效（读取类：`agent-bus-read-notes-v1`；放行 / 版本类：`passive-note-diagnostics-v1`），旧主机仍是原来的一条失败提示。

2.5：不能重发的说明。

- 后端在当前被挡住的记录上给 `details.deliveryDiagnostics.retryBlocked: true`，证明这条已是对方对话里的一项，所以没有「重试」。悬停 / 详情 / 待发消息区加一行「对方已收到，不能重发」/ "Already received; can't resend"（键 `noteDelivery.retryBlocked.timeline`）。只认这个标记，不从缺少的按钮推断。**不加状态、标签或按钮**；「重试」照原规则显示为不可用。

## 三之四、「打断并发送」带上同一回合的全部未读插话

打断一回合时，运行时会丢掉这一回合还没读到的所有插话。主机报告 `interrupt-send-many-v1`（cutex 0.2.5）时，既有的「打断并发送」一次带上同一回合里全部未读的所有者插话（被点的是排队中的消息时也带上它），按发送顺序，只打断一次，每条保留自己的身份。**不是新状态，不加标签，不加按钮。**

- 行上的「打断并发送」：要带上不止一条时，悬停提示改为「停下当前这一轮，马上发这 {n} 条插话」/ "Stop the current turn and send these {n} steers now"；只有一条时仍是原提示。
- Ctrl+Shift+Enter：未读插话排在草稿前面一起发。Esc（cli 预设）：有未读插话时打断并发送它们。
- 旧主机（没有这项能力）：行上仍只发被点的一条；Esc 只有一条未读插话时发它，多条时只停止（与以前一样）；分组入口在多条时说明「这台主机一次只能打断并发送一条插话，请在行上选」，不发送。
- 运行时版本还不支持时，后端在打断前拒绝；桌面说明「对方运行时还不能一次发多条插话，没有打断」，不改成逐条发送。
- 快捷键说明收窄为「主机支持时未读插话一起发」。

没发出去的批次：按记录本身的状态和 actions 显示，桌面不自己补按钮、不自动拆开逐条发。

- 对方正忙（`not_idle` / `pending_trigger_turn` / `plan_mode`）：整批留在 held{hostBusy}，由后端按序整批再发。详情说明「这批等对方空下来后一起发」（计划模式：「这批等对方退出计划模式后一起发」）。
- 确定没准入且停住（`history_unavailable` / `recovery_required` / `hook_blocked` 等，waiting{nativeHeld}，`details.interruptBatch.blocked`）：属于状态 11「需要你处理」。**动作映射：后端只对当前这次尝试、确定没发出且 blocked 的所有者消息在 actions 里给既有的「重新发送」（原 ID、手动、绝不自动）；状态 11 的所有者按钮里加入「重新发送」，只在 actions 给了时出现，不给就不显示（不出灰按钮）。**这时它的悬停改为「确定没发出过，用原消息再发一次」。详情说明原因：「读不到对方历史，这批未发出」「对方需先恢复，这批未发出」「被对方的钩子拦下，这批未发出」，其它写「这批未发出：{原因}」。
- 同批有成员已不在（`groupIncomplete`）：剩下的一次性停在 waiting{nativeHeld}，说明「同批有消息已不在，其余未发出，可逐条重发」，按 actions 手动重发。
- 没有「确定未发」标记的拒绝（可能已收下，`retryBlocked`）：保持「不知道对方收到没有」，后端不给重新发送，只能放弃；说明「可能已收下，不能重发，只能放弃」。
- Ctrl+Shift+Enter 遇到整批停住（`owner_batch_not_submitted`）时提示「这批未发出，原因见各行」。
- 这些说明只用后端对**当前这次尝试**、且状态对得上时给的证明（`interruptBatch.attempt` 等于记录的 attempt）。旧尝试留下的批次记录不算：手动重发后结果不明的行仍是原来的「不知道对方收到没有」和「可能收到两次」。
- 未读插话超过上限（行上 100 条，带草稿 99 条）时整次不发、不截断（同一次打断会让剩下的丢掉），提示「未读插话太多（超过 {max} 条），没有打断」。

## 四、审计查出、实现时一起修的 bug

1. 「等你审核」的委托在「接下来」里没有批准 / 拒绝按钮。
2. 有倒计时的行会把「放弃」按钮一起藏掉。
3. 「积压过久，等你放行」没有放行按钮。
4. 「重新发送」有时点了会被后端拒绝，或者停在没有出口的状态。
5. 你自己的排队消息在重连时按钮可能全部消失。
6. 桌面端的协议少了后端已有的两个状态，会露出原始代码。

## 五、每一行都必须能被处置

不要求一定送进模型，但每一行必须有合理的处置。规则（可自动测试）：

1. 每一行至少有一个**现在能点**的处置按钮（放弃、清除也算），这个按钮不依赖对方在线、对方继续干活、解除暂停或原文还在；或者
2. 有一个**不会续期的绝对期限**，到期后自动转成有处置按钮的状态（第 11 / 12 / 13 种）。

另外：处置一旦成功，这一行不会因为迟到的回执、重连、重启或重建账本再冒出来；按钮失败（忙、冲突、原文过期）后这一行仍然有处置按钮；同一批里处置一条，其余的仍可处置。

为此对按钮做的补充：
- 第 1 种：超过绝对期限仍未结束，转为第 12 种（送达未确认）。
- 第 7 种：加「放弃」。
- 第 13 种：失败的行不再 15 分钟后自动隐藏，一直留到你处置。
- 第 14 种：加「清除此提示」（本机持久记录，不声称撤回）。
- 所有「放弃」：对方忙时先记下你的决定，空出来立即执行，不再只回一句“稍后再试”。
- 面板控件「重置券」：加「收起」，不用券也能移走。

**主机支持 input-disposal-v1 时：** 所有「放弃」「忽略此通知」「放回输入框」都走只要输入编号的处置（任何状态、任何类型都能用，不再看这一行当时提供哪些操作）；第 1 种和第 14 种也加「放弃」；第 10 种仍以「拒绝」作为处置，不另加按钮。主机已经记下但还没执行完时，这一行的按钮变灰（沿用「正在处理」提示），桌面端会重新读取这一条，直到它执行完、这一行消失（不会自己再发一次处置）；不加新状态。

**行的身份：** 一行对应一次具体投递（occurrence），不是一个委托编号。同一个委托再次被打开、追加修订或重试，是新的一次投递，有自己的身份（关联原 askId），按现有状态正常进入「接下来」；你处置掉的那一次永远不会再出现。

**待读留言什么时候读：** 留言不会仅因进入队列就启动新一轮。主机在支持的消息读取点有界处理留言，阶段和回执只说明已经完成的部分，不承诺送达或已读时间。等待期间可以按主机提供的操作「现在读取」或「放弃」。


## 六、怎么保证以后不再冒出新东西

- 帮助里有一页「接下来里的状态」，列出全部状态、意思和按钮，由同一张代码表生成，不会和界面对不上；「接下来」标题旁有入口。

- 桌面端只保留一张代码表（`lib/inputLedger/nextUpRegistry.ts`），所有显示都只从这里取。
- 测试会对照后端实际发的全部状态：后端多了一个状态而表里没有，测试就失败，合不进去。
- 表一改，快照测试就失败，必须附上版本、日期和行为变更记录才能更新。

## 变更记录 / Change log

| Version | Date | Change |
|---|---|---|
| 1 | 2026-11-14 | Initial closed set of 14 row states and panel controls |
| 1.1 | 2026-11-14 | Countdown keeps its current look (a row-end add-on); it must be stable and never replace the buttons |
| 1.2 | 2026-11-14 | Alarms no longer always wait for the turn end (design mistake); they follow the same busy-wait as other messages (state 3 with countdown, then 4). Approval notices stay immediate. Backend change in the next kit |
| 1.3 | 2026-11-14 | State 3 label says both exits (free / time up); fixed variant without the time-up part only when wait is set to forever. Every state and its explanation is listed in the app Help, generated from the same code table |
| 1.4 | 2026-11-14 | Disposal guarantee (section 五): state 1 deadline to 12, Dismiss on 7, failed rows stay until handled, Clear on 14, durable dismiss intent when busy, Hide on reset credit. From audits EXITS A/B |
| 1.5 | 2026-11-14 | Fixed state keys (section 〇) and Send/Deliver/Read wording rule; short labels are the current translation, still being tuned by the owner |
| 1.6 | 2026-11-14 | passiveNote label 待读留言 / Unread note; info icon (ⓘ) on passiveNote, afterWork timed, unconfirmed, needsAction; hover explanation on every state |
| 1.7 | 2026-11-14 | Row identity is per occurrence (askId + occurrence); disposed occurrences never return; new occurrences use existing states. Passive-note read timing verified and documented |
| 1.8 | 2026-11-14 | Panel controls: agent-paused Resume (kept from before); legacy-host paused queue Resume / Move to composer / Dismiss all (legacy only, confirm) |
| 1.9 | 2026-11-14 | Host input-disposal-v1: every Dismiss / Ignore / Move to composer uses the id-only `cutex/input/dispose` (works in any state for any kind; never waits for the row's offered actions); states 1 and 14 also get Dismiss on such a host; state 10 keeps Reject as its disposal. A dispose accepted but not applied yet greys the row's buttons (existing "Working on it" reason) and the desktop re-reads the input until the row leaves (it never re-sends the dispose by itself); no new state. Row identity = the input id (the host's per-occurrence id, `askId::input-N`; occurrence 0 keeps askId); askId stays the delegation link |
| 2.0 | 2026-11-18 | State-surfaces N10 / W12, labels only, no new state or action. A delegation result that a stop does not hold (host stop-answer-admission-v1: the item says `eligible: true`, `held: null`) shows the row note 「停止后结果自动开新一轮」/ "Starts a new turn after the stop", hover 「停止不会扣住委托的结果：它到了就会开始新的一轮。提问和状态更新仍随停止暂停，继续发送时一起放行。」; the stop-held group uses that hover on such a host (older hosts keep 已随停止暂停 and its old hover). Panel controls renamed (W12): agent-paused Resume → 「继续这个{{agent}}」/ "Resume this {{agent}}"; asks-paused 继续 → 「放行新委托」/ "Release new delegations"; stop-hold 继续发送 unchanged |
| 2.1 | 2026-11-18 | Delegation rows in Next Up may show these yielded-wait words (continuationWait metadata; sub-forms of the approved 「等待中 · 约{时间}继续」): 等待中 · 约{时间}继续, 等待中 · 即将继续, 等待中 · 等子委托完成, 等待中 · 等作业完成, 等待中, 等待继续. 续接已达上限 stays on delegation cards / lists only (grouped with waiting); a Next Up row shows it as 等待中. A job await keeps its existing 最晚 HH:MM after the form (note and exact time on hover). Question / stop / close / finished win on every surface, the handler composer included. No new state or button |
| 2.2 | 2026-11-20 | Note-delivery wording (section 三之三; `lib/noteDeliveryMessages.ts`, zh-CN / en / zh-Hant): hover / ⓘ / details lines for waitingFor (16 values + unknown), stage and since, blocked-by row, projection failures, last error, carried / skipped notes; 现在读取 and 允许发送 notices (unsupported / unavailable / outcome unknown, pause-only, release recorded). Session line for a turn started by a result or note: 「正在读委托结果或留言 已占用 N 分钟」 → 「工作中」 / "Working", source and minutes in the tip. Capability-gated (passive-note-diagnostics-v1, pre-turn-passive-notes-v1, agent-bus-read-notes-v1). Answers: 现在读取 stays idle-only (notIdle unchanged); turn.ask unchanged. No new state, label or button |
| 2.3 | 2026-11-20 | Note-delivery wording after cross-review (section 三之三): skipped keeps uncertainty (「{n} 条留言未确认带上，原因见各行」 / "{n} notes not confirmed carried; see each row"); new reportErrors, lastAttempt / lastAttemptKind and three attempt kinds; lastErrorAt removed (error on its own line); version 2.2 lines shortened with the same meaning. New error routing only on hosts with the matching capability. No new state, label or button |
| 2.4 | 2026-11-20 | Section 三之四: on a host with `interrupt-send-many-v1` the existing 打断并发送 (row, Ctrl+Shift+Enter, cli Esc) takes every unread owner 插话 of the running turn along in send order, one interrupt, each under its own id; the row tip says 「停下当前这一轮，马上发这 {n} 条插话」 when n > 1. Older hosts keep the single-input action (cli Esc sends a lone unread 插话; several: stop only). Unsent batches (cutex 0.2.5) follow their records: busy → held{hostBusy}, the host resends the group; definitely unsent and blocked → state 11, where the owner buttons now include the existing Resend, shown only when the host's actions offer it (current attempt, original id, manual); groupIncomplete stops the rest once; unmarked refusals stay unconfirmed with Dismiss only. Short reason lines in hover / details. Over the limit (row 100, with a draft 99) the whole action is refused; batch words only for the current attempt. No new state, label or button |
| 2.5 | 2026-11-20 | Section 三之三 2.5: on a record with `details.deliveryDiagnostics.retryBlocked: true` (explicit retry-blocked metadata) one hover / details line 「对方已收到，不能重发」 / "Already received; can't resend" (`noteDelivery.retryBlocked.timeline`). Only the explicit marker counts. No new state, label or button |