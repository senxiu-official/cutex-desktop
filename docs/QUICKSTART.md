# Cutex 桌面端快速上手

Cutex 桌面端是 **cutex** 的图形界面：智能体、会话、项目和模型账号都由 cutex（一个常驻后台服务）管理，
桌面端只负责显示和操作。所以每台电脑都要 **先装 cutex，再装桌面端**，桌面端会自动连接本机的 cutex。

> 完整的安装步骤（cutex、cute-codex、后台服务和桌面端，英文）在
> [`docs/install/AGENT-INSTALL.md`](https://github.com/senxiu-official/cutex-desktop/blob/release/docs/install/AGENT-INSTALL.md)。那份说明也写给编程助手（如 Claude Code、
> Codex）照着执行：可以直接把它交给你的编程助手。本文只是桌面端的简要说明。

支持 Windows（x64）和 Linux（x64）。macOS 只有桌面端：通过 SSH 连接你自己的一台运行 cutex 的 Linux /
Windows 电脑。

## 1. 安装桌面端（便携版）

两种装法，都不写注册表、不需要管理员权限：

- **签名的发布包**（推荐，约 15 分钟，不用编译）：从
  [GitHub Releases](https://github.com/senxiu-official/cutex-desktop/releases) 下载对应平台的包
  （Linux `.tar.gz`，Windows / macOS `.zip`）和它的 `.minisig`，用 minisign 验签后解压到
  `<安装目录>/releases/<版本>`，再把 `current` 指向它。具体命令见 AGENT-INSTALL.md 的 B 节（B.1 下载验签，
  B.4 安装桌面端）。
- **从源码构建**：从公开仓库 `https://github.com/senxiu-official/cutex-desktop` 的 `release` 分支在本机构建，
  命令见 AGENT-INSTALL.md 第 7 节：

```sh
git clone --branch release https://github.com/senxiu-official/cutex-desktop.git <安装目录>/src
<安装目录>/src/scripts/install-portable.sh --base <安装目录> --channel release
# Windows：install-portable.ps1 -Base <安装目录> -Channel release
```

目录结构（应用内自动更新依赖它，脚本会自动建好）：

```text
<安装目录>/
  releases/<版本>/        解压出来的包（里面有 cutex.exe / cutex）
  current                 指向正在用的版本（Windows：目录联接；Linux：符号链接）
  channel                 一行文字：release（跟随的更新分支，见第 4 节）
  src/                    只有源码安装才有：自动更新用的源码仓库（见第 4 节）
```

- **Windows**：默认 `%LOCALAPPDATA%\Programs\cutex-desktop-app`。第一次启动会建开始菜单快捷方式 “Cutex”，
  之后应用自己维护它。下载的包第一次启动时 SmartScreen 会提示，见 AGENT-INSTALL.md B.6。
- **Linux / macOS**：默认 `~/Applications/cutex-desktop`，运行 `current/cutex`（macOS：
  `open current/Cutex.app`）。Linux 的托盘图标需要桌面环境支持 StatusNotifier / AppIndicator（GNOME
  需要 AppIndicator 扩展）；没有托盘时，在 设置 → 通用 → 关闭窗口时 选「退出」。

## 2. 第一次启动

1. **cutex 还没装**：主界面会显示「这台电脑上还没有 cutex」和安装步骤。按 AGENT-INSTALL.md 装好并启动
   cutex 后，桌面端每隔几秒自动重试，连上就好，不用重启桌面端。
2. **cutex 装了但没运行**：显示「cutex 没有在运行」。启动 cutex 的 management 服务（AGENT-INSTALL.md 里有
   这一步）即可。
3. **连上了**：左上角显示本机名和绿色圆点。先到 **设置 → Profile** 添加模型账号，然后点左侧
   「新建智能体」开始。

桌面端默认连接本机 cutex（`127.0.0.1:24270`，地址和令牌从 cutex 自己的配置里读取，不需要手动填写）。

## 3. 连接另一台电脑上的 cutex（可选）

如果你在另一台机器（比如工作站或服务器）上也装了 cutex，可以从桌面端连过去：

设置 → 主机 → 「添加 SSH 主机…」，填 `用户名@主机`（使用你现有的 SSH 密钥 / `~/.ssh/config`）。
桌面端通过 SSH 隧道连接，并通过 SSH 在远端自动配对，不需要开放额外端口。

只连接你自己的机器。左上角的主机切换器可以在多台主机之间切换，或同时看多台。

## 4. 更新

设置 → 更新与诊断 显示当前版本、更新通道和更新状态。有新版本时「设置」旁边出现「更新」按钮，点一下即可。

- **发布包安装**（按 B.4 装在 `releases/<版本>` + `current` 下）：应用会定期查询
  `senxiu-official/cutex-desktop` 的最新 GitHub Release；「更新」会下载新包，用内置的发布公钥验证签名和
  SHA-256，解压成新的 `releases/<版本>`，切换 `current` 并重启。新版本 25 秒内没起来会自动切回旧版本。
  只需要能访问 github.com（走系统代理设置），不需要 git 或 Node。不在这个目录结构里的包（比如把
  `Cutex.app` 拖到了「应用程序」）不能自己更新，页面上会给出发布页链接，按 B.5 手动更新。
- **源码安装**：应用定期检查 `<安装目录>/src` 跟随的分支（`release`）；「更新」会拉取、构建、打包新版本并
  重启，失败时保持旧版本不变。需要本机有 git、Node 24 和 corepack，`src` 没有本地改动。手动更新：在
  `<安装目录>/src` 里 `git pull --ff-only origin release`，再运行一次 `install-portable` 脚本。
- 更新通道写在 `<安装目录>/channel` 文件里（一行，例如 `release`）。
- 页面显示「不支持自动更新」时，下面会写原因（例如开发运行、连不上更新源），不会反复弹提示。

cutex 本身（后台服务）的更新在 设置 → 后端更新：签名的 cutex 发布版本会在没有智能体工作时自动切换并检查，
失败会自己回滚；也可以在主机上运行 `cutex upgrade check` / `cutex upgrade apply`。

## 5. 日志在哪里

桌面端的数据目录（userData）：

| 系统 | 位置 |
|---|---|
| Windows | `%APPDATA%\Cutex` |
| Linux | `~/.config/Cutex` |
| macOS | `~/Library/Application Support/Cutex` |

- `logs/errors.jsonl`：界面上出现过的错误（含 cutex 错误码和详情），超过 2 MB 轮转为 `errors.1.jsonl`。
  设置 → 更新与诊断 → 「打开日志文件夹」可以直接打开。
- `update.log`：自动更新的每一步输出。
- cutex 自己的日志见 AGENT-INSTALL.md。

## 6. 反馈问题

在 GitHub 上提 issue（[cutex-desktop](https://github.com/senxiu-official/cutex-desktop/issues)，后台服务的问题提到
[cutex](https://github.com/senxiu-official/cutex/issues)），请附上：

- 桌面端版本：设置 → 更新与诊断 → 当前版本；cutex 版本：在主机上运行 `cutex --version`；
- 操作系统和版本；
- `logs/errors.jsonl`（发出前看一眼，删掉不想分享的路径或内容）；
- 能复现的步骤和截图。

不要在反馈里贴 API Key、令牌或 cutex 的 `config.json`。

## 7. 许可

本项目以 Apache License 2.0 发布（`LICENSE`）。桌面端里包含改编自 ZCode（Apache-2.0）等项目的代码，见
程序目录里的 `NOTICE`、`LICENSES/` 和 `THIRD_PARTY_NOTICES.md`。

---

## English (short)

Cutex desktop is the GUI for **cutex**, a background service that owns agents, sessions, projects and
model accounts. The full install guide
(cutex, cute-codex, services and the desktop) is [`docs/install/AGENT-INSTALL.md`](https://github.com/senxiu-official/cutex-desktop/blob/release/docs/install/AGENT-INSTALL.md);
a person or a coding assistant can follow it. Windows x64 and Linux x64; macOS runs the desktop only,
connected over SSH.

1. **Install**: either download the signed package for your platform from the
   [GitHub Releases](https://github.com/senxiu-official/cutex-desktop/releases), verify it with minisign
   and unpack it into `<base>/releases/<version>` with `<base>/current` pointing at it (AGENT-INSTALL
   section B), or build from source: clone the `release` branch into `<base>/src` and run
   `scripts/install-portable.sh --channel release` (Windows: `install-portable.ps1 -Channel release`).
2. **First run**: without cutex the main area says "cutex is not installed on this computer yet" with the
   steps; with cutex stopped it says "cutex is not running". The app retries every few seconds and
   connects to the local cutex on its own (address and token come from cutex's config). Once connected,
   add a model account under Settings → Profile and click "New agent".
3. **Other machines of yours** (optional): Settings → Hosts → "Add SSH host…" (`user@host`); the app
   tunnels over SSH and pairs through it, no extra port needed.
4. **Updates**: Settings → Updates & diagnostics shows the version, channel and status; an **Update**
   button appears next to Settings when there is a new version. Package installs (releases layout of
   B.4) download the next GitHub release, verify its signature and SHA-256, switch `current` and restart
   (only github.com access needed). Source installs pull `<base>/src` and rebuild (git, Node 24 and
   corepack needed). A package outside the releases layout links to the release page instead. cutex
   itself updates from Settings → Backend updates (or `cutex upgrade` on the host).
5. **Logs**: `%APPDATA%\Cutex` (Windows), `~/.config/Cutex` (Linux) or
   `~/Library/Application Support/Cutex` (macOS): `logs/errors.jsonl`,
   `update.log`. Settings → Updates & diagnostics → "Open log folder".
6. **Reporting issues**: GitHub issues on
   [cutex-desktop](https://github.com/senxiu-official/cutex-desktop/issues) (daemon problems:
   [cutex](https://github.com/senxiu-official/cutex/issues)); attach the desktop and cutex versions, OS,
   `errors.jsonl` (review it first) and steps / screenshots. Never include API keys, tokens or cutex's
   `config.json`.
7. **License**: Apache-2.0 (`LICENSE`); third-party notices in `NOTICE`, `LICENSES/` and
   `THIRD_PARTY_NOTICES.md` in the app folder.
