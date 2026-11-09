// 外观… (folder menu, owner 2026-11-06): a sidebar folder's colour and icon, each 自动 (picked from the folder's id)
// or one the owner chose, with the folder header as a live preview in the current theme. Colours: the automatic
// palette, more swatches (red included: by hand only), the colours the owner's other folders use, and any custom
// colour (the native colour input — no network, fine under the renderer's CSP — or a hex). A colour outside the
// palette gets its own ink (lib/folderInk), so the name stays ≥ 4.5:1; the preview shows it. Icons: lib/folderIcons in
// groups, with a search, in a scrolling area so the dialog keeps its size.
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { closeDialog } from "../lib/contextMenu";
import { searchFolderIcons } from "../lib/folderIcons";
import { cleanFolderColor, FOLDER_COLOR_NAMES, FOLDER_COLORS, FOLDER_EXTRA_COLORS, folderColor, folderIcon, folderLook, folderStyle, type FolderLookChoice } from "../lib/folderLook";
import { isImeComposing } from "../lib/ime";
import { useUiPrefs } from "../lib/prefs";
import { btn } from "./Button";

const LABEL = "mb-1.5 text-xs text-muted";
const SELECTED = "ring-2 ring-foreground ring-offset-2 ring-offset-surface";
const KNOWN = new Set<string>([...FOLDER_COLORS, ...FOLDER_EXTRA_COLORS.map(([, c]) => c)]);

export function FolderLookDialog({ id, name, initial, resolve }: { id: string; name: string; initial: FolderLookChoice | undefined; resolve(value: { look: FolderLookChoice | null } | null): void }) {
  const { t } = useI18n();
  const { sidebarSections } = useUiPrefs();
  // A stored value this build does not know is shown (and saved back) as automatic.
  const [color, setColor] = useState<string | null>(folderColor(initial?.color));
  const [icon, setIcon] = useState<string | null>(folderIcon(initial?.icon) ? initial!.icon! : null);
  const [hex, setHex] = useState(color ?? "");
  const [query, setQuery] = useState("");
  const auto = folderLook(id);
  const look = folderLook(id, { color: color ?? undefined, icon: icon ?? undefined });
  // Custom colours the owner's other folders use (not this one's, not a swatch): one click to reuse.
  const used = useMemo(() => [...new Set(sidebarSections.map((s) => cleanFolderColor(s.look?.color)).filter((c): c is string => !!c && !KNOWN.has(c)))].slice(0, 8), [sidebarSections]);
  const groups = searchFolderIcons(query, (g) => t(`section.iconGroup.${g}` as MessageKey));
  const typed = cleanFolderColor(hex);
  const pick = (c: string | null) => {
    setColor(c);
    setHex(c ?? "");
  };
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
  const swatch = (c: string, label: string) => (
    <button key={c} type="button" onClick={() => pick(c)} aria-pressed={color === c} aria-label={label} data-tip={label}
      className={`h-5 w-5 shrink-0 rounded-full border border-foreground/20 ${color === c ? SELECTED : ""}`} style={{ background: c }} />
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
      {/* The folder header as the sidebar draws it (Sidebar.tsx FolderHeader), in the current theme. */}
      <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5" style={folderStyle(look)} data-folder-look-preview="">
        <span className="folder-ink flex h-5 w-[18px] shrink-0 items-center justify-center"><look.icon size={14} strokeWidth={2.2} aria-hidden /></span>
        <span className="folder-ink min-w-[2.5em] truncate text-ui font-semibold">{name}</span>
        <span className="folder-line h-[3px] min-w-2 flex-1 rounded-full" />
      </div>
      <div>
        <p className={LABEL}>{t("section.lookColor")}</p>
        <div className="flex flex-wrap items-center gap-2">
          {autoChip(color === null, () => pick(null), <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: auto.color }} />)}
          {FOLDER_COLORS.map((c, i) => swatch(c, t(`section.color.${FOLDER_COLOR_NAMES[i]!}`)))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2" data-folder-extra-colors="">
          {FOLDER_EXTRA_COLORS.map(([n, c]) => swatch(c, t(`section.color.${n}` as MessageKey)))}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2" data-folder-custom-color="">
          <span className="text-xs text-muted">{t("section.lookCustom")}</span>
          {/* The native picker (no network); a pick applies at once, like a swatch. */}
          <input type="color" value={(color ?? auto.color).toLowerCase()} onChange={(e) => pick(cleanFolderColor(e.target.value))} aria-label={t("section.lookCustom")}
            className={`h-6 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0 ${color && !KNOWN.has(color) ? SELECTED : ""}`} />
          <input type="text" value={hex} maxLength={7} spellCheck={false} placeholder="#RRGGBB" aria-label={t("section.lookCustomHex")} aria-invalid={!!hex && !typed}
            onChange={(e) => { setHex(e.target.value); const c = cleanFolderColor(e.target.value); if (c) setColor(c); }}
            className="w-[86px] rounded-md border border-border bg-background px-2 py-0.5 font-mono text-xs text-foreground outline-none focus:border-accent" />
          {used.map((c) => swatch(c, c))}
        </div>
        {hex && !typed && <p className="mt-1 text-caption text-danger">{t("section.lookCustomInvalid")}</p>}
        {look.ink && <p className="mt-1 text-caption text-subtle" data-folder-ink-hint="">{t("section.lookInkHint")}</p>}
      </div>
      <div>
        <p className={LABEL}>{t("section.lookIcon")}</p>
        <div className="mb-2 flex items-center gap-2">
          {autoChip(icon === null, () => setIcon(null), <auto.icon size={13} strokeWidth={2.2} aria-hidden />)}
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("section.lookIconSearch")} aria-label={t("section.lookIconSearch")}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent" />
        </div>
        {/* A fixed height: the dialog keeps its size while scrolling or searching. */}
        <div className="h-[208px] overflow-y-auto rounded-md border border-border p-1" style={folderStyle(look)} data-folder-icon-grid="">
          {groups.map((g) => (
            <section key={g.id} data-icon-group={g.id}>
              <p className="px-1 pt-1 text-caption text-subtle">{t(`section.iconGroup.${g.id}` as MessageKey)}</p>
              <div className="flex flex-wrap gap-0.5">
                {g.icons.map((i) => (
                  <button key={i.id} type="button" onClick={() => setIcon(i.id)} aria-pressed={icon === i.id} aria-label={i.id} data-tip={i.id}
                    className={`flex h-7 w-7 items-center justify-center rounded-md hover:bg-surface-2 ${icon === i.id ? "folder-ink bg-surface-2 ring-1 ring-accent" : "text-muted hover:text-foreground"}`}>
                    <i.Icon size={16} strokeWidth={2} />
                  </button>
                ))}
              </div>
            </section>
          ))}
          {groups.length === 0 && <p className="px-1 py-8 text-center text-xs text-subtle">{t("section.lookIconNoMatch")}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        {(color || icon) && (
          <button type="button" onClick={() => { pick(null); setIcon(null); }} className={btn({ variant: "ghost", size: "sm" })}>
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
