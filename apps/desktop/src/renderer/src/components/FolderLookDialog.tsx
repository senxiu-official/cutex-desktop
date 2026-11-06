// 外观… (folder menu, owner 2026-11-06): a sidebar folder's colour and icon, each 自动 (picked from the folder's id)
// or one the owner chose, with the folder header as a live preview. Colours are the folder palette only
// (lib/folderLook FOLDER_COLORS, the name's ink keeps its contrast in light and dark), so the project colour
// picker with its free colour does not fit; icons are the folder icons plus the project icons.
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { useI18n } from "../i18n";
import { closeDialog } from "../lib/contextMenu";
import { FOLDER_COLOR_NAMES, FOLDER_COLORS, FOLDER_ICON_CHOICES, folderColor, folderIcon, folderLook, type FolderLookChoice } from "../lib/folderLook";
import { isImeComposing } from "../lib/ime";
import { btn } from "./Button";

const LABEL = "mb-1.5 text-xs text-muted";
const SELECTED = "ring-2 ring-foreground ring-offset-2 ring-offset-surface";

export function FolderLookDialog({ id, name, initial, resolve }: { id: string; name: string; initial: FolderLookChoice | undefined; resolve(value: { look: FolderLookChoice | null } | null): void }) {
  const { t } = useI18n();
  // A stored value this build does not know is shown (and saved back) as automatic.
  const [color, setColor] = useState<string | null>(folderColor(initial?.color));
  const [icon, setIcon] = useState<string | null>(folderIcon(initial?.icon) ? initial!.icon! : null);
  const auto = folderLook(id);
  const look = folderLook(id, { color: color ?? undefined, icon: icon ?? undefined });
  const done = (v: { look: FolderLookChoice | null } | null) => {
    closeDialog();
    resolve(v);
  };
  const save = () => done({ look: color || icon ? { ...(color && { color }), ...(icon && { icon }) } : null });
  const autoChip = (on: boolean, onClick: () => void, mark: ReactNode) => (
    <button type="button" onClick={onClick} aria-pressed={on} data-tip={t("section.lookAutoHint")}
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border px-2 text-xs ${on ? `${SELECTED} text-foreground` : "text-muted hover:text-foreground"}`}>
      {mark}
      {t("section.lookAuto")}
    </button>
  );
  return (
    <div
      aria-label={t("section.lookTitle", { name })}
      className="space-y-3"
      data-folder-look-dialog=""
      onKeyDown={(e) => {
        if (isImeComposing(e)) return;
        if (e.key === "Escape") done(null);
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
      }}
    >
      <h2 className="truncate text-sm font-medium">{t("section.lookTitle", { name })}</h2>
      {/* The folder header as the sidebar draws it (Sidebar.tsx FolderHeader). */}
      <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5" style={{ "--folder-color": look.color } as CSSProperties} data-folder-look-preview="">
        <span className="folder-ink flex h-5 w-[18px] shrink-0 items-center justify-center"><look.icon size={14} strokeWidth={2.2} aria-hidden /></span>
        <span className="folder-ink min-w-[2.5em] truncate text-ui font-semibold">{name}</span>
        <span className="folder-line h-[3px] min-w-2 flex-1 rounded-full" />
      </div>
      <div>
        <p className={LABEL}>{t("section.lookColor")}</p>
        <div className="flex flex-wrap items-center gap-2">
          {autoChip(color === null, () => setColor(null), <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: auto.color }} />)}
          {FOLDER_COLORS.map((c, i) => {
            const label = t(`section.color.${FOLDER_COLOR_NAMES[i]!}`);
            return <button key={c} type="button" onClick={() => setColor(c)} aria-pressed={color === c} aria-label={label} data-tip={label}
              className={`h-5 w-5 shrink-0 rounded-full border border-foreground/20 ${color === c ? SELECTED : ""}`} style={{ background: c }} />;
          })}
        </div>
      </div>
      <div>
        <p className={LABEL}>{t("section.lookIcon")}</p>
        <div className="mb-2">{autoChip(icon === null, () => setIcon(null), <auto.icon size={13} strokeWidth={2.2} aria-hidden />)}</div>
        <div className="flex flex-wrap gap-0.5" style={{ "--folder-color": look.color } as CSSProperties}>
          {FOLDER_ICON_CHOICES.map((i) => (
            <button key={i.id} type="button" onClick={() => setIcon(i.id)} aria-pressed={icon === i.id} aria-label={i.id}
              className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-2 ${icon === i.id ? "folder-ink bg-surface-2 ring-1 ring-accent" : "text-muted hover:text-foreground"}`}>
              <i.Icon size={16} strokeWidth={2} />
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        {(color || icon) && (
          <button type="button" onClick={() => { setColor(null); setIcon(null); }} className={btn({ variant: "ghost", size: "sm" })}>
            {t("section.lookReset")}
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={() => done(null)} className={btn({ variant: "ghost", size: "sm" })}>{t("dialog.cancel")}</button>
        <button type="button" autoFocus onClick={save} className={btn({ variant: "primary", size: "sm" })}>{t("settings.save")}</button>
      </div>
    </div>
  );
}
