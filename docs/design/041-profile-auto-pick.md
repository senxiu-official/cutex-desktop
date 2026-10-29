# 041 新建智能体时自动挑账号（订阅 Profile 的简单均衡）

状态：**设计定稿**（主人 2026-10-23 决定做，见 §5「主人的决定」）。P0 + P1 已在 cutex 分支
`feat/profile-auto-pick`（基于 RC 头 `9292dd2`，提交 `50bc494`，不进 RC1，可进 RC2）实现；P2（桌面）、P3 未做。

主人 2026-10-23 的想法：给**订阅** Profile 做一个简单的均衡——
**不是**中转 / 反向代理，**从不**给正在进行的对话换账号；只在**新建**智能体（或替换一个撞墙的成员）时，
按各账号的额度曲线挑余量最好的那个。今天这件事由组长手工做（Claude：profileElm / profileDawn / Ceobe；GLM：profileGlen / Zooey）。

一句话：**人（或组长）总是先选服务商；cutex 只在这个服务商自己的订阅账号里自动挑——
`profile: "auto:anthropic"` 这样，按「多久会撞墙」打分，挑最晚撞墙的；挑中谁、为什么，写在结果里；
桌面「新建智能体」先选服务商，账号默认「自动」并显示推荐，可以改成具体账号。从不跨服务商自动挑。**
（主人 2026-10-23 更正：不是一个笼统的 `auto`，是「按服务商的 auto」。）

## 1. 记什么（基本都已经有了）

cutex 今天已经在记，不用新加采集：

- **额度表**：`GET /v2/profiles/{p}/quota` 给每个账号的表（`gauges[]`：`remainingPercent`、`resetAt`、`windowLabel`
  如 `5h` / `week`、`observedAt`）。来源三种：
  - Claude 订阅：`profile_quota_claude.rs`（5h / 7d 两个窗口）；
  - ChatGPT 登录（Codex）：原生 `account/rateLimits`（`profile_quota_native.rs`）；
  - GLM 编程套餐等 HTTP 读取器：`profiles/quota.rs`（智谱 `zhipu_coding_plan` 有 5h + 周）。
- **后台刷新**：守护进程的额度刷新线程（`profile_quota_native.rs` `start_refresher`，每 60 s 看一次谁到期），
  间隔是设置 `profileQuotaRefreshMinutes`，**默认 5 分钟**（`profiles/model.rs:598`），失败退避。
- **曲线**：每次读到额度表都会顺手记一笔（`usage/quota_history.rs`），同一个表**最多 15 分钟一笔**
  （`SNAPSHOT_INTERVAL_SECS`），写在 `runtime/management-v2/usage-quota-history/YYYY-MM.jsonl`，
  已有接口 `GET /v2/usage/quota-history`。

要补的只有两点：

- **保留期**：原来按月分文件、**从不清理**。估算：一个表一天最多 96 行 × 约 250 字节 ≈ 24 KB；
  10 个账号 × 2 个窗口 ≈ 每月 15 MB。**主人决定（2026-10-23）：全部保留，不清理**（第一版做过的 90 天清理已经去掉，cutex `7403d06`）。
  所有读取都只打开需要的月份文件：自动选择和记录节流只读最新两个月，`GET /v2/usage/quota-history` 只读所问的月份（最多 366 天），
  所以旧月份只占磁盘、不占时间（host02 调试版实测：每次预览 2 个月 436 ms，24 个月 440 ms）。文件格式和 r250 一样，没有迁移。
  以后如果磁盘吃紧，可以考虑把旧月份**无损**压缩（例如 gzip）——只是建议，不删任何记录。
- **刷新成本**：参与自动挑选的账号要一直有新数据（≤ 5 分钟）。每个账号每 5 分钟一次额度请求 ≈ 每天 288 次，
  请求本身是只读查询、不耗额度。**创建时**先用缓存的额度表；某个已打开开关的账号最近 15 分钟没有读成功过，
  就当场**强制再读一次**（最多每个候选一次请求）；预览接口只用缓存，不发请求。

## 2. 怎么挑

### 候选

