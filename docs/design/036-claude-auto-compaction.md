# 036 Claude 自动压缩

状态：**已实现**（cutex `feat/claude-compaction` 3e60d7b，桌面 `feat/0.2-claude-compaction`；未部署）。来源：主人 10-22 想把 Claude 的自动压缩设在 50 万 token 左右，找不到地方设。

## 现状

- cutex 早就支持，但没有界面：Claude 运行时启动时读 `~/.cutex/profiles/<Profile id>/claude-runtime.json` = `{"auto_compact_window": 100000..1000000, "auto_compact_percent": 1..100}`，设成 Claude Code 的环境变量 `CLAUDE_CODE_AUTO_COMPACT_WINDOW` / `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`。
- 10-22 主管已在 hachimi、host02、remote 的 6 个 Claude Profile 上手写了 `{500000, 90}`。

## Claude Code 2.1.301 怎么算（从它的代码里读出来的）

- 窗口 W = min(模型上下文, 设置的窗口)（设置被限制在 10 万–100 万）；不设时按模型自己的上下文（1M 模型就是 100 万）。
- 有效窗口 E = W − min(最大输出, 20000)，一般就是 W − 20000。
- 压缩点 = min(E × 百分比 / 100, E − 13000)；不设百分比时是 E − 13000。
- 所以**不是**简单的「窗口 × 百分比」：
  - 1M 模型默认约在 96.7 万压缩；
  - 手写的 `{500000, 90}` 实际约在 43.2 万；
  - 想「在 N token 时压缩」就是窗口 = N + 33000、百分比 = 100（50 万 → `{533000, 100}`）。
- 模型上下文比设置小时（例如 200K 的模型），按模型上下文算，等于那个模型照常压缩。

## 决定

**cutex**（能力标记 `claude-compaction`）

- Profile 列表 / 详情多一个字段 `claudeCompaction: {window, percent} | null`，读的就是上面那个文件，所以手写的文件直接显示出来。
- `PATCH /v2/profiles/{p}` 接受 `claudeCompaction`：写入时检查范围；`null` 删除文件，回到 Claude Code 自己决定；Codex Profile 拒绝。权限和其他 Profile 设置一样（主人的管理凭据，智能体碰不到）。
- 文件格式不变（仍然只有这两个键），旧版 cutex 照样能读。
- 文件内容不合法时（启动会因此失败），详情里的 `claudeCompactionError` 写明原因，界面标红。

**桌面**

- 设置 → Profile（Claude）→ 模型 →「自动压缩」，可选：
  - 默认（Claude Code 决定）；
  - 30 万 / 50 万 / 70 万 token（按上面的换算存）；
  - 自定义：窗口 + 百分比两个输入框。
- 说明行算出「上下文达到约 X token 时压缩」，并写：数值越小越省用量，但智能体记得的细节越少；这个 Profile 的智能体下次启动运行时后生效。
- 模型列表的说明从「Claude Code 自己决定」改成「在上面的自动压缩里设置，对所有模型生效」。
- 旧版 cutex（没有能力标记）不显示这一行。

**生效时间**：每个智能体下次启动运行时。没有做「立即重启这个 Profile 的智能体」：cutex 没有安全的按 Profile 批量重启（正在运行的轮次会被打断）。需要立即生效时，主人可以对单个智能体用已有的重启运行时。

## 按模型分别设置：这次不做

主人问能不能按模型分别设。结论是在 cutex 这一侧做不好：

1. **换模型不重启 Claude Code。**
   - 在对话里换模型时，适配器（cute_claude `sdk_runtime.py` 的 `set_model`）给正在运行的 Claude Code 发一个控制请求，进程不重启。
   - 环境变量是进程启动时定下的，所以换模型后还是旧模型的压缩设置，直到下次启动。
   - 改推理强度时适配器会换掉 Claude Code 子进程，但子进程的环境继承自适配器进程，也不会变。
2. **启动时 cutex 不知道实际用哪个模型。**
   - cutex 记录里的模型是启动参数，只在换 Profile 时更新。
   - 在对话里换的模型存在适配器自己的数据库里，下次启动沿用。
   - 按 cutex 记录挑「这个模型的设置」，在换过模型的智能体上会挑错，而且不会有任何提示。
3. **旧版 cutex 会拒绝多出来的键**（`deny_unknown_fields`）。往同一个文件写 `models` 会让旧版本启动失败，只能另开文件。

要做好得改适配器：每次启动 Claude Code 子进程时按当时的模型挑设置，换模型时换子进程（改强度已经这样做）。这是 claude-runtime（下一个 claude-r 版本）的事，需要的话另开设计。

另外，按模型分别设的主要用途（小上下文模型别用大设置）已经由 Claude Code 自己保证：窗口不会超过模型上下文。
