# Desktop module contract (v1.31)

This document describes the module host, its trust boundaries and the public API.
For a complete authoring guide and generated API reference, see
[Writing a module](module-authoring.md). The API version is `MODULE_API_VERSION`;
it is independent of the desktop release version.

## 1. Scope and trust

Built-in modules, signed first-party packs and owner-installed modules use the same
registry and lifecycle in the application renderer. A local or third-party module
has the application's trust: it can access application data, send messages as the
owner and run commands on connected hosts. It is not sandboxed. Main requires native
owner confirmation before enabling local modules or loading their code. There is
no permission checklist that could restrict code within this renderer.

The public API is the supported compatibility surface, not a security boundary.
Third-party Node code never runs in main. Main implements fixed file services;
modules cannot extend main with arbitrary handlers, windows or network services.

The former opaque-frame plugin installation feature is retired. Its sandbox package
remains frozen with its own tests and is not imported by the application. Opaque
frames continue to display agent HTML artifacts and HTML files (§10.2).

## 2. Definitions and contributions

A module exports `defineModule({ id, titleKey, descriptionKey, requires,
defaultEnabled, contributes, activate })`. Its id matches
`^[a-z][a-z0-9-]{0,63}$`; each contribution id starts with `<moduleId>.` and is
unique in its slot. Static items belong in `contributes`; dynamic items use
`ctx.contribute(slot, item)`, which returns a disposer.

The public package has three entries: `@cutex-desktop/module-api`, `/ui` and
`/experimental`. React and React DOM are supplied by the app. Ordinary bundled
libraries are allowed. The third-party builder rejects app internals, unsupported
host imports, a second React copy and files outside the module directory unless
they belong to `node_modules`.

## 3. Public slots

Stable slots are `nav.primary`, `main.page`, `settings.page`, `settings.section`,
`conversation.status`, `timeline.codeBlockAction`, `ref.action`, `notify.method`,
`tray.entry`, `identity.menu` and `desktop.widget`. Their full item types and
component props are in the [authoring reference](module-authoring.md).

The tray is the avatar strip beside a conversation or on the home screen, distinct
from the operating system tray. A contribution may be rendered in several places
and app windows. New navigation entries start in More; the owner chooses pins.
Pages follow the owner's page-opening preference and must work at Shelf width.

## 4. Capabilities and requirements

`requires.capabilities` names host capabilities and `requires.modules` names
module dependencies. Requirements govern availability and activation order;
they do not grant or restrict security permissions. Capability data is supplied
by the daemon. The desktop does not duplicate daemon business state.

## 5. Preferences

`ctx.prefs` and `useModulePref(id, key, fallback)` store small JSON values on this
device under the module id. Values survive restarts, upgrades and removal. JSON
values only are supported; invalid values throw. Storage is shared with the app,
has no per-module quota and is suitable for tens of kilobytes, not growing files.
A browser quota failure can lose a write without reporting an error. Use the
module data service for larger data (§30.6).

## 6. Lifecycle

The host activates eligible modules and restarts them when their host scope
changes. `ctx.signal` aborts on stop. Scoped subscriptions, requests and dynamic
contributions end automatically. Modules must stop their own timers and listeners.
Activation has a time limit; do not wait for network work in `activate`.
Hook fields such as `useTitle` are invoked in host-owned React components.

## 7. Services

Stable services include `ui`, `panes.open`, `agents` and `activity`. Components can
import `services`; activation code should use `ctx.services` for automatic cleanup.
`data` and `files` exist only on `ctx.services` because they require module scope.
`ui.toast` works across application screens; `ui.notice` appears only above the
currently displayed conversation input. Neither reaches a hidden application.
The public hooks include `useAgents`, `useHosts`, `useI18n` and `useModulePref`.

## 8. Package boundaries

`plugin-sdk` and `plugin-host` are private source-export packages for the contract
and lifecycle. They contain no React, Electron, daemon protocol or second module
engine. External modules use the public `module-api` package. Its generated host
table and compile-time compatibility checks connect its types to the application.

## 9. Compatibility

`pack.json` declares `id`, `version`, `moduleApi` and optional `author` in a source
module. `moduleApi` is `^major.minor`. Stable API additions increase the minor
version; incompatible changes increase the major version. `/ui` props are stable;
`/experimental` has no compatibility promise and is marked as such in Settings.
Versioned declarations are reviewed in `packages/module-api/api/`.

## 10. Opaque frames

The retired opaque-frame plugin loader does not load user modules. Historical
plugin files and preferences are retained without being read or automatically
deleted. Future MCP Apps integration is not a current protocol guarantee.

### 10.2 Agent pages and HTML files

Untrusted HTML uses `sandbox="allow-scripts"` without `allow-same-origin`,
`referrerpolicy="no-referrer"` and disabled device, clipboard, fullscreen and
payment permissions. It has no preload, Node, credentials or arbitrary daemon RPC.
Every document receives the following offline policy:

```text
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none';
object-src 'none'; frame-src 'none'; child-src 'none'; worker-src 'none';
manifest-src 'none'; base-uri 'none'; form-action 'none'
```

There is no network, including loopback, and no `unsafe-eval`. Main installs
Chromium egress lockdown before serving documents, including WebRTC defenses.
Documents are served once through the shared `cutex-plugin:` store after main
obtains bytes from the selected host. Pending documents expire after 30 seconds;
the store caps pending documents at 32 total and 8 per renderer. Navigation leases
are tied to the drawing window and revoked on release or window closure.

Agent HTML pages alone receive `window.cutexPage`, a wrapper for three fixed-schema
postMessage channels. The broker checks the frame window and opaque `null` origin;
main revalidates requests against its own host/artifact/version binding:

