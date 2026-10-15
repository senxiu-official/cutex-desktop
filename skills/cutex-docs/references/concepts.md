# cutex 概念与界面定位

面向回答用户问题的 agent。界面引文写作「中文」（English），保留同一 i18n key；`{{agent}}`、`{{director}}` 等是可配置术语占位符，实际界面会替换。基础词典位于 `apps/desktop/src/renderer/src/i18n/{zh-CN,en}.ts`；模块词典在相应 `modules/*/i18n.ts`，其中 `zhCN` 与 `en` 配对。以下源码路径均相对于桌面仓库。

下文省略前缀的 `modules/`、`components/`、`lib/` 和 `store.ts` 均位于 `apps/desktop/src/renderer/src/` 下。

## daemon、桌面、agent、turn

- **cutex daemon** 保存会话、Profile、项目、队列、委托等业务状态，并管理原生运行时；**cutex desktop** 是连接 daemon 的客户端。桌面关闭不等于 agent 的运行时停止。文件、终端和差异通过 daemon / app-server API 操作，所以工作目录属于目标主机。
- **一个 agent = 一个 cutex session = 一个 native thread**。turn 是这条 thread 内的一轮执行。想另起一条独立历史就新建 agent；fork 也是新建 agent，revert 留在原 agent。
- 不存在把原 agent 清空后当作新 agent 的 `/clear` / `/new` 工作流。注意当前桌面确实有 `/new` 快捷命令：它调用新建 agent 操作，不是清空当前 thread。不要把旧设计中的“没有 `/new`”解释成当前命令面板完全没有这一项。

依据：`docs/DESIGN.md` §2–3；`AGENTS.md` Core principles；`apps/desktop/src/renderer/src/lib/slashCommands.ts` 的 `case "new"`；`apps/desktop/src/renderer/src/store.ts` 的 `forkSession`、`revertTo`。具体操作见 [agents.md](agents.md)。

## 主机、用户与设备

一台运行 cutex 的电脑就是一台**主机**；桌面可以同时连多台（本机 + SSH 主机），每个 agent、项目和 Profile 都属于某一台主机。主机上还有**用户**（{{owner}} 与被授权的其他人）、**设备**（连上来的桌面和手机）和**对端主机**（另一台 cutex）。**你**的名字、头像和身份密钥存在你自己的每台电脑上。详见 [主机与用户](hosts-users.md)。

## Profile 与模型配置

Profile 在中文界面也叫「Profile」（Profile，`agent-config.newAgent.profile`）。它描述 agent 使用的提供方、认证方式及默认模型等配置；不要把它翻译成另一个菜单名。模型配置是在同一个 Profile 中为实际模型配置显示名称、上下文和自动压缩阈值等选项，同一模型可以有多份配置，并共用该 Profile 的登录与接口。已加载的模型配置可以在会话中切换，下一轮生效；新增或修改模型配置需要运行时下次启动才加载。Profile 的统一上下文设置可能覆盖模型配置。

依据：`modules/agent-config/i18n.ts` 的 `agent-config.profile.variantHint`、`variantsHint`、`variantSwitchHint`、`variantOverridden`、`contextWindowHint`；`components/settings/ProfileModels.tsx`、`components/settings/ProfileModelDialog.tsx`（完整路径前缀均为 `apps/desktop/src/renderer/src/`）。认证和额度见 [profiles.md](profiles.md)。

## 快速启动与“快速对话”

当前入口是「快速启动」（Quick launch，`quick-chats.nav`），设置中的分类是「快速工作」（Quick work，`agent-config.quickChats`）。用户口中的“快速对话”和代码中的 quick chat 指这条轻量创建会话的流程，不是另一个已核实的“快速对话”按钮。先进入草稿页，选择 Profile、模型、权限等，首次发送时才创建会话；可预设 plan / goal。它仍是 daemon 管理的持久会话，不是侧聊那样结束即丢弃的临时对话。

