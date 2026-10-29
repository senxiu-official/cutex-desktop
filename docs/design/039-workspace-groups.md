# 039 工作区 = 组；托盘分「钉住 / 最近」

状态：**已实现，待合并**（2026-10-23，分支 `feat/0.2-workspace-groups-2`；主人已答 §7）。来源：主人 10-23 决定。
预览：`.claude/previews/preview-workspace-groups.html`（现在 vs 改后 + 可操作演示）。
关系：改写 001（托盘 = 任务栏）里「打开着 / 分组」的部分；和 038（Rail 胶囊、托盘折成「… N」）用同一种胶囊的画法。

术语：**工作区** = 并排的一组对话列（A+B）；一个人的工作区 = 一列。

## 1. 现在是怎么建模的（读代码）

- 屏幕上最多 2 个对话列（`paneLayout` `MAX_CONVERSATION_COLUMNS = 2`），每列一个窗格 `paneId`，绑定 `{hostId, sessionId}`。
  「工作区」目前只是**这一刻屏幕上的那几列**（`lib/workspaces` `screenOf`），没有可以保存、再叫回来的「一组」。
- 点另一个人 = `agentPlan` 的 `replace`：把聚焦的那一列换成他。A+B 的组合就丢了。
- 托盘（`lib/trayOpen`）只记**单个智能体**：被换下来的单个人进「打开着」列表（`OpenAgent {hostId, sessionId, at, side?}`，最多 40，存 localStorage）；
  钉住来自首页的 `home pins`（`kind: "agent"`，跨设备同步）。`modules/home/trayOrder.ts` 排序：钉住 → 屏幕上 → 打开着；
  `trayPrefs.grouping`（不分组 / 按状态 / 按项目）。
- × 在头像**左上**角，只有没钉住的才有。

所以要新增的是一个**可保存的「工作区」**，其余（列、Shelf、`convShelves`）不动。

## 2. 工作区的模型

```ts
interface WorkspaceSet { id: string; members: AgentId[] /* 1–2（设置允许时 3），左→右 */; pinned: boolean; at: number }
```

- 新文件 `lib/workspaceSets.ts`（纯函数 + zustand + localStorage `cutex-desktop.trayWorkspaces`，替换 `trayOpen.open`；旧数据读时迁移：每个 open 项 → 单人、没钉住的工作区）。
- **一个人只属于一个工作区。** 把 C 放进 A+B（并排 / 拖放 / 替换）时，C 从原来的工作区里拿走；原工作区空了就删除。被换下来的那一个自己成为一个单人工作区。
- 屏幕上的工作区 = 和 `PaneLayout` 的对话列一一对应；仍由布局订阅（沿用 `trayOpen` 的「比较前后两次布局」）推导：
  屏幕上的列集合变了 → 先把新的列集合对应到工作区（成员完全相同 = 同一个；否则按下面的规则改成员），**离开屏幕的工作区原样保留**（不再被拆成单个「打开着」）。
- 每列的 Shelf、侧栏宽度、列宽（`convShelves`、`resizeColumns`）按列记，所以工作区回来时各列还是原来的样子。
- 「工作区一直跟着成员」：A 被删除 / 智能体不存在了，就从成员里去掉（沿用 `startTrayOpen` 里「被删掉的离开托盘」）。

## 3. 点击规则（主人 A）

| 操作 | 结果 |
|---|---|
| 普通点 C（侧栏、托盘、⌘K） | C 有工作区 → 那个工作区整个上屏（要聚焦 C 那一列）；没有 → 新建单人工作区 C 上屏。**当前的工作区原样留在托盘里。** |
| 点 A+B 胶囊、或胶囊里的 A / B | A+B 整个回来；点的是 A 就聚焦 A 那一列 |
| 替换 | 只在主人**明确要**时：把 C 拖到某一列上；或该列右键「替换这一栏…」（弹出智能体选择，沿用 ⌘K 的列表） |
| Ctrl/⌘+点 C | 当前工作区不满（缺省 < 2 列）→ C 加成旁边一列，C 从原工作区拿走。已满 → 屏幕上盖两个半边（样子同拖放预览：红色虚线框 + 「替换 X」），点哪一半就换哪一列；Esc 取消 |
| 拆出 | 右键胶囊里的头像「从这个组拆出 X」→ X 成单人工作区（留在最近） |

- **缺省最多 2 列**；设置「允许 3 列」（缺省关）把 `MAX_CONVERSATION_COLUMNS` 变成读设置的函数；每列仍要 ≥ `CONVERSATION_MIN_W`（400 px），放不下就不让加（提示）。
- 动作预告（008）沿用：普通点 = 蓝框「切换到 C」；Ctrl+点 = 绿框「加在右边」；已满时 = 红框两个半边。
- 返回上一个（Alt+←）：`BackStep` 的 `replace` 改记「从哪个工作区切到哪个工作区」，撤回 = 切回去。
- `agentPlan`（`lib/workspaceEffects`）的 `replace` 种类拆成 `switch`（普通点）和 `replace`（明确替换）；`beside` 已满时变 `pick`（出半边）。

## 4. 托盘：钉住 / 最近（主人 B）

