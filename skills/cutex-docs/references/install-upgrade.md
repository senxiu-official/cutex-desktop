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

## 首次安装：两种装法

两种装法装出来的东西一样，命令都以 AGENT-INSTALL 为准：

- **签名的发布二进制（推荐，§B）**：约 15 分钟，不用编译器。从 GitHub Releases 下载 cutex、cute-codex（native 运行时文件）和桌面端的包，逐个用 minisign 验签（B.1；验签失败的文件不能用），然后 B.2 用 `cutex service install` 装成**托管安装**、B.3 装运行时文件并选定运行时清单、B.4 把桌面端解压到 `<安装目录>/releases/<版本>` 并建 `current`。三个包的版本以 AGENT-INSTALL §B 的版本表和 cutex 发布的 `manifest.json` 为准，不要自己混搭。
- **从源码构建（§2–§7）**：三个公开仓库都用 `release` 分支：先决条件（§1）→ 拉代码（§2）→ 构建 cute-codex（§3，必须从 LF 的 `git archive` 导出构建）→ 构建 cutex（§4）→ 建 `~/.cutex` 与令牌、`cutex service install`、选定运行时清单（§5）→ 启动并检查（§6）→ 装桌面端便携版（§7）。

两种装法共同的验收与边界：

- 最后由**用户本人**在桌面里添加第一个 Profile（§8）。API key 只由用户在桌面「Profile」编辑页的密码框里输入；ChatGPT 登录在浏览器里完成。执行安装的 agent 到 §8 必须停下来交给用户。不要打印 `~/.cutex/config.json` 或任何 `auth.json`。
- 连接验收：桌面左上角的主机切换器显示本机且为绿色圆点。未装或未运行时，界面分别显示「这台电脑上还没有 cutex」和「cutex 没有在运行」（AGENT-INSTALL §7.3）；桌面每隔几秒自动重试，不必重启桌面。
- Windows / macOS 的桌面包没有付费代码签名证书，第一次启动时 SmartScreen / Gatekeeper 会提示，按 AGENT-INSTALL B.6 处理；命令行程序不受影响。
- 新装的默认值（新 agent 的权限、默认开关的模块等）见 [设置与默认值](settings-defaults.md#全新安装的默认值)。
- Claude Code agent 需要 Claude 运行时，「作业」页需要 Job Service：它们是 cutex 的**可选组件**，见下面的[可选组件](#可选组件claude-运行时job-service)。Codex 类 agent 不需要它们。
- NCI 远程作业在公开版本里还不能用（`docs/install/ANU.md` 顶部的说明）；手机推送 / 手机配对没有公开的手机 App。用户问到时如实说明，不要自己拼步骤。
- 外发通知（webhook）不需要单独装服务：cutex 0.1.1 起，托管安装的 Management 服务里自带通知 worker（AGENT-INSTALL §5.2），不用再运行 `cutex notify run`。手动部署（没有 `install.json`）的主机仍然自己运行 `cutex notify run`。
- 可选：把本技能装给用户自己的 coding agent，见 AGENT-INSTALL §13（每个桌面发布包里带一份：`<安装目录>/current/skills/cutex-docs`）。

## 可选组件（Claude 运行时、Job Service）

可选组件由 cutex 按需安装、随后端更新一起升级、可以移除。需要 cutex 0.1.1 起（capability `components`），并且只在**托管安装**上可用（`cutex service install` 装的；手动部署的主机返回 `unmanaged_install`，界面提示按指南手动设置）。

| 组件 | 给谁用 | 平台 | AGENT-INSTALL |
|---|---|---|---|
| `claude-runtime` | Claude Profile 上的 agent | Linux、Windows | §6.1 |
| `job-service` | 「作业」（Jobs）页：agent 启动的长时间后台作业 | 仅 Linux（systemd 用户单元 `cutex-job-service.service`） | §6.2 |

**安装：**

- 桌面：需要组件的地方会出现安装卡片——「作业」页（Job Service）；Claude Profile、Claude 账户、新建 agent 页（Claude 运行时，未就绪时不能新建 Claude agent）。点「安装」（Install），由主机上的 cutex 下载、校验签名版本并完成设置；卡片显示当前步骤。主机的 cutex 太旧时卡片提示先更新 cutex（「打开 主机后端更新」（Open Host backend updates））。
- 命令行（在主机上）：发布二进制安装用 `cutex component install <name>`；源码安装没有签名清单，界面只给命令，要用 `cutex component install <name> --from-source <cutex 源码目录>`。先用 `--dry-run` 预览也可以。
- 查看：`cutex component list`、`cutex component status <name>`（JSON）。`state` 为 `ready` 即可用。

**`needsUser`（「…已安装，还需要你在主机上完成这些步骤」（…is installed; finish these steps on the host））：**组件已装好，但缺用户自己的东西。`steps` 列出要做的事，做完后点「重新检查」（Check again）或再运行一次 install（已准备好的环境会复用）。

- Claude 运行时：`python_missing` / `python_too_old` / `python_venv_missing` → 装 Python 3.11+ 和 venv；`claude_cli_missing` → 用户用自己的 Anthropic 账号安装官方 Claude Code CLI（`claude`；cutex 不分发它）；`codex_runtime_missing` → 先选定 Codex 运行时（§5.3 / B.3）；`claude_login_required` → 运行时已就绪，只差登录（`cutex human claude account login default`，或添加 API key 账户，见 [Profile](profiles.md)）。
- Job Service：没有为新 agent 选定 Codex 运行时，或选定的运行时没有 `codex` CLI → 按 §5.3 / B.3 选定后再装一次。
- 不要替用户输入 Claude 登录或 API key；安装 Claude Code 和登录都由用户本人在主机终端完成。

**其他状态：**`restartPending`（新版本已就绪，等没有作业运行时自动重启生效）；`degraded`（安装或更新失败，若有旧版本则仍在用旧版本）；`external`（这个服务不是 cutex 装的，cutex 不会替换它）；`notInManifest`（当前 cutex 版本没有附带这个组件，先更新 cutex）。

**升级、移除、清理：**

- 后端更新会把已装组件一起换成新 cutex 版本对应的组件版本；组件失败不会让 cutex 更新失败或回滚。已有 agent 继续用启动时的版本，只有**新** agent 用新选定的版本。
- `cutex component remove <name>`：停止 / 取消选定，文件和数据保留（Job Service 的作业记录和输出也保留）；有作业在跑或被 agent 固定时拒绝（`jobs_running` / `component_pinned`），`--force` 才强制，属于有后果的操作，用户明确要求时才用。
- `cutex component prune <name>`：只删除没有被选定、没有 agent 固定、也不属于当前或上一个 cutex 版本的旧版本。可以先 `--dry-run`。

## 升级桌面端

位置：「设置」（Settings）→「更新与诊断」（Updates & diagnostics）。这里显示「当前版本」（Current version）、「更新通道」（Update channel）、「更新源」（Update source）和检查更新的频率。有新版本时「设置」旁出现「更新」按钮。

**发布包安装（§B.4 的 `releases/<版本>` + `current` 结构）——一键更新：**

- 应用最多每小时向 GitHub 查询一次 `senxiu-official/cutex-desktop` 的最新发布（「立即检查」马上查）。点「更新」后：下载对应平台的包和签名，用内置的发布公钥验证 minisign 签名和 SHA-256，解压成新的 `releases/<版本>`，切换 `current` 并重启。任何一步验证不过都不改动安装，按钮变成「重试更新」。
- 新版本 25 秒内没出界面或渲染进程崩溃时，自动切回原来的版本。
- 只需要能访问 github.com（走系统代理设置，像 Chrome 一样）；不需要 git 或 Node。需要用户名密码的代理暂不支持，这时按 AGENT-INSTALL B.5 手动更新。
- 不在这个目录结构里的发布包（比如解压到别处、把 `Cutex.app` 拖进「应用程序」）不能替换自己：页面显示「这是从发布包安装的版本…」（Installed from a release package…）并给出 Releases 页面链接。按 B.4 重新安装就能一键更新，或按 B.5 手动更新。

**源码安装（§7，有 `<安装目录>/src`）：**

- 跟随 `<安装目录>/src` 的 `release` 分支。点「更新」会拉取 `src`、构建新版本、切换 `current` 并重启；同样 25 秒未就绪自动回退。需要本机有 git、Node 24 和能访问 `src` 远端的网络，`src` 不能有本地改动。手动更新的命令见 AGENT-INSTALL §9。
- 「更新通道」：「正式版」（Release）跟随 `release` 分支，「开发版」（Dev）跟随 `main` 分支。普通用户用正式版。通道写在 `<安装目录>/channel`。

通用：

- 显示「不支持自动更新」（Automatic updates not available）时，下方会写原因，见 [排错](troubleshooting.md#更新器显示不支持自动更新)。
- 旧版本：除正在用的和上一个版本外，其余移到 `<安装目录>/old-releases/`，30 天后自动删除；「更新与诊断」→「旧版本」可以立即删除（AGENT-INSTALL §9）。要手动退回旧版本时，把 `current` 指回 `releases/` 里还在的上一个版本再重启应用（B.5 手动更新用的就是同样的 `current` 操作）；不要伪造打包元数据。

## 升级 cutex 与 cute-codex

**托管安装（`cutex service install` 装的，发布二进制安装都是）——在桌面里更新：**「设置」→「后端更新」（Backend updates）。有新的签名发布时，cutex 会下载、验签、准备好；应用时**等到没有 agent 在工作**才停服务、切换、启动并检查结果，检查不通过会自己回滚。页面设置里「自动下载」（默认开）只下载并预检，「空闲时自动安装」（默认关）才会自己安装。在主机上也可以手动：`cutex upgrade status`、`cutex upgrade check`、`cutex upgrade apply`（详见 cutex 仓库 `docs/backend-upgrade.md`）。

- 新版本带来的新 native 运行时先用于**新建**的 agent；已有 agent 继续用启动时固定的文件，更新提交后 cutex 再分批把空闲的旧 agent 迁过去（「运行时升级」）。不要手动覆盖 `releases/` 或 `natives/` 下的文件。
- 页面显示「这台主机不能在这里更新」（This host can't be updated from here）：这台 cutex 不是托管安装（手动启动的构建）。页面给出把它改成托管安装的命令（先 `--dry-run`）；照做后就能在这里更新。
- `no_trusted_keys`（「这个 cutex 构建没有内置发布签名公钥…」）：只出现在没有内置发布公钥的构建上（比如自己改过的分支，或 0.1.0 之前的旧构建）。从 `release` 分支重新构建一次（AGENT-INSTALL §9），之后就能用后端更新。

**源码安装也可以继续从源码升级**（AGENT-INSTALL §9）：先等所有 agent 空闲 → 两个仓库 `git pull --ff-only origin release` 并重建 → 用**新构建的** `cutex` 运行 `cutex service install --channel release --no-start` → cute-codex 有变化时复制到新的 `natives/<版本>`，写新运行时清单并 `cutex human install-runtime` → 重启服务 → `cutex --version` 与 §6 检查。

升级 cutex 后，桌面里原来显示「需要升级」的功能会自己出现：桌面按 daemon 报告的能力决定显示什么，见 [主机与用户](hosts-users.md#需要升级)。只更新桌面不会让旧 daemon 获得新能力。

**回滚 cutex：**托管安装用 `cutex upgrade rollback --dry-run` 先预览（会列出要搬开的新数据、是否跨过单向迁移），确认后去掉 `--dry-run` 执行，或在「后端更新」页面操作。跨过单向迁移的版本不能回滚。不要自己删 `~/.cutex` 下的数据或手动替换二进制。

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

- desktop `docs/install/AGENT-INSTALL.md` §B、§0–§13（可选组件 §6.1、§6.2）、`docs/install/ANU.md`、`docs/QUICKSTART.md`。
- desktop `apps/desktop/src/main/binaryUpdate.ts` / `src/shared/binaryUpdate.ts`（发布包一键更新：GitHub 最新发布、minisign + SHA-256 校验）。
- desktop `apps/desktop/src/main/updater.ts`（25 秒未就绪即回退）、`apps/desktop/src/shared/update.ts`（`resolveChannel`、`KNOWN_CHANNELS`、`UpdateUnsupportedCode`）；`modules/updater/i18n.ts` 的 `updater.channel*`、`updater.unsupported.*`、`updater.errorLog*`；`modules/backend-upgrade/i18n.ts` 的 `backend-upgrade.refusal.no_trusted_keys`、`backend-upgrade.unmanaged.*`；基础 i18n 的 `titlebar.addSsh`、`host.noLocalBackend`。
- cutex `components/README.md`、`components/claude-runtime/README.md`、`components/job-service/README.md`；`src/components/`（`claude_runtime.rs` 的 needsUser 代码，`job_service.rs` 的 `probe`）；desktop `lib/componentCard.ts`、`modules/i18n.ts` 的 `modules.component.*`。
- cutex `docs/backend-upgrade.md` §1（`service install` 布局、通知 worker）、§4（apply）、§5（rollback）、§7（scheduler 默认值）；`src/upgrade/keys.rs`（内置公钥）；`src/upgrade/supervisor.rs`（Windows 日志目录 `runtime/services`）。
