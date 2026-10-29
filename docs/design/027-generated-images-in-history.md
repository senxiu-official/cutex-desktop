# 027 生成的图片不再整张写进对话记录

状态：**A 已实现**（cute-codex `fix/generated-image-refs` 66c73f617，基于部署中的 r52.3；建议出 native 0.160.0-r52.4，未构建、未部署）；**C 已实现**（主人 10-22 批准「一批」方式；cute-codex `feat/image-history-trim` ee7fb8843 基于 A，cutex `feat/image-history-trim` c8ca2e1，桌面 `feat/0.2-image-history-trim` 03021da6；默认关，未部署）；**B 待主人决定**。来源：主人 10-22，Profile-generator 打不开（025），要求 cutex 和 cute-codex 两边都修好再打开它。

## 问题

Profile-generator（Codex，gpt-6.1-sol，上下文 475k）一天生成了 163 张图，对话记录（rollout）有 1.49 GB：

| 位置 | 大小 | 送给模型吗 |
|---|---|---|
| 生成图片条目的 `result`（整张 PNG 的 base64，每张约 4.9 MB） | 约 726 MB | **不送**：这只是给界面看的条目 |
| `imagegen` 工具的输出里的图（`function_call_output` 的 `input_image`，data URL） | 约 306 MB | **送**，每一回合的第一次请求都把整段历史连同所有图重新上传 |
| 代码模式脚本输出里的图（`custom_tool_call_output` 的 `input_image`） | 约 443 MB | **送**，同上 |

## 查到的事实（cute-codex r52.3 = f2469b10f）

- **图片在模型上下文里**：`ext/image-generation/src/tool.rs` 的 `GeneratedImageOutput::to_response_item` 把整张图作为 `input_image`（`detail: high`）放进工具输出，留在历史里。同一回合内的后续请求只发增量（WebSocket + `previous_response_id`）；**每一回合的第一次请求、以及走 HTTP 时，都发送完整历史**。没有任何机制删掉旧图。
- **代价**：每张图约 2.0–2.5k 输入 token。Profile-generator 120 张图时，每次请求约 285k token（大部分命中缓存）。17:49 在 373k 时压缩过一次，压缩后保留了 18 张图。
- **(a) 缓存**：生成图片条目的 `result` 不在请求里，只在存储时去掉它**对请求和缓存没有任何影响**。如果从请求里拿掉旧图，请求的前缀就变了：每回合滑动一次窗口等于每回合都缓存失效（不可接受）；成批地拿掉只在拿的那一次失效一回。
- **(b) 改图**：`imagegen` 是客户端的函数工具（gpt-image-2，经 Codex 的 images 接口），不是 Responses 自带的 `image_generation` 工具（这个对话里一个 `image_generation_call` 都没有）。改图时由客户端直接把图片字节发过去：`referenced_image_paths` 读保存下来的文件；`num_last_images_to_include` 从历史里的 `input_image` 往回找。所以只要历史里的 `input_image` 不动，改图就不受影响。
- **(c) 推理 / 引用**：没有任何东西引用生成图片条目的 id；加密推理只随请求内容变化，只改存储不影响它。
- **(d) 上游**：openai/codex #54398（2026-10-15，进了 0.164.0-alpha.1）把生成图片条目改成「附件库引用 `fileId`，失败时退回内联 `result`」，并明确**不改发给模型的输出**。开源版附件库只有内联实现（`InlineAttachmentStore`），所以在我们的机器上照搬它体积不会变小。我们的做法和它同方向（条目只留引用，请求不变），以后跟上游合并时：上游的 `Inline { result: "" }` + `savedPath` 能读我们写的记录。

## 做法

- **A（已做，只改存储）**：生成图片条目的图已经存成文件（有 `savedPath`）时，写进 rollout / 对话历史库的那一份把 `result` 清空，只留路径。实时通知照旧带图。请求、缓存、改图都不受影响。Profile-generator 这类对话的记录约小一半（约 726 MB → 0）。实现：`rollout/src/policy.rs` 的 `strip_saved_generated_image`，在两条写入路径上调用（`persisted_rollout_items`、`thread-store/src/local/live_writer.rs`）。
- **B（待定，请求逐字节不变）**：工具输出里的大图（`input_image` 的 data URL）存进按内容去重的旁路文件，rollout 里只写引用；读回历史时**原样**还原成同一个 data URL，所以请求、缓存都不变。能去掉剩下的约 750 MB。改动面大：所有读 rollout 的地方（恢复、分叉、压缩、记忆、搜索、app-server 读历史）都要还原，旁路文件丢了要有明确的出错方式。
- **C（待主人决定，会改发给模型的内容）**：历史里内联的工具输出图片超过 20 张时，**一次性**把除最新 5 张以外的都换成一行文字「图片已存为 <路径>；要改它就用 referenced_image_paths」。上下文从约 285k 降到约 30–50k token；缓存每 15 张图才失效一次；`num_last_images_to_include`（最多 5 张）照样能用，更早的图改为用路径引用。

