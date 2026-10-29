# 035 cute-codex 换新内核（native r54 = 上游 0.163.0）

状态：**实现中**（cute-codex `upgrade/cutex-163.0-r1`，只在 hachimi 本地 `/home/ema/cutex-dev/cc-upgrade`，未推送、未构建发布版、未部署）。
来源：主人 10-22「要修 cute-codex 的话，顺便把内核升级了」；同时要修目标工具死循环（k3 连调 70 次 `update_goal`）、
带上 027 的生成图片两个修复、查清输出速度为什么比 Codex Desktop 慢。

## 结论（先看这里）

1. **新内核用上游 0.163.0**（10-15 发布的正式版）。0.164 目前只有 alpha（到 alpha.12），不用。版本号 **0.163.0-r54**。
   已暂存的 r53（0.162.1）不再单独启用，r54 包含它的全部内容。
2. **目标工具死循环修好了**，两层：线程没有目标时不再给模型 `update_goal`；任何工具同一个调用、同样的错误连续失败
   3 次后不再执行，再重复 2 次就结束这一回合并说明原因。上游（含 0.164 alpha）都还没有这两样。
3. **生成图片的两个修复（027 的 A、C）已经带到新内核上**，和上游 0.164 以后的新存法兼容。
4. **速度差别不在 cutex，也不在 cute-codex**：是 **Fast（优先处理）开没开**。同一个写 200 行代码的任务，
   cute-codex 走 WebSocket、走 HTTP、Codex Desktop 自带的程序，全都是约 37–45 token/s；只有开了 Fast 是 62–69 token/s，
   正好是主人在 Codex Desktop 里看到的 57–65。cutex 给每个智能体默认关 Fast（`service_tier="default"`）；
   桌面的推理强度弹出框里已经有 ⚡ Fast 开关（cutex `session-fast-mode`），要快就对那个智能体打开（用量算 2 倍）。

## 1. 选哪个上游版本

| | 0.162.1（r53，已暂存） | **0.163.0（选它）** | 0.164.0-alpha.12 |
|---|---|---|---|
| 发布 | 正式 | 正式，10-15 | 预览版，10-22 当天还在出 |
| 相对 0.162.1 | — | 1305 个文件，+58k / −19k | 再 +97k |
| 图片附件库 #54398 | 无 | 无 | 有 |
| 目标工具 / 重复失败 | 无 | 无 | 无 |

0.164 的 #54398 只是把生成图片条目改成「附件库引用 + 退回内联」，不改发给模型的内容；开源版附件库只有内联实现，
对我们没有体积上的好处。我们的 A 修复写出的记录（`result: ""` + `savedPath`）在 0.164 的类型里按「内联」读出
（`GeneratedImageRef` 是 untagged，`File` 在前、`Inline { result }` 在后），所以以后升 0.164 不需要迁移。

## 2. 分支内容（`upgrade/cutex-163.0-r1`，基于 r53 e29c53d8b）

| 提交 | 内容 |
|---|---|
| `63995e744` | 合并上游 rust-v0.163.0；21 个冲突文件（见 R54-NOTES） |
| `d730db377` | 合并后的测试编译修正（上游新字段） |
| `9f2781b80` | r52.1：`tool_schema_compat = "strict"`（Gemini 严格工具 schema） |
| `7360730df` | r52.2：分叉对话不再因为没处理完的 ExternalInput 被拒 |
| `90610d3d0` | r52.3：Windows 受限令牌沙箱也绕开商店版 PowerShell |
| `d7b8c14b2` | 027 A：已存成文件的生成图片，对话记录只留路径 |
| `e4bdef015` | 重新生成 app-server 协议 schema |
| `a3ebb9760` | 目标工具：没有目标时不提供 `update_goal` |
| `c5a20dabb` | 工具调用：同样失败连续 3 次后不再执行，继续重复就结束回合 |
| `98704ebf6` | clippy 修正（fork 自己的旧代码） |
| `e3a802eb8` | 027 C：图片多时一次只留最新几张给模型（默认关） |
| `d8ef43abe` | rustfmt |
| `db2fcb8d1` | 027 A 补正：只在写盘时去掉图片，读旧记录时照旧带图（上游测试抓到的） |
| `0e032361b` | 版本号 0.163.0-r54（只改 workspace 版本） |
| `b5bde43ce` | R54-NOTES.md |

（最终提交号以 R54-NOTES 为准；分支在本地，等 lead 决定推到 remote 开发库。）

## 3. fork 补丁清单（对 0.163.0）

