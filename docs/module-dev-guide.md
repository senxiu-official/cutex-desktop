# 桌面模块开发规范

- **规范版本：v1.7**（2026-10-10）
- **适用契约**：`docs/desktop-modules.md`，`MODULE_API_VERSION = "1.4"`（`packages/plugin-sdk/src/index.ts`）
- **适用代码**：分支 `feat/side-p1a`（契约 1.4 + §19 宿主）合入 main 之后；只有 `feat/side-p0` 的用 v1.6（§19 插槽还没有宿主，不要贡献），
  契约 1.3 的 main 用 v1.5，契约 1.2 的用 v1.4，更早的用 v1.0。

本文写给**没有参与过本项目讨论的开发者 / agent**：只读本文、`AGENTS.md`、`docs/desktop-modules.md`，就能在不碰别人代码的前提下做一个模块。
规范版本和契约版本是两回事：契约变了（`MODULE_API_VERSION` 升级），本文会跟着出新版本；本文自己改措辞或补规则，只升本文的版本号（见文末变更记录）。

---

## 0. 先确认这件事适合做成独立模块

适合（结构上安全，按本文做即可）：
- 新页面、设置页、状态胶囊里的一类条目、导航入口；
- 现有功能的「V2」（例：用量页 V2 → 新模块 `usage-v2`，和旧的并存，主人在 设置 → 模块 里切换）；
- **只用现有数据**：store 里已有的状态、`window.cutex` / `bridge` 已有的方法、`ctx.services` 已有的服务。

**不适合**单独开工，先找主线维护者（Claude）对齐：
- 需要新的数据接口：新的 IPC 方法、新的 daemon 路由、cutex 新字段（要改 `shared/ipc.ts`、`preload/index.ts`、`main/index.ts`、`main/daemon.ts`，甚至 cutex 后端）；
- 需要新的插槽类别或改插槽语义（契约变更，走 `desktop-modules.md` §4.2 流程）；
- 要改外壳布局（侧栏、对话区结构、胶囊容器）。

## 1. 工作方式

1. 用独立的 git worktree 和分支：`git worktree add .claude/worktrees/<你的模块> -b module/<你的模块> main`。**不要在主工作区改，不要 push，不要合并。**
2. 安装依赖：PowerShell 里先 `. .\scripts\dev-env.ps1 *>$null`（pnpm 不在默认 PATH），再 `pnpm install --frozen-lockfile`。
3. 只在 `apps/desktop/src/renderer/src/modules/<id>/` 里新建和修改文件。**唯一允许的目录外改动**：在 `modules/registry.ts` 里加两行（import + 列表里一项），以及测试快照的更新（见 §6）。
4. 改完交付：分支名 + commit 列表 + 测试结果 + 预览截图 / 说明。由主线维护者审查后合入。

## 2. 目录结构

```
modules/<id>/
  index.ts        模块定义（defineModule），只放定义
  i18n.ts         本模块的中英文文案
  mock.ts         浏览器预览用的假数据（可选，没有新数据就不需要）
  XxxPage.tsx     组件；.tsx 只导出组件
  useXxx.ts       hooks / 工具函数放 .ts（Fast Refresh 规则）
```

- `<id>`：小写短横线，例如 `usage-v2`。全局唯一，不能和现有模块重名。
- 所有条目 id、i18n key 都以 `<id>.` 开头，例如 `usage-v2.page`、`usage-v2.title`。

## 3. 模块定义（`index.ts`）

```ts
// 用量 V2：新的用量页（和旧 usage 模块并存，默认关闭）。
import { BarChart3 } from "lucide-react";
import { defineModule } from "../slots";
import { UsageV2Page } from "./UsageV2Page";

export default defineModule({
  id: "usage-v2",
  titleKey: "usage-v2.title",
  descriptionKey: "usage-v2.description",
  defaultEnabled: false,                       // 「V2 / 实验」模块一律默认关闭，主人手动打开
  // requires: { capabilities: ["usage-ledger"] },  // 依赖的 cutex 能力：缺能力时整个模块按规则隐藏或置灰
  contributes: {
    "settings.page": [
      { id: "usage-v2.settings", page: "usage-v2", group: "data", order: 110, icon: BarChart3,
        titleKey: "usage-v2.page", source: "host", Page: UsageV2Page },
    ],
  },
});
```

