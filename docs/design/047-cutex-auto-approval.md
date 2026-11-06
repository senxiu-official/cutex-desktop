# 047 — Cutex 自动审批规则

可用性以主机与运行时声明的能力为准；发布说明仅使用公开版本号。

## 1. 目标与边界

Cutex 目前只保存“一次请求、一次决定”的审批。开发期间，主人希望能给指定智能体（例如 Director）一组随时可撤销的自动审批规则，并从输入框左下角、Claude 的「完全访问」「规则」旁直接查看和修改。

规则属于 **cutex 主机**，由 cutex 在审批闸门内执行；桌面端只展示和编辑，不能在本地替 cutex 放行。只有持 Management root credential 的主人可以新建、扩大、续期或删除规则。智能体可以说明希望得到什么规则，但 API 与 Agent Bus 都不提供自助授权入口。

自动规则只替代“主人是否批准”这一步，不会绕过原有验证、权限上限、禁止目录、项目隔离、标签页选择、幂等摘要或预算上限。请求在规则判断前仍须通过全部硬性检查。

服务整理与审批是两层独立状态。服务可以是按主机默认 TTL 回收的「临时」，或不自动到期的 persistent；persistent 可带 agent 在登记时建议的 `purpose: foreground | background`。主人可在服务页把临时服务「保留」为 persistent（默认前台，也可选后台），以及修改用途、自定义组、星标、顺序、备注、隐藏或归档。隐藏只移出主列表；归档停止并隐藏但可恢复，绝不删除 root 或文件。这些主人直接做的整理动作不产生审批，也不能由自动审批规则代做。

`service_lifetime` 自动规则只可能批准 agent 请求的 persistent 生命周期和该请求携带的 purpose 提示；它不授予修改 owner-only 整理字段的能力。主人后来修改的用途和整理字段在同一 slug 被 agent 重登记时必须保留。服务页自己的卡片/详细列表、前台/后台/未分类/临时分区以及隐藏/归档筛选，也不与输入框「规则」面板里的 Cutex 一栏混合。

## 2. 现有审批清单与风险

源码的 `ApprovalKind` 只有下列 8 种；其余 `approval_required` 命中是等待、错误映射或 UI 展示，不是新的审批类型。委托的 `pendingReview` 和工作流的 `pendingApproval` 也落在同一审批存储。

风险级别决定**主人建立/扩大规则以及手工批准时**的确认方式。规则面板里，新增或重新启用低/中风险规则第一次点击就生效；只有明确包含高风险变体时才需要输入确认词。手工批准仍沿用自身的风险确认。自动放行不会把风险降级。

| kind | 守护的动作与源码入口 | 建议风险 | 自动规则约束 |
| --- | --- | --- | --- |
| `managed_service` | 智能体登记或改变 managed 命令，cutex 以主人身份在智能体沙箱外运行。`src/services/agent_api.rs` | 高 | 只能按该 kind 明确勾选；建立/续期时输入确认。不能用通配规则获得 |
| `service_lifetime` | 把服务改为 persistent（可附 `foreground` / `background` purpose 提示）；同一请求可能合并 managed 命令或外部 static root。`src/services/agent_api.rs` | 单纯生命周期为中；合并越权执行/目录时为高 | 后端读取生产请求的顶层 `managedExecution` / `staticRoot` 并取最高风险；缺失、畸形或无法解析一律按高风险；批准 purpose 提示不授予 owner-only 服务整理权 |
| `static_root` | 将 cwd/项目工作区外的目录或 HTML 暴露给浏览器；禁止位置仍直接拒绝。`src/services/agent_api.rs`、`src/services/static_files.rs` | 高 | 规则必须明确该 kind；首版不支持路径通配，仍绑定请求里的 canonical root |
| `agent_profile` | create/replace 使用主人标记为需审批的 Profile；不会绕过创建者权限上限。`src/agent_bus/server.rs` | 中；Profile 标记 sensitive/high-cost 时高 | 可选限制到生产请求顶层 `profile`；费用或敏感标记由后端提高风险 |
| `ask_delivery` | 委托到能力更强的智能体，或项目/peer 策略要求复核。`src/asks/gate.rs` | 能力越界/跨项目为高；纯人工复核策略为中 | 后端读取生产请求的 `differences` / `versions`；超出调用者能力包络或跨项目均为高，无法解析也按高；跨主机不是另一种 kind |
| `browser_claim` | 请求主人浏览器标签页，标签可能带主人登录态。通用批准本身不选标签、不发 lease。`src/browser_relay/approval.rs` | 高 | 即使明确授权，也绝不自动选择或移交主人标签；仍由主人选具体标签。既有 origin/session grant 继续优先 |
| `browser_open` | 在独立的智能体登录池打开一个精确 URL；只在 `agentOpenApproval` 要求时产生审批。`src/browser_relay/approval.rs` | 中；已设为 off/full-access 的路径为低且本来就不产生审批 | 可按 kind 自动；规则不接受任意 origin 通配，首版仍绑定每个请求摘要 |
| `workflow_run` | 启动脚本、参数、profiles/models 与资源上限绑定的多智能体工作流。`src/workflows/engine.rs` | 高 | 只能明确勾选；规则读取生产请求顶层 `maxAgents` / `maxTokens`，超过规则上限即回到手工审批 |