- Storage: `get`, `set`, `remove`, `keys`, `clear`; 5 MiB per artifact shared by
  versions, 200 MB soft aggregate limit, `quota_exceeded` on excess and no eviction.
- Submit: the artifact's producer determines the recipient. Main's native owner
  confirmation is required for every send; cancellation sends nothing. Hidden or
  minimized windows cannot prompt. One prompt per window, a five-minute timeout,
  a five-second cooldown and at most five prompts per artifact in ten minutes apply.
- Copy: text only, during a user gesture with focus in that frame; no clipboard
  reads. Each frame can copy at most once per 500 ms.

Requests have exact schema fields, at most eight concurrent calls per frame,
keys at most 256 characters without controls, messages at most 5 MiB, submissions
at most 64 KiB and copied text at most 1 MiB. See the
[page bridge design](design/004-artifact-page-bridge.md).
HTML file previews use the same offline document and CSP with no page channels.
Pages over 4 MiB require an explicit display choice; the hard maximum is 256 MiB.
Services requiring network access open in browser tabs under the browser policy.

## 23. Module packs

Signed first-party packs are verified in main against the release key, signed
index, file hashes and compatibility metadata. The download channel is untrusted;
installed files are verified again on startup and when served. Index serials do
not roll back. Updating a pack hot-replaces its definition through the same host,
with fallback to the built-in version when available.

The `cutex-module:` scheme serves only verified pack entry scripts and styles
to the app main frame. It does not bypass CSP or support fetch; subframes, workers
and unrelated windows cannot use it. Agent and file frames remain isolated.
Pack CSS goes into the `cutex-pack` layer below app styles. Private app host imports
are for first-party builds; third-party builders use the public API.

### 23.6 Renderer host and replacement

The build rewrites supported imports into reads from the application's host table,
so modules use the app's own instances. Pack definitions enter the existing module
host by dynamic registration. A new revision stops and removes the old definition
before adding its replacement; its scoped resources follow the normal lifecycle.

### 23.12 Trust boundary

Signed packs have application trust. Local packs also have application trust,
but their admission is an explicit native owner decision rather than a release
signature. Hash verification prevents unnoticed modification; it does not make
module code safe. Ordinary same-user files are outside this admission boundary:
a process able to change the application's files can also change module files.

### 23.14 本地模块：从文件安装（v1.28）

用户可以加载自己写的或第三方的模块，所有构建都可以。本地模块和包一样跑在 app 的 renderer 里，权力等于 app 本身；这条路径不是不透明 frame 插件（§10，已退役）。

**开关。** 主进程设置「允许本地模块」，存在 `userData/modules/local.json`。主人没选过时按构建决定默认值（`localPacksDefault`）：未打包的开发运行和自己构建的包默认开；CI 发布包默认关。发布包在打包时写入 `releasePage`（`package-portable.mjs --release-page`），读不出 package.json 也算发布包。不看 `<base>/channel`，那个文件设置页能改。打开要过 main 的原生确认，关闭不用确认。关闭时不删文件，下次打开再验一遍。

**安装。** renderer 只能发 `{ op: "installLocal" }`，不带路径也不带答复。main 依次：开原生文件对话框 → 校验 → 查 id → 开原生确认 → 落盘。

- 确认框写明模块名、版本、作者（未验证）、文件位置、sha256 开头，以及它能做什么。没有权限声明清单：模块拿到的就是 app 的全部权力，列清单只会误导。
- 安装按钮要和复选框「我信任 <id>，要安装它」一起才算数；默认按钮是取消。只按安装不勾选会再问一次。Electron 的原生对话框不能输入文字，所以不是打字确认。
- 名字和作者来自文件本身，进对话框前去掉换行和方向控制符并截短，不能伪造对话框内容。

**校验。** 和签名包同一套：`readTar`、`LIMITS`、`parseIndexPack`、`packCompat`，宿主导入照样由 renderer 的 `checkHostImports` 查。`pack.json` 必须在包里，只收 `id`、`version`、`moduleApi`、`entry`、`styles`、`host`、`title`、`description`、`author`。文件名不起作用。

**id。** 不能用内置模块的 id（`BUILT_IN_MODULE_IDS`，测试保证和 `registry.ts` 一致），不能用已装的签名模块的 id，也不能用索引里已发布的 id；都会拒绝并写明原因。离线查不到索引时只查前两项。之后发布了更高版本的签名包，按普通规则更新，信任记录随之删除。renderer 的 `packDecision` 也拒绝本地包覆盖内置模块。

**信任记录。** `local.json` 的 `trust[id]` 记版本、压缩包 sha256 和每个文件的哈希。`verifyInstalled` 接受好签名，或者「目录里完全没有 `.signed/` 且记录版本相符」，两者都逐文件比哈希。文件变了：启动时进 `broken`，运行中协议 404 并标 `broken`；要回来只能重新从文件安装，再确认一次。

**标记。** 设置 → 模块的 `本地安装 vX · 作者未验证`，侧边栏入口和页面标题的 `本地安装`（`LocalBadge`）。移除由 main 的原生对话框确认，同时问保留还是删除它的数据（v1.31，§30.6）。

**安全启动。**

- 启动参数 `--no-local-modules`：这次不加载任何本地模块，不消耗计数。
- 连续 `LOCAL_FAILED_STARTS`（3）次启动都没撑到健康（主窗口 30 秒内没有崩溃或无响应），下一次不加载本地模块，设置页说明原因；再下一次重新尝试。
- 本地模块导入或激活失败：`localFailed` 让 main 把它停用，重启后仍然停用，原因显示在设置页，重新从文件安装才清除。这个请求只能停用模块，不能启用模块。

