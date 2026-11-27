// 外观 → 应用图标 (owner 2026-11-28): every style as a tile (one radio group), a preview of the selected — or pointed-at —
// style at the sizes that matter (16 / 32 / 256 px, each from the file made for it), and where the change applies on
// this OS. lib/appIcon applies a pick in-app at once and hands it to main for the tray, windows and shortcuts.
import { useEffect, useState } from "react";
import { bridge } from "../../bridge";
import { DEFAULT_APP_ICON } from "../../../../shared/appIcons";
import { useI18n, type MessageKey } from "../../i18n";
import { APP_ICON_PREVIEW_SIZES, appIconLooks, applyAppIcon, useAppIcon, type AppIconLook } from "../../lib/appIcon";
import { radioKeyTarget, useRowA11y } from "../../lib/formA11y";
import { settingsAnchorId } from "../../lib/settingsNav";
import { settingsControlChanged } from "../../lib/settingsDrafts";
import { ResetButton, Section, SettingRow } from "./Form";

const RING = "outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface";

/** How many shortcuts main updated (Windows), from its state; null = none managed / not known. */
function useShortcutCount(id: string): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void bridge?.shell?.state?.().then((s) => live && setCount(s?.appIcon?.shortcuts ?? null)).catch(() => {});
    return () => {
      live = false;
    };
  }, [id]);
  return count;
}

function IconTiles({ looks, value, onPick, onPoint, label }: { looks: readonly AppIconLook[]; value: string; onPick(id: string, el: HTMLElement): void; onPoint(id: string | null): void; label: string }) {
  const { locale } = useI18n();
  const aria = useRowA11y(label);
  const selected = Math.max(0, looks.findIndex((l) => l.id === value));
  return (
    // Four to a row like the owner's sheet; fewer when the card is narrow (each tile at least 5.5rem).
    <div role="radiogroup" {...aria} data-app-icon-picker="" className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(max(5.5rem,calc((100%-1.125rem)/4)),1fr))] gap-1.5" onMouseLeave={() => onPoint(null)}>
      {looks.map((look, i) => {
        const on = look.id === value;
        const name = look.label(locale);
        return (
          <button
            key={look.id}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={name}
            title={name}
            tabIndex={i === selected ? 0 : -1}
            data-app-icon-choice={look.id}
            onClick={(e) => onPick(look.id, e.currentTarget)}
            onMouseEnter={() => onPoint(look.id)}
            onFocus={() => onPoint(look.id)}
            onKeyDown={(e) => {
              const next = radioKeyTarget(e.key, i, looks.length);
              if (next === null) return;
              e.preventDefault();
              const el = e.currentTarget.parentElement?.children[next] as HTMLElement | undefined;
              el?.focus();
              if (el) onPick(looks[next]!.id, el);
            }}
            className={`press flex min-w-0 flex-col items-center gap-1 rounded-lg px-1.5 pt-2 pb-1.5 text-center ${on ? "bg-accent-soft ring-2 ring-accent" : "hover:bg-surface-2"} ${RING}`}
          >
            <img src={look.url(48)} alt="" draggable={false} className="h-12 w-12 shrink-0 select-none" />
            <span className={`w-full truncate text-sm ${on ? "font-medium text-accent" : "text-foreground"}`}>{name}</span>
            <span lang={locale.startsWith("zh") ? "en" : "zh-CN"} className="line-clamp-2 w-full text-caption/[inherit] text-subtle">{look.subLabel(locale)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The style at 256 / 32 / 16 px, each at its real size (256 shown at 64 px), on the page and on a dark ground. */
function IconPreview({ look }: { look: AppIconLook }) {
  const { t } = useI18n();
  return (
    <figure data-app-icon-preview={look.id} className="m-0">
      <div className="flex items-end gap-3 rounded-lg border border-border/60 bg-surface-2 px-3 py-2">
        {[...APP_ICON_PREVIEW_SIZES].reverse().map((size) => (
          <div key={size} className="flex flex-col items-center gap-1">
            <div className="flex items-end gap-1">
              <img src={look.url(size)} alt="" draggable={false} style={{ width: size === 256 ? 64 : size, height: size === 256 ? 64 : size }} className="select-none" />
              {size !== 256 && (
                <span className="flex items-center justify-center rounded bg-[#1c1c1e] p-0.5">
                  <img src={look.url(size)} alt="" draggable={false} style={{ width: size, height: size }} className="select-none" />
                </span>
              )}
            </div>
            <span className="text-caption/[inherit] text-subtle">{t("appearance.appIcon.size", { n: size })}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export function AppIconSection() {
  const { t, locale } = useI18n();
  const looks = appIconLooks();
  const value = useAppIcon();
  const [pointed, setPointed] = useState<string | null>(null);
  const shortcuts = useShortcutCount(value);
  const platform = bridge?.platform === "darwin" || bridge?.platform === "linux" ? bridge.platform : "win32";
  const where = t(`appearance.appIcon.where.${platform}` as MessageKey);
  const shortcutNote = platform === "win32" ? (shortcuts === null ? t("appearance.appIcon.noShortcuts") : t("appearance.appIcon.shortcuts", { n: shortcuts })) : null;
  const shown = looks.find((l) => l.id === (pointed ?? value)) ?? looks[0]!;
  return (
    <Section id={settingsAnchorId("app-icon")} title={t("appearance.appIcon")} hint={t("appearance.appIconHint")}>
      {/* The tiles need the card's width: a row with no control, the tiles under its label (a picture picker). */}
      <SettingRow
        agents="none"
        source="local"
        label={t("appearance.appIcon.style")}
        hint={shortcutNote ? `${where} ${shortcutNote}` : where}
        reset={<ResetButton disabled={value === DEFAULT_APP_ICON} onClick={() => applyAppIcon(DEFAULT_APP_ICON)} />}
        sample={<IconTiles looks={looks} value={value} label={t("appearance.appIcon.style")} onPoint={setPointed} onPick={(id, el) => settingsControlChanged(el, applyAppIcon(id))} />}
      />
      <SettingRow agents="none" source="local" readOnly label={t("appearance.appIcon.previewTitle")} hint={shown.label(locale)}>
        <IconPreview look={shown} />
      </SettingRow>
    </Section>
  );
}
