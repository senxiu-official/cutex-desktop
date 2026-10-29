// English strings of ./i18n.ts, apart from the zh-CN source so they stay out of the entry chunk: they load with the
// en catalog (i18n/index.tsx), only when the UI or a search needs English (0.2.0 beta perf audit, 2026-10-24).
import type { zhCN } from "./i18n";
import { en as treeMessages } from "./upgradeTreeMessages.en";
import { en as runMessages } from "./upgradeRunMessages.en";
import { en as routingMessages } from "./upgradeRoutingMessages.en";
import { en as memberMessages } from "./upgradeMemberMessages.en";

export const en: Record<keyof typeof zhCN, string> = {
  ...treeMessages,
  ...runMessages,
  ...routingMessages,
  ...memberMessages,
  "delegations.title": "Delegations",
  "delegations.description": "Delegations between {{agents}}, shown in the status row and capsule",
  "delegations.statusTitle": "Delegations",
  "delegations.count": "Delegations {n}",
  "delegations.mine": "Sent by me",
  "delegations.toMe": "Sent to me",
  "delegations.handling": "Handling · {name}'s delegation",
  "delegations.oldest": "oldest {t}",
  "delegations.running": "{n} running",
  "delegations.closed": "Finished · {n}",
  "delegations.viewAll": "View all on the Delegations page",
  "delegations.search": "Search delegations",
  "delegations.bucket.needsYou": "Needs you",
  "delegations.bucket.waiting": "Waiting / blocked",
  "delegations.bucket.active": "In progress",
  "delegations.bucket.done": "Finished",
  "delegations.none": "No open delegations",
  "delegations.allClear": "Nothing needs you",
  "delegations.more": "Show {n} more",
  "delegations.loading": "Loading…",
  "delegations.unavailable": "This host's cutex has no delegations",
  "delegations.col.delegation": "Delegation",
  "delegations.col.people": "From → to",
  "delegations.col.time": "Time",
  "delegations.allAgents": "All {{agents}}",
  "delegations.navNeedYou": "{n} delegations need you",
  "delegations.nav": "Delegations",
  "delegations.detail": "Delegation detail",
  "delegations.detail.gone": "This delegation was not found (purged, or not visible on this host)",
  "delegations.detail.created": "created {when}",
  "delegations.detail.attempts": "attempt {n}",
};
