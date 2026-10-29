# 020 文件浏览器要 cutex 补的接口

状态：**待定**（10-22；给以后的 cutex 改动用。来源：019 的「API 缺口」A1–A5）。桌面端 0.2 的文件浏览器（019）**不依赖**这些接口，
现在按 019 §9 降级：一个文件夹最多画 2000 项、缩略图读整张图（≤ 2 MiB）、不能新建 / 改名 / 删除、根只有工作区。

按 AGENTS.md 原则 1 / 2，这些都加在 cutex（Management v2 工作区路由，`src/management/v2/workspace*.rs`、`host_files.rs`），桌面端不绕过去。
每一项都是**加法**：不带新参数时行为和现在一字不差；能力名列在 `/v2/capabilities`，桌面端看到能力才用。

现有的约定照旧：路径是工作区相对路径（`/` 分隔，不许 `..`，不跟出工作区的链接，看不到 `.git` 内部）；错误是 v2 错误信封
`{ "error": { "code", "message" } }`；`{scope}` = `/v2/projects/{projectId}` 或 `/v2/sessions/{cutexSessionId}`；只读路由对非主人用户
（`users-p2-access`）照旧放行，写路由只给主人。

## A1 文件夹分页：`fs-dir-paging`

`GET {scope}/fs/dir?path=&limit=&cursor=&sort=`

| 参数 | 说明 |
|---|---|
| `limit` | 1–5000；不带 = 现在的行为（全部） |
| `cursor` | 上一页的 `nextCursor`，原样传回（不透明字符串） |
| `sort` | `name`（缺省，现在的顺序：文件夹在前、名字不分大小写）/ `mtime` / `size`；分页时排序必须在服务端做，否则每页各排各的 |

返回（多出三个字段）：

```json
{
  "root": "D:\\Apps\\cutex-desktop",
  "path": "node_modules",
  "entries": [{ "name": "pkg-0000", "path": "node_modules/pkg-0000", "kind": "dir", "targetKind": null, "size": null, "modifiedAt": "…", "ignored": true }],
  "total": 2400,
  "truncated": true,
  "nextCursor": "b64:…"
}
```

- `total`：这个文件夹一共多少项（不含 `.git`）。`truncated` = 还有下一页。最后一页 `nextCursor: null`。
- cursor 失效（文件夹在两页之间变了）：400 `cursor_expired`，桌面端从第一页重读。
- 桌面端用法：第一页 `limit=2000`；「还有 N 项没显示」那一行点了再读下一页。

## A2 缩略图：`fs-thumbnails`

`GET {scope}/fs/thumb?path=&size=` 和主机版 `GET /v2/fs/thumb?path=<绝对路径>&size=`（主机版同 `/v2/fs/file` 的限制：只主人、
cutex home 的 `config.json` 只给本机主人）。

| 参数 | 说明 |
|---|---|
| `size` | `128` / `256` / `512`（长边像素）；缺省 256 |

返回 JSON（和 `fs/file` 一样走 JSON，桌面端不用新的二进制通道）：

```json
{ "path": "apps/desktop/out/renders/a.png", "mime": "image/webp", "width": 256, "height": 160, "sourceWidth": 1600, "sourceHeight": 1000, "sourceSize": 4823144, "modifiedAt": "…", "content": "<base64>" }
```

- 支持 PNG / JPEG / GIF（第一帧）/ WebP / BMP；SVG 不缩（400 `unsupported_image`，桌面端照旧读 SVG 文本）。
- 原图上限 50 MiB（超过 413 `image_too_large`）；输出 WebP（或 JPEG），通常 < 30 KB。
- 服务端按 `(canonical path, mtime, size)` 缓存在 cutex home 的 `cache/thumbs/`（总量上限，最久没用的先删）；
  图片解码在工作线程里做，并发有上限，不拖慢 management 的其他请求。
- 桌面端用法：缩略图格子和文件夹摘要改用它，原来的 2 MiB 限制去掉；内置预览仍读原图。

## A3 写文件：`fs-write`

都是 `POST`，只给主人（根凭据或主人的客户端令牌），请求体 JSON，带 `Idempotency-Key` 头（和别的 v2 写路由一样存在
`request-idempotency.sqlite3`，同一个键重放返回同一个结果）。成功后 `fs/watch` 照常发出变化事件。

| 路由 | 请求 | 返回 | 错误 |
|---|---|---|---|
| `{scope}/fs/create` | `{ "path": "docs/new.md", "kind": "file" \| "dir" }` | `{ "entry": FsEntry }` | 409 `already_exists`；404 `parent_not_found` |
| `{scope}/fs/rename` | `{ "from": "a.md", "to": "docs/a.md" }`（同一个工作区内，也是移动） | `{ "entry": FsEntry }` | 409 `already_exists`；404 `path_not_found` |
| `{scope}/fs/trash` | `{ "paths": ["a.md", "build/"] }`（≤ 200） | `{ "trashed": [{ "path", "trashId" }], "failed": [{ "path", "code" }] }` | 部分失败不整体失败 |
| `{scope}/fs/restore` | `{ "trashIds": ["…"] }` | `{ "restored": [FsEntry], "failed": [...] }` | 409 `already_exists` |

- 「删除」= 进回收站，不直接删：Windows / macOS / Linux 桌面用系统回收站；没有系统回收站（无头 Linux、远程主机）时进 cutex home 的
  `trash/`（保留 30 天），这样「撤销删除」在每台主机上都一样。
- 不许碰工作区根本身、`.git` 和 cutex home；路径规则同读路由（不许 `..`、不跟链接出工作区）。
- 桌面端用法：右键「新建文件 / 文件夹」「改名（F2）」「删除（Delete，确认后，可撤销一次）」，以及拖动行到别的文件夹 = 移动。

## A4 主机上按绝对路径列文件：`fs-host-dir`

`GET /v2/fs/dir?path=<绝对路径>`：返回结构同 `{scope}/fs/dir`（`root` 换成 `null`，`entries[].path` 是绝对路径），也支持 A1 的分页参数。

- 限制同 `/v2/fs/file`：只主人，绝对路径，不展开 `~`；cutex home 只给本机主人（`owner_local_only`）。
- 和 `/v2/fs/dirs`（新建智能体选目录用，只列文件夹）分开，不改那一个。
- 桌面端用法：根菜单「主机上的文件夹…」、工作区外的文件「在文件树中显示」（现在只能提示「在工作区外」）。

## A5 搜索文件夹和被忽略的：`fs-search-kinds`

`GET {scope}/fs/search?q=&limit=&kinds=&includeIgnored=`

| 参数 | 说明 |
|---|---|
| `kinds` | `file`（缺省，现在的行为）/ `dir` / `file,dir` |
| `includeIgnored` | `true` = 也搜被 git 忽略的（走目录遍历，仍受 `WALK_FILE_CAP` 限制）；缺省 `false` |

返回的每条结果多一个 `kind`：`{ "path": "apps/desktop/out", "score": 120, "kind": "dir" }`；截断时 `truncated: true`。

- 桌面端用法：全部搜索里文件夹结果点了 = 进入；一个「包括被忽略的」开关（例如在 `node_modules` 里找）。

## 不在这里

- 内容搜索（019 A6，`fs/grep`）：以后单独写。
- 别的项目做根（019 A7）：已有 `/v2/projects/{id}/fs/*`，不用新接口；要的是外壳的「固定到项目」规则（019 决定 6：0.2 不做）。
