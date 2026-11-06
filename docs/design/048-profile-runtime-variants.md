# 048 Profile 的运行时变体与 Profile 自己的 key（桌面）

主机和运行时按声明的能力提供这些功能；已有智能体保留创建时的变体。

## 一句话

一个 Profile = **一个服务商 + 一份凭证**，可以带**几个运行时变体**（例：DeepSeek 的 Profile 同时有 cute-codex 和 DSH）。
新建智能体时先选 Profile，再选变体；**智能体创建后一直用这个变体**，以后加 / 改 / 删变体都不影响已有的智能体。
主机上的 cutex 说了算：哪个运行时能用、要不要安装、为什么不能用，都由 cutex 算好告诉桌面，桌面不自己判断。
主机还没有这项能力（`profile-runtime-variants`）时，一切照旧，桌面显示原来的表单。

## 新建 Profile（设置 → Profile → 添加）

五步，都在一页里，从上往下填：

1. **服务商**：ChatGPT 登录 / Claude / API key（选服务商预设和 Base URL，和原来一样）。
2. **凭证**：
   - ChatGPT：创建后在 Profile 页登录。
   - Claude：选 Claude 账户（订阅或 API 账户）。
   - API key：一个密码框，**只写入**——交给主机上的 cutex 保存，桌面不保存、不再显示；可以留空，之后在 Profile 页设置。
   - 「高级」（只在 DeepSeek 官方接口时出现）：改为读取主机环境变量，**必须写明变量名**；cutex 只读这个变量，
     不会在保存的 key 和环境变量之间自动替补。选了环境变量，就只能用 DSH。
3. **运行时**：每个运行时一行勾选框，后面写它是什么和状态：
   - 「可用」：可以勾；
   - 「需要安装」：可以先勾上，这台主机装好组件之后才能启动（下面给出安装入口）；
   - 「不支持」：灰掉不能勾，写明原因（例如「ChatGPT 登录只能用于 cute-codex」「只有 DeepSeek 官方接口能用 DSH」）。
   - DeepSeek 默认勾 cute-codex，DSH 可以加勾；DSH 一行带「暂不建议使用」。
   - 勾了几个时写「新建智能体默认用 cute-codex」——DSH 去掉「暂不建议使用」之前，默认一直是 cute-codex。
4. **默认模型**：每个勾选的变体一行（cute-codex：模型名，留空 = 服务商默认；DSH：从 DSH 的模型列表里选，和推理强度）。
   只影响之后新建的智能体，每个智能体创建时还能再改。
5. **名称与外观**：名称、颜色（自动或八种之一）。

点「创建」后：先建 Profile，再逐个加变体，再设颜色。前面成功、后面某一步失败时，Profile 保留，
弹出一条说明「哪一步没完成、cutex 怎么说」，并直接打开这个 Profile，可以在页上补做。

## 编辑 Profile

两个新区块，放在 Profile 卡片下面：

### 服务与凭证

- 服务商和它的接口（OpenAI 兼容 / DeepSeek 原生 / …）。
- 凭证：来源（保存在主机上的 key / 主机环境变量 X / ChatGPT 登录 / Claude 账户）、「已设置 / 未设置」、第几版。**从不显示 key 本身。**
- 「替换 key」：密码框 + 按钮，按下立即发出，框随即清空。DSH Profile 保存的 key 还可以「删除 key」（左键点击两次确认）；
  删了以后，这个 Profile 的智能体下次启动会因为缺少凭证而失败（不会悄悄改用别的 key）。
- DSH Profile 的「高级」：切换为读取主机环境变量（写明变量名），或切回保存的 key。
- 写明影响范围：「影响这个 Profile 的 N 个智能体（下次启动时生效）」——正在运行的智能体不切换。
  Claude 账户的凭证属于账户，写出共用这个账户的其他 Profile，在「Claude 账户」里改。

### 运行时变体

- 每个变体一行：运行时、「主变体」「默认」标签、几个智能体在用、默认模型 / 推理强度。
- 主变体就是 Profile 本身的运行时，它的默认模型在下面原来的「模型」区里改；其他变体在这一行直接改，按「保存」。
- 「设为默认」：之后新建智能体默认用它。
- 「添加变体」：只列 cutex 说这个 Profile 能用（或装好就能用）的运行时；需要安装的写「需要安装」。
- 删除：主变体不能删；还有智能体（含已归档）绑定的变体不能删——按钮先灰掉并说明原因，
  cutex 如果在这期间发现有新绑定，仍会拒绝，页面写「还有 N 个智能体绑定这个变体，不能删除」。

## 新建智能体

- 先选 Profile；Profile 有几个变体时，上面多一行「运行时 [cute-codex | DSH]」，旁边写「创建后不能更改」。
- 运行时就是选中变体的运行时（cutex 的回答），不再从 Profile 的类型去猜。选了 DSH，模型和推理强度用 DSH 变体的默认值，
  沙箱 / 审批等 Codex 才有的选项不显示。