**已知限制。**

- `local.json` 和模块目录都是普通用户文件。和主人同一用户身份运行的程序（包括主机上有 shell 的智能体）能直接写它们，从而绕过确认。这和它们能改 app 自身文件是同一层问题，这里不声称能挡住。挡住的是 renderer、页面和 app 内的请求。
- Shift 启动没有做：main 启动时读不到按键状态，要加原生调用。
- 模块把界面弄坏但不崩溃、不无响应时，30 秒后算健康，不会触发安全启动；这时用启动参数。

### 23.x v1.27：只发包的模块和包内图片

- `pack.json` 的 `packOnly: true`：模块只以模块包发布，不进 `registry.ts`；`packVersions.ts` 跳过它，所以它不算「内置版本」，包才能安装。
- 模块目录下的 `art/`：构建时带进包。`art/manifest.json` 的 `images` 必须逐张列出 `{ path, source: "generated", tool, prompt }`；没登记的文件、非 PNG、缺提示词都让构建停下。
- 数据文件和代码一样由已验证的包清单约束：`modulePacks.ts` 的 `dataPaths` / `dataFile` 只交给主进程里同一个模块的服务，不经协议提供给页面，没有任意路径读取。


## 29. 桌宠 `desk-pet`（v1.27，模块包，默认关）

桌宠用动作或读书场景表现智能体的活动（§29.6、§29.9）；下面显示今天的 token 数；有事等主人时头上冒感叹号（§29.7）。**模块只发包**（`packOnly`），应用里只有不含宠物逻辑的窄服务：窗口服务 `main/deskPet.ts`（`shared/deskPet.ts`、`preload/deskPet.ts`、`renderer/desk-pet.html`、`renderer/src/deskPet/`）和事件服务 `lib/activityFeed.ts`。模块不启动时这些都不做事。

### 29.1 新插槽和服务

- `tray.entry`：`{ id, order, Button }`，画在托盘右端（`components/ChipTray.tsx`），托盘空时也在。组件自己决定显示什么；不要一直占位。
- `identity.menu`：`{ id, order, entries(): MenuEntry[] }`，左下角用户菜单「外观」之后的行。
- `services.activity`：见 §7。设置页的次数（消息、命令、工具）照旧。计数范围写明给用户：数到这台桌面发的消息和已连接主机上的命令、工具调用（含子智能体）；数不到未连接的主机、应用关闭期间、重连跳过的一段、其他设备发的消息、当前连接无权看到的调用。
- `services.ui.openSettings(page, { sub })`：打开设置子页（`SettingsPageItem.subPages`）。

### 29.2 窗口服务的边界

一个透明、无边框、置顶、不可聚焦、不进任务栏的窗口，应用内外同一个。主进程决定窗口的一切：只收固定操作，来源只能是应用窗口或这个窗口本身；页面不给 URL、路径、坐标或字节。窗口只加载自己的本地文档，独立 session 拒绝一切网络（回环也不行），没有 token，不暴露应用桥。透明像素用 `setShape` 放行点击（不用 `setIgnoreMouseEvents` 的 forward，它装全系统鼠标钩子）。Wayland：系统决定位置，重启不记位置，透明部分可能挡点击，右键直接是原生菜单；设置页如实说明。

置顶用 `screen-saver` 级别：默认级别在前台是全屏应用时根本不置顶，窗口落到那个应用下面。窗口总是留出宠物四周的空间（`stageBounds`），形状决定哪里绘制、哪里接点击（Windows 上形状也裁剪绘制）。扇形和气泡只改变形状，宠物不动：扇形期间整窗接点击，气泡期间只多气泡那一块。

### 29.3 回路

- 隐藏或点击穿透时回来的路不经过宠物：托盘按钮、左下角菜单、设置页。
- 模块重启（换焦点主机，§6）不闪：`stop` 等 800 ms，`start` 取消。应用窗口主框架导航或渲染进程崩溃不会触发模块 abort：主进程给 20 s，等不到 `start` 就关窗口。
- 窗口状态在 `userData/desk-pet/state.json`，计数在模块偏好，都只在这台设备。

### 29.4 角色格式

`userData/desk-pet/art/<id>/` 或包内 `art/<id>/`：`pet.json`（`format: 1`，格式 2 见 §29.9；`name`，可选 `family`、`scale`、`pixel`（像素画，最近邻缩放）；格式里没有路径）；`both.png`、`left.png`、`right.png`，可选 `face.png`、`face-blink.png`、`blink.png`、`accessory.png`。同一画布、无偏移，64–1024 像素，每张不超过 2 MiB，真 PNG、非动画，不接受链接。最多 256 个；列目录只读 `pet.json` 和每张图的文件头，预览按需生成。`family` 是 `claude`、`gpt`、`gemini`、`deepseek`、`kimi`、`glm`（`follow.ts` 从 `lib/avatarThemes` 的 `ModelFamily` 映射）。可选图标 `icon.png`（所有家族）和 `icon-<family>.png`（一个家族），正方形 32–256 像素、不超过 256 KiB，大小与帧无关，不进窗口形状（§29.8）。用户文件由用户负责；设置页不复制、不删除它们。包内自带六个角色（`art/manifest.json` 逐张记录工具、提示词和 sha256，构建时核对），默认 `claude`；未选择时新放入的文件夹不会自动顶替它。

### 29.5 左右镜像

`mirror` 按设备保存，翻转整个宠物（所有帧和眨眼），窗口形状和点击区域一起翻转，拖动照常。镜像时 `left` 姿势显示 `right` 帧（`shownPose`），所以 left 仍是屏幕上看到的左手。计数、扇形和气泡不翻转，文字不会镜像。

### 29.6 劲头和数字（v1.30）

