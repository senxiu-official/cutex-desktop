# 安装、升级、回滚与日志

适用：用户问怎么装 cutex / 桌面端、怎么更新、更新失败怎么办、日志在哪里。界面引文写作「中文」（English）。

**唯一的安装说明**是桌面仓库的 `docs/install/AGENT-INSTALL.md`（英文，写给人或 coding agent 逐步执行）；可选模块（Claude Science、NCI 远程作业）另见 `docs/install/ANU.md`；中文简版是 `docs/QUICKSTART.md`。本页只帮你理解和定位，**安装 / 升级的具体命令以 AGENT-INSTALL 为准**，不要自己拼命令，也不要编造下载地址或安装包：两种装法都以 AGENT-INSTALL 为准——用 GitHub Releases 上签名的发布二进制（§B，下载后用 minisign 验签），或从公开仓库的 `release` 分支在自己电脑上构建。

## 平台

| 系统 | 能装什么 |
|---|---|
| Linux x64（systemd 用户会话） | cutex daemon、agent 运行时、桌面端 |
| Windows 10 / 11 x64 | cutex daemon、agent 运行时、桌面端 |
| macOS | **只有桌面端** |

### macOS：只有桌面端

cutex 的 agent 运行时不支持 macOS，所以 Mac 上只装桌面端，没有本机后端。cutex 装在用户自己的一台 Linux 或 Windows 机器上，Mac 通过 SSH 连过去（主机切换器 →「添加 SSH 主机…」（Add SSH host…）；AGENT-INSTALL §7.4）。因此 Mac 的主机列表里没有「本机」（This computer），新建 agent 时也只能选这些 SSH 主机；「设置」（Settings）→「主机」（Hosts）会说明这一点。用户问「Mac 上怎么启动 cutex / 为什么没有本机」时按这里回答，不要让用户在 Mac 上装 cutex 服务。

## 首次安装：顺序与验收

按 AGENT-INSTALL 的章节顺序：先决条件（§1）→ 拉三个仓库的 `release` 分支（§2）→ 构建 cute-codex（§3，必须从 LF 的 `git archive` 导出构建）→ 构建 cutex（§4）→ 建 `~/.cutex` 与令牌、`cutex service install`、选定运行时清单（§5）→ 启动并检查（§6）→ 装桌面端便携版（§7）→ 由**用户本人**在桌面里添加第一个 Profile（§8）。

