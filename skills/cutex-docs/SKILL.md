---
name: cutex-docs
description: 当用户询问 cutex / cutex desktop 的概念、操作、报错或安装升级时，查阅使用手册并结合当前版本帮助解答和排错。Use when the user asks how to use cutex or the Cutex desktop app, what an error means, or how to install / update it.
---

<!--
Distribution: this folder (skills/cutex-docs in the cutex-desktop repository; every desktop package
carries a copy at <desktop base>/current/skills/cutex-docs) is an optional skill for the user's own
coding agent. Copy the whole folder into that agent's skills directory, e.g.
~/.claude/skills/cutex-docs (Claude Code) or ~/.agents/skills/cutex-docs (Codex CLI / cute-codex).
docs/install/AGENT-INSTALL.md ("Optional: this manual for your own coding agent") has the steps.
-->

# cutex 使用手册（供 agent 查阅）

帮助用户使用 cutex daemon 和 cutex desktop。按问题读取下面对应的 reference；不必一次加载全部文档。

## 最小概念模型

- cutex daemon 保存会话、runtime、队列、Profile 和协作状态；桌面是客户端。关闭桌面不等于停止 agent。
- 一个 agent = 一个 cutex 会话 = 一个 native thread。重新开始应新建 agent；fork 创建新 agent，revert 留在原 agent。不要把 `/clear` 或 `/new` 当作清空当前 agent 的办法。
- Profile 是连接、凭据与模型默认设置；模型配置可以有单独的显示名称和实际请求模型。Profile 名不是模型 ID。
- 用户消息、agent 间委托（delegation / asks）、工具审批和目标（goal）是不同对象。先辨认用户所指的对象，再解释暂停、停止、重试或归档的效果。
- 桌面可以连多台主机；每页作用在哪台主机上要先看清。功能是否可用取决于**那台主机的 cutex** 报告的能力，旧 cutex 上显示「需要升级」。

## 问题索引

| 用户问题 / 检索词 | 读取 |
|---|---|
| daemon 与桌面、agent / thread / turn、项目 / Director、快速启动 / 快速对话、委托 / asks、队列、审批、闹钟、笔记、侧聊、工作流、浏览器、产物 | [concepts.md](references/concepts.md) |
| 新建 Profile、预设、API key、ChatGPT 登录、Claude 账号、模型配置、Profile 排序、服务商图标、套餐标签、额度、内置网页搜索与网页搜索工具、严格工具定义 | [profiles.md](references/profiles.md) |
| 新建 agent、沙箱、权限、快速模式（Fast mode）、fork / revert、goal、暂停 / 停止 / 结束、归档 | [agents.md](references/agents.md) |
| 多台主机、主机选择器、SSH 主机、需要升级、你 / 身份密钥 / 你在各主机上、用户、授权、可见用户、设备 / 你的设备、配对、对端主机 / 互联 | [hosts-users.md](references/hosts-users.md) |
| 全新安装的默认值（自动权限、通知预设、默认开关的模块）、模块开关、用量（额外目录、按另一个模型计价）、服务的打开方式、开场 / 立绘 | [settings-defaults.md](references/settings-defaults.md) |
| 连不上 daemon、unsupported selected profile fields or types、include_server_side_tool_invocations、rate_limit、503、不支持自动更新、功能不见了、组件安装卡片 / needsUser、webhook 没发出 | [troubleshooting.md](references/troubleshooting.md) |
| 查版本、查询会话、诊断、常用 human 命令、服务状态、`cutex component`、runtime 生命周期 | [cli.md](references/cli.md) |
| 首次安装（签名发布包 / 源码）、验签、macOS、可选组件（Claude 运行时、Job Service、`cutex component`）、升级桌面（一键更新）/ cutex（后端更新）、更新通道、回滚、卸载、日志位置 | [install-upgrade.md](references/install-upgrade.md) |

## 使用这份手册

1. **用用户的语言回答。**手册是中文写的，但用户可能说英文或其他语言；回答时用用户的语言。引用界面文字时，按用户界面的语言给出：reference 里写作「中文」（English），英文用户就引用括号里的英文。不确定用户界面是哪种语言时两者都给。
2. 根据用户给出的界面、错误和操作目的选 reference。涉及版本或灰掉的按钮时，区分桌面版本、daemon 版本与 native runtime；远端主机的能力可能不同于本机。用户只需操作步骤时，给最短可执行路径；解释机制时再展开。
3. 本手册按 2026-10-17 的源码核对（公开发布：cutex 0.1.3、桌面 0.1.3、cute-codex 0.160.0-r52.3）。功能是否存在以主机的 cutex 能力（capability）为准，不要按版本号推断，也不要从旧版 CLI 的存在推断新能力已部署。「设置」（Settings）→「主机」（Hosts）→「诊断」（Diagnostics）可以列出能力。手册写明“尚未决定 / 没有正式说明”的地方，如实告诉用户，不要自己补步骤。
4. 每份 reference 末尾列出源码依据：桌面路径相对桌面仓库，`cutex` 前缀的路径相对 daemon 仓库。源码不存在时不要假称已读；按手册已确认的范围作答，缺失处说明限制。实现与旧设计草案冲突时以当前实现和能力为准；界面文字与用户眼前的不一致时，以用户的界面为准。
5. 需要诊断时先使用 [CLI 查询](references/cli.md) 和界面状态。不要为解释错误而重启 daemon、停止工作 agent、重放请求或重置状态。用户明确要求修复时在已授权范围内执行，不重复索取已给出的授权。
6. **凭据与密钥：**不向用户索要 API key、token 或身份密钥（`cutex-id-…`），不把它们写入聊天、命令参数或示例，也不要读用户的剪贴板。Profile 凭据由用户本人在桌面 UI 或主机终端里输入（[profiles.md](references/profiles.md)）；身份密钥由用户自己复制粘贴（[hosts-users.md](references/hosts-users.md#你名字头像和身份密钥)）。报告只保留版本、错误码和脱敏后的必要证据。

本技能不提供安装脚本，不替代项目开发规范，也不授予部署或向其他 agent 发送消息的权限。