- **本机**的 Profile，打开了「参与自动选择」（新开关，**默认关**，见 §4 第 4 条）；
- **请求里点名的那个服务商**：Profile 的 `providerFamily`（cutex 已有：`profiles/providers.rs:458`
  `provider_family`，Profile 接口里也有这个字段）等于请求的服务商，例如 `anthropic`、`openai-chatgpt`、`zhipu`、
  `kimi-code`。**只在这一家里挑，绝不跨家**——和现有「中途换账号」不许跨家的规则一致
  （`profile_switch.rs` `provider_family_mismatch`）；
- **订阅账号**：只挑按订阅额度计费的 Profile（Claude 订阅登录、ChatGPT 登录、GLM / Kimi 编程套餐这类有 5h / 周窗口的）；
  按量付费的 API key 账号不参与（同一家的 Claude API key 不算）；
- 请求的模型在这个 Profile 的模型列表里（没指定模型时用 Profile 默认）——**P1 没做这一条**：同一家的账号模型列表
  基本一样，挑中后启动前的检查照旧会拒绝不支持的模型；
- 不要求审批（`agentUseRequiresApproval` 为真的不自动选）、凭据可用、额度表最近 15 分钟内读成功过。

实现里没进候选的账号写在结果的 `excluded[]` 里，原因是：`not_opted_in`（没打开开关）、`requires_approval`、
`no_subscription_windows`（没有订阅窗口，例如按量付费的 API key、Claude API 账号）、`quota_stale`（15 分钟内没读到）、
`quota_read_failed`。

### 打分：多久撞墙

每个候选、每个窗口 w（5h、周……）：

- `r` = 剩余百分比；`t` = 离重置还有几小时；
- `b` = 这个账号**最近的消耗速度**（每小时消耗窗口的百分之几）：取同一重置周期内最近 60 分钟的曲线斜率
  （15 分钟一笔 ≈ 4 个点）；点不够时用「在用的智能体数 × 每个智能体的预计消耗」；
- `e` = **新智能体的预计消耗**：第一版用一张按模型 + 推理强度的固定表，第二版（P3）从用量账本学。
  P1 的表（每小时占窗口的百分之几）：
  - 基数（大模型、高强度）：≤ 24 h 的窗口 **12**，≤ 8 天（周）**1**，更长 **0.3**；窗口长度从 `5h` / `7d` / `week` 这类标签读，
    读不出时按短窗口算（偏保守）；
  - 模型系数：名字含 `opus` 为 1；含 `haiku` / `mini` / `flash` / `air` / `nano` 为 0.25；其余（含没指定模型）0.6；
  - 强度系数：`low` / `minimal` / `none` 0.5，`medium` 0.75，`high` 或没指定 1，`xhigh` / `max` 1.3。
  - 「可在设置里改」留到 P3，P1 没有这个设置；
- `b` 的细节：同一个表、同一重置周期（两次读到的重置时间相差 ≤ 10 分钟）在最近 60 分钟里的点，加上这次读数，
  跨度 ≥ 10 分钟才算斜率；余量变多（加购、重置）时按 0 算；
- 撞墙时间 `T_w`：
  - 如果 `r / (b + e) < t`：在重置前就会用完，`T_w = r / (b + e)`；
  - 否则这个窗口先重置，满额后再算一轮：`T_w = t + 100 / (b + e)`。
- 账号的分数 = **最先撞墙的那个窗口**的 `T = min_w T_w`（封顶 24 小时）。

规则：

1. **余量门槛**：`T < 1 小时` 的账号视为「快撞墙」，不选。都快撞墙时，选**最早重置**的那个，
   并在结果里写明「所有账号都快到顶」。
2. 选 `T` 最大的。
3. **平手**（差距在 10% 以内）：选**当前在用的智能体少**的；再平手按名字排，保证结果稳定。

### 例子

新建一个 Opus / 高强度的 Claude 智能体，`profile: "auto:anthropic"`，候选是三个 Claude 订阅账号
（GLM 的 profileGlen / Zooey 不是这一家，不参与）。固定表给 `e`：5h 窗口每小时 12%，周窗口每小时 1%。