- **计什么**：一条用量报告新增的 = 该线程累计 `total` 比上一条看到的多出的部分，按「未命中缓存的输入（含缓存写入）+ 输出」算；`reasoningOutputTokens` 已含在输出里，不另加；命中缓存的输入永远不算。不用 `last`：Claude 运行时在那里放的是上下文占用。和 cutex 用量账本同一口径。同一连接上第一次看到某线程只记基线，除非是新线程的第一条（`last = total`）；`total` 变小（回退、新计数器）重新记基线；重连（新 epoch）和 `hostResync` 也重新记基线，跳过的一段只由账本补。
- **报告频率**：运行时可能逐请求或逐轮更新累计 token；只有上下文占用变化而累计值未变的报告按 0 token 处理。
- **劲头**（`modules/desk-pet/energy.ts`，纯函数）：每条报告加 `log2(1 + tokens)`（0 token 的报告加 6），无上限；按时间常数 5 s 衰减，低于 1 停。单条报告不管多大动 9–15 s；只有报告挨得近才更久、更快。节奏随劲头线性上升，1.5–6 下/秒，30 封顶。劲头只输出等级和节奏，怎么画由别处决定（`tapper.ts` 把节奏画成左右手交替）；以后可以换成每个宠物自己的表现（§29.8 末）。计时器只在劲头大于 0 时存在。
- **兜底**：从没报过用量的智能体，它的命令和工具调用各给一份固定劲头；主人从这台桌面发消息也给一份。报过用量的智能体，命令和工具不再给劲头。
- **范围**：默认已连接主机上所有智能体；设置「只跟着打开的对话动」只看焦点主机上打开的那个。数字不受这个设置影响。
- **数字**：今天（本机日期）已连接主机上 cutex 自己的用量，同一口径。每台主机：`GET /v2/usage?from=今天&to=今天&groupBy=source` 的 `cutex` 行（不含从其他工具导入的行，`usage-external-sources`；老 cutex 不能按来源分组时用 totals），加上回答之后实时收到的报告。每小时（在下一条报告时）、重连、过零点重新问一次。数不到：未连接的主机、cutex 从其他工具导入的用量；不报缓存命中的服务商全部输入都算。账本的「今天」是守护进程所在机器的本地日，和本机时区不同的主机会错开。设置页的消息、命令、工具次数照旧保留。

### 29.7 感叹号（v1.30）

- 等主人的事和托盘提醒数一样（`lib/shell.ts` `attentionByHost`）：智能体的原生请求（提问、命令或文件改动的确认）、主人审批、尚未处理的智能体 → 主人消息（owner-notify）。智能体之间的往来（委托等）不算。`lib/ownerWaiting.ts` 逐项给出，每项带 `onScreen`（智能体在可见窗口的面板或 Shelf 页里）。
- 模块记住「主人看过」的项：某项出现后它的智能体上过屏幕，就算看过；所有项都看过时感叹号消失，新的一项再让它出现。设置「有事等你时头上显示感叹号」，默认开。
- 画在宠物头顶上方的空间里（`overheadRect`，64×60 DIP）。窗口形状只在感叹号或图标出现时包含这块（Windows 上形状也裁剪绘制）；Wayland 没有这块空间，感叹号画在图片顶部，图标不出。

### 29.8 图标（v1.30，默认关）

- 设置「来 token 时头上冒小图标」：一条有 token 的报告（在范围内、宠物没隐藏）冒一个图标，最多每 0.4 s 一个，窗口里同时最多 3 个，每个 1.1 s。用角色自带的该家族图标，没有就用 `icon.png`，再没有就是窗口自己画的一枚金币（不需要美术文件）。
- 每个宠物自己的「劲头」表现由格式 2 做（§29.9、§29.10）：身边一堆书、自己的读书动画。一次只显示一个宠物，它把所有模型的劲头都当成自己的，劲头不按模型分。

### 29.9 角色格式 2：场景

格式 1（§29.4）只能表示三只手的帧，画不了分层、呼吸、具名动作和身边的书堆。格式 2 是一份**数据**：`pet.json` 写图片、身体、手里的道具、翻页、书堆和具名片段，由宠物窗口文档里**固定的播放器**（`renderer/src/deskPet/scene.ts`）照着画。美术包是数据，不包含代码：没有脚本、没有表达式、没有自定义着色，播放器只认下面这些字段；格式 1 的角色照旧工作，两种格式可以并存。

- **解析**（`shared/deskPetScene.ts` `parseDeskPetScene`，纯函数，main、窗口文档和测试共用）：任何未知字段、越界的值、指向不存在的身体 / 道具 / 页 / 封面的引用都拒绝整套（`badManifest`），不猜、不修正。文件名只能是 `pet.json` 旁边的小写 `[a-z0-9][a-z0-9_-]*.png`，没有子文件夹，没有 `..`、盘符或反斜杠。
- **文件检查**（`main/deskPetArt.ts`）：和格式 1 同样的读法（lstat、不跟链接、限额），每张都是真 PNG、非动画；格式 2 每张每边 1–2048 像素（`badSceneDimensions`）、每张不超过 2 MiB，一套最多 256 张、合计 48 MiB、6400 万像素（`setTooLarge`）。图片之间不要求同尺寸：每张画到自己的框里。`pet.json` 最多 64 KiB。
- **加载**：main 解码每张图，按当前大小和最清晰显示器的缩放比**只缩小不放大**（每画布单位的像素数按 1/4 取整；改大小时重读），重新编码成 PNG 交给窗口，只在每个窗口、每个角色第一次时整套发送，之后只发键。窗口形状 = 角色各层 alpha 的并集 + 书堆上当前每本书的 alpha（§29.2；书数变化时重算），所以书堆也接点击、空着的地方放行。
- **大小**：「大小」量的是 `character` 框的长边（100% = 160 DIP）；画布比角色大的部分（书堆）随之放大，320 × 256 的画布、256 × 256 的角色在 100% 时是 200 × 160 DIP。感叹号和图标画在角色框的正上方，不是画布中间。

