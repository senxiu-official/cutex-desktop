// Sidebar badge of 审批: ⚠ N pending — of every connected host, in the view scope or not (RFC §10).
import { sumHosts } from "../../lib/hostScope";
import { useConnectedHostData } from "../../lib/hostLists";

export function useApprovalsBadge() {
  const pending = sumHosts(useConnectedHostData(), (d) => d.approvals?.length ?? 0);
  return pending > 0 ? { text: `⚠ ${pending}`, attention: true } : null;
}
