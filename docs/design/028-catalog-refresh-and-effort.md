# 028 模型目录刷新与推理强度回退

状态：**实现中**（cutex `fix/zai-effort`：2d99e3c + 7b5f0ab + 689c23a，未部署）。来源：主人 10-22 报告：host02 的 Profile **Zooey**（Z.ai）新建智能体总是失败，「catalog model/effort missing or ambiguous」。

## 发生了什么

- Zooey 的默认推理强度是 `max`。它的模型目录里 glm-5.3 那一行是很早写进去的：强度只有 low / medium / high，上下文 500000。官方文档（docs/research/zai-bigmodel-api-20261022.md）写的是：glm-5.3 和 glm-5.3-flash 都是 1M 上下文，强度只有 low / high / max，默认 max，没有 medium。
- 重新获取模型只会**补空字段**，所以错的那一行一直没被改正；Z.ai 的 `/api/v1/models` 还根本拿不到列表（返回 `success:false` 的信封）。
- 新建时 cutex 用「Profile 默认 `max`」去对这一行，对不上就拒绝（启动前检查失败）。
- 明确写 `reasoning: high` 也失败，原因是第二处检查：新建到「接管会话」这一步时，cutex 用会话记录重算启动配置，而这时请求里的模型 / 强度还没写进记录，于是又拿 Profile 默认 `max` 去检查（`session_adopt_failed`）。

## 决定

**(a) 重新获取会刷新「服务商的字段」，不碰你改过的**

- 已有的行里，上下文、最大上下文、输入类型、可选强度和默认强度属于服务商的信息。重新获取时，cutex 按已知的官方资料改成正确的值，并在结果里列出改了什么（`refreshed: [{model, field, from, to}]`）。
- 你在设置里改过的字段（通过模型编辑保存的）记在 Profile 目录的 `model-edits.json` 里，**永远不被刷新覆盖**。
- 这个记录之前就存在的行（如 Zooey 的 glm-5.3），cutex 不知道哪些是你改的，所以只改**服务商会拒绝的值**：例如去掉 glm-5.3 不支持的 `medium`，换成 low / high / max；默认强度不在可选里时改成官方默认。上下文等其他字段不动；点这一行的「重置」后，这一行就按官方资料完全刷新。
- Z.ai / BigModel 的模型列表改从 Coding Plan 接口读（`/api/coding/paas/v4/models`，只对内置预设的默认地址生效；自定义地址仍读 `<地址>/models`）。用 Standard key 读会失败，错误里直接说「需要 GLM Coding Plan 的 API key」。
- glm-5.3-flash 的可选强度补上 low / high / max（默认 max）。

**(b) Profile 默认强度不支持时自动回退，绝不因此拒绝新建**

- 新建时没指定强度：Profile 默认强度如果这个模型不支持，就回退。GLM 先按官方对应关系换算（none / minimal / low → low，medium / high → high，xhigh / max / ultra → max），不行就用这一行的默认强度，再不行用它支持的最高一档。cutex 日志里写明从哪档换到哪档；智能体的强度标签显示的就是实际用的那一档。
- **明确指定**了模型不支持的强度：仍然拒绝，并在错误里列出可选的强度（例：「reasoning effort max is not offered by model glm-5.3; choose one of: low, medium, high」）。
- 接管会话时用请求里的模型 / 强度检查（不再用 Profile 默认），新建和随后启动用的是同一个选择。

## 卡住的名字（waveline-news、waveline-news-glm）

host02 上两个新建操作没有完成，名字一直被占着（只读查到，未改动）：

| 名字 | 操作 | 阶段 | 原因 |
|---|---|---|---|
| waveline-news | `auto-5ae2f95202c9b1ab5a5087d0596eb256` | configured（已建原生会话 01a15f87…，之后启动失败） | 强度 `default` → Profile `max`，glm-5.3 不支持 |
| waveline-news-glm | `auto-87e029fcf075de20b1857380ff969c04` | native_session_captured（接管会话失败） | 上面第二处检查：明确的 `high` 被当成 `max` 检查 |

两者都已经建了原生会话，所以不能「释放」（cutex 的保留名对账只处理还没建任何东西的操作，这是有意的：否则会留下一个没人管的会话）。支持的做法是**用同一个操作 ID、完全相同的参数再调一次**，cutex 会从断点继续把它做完。修复部署后（r249），让当初发起新建的智能体（cutex.1ee3ecf9…，项目 cutex-desktop-side）各调用一次 agent_create，参数与当初一致并带上 `action_id`。

## 实现时定下的细节

- 刷新只对 cutex 已知资料的模型生效（`known_models`）；不认识的模型不动。
- `model-edits.json` 在第一次重新获取或第一次编辑时建立；建立时已有的行都算「之前就有」。重置或删除一行会把它从记录里去掉。
- 回退只发生在「没有明确指定」的情况；桌面新建页当前不额外提示（强度标签显示实际值）。如需在新建结果里单独写一句，需要 agent_create 结果加字段，留作后续。
- 2d99e3c 审查：BigModel 的 `/api/v1/models` 与 Z.ai 一样返回信封、`/api/coding/paas/v4/models` 是 OpenAI 格式路由（无 key 的探测，只看路由形态），所以 zhipu 的映射和 zai 一致；修了一个问题：服务商错误信息先截断 200 字再遮 key，key 恰好在截断处时会露出半截，现在先遮再截。缓存比较：旧缓存记的是 `/api/v1/models`，与新地址不同，CLI 会当作没有缓存重新获取，没有迁移问题。

## (c) 回退要说出来（主人 10-22 同意）

- 新建时如果 Profile 默认强度这个模型不支持、自动换了一档，结果里写明：智能体调用 agent_create 的回复里有 `effort_fallback {model, requested, used, reason, note}`（`note` 是一句话，Director 一眼能看懂）；桌面新建（`POST /v2/human/agents`）的回复里有 `effortFallback`。能力标记 `agent-create-effort-fallback`。
- 桌面新建成功后提示一行：「默认推理强度 max 不被 glm-5.3 支持，已改用 high」。
- 明确指定的强度不回退，所以不会有这个字段。

## (d) 放弃一次没完成的新建（主人 10-22 同意）

- 命令：`cutex human management agent-create-abandon <操作 ID> [--dry-run]`（要 cutex 在运行、主人凭据）；接口 `POST /v2/agent-management/create-abandon {action_id, dry_run?}`，只给主人。能力标记 `agent-create-abandon`。
- 做的事：释放被占的名字，把这次新建标成「已放弃」（结束，不会再续做），并清理**这次新建自己建出来的东西**：如果已经有会话记录，就按「删除会话」的正常流程删掉（连同原生会话，留恢复副本在 `runtime/session-deletes/`）；如果只有原生会话没有会话记录，就把它的历史挪到恢复目录。别的东西一概不碰；工作目录不删。
- 拒绝：已经完成的新建（请改用归档 / 删除智能体）、不是新建的操作、已经以别的方式结束的（名字本来就是空的）、正在运行的（稍后再试）。
- 重复执行没有副作用：第二次直接返回第一次的结果。
- `--dry-run` 只列出会删 / 会挪的东西。
- 留痕：操作本身的结束记录（NoWrite `create_abandoned` + 阶段事件）和一份收据 `runtime/agent-management/v1/abandons/<操作 ID>.json`。
- 桌面：Director 对话里那条没完成的「新建智能体」工具行上有「放弃这次新建」：先试算，确认框写明会释放的名字、会删除 / 挪走的东西、「不能撤回（会话有恢复副本）」，确认后执行并提示结果。

## 待主人决定

- （已定，见 (d)）