## 方案 C 分析（10-22；之后已按「一批」实现）

数据：host02 上 Profile-generator 的对话记录（10-21 11:42 到 10-22 05:09，只读）。这一天共 43 回合、295 次模型请求、198 张图；输入 5548 万 token，其中 98.3% 命中缓存，未命中 94 万；输出 13 万。每张图在上下文里约 2.4k token，压缩后的上下文几乎全是图（19:49 时 268k 里约 113 张图）。

下面的「费用」按 API 等价算：未缓存的输入记 1，命中缓存的输入记 0.1（OpenAI 的缓存读价；OpenAI 没有 Claude 那种 1.25× 的写缓存加价，第一次发送就是普通输入价）。这个智能体用的是 Pro 订阅，实际消耗的是额度，比例大致相同。

1. **为什么会失效**：缓存按「从头开始相同的那一段」计算。把第 k 张图换成一行文字，等于从第 k 张图的位置起后面都变了；那一次请求，这个位置之后的全部内容按未缓存计，以后的请求又重新命中。
2. **一批一次 vs 每回合一次**：
   - 一批：图超过 20 张时，一次把除最新 5 张以外的都换掉。这一天会失效 **11 次**。
   - 每回合：每回合都只留最新 5 张。这一天会失效 **35 次**（几乎每回合一次）。每回合开头多发约 15–20k 未缓存的 token，而现在只有约 0.3k。
3. **重新缓存 285k 的代价**：
   - 如果是缓存平白丢掉、内容没变小，重新缓存 285k 就要多花约 285k − 28.5k ≈ **25.6 万单位**，约等于这一天总费用的 4%。这种情况真实发生过：10-22 03:44，空闲 8 小时后缓存过期，一回合就多花了约 29 万未缓存 token。
   - 方案 C 不会出现这种情况：换掉旧图的那一次，重新发的是**已经变小的**上下文。图占主体时约 2–3 万，前面还有大量文字时约 20 万以内。所以一次失效只花约 2–20 万单位，而之后每次请求都少发几十万 token；通常 1–3 次请求就回本。
4. **一天的净节省**（按真实的 295 次请求逐次模拟）：

   | 方式 | 失效次数 | 输入合计 | 未缓存 | 费用（单位） | 省 |
   |---|---|---|---|---|---|
   | 现在 | 0 | 5548 万 | 94 万 | 639 万 | — |
   | 一批（超 20 留 5） | 11 | 2786 万 | 118 万 | 385 万 | **约 40%** |
   | 一批（超 30 留 10） | 8 | 3271 万 | 113 万 | 429 万 | 约 33% |
   | 一批（超 50 留 10） | 4 | 3925 万 | 90 万 | 474 万 | 约 26% |
   | 每回合留 5 | 35 | 2670 万 | 118 万 | 373 万 | 约 42% |

   - 算上输出（按输入价的 8 倍）后，「超 20 留 5」从约 740 万降到约 490 万单位，约 **−34%**。
   - 每张图按 2.0k / 2.8k 算时，节省在 34–44% 之间，结论不变。
   - 另外两个好处：最大上下文从 389k 降到约 22 万，不会再触发 17:49 那次压缩（压缩本身要再读一遍 389k）；请求变小，回复也会快一些。
   - 模拟的局限：模拟沿用了真实压缩后的文字量，没有扣掉省下的那次压缩。
5. **改图**：
   - 留下的最新 5 张照常在历史里。`num_last_images_to_include` 最多就看 5 张（`MAX_EDIT_IMAGES`），所以「改最近的图」完全不受影响。
   - 更早的图要用 `referenced_image_paths` 按路径引用。它读的是存下来的文件，不读历史，所以只要文件在就能改。替换文字里写上路径，模型就知道该用哪个。
   - 失去的是「看着旧图做比较」：模型要再看一张旧图，得重新打开文件（这次请求多约 2.4k）。
   - 前提是**每张被换掉的图都有文件**。`imagegen` 的图有 `savedPath`；代码模式脚本输出里的图（这一天 88 条）不一定有：没有文件的要先存成文件再换，否则就留着不换。
6. **什么时候换**：只在回合开始时检查，不在回合中间换。回合中间的请求走增量（`previous_response_id`），历史一变就得整段重发，还会和这一回合的推理衔接。
7. **影响范围**：只在内联图片很多的对话里才会触发；普通智能体没有图，不受影响。

**建议**：如果做 C，就用「一批」：回合开始时，内联的图超过 20 张，就把除最新 5 张以外的都换成「图片已存为 <路径>；要改它就用 referenced_image_paths」。
- 理由：省的和「每回合」差不多（约 40% vs 42%），失效次数却只有三分之一（11 vs 35）；模型看到的历史在两次换图之间保持不变，不会每回合都发现旧图没了；对回合多、每回合图少的对话也不会变贵。
- 门槛写成 profile 设置，默认关，先只给 Profile-generator 打开。
- 没有文件的图不换。
- 实现前需要主人点头（会改发给模型的内容）。

