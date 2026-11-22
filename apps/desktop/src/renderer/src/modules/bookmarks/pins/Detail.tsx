// 备忘 · 要处理: one memo in full (owner 2026-11-19). Bound to (hostId, pinId) and read from the same per-host cache as the
// list, so an agent's update, the owner's action elsewhere or a delete shows here at once. The detail is the agent's
// Markdown, selectable; file links resolve and open on the memo's host, against its agent. 要你定 has no reply here
// yet: the owner answers in the conversation.
import { ArrowLeft, ArrowUpRight, Check, Copy, CornerUpLeft, Link2, MessageSquare, X } from "lucide-react";
import { AgentMarkdownScope } from "../../../components/AgentMarkdownScope";
import { Avatar } from "../../../components/Avatar";
import { Markdown } from "../../../components/Markdown";
import { ArmedRemove, Button } from "../../../components/settings/Form";
import { useI18n, type MessageKey } from "../../../i18n";
import { copyText } from "../../../lib/menus";
import { RefOpenVia } from "../../../lib/refOpenVia";
import { formatAbsolute, formatWhen, useClock } from "../../../lib/time";
import { useApp } from "../../../store";
import type { MemoRef } from "../model";
import { KIND_ICON, KIND_TONE, linkText } from "./calls";
import { jumpToPin, openPinAgent, pinRefOpener } from "./open";
import { changePin, usePins } from "./store";

const seconds = (iso: string | null | undefined) => (iso ? Date.parse(iso) / 1000 : NaN);

