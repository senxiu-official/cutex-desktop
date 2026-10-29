# 034 新智能体的提示缓存键（prompt cache key）

状态：**后端已实现，未合并 / 未推送**：cute-codex `feat/stable-prompt-cache-key` `86af98482`（基于 `release/native-r54` = 0.163.0-r54）；
cutex `feat/stable-prompt-cache-key` `a33b967`（r250 `6be946d`；`ee15a24` 加 `/v2/capabilities` 条目 `prompt-cache-key`）。
桌面开关：`feat/0.2-prompt-cache-key`（新建默认 → 提示缓存，capability 缺失即隐藏，未合并）。
主人 2026-10-23 批准：做成**可选的省 token 设置，写明风险**；允许小额付费验证请求。

## 问题（生产实测）

cutex 的原生 agent 第一发模型请求几乎总是 **0 缓存**（例如 rollout 01a16241：第 1 发 24 584 输入 / 0 缓存，
第 2 发 25 120 / 24 448 全命中——同一线程只冷第一发）。上游用户实测同病：新 `codex exec` 线程按默认 key
只命中 13–30%，固定 key 后 99.7%（openai/codex [#29377](https://github.com/openai/codex/issues/29377)）。

## 机制（已查清；r52.2 与 r54 相同）

- 每个 Responses 请求都带 `prompt_cache_key`，**默认值 = 线程的 session id**：`codex-rs/core/src/client.rs:577-598`，发送在 `client.rs:980`。
- 代码注释原话：**ChatGPT 从 session-id header 推导缓存亲和性**（root agent 把 prompt_cache_key 当作那个 header 发）——上游 PR #44862（[#44716](https://github.com/openai/codex/issues/44716) 引）。
- 所以**每个新线程（= 每个新 cutex agent）= 一把新 key = 落在一个没缓存过该前缀的分片**，第一发 0；同线程第二发命中。恢复线程沿用 rollout 的原 session id（暖）；临时 fork 故意继承父 key；guardian 审查子会话用自己的 key。
- 间歇性是另一层：缓存本身是尽力而为（[#30425](https://github.com/openai/codex/issues/30425)），罕见前缀（cutex agent 特有的工具集）最吃亏。

### 更正第二轮结论

第二轮曾认定 `approvals_reviewer="user"` / `default_mode_request_user_input=true` 两个 flag 导致冷启动
（U2/V2 实测 0）——**那是时间上的混淆**。第三轮用完全相同的单 flag 设置重跑（全新 home、全新安装）：
13 419 输入 / **11 264 缓存（暖）**。这两个 flag 只改请求 metadata / 工具列表，根本不碰 `prompt_cache_key`
（`turn_metadata.rs`、`tools/spec_plan.rs:1169-1172`）。真正的机制就是上面的每线程新 key。
（第一轮也已排除：`installation_id` 不给缓存分区——全新安装照样命中别的安装写入的缓存；共享 id 还有
Remote Control 409 冲突风险 [#36295](https://github.com/openai/codex/issues/36295) [#33830](https://github.com/openai/codex/issues/33830)，方案 A 弃用。）

## 方案（已实现）

给同一「主机 + 工作区」的 agent 线程钉一把**稳定的 key**：`cutex-<host>-<sha256(cwd) 前 16 hex>`。
同工作区的智能体共享缓存路由，不同工作区互不干扰。

### 原生（cute-codex fork，`86af98482`）

- `ConfigToml`/`Config` 新增 `prompt_cache_key`（可选字符串），规范化为 1–64 个 ASCII `[A-Za-z0-9._:-]`；无效值警告并忽略（不炸启动）。
- `ModelClient::with_prompt_cache_key`；key **只作用于 root agent 线程**（guardian 审查 override、Internal、子 agent 作用域的优先级都更高——子 agent 继承 root 的 key，审查会话保持自己的），并流入 session-id header（`responses_session_id`）。
- 恢复（resume）线程同样吃到：key 来自进程级 config，恢复不换。
- app-server 隐藏探测参数 `--prompt-cache-key-capability` → 打印 `{"promptCacheKey":1}`，供宿主门控。

### cutex（`9fe032f`）

- 设置：`/v2/settings` `promptCacheKey { enabled }`，存 `config.json`，**默认关**；PATCH 走 `patched()` 校验（只认 `enabled` 布尔，未知字段拒绝）。
- 启动：`stock_lifecycle.rs` 在 thread retention 之后，设置开启时先探测**确切的** native（`--prompt-cache-key-capability`，按二进制哈希缓存结果；clap 退出码 2 = 不支持），支持才追加 `-c prompt_cache_key="<key>"`；仅 common-ingress 启动。探测失败 = 中止该次启动（绝不悄悄降级）。
- key 按主机 + 工作区：移动 / 改名工作区 = 换 key（等于换一个新的缓存驱逐域，从冷开始）。

### 桌面设置文案（建议，未实现）

开关名：**「新智能体共享提示缓存（省 token）」**，默认关。风险说明（大白话）：

> 开启后，同一工作区里新开的智能体，第一个请求通常也能命中缓存，省下最多约 2.5 万 token 的全价输入。
> 代价：同一工作区的智能体共用一条缓存路由——前缀不一样的智能体（比如工具集不同）不会因此受益；
> 共用一个键也意味着一起挤一个缓存空间，可能互相挤掉；工作区移动或改名后键会变，等于从冷缓存重新开始。

## 回滚安全

- **老 cutex**：`CodezConfig` 没有 `deny_unknown_fields`（`profiles/model.rs` 注释原话 "CodezConfig has no deny_unknown_fields"），config.json 里多出来的 `prompt_cache_key` 老版本直接忽略；**claude-runtime.json 和 profile 文件一概不碰**。
- **老 native**：未知 `-c` key 本来就忽略（除非 `--strict-config`；app-server 默认 false），但 cutex 不靠这个兜底——探测不到能力就不传。
- 设置关掉即回到每线程 key 的现状；已在跑的 native 不受影响，改动对下次启动生效。

## 验证

- 单测全绿：cutex 5 个（默认关 + 手改 config 兼容、patch 校验、key 稳定 / 工作区隔离 / 主机清洗、探测契约与老 native 参数不动）；原生 4 组（规范化、root 使用 + header、internal / 子 agent 作用域、override 优先级；schema fixture 重生成）。`cargo check --workspace --all-targets` 过。
- A/B（remote，付费小额，3 个短回合，2026-10-23 06:30；r54 工作树 debug 二进制；全新 home、30 个本实验专属命名的 MCP 工具 = 前缀里从未出现过的段；同一个 tools 文件三组共用）：

| 跑法 | 线程 | 第一发输入 / 缓存 | 结论 |
|---|---|---|---|
| A：固定 key `cutex-ab-1tjkl43j` | 新 | 18 259 / **0** | 冷启动，写入 |
| B：**另一个**全新 home + 新线程 + **同 key** | 新 | 19 098 / **16 256（85%）** | 跨 home、跨线程吃到 A 写的缓存 |
| C：对照，不带 key（新线程新 key） | 新 | 19 098 / **0** | 同样前缀全冷 |

结论：同一把稳定 key 让**不同 home、不同线程**的第一发从 0 缓存变成 85% 命中，机制按预期工作。
- 能力探测三态实测：新二进制 `--prompt-cache-key-capability` → `{"promptCacheKey":1}`（exit 0）；live r52.2 → clap 报错 exit 2（cutex 判不支持）；多带参数 → 拒绝。首版 probe 写在 thread-retention 探测之后、共用了被消耗的迭代器（永远不触发），已修（新迭代器 + 回归测试 retention 探测仍好）。

## 未决

- 桌面 UI 未做；要不要加 `/v2/capabilities` 条目（桌面灰掉开关用）待定——目前桌面可看 `/v2/settings` 里有没有 `promptCacheKey` 键判断。
- 上游正在把 `prompt_cache_key` 泛化成 policy enum（`PromptCacheKey` / `session_id_override`）；跟进上游方向可以少维护 fork 补丁。
- key 钉在「主机 + 工作区」上；要不要改成跟 profile（跟人走）待主人定。
- 预存 flaky（非本次引入）：guardian 复用 prompt_cache_key 的测试与其他测试并行时 debug 构建偶发堆栈溢出，单独跑过。