正式命名、指定项目与目录时使用新建 agent 表单。快速启动默认 Profile 可单独设置；单次仍能在输入框下方选择其他 Profile。不要假定两种创建入口的默认权限相同。

依据：`modules/quick-chats/QuickChatMenu.tsx`、`modules/quick-chats/i18n.ts`；`store.ts` 的 `DRAFT_CHAT_PAGE`、`newQuickChat`、`runPendingChat`；`modules/agent-config/i18n.ts` 的 `quickChats.profileHintOn`；`apps/desktop/src/shared/launch.ts`。

## 项目与 Director

「项目」（Projects，`projects.title`）组织工作目录、成员和项目记忆。支持可选 Director 的 daemon 可以创建没有 Director 的项目；新建 agent 时可以加入现有项目、创建项目或独立存在。Director 是项目中指定的协调角色，不是所有项目的创建前提，也不是一个额外 daemon。以实际主机能力为准：旧版本可能要求先指定 Director。

依据：`modules/projects/ProjectsPage.tsx`、`lib/projectCreate.ts` 的 `OPTIONAL_DIRECTOR_FEATURE`；`modules/agent-config/NewAgentPage.tsx`；`modules/agent-config/i18n.ts` 的 `newAgent.newProjectHint`、`asDirector`、`directorUnsupported`。不要直接套用 `DESIGN.md` 早期“一项目必须有 Director”的提案。

## 委托、asks、队列与审批

- **delegation / ask** 是 agent 把工作交给另一 agent 的有状态请求，可以跟踪请求者、承接方、执行状态和结果。asks 是后端术语，不是用户需要另外创建的聊天类型。结果由 cutex 回送；卡片未结束时不要仅因等待时间长就认定失败。
- **队列** 展示尚未送达的用户消息、委托、结果、留言或闹钟等。排队、在工具边界插入、打断并发送的时机不同。闹钟等待当前 turn 结束，不插入运行中的 turn。停止后的暂停状态和恢复入口见 [agents.md](agents.md)。快捷键会受用户输入模式设置影响，回答时优先使用当前界面提示。
- **审批**有两层：原生运行时对命令、文件修改等的交互请求；cutex 对超出 agent 自身权限的 Profile、委托、服务、网页或工作流操作的 owner 审批。「审批」（Approvals，`approvals.nav`）页面展示后者。普通一次性审批通常允许 agent 重试同一请求；工作流批准后立即开始，浏览器打开意图则需要新工具调用，不能概括成所有批准都立即执行。

依据：`components/DelegationList.tsx`、`components/DelegationQueue.tsx`、`components/TurnQueue.tsx`；`lib/delegations.ts`；基础词典 `queue.turn.afterTurnHint`、`interaction.title.*`；`modules/approvals/ApprovalsPage.tsx`、模块词典 `approvals.hint`、`retryHint`、`browser.retryHint`、`warn.runWorkflow`。

## 闹钟

「闹钟」（Alarms，`alarms.statusTitle`）显示 agent 设置或将唤醒该 agent 的提醒：时间、发起方、接收方和内容。用户可以在状态区域查看并取消待发闹钟；已经发出的闹钟无法再取消。它由 daemon 处理，不依赖打开当前聊天窗口。

依据：`modules/alarms/AlarmsStatus.tsx`、`modules/alarms/useAlarmsStatus.tsx`；模块词典 `alarms.cancel`、`cancelConfirm`、`alreadySent`；`docs/DESIGN.md` §2。

## 笔记与侧聊

用户说的笔记对应当前「批注」（Notes，`notes.title`）。批注单独保存，可关联来源 turn，默认不进入主聊天上下文；取消标记只改变查找方式，不删除批注。要交给当前 agent，可用「引用到输入框」（Quote in input，`notes.quote`）：只追加草稿，不自动发送。来源 turn 被 revert 或来源 agent 被删除，批注仍保留。

