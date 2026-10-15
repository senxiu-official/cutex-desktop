// The project icon picker (ChatGPT-style, opened from the badge left of the project name in
// 项目设置): a popover with 表情符号 / 图标 / 自定义 tabs, a search box and the colour swatches
// (eight hex swatches plus the daemon-only 青色 / 品红 names). The emoji / icon / custom text choice
// is written straight to the device-local pref (lib/projectIcons); the colour is applied through
// `onColor` — cutex presentation.color, so it follows the project across devices.
// Controlled (`onIcon`): the 新建项目 form, before the project exists — the choice stays in the form
// and is written to the pref once the project is created.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n, type MessageKey } from "../i18n";
import { parseCustomIcon, projectIcon, PROJECT_ICON_COLORS, PROJECT_NAMED_SWATCHES, sameProjectColor, searchProjectEmoji, searchProjectIcons, type ProjectIconChoice } from "../lib/projectIcons";
import { projectColor } from "../lib/sidebar";
import { setProjectIcon, useUiPrefs } from "../lib/prefs";
import { useTrackOverlay } from "../lib/openOverlays";
import { ProjectBadge } from "./ProjectBadge";

const WIDTH = 288;
const GRID_H = 200;
const COLOR_NAMES = ["white", "red", "orange", "yellow", "green", "blue", "purple", "pink"] as const;

type IconTarget =
  /** An existing project: the choice is its device-local pref. */
  | { hostId: string; projectId: string; value?: undefined; onIcon?: undefined }
  /** Controlled (a project still being created): `value` is shown, `onIcon` receives the choice (null: reset). */
  | { hostId?: undefined; projectId?: undefined; value: ProjectIconChoice | null; onIcon(icon: ProjectIconChoice | null): void };

/** The badge button (the current icon) + its popover. */
export function ProjectIconPicker({ badge, color, onColor, disabled, ...target }: IconTarget & { badge: string; color: string; onColor(c: string): void; disabled?: boolean }) {
  const { t } = useI18n();
  const icons = useUiPrefs().projectIcons;
  const current = target.onIcon ? target.value : projectIcon(icons, target.hostId, target.projectId);
  const choose = (icon: ProjectIconChoice | null) => (target.onIcon ? target.onIcon(icon) : setProjectIcon(target.hostId, target.projectId, icon));
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  useTrackOverlay(open);
  const close = () => setOpen(false);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-project-icon-picker=""
        disabled={disabled}
        onClick={() => setOpen(!open)}
        title={t("projects.icon.title")}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="rounded-md p-0.5 hover:bg-surface-2"
      >
        <ProjectBadge icon={current} badge={badge} color={color} size="lg" />
      </button>
      {open && anchor.current && (
        <PickerPanel
          anchor={anchor.current}
          badge={badge}
          current={current}
          color={color}
          onPick={(icon) => {
            choose(icon);
            close();
          }}
          onColor={onColor}
          onReset={() => {
            choose(null);
            close();
          }}
          onClose={close}
        />
      )}
    </>
  );
}

type Tab = "emoji" | "icon" | "custom";

