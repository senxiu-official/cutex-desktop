// Used only by the new-Profile and new-agent flows, never existing-agent/Profile surfaces.
import { useI18n } from "../i18n";
import { Tag } from "./Tag";

export function CreationRuntimeTag({ runtime, enabled = true }: { runtime: string | null | undefined; enabled?: boolean }) {
  const { t } = useI18n();
  if (!enabled || (runtime !== "dsh" && runtime !== "kimi")) return null;
  return <Tag data-experimental-runtime={runtime} title={`${runtime === "dsh" ? "DSH" : "Kimi"} · ${t("creation.experimentalHint")}`}>{t("creation.experimental")}</Tag>;
}