| 补丁 | 做什么 | 结论 |
|---|---|---|
| ExternalInput（协议、准入 / 预约 / 闸门、恢复、账本、`thread/externalInput/*`） | 委托 / 消息作为模型可见的 `external_event`，可恢复、至多一次 | **保留**。上游 0.163 新增 `turn/start` 的 `toolOutput.retain` + 压缩时保留「客户端标记的独立工具输出」（#52686、#52937），方向一致，但没有独占准入、回执、去重；以后瘦身可以考虑改走它 |
| 压缩保留当前回合的 ExternalInput（r50） | 中途压缩不丢正在处理的委托 | **保留**（上游的新保留只认 `turn/start` 带 `retain` 的输出） |
| strict provider 投影 | 第三方 provider 把无配对的工具输出改写成用户消息 | 保留 |
| 分叉 / 迁移账本校验（r49、r52.2） | | 保留（r52.2 在 0.163 上改了：`ResumedHistory` 新字段 `history_revision` 在改写历史后清空） |
| Presentations（`thread/presentation/*`） | 只显示不进上下文的通知 | 保留（以后可移到 cutex，见 fork-necessity 研究） |
| `--auth-file`、provider key 回退、env_key 不传给子进程 | 每个 profile 私有凭据 | 保留 |
| `--model-variants-capability`、`request_model`、线程保留能力探测 | | 保留 |
| rollout 崩溃残留（NUL 行）跳过 | | 保留 |
| `MessagePhase::PartialAnswer` 回移 | | **不再需要单独的补丁**：0.162 起上游自带 |
| D4 `capabilities.instructions_field` | 不收 developer 指令的 provider 用顶层 `instructions` | 保留 |
| `tool_schema_compat` | Gemini 严格 schema | 保留（新带入） |
| Windows 商店版 PowerShell 回退 | | 保留（新带入；上游 0.163 没有） |
| thread_history 迁移编号（fork 7/8/9，上游 0008→0010） | | 不变；0.163 只在 `state_5` 加了 0060、0061，不冲突 |
| 生成图片只存路径（027 A） | | 新增。放进 `persisted_rollout_item` 本身，所有写盘路径都经过它 |
| 图片历史批量收起（027 C） | | 新增，默认关（`generated_image_history_max_inline` / `_keep`） |
| 目标工具 / 重复失败断路器 | | 新增，**适合提给上游**（见 §4） |
| TUI（状态栏、sparkle、展示时间线、cute-claude 权限弹窗） | | 照 r53 保留；桌面完全替代 TUI 后整块删 |

## 4. 目标工具死循环

**原因**：`update_goal` 对所有线程都提供（`ext/goal/src/extension.rs` 的工具列表不看有没有目标），描述里也没说
「只有已有目标时才调」。没有目标时它返回「cannot update goal because this thread has no goal」，有的模型（k3）
把这当成可重试的错误，一模一样地重复。核心里也没有任何「同一个调用一直失败」的保护。上游 0.164 alpha 仍然如此。

**修法（两层，都在 0.163 上写，原样适用于 r53 / r52.3，文本上无冲突）**：

- (a) 目标扩展记住「这个线程有没有目标」（未知 / 无 / 有，每次读写目标时更新，线程启动时读一次）。
  **确定没有目标时**工具列表里不放 `update_goal`；未知时照旧。描述加一句「只有已有目标时才调用」；
  没有目标时的错误改成明确的「这个线程没有目标，不要再调用 update_goal」。
  缓存影响：工具列表只在创建 / 清除目标时变一次，其他时候请求前缀不变。
- (b) 通用断路器（`core/src/tools/repeated_failures.rs`，每回合一份）：同一个工具、等价参数（JSON 键顺序 / 空白不算）、
  同样的错误连续失败 3 次后，第 4 次起**不执行**，直接回给模型「这个调用已经同样失败 3 次，不要再用这组参数；
  换参数、换做法，或者向用户说明」；被拒后还重复 2 次，就**结束这一回合**，错误说明「模型反复调用一个已经
  失败 3 次的 `xxx`」，用户可以接着对话。任何成功、任何不同的调用都会清零，所以换参数重试不受影响。
- 测试：goal 扩展 29 + 新增 2 个、断路器 6 个单测全过。没有用真实 k3 跑过（需要部署后观察）。

**提给上游**：两个提交都是上游风格、和 cutex 无关，可以原样做成 PR（「Hide update_goal when the thread has no goal」、
「Stop re-executing a tool call that keeps failing identically」）。

## 5. 输出速度

在 remote 上直接驱动 app-server（`~/ab-test/speed/probe.py`、`run4.sh`、结果 `r4/summary.txt`），同一个账号、
gpt-6-astra medium、「一次写出 200 行的 inventory.py」，每种 3 次交错跑，线程用 `ephemeral` 不留记录：

