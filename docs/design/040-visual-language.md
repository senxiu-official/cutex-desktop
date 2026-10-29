# 040 视觉语言：token、头像、侧栏布局、迁移顺序

2026-10-24 头像风格决定更新：统一应用／Profile 的拟人、emoji、字母选择；Profile 可覆盖应用。拟人和 emoji 在新建及首次看到时写成会话固定头像，字母不写；更改风格不改已有固定头像。当前完整风格按主机／Profile 暂存桌面本地，保留旧键；只提供「重置为当前风格」，动态继承等待后台能力。批量换成当前风格与重抽覆盖两种风格。实施、迁移及生效时间说明见 [avatar-style-implementation-20261024.md](../research/avatar-style-implementation-20261024.md)。本决定优先于下文旧的拟人单独设置描述。

状态：**实现中**（主人 2026-10-23 看过 v1 / v2 预览后说「做」；第 1 步在 `feat/0.2-visual-tokens`）。
研究和审计：[visual-language-20261023.md](../research/visual-language-20261023.md)。
预览（v3）：`.claude/previews/preview-visual-language.html`（token、头像、10 个组件 现在 / 改后；右上角切深浅色、头像底色）·
`.claude/previews/preview-sidebar-options.html`（侧栏 A 默认 / B 可选、设置项、v3「大入口放哪」；`?layout=B&entry=left&force=1&tint=1&light=1` 直接打开某个状态）。

## 0. 主人的决定（2026-10-23）

| 问题 | 决定 |
|---|---|
| 设计语言 | 「外壳安静，头像是主角」：中性色、同心圆角、6 档字号、颜色只留给头像（研究文档 §2） |
| 头像形状 | **全部圆形**。「人和智能体有啥区别？那只是头像」——撤销 v1 的「智能体超椭圆方块」 |
| 头像底色 | **默认不加**：拟人头像一眼就能看出是哪家模型。「按模型着色」做成设置项 |
| 提供方色 | 修色板：**Gemini 是紫色** |
| 输入框底栏（研究 §3 第 7 项） | **不改**：不要把 Profile / 模型 / 强度并成一个按钮组。只有停止键换成前景色（不是红），能不动底栏就做 |
| 侧栏 | **A 花名册做默认**，补一行**窄入口**（图标 + 数字角标）+ **停住往下展开**；入口可放顶部一行或左边一列；**入口顺序同意**（桌面 · 需要你 · 委托 · 审批 · 快速启动 · 更多）。**B「现在 / 全部」做成设置里可选的布局**。C 不做 |
| 大入口卡片 | 主人的想法：放在主机旁边。v3 预览两个方案（§4.1），待主人选 |
| 拟人头像 | **随 App 带**；主人会准备**几套主题**，设置里自己选用；**没选之前新智能体保持现在的样子** |
| 顶栏左上角 | 是 **cutex 标志**（也是收起 / 展开侧栏），和现在一样；v2 预览误画成了主人头像，v3 已改 |

## 1. Token（CSS 变量）

全部放进 `styles.css`。原有颜色变量（`--win --bg --surface --surface-2 --raised --fg --fg-muted --fg-subtle --border --card-border --accent --warn --danger --ok --hover`）
**名字和各配色的值都不动**，新变量从它们派生，所以 7 套配色、亚克力、文字对比度设置都不用重写。

### 1.1 间距、圆角、字号、高度（`:root`，与主题无关）

```css
:root {
  /* 间距：4 px 网格 */
  --space-0-5: 2px; --space-1: 4px; --space-1-5: 6px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px;  --space-5: 20px; --space-6: 24px;  --space-8: 32px;

  /* 圆角：同心规则 = 子圆角 = 父圆角 − 间距 */
  --r-xs: 4px;   /* 角标数字、kbd、行内代码 */
  --r-sm: 6px;   /* 标签 / 徽标、24 px 小图标按钮 */
  --r-md: 8px;   /* 按钮、侧栏行、菜单项、输入框里的芯片 */
  --r-lg: 12px;  /* 卡片里的卡片：输入框、队列、代码块、委托卡、菜单 */
  --r-xl: 16px;  /* 外壳卡片：侧栏、会话、Shelf、托盘、桌面小组件（现在 14） */
  --r-2xl: 20px; /* 对话框、启动页大卡 */
  --r-full: 999px;

  /* 字号：6 档（字重分级：400 正文 / 500 控件 / 600 名字、标题） */
  --t-caption: 500 11px/14px var(--font-sans);
  --t-meta:    400 12px/16px var(--font-sans);
  --t-body:    400 13px/18px var(--font-sans);
  --t-chat:    400 var(--chat-font-size, 14px)/1.6 var(--font-chat, var(--font-sans));
  --t-title:   600 15px/20px var(--font-sans);
  --t-display: 600 20px/26px var(--font-sans);

  /* 控件高度 */
  --h-row: 32px; --h-row-2: 44px; --h-btn: 28px; --h-btn-sm: 24px; --h-tag: 18px; --h-field: 30px;

  /* 头像尺寸 */
  --av-16: 16px; --av-20: 20px; --av-28: 28px; --av-32: 32px; --av-40: 40px; --av-72: 72px;
}
```

