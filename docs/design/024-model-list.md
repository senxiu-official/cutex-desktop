# 024 模型列表：一个真实模型一行

状态：**实现中**（models，10-22；桌面 `feat/0.2-models`，cutex `feat/models` 未部署）。来源：主人 10-22：「默认 Profile 显示不支持的模型之类的」「不明白为什么 Claude 有好几个别名模型」。

## 一、默认 Profile 的「不支持的模型」

**查到的（只读：host02 的 `cutex profile list` / 配置里的 model 行 / 共享 Codex 目录的 `models_cache.json`；hachimi 的原生 `codex debug models --bundled`）**

- host02 的默认 Profile 是 **profileCedar**（Codex，ChatGPT Pro），默认模型 `gpt-5.6-sol`。这个模型在上游列表里，也在 cute-codex 内置列表里：**本身没问题**。
- 上游列表（`models_cache.json`，10-21 20:52）还有一条**隐藏**的服务端条目 `gpt-reserve`（visibility = hide，不给任何人选）。cute-codex 内置列表里没有它。
- Profile 页的「模型」一节读的是上游**全量**列表（含隐藏条目），cutex 的 `notInBundled` 把 `gpt-reserve` 也算进去，于是**每个官方 ChatGPT Profile**（默认 Profile 首当其冲）都显示黄色提示：「上游模型列表有更新：gpt-reserve 不在当前 cute-codex 内置列表中，可能需要更新 / 重新打补丁」。这条提示是误报。

**改了什么**

- cutex（`src/profiles/native_models.rs` `not_in_bundled`）：隐藏条目不算「内置列表缺的模型」。提示只在真有可选的新模型时出现。
- 桌面：如果一个 Profile 的默认模型**真的**已经从上游消失（cutex 把它列在 `unavailableModels` 里）：
  - 设置 → Profile → 默认模型下面写明「默认模型 X 上游已经没有了，用它新建的智能体会启动失败；请选一个新的默认模型」。
  - 新建智能体页自动先用这个 Profile 还提供的第一个模型，并在模型菜单里说明。以前这里静默显示原 id，建出来的智能体一启动就失败。

## 二、Claude 为什么有好几个别名

**清单**（Claude 运行时自带的参考表 `model_catalog.json`，10-18 版，23 条；Claude Code 2.1.301 对别名的解释）

| 显示（以前） | 实际模型 | 来源 | 类别 |
|---|---|---|---|
| Opus 5.5 / Sonnet 5.5 / Fable 5.1 / Haiku 5.5 | claude-opus-5-5 等 | 参考表 | 固定 id（最新一代） |
| Opus 5 / Sonnet 5 / Fable 5、Opus 4.8 / 4.7 / 4.6、Sonnet 4.6 | 同名 id | 参考表 | 固定 id（旧） |
| Haiku 4.5 / Opus 4.5 / Sonnet 4.5 | 带日期的 id（claude-haiku-4-5-20251001 …） | 参考表 | 固定 id（带日期） |
| Opus (alias) / Sonnet (alias) / Haiku (alias) / Fable (alias) | 现在分别 = Opus 5.5 / Sonnet 5.5 / Haiku 5.5 / Fable 5.1 | 参考表；Claude Code 内置别名表 | 别名：跟随该系列最新 |
| Opus 1M (alias) / Sonnet 1M (alias) | 同上 + 1M 上下文（而 5.5 本来就是 1M） | 参考表 | 别名的 `[1m]` 形式 |
| Best (alias) | 有 Fable 用 Fable，否则 Opus | 参考表 | 模式 |
| Opus Plan (alias) | 计划模式用 Opus，其余 Sonnet | 参考表 | 模式 |
| Default (runtime choice) | 不指定，由 Claude Code 按账号选 | 参考表 | 模式 |
| 其他（连上会话后 Claude Code 报的，如 `claude-sonnet-4-6[1m]`；旧会话存过的 id） | 原样 | SDK 握手 / 已存选择 | 自定义 |

所以同一个 Opus 5.5 会出现三次：`claude-opus-5-5`、`opus`、`opus[1m]`。cutex 的 Profile 覆盖层和 request_model 只用于 Codex，不影响 Claude。

**做法（只改桌面显示；发给 Claude 的 id 不变）**

- 每个系列一行：「Opus 5.5」，下面一行小字「始终用最新的 Opus（现在是 Opus 5.5）」，选它发的是别名 `opus`（和 Claude Code 一样，以后出了新版自动跟上）。同系列最新的固定 id（`claude-opus-5-5`）和 `opus[1m]` 并进这一行，不再单列。
- 名字里不再有「(alias)」。系列行的名字取自它现在指向的模型。
- 「更多模型」里：旧的固定版本（同系列由新到旧），固定 id 的 1M 版本写「Sonnet 4.6 · 1M 上下文」，然后是三种模式：「最佳可用」「Opus 规划 · Sonnet 执行」「Claude Code 默认」（各带一句说明），最后是不认识的 id（原样）。
- 当前选中的永远不会被并掉；如果它在「更多」里，就提到前面。
- 输入框的模型标签：别名显示成它的模型名（「Sonnet 5.5」）；「实际响应」和标签一致时，不再在旁边重复一个小标签。
- 用在：输入框模型菜单、新建智能体页（模型菜单和高级设置里的下拉）、设置 → Profile 的默认模型下拉和模型列表（系列行标「跟随最新」，悬停看说明；Claude 列表不再给每行标「视觉」，因为都支持）。

## 实现时定下的细节

- 折叠只看 id（`claude-<系列>-<主>-<次>[-日期]`、系列别名、`[1m]`、模式名），会话的 `model/list` 和 Profile 的模型目录都能用，不需要改 cutex 或 Claude 运行时的协议。
- 别名指向的模型按「列表里同系列版本最高的固定 id」推断，这和 Claude Code 内置别名表在官方账号上一致；如果账号用了自定义别名（环境变量 / 网关），实际模型以「实际响应」为准。
- 旧运行时只给别名列表（没有固定 id）时，系列行就叫「Opus」「Sonnet」…。
- 固定条目（pin）仍按 id 存；没有 pin 时，前面显示的是各系列那一行。

## 待主人决定

- 别名是否也该在「更多」里保留一个「固定 Opus 5.5（不随新版变）」的选择？现在选固定版本要在「更多」里点「Opus 5」等旧版本；最新一代的固定 id 只有在已被选中时才单独出现。