## 建议

先上 **A**（安全，没有行为变化）。**C** 对 token 和速度收益最大（Profile-generator 一天约省 40% 输入费用，见上面的分析），但会改模型看到的内容，需要主人点头；做的话用「一批」方式。**B** 只省磁盘、不省 token，工作量最大，可以等上游有本地附件库再说。

## 决定

A：照做（技术修复）。
C：主人 10-22 批准，按「一批」做：只在回合开始时检查，超过 20 张就只留最新 5 张，旧图换成带文件路径的一行字，没有文件的图不动；作为 profile 设置，**默认关**；部署后由主人给 Profile-generator 打开。
B：待主人。

## 规则

1. 生成的图已经存成文件时，对话记录里只留路径，不再重复存整张图。
2. 发给模型的内容不因为「省存储」而改变；要改（C）必须单独决定。
3. （C）只换有文件的生成图；只在回合开始时换，一换一批；对话记录本身不改。

## 实现时定下的细节（C，10-22）

- **放在 cute-codex**：发给模型的请求是 cute-codex 拼出来的，只有它能改；cutex 只存 profile 设置，启动运行时时把两个配置项传过去（和「兼容严格的工具定义」一样）。
- **配置项**（Codex 的 config.toml 根键）：`generated_image_history_max_inline`（不设 = 关）、`generated_image_history_keep`（默认 5）。不合法（保留 0 张、门槛不大于保留数）时 cute-codex 当作关并记一条警告，不会启动失败；cutex 那边启动前也会检查，手改出不合法的值会拦下启动。
- **cutex 接口**：能力 `profile-image-history-trim`；profile 字段 `imageHistoryTrim` = `null`（关）或 `{maxInline, keep}`，保留 1–50，门槛比保留多、最多 500。只对 Codex profile 有效。
- **怎么认「有文件的生成图」**：图片后面紧跟着图片工具那句「Generated images are saved to … as <路径> by default.」（`imagegen` 和代码模式里生成的图都有）。别的图（view_image 打开的、你贴的图）不换，但算在「最新 5 张」里。
- **换成的字**：`[Image removed from context to save tokens; saved at <路径>. To see it again use view_image on that path; to edit it pass the path in referenced_image_paths.]`
- **只改请求，不改记录**：哪些图已换掉记在内存里；对话记录、恢复、`num_last_images_to_include` 改图都还是原图。恢复对话（重启运行时）后第一回合会重新判断一次，最多多断一次缓存。
- **什么时候生效**：profile 设置在智能体的运行时下次启动时带进去；正在跑的要重启（下线再上线）才生效。同一个 profile 下的所有 Codex 智能体都会用上。
- **需要新的 cute-codex**：旧的 r52.3 不认识这两个配置项（会忽略，不出错）。要出 native **0.160.0-r52.4** = r52.3 + A（66c73f617）+ C（ee7fb8843）。
- 桌面：profile 编辑器里 Codex profile 的开关「只给模型发最新的几张图」，打开后填「超过多少张时」「保留最新」（默认 20 / 5）；cutex 没有这个能力时不显示。

## 以后（主人 10-22，记下，不做）

- 发现某个智能体的上下文里图片很多时（例如超过 20 张生成的图），弹一次性提示，建议在它的 profile 里打开这个设置（一个智能体只提示一次，可以「不再提示」）。判断要靠 cutex 报的数据（例如用量里每步上下文大、或运行时报的图片数），桌面不自己数。

## 构建

「r53」这个名字已经被占用：0.162.1-r53（上游 0.162.1）已在 remote 构建、暂存，但没有启用。所以这个修复按部署中的版本出 **0.160.0-r52.4** = r52.3 + 本补丁；以后 r53 启用前，把同一个补丁移植过去即可（r53 的写入只经过 `into_persisted_rollout_items` 一处）。

## 链接

- 025（cutex / 桌面这边：历史里的大图换成引用）。
- C 的实现：cute-codex `core/src/context_manager/generated_image_history.rs`（规则和换字）、`core/src/session/turn.rs`（回合开始时检查）；cutex `src/profiles/codex_profile.rs`、`src/profiles/settings_api.rs`；桌面 `components/settings/ImageHistoryTrimRow.tsx`、`shared/imageHistoryTrim.ts`。
- cute-codex：`ext/image-generation/src/tool.rs`、`rollout/src/policy.rs`、`thread-store/src/local/live_writer.rs`、`core/src/client.rs`（增量请求）、`core/src/context_manager/history.rs`（图片 token 估算）。
- 上游：openai/codex #54398、#54420。