- 创建时把选中的变体明确发给 cutex（自动挑账号时由 cutex 用那个 Profile 的默认变体）。

## 智能体头部

DSH 智能体在名字旁有一个「DSH」小标签，鼠标停上去写「运行时：DSH（创建时固定）· Profile omega · 变体 dsh」。
cute-codex 是最常见的情况，不加标签。

## DSH 不能插话

DSH 没有回合中插话。DSH 智能体正在跑一个回合时：

- 输入框的占位文字是「继续输入：消息会在本回合结束后作为下一回合发出」；
- 一旦输入了内容，输入框上方出现一行「这个运行时不能在回合中途插话：现在发送会排队，本回合结束后作为下一回合发出」。

发送按钮本来就显示「排队（本轮结束后发送）」，`queue.steer.runtimeNoSteer` 的提示也不变；这里只是在发送**之前**就说清楚。
任何不支持插话的运行时都一样（不只 DSH）。

## Claude API 账户在桌面输入 key

Claude API 账户支持在桌面输入 API key，并保留主机终端设置方式。

- 「添加 API 账户」表单多一个可选的 API key 密码框；填了就随添加一起发给 cutex，添加后不再需要终端步骤。
- 「设置 key / 更换 key」的引导第一步改为「在这里输入 key」，第二步「或者在主机终端运行下面的命令」。
- 文字写明：只写入，桌面不保存、不显示；新 key 对之后启动的智能体生效，正在运行的不切换。

## key 的去向（所有 key 一样）

渲染进程的输入框 → preload → 主进程（按字段重建请求、校验格式，错误信息不含 key）→ cutex，只在那一次请求里。
发出后输入框立即清空，无论成功与否；不进草稿、不进通知、不进错误报告、不写日志；cutex 只回「已设置 / 第几版」。

## 配置与兼容性

- **创建前的预览**：cutex 的兼容表是按 Profile 算的，Profile 还没建时没有。第 3 步先用服务商预设自带的
  `runtimeCompatibility`（如果 cutex 以后在 `GET /v2/profile-presets` 里给出），否则按契约 §2 的表预览，
  并标明「这是创建前的预览；创建后以主机上的 cutex 判断为准」。创建后只按新 Profile 自己的 `runtimeCompatibility` 加变体，
  不一致时报出 cutex 的原因，不硬加。
- **建什么类型的 Profile**：勾了 cute-codex → 建 Codex 的 API key Profile，DSH 作为变体再加；只勾 DSH → 建 DSH Profile
  （key 由 cutex 保存，或用高级里的环境变量）；Claude / ChatGPT 照旧。
- **默认变体**：DSH 还「暂不建议使用」，所以同时勾两个时默认是 cute-codex，桌面不自动改成 DSH。
- **删除 key** 只对 DSH Profile 保存的 key 提供（cutex 不支持清除 Codex Profile 的 key）。
- **DSH 模型**：列表以 cutex 的回答为准——已有对话用 DSH 自己的 `model/list`，DSH Profile 用
  `GET /v2/profiles/{p}/models`；都拿不到时（新建 Profile、cute-codex Profile 上的 DSH 变体、旧主机、读取失败）
  才用 DSH 0.2.1-rc.3 通过 cutex 报出的名字 deepseek-flash（默认）/ deepseek-v4-pro，只写在 `lib/dshModels.ts` 一处。
  已保存的旧名字（如 deepseek-v4-flash）留在列表里，不会被悄悄换掉。没选模型时发 DSH 的默认 deepseek-flash；
  桌面主进程不再自己补模型名（不发 = cutex 的默认）。
- **已有 DSH 对话改模型 / 推理强度**：主机支持时，DSH 对话可以改（`thread/settings/update`，
  正在跑的回合不变，下一回合起生效）。输入框的模型和推理强度按钮对 DSH 和其他运行时一样可用——条件是这个对话的
  运行时说能改：`threadSettingsUpdate`（cutex 以后若明确给出），没有这个字段时看运行时的能力表（`textInputOnly: false`，
  和这项改动同一批发出）；旧的 DSH 运行时照旧只显示、不能改。显示的模型是对话当前的（`threadSettings`，
  DSH 退回会话的模型默认值 `model_defaults`），不是创建时的值。
- **DSH 分叉 / 回退 / 删除**：照会话的 `threadFork` / `threadRevert` / `threadDelete` 显示（cutex 说了算，
  会话固定在没有 session-ops 的旧运行时上时没有分叉 / 回退）。DSH 的回退和「编辑并重发」写明「DSH 只回退对话，
  文件不会恢复」；DSH 没有文件检查点，「回退到这里（含文件）」永远不出现，回退请求也不会带 `rewindFiles`。
