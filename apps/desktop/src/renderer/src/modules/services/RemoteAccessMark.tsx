// The low-key mark of a service open to the owner's iPad (cutex services-remote-access-v1, 允许 iPad 访问): the owner
// sees at a glance which services are reachable from outside. Only where the record says so (older hosts: never).
import { Tablet } from "lucide-react";
import { useI18n } from "../../i18n";

export function RemoteAccessMark({ on }: { on: boolean | undefined }) {
  const { t } = useI18n();
  if (!on) return null;
  const label = t("services.remoteAccess.mark");
  return <Tablet size={12} strokeWidth={2} className="shrink-0 text-subtle" aria-label={label} role="img" data-tip={label} data-remote-access="" />;
}
