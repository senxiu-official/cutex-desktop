// 编辑主页 (from the desktop and the 个人页): cover (pick an image → PUT cover, or 使用立绘 = no cover), the
// one-line bio, which blocks show and their order, the two entrances (sidebar 「桌面」, show when empty)
// and, with several owner hosts, which host keeps the settings. Every change is saved at once
// (store.ts: optimistic, revision-checked); the footer says where it is kept.
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Plus, Settings2, Sparkles } from "lucide-react";
import { HOME_BIO_MAX, HOME_COVER_MAX_BYTES, HOME_COVER_TYPES, type HomeCoverType } from "../../../../shared/home";
import { useI18n, type MessageKey } from "../../i18n";
import { Toggle } from "../../components/settings/Form";
import { useHostScope } from "../../lib/useHostScope";
import { services } from "../app";
import { noteCover, useHomeSource } from "./hooks";
import { LAYOUT_ID, showWhenEmpty, sidebarEntry } from "./model";
import { openWidgetSettings, useDeskKinds } from "./DeskSurface";
import { homeStore } from "./store";

const readFile = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h4 className="mb-2 text-xs font-semibold text-muted">{title}</h4>
      {children}
    </section>
  );
}

export function EditPanel({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  const home = useHomeSource();
  const entry = home.entry;
  const doc = entry?.doc ?? null;
  const local = entry?.source === "local";
  const [bio, setBio] = useState(doc?.bio ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const editingBio = useRef(false);
  useEffect(() => {
    if (!editingBio.current) setBio(doc?.bio ?? "");
  }, [doc?.bio]);
  const save = (edit: Parameters<typeof home.update>[0]) =>
    void home.update((d) => ({ ...edit(d), layout: LAYOUT_ID })).then((ok) => !ok && setProblem(t("home.saveFailed", { error: homeStore().entry(home.hostId ?? "")?.error ?? "" })));
  const scope = useHostScope();
  const hostName = (id: string) => scope.host(id)?.label ?? id;

  const pickCover = async (f: File | undefined) => {
    setProblem(null);
    if (!f || !home.hostId) return;
    if (!HOME_COVER_TYPES.includes(f.type as HomeCoverType)) return setProblem(t("home.cover.badType"));
    if (f.size > HOME_COVER_MAX_BYTES) return setProblem(t("home.cover.tooLarge"));
    const dataUrl = await readFile(f);
    const data = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const hostId = home.hostId;
    const r = await services.daemonFor(hostId).putHomeCover({ contentType: f.type as HomeCoverType, data }).catch((e: unknown) => ({ ok: false as const, error: { code: "error", message: e instanceof Error ? e.message : String(e) } }));
    if (!r.ok) return setProblem(t("home.cover.failed", { error: r.error.message || r.error.code }));
    noteCover(hostId, r.value.coverEtag, dataUrl);
    homeStore().noteView(hostId, r.value);
  };
  const useArt = async () => {
    setProblem(null);
    if (!home.hostId || !entry?.coverEtag) return;
    const hostId = home.hostId;
    const r = await services.daemonFor(hostId).deleteHomeCover().catch((e: unknown) => ({ ok: false as const, error: { code: "error", message: e instanceof Error ? e.message : String(e) } }));
    if (!r.ok) return setProblem(t("home.cover.failed", { error: r.error.message || r.error.code }));
    homeStore().noteView(hostId, r.value);
  };

  const owners = home.choices.filter((h) => h.connected && h.owner);
  return (
    <div className={`text-ui/[inherit] ${className}`} data-home-edit="">
      <Section title={t("home.cover")}>
        <div className="flex flex-wrap gap-2">
          <button disabled={local} onClick={() => file.current?.click()} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-raised px-2.5 py-1 text-xs hover:bg-hover disabled:opacity-50">
            <ImagePlus size={13} />
            {t("home.cover.pick")}
          </button>
          <button disabled={local || !entry?.coverEtag} onClick={() => void useArt()} aria-pressed={!entry?.coverEtag} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-raised px-2.5 py-1 text-xs hover:bg-hover disabled:opacity-50 aria-pressed:border-accent aria-pressed:text-accent">
            <Sparkles size={13} />
            {t("home.cover.art")}
          </button>
          <input ref={file} type="file" accept={HOME_COVER_TYPES.join(",")} className="hidden" onChange={(e) => void pickCover(e.target.files?.[0]).finally(() => (e.target.value = ""))} />
        </div>
        <p className="mt-1.5 text-meta/[inherit] text-subtle">{t(local ? "home.cover.local" : "home.cover.hint")}</p>
      </Section>
      <Section title={t("home.bio")}>
        <textarea
          value={bio}
          maxLength={HOME_BIO_MAX}
          rows={2}
          placeholder={t("home.bio.placeholder")}
          onFocus={() => (editingBio.current = true)}
          onChange={(e) => setBio(e.target.value.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ""))}
          onBlur={() => {
            editingBio.current = false;
            const next = bio.trim();
            if (next !== (doc?.bio ?? "")) save((d) => ({ ...d, bio: next || null }));
          }}
          className="w-full resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-ui/[inherit] outline-none focus:border-accent"
        />
      </Section>
      {/* Design 032: the widgets (every module's) — on / off, 再加一个 for one that allows several. */}
      <Section title={t("home.desk.widgets")}>
        <WidgetList />
      </Section>
      <Section title={t("home.entry")}>
        <label className="flex items-center gap-2 py-1">
          <span className="flex-1">{t("home.sidebarEntry")}</span>
          <Toggle checked={sidebarEntry(doc)} onChange={(v) => save((d) => ({ ...d, sidebarEntry: v }))} />
        </label>
        <label className="flex items-center gap-2 py-1" title={t("home.showWhenEmptyHint")}>
          <span className="flex-1">{t("home.showWhenEmpty")}</span>
          <Toggle checked={showWhenEmpty(doc)} onChange={(v) => save((d) => ({ ...d, showWhenEmpty: v }))} />
        </label>
      </Section>
      {owners.length > 1 && home.boot && (
        <Section title={t("home.homeHost")}>
          <HostPick value={home.hostId} options={owners.map((h) => h.id)} onPick={(id) => void home.bootUpdate((d) => ({ ...d, homeHost: id }))} hostName={hostName} />
        </Section>
      )}
      {problem && <p className="mt-3 rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">{problem}</p>}
      <p className="mt-4 text-meta/[inherit] text-subtle" data-home-saved={entry?.source ?? ""}>
        {entry?.saving ? t("home.saving") : local ? t("home.savedLocal") : home.hostId ? t("home.savedOnHost", { host: hostName(home.hostId) }) : ""}
      </p>
    </div>
  );
}

function HostPick({ value, options, onPick, hostName }: { value: string | null; options: string[]; onPick(id: string): void; hostName(id: string): string }) {
  return (
    <select value={value ?? ""} onChange={(e) => onPick(e.target.value)} className="w-full rounded-lg border border-border bg-background px-2 py-1 text-ui/[inherit]">
      {options.map((id) => (
        <option key={id} value={id}>
          {hostName(id)}
        </option>
      ))}
    </select>
  );
}

/** The desktop's widget kinds: a switch each (an owner kind on = one instance; a module kind = its instances on); several allowed: 再加一个, and each instance's settings. */
function WidgetList() {
  const { t } = useI18n();
  const { kinds, desk, toggle, add } = useDeskKinds();
  return (
    <>
      {kinds.map((k) => {
        const own = desk.items.filter((i) => i.kind === k.item.id);
        const on = k.item.instances === "module" ? !(desk.off ?? []).includes(k.item.id) : own.length > 0;
        const Icon = k.item.icon;
        return (
          <div key={k.item.id} className="py-1" data-home-widget-row={k.item.id}>
            <div className="flex items-center gap-1.5">
              <Icon size={14} className="shrink-0 text-subtle" />
              <span className="flex-1">{t(k.item.titleKey)}</span>
              {k.item.multiple && on && (
                <button onClick={() => add(k)} title={t("home.desk.addAnother")} aria-label={t("home.desk.addAnother")} className="rounded p-0.5 text-subtle hover:bg-hover">
                  <Plus size={14} />
                </button>
              )}
              {k.item.settings?.length && own.length === 1 ? (
                <button onClick={() => openWidgetSettings(own[0]!.id)} title={t("home.desk.settings")} aria-label={t("home.desk.settings")} className="rounded p-0.5 text-subtle hover:bg-hover">
                  <Settings2 size={14} />
                </button>
              ) : null}
              <Toggle checked={on} onChange={(v) => toggle(k, v)} label={t(k.item.titleKey)} />
            </div>
            {k.item.settings?.length && own.length > 1
              ? own.map((i, n) => (
                  <button key={i.id} onClick={() => openWidgetSettings(i.id)} className="ml-5 flex items-center gap-1 py-0.5 text-xs text-accent hover:underline">
                    <Settings2 size={12} />
                    {t(k.item.titleKey)} {n + 1}
                  </button>
                ))
              : null}
          </div>
        );
      })}
    </>
  );
}
