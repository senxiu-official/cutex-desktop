# CLI：查询与常用 human 操作

以下语法已对照 2026-10-14 安装的 cutex `--help` 和 2026-10-18 的 cutex 开发源码（0.1.4）核对。执行前用用户安装的 `cutex --version`、相应子命令的 `--help` 确认差异；不要把开发源码里的能力当成用户已安装的能力。

命令里的 `AGENT_ID`、`ACTION_ID`、`ROTATION_ID`、`PROJECT_ID`、`NAME`、`MODEL_ID` 和 `WORKSPACE` 都是待替换占位符，不是 shell 变量；路径有空格时加引号。示例不包含凭据。`human` 表示以用户管理意图操作，不需要另造一个 Director 身份。

## 版本与查询

| 命令 | 作用 / 注意事项 |
|---|---|
| `cutex --version` | 显示当前 PATH 命中的 cutex 版本（发布二进制形如 `cutex 0.1.4 (0.1.4, <commit>)`，从源码构建的通常是 `cutex 0.1.4 (<7 位 commit>)`）；不等于远端 daemon 或桌面版本。 |
| `cutex service status` | 查看 `cutex service install` 写的安装记录和服务 / supervisor 状态（只读）。 |
| `cutex upgrade status` | 查看已安装 / 可用的发布和当前运行（只读）。`managed: false` 表示不是托管安装，不能用 `cutex upgrade` 更新；`no_trusted_keys` 只出现在没有内置发布公钥的构建上。见 [安装升级](install-upgrade.md#升级-cutex-与-cute-codex)。 |
| `cutex upgrade check` / `cutex upgrade apply` | 托管安装：检查签名发布 / 等所有 agent 空闲后安装并验证（失败自动回滚）。会停一次服务，属于改变状态的操作，用户要求时才执行。 |
| `cutex service status` 的 `notificationWorker` | 托管安装（cutex 0.1.1 起）里 Management 服务自带的通知 worker：心跳、webhook 是否开启、投递计数。托管安装不需要再另起 `cutex notify run`（两者共用一把锁，同时运行也只投递一次）；手动部署的主机仍然用它。 |
| `cutex component list` / `cutex component status [NAME]` | 可选组件（`claude-runtime`、`job-service`）的状态（只读；`status` 输出 JSON，含 `state`、`steps`）。需要 capability `components`（cutex 0.1.1 起）。见 [安装升级](install-upgrade.md#可选组件claude-运行时job-service)。 |
| `cutex --help` / `cutex human --help` | 列出当前安装支持的入口。 |
| `cutex human session list` | 列出持久会话；可用 `--all`、`--offline`、`--project TEXT`、`--sort recent`。这里没有 `--json` 参数。 |
| `cutex human session show AGENT_ID` | 查看指定持久会话。 |
| `cutex human session retired --json` | 列出可恢复的已归档 agent；不要把 retired 误认为永久删除。 |
| `cutex human config show AGENT_ID` | 查看保存的配置；运行中 runtime 的启动配置可能不同。 |
| `cutex human doctor` | 本地诊断 runtime、失败动作和存储，不启动服务。 |
| `cutex human doctor AGENT_ID --check` | 扫描指定会话的健康问题；省略 ID 可扫描整体。 |
| `cutex human action ACTION_ID` | 查询既有 runtime 动作；不带 `--resume` 时不发起另一启动动作。 |
| `cutex human bus-messages list --min-age 0 --agent AGENT_ID --limit 20 --json` | 查询该 agent 未投递消息及原因；默认最小年龄为 1h，`0` 包含所有年龄。输出可能含消息内容，向别人分享前脱敏。 |
| `cutex human project rotation --project PROJECT_ID` | 查询项目的 Director 轮换；也可用 `cutex human project rotation ROTATION_ID` 查询单条。不要附加 `--cancel` / `--continue` 来做查询。 |
| `cutex human claude account list` | 查询 Claude 账号状态及关联的 Profile / agent。 |
| `cutex profile list` | 查询 Profile 及 runtime / proxy / provider 信息。 |
| `cutex alarm list` | 查询闹钟；它是顶层命令，不是 `human alarm list`。 |

诊断不要默认导出全部会话正文或配置文件；只提取当前问题需要的字段，避免把个人路径、账号及认证信息带进报告。

## 会改变状态的常用命令

这些是用户确实要执行相关操作时的参考，不能作为“先试一下”的连接排错步骤。

| 命令 | 实际效果 |
|---|---|
| `cutex human new NAME --cwd "WORKSPACE"` | 创建持久 native agent，不发送模型 prompt；CLI 此入口没有 `--profile`，要显式选择 Profile 时优先用桌面新建流程。 |
| `cutex human start AGENT_ID` | 用保存的配置启动 managed native agent。 |
| `cutex human attach AGENT_ID` | 连接已运行 agent 的终端界面，不重启它。 |
| `cutex human stop AGENT_ID` | 停止 runtime、保留历史；与桌面只停止当前 turn 的动作不同。 |
| `cutex human restart AGENT_ID` | 重启 agent；`--force` 会强制停止后再启动，不能无声加入。 |
| `cutex human config set AGENT_ID model=MODEL_ID reasoning=high` | 保存模型 / reasoning 配置，用于下次启动；并不保证当前 runtime 立即切换。 |
| `cutex human config undo AGENT_ID ACTION_ID` | 撤销对应配置动作的字段；若这些字段之后又被改过，会拒绝覆盖。 |
| `cutex component install NAME [--from-source DIR] [--dry-run]` | 安装或更新到当前 cutex 版本指定的组件版本（发布安装下载签名归档；源码安装要加 `--from-source <cutex 源码目录>`）。只在托管安装上可用。`needsUser` 时按 `steps` 做完再运行一次。 |
| `cutex component remove NAME [--force] [--dry-run]` | 停止并取消选定，文件和数据保留。有作业在跑或被 agent 固定时拒绝；`--force` 会强制，不能无声加入。 |
| `cutex component prune NAME [--dry-run]` | 删除没有被选定、固定或被当前 / 上一个 cutex 版本引用的旧版本。 |

`human` 的 runtime 管理入口可用唯一名称、native UUID 或持久 ID 解析对象；有歧义时先查询并选确切 ID。其他命令的选择器并不一定相同，以其 `--help` 为准。

## 出错后的边界

- 启动请求超时不等于启动失败：先查返回的 action ID，避免重复 start。缺少依赖已解决且用户要继续原操作时，`cutex human action ACTION_ID --resume` 恢复原动作。
- `cutex human doctor --fix` 预览修复；`--fix --yes` 才应用支持的修复。先读 findings 与计划，不承诺所有告警都能自动修复。
- `human recover`、`bus-messages discard`、强制停止和 Director 轮换都有额外后果，不列为通用修复。需要时先查本版帮助和对应故障证据。
- `cutex human tasks ...` 和 `--cancel-tasks` 已在 r219 移除；不要用旧文档里的 Task Service 操作代替当前工作流或委托。
- `cutex --quick` 是旧式 CLI 启动入口，不等于桌面的快速启动。managed agent 优先走这里核实过的 New / Start / Attach 流程。

## 核对依据

- 2026-10-14：本页命令和参数通过当时安装的 `cutex --help` 核对，未执行真实管理、诊断或模型请求；2026-10-15 按源码补充 `service status` / `upgrade status`。
- cutex: `src/cli/args.rs` 的 `ServiceCommand`、`UpgradeCommand`、`ComponentCommand`；`components/README.md`；`docs/backend-upgrade.md` §1、§6。
- cutex: `src/cli/args.rs` — `Cli`、`HumanCommand`、`SessionCommand`、`HumanConfigCommand`、`HumanProjectCommand`、`HumanBusMessagesCommand`、`ClaudeAccountCommand`、`ProfileCommand`、`AlarmCommand`。
- cutex: `docs/management/human-cli.md` — 生命周期、配置生效时机、原 action 恢复与旧式 quick 入口。
- cutex: `docs/health-check.md` — doctor 查询 / 预览 / 应用的边界。
- cutex: `docs/r219-removals.md` — 已移除命令。
