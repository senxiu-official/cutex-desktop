# 049 Kimi Code 运行时、Kimi 账户（桌面）

状态：**桌面已实现（feat/r266-kimi-desktop，未合并）**。cutex 一侧：K2 的 Profile / 账户契约见 cutex
`docs/development/r266-kimi-profiles.md`；K1 的运行时（`kimi-runtime` 组件、`kimi-acp-subset` 协议）在
`feat/r266-kimi-runtime`。建在 [048](048-profile-runtime-variants.md)（运行时变体）之上。

## 一句话

Kimi Code 是 DSH 之后的第二个 ACP 运行时。桌面不再为每个运行时各写一套分支，而是**一张 ACP 运行时表**
（`lib/acpRuntimes.ts`）：协议名、后端名、能力名、组件名、显示名、「暂不建议使用」开关。DSH 和 Kimi 都从这张表读，
以后加第三个只加一行。Kimi 的会员登录在「设置 → Profile → Kimi 账户」里完成：cutex 在主机上跑官方的
`kimi login`，桌面只显示网址和验证码、轮询状态，**令牌从不经过桌面**。

## 在哪里能看到

| 地方 | 内容 |
|---|---|
| 设置 → 运行时 | 「Kimi」一组：已装的版本、各版本有几个智能体在用、Kimi Code 版本、Node 要求、「暂不建议使用」、去新建 Profile 的路径；没装时直接给「安装」 |
| 设置 → Profile → Kimi 账户 | 添加账户（名称 + 区域：中国大陆 / 海外）→ 登录（网址 + 验证码）→ 状态、重新检查、退出（左键点两次）、改名、删除（有 Profile 在用时 cutex 拒绝） |
| 设置 → Profile → 添加 | 服务商多一个「Kimi 账户」：选账户，运行时只能是 Kimi，可选 Kimi 默认模型（来自账户的模型目录）和推理强度 |
| Moonshot / Kimi Code 的 API key Profile | 运行时变体多一个「Kimi」（带「暂不建议使用」），模型手写，推理强度 off / low / medium / high / max；**默认仍是 cute-codex** |
| 新建智能体 | 选 Kimi 变体或 Kimi 账户的 Profile 后：运行时「Kimi」，模型 / 推理强度按 Kimi 的目录，没有沙箱 / 审批 / 计划模式 / 目标 |
| 会话头部 | 运行时标签「Kimi」 |

## 都由能力决定

- `kimi-runtime-profiles`（K2）：Profile 里出现 kimi 变体、「Kimi 账户」服务商、`kimiAccount` 字段。
- `kimi-accounts`（K2）：Kimi 账户这一节。没有就不显示。
- `kimi-runtime`（K1，装好组件后才有）：可以新建 Kimi 智能体。
- 设置 → 运行时的 Kimi 组：有 `kimi-runtime`，**或者**有 `kimi-runtime-profiles` + `components`（cutex 认识 Kimi、
  能装组件但还没装）时显示，好让主人在这里装。DSH 保持 r265 的规则（装好才显示）。
- 会话里的动作看这个会话自己的 `native.schema.capabilities.features`：插话（`turnSteer`）、分叉、回退、删除、
  旁聊要**明确为 true** 才给；图片要 `imageInput: true` 且不是 `textInputOnly`；`threadSettingsUpdate` 决定模型 /
  推理强度能否在会话中改。K1 当前声明 `turnSteer:false`，所以回合中输入的消息排到下一回合，提示和 DSH 一样。
- 老主机：没有这些能力时一切照旧，没有任何 Kimi 的入口。

## 「暂不建议使用」

一个开关：`lib/kimiNotice.ts` 的 `KIMI_NOT_RECOMMENDED`（和 DSH 的 `DSH_NOT_RECOMMENDED` 同样用法）。改成 false，
运行时页、Profile 的变体行、新建 Profile 的勾选行上的标签和说明一起消失。**默认变体不跟这个开关走**：
有 cute-codex 的 Profile 默认一直是 cute-codex；只有 Kimi 账户的 Profile（只能用 Kimi）默认才是 Kimi。

## Kimi 账户登录（设备码）

1. 「登录」→ `POST /v2/kimi/accounts/{id}/login`，cutex 在主机上开始 `kimi login`，先是 starting。
2. 拿到网址和验证码后（pending）显示：网址（可复制）、「在浏览器中打开」按钮、大号验证码、剩余时间。
   - **只在点按钮时打开**，走主进程已有的 `openExternal`（只允许 http(s)）；渲染端再加一道：只接受 https，
     http 只允许回环地址（调试用的本机 cutex）。
