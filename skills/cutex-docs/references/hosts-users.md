# 主机、你的身份、用户与设备

适用：用户问“这一页改的是哪台电脑”“怎么连另一台机器”“为什么这里说需要升级”“身份密钥是什么”“怎么让别人看我的项目”“设备 / 对端主机是什么”。界面引文写作「中文」（English）。`{{owner}}` 在中文界面默认显示为「主人」（en “owner”），`{{agent}}` 默认为「智能体」（en “agent”），用户可以改这些称呼。

三个名词要分清：**你**（You）在你自己的每台电脑上都一样；**用户**（User）是某台主机上的一个账户和它的授权；**设备**（Device）是连到主机的电脑或手机。另有**对端主机**（Linked host），即另一台 cutex。

## 主机：页面作用在哪台主机上

**主机**（host）就是一台运行 cutex 的电脑。桌面可以同时连多台：本机（This computer），以及通过 SSH 连接的、用户自己的其他机器。每个 agent、项目、Profile 都属于某一台主机；文件、终端、差异也都在那台主机上操作。

- **视图范围**：左上角的主机切换器决定界面显示哪些主机（提示文字「视图范围：界面显示哪些主机」（View scope: what the app shows））。在切换器里连接 / 断开某台主机不改变视图范围。
- **设置页的来源标签**：每个设置页标题旁写着它存在哪里。「本机」（This computer）= 只存在这台电脑上，只影响这台电脑；「主机 · {host}」（Host · {host}）= 存在那台主机的 cutex 里，对连到它的所有桌面都生效。
- **主机选择器**：主机类设置页的标题旁有主机选择器（「编辑哪台主机的设置（不改变视图范围）」（Whose settings to edit (does not change the view)））。改设置前先确认选的是哪台。新建 agent 的表单也有一个（「在哪台主机上创建（不改变视图范围）」（Where to create it (does not change the view)））。
- **添加远程主机**：主机切换器 →「添加 SSH 主机…」（Add SSH host…），或「设置」（Settings）→「主机」（Hosts）。填 `~/.ssh/config` 里的别名或 `user@host[:port]`。桌面用用户现有的 SSH 密钥（BatchMode，不弹密码框）在远端运行一次 cutex 拿到令牌，之后经 SSH 端口转发连接，不需要开放端口。远端 cutex 端口默认 24270。只连用户自己的机器。macOS 只有桌面端，所有 agent 都在 SSH 主机上（见 [安装升级](install-upgrade.md#macos只有桌面端)）。
- 排查某台主机连不上，见 [排错](troubleshooting.md#daemon-连不上)。

### 需要升级

桌面按每台主机的 cutex 报告的**能力（capability）**决定显示哪些功能。不同主机的 cutex 版本可以不同，所以同一功能可能在一台主机上有、另一台上没有。看到这些提示时，意思是**那台主机的 cutex 太旧**，不是桌面坏了：

- 「{host} 的 cutex 不支持这一页，需要升级」（The cutex on {host} does not support this page; it needs an upgrade）
- 「这台主机的 cutex 不支持（需要 {feature}），请升级 cutex」（This host's cutex does not support it (needs {feature}); please upgrade cutex），`{feature}` 是缺少的能力名
- 侧栏 / 面板里的「当前 cutex 不支持（需要升级）」（this cutex does not support it (upgrade needed)）

处理：在「设置」→「主机」→「诊断」（Diagnostics）里可以「显示能力列表」（Show capability list）核对；要用这个功能就按 [安装升级](install-upgrade.md#升级-cutex-与-cute-codex) 升级**那台主机**的 cutex。只更新桌面没有用。主机切换器里某台主机旁若提示「与范围内其他主机的 cutex 版本不同」（Another cutex version than the other hosts in the view），说明各主机版本不一，功能也可能不同。

## 你：名字、头像和身份密钥

「设置」→「你」（You）是**本机**页面，在你自己的每台电脑上设置。

- **名字和头像**：「名字」（Name）和「头像」（Picture）同步到你连接的主机（主机的 cutex 支持时），别人在时间线「由 X 发送」（Sent by X）和用户列表里看到的就是它。名字留空时，各主机显示 {{owner}} 给你起的名字。头像下方一行汇总同步情况，例如「已同步到 {n} 台主机」（Synced to {n} hosts）、「还没设置名字：别人看到的是{{owner}}给你起的名字」（No name yet: others see the name the {{owner}} gave you）、「只保存在这台电脑上」（Kept on this computer only，主机的 cutex 较旧时）。
- **身份密钥**（Identity key）：每个桌面第一次启动时生成一个“人身份”（一把 Ed25519 密钥）。它的作用是让主机**认出你是谁**：同一个人以后新配对的设备可以直接归到你的用户下，不再待分配。它**不授予任何访问权限**，也不能代替配对（界面原话：「它只决定设备归谁，不授予任何权限」（It only decides which user a device belongs to; it grants nothing））。
- **在另一台电脑上用同一身份**：身份密钥收在「你」区块里一个折叠的行「在你的其他电脑上使用」（Use on your other computers）里，行首显示打码的「指纹」（Fingerprint）。展开后，在第一台电脑点「复制身份密钥」（Copy identity key），密钥（以 `cutex-id-` 开头的一行）进入剪贴板，**60 秒后自动清空**；用户自己把它带到另一台电脑（密码管理器或手输），在那边展开同一行，点「粘贴身份密钥…」（Paste identity key…）→「继续」（Continue），确认替换。中途混入的换行、空格会被忽略；缺字符或错字符会被拒绝并提示重新复制。
- 旧版桌面用文件搬身份（`cutex-identity-<指纹>.json`）：展开的同一行里有「旧版身份文件：」（Legacy identity file:）「导入…」（Import…）/「导出…」（Export…）。

**安全规则（必须遵守）：**身份密钥要像 API key 一样对待。拿到这串密钥的人就会被认作这个人。**绝不要**让用户把它粘贴到聊天里、发给你（agent）、贴进 issue 或发给任何人；你也不要读剪贴板、不要替用户复制粘贴。用户问怎么搬身份时，只讲上面的步骤，让用户自己操作。

### 你在各主机上

同一页的「你在各主机上」（You on each host）列出每台配置过的主机，点一行切换到那台主机。每行说明：

- **你在那里是谁**：「{{Owner}} · 全部项目」（{{Owner}} · All projects）；或「用户「{name}」」（User “{name}”）加「可发消息」（Can send）/「只读」（Read-only）和授权的项目；或「等{{owner}}分配」（Waiting for the {{owner}}，这台设备还没分配给用户）；未连接的主机显示「未连接」（Not connected）并带上次的身份。
- **这台电脑在那里叫什么**：「这台电脑就是这台主机」（This computer is this host）或「这台电脑在此是「{device}」」（This computer appears here as “{device}”）。在等待分配时显示「请告诉{{owner}}：这台设备叫「{device}」」（Tell the {{owner}} this device is called “{device}”），用户把这个名字告诉对方主机的 {{owner}} 即可。
- 只在出问题时右侧才有提示，例如「这台主机还不认得你的身份」（This host doesn't know your identity yet）旁的「记住」（Remember）按钮（{{owner}} 连接时），或同步失败。

## 用户、授权与项目的「可见用户」

每台主机有自己的**用户**（users）列表，由那台主机的 {{owner}} 管理：「设置」→「用户」（Users），主机页面，需要那台主机的 cutex 支持用户功能。页面提示：「谁能用这台主机。每台设备和对端主机都属于一个用户，权限跟着用户走」（Who can use this host. Every device and linked host belongs to a user and gets that user's rights）。

页面从上到下：有新设备等分配时顶部一条「{n} 台新设备等你分配」（{n} new devices waiting for you）+「查看」（View）；「你在这台主机上」（You on this host）；「用户」（Users）列表；「设备」（Devices）列表；「对端主机」（Linked hosts）列表。

- **{{owner}}**：这台主机的主人。能看、能管这台主机的一切，不需要授权。你在自己装的主机上就是 {{owner}}；在别人的主机上，你是他那里的一个用户。
- **其他用户**：「新建用户」（New user）后默认什么都看不到。展开用户后在「授权」（Grant）里设：「全部项目」（All projects，包括以后新建的项目，不包括独立 agent）或逐个「项目」（Projects）、「独立{{agent}}」（Standalone {{agents}}），以及「可以发消息」（May send messages：给可见的 agent 发消息、停止回合、回答提问等；关闭则只读），再「保存授权」（Save grant）。文件写入、终端和主机设置始终只有 {{owner}} 能用（新版 cutex 允许被授权的用户只读查看可见 agent 的文件和改动）。展开的用户里还有「备注名」（Alias，{{owner}} 给他起的名字；对方自己设了名字时优先显示对方的）和「认得的身份」（Known identities）。
- **按项目设置**：打开项目页的「可见用户」（Who can see）标签，每个非 {{owner}} 用户一个开关，打开即能看到这个项目和它的 agent。被授予「全部项目」的用户在这里显示为锁定，要先到「设置」→「用户」改成逐个项目授权。能不能发消息仍在「设置」→「用户」里设。
- **非 {{owner}} 连接时**：「你在这台主机上」显示你在这里是哪个用户、只读还是可发消息；页面写明「用户、授权和其他设备由{{owner}}管理」（Users, grants and other devices are managed by the {{owner}}）。左下角个人菜单也用同样的词：「用户 · 只读」（User · Read-only）/「用户 · 可发消息」（User · Can send）/「等{{owner}}分配」。

## 设备与对端主机

- **设备**（Devices）：「连到这台主机的电脑和手机」（Computers and phones connected to this host）。每台设备属于一个用户，权限跟着用户走，不跟着设备走。{{owner}} 在「设置」→「用户」的「设备」列表里管理所有设备（可「按用户筛选」（Filter by user））：
  - **待分配的设备排在最前**，带「待分配」（Unassigned）标记，在分配给某个用户之前什么都看不到。{{owner}} 用「分配给…」（Assign to…）或「新建用户并分配」（New user and assign）处理；勾选「以后认出这个人」（Recognise this person next time）后，同一个人以后的新设备会直接归到这个用户。
  - 「新设备先待分配」（New devices start unassigned）：开时新配对的设备先等 {{owner}} 分配；关时直接归 {{owner}}。第一台设备总是归 {{owner}}。主机已经认得某人的身份密钥时，他的新设备直接归到他的用户。
  - 每台设备可以「重命名」（Rename，「设备名称」（Device name），留空恢复默认名称；需要主机 cutex 的 `client-token-rename` 能力）、用用户选择框「改绑到」（Move to）别的用户或「待分配」，或「移除」（Remove）。移除后设备立刻断开，要再用需重新配对。这台桌面自己那一行标着「这台电脑」（This computer）。
  - 设备的网络地址默认打码显示，点一下才显示（「点击显示地址」（Click to show the address））。
  - 设备显示「用的是「{name}」的身份」（Uses the identity of “{name}”）时，表示这台设备出示的身份变了；归属不变，确认后点「知道了」（Got it）。
- **你的设备**（Your devices）：非 {{owner}} 连接时，「设置」→「用户」里有这一节，列出你自己在这台主机上的电脑和手机，可以自己「移除」（Remove，例如丢了手机）。需要那台主机 cutex 的 `user-own-devices` 能力；较旧的 cutex 上最多只显示这台电脑自己，或不显示。移除这台电脑本身会让它断开这台主机，要再用需重新配对。
- **配对新设备**：「设置」→「接入」（Access）→「配对设备」（Pair a device）生成一次性配对码，用手机扫码或在另一台电脑上输入；配对后的设备归所选用户。「接入」页只负责配对，已配对的设备在「用户 → 设备」里查看和管理。「用户」页「设备」一节的「配对设备」按钮也通向这里。
- **对端主机**（Linked hosts）：通过「互联」（Peers）页配对的**其他 cutex 主机**，不是电脑或手机。它们发来的委托按所属用户的授权执行。「设置」→「用户」的「对端主机」列表里可以改它属于哪个用户（「在 互联 中管理」（Manage in Peers）跳到管理页）；「互联」页每个对端也显示「属于 {user}」（belongs to {user}）。跨主机默认关闭：要在「互联」里「启用跨主机」（Enable peers），一方「邀请对方」（Invite，一次性配对码，10 分钟内有效），另一方「加入对方」（Join）。

## 依据

- 基础 i18n `apps/desktop/src/renderer/src/i18n/{zh-CN,en}.ts`：`hostSwitcher.*`、`hostPicker.settingsTitle`、`hostPicker.createTitle`、`settings.source.*`、`hostLists.needsUpgrade`、`side.reason.capability`、`host.add.*`、`host.capabilities.show`、`titlebar.addSsh`、`identity.person.*`（`useElsewhere`、`keyHint`、`fingerprint`、`legacyFile`）、`identity.section`、`identity.name`、`identity.role.*`、`me.access.*`、`device.rename*`、`address.show`、`remote.pair.title`、`remote.pair.hint`、`remote.pair.devicesInUsers`；`modules/i18n.ts` 的 `modules.needsUpgrade`。
- `apps/desktop/src/main/personIdentity.ts`（`IDENTITY_KEY_CLIPBOARD_MS = 60_000`，密钥不经过渲染进程）。
- `modules/users/i18n.ts`（`users.pageHint`、`users.attention`、`users.me.title`、`users.manageNotice`、`users.ownerHint`、`users.grant*`、`users.pending.*`、`users.person.*`、`users.devices*`、`users.rebind`、`users.revoke*`、`users.own.*`、`users.peers*`、`users.ownerRequiresApproval*`、`users.project.*`）、`components/settings/MeOnHost.tsx`、`modules/users/ProjectUsersTab.tsx`；`modules/peers/i18n.ts`（`peers.enabled`、`peers.invite*`、`peers.join`）；`modules/remote-access/i18n.ts`。
- `components/Settings.tsx`（主机页的 `HostPicker`）、`lib/targetHost.ts`。
- cutex capabilities：`users`、`users-p2-access`、`users-self-profile`、`person-identity`、`client-token-rename`、`user-own-token`、`user-own-devices`、`peers-v2`。
- 设计记录：`docs/research/identity-settings-review-20261015.md`（已合并；界面文字以 i18n 目录为准）。
