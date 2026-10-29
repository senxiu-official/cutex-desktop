// 新建 Profile step ②: the chosen provider's login methods, each with what it leads to
// (「→ 只能用 Claude」), the host-variable method folded under 高级; then which key kind / region.
import { useI18n } from "../../../i18n";
import { RUNTIME_LABEL, regionsOf, type AuthOption, type ProviderCard, type Resolved } from "../../../lib/newProfileModel";
import { optionDescription, optionLabel, regionLabel } from "../../../lib/newProfileText";
import { CreationRuntimeTag } from "../../CreationRuntimeTag";
import { Tag } from "../../Tag";
import { Details, Segmented, SettingRow, SettingsGroup } from "../Form";
import { StepTitle } from "./StepTitle";

function OptionRow({ card, option, chosen, onPick, disabled, variants }: { card: ProviderCard; option: AuthOption; chosen: boolean; onPick(): void; disabled?: boolean; variants?: boolean }) {
  const { t } = useI18n();
  return (
    <label data-auth-option={option.id} className={`flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2 ${chosen ? "bg-accent-soft" : "hover:bg-hover"}`}>
      <input type="radio" name="new-profile-auth" className="mt-1 accent-[var(--accent)]" checked={chosen} disabled={disabled} onChange={onPick} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
          {optionLabel(t, option)}
          <CreationRuntimeTag runtime={option.runtime} />
          {option.auth === "dshEnv" && <Tag tone="attention">{t("newProfile.notRecommended")}</Tag>}
        </span>
        <span className="block text-xs text-subtle">{optionDescription(t, card, option)}</span>
        <span className="block text-xs" data-auth-consequence="">
          {variants && option.auth === "apiKey" ? t("variants.runtimes.hint") : t("newProfile.auth.consequence.only", { runtime: RUNTIME_LABEL[option.runtime] })}
        </span>
      </span>
    </label>
  );
}

export function AuthStep({ resolved, onOption, onGroup, onPreset, disabled, variants }: {
  resolved: Resolved;
  onOption(option: AuthOption): void;
  onGroup(key: string): void;
  onPreset(id: string): void;
  disabled?: boolean;
  variants?: boolean;
}) {
  const { t } = useI18n();
  const { card, option, group, preset } = resolved;
  const main = card.options.filter((o) => !o.advanced);
  const advanced = card.options.filter((o) => o.advanced);
  const regions = regionsOf(group);
  return (
    <>
      {/* The step title carries the group's effect marker (new agents · this host), like a row label. */}
      <SettingsGroup agents="newAgents" source="host">
        {({ attributes, marker }) => (
          <div {...attributes}>
            <StepTitle n={2}>
              {t("newProfile.step.auth")}
              {marker}
            </StepTitle>
            <div className="flex flex-col gap-0.5 pb-1" role="radiogroup" aria-label={t("newProfile.step.auth")}>
              {main.map((o) => (
                <OptionRow key={o.id} card={card} option={o} chosen={o.id === option.id} onPick={() => onOption(o)} disabled={disabled} variants={variants} />
              ))}
            </div>
          </div>
        )}
      </SettingsGroup>
      {advanced.length > 0 && (
        <AdvancedOptions key={card.id} open={!!option.advanced}>
          {/* Same effect as the methods above; their title already shows the marker. */}
          <SettingsGroup agents="newAgents" source="host">
            {({ attributes }) => (
              <div {...attributes} className="flex flex-col gap-0.5">
                {advanced.map((o) => (
                  <OptionRow key={o.id} card={card} option={o} chosen={o.id === option.id} onPick={() => onOption(o)} disabled={disabled} variants={variants} />
                ))}
              </div>
            )}
          </SettingsGroup>
        </AdvancedOptions>
      )}
      {option.groups.length > 1 && (
        <SettingRow agents="none" source="host" label={t("newProfile.keyKind")} hint={t("newProfile.keyKindHint")}>
          <Segmented label={t("newProfile.keyKind")} disabled={disabled} value={group?.key ?? ""} options={option.groups.map((g) => ({ value: g.key, label: g.label }))} onChange={onGroup} />
        </SettingRow>
      )}
      {regions && (
        <SettingRow agents="none" source="host" label={t("newProfile.region")} hint={t("newProfile.regionHint")}>
          <Segmented label={t("newProfile.region")} disabled={disabled} value={preset?.id ?? ""} options={regions.map((r) => ({ value: r.preset.id, label: regionLabel(t, r.region, r.preset.label), title: r.preset.label }))} onChange={onPreset} />
        </SettingRow>
      )}
    </>
  );
}

/** 高级: closed until the owner opens it, open while one of its options is chosen. */
function AdvancedOptions({ open, children }: { open: boolean; children: React.ReactNode }) {
  const { t } = useI18n();
  if (open) return <div className="flex flex-col gap-0.5 border-t border-border/60 pt-1 pb-1">{children}</div>;
  return (
    <Details label={t("newProfile.advanced")}>
      <div className="flex flex-col gap-0.5 py-1">{children}</div>
    </Details>
  );
}
