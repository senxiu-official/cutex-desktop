// The 委托 page `delegations.page`: every delegation (params.agent presets the agent filter — the
// capsule's 在委托页查看全部).
import { DelegationList } from "../../components/DelegationList";
import { PageBody } from "../../components/Page";
import type { PageParams } from "../slots";

export function DelegationsPage({ params }: { params: PageParams }) {
  return (
    <PageBody>
      <DelegationList agent={params.agent} />
    </PageBody>
  );
}