- 三个仓库都用 `release` 分支：它们一起发布、一起测试。这就是兼容组合的约定；没有更细的版本对照表。
- 凭据：API key 只由用户在桌面「Profile」编辑页的密码框里输入；ChatGPT 登录在浏览器里完成。执行安装的 agent 到 §8 必须停下来交给用户。不要打印 `~/.cutex/config.json` 或任何 `auth.json`。
- 连接验收：桌面左上角的主机切换器显示本机且为绿色圆点。未装或未运行时，界面分别显示「这台电脑上还没有 cutex」和「cutex 没有在运行」（AGENT-INSTALL §7.3）；桌面每隔几秒自动重试，不必重启桌面。
- 新装的默认值（新 agent 的权限、默认开关的模块等）见 [设置与默认值](settings-defaults.md#全新安装的默认值)。
- Claude Code agent 需要单独的 Claude 运行时（cutex 仓库的 `claude-adapter`，`cutex human claude install`）。AGENT-INSTALL 只覆盖 Codex 类 agent；Claude 运行时目前没有写给同事的正式安装说明，遇到时请用户联系邀请他的人。
- 可选：把本技能装给用户自己的 coding agent，见 AGENT-INSTALL 的 “Optional: this manual for your own coding agent” 一节。

## 升级桌面端

桌面端是**自更新的便携安装**：`<安装目录>/src`（cutex-desktop 的 git 克隆）、`releases/<hash>/`（每次更新一份）、`current`（指向正在用的版本）、`channel`（一行，跟随的分支）。

- 位置：「设置」（Settings）→「更新与诊断」（Updates & diagnostics）。这里显示「当前版本」（Current version）、「更新通道」（Update channel）、「更新源」（Update source）和「检查更新」（Check for updates）的频率。
- 通道：「正式版」（Release）跟随 `release` 分支，「开发版」（Dev）跟随 `main` 分支。同事的安装用正式版。切换后立即检查；换到较旧的版本也要点「更新」才会安装，不会自己降级。通道写在 `<安装目录>/channel`；没有这个文件时用打包时记录的通道，再没有就是 `main`。
- 有新版本时「设置」旁出现「更新」按钮：点一下会拉取 `src`、构建新版本、切换 `current` 并重启。新版本 25 秒内没出界面或渲染进程崩溃时，会自动切回原来的版本；旧的 `releases/<hash>/` 保留。需要本机有 git、Node 24 和能访问更新源的网络。
- 显示「不支持自动更新」（Automatic updates not available）时，下方会写原因：开发运行、安装没有更新源、没有 git、暂时连不上更新源（会自动重试，也可点「重试」（Retry））、更新源上还没有这个通道的分支（「这个通道还没有发布」（This channel has not been published yet））、或不在 `<目录>/releases/<版本>` 结构下。手动更新的命令见 AGENT-INSTALL §9（在 `src` 里 `git pull --ff-only origin release`，再重跑 `install-portable` 脚本）。详见 [排错](troubleshooting.md#更新器显示不支持自动更新)。
- 手动退回某个旧的 `releases/<hash>/` 没有正式步骤；需要时请用户联系维护者，不要手改 `current` 链接或伪造打包元数据。

## 升级 cutex 与 cute-codex

现在只能**从源码升级**（AGENT-INSTALL §9）。「设置」→「后端更新」（Backend updates）页面是给签名发布包用的；还没有发布签名公钥之前，它显示 `no_trusted_keys`（「这个 cutex 构建没有内置发布签名公钥…」），这是预期状态，不是故障。

步骤概要（命令以 AGENT-INSTALL §9 为准）：

1. 先等所有 agent 空闲。重启 daemon 不会丢 agent 和会话，但会打断正在运行的 turn。
2. 两个仓库 `git pull`，重建 cutex；cute-codex 有变化时也重建 native 文件。
3. 用**新构建的** `cutex` 运行 `cutex service install --channel release --no-start`：它新增 `releases/dev-<新 commit>` 并让服务指向它，旧目录保留。
4. cute-codex 有变化时，把新文件复制到 `natives/<新版本>`；写新的运行时清单，再运行 `cutex human install-runtime`。这只影响**新建**的 agent；已有 agent 继续用启动时固定的文件，所以旧的 `releases/` 和 `natives/` 目录不要删、也不要覆盖。
5. 重启服务（Linux：`systemctl --user restart …`；Windows：注销再登录，或结束并重新运行计划任务 `\Cutex\cutex-supervisor`），再用 `cutex --version` 与 AGENT-INSTALL §6 的检查验收。

升级 cutex 后，桌面里原来显示「需要升级」的功能会自己出现：桌面按 daemon 报告的能力决定显示什么，见 [主机与用户](hosts-users.md#需要升级)。只更新桌面不会让旧 daemon 获得新能力。

**回滚 cutex：**AGENT-INSTALL 没有给源码安装写回滚步骤。cutex 带有 `cutex upgrade rollback --dry-run` 预览，但它是为签名发布流程设计的，在源码安装上的用法还没有写进正式说明。需要回滚时请用户联系维护者，不要自己删 `~/.cutex` 下的数据或手动替换二进制。

## 卸载

见 AGENT-INSTALL §12：桌面端删安装目录和它的数据目录；cutex 先 `cutex service uninstall`（只删服务，不删数据），再删安装基目录。`~/.cutex` 存着所有 agent、对话、Profile 和凭据，只有用户明确要全部删除时才删。

## 日志在哪里

| 什么 | 位置 |
|---|---|
| 桌面端界面错误 | 桌面数据目录下的 `logs/errors.jsonl`（超过 2 MB 轮转为 `errors.1.jsonl`）；「设置」→「更新与诊断」→「打开日志文件夹」（Open log folder） |
| 桌面端自动更新 | 同一数据目录下的 `update.log` |
| 桌面数据目录 | Linux `~/.config/Cutex`，Windows `%APPDATA%\Cutex`，macOS `~/Library/Application Support/Cutex` |
| cutex 服务（Linux） | `journalctl --user -u cutex-management-api.service`（另一个服务是 `cutex-agent-bus.service`） |
| cutex 服务（Windows） | `%USERPROFILE%\.cutex\runtime\services\management.log` 与 `agent-bus.log` |

分享日志前先让用户检查并删掉路径、名字等不想公开的内容；不要附 API key、令牌、`config.json` 或 `auth.json`。

## 依据

- desktop `docs/install/AGENT-INSTALL.md` §0–§12、`docs/install/ANU.md`、`docs/QUICKSTART.md`。
- desktop `apps/desktop/src/main/updater.ts`（25 秒未就绪即回退）、`apps/desktop/src/shared/update.ts`（`resolveChannel`、`KNOWN_CHANNELS`、`UpdateUnsupportedCode`）；`modules/updater/i18n.ts` 的 `updater.channel*`、`updater.unsupported.*`、`updater.errorLog*`；`modules/backend-upgrade/i18n.ts` 的 `backend-upgrade.refusal.no_trusted_keys`；基础 i18n 的 `titlebar.addSsh`、`host.noLocalBackend`。
- cutex `docs/backend-upgrade.md` §1（`service install` 布局）、§5（rollback）；`src/upgrade/supervisor.rs`（Windows 日志目录 `runtime/services`）。