外壳卡片和其他圆角统一加 `corner-shape: squircle`（Electron 44 = Chromium 14x，已支持；超椭圆在同样数值下看起来更顺）。
**头像不加**（圆形）。

### 1.2 颜色角色（新增；浅 / 深两套由现有变量派生）

```css
:root {
  --fg-disabled: color-mix(in oklab, var(--fg-subtle) 60%, transparent);
  --pressed: color-mix(in oklab, var(--fg) 9%, transparent);
  --accent-soft: color-mix(in oklab, var(--accent) 12%, transparent);
  --selected: var(--accent-soft);           /* 选中行：一种，不再有「白卡片 + 阴影」和「灰底」两种 */
  --on-accent: #fff;
  --attention: var(--warn);                 /* 「需要你」：只以点 / 数字 / 细边 / soft 面出现 */
  --attention-soft: color-mix(in oklab, var(--attention) 16%, transparent);
  --on-attention: #1f1300;
  --danger-soft: color-mix(in oklab, var(--danger) 12%, transparent);
  --ok-soft: color-mix(in oklab, var(--ok) 14%, transparent);

  /* 高度（e0 窗口底不需要变量） */
  --e1: 0 0 0 1px var(--card-border), 0 1px 2px rgb(18 22 32 / .04), 0 8px 24px rgb(18 22 32 / .06); /* 外壳卡片 */
  --e2: 0 0 0 1px var(--card-border), 0 12px 32px rgb(18 22 32 / .16), 0 2px 6px rgb(18 22 32 / .06); /* 菜单、悬停卡、⌘K、状态胶囊 */
  --e3: 0 24px 70px rgb(10 10 20 / .25), 0 2px 8px rgb(10 10 20 / .08);                              /* 对话框 */
  --hi: inset 0 0 0 0 transparent;          /* 深色：卡片顶边高光 */

  /* 提供方色：只在「头像底色 = 按模型」时用 */
  --prov-claude: #d97757; --prov-openai: #10a37f; --prov-gemini: #9b6cf0;
  --prov-deepseek: #4d6bfe; --prov-kimi: #3a3f4b; --prov-glm: #1fa3b8; --prov-other: #8b95a7;
}
/* 深色（:root[data-theme="dark"] 和 prefers-color-scheme 两处，和现有写法一样） */
:root[data-theme="dark"] {
  --on-attention: #1f1300;
  --e1: 0 0 0 1px var(--card-border), 0 10px 28px rgb(0 0 0 / .35);
  --e2: 0 0 0 1px rgb(255 255 255 / .09), 0 16px 40px rgb(0 0 0 / .55);
  --e3: 0 24px 70px rgb(0 0 0 / .6);
  --hi: inset 0 1px 0 rgb(255 255 255 / .06);
  --prov-kimi: #c9ced8;
}
```

现有 `--card-shadow` / `--shadow` 先**不动**（第 1 步外观不变）；组件迁移时改用 `--e1` / `--e2`，第 15 步清扫时把旧名改成新名的别名再删。

### 1.3 Tailwind 4 语义工具类

在 `@theme` 里注册**新名字**（不改 Tailwind 自带的 `rounded-md` 等，避免一改全动）：

