# 第一方头像集合与模块升级载荷

## 头像目录与安装

正式桌面从本安装配置指向的 GitHub 仓库读取 portrait-collections Release 内的 portraits.json 和 portraits.json.minisig，缺省使用桌面公开仓库。目录和文件认桌面发布密钥。未打包开发进程可用 CUTEX_DESKTOP_PORTRAITS_INDEX 指向 127.0.0.1 上的 portraits.json，允许测试密钥。打包应用忽略该环境变量。

### 外观库的桥接

`window.cutex.portraitCollections` 在 Electron 中可用，普通浏览器预览可以缺省。该桥接走固定的 `cutex-desktop:portrait-collections` 通道，只接受窗口主页面请求。安装调用只传主题 ID。既有 `portraitPacks.openFolder` 仍只打开用户自行放入素材的目录。

| 方法 | 行为 |
|---|---|
| state() | 读取本机验证过的目录、进度和安装状态。可以离线调用。 |
| check() | 主动更新目录。历史目录及已安装图片在失败时仍照常使用。 |
| install(theme) | 下载并验证该主题完整集合。目录未加载时先检查，当前版本已安装时直接复用。 |
| retry() | 重新执行最近失败的目录检查或指定主题的安装。 |

返回 `PortraitCollectionsView`。每项的 `available` 是目录提供的整数版本，`installed` 为本机验证过的版本或 null，0 表示升级保留的旧版完整集合。`bytes` 为下载档案大小。状态的 `checked` 表示已有可用的签名目录。在窗口首次进入外观库时，可先展示本机内容，再提供检查入口。

进度事件是 `bridge.on("portraitCollections", ({ view, packsChanged }) => …)`。操作按 `check`、`download`、`verify`、`install` 前进。下载提供 received 和 total 字节数。跨窗口只有一个进行中的操作。packsChanged 表示已切换到完整主题，renderer 的现有头像索引会刷新。切换后保留当前版本和上一个已验证版本。已下载主题继续沿用原始 pack/theme/stem，用户自装的同名整包仍按原来的覆盖规则优先。

| 错误码 | 界面含义 |
|---|---|
| index_unavailable | 目录不可达，保留已有集合。 |
| signature_invalid | 签名校验失败。 |
| index_invalid | 目录格式或归档来源不符合约定。 |
| index_rollback | 目录比本机已见过的旧，或同一序号内容不同。 |
| not_available | 目录没有这个主题可安装的版本。 |
| download_failed | 下载未完成，可重试。 |
| verify_failed | 归档或里面的文件与签名目录不一致。 |
| install_failed | 校验后的文件无法落盘，或清单不符合图片格式。 |

已有 20 个主题及其所有模型家族的首发图仍可离线用。lib/portraitPacks 的 missingOfficialPortrait 可以提供下载主题 ID。暂时缺失精确图片时，现有 resolvePortrait 用同主题、同模型家族的替代图，并保留主机记录。安装完成后自动用精确图。新 UI 不应从保存的 Profile 清理未安装的主题 ID，也不应把显示用的替代头像写回。保持自装包的授权与显示优先顺序。

## 发布准备与升级

在 desktop 构建中，Vite 从现有 720 张清单生成首发 124 张，清除构建输出里余下的图片文件。默认主题、六个模型家族、封面及明确的 mock 引用由构建同时检查。原始素材仍在源码中，供预览和发布归档使用。随应用携带完整旧集合的摘要与清单。便携升级会在已安装的旧版目录找到旧内置图片时，在后台校验并原子复制到本机目录。成功复制后可在原安装被回收后继续离线使用。若覆写前未保留旧目录，也没有下载完整集合，本机仍能使用首发占位。

```sh
node apps/desktop/scripts/portrait-collections.mjs OUT RELEASE_ASSET_BASE SEQUENCE VERSION --test-sign
bash apps/desktop/scripts/prepare-portrait-release.sh OUT RELEASE_ASSET_BASE SEQUENCE VERSION PRIVATE_KEY PUBLIC_KEY PREVIOUS_DIRECTORY_OR_DASH
```

第一条仅用于 127.0.0.1 私有测试。正式签名准备命令使用已安装桌面依赖的签名环境，可选输入上次验签过的目录。签名前运行首发范围、离线升级和下载回退测试，检查递增序号和同版本档案不可变。生成索引签名后复验文件名和签名。正式发布先验证并交付不可变的主题归档，最后交付目录和签名。本轮交付的脚本只生成本地制品。生产签名应在批准的桌面签名环境执行。

## 模块离线迁移钩子

Claude Science、NCI 远程作业和百度网盘的内置兼容版本均为 1.0.0。签名包沿用模块 ID，以更高版本在 modules-release 分发。`build.mjs nci baidu-pan --out DIR` 生成两个 1.1.0 包，Claude Science 可继续用 `build.mjs claude-science --out DIR --version 1.1.0`。索引继续使用 `index.mjs`。正式签名并复验后，给便携打包设置 CUTEX_DESKTOP_MODULE_UPGRADE_DIR。目录放 modules.json、modules.json.minisig 和需要迁移的模块归档，每个 ID 最多一份。打包器把它们放进应用自己的 module-upgrade 目录。

`modulePacks.seedBundled(id)` 是仅在主窗口使用的请求，只接受上述三个 ID。桌面先迁移旧默认值，再读取模块开关。开启的旧配置可用内置兼容副本并从升级载荷离线迁移。主进程只读固定目录并验证发布签名、兼容性、档案和每个文件。新装从「模块」下载 NCI 或百度网盘后，再开启开关。NCI 的「设置」在模块已启用且所选主机支持时出现。主机设置、开关与模块数据沿用原位置。

模块页读取 `ModulePacksView.migrations[id]`。installed 表示从载荷安装，kept 表示保留已有兼容包或用户确认过的自装包，complete 表示本机已完成过迁移。seed_missing 与 seed_invalid 时，符合旧版兼容条件的设备继续用内置副本。busy 表示模块服务正在执行另一项操作。界面沿用现有下载和更新动作，已手动移除的签名副本不会在下次启动时重新迁入。后续移除内置版本时需重新核对仍在使用兼容副本的设备、离线跳版、手动替换和包激活失败的路径。
