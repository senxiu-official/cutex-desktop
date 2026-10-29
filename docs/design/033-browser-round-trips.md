# 033 浏览器任务的模型往返

状态：**(b)(c) 已实现**（cutex `feat/browser-round-trips` 77c68c0，未推送，待并入 r250）；**(a) 只是方案，待主人决定**。
来源：cutex-setting-UI-2@host02 的 A/B（2026-10-22，remote；报告 `host02:D:\Work\settings-shots\reports\ab-browser-20261022.md`，
复现材料 `remote:~/ab-test/`）。

## 问题

同一个浏览器任务（JS 渲染、3 页 18 本书的书店，筛 7 本写 `report.json` + 脚本 + 测试），gpt-6-astra medium：

| | Codex Desktop | cutex |
|---|---|---|
| 用时 | 65.8 s | 187 s |
| 模型请求 | 12 | 50 |
| 每次请求 | 5.5 s | 3.7 s |
| 总输入（缓存命中） | 0.49M（90%） | 2.06M（97%） |
| 工具 | exec×3, js×8 | browser_navigate×20, browser_read×22, open / act / list 各 1, exec×4 |

cutex 每次请求更快，慢在**次数**。Codex 的浏览器是可脚本的 Playwright REPL：一次 `js` 循环看完所有详情页。
cutex 每页都是 `browser_navigate` 一次、`browser_read` 一次，每次都要再走一轮模型。

## 为什么 cutex 的工具是 direct-only（查清）

cutex 启动 cute-codex 时传
`features.code_mode.direct_only_tool_namespaces = ["mcp__cutex"]`（`src/cli_app/stock_lifecycle.rs`，
最早见于 1f039dc「stock launch」，2026-09-09；`docs/reviewed-job-mcp-launch.md`：「The existing Cutex control namespace
remains direct-only」）。

在 cute-codex 里这个设置做三件事（`codex-rs/features/src/feature_configs.rs`、`core/src/tools/spec_plan.rs`）：
1. 这些工具**不进 tool_search 延迟加载**：模型永远直接看得到它们；
2. code-mode-only 的模型下它们**仍然是顶层工具**，不会只藏在 `exec` 里；
3. 它们**不出现在 code mode 的嵌套工具面**里，所以 `exec` 脚本调不到。

cutex 这样做的原因：
- **控制工具要始终看得见、直接调用。** 包括委托、消息、owner_notify、审批等待、闹钟和 Agent Management。
  模型在 code-mode-only 的模型上也必须能直接调用它们。
- **幂等是按回合算的。** 没给 `action_id` 时，facade 用（runtime、代数、线程、**回合**、工具、参数）推出它
  （`agent_bus/mcp.rs` `derive_action_id`）。同一回合里两次一样的调用就是一次重放。脚本循环里重复调用
  `agent_delegate` / `alarm_set` 会被当成重放，这是对的语义，但不是脚本作者想要的。
- **审批和租约是 cutex 自己机械执行的**（cutex 的 MCP 默认 `approve`：原生不弹审批，由 cutex 判断）。
  只有让每个有后果的调用都是模型亲自、单独发出的，「不自动重放结果未知的操作」「一次有意的动作后先观察」这些纪律才成立
  （见浏览器工具说明里的 DISCIPLINE）。

只读的部分并不依赖这些：
- 嵌套调用在原生里走同一个处理函数（`ToolCallSource::CodeMode`）；
- 照样产生 `McpToolCall` 条目，主人在对话和浏览器时间线里看得到；
- 浏览器请求 id 按调用算（`mcp_browser::request_id`），不按回合。

## 方案（按收益排序）

### (a) 只读浏览器工具进 code mode（待主人决定，未实现）

**做法**
- 另开一个 MCP 命名空间（例如 `cutex_browser`），由同一个 facade 进程以同一份代理凭据提供，只放只读工具：
  `browser_list` / `browser_read` / `browser_find` / `browser_screenshot`，可能再加 `browser_navigate` / `browser_open`。
- 这个命名空间不放进 `direct_only_tool_namespaces`。
- `mcp__cutex` 其余的工具（含 `browser_act`、`browser_claim`、`browser_release`）保持 direct-only。

**安全分析**
- **不受影响**：
  - 每个嵌套调用仍是一条 `/v2/browser/commands`，桌面主进程照样按标签页 + 源站准入；
  - N2 出口代理、端口黑名单、LAN / tailnet 只能主人输入的规则都在桌面主进程，与谁发起调用无关；
  - 租约与「交给智能体」的标签授权 UI 不变；
  - 主人仍能看到每个调用条目。
