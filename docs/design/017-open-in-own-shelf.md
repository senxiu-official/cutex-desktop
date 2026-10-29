# 017 从窗格里打开的东西进它自己的 Shelf

状态：**已实现**（`feat/0.2-media` 已合并）；下面三条「组长的缺省」（网页里的点击、`reveal`、收着的 Shelf）在 `feat/0.2-media2`，未提交。清单 #8（主人：「Shelf 里的服务 / 网页打开别的东西时，总是开进聚焦的 Shelf，而不是它自己所在的那个」）。

## 问题

屏幕上有两个工作区时，两个 Shelf 都是实时的（§24.13），但**所有打开**（`services.side.open` → `lib/sideServices` → `place()`）都只放进
「实时布局」，而实时布局永远是**聚焦对话**的 Shelf。另一个工作区的 Shelf 只有先拿到焦点才会成为实时布局。

普通界面里的点击没事：在另一个工作区的 Shelf 里按下，它先拿到焦点（「按下即聚焦」），这一下的打开自然进它的 Shelf。
出问题的是**按下到不了窗口**的打开：

- 网页 / 服务页里的点击发生在 webview 里。点了 `target=_blank` 的链接或页面 `window.open`，主进程发来 `new-tab` 事件，
  新标签开进了**聚焦的** Shelf。
- 智能体操控的标签自己弹出的新标签，同上。
- 窗格自己的 `open`（`SideBodyProps.open`）过一会儿才打开时（那时焦点已经在别处），也进了聚焦的 Shelf，还带着一个在那边找不到的页 id。

## 规则

1. **从窗格里发起的打开进来源所在的 Shelf**，放在来源那一页（和它在一起）。不管现在哪个工作区有焦点。
2. **没有来源的打开进聚焦工作区的 Shelf**（不变）：窗口顶栏、全局快捷键、⌘K、托盘，以及智能体事件（`agent-open`、`claim-open`、
   自动打开成果等，它们不是从某个窗格里来的）。
3. **焦点**：打开本身要焦点时（`focus`），来源的工作区先拿到焦点（和在它里面按一下一样），再打开；其他打开（网页弹出的新标签、
   后台打开）**焦点不动**——东西出现在那边的 Shelf 里（照常换到那一页、展开、闪一下），主人手上的对话不被打断。
4. 来源找不到了（窗格已关，或收成了小片）→ 按第 2 条。
5. 来源就在聚焦的 Shelf 里 → 和以前完全一样。

## 各种情况

| 入口 | 以前 | 现在 |
|---|---|---|
| 网页 / 服务页弹出新标签（主人点的 `target=_blank`、`window.open`） | 聚焦的 Shelf | 网页所在的 Shelf、同一页；焦点不动 |
| 智能体操控的标签弹出（智能体自己点的） | 聚焦的 Shelf | 同上 |
| 窗格自己的 `open`（成果视图的版本 / 对比、终端里的链接、侧边对话换智能体……） | 聚焦的 Shelf（那边的页 id 找不到就按 `place()` 落） | 自己的 Shelf、自己那一页 |
| 服务窗格「打开 <主人>」▾ 投影到这个 {{shelf}} / 替换 | 菜单里写的是聚焦对话的名字；「已经在主人自己的 Shelf 里就不显示」也按聚焦对话判断 | 按这个窗格所在的工作区（名字、判断、投影 / 替换的目标都是它） |
| 普通界面里的点击（文件树、改动列表、对话里的文件链接、投影窗格的时间线、页面窗格） | 「按下即聚焦」已经让它进对的 Shelf | 不变 |
| 窗口顶栏、⌘K、托盘、快捷键 | 聚焦的 Shelf | 不变 |
| 智能体事件（`agent-open`、`claim-open`、自动打开成果、服务 reveal） | 聚焦的 Shelf / 绑定的智能体 | 不变（不是从窗格里来的） |
| 网页 / 服务页 / 成果页面里点一下 | 什么都不发生（按下到不了窗口） | 和在那个窗格里按一下一样：它的工作区拿到焦点（组长的缺省） |
| 浏览器 `reveal`（智能体在操作一个看不见的标签） | 只在聚焦的 Shelf 里找，另一边的什么都不做 | 两个 Shelf 都找；在另一边就在那边露出来，焦点不动（组长的缺省） |
| 从窗格打开、目标是没焦点那边**收着**的 Shelf | 把它展开（可能挤收聚焦的 Shelf） | 不展开，放在那一页，Rail 上那一页的按钮闪一下并留一个点（组长的缺省） |

## 实现时定下的细节