```json
{
  "format": 2,
  "name": { "en": "Reader", "zh-CN": "读者" },
  "family": "claude",
  "scale": 1, "pixel": false,
  "canvas": [320, 256],
  "character": [0, 0, 256, 256],
  "breathMs": 3600,
  "bodies": {
    "up":   { "still": "up.png",   "breath": ["up-0.png", "up-1.png", "up-2.png", "up-3.png"] },
    "read": { "still": "read.png", "breath": ["read-0.png", "read-1.png"] }
  },
  "props":  { "open": { "image": "book-open.png", "cover": { "quad": [[138,190],[173,182],[169,212],[138,220]], "over": "cover-over.png" } } },
  "pages":  { "lift": "page-lift.png", "land": "page-land.png" },
  "hands": "hands.png",
  "sparkle": { "image": "sparkle.png", "size": [10, 12], "at": [[96,185],[154,177]] },
  "covers": {
    "green": { "kind": "book" },
    "night": { "kind": "diary", "tint": [0.6, 0.75, 1.25], "image": "cover-night.png" }
  },
  "pile": { "image": "pile-book.png", "at": [240, 226], "size": [72, 24], "step": 7, "max": 20,
            "cover": [[13,2],[69,2],[59,12],[3,12]], "deck": [{ "cover": "green" }, { "cover": "night", "units": 2 }] },
  "clips": {
    "idle":    [{ "body": "up", "ms": 2400 }],
    "opening": [{ "body": "read", "prop": "open", "ms": 90, "magic": 0.5 }, { "body": "read", "prop": "open", "ms": 300 }],
    "reading": [{ "body": "read", "prop": "open", "ms": 3000 }, { "body": "read", "prop": "open", "ms": 140, "page": "lift" }],
    "closing": [{ "body": "read", "prop": "open", "ms": 90, "magic": 0.5 }, { "body": "up", "ms": 400 }]
  }
}
```

`pet.json` 必须是有效 JSON，不接受注释。

- **身体**：`still` 一张，`breath` 0 或 2–48 张。呼吸独立于片段：按墙钟 `breathMs` 一轮循环（同一时刻同一相位，换片段不跳），「空闲时眨眼」关掉时只用 `still`。
- **道具**：`image` 铺满角色框；有 `cover` 时这本书带封面：绿键像素按封面的 `tint` 上色，封面图投影到 `quad`（角色框单位，四角顺时针，8 × 8 网格的双线性投影），然后 `over`（手指等挡在封面前的部分）盖在上面。
- **一帧**：`body`（必填）、`prop`、`ms`（16–60000）、`magic`（0–1，道具在出现 / 消失：道具按这个透明度画，`hands` 盖在上面，`sparkle` 按 sin(π·magic) 闪）、`page`（先画这张页，再画 `hands`）。画的顺序固定：身体（呼吸帧）→ 道具（封面）→ 手 / 闪光 → 页 → 手 → 书堆。
- **绿键**：`g > 1.05·r` 且 `g > 1.02·b` 且不透明的像素；上色 = 灰度 × `tint`（每个分量 0–2）。只作用于带 `cover` 的道具和书堆图。
- **书堆**：`at` 是最下面一本的左上角（画布单位），往上每本高 `step`，最多 `max`（1–20）本，整堆必须在画布里。`cover` 是书堆图自身单位里的封面四边形。`deck` 是新书依次取用的封面（循环），`units`（1–8）是一本书的厚度（§29.10）。没有 `pile` 的场景照样能用，只是没有书。
- **片段角色**（固定名字，不能自己起）：`idle`、`reading` 必填；`opening`、`closing` 可选（没有就直接切）；`fallAsleep`、`sleeping`、`wake` 三个要么都有要么都没有；`attention` 可选——**为提醒姿势保留的钩子**：感叹号亮着、没在读书时播放它，没有就只画感叹号。
- **播放规则**（窗口里决定，不需要模块参与）：有活、手上有书 → `opening`（书从堆顶升起淡出 700 ms，同时出现在手里）→ `reading` 循环。换书只在 `reading` 一轮结束时（翻完页）：`closing` → `opening` 下一本；新书在拿到手之前一直摆在堆顶。**落书**：堆顶出现窗口没见过的书（比原来堆上最高的那本还高）时，它从上方 28 单位处淡入落下 500 ms；同一次 `tick` 来的几本一起落，落书中途再来的等这一批落完；有书正从堆顶升起（700 ms）时，新书先等它升完再落到新的堆顶。还没落稳的书不会被拿走：读书不停，等它落稳后，在下一轮 `reading` 结束时再换。堆下面补上来的书（堆变矮后从没显示的部分补上）直接出现，不落。落书只改画面，不改任何数。活停了还会接着读 15 s（报告之间的短空隙不合书），然后在不是翻页的帧上 `closing` → `idle`。翻页中途从不打断；过渡片段播完才看下一步。空闲 60 s → `fallAsleep` → `sleeping`；有活或有感叹号 → `wake`。计时器只有一个，只在有变化时画（片段帧、呼吸相位、正在升起或落下的书），不跑每秒 60 帧。
- **内置示例**：包内包含原创占位角色（脚本 `apps/desktop/scripts/module-packs/desk-pet-reader.mjs` 用椭圆和圆角矩形画，`art/manifest.json` 逐张记录 sha256），演示全部字段。主人自己的角色放在设置 → 桌宠 → 打开文件夹（`userData/desk-pet/art/<id>/`），不进包、不进仓库。
- **测试**：`test/deskPetScene.test.ts`（解析、拒绝、文件名、范围、文件夹检查、按屏幕缩小、形状含书堆）、`test/deskPetScenePlayer.test.ts`（播放规则：开书、读到一轮结束才换书、翻页不打断、停工后再读一会、睡着与唤醒、`attention`、落书（一批一起、等升起的书、没落稳不拿）、只在变化时画）。

