import { Bot } from "lucide-react";
import { useI18n } from "../i18n";

/** Animate the wrapper, leaving the icon crisp and static under reduced motion. */
export function BackgroundBot() {
  const { t } = useI18n();
  const label = t("sidebar.backgroundWork");
  return <span data-background-work="" className="background-work-bot inline-flex shrink-0 items-center text-muted" role="img" aria-label={label} title={label}><Bot size={13} aria-hidden="true" /></span>;
}
