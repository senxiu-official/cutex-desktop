# 011 页面在 Shelf 里的宽度

状态：**已实现**（10-21，分支 feat/0.2-shelfcard）。清单 #2（10-21 主人「听你默认的」：页面窗格单独缺省宽度 640 px）。

## 问题

项目、委托、服务、审批这些**页面**默认开进聚焦对话的 Shelf（「页面打开位置」= Shelf）。Shelf 的宽度是给文件、终端、网页这类工具定的
（缺省 420 px），页面放进去很挤：表格的列挤在一起、名字被截断。

## 规则

- 页面在 Shelf 里有自己的宽度 **640 px**。
- 一个页面**新**开进一个比 640 窄的 Shelf 时，这个 Shelf **一次性**变宽到 640。
- 变宽就像主人自己往对话那边拖了一下这个 Shelf 的边（宽度规则第 3、5 条）：**只有这个 Shelf 和它自己那一列对话**变，另一个工作区、侧栏、
  别的 Shelf 都不动；那一列对话缩到最小宽度就停，Shelf 停在当时能到的宽度（可能不到 640）。
- 已经 ≥ 640 的 Shelf 不变（**从不变窄**）。
- 只在页面**新放进** Shelf 时做；同一个页面已经开着、只是换了参数（例如从侧栏再点一次「委托」）不再变宽，主人拖窄之后也不会被拉回来。
- 变宽后的宽度和拖出来的一样**存下**（这个 Shelf 按对话记的宽度）。之后关掉页面不自动变窄；双击 Shelf 的边照旧回到 Shelf 的缺省宽度。

## 实现

- `lib/pageShelfWidth.ts`：`PAGE_SHELF_WIDTH` = 640；`widenForPage(instanceId)`——等 Shelf 在行里排好（两帧）再按它**画在哪一边**
  （并排时可能和它自己的那一边不同）调宽度。
- `lib/sideResize.ts` `widenShelf(target, width)`：走方向键那一套（`keyResize`：开一个拖动会话，行把不动的面板钉住，160 ms 后存），
  所以限制和拖边完全一样（`setRowHooks` 的 `shelfMax`：它那一列不低于最小宽度）。
- `lib/paneServices.ts` `openPageInShelf`：`sideOpen` 结果不是 `reused` 时调用。
- 测试：`test/shelfCard.test.tsx`（两个工作区：只改它那一列、另一列像素不变、存下；放不下时停在那一列的最小宽度；已经够宽不变）。
- 截图：`/home/ema/cutex-dev/shots/0.2-shelfcard/item2-*.jpg`。
