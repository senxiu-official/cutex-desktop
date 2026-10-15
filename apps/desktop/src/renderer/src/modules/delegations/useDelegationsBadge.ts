// Sidebar badge of 委托: ⚠ N delegations that need the owner.
import { useI18n } from "../../i18n";
import { useNeedsYouCount } from "../../lib/delegationsView";

export function useDelegationsBadge() {
  const { t } = useI18n();
  const n = useNeedsYouCount() ?? 0;
  return n > 0 ? { text: `⚠ ${n}`, title: t("delegations.navNeedYou", { n }), attention: true } : null;
}