- **DSH 图片**：运行时说能收图（`imageInput: true` 且不是 `textInputOnly`），并且当前模型的列表写了
  图片输入（deepseek-flash 可以，deepseek-v4-pro 不行）时才能附图；否则照旧提示「这个模型不接受图片」。
  智能体还不存在时（新建智能体、快速对话），DSH 只在 cutex 列出的模型写了图片输入时可以附图，不认识的模型当作只收文字。
- **「暂不建议使用」**：由 `lib/dshNotice.ts` 的 `DSH_NOT_RECOMMENDED` 一个开关控制（运行时卡片、两种新建 Profile 表单、
  变体行，以及同时勾两个时的默认变体）。主人决定去掉时只改这一处：标签全部消失，新 Profile 同时勾两个时默认 DSH。
- **快速对话**不加变体选择：用 Profile 的默认变体（cutex 决定）。
- 头部标签只给非 cute-codex 的运行时；Claude 智能体只在有绑定记录时显示。
- DSH 智能体的审批卡片来源标签写「DSH 沙箱」（不是「Codex 沙箱」）；Claude 智能体暂时不变。
- 新建智能体选 DSH 变体、变体没设推理强度时，「推理」显示模型在 cutex 目录里的默认值（DSH 为「高」），
  不再写「待指定」；只是显示，不额外发送。
- Profile 头部 / 卡片里与服务商预设同名的套餐标签、服务商家族不再重复显示。
- 「计费数据不可用」只看运行时 / 会话的功能表：明确写 `billingUsage: false` 才出现在上下文弹窗里；
  `true`或没写都不显示。会话上下文里的 `dshContext.billing: "unavailable"` 只是说那个
  上下文占用数字本身不含计费，不决定这句提示；上下文占用照常显示。Profile 表单里的 DSH 推理强度一行不再带这句
  （那里没有运行时的回答）。
- 离线一行：cute-codex 照旧「发送消息会自动启动 app-server」；DSH / Claude 智能体写「发送消息会自动启动 DSH /
  Claude」。
- 回退之后，侧栏这一行显示留下来的最后一条消息，不再显示被移除的回复（所有运行时都一样）。cutex 的会话
  `activity` 还记着被移除的回复，桌面记下「回退前看到的最新时间」，早于它的那条不再显示（存本机，重启后仍有效）；
  回退之后的新回复照常显示。
- 新建 / 删除文件的工具行按整份内容计数并显示成增删行（「修改文件 notes.txt +1 −0」，展开是 `+one`），
  不再是「+0 −0」；和轮尾「改了 N 个文件」同一套算法。所有运行时都一样。
- DSH 智能体输入框底栏的推理强度：没有实时设置时（例如分叉后第一条消息才启动运行时）用会话的默认值
  （cutex `runtimeDefaults.reasoningEffort`），和模型的做法一样；不再一直显示「…」。
- Profile 页头部在窄的设置面板里：「设为默认 / ⋯」换到名字下面一行，名字不再被截成「ds-fina」。
- 新建只用 DSH 的 Profile、选了「把 key 存在这里」但没填：照样明确发 `credential: stored`
  （Profile 先没有 key，启动时说缺 key），不再落到读 `DEEPSEEK_API_KEY`；什么都不发的旧建法保留原样。
- 快速对话不发 `variantId`，cutex 用 Profile 的默认变体开；所以草稿的控件和默认值跟默认变体走：默认变体是
  DSH 时不显示 Codex 权限，模型/推理来自这个变体（cutex 给的 `runtimeVariants[].models`，没有时才用 DSH 自己的名字）。
- 变体编辑里 DSH 变体的模型下拉用 cutex 给这个变体的模型目录（显示名、目录默认）；已存的旧模型名保留为一项。

## 与 cutex 契约的出入（交给 C3 / C1）

- DSH Profile 的 `/models`（`src/profiles/dsh.rs::models`）还是 cutex 自己的 `deepseek-v4-flash` + Profile 的模型、
  只写文字输入；它应当和 DSH 的 `model/list` 一致（deepseek-flash 带图片、deepseek-v4-pro），默认模型也应是 deepseek-flash。
  桌面照 cutex 的回答显示，所以在 cutex 改之前，DSH Profile 页上只看到 cutex 给的那几个名字。
- DSH 能力表可声明 `threadSettingsUpdate: true`（additive），桌面就不用从 `textInputOnly` 推断。

- cutex 回退（`cutex/session/history/revert`）后没有修剪会话的 `activity.lastOutput` / `lastToolCall`，
  被移除的回复仍是侧栏的「最新消息」。建议回退时按留下的轮次重算（或清空）这两项；桌面的补救在 cutex 改了之后也无害。
- 缺一个「创建前」的兼容表（见上）。建议 additive：`GET /v2/profile-presets` 每项加 `runtimeCompatibility`（按官方地址算）。
- `variant_in_use` 的 `details.sessions` 是 id 字符串数组；桌面已兼容（显示 id，无名字）。
- 桌面按契约写，用 `?variants` 的预览 mock（`dev/mockProfileVariants.ts`）验证；没有连真 cutex。