### 29.10 待消耗的 token 和书（包 1.2.1）

智能体用掉的 token 攒成「待消耗」，桌宠以干活（读书）的形式慢慢消耗掉；**书只由已入账的 token 生成**（不按空闲时间补充、不在每日开始时自动填满）。账由**模块**记（`modules/desk-pet/books.ts`，纯函数），窗口只画结果，所以重放、重连、一阵报告或动画慢了都不会多记、少记。

- **进账**：和宠物下面那个「今天的 token」同一口径（§29.6：未命中缓存的输入 + 输出，按主机，账本加实时）。每台主机每天一个游标，记着已经入账到多少；今天的数涨过游标的部分才入账，一次。重连时实时部分清零、账本还没回来，数会先掉下去：这时什么都不入账，直到数重新超过游标；账本校准替换实时部分也一样。本机日期换了，游标从 0 重新开始，余额不动。隐藏的宠物照样入账。
- **一本书**：装 `units × 每本书的 token 数`（设置项，默认 50k；可选 10k / 20k / 50k / 100k / 200k / 500k）。新 token 先装满堆顶最新的那本，再一本本放上新书（封面按 `deck` 循环，`units` 是厚度）。
- **余额无上限**：只有最上面 `max`（≤ 20）本是一本本的书，再往下的只记一个 token 数；堆变矮时从下面补成书放回堆底。设置页显示真实的余额。
- **消耗**：宠物显示着、而且有待消耗时 = 在活。按「消耗速度」（设置项，默认每分钟 50k；可选 10k / 25k / 50k / 100k / 250k / 1M）把手上的书读下去，读完一本放下、从堆顶拿下一本；耗完就停，窗口按 §29.9 再读 15 s 后合书休息，60 s 后睡着。隐藏或应用关着时不消耗（存档读回时消耗的钟从现在开始）。只有一个计时器，到手上这本读完的时刻；没有书时没有计时器。
- **旧的劲头**：格式 2 角色不敲手，劲头（§29.6）不再驱动它；旧版应用（窗口不报告 `scenes`）不认识格式 2，模块照旧敲手。
- **保存**：余额、书、游标和「今天读完」存在模块偏好 `pool`，两个设置存在 `poolConfig`（这台设备），最多 1 s 后保存。旧的 `books` 偏好存档不再读（旧存档不代表待消耗的 token）。换成别的书堆设定（`max` 或 `deck` 变了）余额不变，书按新设定重做；改「每本书的 token 数」只影响以后新放的书。
- **窗口收到的**：`tick` 的 `work`（布尔）和 `books`（`{ active: { id, cover } | null, pile: [{ id, cover }…] }`，最多 20 本，最下面在前；`id` 是 `book-<序号>`，`cover` 是封面 id），main 校验后转给窗口；落书动画（§29.9）在窗口里按 id 判断。格式 2 的美术约定没变。设置页「待消耗」显示「n token（约 m 本）· 今天读完 k 本」，在活时每秒更新。
- **事件钩子**（保留）：`controller.ts` 的 `onDeskPetEvent` 发出 `book-started`、`book-completed`（各带那本书和剩余 token）、`pile-empty` 和 `attention-changed`；现在没有人听，留给以后的提醒姿势、声音等。
- **测试**：`test/deskPetBooks.test.ts`（游标入账不重复、跨日、先装满堆顶、只留 `max` 本其余记数、只在显示时按速度消耗、读完换书、耗完、换设定保留余额、存档和设置的回退）、`test/deskPetController.test.ts`（账本的数入账、按速度读完四本后停、不补书、隐藏时只入账不消耗）。

## 30. 公开模块 API `@cutex-desktop/module-api`（v1.29；v1.31 加 §30.6）

不随 app 构建的模块只能导入这个包和 React。第一方模块包照旧可以用 `@cutex-desktop/app/*`，它们和 app 一起发布，有签名。写模块的人读 [模块作者指南](module-authoring.md)，这里写实现。

### 30.1 三个入口

| 入口 | 内容 | 承诺 |
|---|---|---|
| `@cutex-desktop/module-api` | `defineModule`、`services`、`useI18n`、`useModulePref`、`pageTitle`、`useAgents`、`useHosts`、`MODULE_API_VERSION`；类型 `ModuleContext`、`ModuleDefinition`、稳定插槽的条目 | 只加不删，不兼容的改动升主版本 |
| `@cutex-desktop/module-api/ui` | app 组件的薄包装 | props 冻结，换皮不影响模块 |
| `@cutex-desktop/module-api/experimental` | `daemonFor`、`side`、`focusTurn`、实验插槽 | 不承诺兼容；用了它的模块在设置 → 模块标「可能随应用更新失效」（按宿主导入清单判断） |

稳定插槽：`nav.primary`、`main.page`、`settings.page`、`settings.section`、`conversation.status`、`timeline.codeBlockAction`、`ref.action`、`notify.method`、`tray.entry`、`identity.menu`、`desktop.widget`。稳定服务：`ui`（notice、confirm、openPage、closePage、openSettings）、`panes.open`、`agents`、`activity`；`ctx.services` 另有 `data`、`files`（v1.31，§30.6）。