```css
@theme {
  --radius-chip: 6px; --radius-ctl: 8px; --radius-inner: 12px; --radius-card: 16px; --radius-dialog: 20px;
  --text-caption: 11px; --text-caption--line-height: 14px; --text-caption--font-weight: 500;
  --text-meta: 12px;    --text-meta--line-height: 16px;
  --text-ui: 13px;      --text-ui--line-height: 18px;
  --text-title: 15px;   --text-title--line-height: 20px; --text-title--font-weight: 600;
  --text-display: 20px; --text-display--line-height: 26px; --text-display--font-weight: 600;
  --shadow-e1: var(--e1); --shadow-e2: var(--e2); --shadow-e3: var(--e3);
  --color-selected: var(--selected); --color-attention: var(--attention); --color-attention-soft: var(--attention-soft);
  --color-accent-soft: var(--accent-soft);
}
```

→ `rounded-chip / rounded-ctl / rounded-inner / rounded-card / rounded-dialog`、`text-caption / text-meta / text-ui / text-title / text-display`、
`shadow-e1/e2/e3`、`bg-selected`、`bg-attention-soft`。迁移 = 每个组件把 `rounded-[9px]`、`text-[11.5px]`、手写阴影换成这些名字。
完成后加一条测试（或 lint 脚本）：`components/**/*.tsx` 里不再出现 `rounded-[`、`text-[N.5px]`、`shadow-[0_`（白名单例外写明原因）。

**第 15 步清扫（2026-10-23，`feat/0.2-visual-sweep`）**：`text-[Npx]` 换成 `text-<token>/[inherit]`——取 token 的字号，`/[inherit]` 保留继承来的行高和字重（直接写 `text-caption` 会同时改成 14 px 行高、500 字重，看得出来）；没有正好的 token 的就近取（≤ 1 px）。
旧的 `--card-shadow` / `--shadow` 全部换成 `--e1` / `--e2` 后删掉；同一元素上的 `card-border` 细边改透明（e1 / e2 自带那圈边）。外壳卡片 14 → 16 px。
`test/visualRawValues.test.ts` 拦新的 `text-[Npx]` / `rounded-[…]` / `shadow-[…]` 和带模糊的 style 阴影，例外写在 `test/visualRawValues.allow.json`（带原因）。报告：`.claude/previews/040-sweep/REPORT.md`。

## 2. 组件规则（实现时的检查表）

- **按钮**：高 28（紧凑 24），`rounded-ctl`；主（实心强调色）/ 次（`--surface-2` 面）/ 幽灵（只有悬停面）。图标按钮正方形。
  危险操作 = 次按钮 + 红字。**输入框底栏不改**（主人 10-23）；只把**停止键**从红描边换成前景色（`--fg` 底 `--bg` 字），位置和大小照旧。
- **标签 / 徽标（一个组件 `Tag`）**：高 18、`rounded-chip`、`text-caption`、soft 面 + 同色字、**无边框**；变体 neutral / accent / attention / ok / danger。
  数字角标另一个组件 `CountBadge`（16 高胶囊，`--attention` 实心）。编号（#11）是强调色文字链接，不做芯片。
- **行**：32（双行 44，紧凑 36），`rounded-ctl`，悬停 `--hover`，选中 `--selected`。
- **卡片里不再套带边框 + 阴影的卡片**；分组用 `--surface` 面。一张卡片里只有一种边框（`--card-border`）。
- **图标**：Lucide 1.5 线宽，界面 16、工具条 18；托盘 / 侧栏里的网页、服务、成果图标放**中性方块**（`--surface-2`），不再用彩色渐变方块。
- **菜单里的说明**（主人 2026-10-23）：菜单项下面不再放灰色说明行。说明写在菜单项的 `info` 字段（`lib/contextMenu.ts`），由 `components/Overlays.tsx` 画成行右侧的小 ⓘ（在开关 / 快捷键之前），悬停或键盘高亮该项时出一个浮层（`shadow-e2`、`rounded-inner`、`text-caption`），文字同时用 `aria-describedby` 接到按钮上给读屏用。例外：武装确认的结果（「停止 3 个？再点一次」）和实时状态仍在行内。设置页的行不在此规则内（主人还没定）。
- **浮层**（菜单、悬停卡、状态胶囊、回合尾操作条）= `shadow-e2` + `rounded-inner`，亚克力。

## 3. 头像

### 3.1 形状、尺寸、状态

