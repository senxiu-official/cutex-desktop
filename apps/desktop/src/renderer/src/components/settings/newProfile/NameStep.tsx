// 新建 Profile step ⑤: name and colour (自动 = cutex / the desktop pick by provider, as for any Profile
// without one), then the summary line with 取消 / 创建.
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../../../i18n";
import { inkOn, PROFILE_COLORS } from "../../../lib/profileLook";
import { Button, SettingRow, TextInput } from "../Form";

function Swatch({ color, selected, title, onClick, children }: { color: string; selected: boolean; title: string; onClick(): void; children?: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={selected}
      onClick={onClick}
      className={`flex size-6 shrink-0 items-center justify-center rounded-full outline-none ring-offset-2 ring-offset-surface transition-shadow focus-visible:ring-2 focus-visible:ring-accent ${selected ? "ring-2 ring-foreground/70" : "hover:ring-2 hover:ring-border"}`}
      style={{ background: color, color: inkOn(color) }}
    >
      {children ?? (selected && <Check size={13} strokeWidth={2.5} />)}
    </button>
  );
}

export function NameStep({ name, onName, color, onColor, placeholder }: { name: string; onName(v: string): void; color: string | null; onColor(v: string | null): void; placeholder: string }) {
  const { t } = useI18n();
  return (
    <>
      <SettingRow agents="none" source="host" label={t("newProfile.name.label")}>
        <TextInput label={t("newProfile.name.label")} value={name} onChange={onName} placeholder={placeholder} />
      </SettingRow>
      <SettingRow agents="none" source="host" label={t("newProfile.color.label")}>
        <div className="flex flex-wrap items-center gap-2" data-new-profile-colors="">
          <Swatch color="var(--surface-2)" selected={color === null} title={t("newProfile.color.auto")} onClick={() => onColor(null)}>
            <span className="text-caption font-semibold text-muted">A</span>
          </Swatch>
          <span className="mx-0.5 h-4 w-px bg-border" />
          {PROFILE_COLORS.map((c) => (
            <Swatch key={c} color={c} selected={color === c} title={c} onClick={() => onColor(c)} />
          ))}
        </div>
      </SettingRow>
    </>
  );
}

export function SummaryLine({ text, onCancel, onCreate, saving, cancelLabel }: { text: string; onCancel(): void; onCreate(): void; saving: boolean; cancelLabel: string }) {
  const { t } = useI18n();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2.5 border-t border-border pt-3">
      <p className="min-w-64 flex-1 text-sm font-medium" data-new-profile-summary="">
        {text}
      </p>
      <Button onClick={onCancel}>{cancelLabel}</Button>
      <Button primary disabled={saving} onClick={onCreate}>
        {t("newProfile.create")}
      </Button>
    </div>
  );
}
