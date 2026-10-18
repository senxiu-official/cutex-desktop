import { useState, type ComponentProps, type ReactNode } from "react";
import { ArrowUp, LoaderCircle, X } from "lucide-react";
import type { DraftImage } from "../../../shared/input";
import { useI18n } from "../i18n";
import { resolveTerms, useTermOverrides } from "../lib/terms";
import { resolveLaunchGreeting, type LaunchGreeting } from "../lib/launchGreeting";
import { providerGreetings } from "../lib/providerGreetings";
import type { Provider } from "../lib/provider";
import type { ProfileItem } from "../../../shared/ipc";
import { portraitChoices, portraitProvider } from "../lib/launchPortraits";
import { LaunchPortraits } from "./LaunchPortraits";
import { useLaunchArtView } from "../lib/launchArt";
import { useUiPrefs } from "../lib/prefs";
import { useModuleEnabled } from "../modules/react";
import { CARD_FLAGS } from "../lib/narrowCard";
import { dataFlags, useSizeFlags, type SizeTest } from "../lib/sizeFlags";
import "./LaunchPage.css";

/**
 * Page sizes (content box) for LaunchPage.css: `data-narrow` ≤ 520px (two-column settings),
 * `data-wide` ≥ 1200px (wider dock), `data-short` ≤ 650px / `data-shorter` ≤ 450px tall (smaller /
 * no welcome text), plus `--cqw` / `--cqh` for the fluid sizes. These were CSS container queries
 * (`container: launcher / size`); lib/sizeFlags says why the renderer has no size containers.
 */
const PAGE_SIZES = {
  narrow: (box) => box.width <= 520,
  wide: (box) => box.width >= 1200,
  short: (box) => box.height <= 650,
  shorter: (box) => box.height <= 450,
} as const satisfies Record<string, SizeTest>;
/** A launch popover's field box: `data-stack` ≤ 520px stacks `.launch-fields`; `data-narrow` (< 28rem) is the settings-row one. */
const FIELDS_SIZES = { ...CARD_FLAGS, stack: (box) => box.width <= 520 } as const satisfies Record<string, SizeTest>;

/** Shared chat-first frame; the welcome art and bottom dock have independent anchors. */
export function LaunchPage({ intro, children }: { intro?: ReactNode; children: ReactNode }) {
  const [ref, flags] = useSizeFlags(PAGE_SIZES, { units: true });
  return <main ref={ref} {...dataFlags(flags)} className="launch-page flex min-h-0 min-w-0 flex-1 flex-col">{intro}{children}</main>;
}

/**
 * The content of a launch popover panel: `.launch-fields` stack in one column when it is narrow,
 * and its SettingRows stack like in a settings card (`group/card`).
 */
export function LaunchFieldsBox({ children }: { children: ReactNode }) {
  const [ref, flags] = useSizeFlags(FIELDS_SIZES);
  return <div ref={ref} {...dataFlags(flags)} className="launch-fields-box group/card">{children}</div>;
}

/**
 * The dock's border-box height as `--launch-dock-h` on the page (its parent): the absolutely
 * placed intro / portraits keep at least that much room below them, so notices and errors that
 * grow the dock (a create error, Claude warnings) push the art up instead of being drawn over.
 */
export function measureLaunchDock(el: HTMLElement | null): (() => void) | undefined {
  const page = el?.parentElement;
  if (!el || !page || typeof ResizeObserver === "undefined") return undefined;
  const set = (height: number) => { if (height > 0) page.style.setProperty("--launch-dock-h", `${Math.ceil(height)}px`); };
  set(el.getBoundingClientRect().height);
  const observer = new ResizeObserver((entries) => {
    const entry = entries[entries.length - 1];
    set(entry?.borderBoxSize?.[0]?.blockSize ?? el.getBoundingClientRect().height);
  });
  observer.observe(el, { box: "border-box" });
  return () => { observer.disconnect(); page.style.removeProperty("--launch-dock-h"); };
}

/** One bottom inset and width for both launchers; settings grow above this shared composer. */
export function LaunchDock({ children }: { children: ReactNode }) {
  return <div ref={measureLaunchDock} className="launch-dock">{children}</div>;
}

export function LaunchAttachments({ images, disabled = false, onRemove }: { images: DraftImage[]; disabled?: boolean; onRemove(id: string): void }) {
  const { t } = useI18n();
  if (!images.length) return null;
  return <div className="mb-2 flex gap-2 overflow-x-auto pb-1" aria-label={t("composer.attachImage")}>
    {images.map((image) => <div key={image.id} className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-2" title={image.name}>
      {image.preview ? <img src={image.preview} alt={image.name} className="h-full w-full object-cover" /> : <span className="text-[10px] text-subtle">{image.name}</span>}
      <button type="button" disabled={disabled} title={t("composer.image.remove")} aria-label={`${t("composer.image.remove")} ${image.name}`}
        onClick={() => onRemove(image.id)}
        className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100 disabled:hidden"><X size={10} /></button>
    </div>)}
  </div>;
}