- **圆形**，所有人一样。尺寸只用 16 / 20 / 28 / 32 / 40 / 72（侧栏行 32、紧凑 20–28、托盘 32、会话头 40）。
- 图片原样放进圆里，加 1 px 内描边（浅色 `rgb(0 0 0 / .08)`，深色 `rgb(255 255 255 / .10)`），免得浅色的画和白卡片糊在一起。
- **设置 → 外观 → 头像底色**：`无`（默认）/ `按模型`。按模型 = 背景换成 `color-mix(--prov-<family> 16%, --bg)`，描边换成提供方色 40 %；
  对透明背景的立绘最有用。prefs 新键 `avatarTint: "none" | "provider"`。
- **状态画在头像上**（`Avatar` 新 prop `status`，所有位置同一种画法；不再在旁边另画「需要你 ×5」胶囊）：

| 状态 | 画法 |
|---|---|
| 运行中 | 外圈 2 px 强调色进度弧，1.6 s 一圈（减少动态效果 = 静止的弧） |
| 需要你 N | 右上角 `CountBadge`，2 px 底色描边「切」进头像 |
| 有提问 / 待审批 | 同位置，角标内容 `?` / `!` |
| 在线（空闲） | 右下角 8–9 px 绿点 |
| 离线 | 图片灰度 + 50 % 透明，无点 |

  现在侧栏行上「钉住 / 在屏幕上」的蓝圈去掉（钉住看托盘，在屏幕上看行上的「左 / 右」标）。

### 3.2 拟人头像主题包（主人 10-23：随 App 带，主题自己选，没选之前保持现在的样子）

已实现（step 13）。格式按主人的生成器来，重新生成的包也是这个格式。

**包**：一个文件夹，里面有 `manifest.json`。文件夹名就是包 id（`[a-z0-9-]{1,20}`）。

```
<pack>/
  manifest.json      {"schemaVersion": 1, "name"?: "…" | {"zh-CN","en"}, "entries": [
                        {"theme": "lolita", "themeName": "洛丽塔", "model": "claude", "variant": 1,
                         "avatarPath": "avatars/lolita/claude-v1.webp", "previewPath": "previews/lolita/claude-v1.webp"}, …]}
  avatars/<theme>/<model>-vN.(png|webp)    ← 头像
  previews/<theme>/<model>-vN.(png|webp)   ← 64 px 小图，可以没有
```

- 没有 `manifest.json` 时，直接读 `avatars/<theme>/<文件>`，名字就用文件夹名。
- **主题** = 主人选的单位（洛丽塔、哈利·波特 …）。
- **家族** = `model`：claude / gpt（→ openai）/ gemini / deepseek / kimi / glm，其他算 other。
- 显示用的名字取自 manifest。
- 代码：`shared/portraitPacks.ts`（格式、id、检查）、`main/portraitPacks.ts`（主人文件夹）、`lib/portraitPacks.ts`（发现、挑、退回）、`lib/portraitThemes.ts`（选主题）、`lib/portraitAssign.ts`（写进 cutex）。

**两个来源**

1. **随 App 带**：清单在 `renderer/src/assets/avatars/portraits/<pack>.json`（用 eager glob 发现，加包不用改代码），图片在 `renderer/public/avatars/portraits/<pack>/`（原样拷进 App，不是一张图一个模块）。
   - 包要先用 `node scripts/avatar-pack-import.mjs <zip 或文件夹> --id <pack> --name <名字>` 转一遍：
     - 头像转成 192 px WebP（q74），小图转成 64 px WebP（q75）。
     - 整个文件夹一次换掉。
     - 需要带 libwebp 的 ffmpeg。
   - 现在带的是测试包 `overnight-test-v1`：432 张（18 主题 × 6 家 × 4），8.3 MB。原图 68 MB 的 PNG 不进 App。
   - 图片放 public 而不是 glob 进来：432 张都 glob 的话，开发模式和测试里每次引入 Avatar 都要多加载 864 个模块（实测让一个测试从约 1 秒变成 3–4.5 秒）。地址 = `import.meta.env.BASE_URL` + 路径，打包后是 `./avatars/…`，从 file:// 打开也对。
2. **主人自己的**：`<userData>/avatars/portraits/<pack>/`，由 main 读。
   - 有两种放法：生成器的输出原样放进去（PNG 也行），或者跑上面那个脚本加 `--user`。
   - 只读普通文件，不跟符号链接，每张最多 2 MB。
   - 图片在用到时才读，按文件头判断类型，以 data URL 交给 renderer；CSP 不变。
   - 设置里有「打开头像包文件夹」和「重新扫描」。
   - **和随 App 带的包同 id 时，用主人自己的**（不用重装 App 就能换新版）。
   - 「导入头像包…」（zip）按钮暂时没做：脚本 `--user` 或把解压出来的文件夹放进去，效果一样。

