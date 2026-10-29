import type { ProfileRuntimeVariant } from "../../../../shared/profileVariants";
import { useI18n } from "../../i18n";
import { acpRuntimeAvailable, isAcpRuntime } from "../../lib/acpRuntimes";
import { RUNTIME_LABEL } from "../../lib/profileVariants";
import { CreationRuntimeTag } from "../../components/CreationRuntimeTag";
import { Segmented } from "../../components/settings/Form";

/** Runtime selection before creation; existing agents keep their fixed runtime display. */
export function NewAgentRuntimePicker({ variants, chosen, defaultId, features, onChange }: {
  variants: readonly ProfileRuntimeVariant[];
  chosen: ProfileRuntimeVariant;
  defaultId?: string;
  features: ReadonlySet<string>;
  onChange(id: string): void;
}) {
  const { t } = useI18n();
  const badge = (runtime: string) => <CreationRuntimeTag runtime={runtime} enabled={isAcpRuntime(runtime) && acpRuntimeAvailable(runtime, features)} />;
  return variants.length > 1 ? <Segmented label={t("variants.agent.variant")} value={chosen.id}
    options={variants.map((v) => ({ value: v.id, label: RUNTIME_LABEL[v.runtime], icon: isAcpRuntime(v.runtime) && acpRuntimeAvailable(v.runtime, features) ? badge(v.runtime) : undefined,
      title: [v.defaults.model, v.id === defaultId ? t("variants.default") : null].filter(Boolean).join(" · ") }))}
    onChange={onChange} /> : <span className="inline-flex items-center gap-1.5">{RUNTIME_LABEL[chosen.runtime]}{badge(chosen.runtime)}</span>;
}