function PickerPanel({ anchor, badge, current, color, onPick, onColor, onReset, onClose }: { anchor: HTMLElement; badge: string; current: ProjectIconChoice | null; color: string; onPick(icon: ProjectIconChoice): void; onColor(c: string): void; onReset(): void; onClose(): void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(current?.kind === "icon" ? "icon" : current?.kind === "text" ? "custom" : "emoji");
  const [query, setQuery] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  // Below the badge, clamped into the window; rows low on the screen open upwards instead.
  const rect = anchor.getBoundingClientRect();
  const style = window.innerHeight - rect.bottom - 8 > GRID_H + 150 ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 };
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - WIDTH - 8));
  const emoji = tab === "emoji" ? searchProjectEmoji(query) : null;
  const icons = tab === "icon" ? searchProjectIcons(query) : null;

  // Esc closes; so does a click outside (the badge itself re-clicks through onClick above).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || (!panel.current?.contains(e.target) && !anchor.contains(e.target))) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [anchor, onClose]);

  const chip = "rounded-md px-2.5 py-1 text-xs";
  return createPortal(
    <div
      ref={panel}
      data-project-icon-picker=""
      role="dialog"
      aria-label={t("projects.icon.title")}
      style={{ left, width: WIDTH, ...style }}
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl"
    >
      {/* Tabs on their own row (never wrapped: a squeezed chip broke 表情符号 into 表情符/号);
       * the search box gets the full row below, so every locale fits the 288px panel. */}
      <div className="border-b border-border">
        <div className="flex items-center gap-1 px-2 pt-1.5">
          {(["emoji", "icon", "custom"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`${chip} shrink-0 whitespace-nowrap ${tab === k ? "bg-surface-2 font-medium text-foreground" : "text-muted hover:text-foreground"}`}>
              {t(k === "emoji" ? "projects.icon.tabEmoji" : k === "icon" ? "projects.icon.tabIcons" : "projects.icon.tabCustom")}
            </button>
          ))}
        </div>
        {tab !== "custom" && (
          <div className="px-2 pb-1.5 pt-1">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(tab === "emoji" ? "projects.icon.searchEmoji" : "projects.icon.searchIcon")}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
            />
          </div>
        )}
      </div>
      {tab === "custom" ? (
        <CustomPanel badge={badge} current={current} color={color} onPick={onPick} />
      ) : (
        <div className="flex flex-wrap content-start gap-0.5 overflow-y-auto p-1.5" style={{ maxHeight: GRID_H }}>
          {emoji?.map((e) => (
            <button
              key={e.value}
              type="button"
              onClick={() => onPick({ kind: "emoji", value: e.value })}
              aria-pressed={current?.kind === "emoji" && current.value === e.value}
              className={`flex h-7 w-7 items-center justify-center rounded-md text-base hover:bg-surface-2 ${current?.kind === "emoji" && current.value === e.value ? "bg-surface-2 ring-1 ring-accent" : ""}`}
            >
              {e.value}
            </button>
          ))}
          {icons?.map((i) => (
            <button
              key={i.id}
              type="button"
              onClick={() => onPick({ kind: "icon", value: i.id })}
              aria-pressed={current?.kind === "icon" && current.value === i.id}
              className={`flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground ${current?.kind === "icon" && current.value === i.id ? "bg-surface-2 text-foreground ring-1 ring-accent" : ""}`}
            >
              <i.Icon size={16} strokeWidth={2} />
            </button>
          ))}
          {(emoji ?? icons)!.length === 0 && <p className="w-full px-1 py-6 text-center text-xs text-subtle">{t("projects.icon.noMatch")}</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-2 py-1.5">
        {PROJECT_ICON_COLORS.map((c, i) => (
          <button
            key={c}
            type="button"
            onClick={() => onColor(c)}
            title={t(`projects.iconColor.${COLOR_NAMES[i]}` as MessageKey)}
            aria-pressed={sameProjectColor(color, c)}
            className={`h-5 w-5 rounded-full ${sameProjectColor(color, c) ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface" : ""} ${c === "#ffffff" ? "ring-1 ring-black/10" : ""}`}
            style={{ background: c }}
          />
        ))}
        {/* The daemon palette names without a swatch twin, so 青色 / 品红 stay reachable in editing
         * (they write the cutex token, not a hex); the other names are their twin swatch above. */}
        <span className="mx-0.5 h-5 w-px bg-border" />
        {PROJECT_NAMED_SWATCHES.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onColor(name)}
            title={t(`projects.iconColor.${name}` as MessageKey)}
            aria-pressed={sameProjectColor(color, name)}
            className={`h-5 w-5 rounded-full ${sameProjectColor(color, name) ? "ring-2 ring-foreground ring-offset-2 ring-offset-surface" : ""}`}
            style={{ background: projectColor(name) }}
          />
        ))}
        {current && (
          <button type="button" onClick={onReset} title={t("projects.icon.resetTitle")} className="ml-auto rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-foreground">
            {t("projects.icon.reset")}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The 自定义 tab: any pasted emoji, a single hanzi or 1–2 letters, with a live preview. */
function CustomPanel({ badge, current, color, onPick }: { badge: string; current: ProjectIconChoice | null; color: string; onPick(icon: ProjectIconChoice): void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(current?.kind === "emoji" || current?.kind === "text" ? current.value : "");
  const parsed = parseCustomIcon(value);
  const confirm = () => parsed && onPick(parsed);
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <ProjectBadge icon={parsed} badge={badge} color={color} size="lg" />
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && confirm()}
          placeholder={t("projects.icon.customHint")}
          aria-label={t("projects.icon.customHint")}
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:border-accent"
        />
        <button type="button" disabled={!parsed} onClick={confirm} className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
          {t("projects.icon.customUse")}
        </button>
      </div>
      <p className={`text-xs ${value && !parsed ? "text-danger" : "text-subtle"}`}>{value && !parsed ? t("projects.icon.customInvalid") : t("projects.icon.customHint")}</p>
    </div>
  );
}