**存法**

- 存进 cutex 的是 `{kind: "icon", value: "portrait:<pack>/<theme>/<model>-vN"}`。
- 长度上限：`portrait:` 9 + 包 20 + 1 + 主题 20 + 1 + 13 = 64 字符。最长的测试 id 是 `portrait:overnight-test-v1/french-aristocracy/deepseek-v4`，57 字符。
- 包名不带来源（bundled / user）：同 id 的包，换掉就是升级。

**设置 → 外观 → 拟人头像**（主人 10-23 第二次：多选主题）

- 设置值是 `UiPrefs.portraitPacks: string[]`（名字和 0.2.0 引导页约好），存的是开着的 `pack/theme`。
  - 空 = **不用**（**默认**，和现在一样）。
  - 全选 = 以前说的「混合」。
- 设置页：
  - 每个包一行标题：包名、「内置 / 我的」、**每家几张**（如 `Claude 72 · GPT 72 · …`），旁边是**全选 / 全不选**。
  - 下面是主题卡片：名字、张数、每家一张样图、勾选框。
- 0.2.0 的引导页（ui-shelf-polish 做）用 `lib/portraitThemes` 这套接口：
  - `usePortraitThemes()`：返回所有主题（名字、张数、每家张数、样图）和开着的。
  - `setPortraitThemeEnabled` / `setEnabledPortraitThemes`。
  - `enableAllPortraitThemes(keys)` / `disableAllPortraitThemes()`。
  - `useSampleUrl(picture, size)`：拿样图地址。

**什么时候挑**

- 池 = 开着的主题里、这个智能体模型家族的所有头像，按包、主题的顺序排；和勾的先后无关。
- **新建智能体**（desktop 新建流程，主人没在表单里选头像）：
  - 起点 = `hash(cutexSessionId)`，往后找第一张同项目里还没人用的，存进 cutex。
  - 池子都用完了，就用起点那张。
  - 家族没有图（other），保持现在的样子。
- **cutex 里没存头像的**（CLI 开的、别的智能体开的、旧的）：显示时按 hash 挑。不去重，不写回。
- 主人自己选的表情、上传的图片、Director 头像：不碰。
- 「仅重要智能体」的小圆点照旧：按 hash 挑的头像不会把小点变成脸。
- **「都换成勾选的主题」**：
  - 只改没存头像的和正在用拟人头像的。
  - 同项目尽量不重复。
  - 一键完成，可以撤销一次。
  - 主人 risk rule 里属于低风险：一次点击 + 撤销。

**换新版的包**（主人 10-23：先给一个测试包，以后换成重新生成的，可能更少、名字也可能变）

- **原地替换**（同一个包 id，内容换新）就是正常的升级方式，不用迁移。名字没变的图，智能体还是同一张。
- 存的那张找不到时，**绝不显示破图**，按下面的顺序退回。都只是显示，不改存的值：
  1. 原来那张；
  2. 同包、同主题、同家族，按 hash 挑；
  3. 同包、任何主题、同家族，按 hash 挑；
  4. 任何已装的包里同家族，按 hash 挑；
  5. 现在的默认头像（表情 / 字母）。
- 设置里，有智能体在用替代时，显示「N 个智能体的头像在新版里没有了，暂时用替代」和**「重新分配」**按钮：
  - 把替代写进 cutex，同项目先用没人用的。
  - 可以撤销一次。
- main 只列出确实存在的图片：新版少了的那些，在列表里就是没有了。
- 测试：包变小、名字改了、某家在主题里被删光、整个包没了。见 `test/portraitPacks.test.ts`。

**选择器**

- 编辑信息的「拟人 / Director 头像」页和新建表单的头像弹层，都有一栏「拟人」：
  - 一次显示一个主题：已存那张所在的主题，否则第一个开着的主题。
  - 主题可以下拉切换。
  - 按家族分行，本家族在最前。
- 新建表单里，有主题开着时「拟人」排第一，否则排在最后。
- 「Director 头像」不变。

## 4. 侧栏布局

prefs 新键（Settings → 外观 → 侧栏）：

