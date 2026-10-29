# 037 Claude 智能体在回合中换模型 / 推理强度；按模型分别设置自动压缩

状态：**cutex 和适配器已实现**（cutex `feat/claude-live-effort` d5a3404，未推送；随 claude-r24 / r250）。桌面：模型和强度选择器不用改；按模型设压缩的界面已做（设置 → Profile（Claude）→ 模型列表的「自动压缩」一栏，`feat/0.2-compaction-settings`）。
来源：主人 10-22 问：官方 Claude Code 能在会话中途换模型 / 推理强度，cutex 却拒绝（-32009「Finish or interrupt the current turn before changing Claude settings」）。另加：能做好的话，按模型分别设置自动压缩（036 当时没做）。

## 原来为什么拒绝

- 适配器（`protocol.py`）只要模型、推理强度或 Fast 有变化，就要求线程空闲。
- 只换模型其实已经是即时的（SDK 的 `set_model`）。
- 换推理强度或 Fast 要换掉 Claude Code 子进程：推理强度只在启动参数 `--effort` 里。

## 查清的事实（真 Claude Code 2.1.295 / 2.1.301，私有 home，假的 Messages API 记下每次请求，不花用量）

| 操作 | 结果 |
|---|---|
| `apply_flag_settings {effortLevel}`（控制请求，Python SDK 没包装，适配器已经在用它重载权限规则） | 下一次请求的 `output_config.effort` 就变；**回合中途改，同一回合的下一步（工具结果之后那次请求）就用新值** |
| `set_model` 回合中途 | 同一回合的下一步就用新模型（换之前 CLI 会先发一个 1 token 的请求验证模型） |
| `apply_flag_settings {fastMode: true/false}` | 下一次请求带 / 不带 `speed: fast` |
| 只改一个键 | 与启动时 `--settings` 合并，不覆盖其他键（Fast、权限规则、`disableAllHooks` 都保留） |
| 无效的 `effortLevel` | 回复「成功」但不生效，所以适配器先按模型的可选档位检查（原来就这样） |
| `effortLevel: null` | 回到模型默认档 |
| `set_max_thinking_tokens` | 自适应思考的模型上没有作用，不用 |
| `apply_flag_settings {env: {CLAUDE_CODE_AUTO_COMPACT_WINDOW, CLAUDE_AUTOCOMPACT_PCT_OVERRIDE}}` | **即时生效，调大调小都行**，盖过启动时的环境变量；`""` 取消覆盖（交回 Claude Code 决定） |
| `apply_flag_settings {autoCompactWindow}` | 只在启动时读，中途改不生效，不用 |

## 决定

**换模型 / 推理强度 / Fast（适配器，特性 `liveModelEffort`）**

- Claude Code ≥ 2.1.295（适配器已有的 `claude --version` 探测）：直接发给正在运行的 Claude Code，回合进行中也行，从下一次模型请求起生效。不重启，不换连接，正在跑的工具和后台子智能体不受影响。
- 更老或版本未知的 CLI，或者环境变量 `CLAUDE_CODE_EFFORT_LEVEL` 锁定了推理强度时：照旧（空闲时换子进程，忙时 -32009）。
- 发给 CLI 出错时：已经生效的部分照实记下（例如模型换了、强度没换），把错误报给客户端；超时（结果不明）时按原来的办法重启运行时。
- 回合中途换模型后，这一回合剩下的「实际模型」观测不再记录（规则：一个回合只属于一次模型选择），下一回合照常。

**桌面**：模型和推理强度选择器本来就没有在忙时禁用（只是把适配器的拒绝显示出来），所以不用改。cutex 也没有自己的忙碌检查。

**按模型设置自动压缩（cutex 能力 `claude-compaction-models`，适配器特性 `compactionModels`）**

- Profile 新字段 `claudeCompactionModels: {"<模型 id>": {window, percent}} | null`（最多 32 个，范围同 036；`null` / `{}` 删除）。
  存在新文件 `profiles/<id>/claude-compaction-models.json`，`claude-runtime.json` 不变，旧版 cutex 照样能读。
  文件不合法时详情给 `claudeCompactionModelsError`。
- 启动运行时 cutex 把这张表放进适配器的环境变量 `CUTEX_CLAUDE_COMPACTION_MODELS`（旧适配器忽略）。
- 适配器：
  - Claude Code 启动时按当时的模型设这两个环境变量；
  - 每次换模型都换成新模型的值：新 CLI 即时生效（`env`），老 CLI 空闲时换子进程。
  - 某个模型没有条目，就用 Profile 统一的值（036），也没有就交给 Claude Code。
- 这样 036 里「按模型分别设这次不做」的两个理由都不成立了：换模型可以即时换压缩值；实际模型由适配器自己知道，不靠 cutex 的记录。

## 还没做

- 桌面界面（已做）：模型列表多一栏「自动压缩」，点开该行：跟随 Profile / 30·50·70 万 / 自定义，「恢复默认」清掉；和 Profile 的自动压缩一起走页面草稿，保存时 PATCH 整张表（`claudeCompactionModels`）。折叠行（别名 + `[1m]`）一次写入它覆盖的所有模型 id，因为适配器按模型 id 精确匹配。要有 `claude-compaction-models` 能力才显示。
- 部署：适配器改动随下一个 Claude 运行时 claude-r24（`features.json` 的 `release` 由主管改）；cutex 改动随 r250。

## 证据

- 适配器测试：`tests/test_live_settings.py`（18 个，假 SDK：忙时换强度和模型不重启、Fast、老 CLI 仍拒绝、换模型带上压缩值、新子进程按模型的压缩值、老 CLI 压缩值不同时换子进程）。
- 真 CLI 测试：`tests/test_live_settings_native.py`（`CUTEX_TEST_CLAUDE_CLI`）。真 SDK + 真 Claude Code + 本地假 API：回合中途改成 sonnet + low，同一回合工具之后那次请求就是 sonnet / low，子进程没换。2.1.295 和 2.1.301 都通过。
- 适配器全套：657 通过，33 跳过（需要 Windows 或手动打开的探针）。
