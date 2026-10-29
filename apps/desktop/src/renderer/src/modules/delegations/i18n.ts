// Status category (step 2), 委托 page + nav (step 3; `delegations.*` moved from the base catalog).
import { zhCN as treeMessages } from "./upgradeTreeMessages";
import { zhCN as runMessages } from "./upgradeRunMessages";
import { zhCN as routingMessages } from "./upgradeRoutingMessages";
import { zhCN as memberMessages } from "./upgradeMemberMessages";
export const zhCN = {
  ...treeMessages,
  ...runMessages,
  ...routingMessages,
  ...memberMessages,
  "delegations.title": "委托",
  "delegations.description": "{{agent}}之间的委托，显示在状态行和胶囊里",
  "delegations.statusTitle": "委托",
  "delegations.count": "委托 {n}",
  "delegations.mine": "我发出的",
  "delegations.toMe": "发给我的",
  "delegations.handling": "承接 · {name} 的委托",
  "delegations.oldest": "最久 {t}",
  "delegations.running": "{n} 运行中",
  "delegations.closed": "已结束 · {n}",
  "delegations.viewAll": "在委托页查看全部",
  "delegations.search": "搜索委托",
  "delegations.bucket.needsYou": "需要你",
  "delegations.bucket.waiting": "等待 / 受阻",
  "delegations.bucket.active": "进行中",
  "delegations.bucket.done": "已结束",
  "delegations.none": "没有未结束的委托",
  "delegations.allClear": "没有需要处理的委托",
  "delegations.more": "再显示 {n} 条",
  "delegations.loading": "加载中…",
  "delegations.unavailable": "此主机的 cutex 不支持委托",
  "delegations.col.delegation": "委托",
  "delegations.col.people": "委托方 → 承接方",
  "delegations.col.time": "时间",
  "delegations.allAgents": "所有{{agent}}",
  "delegations.navNeedYou": "{n} 个委托需要你处理",
  "delegations.nav": "委托",
  "delegations.detail": "委托详情",
  "delegations.detail.gone": "找不到这个委托（已清理，或此主机看不到它）",
  "delegations.detail.created": "创建于 {when}",
  "delegations.detail.attempts": "第 {n} 次尝试",
} as const;

// Adds these keys to MessageKey (modules/i18nCatalog.ts collects the dictionary itself).
declare module "../i18nCatalog" {
  interface ModuleMessages extends Messages {}
}
type Messages = typeof zhCN;
