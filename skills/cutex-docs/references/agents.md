# 创建与管理 agent

面向回答操作问题的 agent。基础词典在 `apps/desktop/src/renderer/src/i18n/{zh-CN,en}.ts`；模块词典在 `apps/desktop/src/renderer/src/modules/*/i18n.ts`，同文件的 `zhCN` / `en` 对应。界面术语模板 `{{agent}}` / `{{director}}` 会按用户术语设置替换；下文保留模板，以免猜测用户的显示名称。所有源码路径均相对桌面仓库。

下文省略前缀的 `modules/`、`components/`、`lib/` 和 `store.ts` 均位于 `apps/desktop/src/renderer/src/` 下。

## 新建

1. 打开「新建{{agent}}」（New {{agent}}，`agent-config.newAgent.title`）。如果只是先提问，可用「快速启动」（Quick launch，`quick-chats.nav`）；首次发送才创建会话，见 [concepts.md](concepts.md)。
2. 填写「名称」（Name，`agent-config.newAgent.name`），选择「Profile」（Profile，`agent-config.newAgent.profile`），按需选择模型与推理强度。
3. 选择「项目」（Project，`agent-config.newAgent.project`）及「工作目录」（Working directory，`agent-config.newAgent.cwd`）。目标是选定主机上的目录。支持临时工作区的 daemon 可自动分配；旧 daemon 提示需要目录时，选择已有目录或带目录的项目。Director 是可选角色，只有选择项目且主机支持时才可指定。
4. 检查权限。填写「初始任务（可选）」（First task (optional)，`agent-config.newAgent.task`）后按钮为「创建并发送」（Create and send，`agent-config.newAgent.createAndSend`），会启动并发送任务。没有初始任务时可以仅点「创建」（Create，`agent-config.newAgent.create`）；「创建后立即启动」（Start it right away，`agent-config.newAgent.start`）决定是否上线。
5. 若界面说 agent 已创建但任务、头像或 Director 设置失败，用对应重试入口继续；不要重复创建同名 agent。

依据：`apps/desktop/src/renderer/src/modules/agent-config/NewAgentPage.tsx` 的 `createAgent`、分步创建与重试处理；`lib/newAgentSteps.ts`；模块词典 `newAgent.scratchUnsupported`、`newAgent.taskStarts`、`newAgent.messageFailed`、`newAgent.retryMessage`。

## Codex 的沙箱、审批与网络

沙箱限制命令的可写范围，审批设置决定是否请求越界操作许可；从不询问不是自动解除沙箱。

| 选项 | 含义 / key |
| --- | --- |
| 「只读」（Read-only） | `launch.sandbox.read-only`：只读沙箱。 |
| 「工作区可写」（Workspace write） | `launch.sandbox.workspace-write`：工作区写权限；可额外配置可写目录。 |
| 「完全访问」（Full access） | `launch.sandbox.danger-full-access`：不使用上述文件写入沙箱限制。 |
| 「需要时询问」（Ask when needed） | `launch.approval.on-request`：需要时请求审批。新建表单简写为「需要时」（Ask，`agent-config.newAgent.approvalAsk`）。 |
| 「从不询问」（Never ask） | `launch.approval.never`：不请求审批。新建表单简写为「从不」（Never，`agent-config.newAgent.approvalNever`）。 |
| 「网络访问」（Network access） | `launch.network`：该开关只适用于 workspace-write 沙箱。 |
| 「额外可写目录」（Extra writable folders） | `launch.writableRoots`：允许写入工作目录之外的指定目录。 |