- **外壳内部，不改模块契约**：模块看到的 `SideOpenOptions` 没有加字段，`MODULE_API_VERSION` 不变。来源由外壳带上：
  `lib/shelfTarget.ts` `sideOpenFrom(source, kind, params, opts)`（`source = { instanceId }`），规则本身是纯函数 `planOpenTarget`
  （`focused` / `focus-source` / `in-source`）。接上的入口：窗格的 `props.open`（`lib/sideBody.ts`，带自己的实例 id）；浏览器弹出
  （`modules/browser/popupOpen.ts`：用主进程事件里打开者的 `tabKey` 在**两个** Shelf 里找到那个标签实例，`findInstanceAnywhere`）；
  服务窗格的「打开 <主人>」（`components/ServiceLinks.tsx`，`useShelfPeer` 得到它所在的工作区）。
- **怎么进另一个 Shelf**：放置规则只作用于实时布局，所以「焦点不动」的打开是把那个 Shelf 临时换成实时布局、照常打开、再换回来
  （`lib/sideLayoutStore.ts` `withLiveShelf`；两次都是 `switchConversation`：同样的实例，不卸载、不重挂）。换的时候会被清掉的
  聚焦 Shelf 的最大化 / 全屏和聚焦的卡片原样恢复；选中的智能体不变。要焦点的打开先 `focusPeer`（同步）；没换成（主机还在切换）
  就照「焦点不动」的办法放进去。
- **缺省绑定按来源那边的对话填**：绑定某个智能体的组件绑到那个工作区的智能体，不是聚焦的那个（`sideOpenAs` 的 `fillFrom`）。
- **放在来源那一页**：另一个 Shelf 换进来时，共享页也在里面；如果这种东西上次被拖到了共享页（每种东西记住的页，§18.7），不指定页
  就会放进共享页——共享页跟着焦点走，新标签就又回到聚焦的 Shelf 去了（预览里复现过）。所以从窗格里来的打开总是放在来源那一页
  （窗格的 `props.open` 本来就是这样）；调用方给了页就用调用方的。
- **不做左侧预览卡**：左边的空白属于聚焦的对话；来源在另一个工作区时改放进它的 Shelf。
- **来源在聚焦的 Shelf 里时**，浏览器弹出仍走模块自己的 `services.side.open`，和以前一字不差。

下面三条是组长定的缺省（原来「待定」里的三个问题），主人可以改：

- **网页里点一下 = 在那个窗格里按一下**（Q1）：它的工作区拿到焦点（`focusPeer`），它的卡片成为聚焦的卡片
  （`lib/shelfSource.ts` `pressInstance`）。按下到不了窗口，所以分两路报上来：
  - **网页 / 服务页**（`<webview>`）：主进程本来就在听标签页的 `before-mouse-event`（共同操控用）；主人的 `mouseDown` 现在多发一个
    浏览器事件 `pressed`（`shared/browser.ts` 的事件种类，只加了一个种类，没有新的 IPC），渲染进程在**两个** Shelf 里找到那个标签实例
    （`modules/browser/popupOpen.ts` `pressBrowserTab`）。智能体自己的点击不算（`provider.agentInput`：它操作期间和之后的短窗口里的
    输入都算它的）——不然智能体在另一边操作网页时焦点会被拽过去。同样的原因，焦点**进入** `<webview>` 不再让工作区拿焦点
    （`SideInstanceLayer` 的 `onFocusCapture` 跳过 webview）：智能体的点击会把应用的焦点拉进网页（主进程随后还回去），
    只有主进程报来的主人按下才算。
  - **成果页面 / 插件页**（`<iframe>`）：用 Chrome 实测过，在 iframe 里点，iframe 元素上没有 focus / focusin，外面的 `pointerdown`
    也没有，只有窗口自己的 `blur`，那时 `document.activeElement` 就是那个 iframe；从一个 iframe 直接点进另一个 iframe 时外面**什么事件
    都没有**，只有 `activeElement` 变了。所以：窗口 `blur` / `focus` 时看 `activeElement`，焦点在框里时每 200 ms 再看一次（焦点不在框里
    就不看）；变成了某个窗格里的 iframe 就当作在那个窗格里按了一下（`installFramePress`，装在实例层）。另一个工作区用别的方式拿到焦点
    而这边的 iframe 还占着焦点时，把那个 iframe `blur()` 掉，下次在里面点又能算上（Chrome 里有效）。
  - 不在侧边窗格里的 iframe（如果有）不管。
