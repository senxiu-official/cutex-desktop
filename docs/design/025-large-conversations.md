# 025 很大的对话也能打开

状态：**实现中**（10-22，fix/big-thread + feat/0.2-bigthread；未部署）。来源：主人 10-22 打开 host02 上的 Profile-generator（Codex）报「从「host02」加载失败：Cannot create a string longer than 0x1fffffe8 characters / 无法加载对话」。

## 问题

- 这个智能体在做图：一天里生成了 163 张图（每张 PNG 约 3.3 MB）。它的原生记录（rollout）有 **1.49 GB**，其中约 1.47 GB 是图片的 base64：
  - `imageGeneration` 条目的 `result` 字段放着整张图（每张约 4.9 MB，共约 726 MB）；
  - 脚本 / 工具输出里又把图片作为 `data:image/png;base64,…` 带回来（每次 3–5 MB，共约 750 MB）。
- 每一回合 40–55 MB。桌面打开对话时一次取最近 30 回合（设置「开始时加载的回合数」，最少 20），cutex 返回的是**一整个 JSON**，约 1.3 GB；桌面主进程 `response.text()` 要把它变成一个字符串，超过 V8 的上限（约 5.1 亿字符），于是报错。
- 桌面其实**一张也不画**这些图（`imageGeneration` 和普通工具输出里的图片都不显示），全是白传。

## 做法

1. **cutex：历史里的大媒体换成引用**（新参数，能力 `history-media-refs`）
   - `GET /v2/sessions/{id}/bootstrap`、`/history`、`/history/turns/{turnId}` 加 `?media=ref`。
   - 超过 64 KiB 的图片 / 媒体（任何以 `data:…;base64,` 开头的字符串、`imageGeneration.result`、MCP 图片块的 `data`）换成 `cutex-media:<会话号>/<sha256>`；字节存进 cutex 的媒体缓存（`runtime/management-v2/history-media/`，按内容去重，总量上限 2 GiB，最久没用的先删）。
   - 工具类条目里超过 1 MiB 的其他字符串截到 1 MiB，条目加 `truncated: true`（和 `compact` 一个意思：要全文就不带参数重读这一回合）。
   - 响应里加 `mediaRefs`（换了几处）。
   - 新接口 `GET /v2/sessions/{id}/media/{sha256}`：返回原始字节和类型；缓存里没有了返回 404 `media_not_found`（客户端重读那一回合即可补回）。权限和读这个会话的历史相同。
   - 不带 `media=ref` 时一切照旧（手机端、旧客户端不受影响）。
2. **桌面**
   - cutex 有 `history-media-refs` 时，打开对话、往上翻、查看归档、检查插话都带 `media=ref`。
   - 消息里的图片如果是 `cutex-media:` 引用，用到时才通过 cutex 取（和现在读主机文件做缩略图同一套缓存）。
   - 主进程收到的响应如果超过 256 MiB，直接报「对话太大，主机的 cutex 需要更新」，不再出现看不懂的 V8 报错。

## 建议

1 + 2 一起做。以后再考虑：在时间线里显示生成的图（现在就能做：引用指向缓存里的图）；回合页按字节而不只按回合数切分。

## 决定

待主人确认（技术修复，行为上只是「能打开了」）。

## 规则

- 历史接口给桌面的是「轻量」历史：大图片永远是引用，用到才取。
- 单个响应不应该大到要拼一个几百 MB 的字符串；桌面遇到超大响应要给出明白的提示。

## 链接

- 证据：host02 `runtime/light/agents/01a15e45-…/sessions/rollout-2026-10-21T22-42-47-….jsonl`（1,492,516,597 字节，38 回合）。
- cutex：`src/management/v2/media_refs.rs`（新）、`server.rs`（bootstrap / history）、`compact.rs`（截断同款）。
- 桌面：`packages/cutex-client/src/client.ts`、`main/daemon.ts`、`renderer/src/store.ts`、`components/ImageThumbs.tsx`。