新建默认值只影响之后创建的会话，创建时保存到会话，已有 agent 不因此改变。不要把快速启动和命名 agent 的默认值混为一谈，也不要把具体机器上的当前默认值写成所有安装的保证。参考：全新安装的 cutex 新建 agent 默认是「自动」（Auto：工作区可写 + 需要时询问 + 允许联网），以前就在用的安装保持「完全访问」（Full access）；详见 [设置与默认值](settings-defaults.md#全新安装的默认值)。用户可在「设置」（Settings）→「新建默认」（New {{agent}} defaults）里改。

Claude agent 使用 Profile 的文件写入、命令执行规则；新建页中的 Codex 沙箱、审批、网络和额外可写目录不适用于 Claude。若选项缺失，先核对 Profile 类型与主机能力。

依据：`apps/desktop/src/renderer/src/components/LaunchOptions.tsx`；`modules/agent-config/NewAgentPage.tsx` 的 Codex / Claude 分支；`lib/permissionModes.ts`；`apps/desktop/src/shared/launch.ts`；模块词典 `agent-config.defaults.pageHint`、`agent-config.newAgent.claudeRulesHint`。不要把原生沙箱设置等同于 cutex 的 owner 审批，后者见 [concepts.md](concepts.md)。

## 快速模式（Fast mode）

Codex 会话可以开「快速模式」（Fast mode）：输入框下方点推理强度，在弹出的面板里打开。提示是「优先处理：响应更快，额度消耗更多」（Priority processing: faster responses, uses more quota）；开启后推理强度旁显示闪电图标。

- 只在模型提供 Fast 档、且主机的 cutex 有 `session-fast-mode` 能力时出现；旧 cutex 上隐藏这个开关（否则重启运行时会悄悄丢掉设置）。
- 设置按会话保存，运行时重启或恢复后仍然有效。Claude 会话不提供。
- 它会更快消耗额度；用户在意额度时提醒这一点。

依据：`apps/desktop/src/shared/fastMode.ts`、`components/Composer.tsx` 的 `EffortPicker`；基础词典 `composer.fast.*`；cutex `docs/SESSION-FAST-MODE.md`、capability `session-fast-mode`。

## fork 与 revert

- **fork**：在相应 turn 的菜单选择「分叉为新{{agent}}（从这一轮之后继续）」（Fork into a new {{agent}} (continues after this turn)，`reply.fork`）。新建一条 agent / session / native thread，原来的 agent 保留。agent 菜单也可从当前历史分叉。
- **revert**：选择「回退到这里」（Revert to here，`reply.revert`），核对将移除的后续 turn 数量，再确认。它修改同一 agent 的对话历史，**不会撤销文件改动**。如果还要恢复文件，必须另行处理文件差异，不能假定 revert 已完成。
- Claude 忙碌时不能 fork / revert；有排队输入或笔记也可能被拒绝。先等当前 turn 和待处理输入完成，或由用户决定清理哪些待处理项，再重试。
- 另起任务时创建新 agent；不使用 `/clear` 清空现有 agent。当前桌面 `/new` 是新建操作快捷入口，不会在原 session 中重置历史。

依据：`apps/desktop/src/renderer/src/store.ts` 的 `forkSession`、`revertAndReload`；`lib/slashCommands.ts`；基础词典 `reply.fork`、`reply.revertHint`、`structural.claudeBusy`、`structural.refused.queued`。如果后台拒绝结构操作，保留原错误并核对 daemon / runtime 能力，不声称分叉或回退成功。

## goal

输入 `/goal <目标>` 设置目标；`/goal pause`、`/goal resume`、`/goal clear` 分别暂停、继续、清除。也可以展开「目标」（Goal，`goal.label`）卡片：

- 「编辑目标」（Edit goal，`goal.edit`）编辑文字和「Token 预算」（Token budget，`goal.budget`）；预算支持 `200k`、`1.5M`，留空表示不限。
- 「暂停」（Pause，`goal.pause`）与「继续」（Resume，`goal.resume`）改变 goal 状态。不要把暂停 goal 当成停止当前 turn 的按钮。
- 「清除」（Clear，`goal.clear`）需再次点击确认；「替换为新目标」（Replace with a new goal，`goal.replaceWith`）会重置用量计数。

卡片显示目标状态、tokens 和耗时；额度受限、预算耗尽、受阻、暂停与已完成是不同状态。当前卡片没有一个通用的“结束 agent”按钮。用户说结束时，先从上下文分辨要停止 turn、清除目标、停止运行时还是归档；不要把真实未完成工作标为完成。

依据：`apps/desktop/src/renderer/src/components/GoalBar.tsx`；`lib/slashCommands.ts`；`store.ts` 的 `setGoal`、`clearGoal`、`replaceGoal`；基础词典 `goal.budgetHint`、`goal.clearAgain`、`goal.replaceHint`、`goal.status.*`。goal 入口依赖原生运行时的 goals 能力。

## 暂停、停止与结束的区别

| 用户目的 | 操作与后果 |
| --- | --- |
| 停止当前 turn | 输入框的「停止」（Stop，`composer.stop`）中断当前 turn 并暂停队列。不要宣称停止会自动撤销之前的文件改动，也不要宣称所有后台终端都会结束。 |
| 恢复暂停的发送 | 「继续发送」（Continue，`paused.resume`）恢复投递。支持 `stop-holds-ridealongs` 的主机会一起放行停止时暂停的消息、委托、结果、留言和闹钟；旧主机行为以界面提示为准。单纯再排队一条消息不等于放行。 |
| 暂停新委托 | 委托暂停控制让新委托先排队；独立暂停委托与停止 turn 造成的暂停可以同时存在。按界面提示恢复相应一层。 |
| 让 agent 下线，但保留会话 | 菜单「停止运行时」（Stop runtime，`menu.stop`）。忙碌时会中断当前 turn；会话保留，可之后重新上线。 |
| 结束临时侧聊 | 使用侧聊自己的结束操作；它丢弃临时侧聊，不是结束主 agent。重要结论先保存为批注。 |
| 不再放在活跃列表中 | 归档，见下一节。 |

停止行为存在能力差异，不能只按版本号推断。输入模式也会改变 Esc / Enter 的作用；默认说明、实际快捷键提示与暂停提示都要一起看。若用户要求停掉仍运行的命令，应检查后台终端，而不是只按停止 turn。

依据：`apps/desktop/src/renderer/src/components/Composer.tsx`、`components/DelegationQueue.tsx`、`components/QueuePanel.tsx`；`lib/queuePause.ts`、`lib/stopHold.ts`；基础词典 `shortcuts.stopButton`、`paused.resumeHint`、`paused.resumeHintStop`、`asksPause.titleHintStop`、`queue.turn.heldStopHint`、`menu.stopConfirm`、`tool.backgroundHint`；`modules/side-chat/SideChatCard.tsx`。

## 归档、恢复与删除

「归档」（Archive，`menu.archive`）让 agent 离线；忙碌时会中断 turn 并停止运行时。归档后仍可查看只读历史。到归档设置或归档列表使用「恢复」（Restore，`archive.row.restore`），恢复后才能发送或启动。若项目也已归档，界面可能要求同时恢复项目；以确认内容为准。

**空会话例外**：归档设置提供将没有任何对话的 agent / 快速工作直接删除的选项。开启时空会话不会留在归档列表，不能承诺任何归档都可恢复。

「永久删除」（Delete permanently，`archive.row.delete`）与归档不同：删除对话和 cutex 记录，不能恢复。存在项目、任务或分叉历史引用时，daemon 可能拒绝删除；不要自动删除依赖 agent 来绕过拒绝。agent 负责的托管服务不会因为归档自动停止，可在服务页重新指定负责人。

依据：`apps/desktop/src/renderer/src/modules/archive/i18n.ts` 的 `archive.archiveHint`、`deleteEmptyHint`、`banner.*`；`lib/archivedAgent.ts`；基础词典 `menu.archiveConfirmBusy`、`menu.deleteConfirm`、`refusal.session_referenced`、`refusal.session_fork_referenced`、`menu.archiveOwnsServices`。