首版没有需要新增规则的低风险 ApprovalKind。低风险层级保留给已由主人设置为无需审批的动作，以及未来确实无外部副作用的审批类型；不要为了让 UI 有三档而人为降级。

现状补充：普通审批 24 小时失效，决定历史通常保留 7 天并以 500 条为清理目标；决定记录已有 `decidedBy`、连接与自报 client 信息。现有决定 API 只接收 `{note?, client?}`，未知字段会拒绝，因此新协议必须有独立 capability。

## 3. 规则模型

### 3.1 匹配

一条规则是明确 allow-list：

```json
{
  "ruleId": "aar-…",
  "enabled": true,
  "subject": { "type": "agent", "cutexSessionId": "cutex.…" },
  "projectId": "desktop",
  "kinds": ["service_lifetime", "agent_profile"],
  "constraints": {
    "profileIds": ["profile-…"],
    "workflow": { "maxAgents": 4, "maxTokens": 200000 }
  },
  "expiry": { "mode": "today", "expiresAt": "2026-10-24T23:59:59+11:00" },
  "highRiskKindsExplicit": [],
  "revision": 3
}
```

- `subject.type` 首版必须为 `agent`；可选 `project` 规则只作为之后的扩展。若加入 project，agent 规则优先，显式 deny/disabled 永远优先于 allow。
- `projectId` 可选；存在时，请求者和请求 facts 都必须属于该项目。不能用空 project 匹配跨项目动作。
- `kinds` 是枚举集合，没有 `*`。未知 kind 既不匹配也不被旧客户端删除。
- 高风险 kind 必须同时出现在 `highRiskKindsExplicit`，并在创建或扩展时经过输入确认；“全部允许”“复制另一智能体规则”不能暗中加入。
- `service_lifetime`、`ask_delivery` 等复合风险由后端根据规范化 facts 计算。实际风险高于规则声明时不匹配。
- 规则只匹配请求者、项目、kind、限制与有效期；请求 SHA 仍防止一次审批被换成另一请求。

### 3.2 Director 身份授予

当前 Director 在自己的项目里天然拥有三项动态授权：单纯的 `service_lifetime`、非高风险 `ask_delivery`、`browser_open`。它们不是首次升级时写入的规则副本，而是在每次匹配和列举时由当前项目身份计算：会话成为 Director 时出现；离任、被替换、被归档/退休或项目归档时立即消失；以后重新上任又出现。托管命令、工作区外静态目录、标签页控制、工作流、需批准 Profile，以及任何复合请求的高风险变体都不由身份授予。

API 把三项分别投影成普通规则行，`source = "role"`、`grantedBy = "role:director"`、`createdBy = "system"`。主人可以为某一 Director 单独关闭或重新打开每一项；覆盖值按会话持久保存，离任后不删除，重新上任仍遵循之前的选择。身份匹配写普通 ApprovalRecord，归因为 `auto:role/director`，审计显示“由 Director 身份”。Operator 不获得任何身份规则。

### 3.3 有效期

支持四个主人可见选项：