- 能往哪些插槽贡献、每个插槽的字段和门控规则，以 `docs/desktop-modules.md`（§3 插槽清单、§4 能力门控、§5 启停与放置）为准，**不要自己发明字段**。照着现有模块抄最稳：
  - 设置页：`modules/usage/`；
  - 主区页面 + 导航入口：`modules/projects/`、`modules/delegations/`；
  - 状态条目（输入栏 / 胶囊）：`modules/goal/`、`modules/plan/`，规则见下面「状态条目（契约 1.2）」。
- 依赖 cutex 能力用 `requires.capabilities`；某个 agent 才有的功能用条目上的 `agentFeature`。不要在组件里自己判断 `features.has(...)`。
- 需要服务（打开页面、通知、偏好）用 `ctx.services`（契约 §7）。模块自己的偏好只经 `ctx.prefs`，存储键由宿主管理。

### 设置页放在哪（设置组，`lib/settingsNav.ts`）

组的顺序由外壳固定，模块只选 `group` 和组内 `order`（导航见 `docs/research/settings-design-review-20261009.md` §2）：

| `group` | 名字 | 放什么 |
|---|---|---|
| `app` | 应用 | 只影响这台电脑的偏好（`source: "local"`）：通用、外观、对话、侧栏与顶栏、状态显示、通知 |
| `connection` | 连接 | 本机连哪台主机（主机）、主机允许谁连进来（远程访问） |
| `agents` | 智能体（随称呼） | 当前主机上 agent 的配置：Profile、新建默认、指令、协作、运行时 |
| `tools` | 工具 | 当前主机的 codex 配置：插件、MCP 服务器、技能、钩子 |
| `data` | 数据 | 当前主机的数据：用量、归档 |
| `system` | 系统 | 桌面端自身：模块、键盘快捷键、关于 |

没有「计划中」「集成」组：还没有 API 的功能不放占位页；只有一两行的设置做成别的页上的 `settings.section`（例如消息总线是「协作」页末的分区），不单独开一页。

### 设置页规则

审查时按这几条看（来自 `docs/research/settings-design-review-20261009.md` §3；第二批会补上 `Badge` / `StatusText` / `SaveBar` 等组件）：

- **提示一句话**：hint 不超过一句（约 30 字），细节放 tooltip；「何时生效」只在页头（`hintKey`）说一次。
- **每张卡片有标题**：`Section` 都给 `title`。
- **一次性操作放分区标题右侧**（`Section actions`）：测试、恢复、刷新、全部升级等不占设置行。
- **保存方式两种**：开关 / 下拉立即生效；多字段表单和长文本用吸底保存栏。
- **不手写颜色和原生控件**：用 CSS 变量和 `components/settings/Form.tsx` 的组件，不用原生 table / checkbox / select / `window.confirm`（删除用「点两次」）。
- **列表用 `ListRow`**，一组同类数据一张卡，卡内用小标题分组。
- **不放占位**：不放 PlannedCard、只有跳转的页、只读重复别处的分区。
- **来源标签**：页头 `source` 为空（混合来源）时，每个分区自己标来源；页头有来源时分区不再重复标。
- **术语**：界面写 profile、工作 / 快速工作、项目 / 独立 agent（不说「域」「创建链」）；agent / Director 用占位符（见 §4 术语表），不出现内部名（`delegation_wait`、`cutex human new` 等）。
- **能被搜到**（设置搜索，`desktop-modules.md` §3.2）：设置页在条目上声明 `sections`（页内每张有标题的卡片：`anchor` + `titleKey` + 卡片里行标签的 `keywords`，只在某能力下才渲染的卡片写 `requires`），组件里给这张卡片 `<Section id={settingsAnchorId("<anchor>")}>`（`lib/settingsNav.ts`）；`settings.section` 写 `titleKey` + `keywords`，锚点由外壳包好。只写已有的 i18n key，不为搜索单独造同义词。`test/settingsSearch.test.ts` 检查 key 两种语言都有、锚点页内唯一、每个声明的锚点在组件里出现。
- **通知**（契约 1.3，`desktop-modules.md` §17）：不要自己弹系统通知、播声音或开大窗。发生了值得通知的事，调 `emitNotify`（`lib/notifyEvents.ts`），给 cutex 注册表里的事件 id；什么等级、走哪些方式由主机的表决定。新的设备端方式贡献 `notify.method` 条目。