| 方式 | 输出 token/s（整个回合） | 首字 |
|---|---|---|
| cute-codex r52h2，cutex 的启动参数，WebSocket | 36.4 ± 7.2 | 4.8 s |
| 同上，强制 HTTP | 36.7 ± 8.2 | 5.2 s |
| Codex Desktop 自带的 codex 0.162.0-alpha.2，Desktop 的启动参数 | 39.4 ± 4.3 | 3.9 s |
| cute-codex r53 | 37.7 ± 6.7 | 4.5 s |
| **cute-codex r52h2 + Fast（`serviceTier: priority`）** | **62.0 ± 10.9** | 3.7 s |

（第 3 轮所有标准速度的都慢到 27–30，是服务端负载；前两轮都是 40–43。）

- 传输方式（WebSocket / HTTP）对速度没有影响。fork 让「带着委托的那一次请求」走 HTTP（为了至多一次，不自动重发），
  只影响那一次请求（多上传一次完整上下文），不影响生成速度，**保持不变**。
- Codex Desktop 自己的程序也只有 40 左右；Desktop 的记录里 10-22 17:47 那个线程确实切到过 `priority`。
- cutex 启动每个 Codex 智能体时传 `-c service_tier="default"`（明确的「标准速度」）；
  cutex 已有每个智能体的 Fast 开关（`session-fast-mode`，桌面 ⚡）。**不需要改 cute-codex。**

## 6. 协议变化（r53 → r54），cutex / 桌面要知道的

全是新增，没有删除或改名：

- 新方法 / 通知：`thread/items/read`、`thread/readState/update`、`thread/readState/changed`（已读位置）。
- `TurnToolOutput.retain?`（见 §3）；`ThreadListParams.excludedThreadIds?`。
- 原始 `ResponseItem` 的 message / function_call 等多了可选的 `encrypted_content`、`status`；`output_text` 多了
  `annotations`、`logprobs`。
- fork 接口（`thread/externalInput/*`、`thread/presentation/*`、能力探测、`--auth-file`、`--external-input-binding-file`）不变。
- 行为：`instant_interrupt` 上游仍默认开（cutex 已固定为关，继续保留）；`cli_daybreak` 默认开（只影响 CLI 的访问计划选择）；
  上游不再带打过补丁的 zsh（cutex 没用相关开关）；运行命令前多了沙箱完整性检查。
- 状态库：`state_5` 新增 0060（guardian 反馈）、0061（已读位置），只加表；r53 / r52 打开时忽略（`ignore_missing`）。
  thread_history 不变（仍是 10）。

**cutex 要做的（给 lead）**：

1. 发布包把 native 换成 0.163.0-r54：manifest / schema sha 重新钉（照以往 release kit）；`MIN_NATIVE_VERSION` 不用改。
2. 继续传 `features.instant_interrupt=false`。
3. 027 C 的 profile 设置（`imageHistoryTrim`，已合并）在 r54 上同样有效（配置键相同）。
4. 断路器结束回合时，app-server 发的是普通的回合错误（`error` 通知 + `turn/completed`），cutex 按失败回合处理即可；
   如果委托因此结束，回执里能看到原因文字。
5. 可选：桌面 `packages/protocol` 用 r54 的 schema 重新生成（新增字段都是可选的，不重新生成也不坏）。
6. 速度：不用改；如果主人想让某些 profile 默认就 Fast，那是新的 profile 设置，另开方案。

## 7. 风险

- 上游一次进了 58k 行；fork 的改动在 21 个冲突文件里逐个合并，fork 自己的测试都过，但**没有在真实 cutex 守护进程上跑过**，
  Windows 也没有构建、测试过。
- 回退到 r53 / r52：数据库只是多了表，旧版能开；rollout 新增的可选字段旧版按 serde 忽略，但没有像 R53 那样做
  全语料回读验证（R53 §5 的方法，待做）。
- 断路器是新行为：极少数「同样参数、同样错误、但多试几次会好」的工具（比如外部服务临时不可用但错误文字相同）
  第 4 次会被拒。错误文字不同就不算，所以超时类错误一般不受影响。
- 目标工具在「未知」状态（读目标失败）下照旧全部提供，不会比现在差。

## 8. 测试结果

hachimi（Linux），`cargo +1.95.0`：