3. 按 cutex 给的 `interval` 轮询（限制在 2–30 秒，starting 时 1 秒），到 succeeded / failed / expired / denied /
   cancelled 停。取消 = `DELETE …/login/{loginId}`。
4. cutex 重启后旧的 loginId 不认识了（`kimi_login_not_found`）：显示「登录已中断」，给「重试」。
5. 打开设置时某个账户正在登录（账户里带 `login`），面板接着这个登录轮询，不重开。

登录在**主机**上完成，网址在主人自己的浏览器里打开；面板上写明「登录发生在主机 X 上」。

## Profile 选凭证

- Kimi 账户的 Profile（`kind: "kimi"`）：凭证 = 一个 Kimi 账户。编辑页「服务与凭证」里换账户 =
  `PATCH {kimiAccount}`，只影响之后启动的智能体；写明同一账户还被哪些 Profile 用。头部写「已登录 / 未登录」。
- Moonshot / Kimi Code 的 API key Profile：用 Profile 自己保存的 key（和 048 一样只写入）。用环境变量的
  Profile 不能加 Kimi 变体；不是 Kimi / Moonshot 官方接口的 Profile 也不能（cutex 的原因 `providerNotKimiNative`）。

## 实现时定下的细节

- **一张表**：`ACP_RUNTIME_INFO` 里 kimi = 协议 `kimi-acp-subset`、后端 `kimi`、能力 `kimi-runtime`、组件
  `kimi-runtime`、显示「Kimi」。原来写死 `"dsh"` 的地方（插话去向、回退不带文件、审批来源、权限菜单、计划模式、
  技能来源、Profile 种类、默认模型是否可编辑……）都改成「是不是 ACP 运行时」。运行时页卡片
  `AcpRuntimeCard({runtime})`，`DshRuntimeCard` 留作包装。
- **识别会话**：协议名、后端名或启动绑定（`launch.runtime`）任一对得上就算 Kimi，协议名以后改了也不会认错。
- **上下文占用**：`thread.kimiContext` 和实时的 `kimi/contextUsage/updated` 与 DSH 同形；Kimi 的 `observedAt`
  可以是 null，照样接收。
- **模型目录**：Kimi 账户变体的模型来自 `runtimeVariants[].models`（账户登录后 cutex 读到的目录）；API key 的
  kimi 变体 `models: null`，模型手写（留空 = Kimi 默认）。
- **Kimi 账户 Profile 的默认模型**：创建时先 `POST /v2/profiles {kind:"kimi", kimiAccount}`，再
  `PATCH …/variants/kimi` 设默认模型和推理强度（和 048 一样：前面成功、后面失败时保留 Profile 并说明哪一步没完成）。
- **快速对话**（不经新建智能体页）用 Profile 的默认变体。
- **组件**：`kimi-runtime` 的状态可以带 `kimi: {version, node?}`；`node` 与 DSH 同形（Kimi Code 是 Node 程序，
  要 Node ≥ 22.19），有就显示「Node ≥ x · 当前 y」并据此标「已就绪 / 未就绪」，没有就写「由主机组件提供」。
- **额度**：Kimi 账户的额度这次不做（K2 契约 §10 说以后再加），Profile 卡片上显示「没有额度信息」。
- **预览**：`?variants&kimi=ready`（已安装）、`?variants`（未安装）、`?kimiLogin=hold|pending|fail`、
  `?kimiNode=missing`。Mock 在 `modules/kimi-accounts/mock.ts`、`modules/jobs/mock.ts`、`dev/mockProfileVariants.ts`。
- **合并到 r265b 时（集成）**：r265 R2 的三处 QA 修正对所有 ACP 运行时都成立。快速对话跟随 Profile 的默认变体，
  默认变体是 kimi 时和 DSH 一样不带 Codex 权限 / 模型选项；主机没有 `kimi-runtime` 时发送按钮不可用。变体编辑里的
  模型列表用 cutex 给的目录并显示目录里的名字；DSH 没选时显示目录默认，Kimi 没选时仍是「Kimi 默认」一项。

## 与 cutex 的约定（交给 K1 / K2）

- K1：组件状态里给 `kimi: {version, node: {minimum, version, ready}}`（同 DSH）；装好后在能力里给 `kimi-runtime`。
- K2：Kimi 账户 Profile 的 `providerFamily` 是 `kimi-code` / 「Kimi Code」（集成时在 cutex 一侧补上）；
  `PATCH /v2/profiles/{id}/variants/kimi` 要能用在 Kimi 账户 Profile 的主变体上（设默认模型 / 推理强度）。
