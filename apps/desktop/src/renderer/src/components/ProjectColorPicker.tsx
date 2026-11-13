// Project colour swatches (projects page, new-agent「新项目…」): the six cutex colours, twelve RGB presets and a
// custom colour (colour well or hex). With `preview`, the badge as the sidebar / projects page and an avatar's
// project mark show it, in the colour under the pointer (or the custom one being picked) before it is chosen.
import { PROJECT_PALETTE } from "../lib/projectCreate";
import { projectColor } from "../lib/sidebar";
import { customProjectColor, PROJECT_EXTRA_COLORS, projectHex, sameProjectColor } from "../lib/projectColors";
import { projectMarkText } from "../lib/projectMark";
import { ProjectMarkChip } from "./ProjectMarkChip";
import type { ProjectIconChoice } from "../lib/projectIcons";
import { useState, type CSSProperties } from "react";
import { Palette } from "lucide-react";
import { useI18n } from "../i18n";
import { isImeComposing } from "../lib/ime";
import { ProjectBadge } from "./ProjectBadge";

export function ProjectColorPicker({ value, onChange, disabled = false, preview }: { value: string; onChange(c: string): void; disabled?: boolean; preview?: { badge: string; icon?: ProjectIconChoice | null } }) {
  const { t } = useI18n();
  const [customOpen, setCustomOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [hover, setHover] = useState<string | null>(null);
  const custom = customProjectColor(value);
  const hex = projectHex(draft);
  const shown = hover ?? (customOpen && hex ? hex : value);
  const apply = () => { if (hex && !disabled) { onChange(hex); setCustomOpen(false); } };
  const swatch = (c: string) => <button key={c} type="button" disabled={disabled} onClick={() => onChange(c)}
    onPointerEnter={() => setHover(c)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(c)} onBlur={() => setHover(null)}
    title={c.startsWith("#") ? c : t(`projects.iconColor.${c as typeof PROJECT_PALETTE[number]}`)}
    aria-label={c.startsWith("#") ? c : t(`projects.iconColor.${c as typeof PROJECT_PALETTE[number]}`)}
    aria-pressed={sameProjectColor(value, c)}
    className={`h-5 w-5 shrink-0 rounded-full border border-foreground/20 disabled:opacity-50 ${sameProjectColor(value, c) ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface" : ""}`}
    style={{ background: projectColor(c) }} />;
  return (
    <div data-project-color-picker className="flex min-w-0 flex-col gap-2">
      {preview && <ColorPreview badge={preview.badge} icon={preview.icon ?? null} color={shown} />}
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
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
          <label className="flex min-w-0 items-center gap-2">
            {t("projects.color.hex")}
            <input autoFocus type="text" value={draft} disabled={disabled} maxLength={7} spellCheck={false}
              aria-invalid={!hex} onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (!isImeComposing(e) && e.key === "Enter") { e.preventDefault(); apply(); } }}
              className="w-[90px] rounded-md border border-border bg-surface px-2 py-1 font-mono text-foreground" />
          </label>
          {/* The colour well: the system picker (hue / shades / eyedropper); the hex field follows it, and the reverse. */}
          <span className="relative h-7 w-9 shrink-0 overflow-hidden rounded-md border border-border" style={{ background: hex ?? projectColor(value) }}>
            <input type="color" value={(hex ?? projectColor(value)).toLowerCase()} disabled={disabled} aria-label={t("projects.color.pick")} title={t("projects.color.pick")}
              onChange={e => setDraft(e.target.value.toUpperCase())} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default" data-project-color-well />
          </span>
        </div>
        {!hex && <span className="text-caption text-danger">{t("projects.color.invalid")}</span>}
        <button type="button" disabled={!hex || disabled} onClick={apply} className="w-fit rounded-md bg-accent px-2 py-1 text-xs text-white disabled:opacity-50">{t("settings.save")}</button>
      </div>}
    </div>
  );
}

/** The badge where it shows: the projects page (lg), the sidebar's project header (sm) and an avatar's project mark. */
function ColorPreview({ badge, icon, color }: { badge: string; icon: ProjectIconChoice | null; color: string }) {
  const { t } = useI18n();
  const hex = projectColor(color);
  return (
    <div className="flex items-center gap-3 rounded-md border border-border/60 bg-surface-2/50 px-2.5 py-1.5" data-project-color-preview={hex}>
      <span className="text-caption text-subtle">{t("projects.color.preview")}</span>
      <ProjectBadge icon={icon} badge={badge} color={color} size="lg" />
      <ProjectBadge icon={icon} badge={badge} color={color} size="sm" />
      {/* The avatar's mark chip itself, as on a 44 px avatar, in the flow. */}
      <span data-project-color-mark className="flex" style={{ "--avatar-cut": "var(--surface-2)" } as CSSProperties}>
        <ProjectMarkChip inline size={44} mark={{ text: projectMarkText(icon, badge), color, icon: icon?.kind === "icon" ? icon : null }} />
      </span>
    </div>
  );
}
