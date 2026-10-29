# 005 Claude 后台子智能体

状态：**已实现，待部署**（10-21；cutex b77a5cd…9ca35a5，desktop 30dae05a；claude-r23 / adapter 0.8.0）。清单 #40。

## 问题

Claude 智能体等前台子智能体时，主人中途发的消息要等子智能体结束才读到（实测最长 41 分钟）。原生 Claude Code 默认把子智能体放后台，主智能体空着，插话立刻有回应；我们的适配器拒绝后台、强制前台。

## 依据

- 现象分析（本对话 41 条插话）：清单 #40。
- 主人在 Claude desktop 的对照测试：后台 ≈ 0 s；前台 / 主智能体自己的长命令 = 等到工具返回（原生也一样，不打断正在跑的工具）。
- 探针：[claude-background-subagents-probe-result.md](../research/claude-background-subagents-probe-result.md)。
- 原设计与缺口清单：[claude-background-subagents-20261019.md](../research/claude-background-subagents-20261019.md)（§8 主人 10-19 的四个决定）。

## 主人看得到的行为

- 智能体可以把子智能体放后台；主人随时插话，主智能体下一步就读到。
- 后台子智能体的过程实时可见，可以打开、可以「停止」。
- 子智能体跑完：cutex 发一条看得见的消息叫醒主智能体，它在那一轮处理结果。
- 后台子智能体遇到需要审批的操作：直接拒绝（10-19 决定），提示改用前台子智能体或交给主智能体。免审批模式不受影响。
- 不能用 cutex 工具（留言、委派等），不能向主人提问（10-19 决定）。
- 适配器重启导致丢失：叫醒主智能体说明，由它决定要不要重做（10-19 决定）。

## 硬规则：Claude Code 自己开的「通知轮」不能用工具

子智能体结束时 Claude Code 会自己给主智能体开一轮，cutex 没有发起它：桌面看不到、停不了、审批无处挂。所以这一轮只让主智能体回一句、不用工具，紧接着由 cutex 发看得见的消息开正常一轮。`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` 能关掉这一轮，但会把后台整个关掉（探针第 6 项），不能用。

完整理由、模型被告知什么、不听话时怎样、代价、考虑过的替代、和 G5 等待 / cutex 叫醒消息的顺序：已写进 cutex `components/claude-runtime/docs/BUSY_DELIVERY.md`「Claude Code's own notification turn」一节，测试 `tests/test_notification_turn.py`。

## 实现时定下的细节（bg-subagents，10-21）

- 运行中的回合里收到任务通知时，下一条输入在回合结束后最多等 10 s（Claude Code 可能紧接着开自己的通知轮）；没有通知轮就只是晚 10 s。
- 换模型 / 强度、关闭运行时：正在跑的后台任务结束并报「丢失」，不拒绝操作；离线时的「丢失」消息在上线后送达。
- 后台 Bash 的完成通知 60 s 内最多一条，其余合并。
- 用量：后台部分按子智能体的消息估算，加到发起它的回合；Claude Code 自己的通知轮不计。
- 「Claude Task」消息在桌面上暂时显示为普通消息行（没有专门样式）。
- 部署：适配器 claude-r23 必须和新 cutex 一起上；只上适配器时后台子智能体能跑，但跑完没人叫醒主智能体。
