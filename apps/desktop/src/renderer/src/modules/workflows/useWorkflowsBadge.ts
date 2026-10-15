// Sidebar badge of 工作流: ⚠ N runs whose plan waits for the owner's approval (focus host).
import { useI18n } from "../../i18n";
import { usePendingCount } from "./store";

export function useWorkflowsBadge() {
  const { t } = useI18n();
  const n = usePendingCount();
  return n > 0 ? { text: `⚠ ${n}`, title: t("workflows.navPending", { n }), attention: true } : null;
}