- `turn`：只匹配创建规则时记录的 `runtimeGeneration + turnId`；该 turn 结束、重启或 generation 改变即失效。
- `hour`：从提交成功起 1 小时。
- `today`：按主机当前时区到当天 23:59:59，API 同时返回绝对 `expiresAt`，避免远程桌面时区歧义。
- `revoked`：一直有效，直到主人撤销；高风险必须再次输入确认，UI 明示“不会自动到期”。

所有过期判断由主机时钟完成。修改系统时间不能把已过期规则复活；加载时以持久 `expiresAt` 与单调运行期检查中较早者为准。

### 3.4 决策顺序与审计

1. 先完成现有请求验证、权限上限与禁止项检查。
2. 生成稳定 `ApprovalRequest` 与后端风险等级。
3. 如已有明确 deny 或 pending/approved record，保持现有语义。
4. 先检查主人规则，再检查当前 Director 身份授予；无匹配则完全按旧行为创建普通 pending approval。引入规则功能本身不增加任何审批请求。
5. 匹配时仍写一条 `ApprovalRecord`，状态直接为 consumed/approved-as-needed，`decidedBy.by = "auto:rule/<ruleId>"`，并写独立审计事件。

每次自动决定的审计至少包含：时间、ruleId 与 rule revision、主人创建者或 `role:director` 来源、请求者、项目、kind、计算风险、request SHA、经过的 constraints、结果（allowed/refused/fellBack）、到期模式，以及对应 approvalId。审计追加写；规则删除不删除历史。主人可导出，智能体只能从自己那次工具结果知道“由主人规则/Director 身份自动批准”，不能读取规则清单或其他智能体的审计。

`browser_claim` 的自动决定最多标记“规则允许进入标签选择”，不选标签、不创建 lease；没有主人具体选择仍不得控制主人登录态。

## 4. 主人交互

### 4.1 输入框旁的统一「规则」

输入框只有一个「规则」芯片。Claude 会话打开后是响应式双栏：左栏保持既有 Claude 权限规则不变，右栏是 Cutex 规则；Codex 会话只显示 Cutex 一栏。窄窗口把两栏上下堆叠。旧 daemon 没有 `approval-auto-rules` 时，Claude 仍只有左栏，Codex 不显示这个芯片。

Cutex 栏标题与 Settings 卡都有说明：Codex 的审批/沙箱和 Claude 的权限模式（自动、完全访问等）管智能体自己机器上的命令与文件修改；Cutex 规则管它向 cutex 请求的服务、需复核委托、浏览器、需批准 Profile 与工作流。完全访问不会绕过 Cutex 审批。

芯片针对当前智能体显示有效规则数。Cutex 栏顶部对 Director / Operator 显示只读身份说明，并链接到项目页修改；普通成员不显示。成员的新建、归档、替换与启停是项目角色能力，不伪装成规则 kind，也不由规则开关控制。Operator 身份从项目的 `agent_operators` 投影读取。弹层只列它按当前角色、Profile 与已声明 cutex tools 实际可能触发的 kind；身份/能力尚未知时才显示全部。弹层可设置 kind、项目限制、有效期和可选约束，并把 Director 身份授予与主人自己添加的规则分组。关闭身份授权、添加普通规则或重新启用中风险规则都在第一次点击立即生效；明确包含高风险 kind/变体才进入输入确认对话框，确认词包含智能体名与 kind，防止在错误会话里授权。

成功后就地显示“已生效；已在等待的审批仍需手动处理”。规则只作用于保存成功后到来的新匹配请求，不追溯或自动处理已经 pending 的审批。

### 4.2 Settings

Settings → 协作 → Cutex 规则展示本主机全部规则：Director 身份授予单独一组，主人自己的规则另列；显示智能体/项目、kind、风险、有效期和最近一次命中。主人可开关身份授权，以及暂停、撤销、缩短、续期自己的规则并查看审计；中风险第一次点击生效，扩大到高风险才输入确认。远程主机使用该主机 root credential，不能由只读 device token 修改。

审批卡可提供“这次批准”与“为此智能体建立规则…”两条清楚分开的动作。高风险卡的单次批准同样使用输入确认；中风险使用原位置二次确认；拒绝仍可单击后填写备注，不创建规则。

## 5. Management v2 协议

新增 capability：

```json
{
  "featureList": ["approval-auto-rules"],
  "features": { "approvalAutoRules": true }
}
```