包里的值只有声明（`export declare`），没有代码。构建时每个导入变成对宿主对象的读取（同 §23.6），所以模块拿到的永远是 app 自己的实例。app 一侧的实现在 `renderer/src/moduleApi/`：`stable.ts`、`ui.tsx`、`experimental.ts`。公开类型是包自己写的一份，比 app 的类型窄，不引用 app 文件。

### 30.2 保证不漂移

- **宿主表是生成的。** `packages/module-api/scripts/generate-host.mjs` 从三个入口读出值的名字，写 `exports.json`（给构建器）和 `moduleApi/hostTable.generated.ts`（给 app）。生成的表用 `satisfies typeof 入口`，所以包里多一个名字而 app 没实现、app 多一个、类型不对，都编译不过。`packages/module-api/test` 查生成文件是最新的。
- **条目形状。** `moduleApi/compat.ts` 是编译期检查：把 app 的封闭文案 key 看成 `string` 以后，每个公开条目都要能放进 app 的插槽，app 的服务要能提供公开服务。app 改坏一个稳定插槽，这里编译不过，不用等模块加载时才发现。
- **第一方包。** `packHost.ts` 手写的那部分表照旧；`test/moduleApiHost.test.ts` 扫描每个带 `pack.json` 的模块，导入了表里没有的 app 文件就失败，不用等包构建。

### 30.3 版本

- 公开包和 app 只有一个版本号：包的 `major.minor` = `MODULE_API_VERSION`（测试保证），`pack.json` 的 `moduleApi` 按它求值。增加东西升次版本，不兼容的改动升主版本。
- API 报告：`packages/module-api/api/module-api-<版本>.d.ts`，每个版本一份，改了会在审查里看到（`node scripts/api-report.mjs`）。
- 废弃的名字至少保留一个主版本，用到时在控制台警告。实验入口每次改动在 [模块作者指南](module-authoring.md) 的更新记录里写一行。

### 30.4 第三方构建

`packages/module-api/tools/builder.mjs`，和第一方构建器共用宿主读取、导入记录和产物检查（`apps/desktop/scripts/module-packs/build.mjs` 从它导入）。

- 导入 `@cutex-desktop/*` 里公开入口以外的东西（包括 `@cutex-desktop/app/*`）、模块目录外且不在 `node_modules` 里的文件、第二份 React，构建都停下，写明原因。公开入口没有的名字也停下。
- 本地模块（§23.14）在加载前再查一次：正式版（CI 发布包）`packs.ts` 对 `pack.local` 用 `checkPublicHostImports`，宿主导入清单里出现公开入口以外的说明符就不加载。开发版（未打包运行或自己构建的包，同 `localPacksDefault`；主人存的开关不影响）照样加载，只要 `packHost` 有它要的东西（`checkHostImports`），设置 → 模块给它一个标记「使用内部接口，可能随应用更新失效」，安装对话框也写这一句（main 的 `LocalPacksView.internal`、`readsAppInternals`）。这是兼容检查，不是安全边界（§23.12）：本地模块本来就有 app 的信任，检查只是让第三方模块不在应用更新时悄悄坏掉。构建器（`cutex-module build`）照旧拒绝 `@cutex-desktop/app/*`；能这样加载的只有用本仓库构建器构建的包（例如第一方的桌宠）。
- 样式：模块自己的 CSS 整份放进 `cutex-pack` 层。第三方构建不跑 Tailwind，因为公开包不带 app 的主题。

命令是 `packages/module-api/bin/cutex-module.mjs`（new / build / dev / pack），模板在 `packages/module-api/template/`。写模块的人看 [模块作者指南](module-authoring.md)：它的参考部分和插槽目录由 `node packages/module-api/scripts/generate-docs.mjs` 从代码生成，`packages/module-api/test/docs.test.ts` 在过期时失败。

### 30.5 开发者模式：从文件夹加载

设置 → 模块的「开发者模式」。开关和每个文件夹都只走 main 自己的原生确认（`main/moduleDev.ts` 的 `moduleDevPrompts`），renderer 只能请求；状态在 `userData/module-dev.json`，默认关。

- main 每 400 ms 看一次各文件夹的 `dist/pack.json`（构建工具最后才写它，所以它变了就是一份完整的构建），把这份构建读进内存，从 `cutex-module://dev/<id>/<rev>/<file>` 提供。只提供读到的那份里的 entry 和 styles，别的一律 404；`modulePackRequestAllowed` 的限制不变。字节没变不升 rev。
- 校验和本地模块相同：id 合法、不是内置模块的 id（`BUILT_IN_MODULE_IDS`）、`moduleApi` 兼容、只读公开入口（renderer 的 `checkPublicHostImports`；开发版同 §30.4，读内部接口的也加载并标出，`ModuleDevView.internal`）。两个文件夹不能用同一个 id。
- renderer（`modules/devModules.ts`）跟随 main 的视图，每个新 rev 走宿主动态注册（先 `removeModule` 再 `addModules`），不重启应用。新构建读不了、导入失败或 `activate` 抛错时，留着上一个跑得起来的版本，原因显示在设置里。同一个 rev 不重试。
- `--no-local-modules`（§23.14）启动时不加载也不提供任何东西。文件夹模块不计入本地模块的连续启动失败计数：它在 `activate` 失败时已经退回上一版。
- 每行有模块自己的开关（和下面模块列表里的同一个）。只要开发者模式开着，「显示示例回复」就能用（文件夹加载的和已安装的模块都看得到），它画一段假的智能体回复（`sessionId` 是 `sample-session`，真的 `CodeBlockScope` 和工具栏），不用守护进程、智能体或模型就能试 `timeline.codeBlockAction`。
- 带「开发」标记（`LocalBadge`）。文件夹变了会自动换上新代码，确认对话框写明这一点；要给别人用的是 `cutex-module pack` 的 `.tar.gz`，走 §23.14 的安装确认。