| 账号 | 5h 剩 / 重置 | 5h 速度 b | 周剩 / 重置 | 周速度 b | 5h 撞墙 | 周撞墙 | 分数 T |
|---|---|---|---|---|---|---|---|
| profileElm | 62% / 3 h | 10 %/h | 40% / 4 天 | 0.8 %/h | 62/22 = **2.8 h**（重置前撞） | 40/1.8 = 22 h | **2.8 h** |
| profileDawn | 85% / 4.5 h | 5 %/h | 12% / 2 天 | 0.5 %/h | 85/17 = 5.0 h > 4.5 → 4.5 + 100/17 = 10.4 h | 12/1.5 = **8 h** | **8 h** |
| Ceobe | 20% / 0.5 h | 25 %/h | 70% / 5 天 | 1.5 %/h | 20/37 = 0.54 h > 0.5 → 0.5 + 100/37 = **3.2 h** | 70/2.5 = 28 h | **3.2 h** |

- 三个都过了 1 小时门槛。
- **选 profileDawn**（8 h）。只看「5h 剩多少」会选错：profileDawn 5h 剩最多，但真正卡它的是**周**额度只剩 12%；
  profileElm 5h 还剩 62%，可是按现在的速度加一个新智能体，不到 3 小时就会撞墙。
- 桌面显示：「自动（推荐 profileDawn：周额度剩 12%，约 8 小时后到顶）」。

## 3. 用在哪里

### cutex

- `agent_create`、`member_replace` 的 `successor`、`POST /v2/human/agents`：`profile: "auto:<服务商>"`，
  例如 `"auto:anthropic"`、`"auto:zhipu"`。服务商就是 `providerFamily` 的值；另外认几个常用叫法：
  `auto:claude` = `anthropic`，`auto:chatgpt` / `auto:codex` = `openai-chatgpt`，`auto:glm` / `auto:zai` = `zhipu`。
  **必须带服务商**；单独的 `"auto"` 拒绝。错误码（Human 接口的 HTTP 状态在括号里）：
  - `provider_required`（400）：单独的 `auto`，说明里列出本机有打开开关账号的 `auto:<服务商>`；
  - `unknown_provider`（400）：本机没有这一家的 Profile；
  - `no_auto_pick_candidate`（409）：这一家没有能挑的账号，说明里列出每个账号没进候选的原因；
  - `auto_pick_unavailable`（409）：本机已有叫 `auto` / `auto:…` 的 Profile（见 §6 回退）。
  - **为什么用一个字符串而不是 `{provider, profile: "auto"}` 两个字段**：`SparseAgentSpec` 和
    `POST /v2/human/agents` 的请求体都是 `deny_unknown_fields`，加字段旧版本会整个拒绝；更要紧的是下面说的
    持久化记录。字符串放在现有的 `profile` 字段里，结构不变。代价是要**保留 `auto:` 前缀**（见 §6 P0）。
    想要两个字段的话也能做，同样安全（旧版本因未知字段拒绝），只是多改两处结构。
  - 组长不点名服务商时（sparse 请求省略 `profile` 会继承调用者的账号）照旧继承，**不会**自动挑。
  - cutex 在**创建时**挑，把挑中的**具体账号名**写进智能体记录和动作记录——之后和手选的账号没有任何区别。
  - 结果里多一段说明（Human 接口的响应里叫 `profilePick`，智能体工具的回执里是 `result.profile_pick`，内容相同）：
    `{requested, provider, picked, pickedId, rule, reason, model, effort, candidates: [{profile, profileId, hours,
    bindingWindow, remainingPercent, resetAt, activeAgents, burnPerHour, burnSource}], excluded: [{profile, reason}], at}`。
    `rule` 是 `latest_wall`（撞墙最晚）、`tie_fewer_agents`、`tie_name`、`only_candidate`、`all_near_wall_soonest_reset`；
    `reason` 是一句英文说明（桌面可以用字段自己拼中文）；`burnSource` 是 `history`（曲线斜率）或 `agents`（智能体数 × 估计）。
    用同一个 requestId / action_id 重试，拿到的是第一次挑的结果，不会重挑。
- **注意持久化格式**：sparse 请求记录 `SparseRequestRecord`（`agent_management/sparse.rs:241`）是
  `deny_unknown_fields`，里面存着整个请求（`SparseAgentSpec`，`sparse.rs:47`，也是 `deny_unknown_fields`）。
  所以**不能**在 spec 里加新字段，也**不能**把 `"auto:…"` 原样存下来：先挑好，记录里只存具体账号名；
  挑选说明另存在旧版本不读的新文件 `runtime/profile-auto-pick/`。
