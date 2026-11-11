// 「后台应用」: a background app (cutex `worker`, lib/serviceWorker) — a program with no port and no web page.
import { useI18n } from "../i18n";
import { Tag } from "./Tag";

export function WorkerBadge({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return <Tag data-worker-badge="" title={t("services.worker.hint")} className={className}>{t("services.worker.badge")}</Tag>;
}