/** Identical textarea, action row and image geometry, regardless of which launcher owns the draft. */
export function LaunchComposer({ textarea, attachments, status, hint, label, disabled, busy = false, onSubmit, dragOver, dragEvents }: {
  textarea: ComponentProps<"textarea">;
  attachments?: ReactNode;
  status?: ReactNode;
  hint?: string;
  label: string;
  disabled: boolean;
  busy?: boolean;
  onSubmit(): void;
  dragOver: boolean;
  dragEvents: Pick<ComponentProps<"div">, "onDragOver" | "onDragLeave" | "onDrop">;
}) {
  const value = typeof textarea.value === "string" ? textarea.value : "";
  return <div {...dragEvents} className={`launch-composer rounded-2xl border bg-surface px-4 pt-3 pb-3 focus-within:border-accent/40 ${dragOver ? "border-accent" : "border-border"}`}>
    {attachments}
    {status}
    <textarea {...textarea} rows={Math.min(8, Math.max(2, value.split("\n").length))}
      className="block max-h-40 w-full resize-none bg-transparent text-sm leading-5 outline-none placeholder:text-subtle" />
    <div className="mt-1 flex h-8 items-center justify-between gap-3">
      <span className="text-[11px] text-subtle">{hint}</span>
      <button type="button" disabled={disabled} onClick={onSubmit} title={label} aria-label={label}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80 disabled:opacity-20 motion-reduce:transition-none">
        {busy ? <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" /> : <ArrowUp size={16} />}
      </button>
    </div>
  </div>;
}

export function LaunchIntro({ icon, title, hint, greeting, provider, portraits, showArtGreeting = false }: { icon: ReactNode; title: string; hint: string; greeting?: LaunchGreeting; provider?: Provider | null; showArtGreeting?: boolean; portraits?: { /** null = still loading. */ profiles: ProfileItem[] | null; profileId?: string; selected: boolean; disabled: boolean; onSelect(id: string): void } }) {
  const { locale } = useI18n();
  const terms = useTermOverrides();
  const [sample] = useState(() => Math.random());
  const [minute] = useState(() => { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); });
  // The portraits and greeting are the same entrance as the conversation opening: turning off the
  // 开场 module or 显示会话开场 also gives the launcher its plain icon intro, titled by the page itself
  // (no provider or module greeting).
  const introModule = useModuleEnabled("intro");
  const { timelineIntro } = useUiPrefs();
  const introOn = introModule && timelineIntro;
  const copy = !introOn ? undefined : greeting ?? (provider !== undefined ? { messages: providerGreetings(provider, locale, minute) } : undefined);
  const welcome = resolveLaunchGreeting(copy, title, resolveTerms(terms, locale).owner.one, sample);
  const longGreeting = copy && welcome.length > (locale === "en" ? 56 : 26);
  // Only providers with artwork, bundled or imported (lib/launchArt); none = icon intro.
  const { art, ready: artReady } = useLaunchArtView();
  const choices = introOn ? portraitChoices(portraits?.profiles ?? []).filter((c) => art[c.provider]) : [];
  const selectedProvider = portraits?.selected ? portraitProvider(provider) : null;
  const selected = selectedProvider && art[selectedProvider] ? selectedProvider : null;
  const hasArt = introOn && portraits && (portraits.selected ? !!selected : choices.length > 0);
  // While the profile list or the imported art loads, art may be about to show: hold the frame empty
  // rather than paint the icon intro and swap it for the portraits a moment later (the flicker on
  // entering a launcher).
  if (introOn && portraits && (!artReady || (!portraits.profiles && Object.keys(art).length > 0))) return null;
  return (
    <div className={`launch-intro flex flex-col items-center px-6 text-center${hasArt ? " launch-intro-with-art" : ""}${hasArt && showArtGreeting ? " launch-intro-with-greeting" : ""}`}>
      {hasArt ? <LaunchPortraits choices={choices} selected={selected} profileId={portraits.profileId} disabled={portraits.disabled} onSelect={portraits.onSelect} /> :
        <div className="launch-intro-icon mb-5 flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-accent/8 text-accent">{icon}</div>}
      {hasArt && showArtGreeting && <div className="launch-art-greeting">{welcome}</div>}
      {!hasArt && <>
        <h1 className={`launch-intro-title font-medium tracking-tight text-foreground${longGreeting ? " launch-intro-title-long" : ""}`} title={welcome}>{welcome}</h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-subtle">{hint}</p>
      </>}
    </div>
  );
}