### 状态条目（契约 1.2，`desktop-modules.md` §16）

状态胶囊是一个**可以被关掉**的模块（`status-capsule`）。你的状态条目（`conversation.status`）要在胶囊关掉时照样正常：

- **不要 import 胶囊**（`modules/status-capsule/`，跨模块 import 本来就被测试拦住），也不要自己改 `capsuleOpen` / `capsuleFoldedItems` 或找胶囊的 DOM。
- **`supportedSurfaces`**（可选）：条目能放在哪里，`"bar"`（需要 `Bar`）和 / 或 `"capsule"`。不写 = 有 `Bar` 就两处都支持，没有就只有胶囊。`defaultPlace` 必须落在支持范围内，否则登记时模块直接 failed。
- **`inline`** 已经是「实际位置」：主人选了胶囊但胶囊关着，`inline` 为 false、`useStatus` 不会被调用。只在 `inline` 或面板打开时取数据 / 轮询，不要在 `Bar` 里常驻轮询。
- **打开请求用 `reveal`**：斜杠命令等要「显示这一项」时，在 `Bar` 里调 `reveal("view", () => setOpen(true))`；要编辑用 `reveal("edit", …)`（编辑总落在输入栏）。宿主决定去胶囊还是调你的回调；返回 `unavailable` 时宿主已经提示主人，`stale` 时什么都别做。`home` / `showInCapsule` 是 1.1 的旧字段，还能用但已废弃。
- 新的 `conversation.statusSurface` / `conversation.overlay` 只给内置外壳和胶囊用，普通模块不要贡献（surface 只有 `bar` / `capsule` 两个，已被占用，重复会被拒绝）。
- **右侧**（契约 1.4）：每个状态条目自动成为右侧组件 `status:<条目 id>`（Body = 你的 `Body`，Actions = `Meta`）。给条目一个 `icon`（卡片把手 / 页按钮上用）；不该进右侧就写 `side: false`。不要再为同一内容另写 `side.component`。

### 右侧组件（契约 1.4，`desktop-modules.md` §18）

要在右侧区显示东西（文件、预览、对比、子线程、浏览器……），贡献 `side.component` 条目，**不要**自己画面板、改 store 里的布局或找右栏的 DOM。

- **id = `<模块 id>.<名字>`**，`titleKey` 两种语言都有，`placement.home` 是页组名（小写，例如 `workspace`、`browser`）；同一页组的组件默认落在同一页。
  只写规则，不写坐标：外壳的 `place()` 决定页和卡片，主人移动后记住的是他的选择。
- **state 是可序列化的小 JSON**（≤ 4 KiB）：只放能恢复视图的东西（路径、行号、滚动位置），不放数据本身；数据在 `Body` 里按需取。
  改了 state 的形状就升 `stateVersion` 并在 `restore` 里转换；`restore` 返回 null = 丢掉这个标签——state 恒为 null 的组件**不要**写 `restore`。
  纯函数（`init` / `restore` / `dedupeKey` / 标题）放在 `*.ts`，测试直接测它们。
- **`useTab` 要便宜**：不在视野里的卡片也跑它（页按钮的徽标靠它），只读 store / 已有缓存，不发请求、不轮询。取数据和轮询只在 `visible` 时做。
- **打开别的组件**用 `ctx.services.side.open(kind, params)`（kind 是字符串，参数由对方 `parseParams` 校验），不要 import 对方模块；返回 `unavailable` 时外壳已经提示主人。
- **不要监听全局 Esc**：Esc 链由外壳管（参考卡片 → 模式 → 抽屉 → 对话，`desktop-modules.md` §19.10）；组件内部的弹层自己 `preventDefault` 就行。
- **mock**：组件需要的 daemon 数据放进模块自己的 `mock.ts`。预览里检查：打开、移到新页、最大化 / 全屏、切 agent 后不串台、重启（刷新）后恢复。

### 两侧留白、轮上内容与引用（契约 1.4，`desktop-modules.md` §19）

- **留白工具**贡献 `conversation.gutter`：`side` + `order` + `icon` + `titleKey`，内容写在 `Body`（弹出 / 常驻都用它，按 `width` / `docked` 排版，
  弹出里选完可调 `close()`；常驻里 `close()` 是把整份列表收起，普通选择别调，写 `if (!docked) close()`，详见 `desktop-modules.md` §19.3）。不写坐标、不量 DOM：外壳决定按钮放留白还是输入框工具行（`Trigger` 拿 `where`）、躲开胶囊。允许常驻就写 `dockMinWidth`；
  常驻是主人在设置里打开的（默认关）。