- `cargo build -p codex-cli -p codex-app-server`、`cargo check --workspace --all-targets`（不含 voice-host、bwrap、v8 三个包）：通过，无警告。
- clippy（core、goal、rollout、tools、thread-store）：通过。
- nextest，13 个包 9297 个测试：8906 过、391 不过。同样这 391 个在**纯上游 0.163.0** 上（同一台机器）有 389 个也不过
  （代码模式要 V8 宿主、测试用 MCP 服务器、沙箱等环境原因）；剩下 2 个：一个是 027 A 第一次移植的真问题
  （读旧记录也把图去掉了），已修（`db2fcb8d1`）；另一个是 r52 起就有的 fork 行为（别的程序把记录文件改小时拒绝投影），不是这次引入的。
- 最终代码上 `--lib` 3725 个测试 3721 过，4 个不过的都在上游基线的不过名单里。
- fork 自己的测试（ExternalInput、展示、私有凭据、模型配置、线程保留、生成图片 A / C、tool_schema_compat、目标工具、断路器）全过。

## 9. 发布步骤（lead 打包，主人签名）

前提：分支推到 remote 开发库（`/mnt/workspace/PersonaProjects/Cutex/cute-codex`）并在那里建 `release/native-r54`
和本地标签 `upstream-rust-v0.163.0`（= 上游 rust-v0.163.0 的提交 83086188a）；lead 把
`scripts/public-export/projects/cute-codex/project.json` 改成 `"ref": "release/native-r54"`、
`"base": "upstream-rust-v0.163.0"`、`"baseTag": "rust-v0.163.0"`。

`R=/mnt/workspace/PersonaProjects/Cutex/public-release`，`KEY=~/.config/cutex-release/minisign.key`，
`S=scripts/public-export/sign-and-upload.sh`，在桌面主检出目录运行。

A. 导出（lead，本地）：

```sh
/usr/bin/python3 scripts/public-export/release.py cute-codex --version 0.163.0-r54 --out $R/cute-codex \
  --ref release/native-r54 \
  --message 'New Codex core (upstream 0.163.0); goal tools no longer loop on threads without a goal; a tool call that keeps failing identically is stopped; generated images are stored by path.'
```

B. 推送并建草稿（主人）：

```sh
git -C $R/cute-codex push https://github.com/senxiu-official/cute-codex.git release refs/tags/cute-codex-v0.163.0-r54
gh release create cute-codex-v0.163.0-r54 -R senxiu-official/cute-codex --verify-tag --draft \
  --title 'cute-codex 0.163.0-r54' \
  --notes 'cute-codex 0.163.0-r54: the agent runtime of cutex, on upstream Codex rust-v0.163.0. Every file that differs from upstream is listed in `CUTE-CODEX-CHANGES.md`.'
```

C. CI 构建（主人）：

```sh
gh run list -R senxiu-official/cute-codex --limit 5      # "cute-codex build binaries"
# 只有标签推送没有触发时：
gh workflow run cute-codex-build-binaries.yml -R senxiu-official/cute-codex --ref cute-codex-v0.163.0-r54
gh run watch <CC> -R senxiu-official/cute-codex
```

D. 签名（主人，离线 minisign，会问口令）：

```sh
$S cute-codex --run <CC> --tag cute-codex-v0.163.0-r54 --key $KEY            # 先看清单
$S cute-codex --run <CC> --tag cute-codex-v0.163.0-r54 --key $KEY --upload
```

清单应是 `native-0.163.0-r54-linux-x64.tar.gz`、`native-0.163.0-r54-windows-x64.tar.gz`、`SHA256SUMS`（各带 `.minisig`）。

E. 之后 cutex 的发布照 RUNBOOK（`native_run=<CC>`，可选 `upgrade-e2e.yml -f new_native=cute-codex-v0.163.0-r54`）。

## 实现时定下的细节

- 版本号用 r54（r53 已被 0.162.1 占用，r52.4 留给「r52.3 + 图片修复」的快速补丁）。如果 lead 先出 r52.4，
  目标工具两个提交也能原样放进去（文本无冲突，但没在 0.160 上编译过）。
- 027 A 在 0.163 上改成一个专门给写盘用的入口 `persisted_rollout_item_for_write`，所有写盘路径（实时写、
  列表写、迁移改写、内存存储、导入）都走它；读历史（`thread/resume`）不走，所以修复前写下的旧记录读出来仍然带图。

## 链接

- R54-NOTES.md（cute-codex 分支根目录）：冲突清单、测试数字、回退说明。
- 027（生成图片）、`docs/research/fork-necessity-20261008.md`（fork 必要性）、`docs/release/RUNBOOK-cutex-0.1.3.md`（发布步骤原型）。
- 速度测量：`remote:~/ab-test/speed/probe.py`、`analyze.py`、`run4.sh`、`r4/`。
