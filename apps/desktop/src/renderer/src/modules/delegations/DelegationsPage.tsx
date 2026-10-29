// The 委托 page `delegations.page`: every delegation (params.agent presets the agent filter — the
// capsule's 在委托页查看全部). 打开委托树 sits at the end of the list's toolbar row.
import { ListTree } from "lucide-react";
import { DelegationList } from "../../components/DelegationList";
import { PageBody } from "../../components/Page";
import type { PageParams } from "../slots";
import { useTargetFeatures } from "../../lib/targetHost";
import { Button } from "../../components/Button";
import { useI18n } from "../../i18n";
import { services } from "../app";

export function DelegationsPage({ params }: { params: PageParams }) {
  const features = useTargetFeatures();
  const { t } = useI18n();
  return (
    <PageBody>
      <DelegationList
        agent={params.agent}
        actions={features.has("delegation-tree-stop-v1") && (
          <Button variant="ghost" onClick={() => services.ui.openPage("delegations.treePage")}>
            <ListTree size={14} aria-hidden />
            {t("delegations.upgrade.tree.open")}
          </Button>
        )}
      />
    </PageBody>
  );
}
