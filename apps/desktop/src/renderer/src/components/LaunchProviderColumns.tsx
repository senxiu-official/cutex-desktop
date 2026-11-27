// The launch openings of New Agent and Quick chat (owner 2026-11-27): one column per provider, left to right like the portraits. Top: the
// provider's artwork when installed (lib/launchArt — the 启动页立绘 slot, `art[provider].portrait` / `.victory`), else the
// provider's name as large quiet text. Below: its Profiles as chips — every one that fits in the
// opening's height (measured); only when a column's would overflow, the last fitting slot becomes 「+N」, which lists
// the whole column (owner 2026-11-27). Picking calls the page's own onSelect, so its rules hold (locked, Claude availability,
// portraitSelected, model/effort cleared, a manual pick ends 自动).
import { useLayoutEffect, useRef, useState } from "react";
import type { ProfileItem } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { PROVIDER_LABEL, profileProvider } from "../lib/provider";
import { PORTRAIT_ORDER, portraitProvider, type PortraitProvider } from "../lib/launchPortraits";
import type { LaunchArt } from "../lib/launchArt";
import { Popover } from "./Menu";
import { PortraitImage } from "./LaunchPortraits";
import { ProfileAvatar } from "./ProfileAvatar";
import { ownerWindowOf } from "../lib/ownerWindow";

/** With artwork, the share of the opening's height kept for the artwork; the chips get what is left under it. */
export const ART_SHARE = 0.3;

export interface ProviderColumn {
  key: string;
  /** Set when the provider has a portrait slot (it may still have no artwork installed). */
  portrait: PortraitProvider | null;
  label: string | null;
  profiles: ProfileItem[];
}

/** Columns: the portrait providers in the launcher's order, then any other provider in host order; Profiles keep the host's (owner) order. */
export function providerColumns(profiles: readonly ProfileItem[]): ProviderColumn[] {
  const columns = new Map<string, ProviderColumn>();
  for (const p of profiles) {
    const provider = profileProvider(p);
    const portrait = portraitProvider(provider);
    const key = portrait ?? provider ?? "other";
    const column = columns.get(key) ?? { key, portrait, label: portrait ? PROVIDER_LABEL[portrait] : provider ? PROVIDER_LABEL[provider] : null, profiles: [] };
    column.profiles.push(p);
    columns.set(key, column);
  }
  const rank = (c: ProviderColumn) => (c.portrait ? PORTRAIT_ORDER.indexOf(c.portrait) : PORTRAIT_ORDER.length);
  return [...columns.values()].sort((a, b) => rank(a) - rank(b));
}

/** How many chip slots fit in `room` px (chips `pitch` px tall, `gap` px apart); null = not measured (show all). */
export function chipCapacity(room: number, pitch: number, gap: number): number | null {
  if (!(room > 0) || !(pitch > 0)) return null;
  return Math.max(1, Math.floor((room + gap) / (pitch + gap)));
}

/**
 * A column's chips for `slots` fitting slots: all of them when they fit; otherwise one slot goes to 「+N」 and the rest
 * show the first Profiles, with the chosen one kept visible when it sits further down. `more` = the hidden count.
 */
export function columnChips(profiles: readonly ProfileItem[], chosenId: string | undefined, slots: number | null): { chips: ProfileItem[]; more: number } {
  if (slots === null || profiles.length <= slots) return { chips: [...profiles], more: 0 };
  const chips = visibleChips(profiles, chosenId, Math.max(1, slots - 1));
  return { chips, more: profiles.length - chips.length };
}

/** The first `max` Profiles, with the chosen Profile kept visible when it sits further down. */
export function visibleChips(profiles: readonly ProfileItem[], chosenId: string | undefined, max: number): ProfileItem[] {
  if (profiles.length <= max) return [...profiles];
  const index = profiles.findIndex((p) => p.id === chosenId);
  return index >= max - 1 ? [...profiles.slice(0, max - 1), profiles[index]!] : profiles.slice(0, max);
}

export interface ProviderColumnsProps {
  hostId: string;
  profiles: ProfileItem[];
  art: LaunchArt;
  /** The Profile the agent will use (highlighted). */
  profileId?: string;
  /** The owner picked here or in the menu: the chosen column shows its victory artwork. */
  selected: boolean;
  /** 自动 is on: its column gets the marker. */
  auto: boolean;
  /** Why a Profile cannot be used here (greyed, the reason as its tooltip); null = usable. */
  unavailable(profile: ProfileItem): string | null;
  disabled: boolean;
  onSelect(id: string): void;
}

function ProfileChip({ profile, hostId, provider, pressed, reason, disabled, onSelect }: { profile: ProfileItem; hostId: string; provider: string; pressed: boolean; reason: string | null; disabled: boolean; onSelect(id: string): void }) {
  const { t } = useI18n();
  return <button type="button" className="launch-column-chip" aria-pressed={pressed} disabled={disabled || !!reason} title={reason ?? profile.name}
    aria-label={t("launch.portrait.profile", { provider, profile: profile.name })} onClick={() => onSelect(profile.id)}>
    <ProfileAvatar profile={profile} host={hostId} size={20} />
    <span className="launch-column-chip-name">{profile.name}</span>
  </button>;
}