| 键 | 值 | 缺省 |
|---|---|---|
| `sidebarLayout` | `roster`（花名册）/ `now-all`（现在 / 全部） | `roster` |
| ~~`sidebarEntries`~~ | ~~`top` / `left`~~ | （v5 取消） |
| ~~`sidebarEntryReveal`~~ | ~~停住展开 开 / 关~~ | （v5 取消） |

v5（主人 10-23，见 §4.1）：入口不再放在侧栏里，后两个键不做了。

**A 花名册（默认）** — v5：侧栏只有**搜索 + 花名册**，下面「上：…」「窄入口」「停住展开」三条作废，入口在顶栏（§4.1）。
- ~~上：搜索框 + ＋（新建；右键 = 快速启动菜单）。~~（v5：新建在顶栏）
- ~~**窄入口**~~（v5 取消）：桌面 · 需要你 · 委托 · 审批 · 快速启动 · 更多，一个 28 px 图标一项，数字是 `CountBadge`。点：桌面 = 显示桌面；需要你 = 下面列表只看需要你的（再点取消）；
  委托 / 审批 = 开对应 Shelf 页；快速启动 / 更多 = 菜单。
- **停住展开**：鼠标在入口行停 300 ms → 一张 e2 浮层在入口行**下面**（左边一列时在**右边**）展开，每项 = 图标 + 名字 + 一行说明 + 数字；
  盖在列表上，不挤动布局；离开 120 ms 收回；键盘焦点进入口行也展开。关掉设置 = 只有 tooltip。

**规则（v4，主人 10-23 指出的 P2）**：停住展开的浮层一律紧挨着触发它的那一行 / 那一列展开，**绝不盖住它**。触发行一直看得见、点得到，浮层开着时它带一圈 accent 描边；两者之间留 6 px 的不可见桥，鼠标移过去不会收回。其他「停住展开」的地方（托盘、项目悬停卡）也照这条。

- 一行提示（异常关机等），可关。下面：项目分组的智能体行（32 px 头像、44 高），离线叠成一行「离线 N」，独立智能体 / 工作放最后，底栏主人 + 设置（有更新 = 设置上一个点）。
- 现在的 6 行导航（`SidebarNav.tsx`）~~变成入口行~~ → v5：搬到顶栏（§4.1）；`更多` 里的东西不变。

**B 现在 / 全部（可选）**
- ~~顶部一行图标（同 A 的入口，没有展开）。~~ v5：没有自己的图标行，入口和 A 一样在顶栏（切布局时入口不换地方）。上半「现在」：需要你的事一张卡一件（头像 36 + 名字 + 一句话 + 直接按钮：回复 / 批准 / 回答 / 打开），按等待时间排，
  然后是开在会话列里的（标「左 / 右」）；最多 5 张，其余「还有 N」。下半「全部」：28 px 紧凑行、20 px 头像，带筛选。中间分界可拖，位置存 prefs。
- 稳定排序：一张卡的位置只在它的事件变化时变；进出用 `--motion-medium` 的高度 + 透明度过渡。

### 4.1 入口放哪：顶栏（v5，主人 2026-10-23 已定）

主人（看板 big-entry-place）：「如果用花名册是不是最好别再显示了这个了？否则可以显示在所有设备旁边，但是不加圆角特效了，旧平铺？或者最多加根分割线」。
预览：`.claude/previews/preview-sidebar-options.html` 的「v5」一节（现在 / 改后 · 花名册 / 改后 · 现在 / 全部，深浅色，窄窗口）。

- **侧栏**：花名册不再显示入口列表，只有搜索 + 花名册（异常关机那一行提示照旧，可关）。B「现在 / 全部」也不再有自己的图标行。
- **顶栏**：「所有设备 / 主机」选择器右边，一根细分割线（1 px、16 px 高、前景色 18 %），然后一组**平铺小图标**，就是顶栏现在右边那种 28 px 图标按钮的样子（没有底板、没有圆角胶囊、悬停只是 `--hover`）：
  1. **新建智能体**——「人 + 加号」图标（和右边打开 Shelf 工具的 ＋ 分开）；右键 = 快速启动菜单。
  2. **快速启动**（⚡）。
  3. **委托**（⇄）+ `CountBadge`（等你的件数）；点 = 开 Shelf 页（同今天）。
  4. **审批**（盾）+ `CountBadge`；点 = 开 Shelf 页。
  5. **显示桌面**（显示器图标，Ctrl+Shift+D，再按一次放回原来的布局）——主人 2026-10-23：「右上导航栏做显示桌面是不合理的」，从顶栏右边那组**挪到这里**，放在 ⋯ 前面（像 Windows 把显示桌面放在最末端）；右边那组不再有它。
  6. **更多**（⋯）= 今天侧栏「更多」的菜单。
  每个都有 tooltip（名字，委托 / 审批加「N 件等你」），都在 Tab 顺序里。