- 预览接口：`GET /v2/profile-auto-pick?provider=anthropic&model=…&effort=…`（只给主人；**不放在 `/v2/profiles/` 下**，
  免得和一个叫 `auto-pick` 的 Profile 撞路径）返回这一家的排序，不创建任何东西；
  不带 `provider` 时返回「每家各自的推荐」（给桌面一次画出下拉框），**仍然不跨家比较**。响应：
  `{available, unavailableReason, providers: [{provider, providerLabel, profiles, optedIn, profilePick | null, refusal: {code, detail} | null}]}`。
  预览和真正创建之间几秒钟里情况可能变化，**以创建结果为准**（结果写明挑了谁）。
- Profile 接口：`GET /v2/profiles[/{p}]` 多一个 `autoPick`（布尔），`PATCH /v2/profiles/{p} {"autoPick": true}` 打开。
- 能力：`profile-auto-pick`（一直报；本机有保留名字的 Profile 时看预览的 `available` / `unavailableReason`）。

### 桌面

- 「新建智能体」页**先选服务商**（Claude 订阅 / ChatGPT / GLM / …，只列本机有账号的），
  再选账号：**缺省「自动（推荐 profileDawn：周额度剩 12%）」**，下拉里是这一家的各个账号，选一个就是手选。
  悬停「自动」看各候选的分数和卡住的窗口。这一家只有一个账号，或没有账号打开「参与自动选择」时，
  直接显示那个账号、不给「自动」。没有 `profile-auto-pick` 能力时只有手选（今天的样子）。