- **跟某一轮有关的内容**贡献 `timeline.turnAttachment`，不要往 `timeline.insert` 里塞，也不要改原生条目。想放页边就写 `margin: { side, minWidth }`，
  留白不够时外壳自动改成内联；`Attachment` 按 `where` / `width` 排版，要便宜（每一轮第一行都会挂一个），没有内容就返回 null。
- **对引用的动作**（加书签、复制链接……）贡献 `ref.action`：`kinds` 限定种类，`run(ref)` 执行；`useState(ref)` 只改菜单行的样子（✓、另一个标题、变灰），
  `run` 里要再判断一次。外壳把它放进消息悬停栏「⋯」、消息 / agent / 右侧标签 / 卡片 / 页 / 页面标题的菜单。
- **保存别的东西的指针**一律存 `CutexRef`（`ctx.services.refs.here()` 取现在屏幕上的，或用组件的 `toRef`），打开一律 `ctx.services.refs.open(ref, { how })`。
  读回来的引用是不可信数据：先 `refs.parse`，不要自己拼 `kind` / `params` 去调别的服务；结果是 `unavailable` 时按 `reason` 给一行说明，别静默。
- **自定义引用种类**（例如 `notes.note`）贡献 `ref.target`：一个种类只能一个模块提供，kind 只能小写；`open` 不能启动 / 重启任何东西，
  目标删了就返回 `unavailable` 或抛错，**不要悄悄换成别的目标**。
- **可引用的组件**写 `toRef` / `fromRef`（kind = 组件 id，所以组件 id 要全小写）；只有内容型组件（只读也能看懂）才写 `peekable`，
  它就能出现在左留白的参考卡片里（`Body` 拿到 `where: "peek"`，不要在那里放编辑操作）。
- 跳到某一轮用 `ctx.services.timeline.focusTurn`（外壳负责翻页、跨 agent 与「回到」），不要自己滚时间线。
- 预览：浏览器预览加 `?gutter` 会加载外壳的演示条目（`dev/devGutter.tsx`），可以对照它检查你的条目放在留白 / 输入框 / 页边 / 内联时的样子。
## 4. 文案（`i18n.ts`）

```ts
export const zhCN = {
  "usage-v2.title": "用量 V2",
  "usage-v2.description": "新的用量页（实验）",
  "usage-v2.page": "用量 V2",
} as const;

declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;

export const en: Record<keyof typeof zhCN, string> = {
  "usage-v2.title": "Usage V2",
  "usage-v2.description": "The new usage page (experimental)",
  "usage-v2.page": "Usage V2",
};
```

- 中英文都要齐，`en` 少一个 key 会编译失败；`declare module` 块不能省，省了 `t("usage-v2.…")` 编译不过。
- 文件会被自动收集（`import.meta.glob`），**不要改** `i18n/zh-CN.ts`、`i18n/en.ts`。
- 想复用基础词典里的通用词（保存、取消、加载中……）可以直接用；不要把自己的 key 塞进基础词典。

### 术语表（称呼可配置，`lib/terms.ts`）

「agent」「Director」和「主人」的叫法由主人在 设置 → 通用 → 称呼 里按语言自定义（默认 中文「智能体」「主管」「主人」，英文 agent / Director / owner）。所以文案里**不写死这两个词**，写占位符，`t()` 在替换 `{var}` 之前解析：

| 占位符 | en 默认 | zh 默认 | 用在哪 |
|---|---|---|---|
| `{{agent}}` / `{{agents}}` | agent / agents | 智能体 | 句中 |
| `{{Agent}}` / `{{Agents}}` | Agent / Agents | 智能体 | 句首、标题、按钮、列名（en 首字母大写） |
| `{{an agent}}` / `{{An agent}}` | an agent | 智能体 | en 需要冠词时（按词选 a / an，不要写 `an {{agent}}`） |
| `{{director}}` / `{{directors}}`、`{{Director}}`、`{{a director}}` | Director（角色名，存的就是大写） | 主管 | 同上 |
| `{{owner}}` / `{{Owner}}`（同样有复数 / 冠词形式） | owner | 主人 | 主人作为「一方」出现时：主人通知、等主人批准、委托的发起方 / 停止方；直接对用户说话的「你」/ "you" 保持不变（「你可以……」「需要你」） |