- **不重复**：侧栏的「桌面」= 顶栏左边这组里的「显示桌面」（2026-10-23 从右边挪过来），只留顶栏那一个。「需要你」不设入口（头像角标 + 托盘的铃铛已经有）。
- **窄窗口**（顶栏放不下：约 900 px 以下，或两个工作区并排挤）：新建留着，其余几个（连同显示桌面）收进一个 ⋯，⋯ 上的角标 = 委托 + 审批的总数；点开是平铺的列表（图标 + 名字 + 数字，「更多 ›」在最后）。不用卡片。
- **侧栏收起（头像栏）时**：顶栏这组一直在，所以不需要另外的大入口。
- **作废**：v3 的方案 1（主机菜单里的大卡片）、方案 2（⊞ 入口按钮）、v4 的方案 3（顶栏一组带大卡片）、方案 4（停住展开里的大卡片）——都不做。下面留作记录。

#### 以前的方案（v3 / v4，已作废）

侧栏的窄入口是天天点的；大卡片（图标 + 名字 + 一句说明 + 数字）给「想看清楚」和侧栏收起时。主人的想法是放在主机旁边：

侧栏的窄入口是天天点的；大卡片（图标 + 名字 + 一句说明 + 数字）给「想看清楚」和侧栏收起时。主人的想法是放在主机旁边：

- **方案 1（推荐）主机菜单里**：点左上「HOST-A」（胶囊上带需要你总数）→ 上面主机列表，下面「HOST-A 上」六张大卡片（桌面、新建、快速启动、需要你、委托、审批）。
  不加按钮；委托 / 审批 / 需要你本来就按主机算。`HostSwitcher.tsx` 的弹层加一段。
- **方案 2 主机旁一个「入口」按钮**（⊞，Alt+Q）：像开始菜单，六张卡片 + 「最近」的智能体头像。顶栏多一个按钮。

两个方案都：Alt+Q 打开；和窄入口同一套图标和数字。

**v4 再加两个位置**（主人 10-23；预览 `preview-sidebar-options.html` 的「v4」一节）：

- **方案 3 顶栏**：主机选择器（「所有设备 ●●● ⌄」）右边一组 6 个小图标带角标，点 / 停住出大卡片。好：侧栏收起也一直在，数字常驻顶栏。坏：约 190 px 宽，两个工作区并排或窗口 < 1100 px 时要收成 ⊞ + 总数（就成了方案 2）；侧栏展开时和入口行重复（可只留有数字的三项，或设置里二选一）。
- **方案 4 侧栏停住展开里**：入口行停住展开的浮层直接是 6 张大卡片（代替名字列表）。好：不加新位置、不重复。坏：只有侧栏展开时有，侧栏收起要再配方案 1 或 2；浮层约 220 px 高。
- 设计建议：**方案 4 + 方案 1**（侧栏展开用 4，收起时用主机菜单）。

两种布局共用同一份数据（agent 索引、需要你计数），只是渲染不同；侧栏的 rail 模式（收起）不变。所有新文字进 zh-CN / en / en-AU / zh-Hant-CN。

## 5. 迁移顺序和估计

原则：先加不改（token）→ 先做「一个组件改了全局受益」的（头像、标签）→ 再逐个大组件 → 最后清扫。每一步一个分支、一个预览截图（mock，深浅色），
主人看过再合。估计按一个实现成员的工作日（含测试和截图）。

