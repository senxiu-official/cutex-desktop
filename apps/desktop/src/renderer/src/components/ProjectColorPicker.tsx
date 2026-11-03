// Project colour swatches (projects page, new-agent「新项目…」).
import { PROJECT_PALETTE } from "../lib/projectCreate";
import { projectColor } from "../lib/sidebar";
import { customProjectColor, PROJECT_EXTRA_COLORS, projectHex, sameProjectColor } from "../lib/projectColors";
import { useState } from "react";
import { Palette } from "lucide-react";
import { useI18n } from "../i18n";
import { isImeComposing } from "../lib/ime";

export function ProjectColorPicker({ value, onChange, disabled = false }: { value: string; onChange(c: string): void; disabled?: boolean }) {
  const { t } = useI18n();
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const custom = customProjectColor(value);
  const hex = projectHex(draft);
  const apply = () => { if (hex && !disabled) { onChange(hex); setCustomOpen(false); } };
  const swatch = (c: string) => <button key={c} type="button" disabled={disabled} onClick={() => onChange(c)}
    title={c.startsWith("#") ? c : t(`projects.iconColor.${c as typeof PROJECT_PALETTE[number]}`)}
    aria-label={c.startsWith("#") ? c : t(`projects.iconColor.${c as typeof PROJECT_PALETTE[number]}`)}
    aria-pressed={sameProjectColor(value, c)}
    className={`h-5 w-5 shrink-0 rounded-full border border-foreground/20 disabled:opacity-50 ${sameProjectColor(value, c) ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface" : ""}`}
    style={{ background: projectColor(c) }} />;
  return (
    <div data-project-color-picker className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-2">{PROJECT_PALETTE.map(swatch)}</div>
      <div className="flex max-w-[240px] flex-wrap gap-2">{PROJECT_EXTRA_COLORS.map(swatch)}</div>
      <button type="button" disabled={disabled} aria-expanded={customOpen} aria-pressed={!!custom}
        onClick={() => { setDraft(projectHex(value) ?? projectColor(value).toUpperCase()); setCustomOpen(!customOpen); }}
        className="flex w-fit items-center gap-2 rounded-md py-1 text-xs text-muted hover:text-foreground disabled:opacity-50">
        <span className={`flex h-5 w-5 items-center justify-center rounded-full border border-foreground/20 ${custom ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface" : ""}`} style={custom ? { background: custom } : undefined}>
          {!custom && <Palette size={13} />}
        </span>
        {t("projects.color.custom")}{custom && <span className="font-mono text-caption">{custom}</span>}
      </button>
      {customOpen && <div className="flex flex-col gap-1.5">
        <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
          {t("projects.color.hex")}
          <input autoFocus type="text" value={draft} disabled={disabled} maxLength={7} spellCheck={false}
            aria-invalid={!hex} onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (!isImeComposing(e) && e.key === "Enter") { e.preventDefault(); apply(); } }}
            className="w-[90px] rounded-md border border-border bg-surface px-2 py-1 font-mono text-foreground" />
        </label>
        {!hex && <span className="text-caption text-danger">{t("projects.color.invalid")}</span>}
        <button type="button" disabled={!hex || disabled} onClick={apply} className="w-fit rounded-md bg-accent px-2 py-1 text-xs text-white disabled:opacity-50">{t("settings.save")}</button>
      </div>}
    </div>
  );
}