- 原生子 agent 写 `{{subagent}}` / `{{subagents}}` / `{{Subagent}}`（默认 =「子」+ agent / "sub-" + agent，可在称呼里单独设；不要写「子{{agent}}」，`terms.test.ts` 把关）。
- 中文：占位符和汉字之间不加空格（「无在线{{agent}}」），和数字、`{var}`、英文之间照旧留空格（「{n} 个{{agent}}」）。
- en 用句子大小写：只有句首 / 标签开头用 `{{Agent}}`，其余 `{{agent}}`。复数看原意，不要因为改了称呼去掉 `{count}`。
- **不替换**：key、内部 id、线上名字、工具 / 命令名（`agent_tell`、`agent_list`、`AGENTS.md`、`cutex-agent-bus`），这些放在反引号里或保持带 `_ - . /` 的写法。
- 系统发送者：`cutex-asks` 显示为「委托系统」/ Delegation System，其他 cutex 服务（任务 / 作业服务、闹钟、owner-notify 系统通知……）显示为「Cutex 系统」/ Cutex System。判断用 `lib/systemSenders.ts`，头像用 `components/SystemAvatar.tsx`（`SenderAvatar` 自动选系统 logo 或 agent 头像）；不要自己写 `senderId === "cutex-asks"`。
- `apps/desktop/test/terms.test.ts` 会扫所有 zh-CN / en 文案：出现写死的 agent / Agent / 代理 / 智能体 / Director / 主管 / 主人 / owner / sub-agent，或拼错的占位符，测试直接失败。确实要保留原词（例如产品名）的，把 key 和理由加到该测试的 `ALLOWED`。

## 5. 预览数据（`mock.ts`，可选）

- 浏览器预览（`.claude/launch.json` 的 `renderer-preview`，默认端口 5199）不连 daemon，数据来自 mock。
- 只用现有接口时通常**不需要** mock.ts：现有模块的 mock 已经提供了数据（例如用量账本在 `modules/usage/mock.ts`）。
- 确实要补数据：导出 `export const mock: ModuleMock = { … }`（类型见 `dev/mockTypes.ts`），会被自动收集；**不要改** `dev/mockBridge.ts`。同一个 API 方法不能被两个模块的 mock 同时定义（安装时会报错）——要改现有方法的假数据，先找维护者。
- mock 只能 import `shared/`、`@cutex-desktop/*`、`dev/mockTypes`。

## 6. 必须遵守的规则（都有测试把关，违反会直接失败）

| 规则 | 说明 |
|---|---|
| 不 import 别的模块目录 | 要共用的代码放 `lib/`——但那是目录外改动，先问维护者；状态胶囊同样不能 import |
| 外壳不 import 你的模块 | 只有 `registry.ts` 引用模块 |
| `.tsx` 只导出组件 | hooks、工具函数、常量放 `.ts` |
| key 前缀 | 条目 id、i18n key、页面 id 都以 `<id>.` 开头，不重复 |
| 新模块进注册表 | `modules/registry.ts` 加 import 和列表项；放在功能相近的模块旁边 |
| 快照 | `apps/desktop/test/modules.test.ts` 有各插槽在新 / legacy / 未加载三种能力列表下的条目快照，加了贡献会变；**确认变化只是你新增的条目**后再更新快照，并在交付说明里写明 |

**不在测试里、但审查时会看的**：
- 只读数据可以直接用 store / bridge；不要自己写高频轮询（> 1 次 / 5 秒），需要实时数据先问有没有现成事件。
- 界面风格：用现有组件（`components/ui`、设置页的 `Section` / 表格等），颜色用 CSS 变量，浅色 / 深色都要能看。
- 不直接碰本地文件系统和终端（AGENTS.md 核心原则 2）。
- 不打印、不保存任何 token / 凭据。

## 7. 验证（交付前全部要过）

```powershell
. .\scripts\dev-env.ps1 *>$null
pnpm -r typecheck
pnpm --filter ./apps/desktop test
```