「侧聊」（Side chat，`side-chat.title`）继承上下文但与主聊天隔离，是临时对话，结束后丢弃；当前只支持 Codex。可以从聊天或某个 turn 打开，主 agent 需在线，daemon 需支持 side-chat。要保留结论，使用「记为旁注」（Save as turn note，`side-chat.summary`），生成摘要并保存为批注；需要启用 Notes 模块和主机的笔记能力。

依据：`modules/notes/NoteEditor.tsx`、`NoteView.tsx`、`modules/notes/i18n.ts` 的 `noContext`、`quoteHint`、`pinHint`、`reverted`、`sessionDeleted`；`modules/side-chat/SideChatBody.tsx`、`SideChatCard.tsx`、`modules/side-chat/i18n.ts` 的 `temporary`、`codexOnly`、`offline`、`notesOff`。

## 工作流

「工作流」（Workflows，`workflows.title`）展示脚本驱动的多步骤运行、阶段、步骤状态、结果、日志和用量上限。agent 发起的运行要先批准运行计划：检查脚本、参数、Profile、并发 / agent / token 限额后批准；批准会启动一次性 agent 并使用相应 Profile 额度。页面可停止运行；是否能接着运行取决于 daemon 的恢复能力。不要把工作流等同于某个聊天中的 plan 清单。

依据：`modules/workflows/WorkflowsPage.tsx`（`Plan` 卡片、`workflowRunAction`、`WORKFLOW_RESUME_FEATURE`）；`modules/approvals/i18n.ts` 的 `approvals.warn.runWorkflow`、`runWorkflowHint`。

## 浏览器

「浏览器」（Browser，`browser.title`）有 owner 自己打开的标签与 agent 打开的标签。两类使用不同登录环境；agent 自己打开的标签不继承 owner 的网页登录态。owner 可以明确选择已有标签并授予 agent 控制；**授予后保留 owner 的登录态，agent 可以操作已登录账号、提交表单和修改真实数据**。单次允许授予所选标签，不应表述为仅让 agent 阅读页面。当前还提供「本次运行内一直允许」（Always allow while the app runs，`approvals.claim.allowSession`）：直到应用重启，同一 agent 对该 origin 的后续标签请求会自动允许并提示，可在浏览器设置或标签页撤销。不要把该选项描述成永久授权。未启用模块、主机不支持或没有可授予标签时，以界面提示处理。全新安装时浏览器模块默认打开；「服务」页的「打开」也优先用内置浏览器标签（见 [设置与默认值](settings-defaults.md#服务)）。

依据：`modules/browser/BrowserBody.tsx`、`BrowserAgentPicker.tsx`；`modules/approvals/BrowserClaimPanel.tsx`；`modules/approvals/i18n.ts` 的 `approvals.browser.ownerLogin`、`agentLogin`、`confirmClaim`，以及 `modules/approvals/claimMessages.ts` 的 `approvals.claim.allowSessionHint`、`restarted`；`AGENTS.md` Core principles §4。登录环境按主机共享池管理，不应承诺每个 agent 有独立账号隔离池。

## 产物 artifacts

当前 UI 称「成果」（Artifacts，`artifacts.title`）和「成果库」（Artifacts，`artifacts.library`）。它保存发布或自动捕获的文件版本，可预览、对比和引用。可以让 agent 发布，或用「从工作区发布…」（Publish from workspace…，`artifacts.publish`）；同名再次发布形成新版本。打开时可跟随最新或固定某一版本，引用含义不同。自动捕获取决于 daemon 配置与目录范围，不能承诺每个文件改动都会入库。

依据：`modules/artifacts/Library.tsx`、`View.tsx`、`actions.ts`、`Settings.tsx`；模块词典 `artifacts.publishNameHint`、`openLatest`、`openPinned`、`followsLatest`。这些是文件成果，不是 daemon 会话、Profile 或浏览器标签。
