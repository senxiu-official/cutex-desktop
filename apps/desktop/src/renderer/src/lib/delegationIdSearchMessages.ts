// The sidebar search's delegation-id results (lib/delegationIdSearch, components/SidebarDelegationSearch) and its empty
// state while a search is active (owner 2026-11-25: 「还没有{{agent}}」 there read as if the roster were empty). Copy
// round 3 (docs/GLOSSARY.md 动作与状态): 未能 in sentences.
export const zhCN = {
  "sidebar.noMatch": "没有找到匹配的{{agent}}",
  "sidebar.delegationId.title": "委托 {id}",
  "sidebar.delegationId.searching": "正在查找委托…",
  "sidebar.delegationId.none": "没有找到这个委托",
  "sidebar.delegationId.failed": "未能查询 {hosts}",
  "sidebar.delegationId.truncated": "每台主机只查了最近 {n} 条委托，更早的可能没找到",
  "sidebar.delegationId.hasMore": "结果太多，输入更长的编号",
  "sidebar.delegationId.openDetail": "打开委托详情",
};

export const en: Record<keyof typeof zhCN, string> = {
  "sidebar.noMatch": "No matching {{agents}}",
  "sidebar.delegationId.title": "Delegation {id}",
  "sidebar.delegationId.searching": "Looking up the delegation…",
  "sidebar.delegationId.none": "No delegation has this id",
  "sidebar.delegationId.failed": "Could not search {hosts}",
  "sidebar.delegationId.truncated": "Only the newest {n} delegations of each host were searched; an older one may be missing",
  "sidebar.delegationId.hasMore": "Too many results; type a longer id",
  "sidebar.delegationId.openDetail": "Open delegation details",
};

export const zhHant: Record<keyof typeof zhCN, string> = {
  "sidebar.noMatch": "沒有找到匹配的{{agent}}",
  "sidebar.delegationId.title": "委託 {id}",
  "sidebar.delegationId.searching": "正在查找委託…",
  "sidebar.delegationId.none": "沒有找到這個委託",
  "sidebar.delegationId.failed": "未能查詢 {hosts}",
  "sidebar.delegationId.truncated": "每台主機只查了最近 {n} 條委託，更早的可能沒找到",
  "sidebar.delegationId.hasMore": "結果太多，輸入更長的編號",
  "sidebar.delegationId.openDetail": "打開委託詳情",
};