| # | 步骤 | 文件（主要） | 风险 | 估计 |
|---|---|---|---|---|
| 1 | token 进 `styles.css` + `@theme` 语义工具类（只加不改，外观不变）+ 测试 | `styles.css`、`test/visualTokens.test.ts` | 很低 | 0.5 d |
| 2 | `Avatar`：圆形描边、`status`（弧 / 角标 / 点 / 离线）、`avatarTint` 设置；去掉侧栏蓝圈 | `Avatar.tsx`、`lib/prefs`、设置外观页 | 低（单组件，处处受益） | 1 d |
| 3 | `Tag` + `CountBadge` 组件，替换 30+ 处标签 / 徽标 | `components/*` | 低（机械替换，量大） | 1.5 d |
| 4 | 按钮三种 + 图标按钮；停止键换前景色（输入框底栏其余不动） | 按钮用处、`Composer.tsx` 的停止键 | 低 | 0.5 d |
| 5 | 侧栏智能体行（用头像状态，去掉「需要你 ×N」胶囊，选中 = `--selected`） | `AgentRows.tsx`、`styles.css` 项目块 | 中（项目分隔的几种样式要一起看） | 1 d |
| 6 | 托盘：中性图标方块、头像状态、「需要你」铃 | `ChipTray.tsx`、`tray.css` | 低 | 0.5–1 d |
| 7 | 会话头：一行名字 + 一行次要信息，3 个常驻按钮 | `ConversationHeader.tsx` | 中（按钮挪进 ⋯ 要保住快捷键 / 测试） | 1 d |
| 8 | 「需要你」条：琥珀 soft 面 + 头像叠放 + 第一件事 | `NeedsYouStrip.tsx` | 低 | 0.5 d |
| 9 | 队列 + 输入框：一层框 | `Composer.tsx`、`QueuePanel.tsx`、`TurnQueue.tsx` | 中高（输入框逻辑多，拖放插入） | 1.5 d |
| 10 | 回合尾：悬停浮出的操作条 + 一行状态 | `MessageActions.tsx`、`DelegationParts.tsx` | 中（键盘可达性） | 1 d |
| 11 | 顶栏 + 状态胶囊 | `TitleBar.tsx`、`AgentStatus.tsx` | 低 | 0.5–1 d |
| 12 | 侧栏 A（v5）：侧栏只留搜索 + 花名册；入口搬到顶栏（§4.1：分割线 + 5 个平铺图标 + 角标，窄窗口收进 ⋯） | `Sidebar.tsx`、`SidebarNav.tsx`、`TitleBar.tsx` | 中 | 1.5 d |
| 13 | 拟人头像主题包：家族扩展、包发现（glob + 主人文件夹）、`portrait:` 存法、设置里选包、新建时挑、「都换成勾选的主题」、选择器一栏 | `lib/avatarThemes`、`lib/directorAvatars`（抽成通用）、`shared/*`、main、设置外观页 | 中（要素材；存法要和 director 共用） | 2.5 d |
| 14 | 侧栏 B「现在 / 全部」（可选布局） | `Sidebar.tsx` 新子组件 | 中（排序稳定、动画） | 2–3 d |
| ~~12b~~ | ~~大入口卡片~~（v5 作废：入口在顶栏，见 §4.1） | — | — | — |
| 15 | 清扫：`text-[Npx]` / `rounded-[Npx]` / 手写阴影换成语义类，加 lint 测试 | 全部 renderer | 低（量大，分目录做） | 1.5 d |

合计约 **18–21 个工作日**。可并行：1 先做；之后 2–4 一人，5–8 一人，9–11 一人，12 + 14 一人，13 一人（拿到素材后）；15 最后。
文件不重叠，按 AGENTS.md 的独占规则分。

## 6. 测试

- 单元：模型家族判断（新三家）；挑头像（哈希起点、同项目去重、池空退回 emoji、主人自选优先）；`Tag` 变体；侧栏布局 prefs 迁移。
- jsdom：`Avatar` 的 `status` 渲染（弧 / 角标 / 点 / 离线）；顶栏入口组（角标、窄窗口收进 ⋯、新建的右键菜单）；B 的排序稳定。
- 对比度：`test/acrylicContrast.test.ts` 加新文字角色（caption 11 px 在 `--surface-2` 上）。
- 每步 mock 预览截图（深 / 浅），放 `.claude/previews/`。

## 7. 还要主人定的

- 大入口卡片：§4.1 方案 1（主机菜单里）、2（主机旁的「入口」按钮）、3（顶栏图标组）还是 4（侧栏停住展开里）？设计建议 4 + 1。
- （已定：头像随 App 带、主题自选、没选之前保持现在；入口顺序同意；输入框底栏不改。）