- 左边 **钉住**：主人放的，一直在，顺序固定（钉住的先后；可拖动调顺序，沿用 `home` 的排序）；头像**左上角**小钉子。点钉子 = 取消钉住（它变成普通的「最近」）。
- 细竖线之后是 **最近**：打开（上屏）就自动加到最前面，最多 **6 个**（屏幕上的那个不会被挤掉），最旧的掉；窗口放不下的收进「… N」（038 的做法）。钉住的不占这 6 个。
- 每一项（钉住或没钉住、单人或胶囊）悬停时**右上角**出 ×：从托盘拿掉；钉住的同时取消钉住；屏幕上的那一项 × = 关掉它的列（和现在一样，智能体照样运行）。
- 托盘里没有另外的「最近列表」（最近在侧栏里）。
- 右边的应用（服务 / 成果 / 页 / 链接）不变：只放钉住的。
- 标记不变：屏幕上 = 亮条（胶囊 = 整个框下一条）；打开着 = 小点；运行中的转圈、需要你的数字画在各自的头像上。
- 「分组」设置已去掉；钉子 = 样式 ②（见 §7）。

### 钉住存在哪里

- 单个智能体的钉住**照旧**写首页的 `pins`（跨设备同步，已有的钉住不迁移）。
- 钉住一个胶囊（A+B）= 在 `trayWorkspaces` 里把这个工作区标成 `pinned`（**只在本机**）。
- 一个人同时被钉住（首页）又在一个胶囊里时：显示成胶囊（工作区优先），钉子点了 = 两边都取消。（待定 1：是否值得为 A+B 钉住也做成跨设备同步。）

## 5. 画法（和 038 的 Rail 胶囊同一个想法）

- 胶囊 = 一个圆角框（圆角 999），里面左→右放成员头像（28 px，间隙 2 px），框 1.5 px 描边；屏幕上的描强调色，框下一条亮条。
- 框和头像之间的空隙 = 整个工作区；头像 = 那一列。悬停框 = 整个框描强调色；悬停头像 = 只亮那一个。
- 提示：「A + B」+ 一行「点 = 整组上屏 · 右键头像 = 拆出」。
- 小窗口里放不下时：胶囊整个折进「… N」，列表里一行一个工作区（两个头像 + 名字）。

## 6. 实现落点（主人确认预览后做）

- `lib/workspaceSets.ts`（新，纯函数 + 测试）：`membersAfterLayout`、`withMember`、`detach`、`trimRecent`、`readSets`（含旧 `trayOpen` 迁移）。
- `lib/trayOpen.ts`：保留 `BackStep` 和订阅，`open` 改由 `workspaceSets` 提供；`layoutChange` 增加「列集合」。
- `lib/workspaceEffects.ts`：`agentPlan` 拆 `switch` / `replace` / `pick`；`modules/home/Dock.tsx`、`trayOrder.ts`：画胶囊、钉住 / 最近、× 移到右上角、钉子；`components/tray.css`。
- `lib/paneLayout.ts`：`MAX_CONVERSATION_COLUMNS` → `maxConversationColumns()`（设置）。
- 设置：「允许 3 列」；`trayPrefs.grouping` 去掉（待定 2）。
- 测试：`test/workspaceSets.test.ts`（不依赖 jsdom 的纯函数）；`trayOrder.test.ts`、`trayOpen.test.ts` 更新。

## 7. 主人的答复与实现里的取舍（2026-10-23）

1. **钉住全部同步**：胶囊（A+B）也存进首页的同一个 `pins`：一条 agent 钉住（第一个成员），多带 `members:[{hostId,key}…]`。
   显示不了 2 列的设备打开第一个成员，其余一次点击可达。实现：`modules/home/trayEntries.ts`（`groupPin` / `pinMembers`）。
   **风险**：假设 host 的 `user-home` 保留 pin 的未知字段（前端读写时保留）；host 若丢了 `members`，退化为只钉第一个人（有测试）。
   上面 §4「钉住存在哪里」里「只在本机 / `pinned` 标记」作废。
2. **「分组：按状态 / 按项目」设置去掉**（`trayPrefs.grouping` 删除），换成「允许 3 列」开关（`workspace.threeColumns`）。
3. **钉子 = 样式 ②**：红色图钉，针尖朝下略偏右，托盘尺寸下清楚（`.tray-pinmark`）。点钉子 = 取消钉住、留在最近。
4. **最近上限 6，按工作区算**（胶囊算 1）；屏幕上的永远在、钉住的不占。
5. **Ctrl/⌘+点 已满**：屏幕上各列变成红色虚线的可点目标「换掉 X」（`ColumnPickLayer`），点哪列换哪列，Esc / 点外面取消；被换下的那个成为最近里的单人工作区。
6. 「打开着」按工作区算；「返回上一个」也按工作区（`BackStep` `workspace`）。
7. 窗口审计的尾巴：‹ / › 右键 → 鼠标处小菜单（只看 Shelf / 只看会话 / 恢复，选了才动）；
   「只看会话」= 收起 Shelf，「恢复」= 把被收起的另一边放回。保留 Ctrl/⌘ 两族，但每个提示 / 动作预告都写明 Ctrl 点和中键做什么，
   并在 设置 → 键盘快捷键 加一张「手势表」（`lib/gestures.ts`、`i18n/gestureCatalog.ts`）。
8. 另加：列头 ⋯ 菜单和列头空白处右键有「替换这一栏…」（`lib/replaceColumn.ts`），因为普通点不再替换。

## 8. 对 001 / 038 的修订

- 001：托盘「打开着 / 分组」改为「钉住 | 最近」；× 移到右上角。
- 038：托盘胶囊与 Rail 胶囊同一种画法；窗口放不下仍折成「… N」。

## 链接

- 001（托盘）、008（动作预告）、038（Rail 胶囊、托盘折叠）。
- 预览：`.claude/previews/preview-workspace-groups.html`。
