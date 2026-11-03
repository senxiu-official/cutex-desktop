# 053 手机端与桌面端对齐

状态：P1 分支实现，待合入和 Waveline 接入验收。2026-11-01；基线 desktop `1c1a7a93e`。
这是持续更新的设计记录；完成下一阶段时更新本文件的进度和限制。

目标：同一智能体在手机上保持同一个头像，消息按最近活动排列；手机能查看额度与用量、创建快捷会话和独立智能体、进入服务。项目管理按手机操作习惯逐步加入。

边界：本仓库负责 `packages/cutex-mobile`、`packages/cutex-client`；Waveline 在自己的仓库更新 `deps/cutex-desktop` pin、接导航和转发、构建 APK。不会在本仓库修改 Waveline，不改变 daemon 授权规则。

## 1. 配对手机的权限（只读源码核对）

核对的是 cutex **release/r271 `c2819d4f8f85b25baad38cec2f33d01937085fb8`** 的 git blob；不是 upstream/cutex 当前工作区。下列行号均指该提交。

- `src/management/server.rs:489` remote_gate：tailnet/LAN listener 只接受 Management client/device token；root bearer 本身不能直接远程连接。`:553–606` 校验 cxm1 token 后映射 root credential，再先检查 device scope、后检查非 owner 的 user principal。**配对令牌不等于无条件 owner**。
- `src/management/v2/access.rs:228` OWNER_RULES 把 human、profiles、profile-presets、profile-auto-pick、usage、services 列为 owner-only；`:428–450` pending 回 `access_pending`，普通 user 对 owner-only 路由回 `owner_required`。`:794–856` GET/HEAD 只需 read；human 创建、service open 等未被特别放行的 POST 需 full；`:861` 是 device scope gate。read/chat/full 的设备限制与用户权限取交集。
- `src/management/v2/server.rs:118–124` services 要求 root；`:519–538` 校验 root-scoped 路由；`:656–676` human、profile/quota、presets、auto-pick、usage 都是 root-scoped。成功验证的 owner device token 满足此要求，路由没有额外 loopback 检查。

| 路由 | owner + read/chat | owner + full | member / pending | loopback 限制 |
|---|---|---|---|---|
| POST `/v2/human/sessions`, `/v2/human/agents` | 拒绝 | 允许 | 拒绝 | 无 |
| GET `/v2/profiles`, `/v2/profiles/:id/quota`, `/quota-config` | 允许 | 允许 | 拒绝 | 无 |
| GET `/v2/profile-presets`, `/v2/profile-auto-pick` | 允许 | 允许 | 拒绝 | 无 |
| GET `/v2/usage`, `/prices`, `/sources` | 允许 | 允许 | 拒绝 | 无 |
| GET `/v2/services` | 允许 | 允许 | 拒绝 | 无 |
| POST `/v2/services/:slug/open` | 拒绝 | 允许 | 拒绝 | 无 |

与这些功能不同：`server.rs:614` 的 pairing-code 创建只允许 loopback，且要求 owner-local；`v2/profiles_api.rs:710–726` 带凭证的 profile export 在远程回 `credentials_loopback_only`。手机功能不调用这两类接口。

`services.rs:645` 把 open 交给 supervisor；`services/supervisor.rs:1269–1320` 会按需启动 managed service，再返回服务视图中的 url/localUrl。**open 不建立手机隧道**，不能把返回的 127.0.0.1 替换成 tailnet IP 后声称已转发。继续使用 Waveline 已有的 authenticated forwarding/view-ticket 流程。

以上是路由授权结论，不是对任何 live daemon/手机 token 的实测；本次不连接 live 管理端口。

## 2. 阶段划分

| 阶段 | 内容 | daemon 改动 | client / mobile / Waveline |
|---|---|---|---|
| P1（本分支） | 统一头像；最近消息；本地置顶；owner 额度总览；快捷会话/独立智能体；服务列表和宿主转发入口 | 不需要 | client 补端口；mobile 实现；Waveline 更新 pin 和可选 hook |
| P2 | 会话/项目两个入口；项目列表、主管、成员、需要你和委托状态的手机布局；额度范围/来源选择、按配置用量明细 | 先用现有 project/event/operator API；缺口实证后再列 daemon 任务 | mobile 导出项目页；Waveline 接 tab/导航，APK 实机验收 |
| P3 | 创建/编辑项目、成员管理；跨设备头像资源一致性；如主人选择则同步 pin | 同步 pin 需新增主机状态和 API；桌面本地头像库需明确可移植资源接口 | 桌面/手机一起适配；不能靠手机模拟 daemon 业务状态 |