- 创建后在智能体卡片 / 项目「动态」（022）里能看到「自动选择：profileDawn（周额度剩 12%）」。
- Profile 设置里加「参与自动选择」开关（默认关）。开关下面固定显示一行提示：
  **「是否符合各家条款由你自己判断」**，后面带链接——到这个账号所属服务商的条款页（Claude：
  [消费者条款](https://www.anthropic.com/legal/consumer-terms)；ChatGPT：[使用条款](https://openai.com/policies/row-terms-of-use/)；
  智谱：[订阅条款](https://docs.z.ai/legal-agreement/subscription-terms)），其它服务商链接到本文 §5。

### 可选：建议（不强制）挪走一个空闲智能体

一个空闲的智能体所在账号快撞墙、而**同一家**的另一个账号余量充足时，桌面可以提示：「Ceobe 快到 5h 上限，
下一个回合前把 X 换到 profileDawn？」——点了才执行，执行的是 **`member_replace`（新对话 + 交接）**，
**不是**中途换账号（`cutex/session/profile/switch`）。自动挑选**从不**调用中途换账号。

## 4. 硬性规则

0. **服务商由人（或组长）定，自动只在这一家的账号里挑**，从不跨服务商。
1. **一个对话一辈子一个账号**。自动挑选只发生在新对话诞生时；撞墙后重启同一个对话不换账号；
   要换只能开新对话（`member_replace`）。
2. **不做按请求的路由**：cutex 不在中间转发、不拆分请求、不替模型调用挑账号；每个智能体照旧用自己 Profile 的
   CLI 和凭据直连服务商。
3. **凭据不出本机**：只在本机的 Profile 里挑。跨主机委托时由对方主机自己挑，凭据不传。
4. **不隐藏用的是哪个账号**：挑中的账号名写在智能体记录、创建结果、卡片上；「参与自动选择」默认关，
   要主人一个个打开。
5. 不为了绕过限制而把一份工作拆到多个账号上：一个智能体一个账号，撞墙就停，像今天一样等重置或由人决定。

## 5. 条款核对与主人的决定

### 主人的决定（2026-10-23）

**做**，对所有服务商都开放（Claude、ChatGPT、GLM 和其它 OpenAI 兼容的），但只作为**可选功能**：
每个账号的「参与自动选择」**默认关**，由用户自己一个个打开；打开的地方显示「是否符合各家条款由你自己判断」
并带条款链接（§3 桌面）。主人的理由：

- **一个人持有多个订阅很常见**：一张卡就能买三个 Claude 订阅，Claude 官方应用本身就支持切换账号。
- **自动挑选只是省掉一次查表**：今天用户或组长也是手工看各账号余量再选；cutex 只是把这一步自动做了。
  每个对话照旧在官方客户端里**从头到尾只用一个账号**。
- **很多开放模型的 key 是自建、合作方、实验室或公司的 key**，某种用法是否允许，只有用户自己知道，
  所以由用户判断、由用户打开。
- **cutex 是本机、无服务器的**：没有中转、没有计费转嫁，比反向代理克制得多（见 §4 第 2、3 条）。

Claude 部分，主人的立场（2026-10-23）：Anthropic 曾考虑禁止通过 Agent SDK 使用订阅，后来在用户反对下放弃了。
cutex 本来就是按 Claude 的政策设计的：**不用第三方运行时、不包装 API、不管理 OAuth 令牌**；每个账号放在自己独立的
home 里，跑的是**官方 Claude Code 运行时**。所以主人认为，在官方客户端里按账号自动挑选是合规的。
（这是主人的立场，不是法律意见；下面的条款摘要和链接保留，供每个用户自己判断。）

### 条款摘要

> 以下是 2026-10-23 读到的公开条款摘要，不是法律意见。灰色地带照旧写明；主人的决定见上一节。

### Anthropic（Claude Pro / Max）

- [消费者条款](https://www.anthropic.com/legal/consumer-terms)（生效日 2025-10-08）：
  - 不得把登录信息 / 凭据给别人，也不得让别人用你的账号；你对账号下的所有活动负责。
  - **禁止「通过自动化或非人工方式访问服务（机器人、脚本等）」，除非用 API key，或 Anthropic 另有明确许可。**
  - 禁止绕过系统或保护措施。
  - **没有**提到一个人能不能同时持有多个订阅。
- [Claude Code 法律与合规页](https://code.claude.com/docs/en/legal-and-compliance)：
  - 订阅的 OAuth 只用于「Claude Code 和其它 Anthropic 原生应用的**正常使用**」；
  - 用 Agent SDK 等做产品的开发者应改用 API key；第三方不得替用户用 Free / Pro / Max 凭据转发请求；
  - Pro / Max 公布的额度「以普通的、个人的使用为前提」；Anthropic 保留不经通知采取措施的权利。
  - 2026-02-19 这页改过措辞，后来 Anthropic 员工说措辞让人困惑（[Gigazine 报道](https://gigazine.net/gsc_news/en/20260220-anthropic-third-party-block)）。
- **灰色**：
  - cutex **今天**就在用主人自己的订阅、通过 Claude Code / Agent SDK 跑主人的智能体（不经第三方转发）；
    这件事本身就落在「明确许可」和「正常个人使用」的解释里，041 不改变它，但**自动在多个订阅间均衡**
    更容易被看成「为突破单个订阅额度而堆账号」。
  - 「绕过保护措施」能不能套到「多订阅轮流用」上，条款没说。

### OpenAI（ChatGPT Plus / Pro + Codex）

- [使用条款](https://openai.com/policies/row-terms-of-use/)（这次直接读取被拒 403，以下来自
  [2023 版条款存档](https://openai.com/policies/mar-2023-terms) 和二手资料，**需要主人或别人再核对现行版本**）：
  不得把账号 / 凭据给组织外的人；禁止用自动化或程序方式从服务提取数据（API 除外）；要遵守速率限制。
- [Codex 与 ChatGPT 套餐额度](https://help.openai.com/en/articles/11369540-codex-usage-limits)：
  用 ChatGPT 账号登录 Codex 是官方路径，额度按套餐、可加购额度。
- **灰色**：一个人持有多个 Plus / Pro 并轮流用——没找到明文规定；「遵守速率限制」能否理解为不能用多账号叠加，没说。

### 智谱 Z.ai（GLM 编程套餐）

- [订阅条款](https://docs.z.ai/legal-agreement/subscription-terms)（页面没有日期）：
  - §4.3：套餐绑定**一个账号**，只授权给该账号对应的**自然人本人**使用；不得分享给同事、朋友、客户或组织；
    针对「代替他人的批量或自动化使用」可以限额或停用。
  - §4.2：额度**只能在官方指定或认可的编程工具里用**（如 Claude Code、Kilo Code）；
    通过未授权或不支持的工具（如基于 SDK 的接入）使用可能被限制权益。
  - **没有**提到一个人能不能持有多个套餐。
- **灰色**：cutex / cute-codex 算不算「认可的工具」没有明说；多套餐轮流用没有明说。
  这是三家里条款最具体、风险最直接的一家。

### 草稿里问主人的两个问题（已决定）

1. 要不要做 041？——**做**，可选、默认关、只在新建时挑（上一节）。
2. GLM 是否先不纳入？——**纳入**，和其它服务商一样由用户自己判断、自己打开。

## 6. 分阶段、成本、回退

| 阶段 | 内容 | 估计 |
|---|---|---|
| P0 ✅ | 保留前缀：本版起不允许新建 / 改名成 `auto` 或以 `auto:` 开头的 Profile（大小写不敏感；已有的照旧能用）；能力 `profile-auto-pick`；~~额度曲线 90 天清理~~（主人 10-23 决定全部保留，已去掉） | 0.5 人日 |
| P1 ✅ | cutex：按服务商的候选、读最新额度、曲线斜率、固定消耗表、打分；`profile: "auto:<服务商>"`（agent_create / member_replace / human agents）、`profilePick` 说明、预览接口、`runtime/profile-auto-pick/`、Profile `autoPick` 开关；测试 | 2–3 人日 |
| P2 | 桌面：新建页先选服务商、账号缺省「自动（推荐 …）」+ 改选；Profile「参与自动选择」开关；卡片 / 动态显示选择原因 | 1–1.5 人日 |
| P3 | 从用量账本学每种模型 / 强度的消耗；空闲智能体「建议换账号」提示 | 2 人日 |

合计约 6–7 人日。

P0 + P1 的测试（cutex `50bc494`）：
- 单元测试 15 个：§2 的例子（profileElm 2.8 h、profileDawn 8 h、Ceobe 3.2 h → 选 profileDawn）、平手规则、1 小时门槛与「都快撞墙」、
  斜率（同一重置周期、跨度、余量变多）、单独 `auto` 拒绝、拒绝时什么都不绑定、**重试重放不重挑**、
  **持久化的 sparse 记录里只有具体账号名**、保留名字、已有保留名字时关闭、`auto_pick` 关时不写进记录（回退）、90 天清理（后来按主人决定去掉，换成「全部保留、只读最近两个月」的测试，cutex `7403d06`）。
- `cargo test --lib`：2827 通过，10 个失败全是 Windows 上已知的旧失败（和 RC 头一致）。
- 私有调试守护进程冒烟 `tests/profile_auto_pick_smoke.py`（本机假额度接口，两个同一家的 Profile）：24/24 通过，1 项跳过——
  私有 home 里没有 Codex 运行时包，真正创建在挑选之后的启动配置检查处停下，所以「智能体记录里是具体名字」和
  「requestId 重放」只由单元测试覆盖。预览挑中的账号和分数与手算一致（Kappa 17.9 h、Lambda 2.8 h）。

### 回退（回到 r250 / r249）

- **已建好的智能体**：记录里是具体账号名，旧版本照常运行，没有任何差别。
- **`profile: "auto:anthropic"` 的新请求**：旧版本把它当成账号名去找，找不到就拒绝（`unknown_profile`），
  智能体会看到错误、改用具体账号。**例外**：如果主人恰好有一个就叫 `auto:anthropic` 的 Profile（旧版本允许，
  `profiles/lifecycle.rs` 只禁斜杠和控制字符），旧版本会选它。所以已实现：
  - 请求的名字**正好**是一个已有 Profile 的名字时，照旧用那个 Profile（和旧版本一样）；
  - 否则只要本机有叫 `auto` / `auto:…` 的 Profile，自动挑选就关闭（`auto_pick_unavailable`，预览的
    `available: false`、`unavailableReason` 写明请主人改名）。
- **「参与自动选择」开关**存在 Profile 记录上。`StoredAccount` 没有 `deny_unknown_fields`、也没有保留未知字段
  （`profiles/model.rs:90`），旧版本保存账号时会**丢掉**这个开关；再升级后开关变回关闭——是安全的方向，
  只是要重新打开。
- **挑选说明**存在 `runtime/profile-auto-pick/`，旧版本不读。
- 桌面看能力：没有 `profile-auto-pick` 就不显示「自动」。