export function PinDetail({ memo, onBack }: { memo: MemoRef; onBack(): void }) {
  const { t, locale } = useI18n();
  const now = useClock();
  const { hostId, pinId } = memo;
  const entry = usePins((s) => s.byHost[hostId]);
  const pin = entry?.pins.find((p) => p.pinId === pinId) ?? null;
  const hostName = useApp((s) => s.hosts?.hosts?.find((h) => h.id === hostId)?.label ?? hostId);
  const focus = useApp((s) => s.hosts?.active ?? "local");
  const back = (
    <button type="button" onClick={onBack} className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-subtle hover:bg-hover hover:text-foreground" data-owner-pin-back="">
      <ArrowLeft size={13} />{t("bookmarks.memo.back")}
    </button>
  );
  if (!pin)
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2" data-owner-pin-detail="" data-missing="">
        {back}
        <p className="px-1.5 text-xs text-muted">{t(entry?.loaded ? "bookmarks.memo.gone" : "bookmarks.memo.loading")}</p>
      </div>
    );
  const open = pin.state === "open";
  const Icon = KIND_ICON[pin.kind];
  const name = pin.agentName ?? pin.agentId;
  const when = (iso: string | null | undefined) => {
    const s = seconds(iso);
    return Number.isFinite(s) ? `${formatAbsolute(s)} (${formatWhen(s, now, locale)})` : (iso ?? "");
  };
  const opener = pinRefOpener(hostId, pin);
  const set = (state: "open" | "done" | "dropped") => void changePin(hostId, pin.pinId, { state, expectedRevision: pin.revision });
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-owner-pin-detail="" data-pin-state={pin.state}>
      <div className="flex items-center gap-1 border-b border-border px-1.5 py-1">{back}</div>
      <article className="min-h-0 flex-1 space-y-3 overflow-auto px-3 py-2.5 select-text">
        <header className="space-y-1.5">
          <p className={`flex items-center gap-1.5 text-caption/[inherit] font-medium ${open ? KIND_TONE[pin.kind] : "text-subtle"}`}>
            <Icon size={13} aria-hidden />
            {t(`bookmarks.memo.kind.${pin.kind}` as MessageKey)}
            {!open && <span className="text-subtle">· {t(`bookmarks.memo.state.${pin.state}` as MessageKey)}{pin.resolvedBy === "agent" ? ` (${t("bookmarks.memo.by.agent")})` : ""}</span>}
          </p>
          <h3 className={`text-sm font-semibold break-words ${open ? "" : "text-muted"}`} data-owner-pin-title="">{pin.title}</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-caption/[inherit] text-subtle">
            <dt>{t("bookmarks.memo.detail.author")}</dt>
            <dd className="flex min-w-0 items-center gap-1 text-muted"><Avatar name={name} seed={pin.agentId} size={16} /><span className="min-w-0 truncate">{name}</span>{hostId !== focus && <span className="shrink-0">· {t("bookmarks.memo.otherHost", { host: hostName })}</span>}</dd>
            <dt>{t("bookmarks.memo.detail.created")}</dt>
            <dd className="text-muted">{when(pin.createdAt)}</dd>
            {pin.updatedAt && pin.updatedAt !== pin.createdAt && <><dt>{t("bookmarks.memo.detail.updated")}</dt><dd className="text-muted">{when(pin.updatedAt)}</dd></>}
            {!open && pin.resolvedAt && <><dt>{t("bookmarks.memo.detail.resolved")}</dt><dd className="text-muted">{when(pin.resolvedAt)}</dd></>}
          </dl>
        </header>
        {/* The agent's text: files resolve in its workspace on the memo's host and are never read by themselves
            (fileReads "scoped"); `cutex:` links bring that host into view first. */}
        <RefOpenVia.Provider value={opener}>
        <AgentMarkdownScope paneId={`owner-pin:${hostId}:${pin.pinId}`} hostId={hostId} sessionId={pin.agentId}>
          {pin.detail ? (
            <div className="wrap-all min-w-0 break-words text-sm" data-owner-pin-body=""><Markdown text={pin.detail} compact fileReads="scoped" /></div>
          ) : (
            <p className="text-xs text-subtle">{t("bookmarks.memo.noDetail")}</p>
          )}
          {pin.resolution && <p className="rounded-md bg-surface-2 px-2 py-1.5 text-xs break-words text-muted" data-owner-pin-resolution="">{t("bookmarks.memo.detail.resolution")}：{pin.resolution}</p>}
          {pin.links.length > 0 && (
            <section className="space-y-1" data-owner-pin-links="">
              <h4 className="flex items-center gap-1 text-caption/[inherit] font-medium text-subtle"><Link2 size={11} />{t("bookmarks.memo.detail.links")}</h4>
              <ul className="space-y-0.5">
                {pin.links.map((l, i) => (
                  <li key={`${i}:${l.target}`} className="group flex min-w-0 items-start gap-1 text-xs">
                    <div className="min-w-0 flex-1 break-all [&_p]:my-0"><Markdown text={linkText(l)} compact fileReads="scoped" /></div>
                    <button type="button" className="shrink-0 rounded p-0.5 text-subtle opacity-60 hover:bg-surface-2 hover:text-foreground hover:opacity-100 focus-visible:opacity-100" aria-label={t("bookmarks.memo.copyLink")} title={`${t("bookmarks.memo.copyLink")}: ${l.target}`} onClick={() => copyText(l.target)} data-owner-pin-copy-link="">
                      <Copy size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </AgentMarkdownScope>
        </RefOpenVia.Provider>
        {pin.kind === "decide" && open && (
          <div className="flex items-start gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-muted" data-owner-pin-answer="">
            <MessageSquare size={13} className="mt-0.5 shrink-0 text-warn" />
            <span className="min-w-0 flex-1">{t("bookmarks.memo.answerHint")}</span>
            <button type="button" className="shrink-0 rounded px-1.5 py-0.5 text-accent hover:bg-accent/10" onClick={() => openPinAgent(hostId, pin)}>{t("bookmarks.memo.answer")}</button>
          </div>
        )}
      </article>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-border px-2 py-2" data-owner-pin-actions="">
        {open ? (
          <>
            <Button primary onClick={() => set("done")}><Check size={12} className="mr-1 inline" />{t("bookmarks.memo.done")}</Button>
            <Button onClick={() => set("dropped")}><X size={12} className="mr-1 inline" />{t("bookmarks.memo.drop")}</Button>
          </>
        ) : (
          <Button onClick={() => set("open")}><CornerUpLeft size={12} className="mr-1 inline" />{t("bookmarks.memo.reopen")}</Button>
        )}
        <Button title={pin.turnId ? undefined : t("bookmarks.memo.jumpSession")} onClick={() => void jumpToPin(hostId, pin)}><ArrowUpRight size={12} className="mr-1 inline" />{t("bookmarks.memo.jump")}</Button>
        {pin.detail && <Button onClick={() => copyText(pin.detail ?? "")}><Copy size={12} className="mr-1 inline" />{t("bookmarks.memo.copy")}</Button>}
        <span className="ml-auto"><ArmedRemove title={t("bookmarks.memo.remove")} label={t("bookmarks.memo.remove")} armedLabel={t("bookmarks.memo.removeArmed")} onRemove={() => { void changePin(hostId, pin.pinId, { delete: true }); onBack(); }} /></span>
      </div>
    </div>
  );
}