## 3. P1 行为与接入契约

- 桌面的原 `lib/agentInitials.ts` 成为兼容 re-export；算法唯一实现放在 browser-safe 的 `@cutex-desktop/cutex-client/agentInitials` 子入口。保留全部桌面测试，手机使用同一项目去前缀、版本去后缀、两字母/CJK 和冲突处理。
- 列表、联系人、详情、聊天头共用 AgentAvatar。中性底色，provider 色描边；有可用的自定义 emoji/icon 则展示它。icon 只能由宿主 `platform.agentAvatarUrl(hostId, agentId, icon)` 提供可信图片；不把 metadata.value 直接当网络 URL。桌面 device-local 图片、bundled portrait/theme/headwear 没有手机资源库时显示稳定 initials；本阶段不复制整个桌面资源/偏好系统。`avatarMode=inherit` 不强行使用旧的固定头像。头像元数据通过 sessions 快照每 host/list revision 合并加载，失败保留 summary/字母；离线保留同一配对身份的成功快照，重配/URL 变化后隔离。名字、成员变化和重连更新，头像单独修改后的即时推送尚待 P2 补全。
- 正常会话跨项目按 lastActivityAt 倒序；需要你、置顶保留独立区域，项目名和多主机标签保留；联系人维持项目分组。置顶仍是本机 storage，原有 pin key/迁移语义不变。
- WorkList 内置 WorkTools：按主机选择、读取 capabilities 后只展示当前 owner 权限允许的入口；403 不升级权限。独立导出 `WorkQuota`，宿主可以挂到自己的额度页面。
- 额度显示各 profile daemon gauges，含 stale/error/resetAt；当天 token/请求/估算费用来自 usage ledger。不同窗口和账号的百分比不相加；不把缺额度读成零。P1 的日期为手机当前日历日期发给主机，跨时区主机的“今天”可能不同；P2 加日期选择。usage/prices/sources、quota-config、profile-presets/auto-pick 的只读 client 端口也已补齐，P1 UI 只用默认/明确 profile 和当天总数。
- 新建默认快捷会话，可选独立智能体，填写名称、选 profile/主机默认。POST **start:false**，创建后打开正常聊天再发送首条任务。每次意图先写手机非秘密 storage 幂等 requestId；丢响应、关闭表单/重开/应用重启后对同一输入显式重试仍用原 ID。未成功保存 ID 不发 POST。不会因为启动失败再次创建；不自动重试创建。
- `platform.openService?(hostId, slug): Promise<void>`：宿主负责 authenticated forwarding、启动/打开和其错误。未接 hook 时列表可读，显示转发尚待宿主接入；不触发 /open 或外部导航。client.openService 已可供宿主复用。
- 原有 shell nav/storage/secrets 接口保持兼容；新增 hooks 全是可选。Waveline 可以先只更新 submodule pin，再渐进接上。移动端语言仍为已有 zh-CN/en，本阶段不扩语言系统。

## 4. 早晨待主人决定

1. **置顶是否跨设备同步？** 建议暂保留本地：手机和桌面使用场景不同；若要同步，先由 daemon 提供状态/API，再一起适配。
2. **是否采用“会话 / 项目”两个顶层入口？** 建议采用；P2 做项目页，Waveline 拥有最终 tab 和导航。
3. **是否把桌面的画像库/默认头像偏好同步到手机？** P1 已共享 initials 与统一组件；完全视觉一致需要可移植资源和偏好契约，建议单独列 P3。

以上是建议，不是已获得主人决定。不需要为技术实现选择追加批准。

## 5. 验证和后续

P1 要求：workspace typecheck、client/mobile tests、因抽出 desktop initials 而执行完整 desktop vitest、Hant check、diff check。结果见本分支 PROGRESS 的 2026-11-01 Finch 条目。

后续集成要在 Waveline 实机测试 host 切换、长名/小屏、重配/撤权、创建丢响应重开、离线列表、profile quota 不可用和服务 forwarding。当前没有 APK/实机结果，不宣称上述已验收。
