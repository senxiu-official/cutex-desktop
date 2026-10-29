# 012 额度重置券：看得到，确认后才用

状态：**实现中**（resets，10-22；cutex `feat/resets` cfeaf6d 未部署，桌面 `feat/0.2-resets`）。来源：主人 10-21：GPT、Claude、GLM 都有「额度重置券」；要能查（张数、到期）也要能用（确认后用一张）。

## 研究结论（每家怎么查、怎么用）

| | 查 | 用 | 要什么登录 | 结论 |
|---|---|---|---|---|
| **ChatGPT / Codex** | app-server `account/rateLimits/read`（不带 `excludeResetCreditDetails`）→ 后端 `GET /wham/usage` + `GET /wham/rate-limit-reset-credits`；返回 `rateLimitResetCredits {availableCount, credits[{id, status, grantedAt, expiresAt, title, description}]}`（秒） | `account/rateLimitResetCredit/consume {idempotencyKey, creditId?}` → `POST /wham/rate-limit-reset-credits/consume`；结果 reset / nothingToReset / noCredit / alreadyRedeemed | ChatGPT 登录；API Key 一律报错 | **支持**。cute-codex TUI 的 `/usage` 就是这一对方法（`tui/src/chatwidget/usage.rs`、`app/background_requests.rs`）。cutex 已经为每个配置起一个不跑回合的短命 app-server 读额度（`profile_quota_native.rs`），只是一直带 `excludeResetCreditDetails: true`，所以只有张数没有到期时间 |
| **Claude** | `GET https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1` 里的 `cedar_ember {eligible, ineligible_reason, at_limit, grants[{id, label, resets_total, resets_left, ends_at, paused, usable_now}], next_grant_id, cooldown_until}` | `POST /api/organizations/{orgUuid}/reset_rate_limits {program: "cedar_ember", grant_id, request_id}` → `{result: reset / already_used / not_limited / cooldown / ineligible / unavailable, resets_left}` | Claude.ai 订阅登录（OAuth）；组织 UUID 在账号目录 `.claude.json` 的 `oauthAccount.organizationUuid` | **支持**。来源：Claude Code 2.1.301 内置的 `/limit-reset`（隐藏命令）和 `/rate-limit-options`（字符串检索，代号 cedar_ember）。另有每周一次的「立刻重置会话限额」（juniper_tide），是服务端实验分组，**不做**。claude-agent-sdk 0.2.166 没有任何相关字段；cutex 现有的 Claude 用量读取用的是不带 `cedar_ember=1` 的地址，所以以前读不到 |
| **GLM（智谱 / Z.ai）** | ZCode 服务 `GET https://zcode.z.ai/api/v1/coding-plan/reset/status`（另有 `POST …/opportunity` 由服务端判定发券） | `POST …/coding-plan/reset/use {idempotency_key, reset_type: FIVE_HOUR / WEEK}` | `Authorization: Bearer <ZCode 登录 JWT>` + `X-Bigmodel-Authorization: <智谱 / Z.ai 网页登录 JWT>`；ZCode 文档明确写「不是 Coding Plan API key」「不得回退普通 API Key」 | **不支持**（只在 ZCode 里）。证据：ZCode 仓库 `docs/coding-plan-quota-reset-ui.md`（2026-08 版）、`docs/coding-plan-quota-reset-review.md`。cutex 现有的 GLM 额度读取（`/api/monitor/usage/quota/limit`，用 API Key）没有重置券字段 |

证据位置：Codex 协议 `codex-rs/app-server-protocol/src/protocol/v2/account.rs:315–430`，后端路径 `codex-rs/backend-client/src/client/rate_limit_resets.rs`；Claude 从 `~/.local/share/claude/versions/2.1.301` 的字符串里找到（函数 `He` 是领取，`je` 是查询；`$e=/^[a-z0-9_-]{1,40}$/` 是券 id，`zn=/^[A-Za-z0-9_-]{1,64}$/` 是请求 id）；GLM 来自 `github.com/zai-org/ZCode` 3c5b227。

## 做法

**cutex（能力 `profile-reset-credits`）**

- `GET /v2/profiles/{p}/reset-credits[?refresh=true]`：`{provider, supported, unsupportedReason, availableCount, credits[{id, title, status, expiresAt, resetsLeft, …}], detailsComplete, fetchedAt, error, account?}`。读失败写在 `error` 里，不算请求失败。
- `POST /v2/profiles/{p}/reset-credits/consume {idempotencyKey, creditId?}`：用一张。同一个 key 重试不会用第二张；同一账号同时只能有一个在用（409 `reset_credit_consume_in_progress`）；用成功后重新读额度，并推送 `cutex/profile/quota/updated`。
- 不支持的：`apiKey`（API Key 登录、Claude API 账号）、`zcodeOnly`（GLM / Z.ai）、`provider`（其他）。

**桌面**

- **额度弹层**（输入框右下角的配置额度圈）：额度条下面一行「重置券 2 张 · 最早 10月26日 到期 · 用一张」；没有券写「没有重置券」；不支持的配置不显示这一行。
- **设置 → 配置 → 额度读取**：「额度重置券」一行：张数，每张的名称和到期时间，「用一张」按钮。GLM 配置这一行写「GLM 的重置券只能在 ZCode 里用，cutex 暂时读不到」。
- **额度用完条**（输入框上方托盘）：某个额度窗口用到 0（或 Claude 的「额度用完 · 自动继续」正在等）并且账号有券时，多一条「额度用完 · 有 2 张重置券 · 用一张」。
- **用的流程**：点「用一张」→ 应用内确认框（红色确认按钮），写明账号（Codex：「配置 gamma 登录的 ChatGPT 账号」；Claude：「Claude 账号 X（用这个账号的所有配置都会受影响）」）、会重置什么、还剩几张和这张的到期时间、「用掉后不能撤回」→ 确认后才发请求 → 窗口底部提示结果（「额度已重置 · 还剩 1 张重置券」，或「现在没有需要重置的额度，重置券没有用掉」等）→ 重新读券和额度。
- 优先用最早到期的那张。

**开销和缓存**

- 只在需要时读：弹层打开、设置页打开、额度用完条出现时；**不加后台轮询**。
- cutex 每个账号缓存 60 秒（`refresh=true` 也至少隔 10 秒），桌面同一配置 60 秒内不重复读。Codex 每次读要起一个短命 app-server（和现在的额度读取一样，约 1–2 秒）；Claude 是一个 HTTP 请求。

## 实现时定下的细节

- 一次点击的回复没收到（超时 / 断线）时，15 分钟内再点会沿用同一个 key：服务端会答「已经完成过」，而不是再用一张。
- Claude 的券属于 Claude 账号，同一账号的多个配置共用一份读数和一份「正在使用」锁。
- Claude 的 token 过期时不刷新（和现有用量读取一样），提示「登录已过期，下次运行这个账号的 Claude 会话时会刷新」。
- 测试只用假数据和假接口；开发过程中没有用过任何一张真券，也没有在线读过。

## 待主人决定

- GLM：要不要让 cutex 保存一份 ZCode 登录（以及智谱 / Z.ai 网页登录）来读、用 GLM 的重置券？这需要一套新的登录流程，和现在的 API Key 配置是两回事。没决定之前只显示「只能在 ZCode 里用」。