- **`reveal` 两个 Shelf 都找**（Q2）：主进程让一个已开的标签露出来（智能体要操作一个看不见的标签，`hiddenTarget: reveal`）时，在聚焦和
  另一个工作区的 Shelf 里都找（`findInstanceAnywhere`，仍只限 host / agent 绑定的标签）；在另一边就把那个 Shelf 临时换成实时布局再
  露出来（`withLiveShelf`，和别的「焦点不动」的打开一样）：换到它那一页、它成为卡片里的当前标签，焦点、选中的智能体、聚焦 Shelf 的
  最大化 / 聚焦卡片都不动（`revealBrowserTab`）。那边的 Shelf 收着也会**展开**——智能体要的就是页面在屏幕上（不然它的操作会被
  「看不见」挡住），所以下一条不适用于 `reveal`。
- **没焦点那边收着的 Shelf 不展开**（Q3）：从窗格里打开、要进的是另一个工作区的 Shelf（`in-source`），而那个 Shelf 收着（只剩
  Rail，或者整个工具区关着）时，东西照常放进来源那一页（卡片里它是当前标签），但 Shelf **不展开**，也就不会为它挤收聚焦的 Shelf；
  聚焦的 Shelf 从来不为这个收起。那一页在 Rail 上的按钮闪两下（复用卡片的 `side-flash`），然后留一个强调色的点（和标签上「未读」的点一样；
  有红色的数字时只显示数字），直到主人把那一页打开为止——不管怎么打开的（点 Rail 按钮、Alt+数字、`reveal`），那一页出现在屏幕上就清掉；
  那一页没了也清掉（`lib/railNews.ts`，只在内存里）。要焦点的打开（`focus-source`）照旧展开。

## 测试 / 预览

- `apps/desktop/test/openInOwnShelf.test.ts`：规则（没有来源、来源在聚焦的 Shelf、来源不在了 → 聚焦的；来源在另一个工作区 → 它的，
  只有 `focus` 才移焦点）；从另一个工作区的窗格打开 → 进它的 Shelf，焦点、选中的智能体、聚焦 Shelf 的最大化和聚焦卡片都不动；
  没有来源 → 聚焦的；`focus` → 那个工作区拿到焦点再打开；缺省绑定按来源的对话；共享页记着这种东西时仍进来源那一页；网页弹出 → 打开者
  所在的 Shelf，打开者找不到 → 模块自己的 `open`。组长的缺省：`pressInstance` / 主进程的 `pressed` 让另一个工作区拿到焦点；iframe 拿到焦点
  （窗口 `blur`）算按下、`<webview>` 不算；从一个 iframe 直接进另一个 iframe 也算；另一个工作区拿走焦点时占着焦点的 iframe 被 `blur()`；
  `reveal` 在另一个工作区收着的 Shelf 里露出那个标签、焦点不动；在聚焦的 Shelf 里照旧；网页弹出进另一个工作区收着的 Shelf → 放在打开者那一页、
  仍收着、聚焦的 Shelf 不动、Rail 那一页有点，打开那一页后点消失。
- `apps/desktop/test/browserInstall.test.ts`：主人在标签页里按下 → 一个 `pressed` 事件；移动鼠标、按键、模块关掉之后都没有。
- 预览：`?ws=popup`（`dev/devWorkspaces.ts`）——两个工作区，第一个智能体的 Shelf 停在它的「网页」页（没有焦点的那个），焦点在
  第二个；然后那个网页弹出一个新标签（和主进程的 `new-tab` 一样走 `openPopupTab`）：新标签 `…/docs/popup-1` 出现在**左边**那个 Shelf
  的同一个窗格里，焦点描边仍在右边。`&before` = 弹出之前；控制台 `__ws.popup()` 再弹一个。
  - `?ws=popup&folded`：左边那个 Shelf 先收成 Rail，再弹出：它仍收着，「网页」页的 Rail 按钮闪一下、留一个点；右边聚焦的 Shelf 开着。
  - `?ws=click`：同样的布置，然后在左边那个网页里点一下（和主进程的 `pressed` 一样走 `pressInstance`）：焦点描边和侧栏选中都到了左边的
    对话。`&before` = 点之前；`__ws.pageClick()` 再点一次。`&frame`：左边那页换成一个成果页面（真的 iframe），不替你点——用真的鼠标点
    进去（无头 Chrome 用 CDP `Input.dispatchMouseEvent`）焦点就过去。
  - `?ws=reveal`：左边那个 Shelf 停在「文件」页（网页标签在别的页），然后主进程的 `reveal`：左边换到「网页」页，焦点仍在右边。
    `&before` = 之前；`__ws.reveal()` 再来一次。

## 待定

- 上面三条是组长的缺省，等主人确认或改。
- 投影窗格的「投影 · 在旁边打开」只作用于聚焦的 Shelf（靠按下即聚焦，目前没问题）。
- `<webview>` 的 `pressed` 和 iframe 的检测只在单元测试和浏览器预览（iframe）里验证过，还没在桌面应用里实际点过。