- **会变弱的两点**：
  1. **页面内容可以驱动导航，而模型看不到中间内容。**
     - 只读的 list / read / find / screenshot 本身不产生新的网络请求，风险很小。
     - 一旦 navigate / open 也进 code mode，脚本就能读一页、从（不可信的）页面里取 URL，再导航过去。
     - 这能力模型本来就有，但现在没有每一步的模型判断，就不再受「页面内容是不可信数据」这条纪律约束。
     - 在允许外网时，这就是一条把数据带到查询串里发出去的路径。
  2. **结果未知的步骤可能被脚本自动重试。**
     - 脚本可以对 `outcome_unknown` 自动重试，违反「不自动重放」的规则；
     - 对只读的 read / find 无害，对 navigate 有害。
- **结论**：只放 list / read / find / screenshot 是干净的，但对这个 A/B 几乎没帮助，因为瓶颈正是每页的 navigate。
  navigate / open 进 code mode 能达到 Codex 的速度，但削弱上面两点。所以这里只作为方案；要做的话，至少：
  - 只在主人关掉「允许浏览外部网页」时开放（只剩 loopback / `cutex:service`），或单独开一个配置开关；
  - 每回合给嵌套导航设上限（例如 30 次）；
  - 嵌套调用遇到 `outcome_unknown` 时，cutex 拒绝同一回合里再导航，直到模型自己读到结果。

### (b) 跳转 / 打开时顺带返回快照（已实现）

- `browser_navigate` / `browser_open` 新增可选 `snapshot: true`。
- 结果 = 原来的导航结果 + 一次 `browser_read`（同一标签；`open` 用新建标签的 guestId）。
- 读快照用从外层调用推出的请求 id，同一外层调用重发时是重放，不会重复执行。
- 读失败时保留导航结果，并附注「请调用 browser_read」。
- `snapshot` 只在 facade 里存在，发出前去掉。Management 的线上校验不认这个字段。

### (c) 批量访问 `browser_visit`（已实现）

- `browser_visit {title, guestId, urls[1..10]}`：在同一租用标签里依次导航到每个 URL 并读取。
- 快照共用 128 KiB，平均分；超出的截断并标 `truncated`。
- 遇到第一个失败就停。已读到的页照样返回（`complete: false`）；一页都没成功才算错误。
- 每次导航都会让上一页的 refs 失效，所以只有最后一页的 refs 可用（结果里写明）。
- **是 facade 组合出来的**：每一步都是普通的线上命令，各有自己的请求 id。准入、N2、审批、租约逐步生效。
  Management 和桌面看不到新命令：`WIRE_TOOLS` 仍是原来 9 个，`browser_visit` 会被 Management 的校验拒绝。
- 每个 URL 都经过和 `browser_navigate` 一样的格式检查（不能带用户名 / 密码，只能 http(s)、about:blank、
  `cutex:service/`）。
- 注解 `readOnlyHint: false`：它会导航，不是只读工具。

## 对这个 A/B 的估算

cutex 那次：50 次请求，其中浏览器 45 次（navigate×20 + read×22 两两成对）。每次请求约 3.7 s。

| | 请求数 | 用时（估） | 总输入（估） |
|---|---|---|---|
| 现在 | 50 | 187 s | 2.06M |
| (b) navigate / open 带快照 | ~29 | ~110 s | ~1.0M |
| (c) `browser_visit`：列表 3 页一次、18 本详情两次（10 + 8） | ~10–12 | ~45–60 s（含约 18 次页面加载） | ~0.4–0.6M |
| (a) 含 navigate 的 code mode | ~10 | ~60 s | ~0.5M |

总输入的估算方法：每次请求都重发全部上下文，所以总输入大约随请求数的平方增长。
(c) 的单次结果更大，但只进上下文一次。

## 复测（主人）

A/B 需要接着桌面的浏览器（智能体的浏览器由连接到该主机的桌面提供），所以不能放进无头的临时实例。
等 (b)(c) 进了 remote 上运行的版本（r250）后：
1. 在 remote：`bash ~/ab-test/reset2.sh`（或按 HANDOFF.md 清空 `~/ab-test/runs/cutex`），确认书店服务在 `127.0.0.1:24480`。
2. 桌面新建一个 Codex 智能体：gpt-6-astra、medium、工作目录 `~/ab-test/runs/cutex`、打开浏览器工具。
   把 `HANDOFF.md` 的内容发给它，并加一句「可以用 browser_visit 一次读多页」。
3. 结束后：`node ~/ab-test/check.mjs`，以及
   `node ~/ab-test/measure.mjs cutex=<该智能体的 rollout>`（rollout 在 `~/.cutex/runtime/light/agents/<id>/sessions/`）。
4. 对照上表。

## 决定

- (b)(c)：已实现，随 r250。
- (a)：待主人决定。是否开放、只读四个还是含导航、开在什么条件下。