新增 root-only 资源（名称不复用 Claude rules）：

| API | 作用 |
| --- | --- |
| `GET /v2/approval-rules` | `{contractVersion, hostId, revision, catalog, rules}`；catalog 由后端给出 kind、动态风险说明、可用 constraints |
| `POST /v2/approval-rules` | 新建规则；要求 `expectedRevision` 与经过高风险确认得到的一次性 `confirmationToken` |
| `PATCH /v2/approval-rules/{id}` | 修改/暂停/续期；CAS；扩大权限重新确认，缩小或撤销不要求确认 |
| `DELETE /v2/approval-rules/{id}` | 撤销；幂等，写审计 |
| `POST /v2/approval-rules/confirm` | 主人提交 typed phrase，返回短时、单用途 token，绑定规范化规则摘要与 root principal |
| `GET /v2/approval-rules/audit?cursor=&limit=` | 分页审计；默认最近 100 条 |

`GET /v2/approvals` 的记录只做可选加法：`risk`, `matchedRuleId`, `autoDecision`, `ruleRevision`。决定 API 保持原样；以后若需从审批卡原子地“批准并建规则”，增加独立 `POST /v2/approvals/{id}/approve-with-rule`，不要给旧 `/approve` 塞字段，因为旧服务会拒绝未知字段。

后端必须对 catalog 与每个请求的风险负责，桌面不能凭 kind 自行降低。规则写入使用私有权限、原子写和 revision CAS；自动决策与 approval store 在同一锁/事务边界提交，避免“动作已放行但审计没写”。

## 6. 兼容与上线

- 新 daemon + 旧桌面：旧桌面忽略 capability 与新增审批字段；普通审批流继续可用。主人可经新客户端创建的规则仍在后端生效，自动决定会出现在旧桌面的普通已处理历史中。
- 旧 daemon + 新桌面：没有 `approval-auto-rules`，不调用新路由、不显示「Cutex 规则」或 Settings 卡。
- 新旧智能体 runtime/MCP façade：规则判断在 cutex 服务端，工具 schema 无需变化；工具结果可以 additive 地带 `approvedByRule`，旧 façade 忽略。
- Director 身份授予是服务端运行时投影，不执行升级播种，不会反复把主人关闭的项目重新写回。无匹配时仍是升级前的普通审批路径；删除 UI 的中风险二次点击也不会扩大高风险路径，因为只有空 `highRiskKindsExplicit` 才能首击保存，高风险仍要求绑定规则摘要的一次性 typed token。
- 先上线只读 catalog/audit，再上线 CRUD，最后启用 matcher。功能开关关闭时规则保留但不匹配，便于紧急停用。
- `browser_claim` 既有 origin/session grant 不迁移成通用规则；两套记录分别展示并分别撤销。

## 7. 验收

1. 智能体无法通过任何 Agent Bus/MCP 路由创建、扩大或续期规则。
2. 高风险不能由通配、项目继承、复制或旧客户端意外启用；每个 kind 都有绑定摘要的 typed confirmation。
3. 一条规则不能绕过禁止 static root、创建者权限上限、浏览器标签选择、项目边界或工作流资源上限。
4. turn/hour/today/revoked 在重启、时区和过期边界下行为确定；过期规则不会复活。
5. 每次自动批准都有 approval record 和可分页审计；规则撤销后历史仍在。
6. capability 缺失时新桌面零请求、零占位；旧桌面面对新字段和自动处理记录不崩溃。
7. 规则新增/启用：低与中风险第一次点击生效；只有显式高风险输入确认。保存后的提示说明不追溯 pending 审批。
8. Director 三项身份授权只在当前、未归档的 Director 及其本项目生效；高风险变体不匹配；每项关闭覆盖跨离任/重新上任保留。
9. Claude 只有一个规则入口（双栏、窄屏堆叠），Codex 只有 Cutex 栏；弹层只列当前会话能触发的 kind，未知能力才回退为全部。

## 8. Mockup

固定 mock 构建见 `.claude/previews/auto-approval-build`：`index.html` 直接打开输入框芯片，`settings.html` 直接打开 Settings 规则清单；高风险输入确认可从芯片内触发。旧的 `.claude/previews/047-cutex-auto-approval.html` 仍保留为批准前的三屏方案稿。