- 记下 app 测试的通过 / 跳过数，和开工前在同一分支上跑的数字对比：只能多（你加的测试），不能少。
- **预览**：在自己的 worktree 里起 renderer 预览（端口用 5199 以外的，例如 5295，命令见 `.claude/launch.json`），检查：
  - 正常模式和 `?legacy`（模拟旧 cutex，缺能力时你的模块该隐藏 / 置灰就要隐藏 / 置灰）；
  - 中文 / 英文，浅色 / 深色；
  - 在 设置 → 模块 里关掉你的模块，入口和页面都消失、没有报错；
  - 有状态条目的：再把「状态胶囊」模块关掉，条目在输入栏照常工作、只在胶囊里的条目不显示且没有报错，重新打开后恢复；
  - 有右侧组件的：打开、移到新页面、最大化 / 全屏再还原（内容不重载）、切到别的 agent 不串台、刷新后恢复，关掉模块后卡片消失、页按钮不留空页；
  - 有留白条目 / 轮上内容的：宽窗口（按钮在留白、页边）和窄窗口（按钮进输入框工具行、内联）各看一次，右栏「让位 / 悬浮」各看一次，
    Esc 先关你的弹出层且不打断回合；`peekable` 组件在参考卡片里（`where: "peek"`）能看懂；
  - 浏览器 console 0 错误。
- 预览服务用完按 PID 关掉（**不要按进程名杀**：桌面 app 和 cutex daemon 的进程名都是 `cutex.exe`）。

## 8. 交付说明模板

```
模块：usage-v2（默认关闭）
分支：module/usage-v2，commit：<hash 列表>
目录外改动：modules/registry.ts（+2 行）；test/modules.test.ts 快照（仅新增 usage-v2.settings）
测试：typecheck 通过；app <通过>/<跳过>（开工前 <通过>/<跳过>）
预览：正常 / ?legacy × 中 / 英 × 浅 / 深 已检查，console 0 错误；关掉模块后入口消失
数据：只用现有接口 <列出用到的 store 字段 / bridge 方法>
已知问题 / 没做的：…
```

---

## 变更记录

| 版本 | 日期 | 契约 | 变化 |
|---|---|---|---|
| v1.0 | 2026-10-09 | `MODULE_API_VERSION` 1.1 | 首版：适用范围、工作方式、目录与定义、i18n、mock、规则、验证、交付模板 |
| v1.1 | 2026-10-09 | `MODULE_API_VERSION` 1.2 | 状态胶囊可关闭：状态条目的 `supportedSurfaces`、`inline` = 实际位置、用 `reveal` 打开、不 import 胶囊；预览多检查一项「关掉胶囊」 |
| v1.3 | 2026-10-09 | `MODULE_API_VERSION` 1.2 | 术语表：agent / Director / 主人 的称呼可配置，文案用 `{{agent}}` / `{{director}}` 占位符（`terms.test.ts` 把关）；系统发送者（委托系统 / Cutex 系统）用 `lib/systemSenders` + `SystemAvatar` |
| v1.4 | 2026-10-09 | `MODULE_API_VERSION` 1.2 | 设置搜索：设置页规则加「能被搜到」（`sections` / `keywords` / `settingsAnchorId`；契约只加可选字段，版本不变） |
| v1.5 | 2026-10-09 | `MODULE_API_VERSION` 1.3 | 通知：新插槽 `notify.method`，核心模块 `notifications` 执行主机的通知表；模块用 `emitNotify` 报告事件，不自己弹通知（`services.notify.os` 退役） |
| v1.6 | 2026-10-09 | `MODULE_API_VERSION` 1.4 | 右侧区：新插槽 `side.component`（取代 `conversation.sidePane` 草案），状态条目自动进右侧（`icon` / `side`）；新增「右侧组件」规则和预览检查项。§19 两侧留白 / 引用插槽已声明，宿主落地前不要贡献 |
| v1.7 | 2026-10-10 | `MODULE_API_VERSION` 1.4 | §19 宿主落地（P1a）：新增「两侧留白、轮上内容与引用」规则（`conversation.gutter`、`timeline.turnAttachment`、`ref.action`、`ref.target`、`CutexRef` 只经 `services.refs`、`peekable` / `toRef`、`focusTurn`）和预览检查项；Esc 链加参考卡片。契约类型不变 |
| v1.2 | 2026-10-09 | `MODULE_API_VERSION` 1.2 | 设置导航第一批：设置组改为 应用 / 连接 / Agent / 工具 / 数据 / 系统（删「计划中」「集成」和 `plannedApi`），新增「设置页放在哪」和「设置页规则」 |
