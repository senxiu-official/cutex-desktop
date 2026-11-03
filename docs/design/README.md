# 设计方案索引

所有交互 / 行为方案集中在这里，方便主人快速审。**先看这张表**，需要细节再点进去。

- **现行规则**（已实现的样子）：[canvas-principles-20261020.md](../research/canvas-principles-20261020.md) §8 / §8.1；实现细节 `docs/desktop-modules.md` §24–§26。
- **任务清单**（做什么、谁在做）：[polish-0.2-checklist.md](../research/polish-0.2-checklist.md)。
- 本目录只放**方案**：一个方案一个文件，编号递增，不删；被推翻的标「已取代」并指向新方案。

状态：**待定**（等主人选）· **已定**（主人选了，还没做）· **实现中** · **已实现**（规则并入现行规则后可以不再更新）

| # | 主题 | 状态 | 一句话 | 预览 | 更新 |
|---|---|---|---|---|---|
| [001](001-tray-taskbar.md) | 托盘 = 任务栏 | 已实现（feat/0.2-tray；缺省不分组，B/D 为设置项） | 托盘 = 钉住的 + 打开着的；被替换的会话留在托盘里，点一下回来 | `.claude/preview-tray-taskbar.html` | 10-21 |
| [002](002-collapse-conversation.md) | 收起一个会话 | 已实现（feat/0.2-tray） | 会话列收成原位窄条；preview 太窄时给「收起 X」；最小化 = 回托盘，最后一个 = 回桌面 | `.claude/preview-tray-taskbar.html` v3 | 10-21 |
| [003](003-maximize.md) | 最大化 / 独占 / 全屏 | 已实现 | 最大化吃掉整行所有空隙（规则 2），其他面板宽度不变、往两边靠；保留三档 | `.claude/preview-shelves.html` | 10-21 |
| [004](004-artifact-page-bridge.md) | 成果页面开一个小口 | 已实现（待在桌面应用里试系统确认框） | A 小存储（每个成果 5 MB，各版本共用）/ B 你确认后交回做页面的智能体 / C 代为复制 | `.claude/preview-artifact-bridge.html` | 10-21 |
| [005](005-claude-background-subagents.md) | Claude 后台子智能体 | 已实现，待部署 | 子智能体放后台，主智能体不被挡住，插话立刻读到 | — | 10-21 |
| [006](006-settings-by-panel-kind.md) | 设置以面板种类为入口 | v1 已实现（feat/0.2-settings-v1） | 「面板」组：侧栏 · 会话 · 状态显示 · {{shelf}} · 托盘 · 桌面；每种面板 ⋯ →「⚙ X 设置…」直达（预告）；悬停设置卡框出受影响的面板；动作预告开关；删 4 个老右栏选项 | `.claude/preview-settings-by-panel.html` | 10-22 |
| [007](007-drag-one-side.md) | 拖一边只动这一边 | 已实现 | 去掉「单个会话两边对称移动」的例外 | — | 10-21 |
| [008](008-foretell.md) | 动作预告 | 已实现（feat/0.2-tray） | 悬停先描出会被影响的地方并说结果：红替换 / 蓝打开 / 绿并排 / 灰收起 | `.claude/preview-tray-taskbar.html` v3 | 10-21 |
| [009](009-shelf-rail-one-control.md) | Shelf 和 Rail 合成一个控件 | 已实现（圆角样式待比较） | Rail 是 Shelf 卡片的页签栏，一条细线隔开；收起 = 同一张卡片变窄；「Rail 直角」是开发开关，缺省圆角 | 截图 `shots/0.2-shelfcard/` | 10-21 |
| [010](010-quota-continue-delegations.md) | 额度用完后委托自己接着跑 | 已实现，待部署（r247） | 重置时 cutex 打开失败回合关上的闸门，委托自己重投；同账号共用重置时间；卡片写「额度用完 · 约 HH:MM 自动继续」 | — | 10-21 |
| [011](011-page-shelf-width.md) | 页面在 Shelf 里的宽度 | 已实现 | 页面新开进比 640 px 窄的 Shelf 时一次性拉宽到 640（像拖边：只动它那一列，到最小宽度停；不变窄） | 截图 `shots/0.2-shelfcard/item2-*` | 10-21 |
| [012](012-reset-credits.md) | 额度重置券 | 已实现（cutex 待部署 r248；GLM 待定） | 查张数和到期；点「用一张」先确认（写明账号、不能撤回）再用；支持 ChatGPT 登录和 Claude 订阅，GLM 只在 ZCode 里 | — | 10-22 |
| [013](013-armed-confirm.md) | 「点两次确认」要让人看懂 | 已实现 | 上膛时按钮换字 + 倒计时 + 复原提示；更新等低频大操作改对话框 | — | 10-22 |
| [014](014-width-feedback.md) | 调宽度时显示数值 | 已实现 | 拖边 / 方向键时边旁显示「px」，会话加「%」（#5） | — | 10-22 |
| [015](015-reset-layout.md) | 恢复默认布局 | 已实现 | 顶栏「窗口布局」→ 恢复默认布局，可撤销一次（#4） | — | 10-22 |
| [016](016-both-edges.md) | 两边都能拖 | 已实现 | 挨着邻居或桌面空隙的边都能拖，只改两边的两样（#38） | — | 10-22 |
| [017](017-open-in-own-shelf.md) | 从窗格里打开 = 进它自己的 Shelf | 已实现 | 网页 / 服务 / 窗格打开的东西进它所在的 Shelf、它那一页；只有没来源的（顶栏、⌘K、托盘、快捷键）进聚焦的 Shelf；焦点不动。组长的缺省：网页里点一下 = 按下即聚焦；`reveal` 两边都找；没焦点那边收着的 Shelf 不展开、Rail 页按钮闪 | 预览 `?ws=popup`（`&folded`）、`?ws=click`、`?ws=reveal` | 10-22 |
| [018](018-perf-log.md) | 性能记录 | 已实现（feat/0.2-perf） | 卡住超过 100 ms 自动记一条（时间、屏幕上开着什么、刚做了什么、最耗时的代码），只存本机最近 500 条；设置 → 关于里按时间查、导出 JSON（#27） | — | 10-22 |
| [019](019-file-explorer.md) | 文件浏览器 | 已实现（feat/0.2-files，待合并） | 「文件」窗格整体重做：后退 / 前进 / 上一级 + 可点的面包屑；「在文件树中显示」+ 跟随打开的文件；内置预览（右边 / 下面）和图片缩略图；键盘、筛选、git 标记 | `.claude/preview-file-explorer.html` | 10-22 |
| [020](020-file-explorer-cutex-api.md) | 文件浏览器要 cutex 补的接口 | 待定（给以后的 cutex 改动） | 文件夹分页、缩略图、新建 / 改名 / 删除（进回收站）、主机上按路径列文件、搜文件夹和被忽略的——每项都是加法，桌面端看能力才用 | — | 10-22 |
| [021](021-motion.md) | 动效一套规则 | 已实现 | 三档时长（120 / 200 / 280 ms）一条曲线；拖边、窗口缩放、第一帧不动；减少动态效果 = 0（#24） | — | 10-22 |
| [022](022-project-event-stream.md) | 项目事件流 | 细节已定，待说开工 | cutex 新增按项目的事件日志（回合 / 委托 / 审批 / 子智能体 / 后台命令，全部保留不删）+「正在进行」接口；Project 视图加「动态」（#30） | — | 10-22 |
| [023](023-approvals-next-step.md) | 审批结果在下一步送到 | 已定，开工 | 审批结果搭了闹钟的车所以只在回合后到；改成系统通知、下一步零等待送达，提醒仍回合后（#31） | — | 10-22 |
| [024](024-model-list.md) | 模型列表：一个真实模型一行 | 实现中（models） | Claude 每个系列一行（选它=跟随最新），别名 / 1M / 同款固定 id 并进去，旧版和模式放「更多」；默认 Profile 的「不在内置列表」误报去掉，默认模型真没了会提示并换用可用模型 | — | 10-22 |
| [025](025-large-conversations.md) | 很大的对话也能打开 | 实现中（feat/0.2-bigthread + cutex fix/big-thread） | 历史里的大图换成引用、用到才取；超大响应给明白的提示（Profile-generator 1.5 GB 打不开） | — | 10-22 |
| [026](026-panel-names.md) | 面板的名字 | 已实现（保持「侧栏」，主人 10-22 同意） | 「对话列」改「会话」，名字不带「列」；侧栏仍指左侧卡片 | — | 10-22 |
| [027](027-generated-images-in-history.md) | 生成的图片不再整张写进对话记录 | A、C 已实现（C 默认关；待 native r52.4）；B 待定 | 图已存成文件就只记路径（请求不变）；C：图多时一次只留最新几张，旧图换成路径（profile 设置） | — | 10-22 |
| [028](028-catalog-refresh-and-effort.md) | 模型目录刷新与推理强度回退 | 实现中（zai-effort） | 重新获取刷新服务商字段、不碰主人改过的；Profile 默认强度不支持时回退、明确指定的仍拒绝；接管会话按请求检查（Zooey 新建失败的根因） | — | 10-22 |
| [029](029-caption-buttons.md) | Windows 窗口按钮 | 已实现 | 右上角 — □ × 底色透明，顶栏是什么底它就是什么底；符号跟主题文字色；附 host02 验收清单 | 预览 `?caption`（替身） | 10-22 |
| [030](030-desktop-grid.md) | 桌面：看不见的对齐网格、任意形状 | 已实现（v2，图片 / 便签不做；在 032 的小组件之上） | 8 px 看不见的步长 + 智能参考线（边 / 中线 / 12 px 间距，Alt 不吸），不显示点阵；自由大小；功能块不叠（互换 / 就近避让）；三档按贴边推导 | `.claude/preview-desktop-grid.html` | 10-22 |
| [031](031-stop-idle-agents.md) | 停止空闲的智能体 | 实现中（cutex feat/stop-idle + feat/0.2-stop-idle） | 一键下线空闲 30 分钟以上的智能体（子菜单选门槛）；cutex 判断谁空闲、会杀掉工作的不停；缺省可唤醒；确认框逐个可取消，可撤销 | — | 10-22 |
| [032](032-desktop-widgets.md) | 桌面小组件：一套接口 | 已实现第一版（契约 v1.22） | `desktop.widget`：大小（网格步长）、形状、能放几个、设置表（外壳画表单）、共用计时器、来源（模块 / 服务 / 智能体）、`actions`；今天的五块和新的「世界时钟」都是小组件；写法见 `docs/widget-authoring-guide.md` | — | 10-22 |
| [033](033-browser-round-trips.md) | 浏览器任务少走几轮模型 | (b)(c) 已实现（cutex feat/browser-round-trips，r250）；(a) 待主人 | `browser_navigate` / `browser_open` 可带 `snapshot: true` 顺带返回快照；新工具 `browser_visit` 一次依次读最多 10 个网址；都在 facade 里由原有命令组合，准入 / N2 / 审批 / 租约逐步照旧；只读浏览器工具进 code mode 只是方案 | — | 10-22 |
| [034](034-stable-prompt-cache-key.md) | 新智能体固定提示缓存键 | 后端已实现（cute-codex 86af98482 + cutex a33b967/ee15a24，未合并）；桌面开关已做（feat/0.2-prompt-cache-key，未合并） | 同一工作区的 agent 线程共用一个稳定 prompt_cache_key，第一发也吃到缓存；默认关，风险写明 | — | 10-23 |
| [035](035-cute-codex-core-upgrade.md) | cute-codex 换新内核（native r54 = 上游 0.163.0） | 实现中（cute-codex `upgrade/cutex-163.0-r1`，本地，未发布） | 上游 0.163.0 + fork 补丁；目标工具不再死循环（没目标不给 `update_goal`；同样失败 3 次不再执行）；带上 027 A / C；速度差是 Fast 没开，不是 cutex / cute-codex | — | 10-23 |
| [036](036-claude-auto-compaction.md) | Claude 自动压缩 | 已实现（cutex feat/claude-compaction + feat/0.2-claude-compaction，未部署） | Profile 设置里设「上下文达到约 N token 时压缩」（默认 / 30 / 50 / 70 万 / 自定义窗口 + 百分比），存在原有的 claude-runtime.json，下次启动运行时生效；按模型分别设这次不做（换模型不重启 Claude Code，cutex 也不知道实际模型） | — | 10-22 |
| [037](037-claude-live-settings.md) | Claude 回合中换模型 / 推理强度；按模型的自动压缩 | 已实现（cutex feat/claude-live-effort，claude-r24 / r250）；按模型压缩的界面未做 | Claude Code ≥ 2.1.295 时，模型、推理强度、Fast 直接发给正在运行的 Claude Code，回合中也行，下一步就生效，不重启；老 CLI 照旧；Profile 新字段 `claudeCompactionModels` 存在新文件，换模型时适配器即时换压缩值 | — | 10-23 |
| [038](038-shelf-page-groups.md) | Shelf 页组：胶囊、合并 / 拆开、页面单独开 | 已实现（feat/0.2-shelf-groups，未合并） | Rail 一页一个胶囊（多窗格叠图标，拖框 = 整页、拖图标 = 窗格）；拖到胶囊中间 = 合并（≤ 3）、拖到「新页」= 拆开；页面 / 委托 / 服务默认自己一页；新建{{agent}}像新工作换掉当前对话（Ctrl = 并排）；设置打开时托盘仍在会话下面，放不下收进「… N」 | `.claude/previews/preview-shelf-page-groups.html` | 10-23 |
| [039](039-workspace-groups.md) | 工作区 = 组；托盘分钉住 / 最近 | 已实现（desktop main，10-23） | 并排的 A+B 是一个工作区，托盘画成胶囊；点 C 去 C 自己的工作区、A+B 保留；替换只在拖放 / 右键「替换这一栏…」；Ctrl+点最多 2 列（满了出两个半边选）；托盘左钉住（左上钉子、点 = 取消）｜右最近（≤ 6），每项右上 × | `.claude/previews/preview-workspace-groups.html` | 10-23 |
| [040](040-visual-language.md) | 设计语言：安静的外壳、头像当主角 | 主人 10-23 同意（#7 不改）；第 1 步实施中 | 统一圆角 / 间距 / 字号（19 → 6）/ 颜色角色为 CSS 变量；头像全圆、默认不加底色、按模型上色可选；侧栏默认「花名册」+ 窄入口行，「现在 / 全部」可选；15 步迁移约 17–20 人日 | — | 10-23 |
| [041](041-profile-auto-pick.md) | 新建智能体时自动挑账号 | 设计定稿 | 先选服务商，账号缺省「自动」：cutex 只在这一家的订阅账号里按「多久撞墙」挑（`profile: "auto:anthropic"`），挑中谁写明、可改；一个对话一辈子一个账号，不转发、不跨家；可选、每个账号默认关（「参与自动选择」），是否符合条款由用户判断 | cutex `feat/profile-auto-pick` 50bc494（P0+P1） | 10-23 |
| [050](050-owner-message-delivery.md) | 主人的消息怎么送到智能体（发送 / 排队 / 插话 / 中断） | 实现中（桌面小包先发；cutex r271 + claude-r34；存储与锁 r272 归 Alice 计划） | 准入只试一次全机锁、抢不到被当成「忙」是三个现象的同一根因；改成专用准入线程排队等锁（不在 bridge worker 上等，防死锁）、统一会话状态 admission.state、原因码一一映射、每条消息只占一行、主人自己的中断不留提示；这一块出问题先读本文件 | — | 10-31 |
| [049](049-kimi-runtime.md) | Kimi Code 运行时、Kimi 账户 | 桌面已实现（feat/r266-kimi-desktop，未合并）；cutex 由 r266 K1 / K2 做 | Kimi Code 是第二个 ACP 运行时，和 DSH 共用一张运行时表；Kimi / Moonshot 的 Profile 可加 Kimi 变体（默认仍是 cute-codex，带「暂不建议使用」）；设置里添加 Kimi 账户、在主机上用网址 + 验证码登录，令牌不经过桌面；Profile 选 Kimi 账户或自己的 key；插话 / 分叉 / 回退 / 图片都看运行时声明；老主机不变 | `?variants&kimi=ready` | 10-27 |
| [048](048-profile-runtime-variants.md) | Profile 的运行时变体与 Profile 自己的 key | 桌面已实现（feat/r265-dsh-desktop，未合并）；cutex 由 r265 C3 做 | 一个 Profile = 一个服务商 + 一份凭证，可带几个运行时变体（DeepSeek：cute-codex + DSH）；新建智能体先选 Profile 再选变体，创建后不变；能不能用、要不要安装由 cutex 回答；key 只写入、不显示，写明影响哪些智能体；DSH 回合中输入的消息先说明会排到下一回合；Claude API 账户可在桌面输入 key；主机没有这项能力时保持原表单 | — | 10-27 |
| [047](047-cutex-auto-approval.md) | Cutex 自动审批规则 | 已实现（r258 分支，待发布） | 主人可给指定智能体建立明确 kind、项目限制和有效期的主机规则；Director 有三项可关闭的安全身份授权；普通规则首击生效，高风险仍输入确认；每次自动决定留审批记录和审计，浏览器标签仍由主人选择 | `.claude/previews/auto-approval-build` | 10-24 |

| [053](053-mobile-desktop-alignment.md) | 手机端与桌面端对齐 | P1 已合并 main（0d3d862a），Waveline 待接入 | 配对手机权限矩阵；统一头像与最近消息、本地 pin、额度、快捷会话/独立智能体、服务 forwarding；P2 项目入口，P3 主机 pin/可移植画像 | — | 11-01 |
| [057](057-notices-ride-with-owner-message.md) | 排队的提示随主人消息一起送 | 草案，等主人审阅 | Esc 暂停后主人发消息时，「接下来」里可送的提示 / 留言 / 委托结果附在主人消息后同一次提交（主人在前）；消息发出后才到的仍按下一工具步骤插入；改写 054 决定 1；r275 | — | 11-03 |
