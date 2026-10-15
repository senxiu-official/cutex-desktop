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
import { LAUNCH_ART } from "../lib/launchArt";
import { useUiPrefs } from "../lib/prefs";
import { useModuleEnabled } from "../modules/react";
import "./LaunchPage.css";

/** Shared chat-first frame; the welcome art and bottom dock have independent anchors. */
export function LaunchPage({ intro, children }: { intro?: ReactNode; children: ReactNode }) {
  return <main className="launch-page flex min-h-0 min-w-0 flex-1 flex-col">{intro}{children}</main>;
}

/** One bottom inset and width for both launchers; settings grow above this shared composer. */
export function LaunchDock({ children }: { children: ReactNode }) {
  return <div className="launch-dock">{children}</div>;
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
  // Only providers whose artwork is present on this checkout (lib/launchArt); none = icon intro.
  const choices = introOn ? portraitChoices(portraits?.profiles ?? []).filter((c) => LAUNCH_ART[c.provider]) : [];
  const selectedProvider = portraits?.selected ? portraitProvider(provider) : null;
  const selected = selectedProvider && LAUNCH_ART[selectedProvider] ? selectedProvider : null;
  const hasArt = introOn && portraits && (portraits.selected ? !!selected : choices.length > 0);
  // While the profile list loads, art may be about to show: hold the frame empty rather than paint the
  // icon intro and swap it for the portraits a moment later (the flicker on entering a launcher).
  if (introOn && portraits && !portraits.profiles && Object.keys(LAUNCH_ART).length > 0) return null;
  return (
    <div className={`launch-intro flex flex-col items-center px-6 text-center${hasArt ? " launch-intro-with-art" : ""}`}>
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