### 30.6 模块数据和文件（v1.31）

给不随 app 构建的模块两个通用服务，都由 main 决定行为；不加浮动窗口、不联网、永远不加载第三方 Node 代码。写模块的人看 [模块作者指南](module-authoring.md) 的 Files 一节。

- **只在 `ctx.services`。** `data` 和 `files` 需要知道是哪个模块在问，所以只有宿主按作用域建的 `ctx.services`（`modules/app.ts` 的 `scopedServices`）带它们，id 取自作用域，模块传不进别的 id。共享的 `services` 对象没有模块，调用直接拒绝（`unknown_module`）。公开类型 `ModuleContextServices` = `ModuleServices` + `data` + `files`；从包里 import 的 `services` 仍是 `ModuleServices`。
- **不是安全边界。** 模块和 app 在同一个 renderer 里（§23.12、§23.14），能直接调 `window.cutex.moduleData` 并写别人的 id。main 能保证的是：请求只来自主窗口的主 frame（`isAppSender`），id 是 main 认识的模块（内置 `BUILT_IN_MODULE_IDS`、已装的包、开发者模式加载的文件夹），路径出不了那个模块的文件夹，限额不被超过，选的文件和保存的位置不离开 main。这挡住的是写错的模块和页面里的内容，不是恶意模块；作者文档照实写了。
- **IPC。** `cutex-desktop:module-data`（`shared/moduleData.ts` `parseModuleDataRequest`，字段必须正好是这些），preload `bridge.moduleData`，main `main/moduleData.ts` `ModuleDataService`、对话框 `main/moduleDataPrompts.ts`。错误是 `<code>: <说明>`，renderer（`lib/moduleData.ts`）转成带 `code` 的 Error：`invalid | not_found | too_large | quota_exceeded | busy | unavailable | unknown_module`。模块停止后经 `ctx` 的调用 AbortError（`guard.request`）。
- **数据文件夹** `userData/module-data/<id>/`：
  - 路径：相对路径，`/` 分段，每段以字母、数字或 `_` 开头，只含字母、数字、`.`、`_`、`-`、空格，不以点或空格结尾，不是 Windows 设备名（`con`、`nul.txt`、`com1` …），最多 8 段、512 字符。`..`、绝对路径、盘符、反斜杠、冒号都过不了解析。
  - 链接：途经的每一段（包括 `module-data` 和 `<id>` 本身）用 `lstat` 查，是符号链接或 junction 就拒绝；新建的父目录再用 `realpath` 核对仍在文件夹内；有多个名字的文件（硬链接，`nlink > 1`）不读不写，免得写到文件夹外。`remove` 可以删掉链接本身，不跟进去。`list` 跳过链接和不合规的名字。
  - 限额（`MODULE_DATA_LIMITS`）：每个模块 64 MB、单个文件 16 MB（读、写、选、存都一样）、4096 个文件和文件夹。超过就 `quota_exceeded` / `too_large`，什么都不改。写入先写同目录的 `.tmp-<随机>` 再改名，一步替换。同一个模块的调用按顺序执行。
  - 已知限制：检查和读写之间有间隙，和主人同一用户身份运行的程序可以趁机把文件夹换成链接；这和 §23.14 的「普通用户文件」是同一层问题，这里不声称能挡住。
- **选文件和保存**：`pick` 弹 main 的打开对话框，读出主人选的那一个文件（≤ 16 MB），只把文件名和字节给模块；`save` 弹保存对话框，main 把字节写到主人选的位置，只回文件名。路径从不离开 main，模块不能再次打开同一个文件。模块只能给文件类型过滤（扩展名 `[A-Za-z0-9]{1,16}` 或 `*`）和建议的文件名（只取文件名部分，按数据路径规则检查）；对话框标题由 main 写明是哪个模块在要。同一时间只有一个对话框（`busy`）；窗口隐藏或最小化时不弹（`unavailable`）。
- **移除模块时的数据。** 移除本地模块（§23.14）不再用 renderer 的确认框，改由 main 的原生对话框确认：有数据文件夹时三个按钮「取消 / 移除，保留数据 / 移除并删除数据」，默认取消，并写明数据大小；没有时只问移除。签名包移除后退回内置版本，数据照旧，不问。从开发者模式移除文件夹不碰数据（同一个 id 之后常常要装成本地模块）。保留下来的数据在 设置 → 模块 → 模块数据 列出（含已不在的模块），「删除…」再走 main 的原生确认（`clear`）。没有任何定时或自动删除。
- **测试**：`test/moduleData.test.ts`（路径、链接 / junction、硬链接、设备名、限额、未知模块、对话框、一次一个、移除时的三种选择、renderer 一侧的编码和错误码）；`test/moduleAuthorEndToEnd.test.ts` 的 v1.31 用例：`cutex-module new` + `pack` 的真实产物经真实的本地安装路径，主进程提供的入口在真实模块宿主上跑，`activate` 经 main 的请求解析用 `data` 和 `files`（只把原生对话框换成固定答复）。

## Background apps and media tabs

Browser and service tabs can remain mounted while playing media. Their title information
can include an audio indicator. These are app-internal additions; the public module API
version and its trust boundary are unchanged.

On capable hosts, cutex can supervise a portless worker process as a background app.
It has no browser page or port. The desktop shows its status, logs and controls through
the daemon. See [Portless services](design/portless-services-v1.md). Installing module
background programs is a later phase and is not provided by this desktop release.