export function LaunchProviderColumns({ hostId, profiles, art, profileId, selected, auto, unavailable, disabled, onSelect }: ProviderColumnsProps) {
  const { t } = useI18n();
  const [hover, setHover] = useState<string | null>(null);
  const columns = providerColumns(profiles);
  const withArt = columns.some((c) => c.portrait && art[c.portrait]);
  // Chip slots that fit: the opening's box (the intro, sized by the page and the dock) less what sits above the chips
  // (the name, and with artwork its share of the height). Measured on every resize; null until laid out = all chips.
  const rootRef = useRef<HTMLDivElement>(null);
  const [slots, setSlots] = useState<number | null>(null);
  useLayoutEffect(() => {
    const root = rootRef.current;
    const box = root?.parentElement;
    if (!root || !box) return;
    const measure = () => {
      const list = root.querySelector<HTMLElement>(".launch-column-chips");
      const chip = list?.querySelector<HTMLElement>(".launch-column-chip");
      const caption = list?.parentElement;
      if (!list || !chip || !caption) { setSlots(null); return; }
      const px = (v: string) => (v.endsWith("px") ? parseFloat(v) : 0);
      const view = ownerWindowOf(root);
      const gap = px(view.getComputedStyle(list).rowGap);
      const below = px(view.getComputedStyle(caption).paddingBottom);
      const area = box.clientHeight;
      const above = withArt
        ? area * ART_SHARE + (list.getBoundingClientRect().top - caption.getBoundingClientRect().top)
        : list.getBoundingClientRect().top - box.getBoundingClientRect().top;
      setSlots(chipCapacity(area - above - below, chip.offsetHeight, gap));
    };
    measure();
    const Observer = ownerWindowOf(root).ResizeObserver;
    if (!Observer) return;
    const observer = new Observer(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [withArt, columns.length]);
  return <div ref={rootRef} className={`launch-columns${withArt ? " launch-columns-art" : ""}`} role="group" aria-label={t("agent-config.newAgent.profile")}
    style={withArt ? { gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` } : undefined}>
    {columns.map((column) => {
      const label = column.label ?? t("launch.columns.other");
      const images = column.portrait ? art[column.portrait] : undefined;
      const holdsChosen = column.profiles.some((p) => p.id === profileId);
      const reasons = column.profiles.map((p) => unavailable(p));
      const allUnavailable = reasons.every((r) => !!r);
      const { chips, more } = columnChips(column.profiles, profileId, slots);
      const first = column.profiles.find((_, i) => !reasons[i]);
      const image = images ? (selected && holdsChosen ? images.victory : images.portrait) : null;
      return <div key={column.key} data-provider={column.key}
        className={`launch-column${hover && hover !== column.key ? " is-muted" : ""}${holdsChosen ? " is-chosen" : ""}${allUnavailable ? " is-unavailable" : ""}`}
        title={allUnavailable ? reasons[0] ?? undefined : undefined}
        onPointerEnter={() => setHover(column.key)} onPointerLeave={() => setHover(null)}>
        {withArt && <button type="button" className="launch-column-top" disabled={disabled || !first} tabIndex={-1} aria-hidden
          onClick={() => first && onSelect(holdsChosen && profileId ? profileId : first.id)}>
          {image && column.portrait ? <div className="launch-portrait-figure"><PortraitImage provider={column.portrait} src={image} /></div>
            : <span className="launch-column-title">{label}</span>}
        </button>}
        <div className="launch-column-caption">
          {/* A column without artwork has its name on top; the line here then only keeps the chips level with the others'. */}
          <div className={withArt ? "launch-column-name" : "launch-column-title"} aria-hidden={withArt && !images ? true : undefined}>
            {withArt && !images ? " " : label}
            {auto && holdsChosen && <span className="launch-column-auto">{t("autoPick.auto")}</span>}
          </div>
          <div className="launch-column-chips">
            {chips.map((p) => <ProfileChip key={p.id} profile={p} hostId={hostId} provider={label} pressed={p.id === profileId} reason={unavailable(p)} disabled={disabled} onSelect={onSelect} />)}
            {more > 0 && <Popover width="w-60" disabled={disabled} triggerTitle={t("launch.columns.all", { provider: label })} triggerClassName="launch-column-chip launch-column-more"
              trigger={<span>{`+${more}`}</span>}>
              {(close) => <div className="grid grid-cols-1 gap-1 p-1" role="group" aria-label={t("launch.columns.all", { provider: label })}>
                {column.profiles.map((p) => {
                  const reason = unavailable(p);
                  return <button key={p.id} type="button" className="launch-profile-choice" disabled={disabled || !!reason} title={reason ?? undefined} aria-pressed={p.id === profileId}
                    onClick={() => { close(); onSelect(p.id); }}>
                    <span className="flex min-w-0 flex-1 items-center gap-2"><ProfileAvatar profile={p} host={hostId} size={18} /><span className="min-w-0 truncate">{p.name}</span></span>
                  </button>;
                })}
              </div>}
            </Popover>}
          </div>
        </div>
      </div>;
    })}
  </div>;
}
