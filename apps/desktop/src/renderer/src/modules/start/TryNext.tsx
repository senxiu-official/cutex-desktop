// 接下来可以试试 (onboarding v3, owner 2026-11-26): on the agent the first message from 开始使用 went to, a card at the
// top of its conversation (a `conversation.overlay` reserving the top band, so no message hides under it). Each item
// does the real thing with what exists — the Shelf's panel guide, a real delegation from this agent, pairing a device,
// a personal assistant — and is ticked when done. 收起 leaves a chip; 不再显示 removes it (帮助 → 开始使用 brings it
// back). The device item is ticked by hand for now (a host signal for "a device opened this agent" is future work).
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { ArrowLeftRight, Check, ChevronDown, ConciergeBell, Paintbrush, PanelRight, Smartphone, X } from "lucide-react";
import { PERSONAL_ASSISTANTS_FEATURE } from "../../../../shared/personalAssistants";
import { api } from "../../bridge";
import { Button } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { insertComposerDraft } from "../../lib/composerDrafts";
import { useConvHost } from "../../lib/conversationScope";
import { replayGuide } from "../../lib/guides";
import { useApp } from "../../store";
import type { OverlayLayout } from "../slots";
import { IPAD_GUIDE_URL } from "./pages";

/** 自定义桌面 (the look choices, as step 4 of 开始使用): loaded when opened. */
const CustomizePanel = lazy(() => import("./CustomizePanel").then((m) => ({ default: m.CustomizePanel })));
import { dismissTryNext, markTryNextDone, setTryNextCollapsed, tryNextFor, TRY_NEXT_ITEMS, useStartState, type TryNextItem } from "./state";

const ICONS: Record<TryNextItem, ReactNode> = {
  side: <PanelRight size={14} />,
  delegate: <ArrowLeftRight size={14} />,
  device: <Smartphone size={14} />,
  assistant: <ConciergeBell size={14} />,
  customize: <Paintbrush size={14} />,
};

function SubStep({ n, title, hint, children }: { n: number; title: string; hint: string; children?: ReactNode }) {
  return (
    <li className="flex gap-2 border-t border-border py-1.5 first:border-t-0">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-accent text-meta font-bold text-accent">{n}</span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground">{title}</div>
        <div className="text-meta text-subtle">{hint}</div>
        {children && <div className="mt-1 flex flex-wrap gap-1.5">{children}</div>}
      </div>
    </li>
  );
}

/** 交给另一个智能体: a helper, a delegation written into this agent's input box, and where its result comes back. */
function DelegateSteps({ hostId, sessionId, name, onDone }: { hostId: string; sessionId: string; name: string; onDone(): void }) {
  const { t } = useI18n();
  const openPage = useApp((s) => s.openPage);
  return (
    <ol className="m-0 list-none p-0" data-try-next-steps="delegate">
      <SubStep n={1} title={t("start.delegate.helper")} hint={t("start.delegate.helper.hint", { name })}>
        <Button onClick={() => openPage("agent-config.newAgent", { host: hostId })}>{t("start.delegate.helper.action")}</Button>
      </SubStep>
      <SubStep n={2} title={t("start.delegate.ask", { name })} hint={t("start.delegate.ask.hint", { name })}>
        <Button onClick={() => insertComposerDraft(hostId, sessionId, t("start.delegate.ask.draft"))}>{t("start.delegate.ask.action")}</Button>
      </SubStep>
      <SubStep n={3} title={t("start.delegate.result")} hint={t("start.delegate.result.hint", { name })}>
        <Button primary onClick={onDone}>{t("start.delegate.result.done")}</Button>
      </SubStep>
    </ol>
  );
}

/** 在手机 / iPad 上继续: install, pair (this host's 已登录设备), then the owner ticks seeing the same agent there. */
function DeviceSteps({ name, onDone }: { name: string; onDone(): void }) {
  const { t } = useI18n();
  const openSettings = useApp((s) => s.openSettings);
  return (
    <ol className="m-0 list-none p-0" data-try-next-steps="device">
      <SubStep n={1} title={t("start.device.install")} hint="">
        <button type="button" onClick={() => void api.openExternal(IPAD_GUIDE_URL)} className="text-meta text-accent hover:underline">{t("start.device.install.link")}</button>
      </SubStep>
      <SubStep n={2} title={t("start.device.pair")} hint={t("start.device.pair.hint")}>
        <Button onClick={() => openSettings("access")}>{t("start.device.pair.action")}</Button>
      </SubStep>
      <SubStep n={3} title={t("start.device.open", { name })} hint={t("start.device.open.hint")}>
        <Button primary onClick={onDone}>{t("start.device.open.done")}</Button>
      </SubStep>
    </ol>
  );
}

export function TryNextCard({ hostId, sessionId, name }: { hostId: string; sessionId: string; name: string }) {
  const { t } = useI18n();
  const state = useStartState();
  const openPage = useApp((s) => s.openPage);
  const openSettings = useApp((s) => s.openSettings);
  const assistants = useApp((s) => s.features.has(PERSONAL_ASSISTANTS_FEATURE));
  const [open, setOpen] = useState<TryNextItem | null>(null);
  const left = TRY_NEXT_ITEMS.filter((i) => !state.done.includes(i)).length;
  if (state.collapsed) {
    return (
      <button type="button" data-try-next="chip" onClick={() => setTryNextCollapsed(false)} className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-0.5 text-meta text-muted shadow-sm hover:text-foreground">
        ✦ {left ? t("start.next.chip", { n: left }) : t("start.next.chipAll")}
      </button>
    );
  }
  const finish = (item: TryNextItem) => {
    markTryNextDone(item);
    setOpen(null);
  };
  const act = (item: TryNextItem) => {
    if (item === "side") {
      replayGuide("panel.shelf");
      markTryNextDone("side");
    } else if (item === "assistant") {
      if (!assistants) return;
      openPage("personal-assistants.page");
      markTryNextDone("assistant");
    } else setOpen(item);
  };
  const title: Record<TryNextItem, MessageKey> = { side: "start.next.side.title", delegate: "start.next.delegate.title", device: "start.next.device.title", assistant: "start.next.assistant.title", customize: "start.customize.title" };
  const body: Record<TryNextItem, MessageKey> = { side: "start.next.side.body", delegate: "start.next.delegate.body", device: "start.next.device.body", assistant: assistants ? "start.next.assistant.body" : "start.next.assistant.unsupported", customize: "start.next.customize.body" };
  return (
    <div data-try-next="card" className="pointer-events-auto rounded-xl border border-accent/35 bg-surface p-2.5 text-ui shadow-md">
      <div className="flex items-center gap-2 font-semibold text-foreground">
        <span className="flex-1">{t("start.next.title")}</span>
        <button type="button" onClick={() => setTryNextCollapsed(true)} title={t("start.next.collapse")} className="rounded p-0.5 text-subtle hover:bg-hover hover:text-foreground"><ChevronDown size={14} /></button>
        <button type="button" onClick={dismissTryNext} title={t("start.next.dismiss")} className="rounded p-0.5 text-subtle hover:bg-hover hover:text-foreground"><X size={14} /></button>
      </div>
      {open ? (
        <div className="mt-1.5">
          <div className="mb-1 flex items-center gap-2 text-meta">
            <button type="button" onClick={() => setOpen(null)} className="text-accent hover:underline">← {t("start.next.back")}</button>
            <b className="text-foreground">{t(title[open])}</b>
          </div>
          {open === "delegate" && <DelegateSteps hostId={hostId} sessionId={sessionId} name={name} onDone={() => finish("delegate")} />}
          {open === "device" && <DeviceSteps name={name} onDone={() => finish("device")} />}
          {open === "customize" && (
            <div data-try-next-steps="customize" className="max-h-[60vh] overflow-y-auto pr-1">
              <Suspense fallback={null}><CustomizePanel /></Suspense>
              <div className="mt-2"><Button primary onClick={() => finish("customize")}>{t("start.customize.done")}</Button></div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {TRY_NEXT_ITEMS.map((item) => {
              const done = state.done.includes(item);
              const disabled = item === "assistant" && !assistants;
              return (
                <button key={item} type="button" data-try-next-item={item} data-done={done} disabled={disabled} onClick={() => act(item)} className={`flex gap-2 rounded-lg border border-border bg-background p-2 text-left ${disabled ? "opacity-60" : "hover:bg-hover"}`}>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2 text-muted">{done ? <Check size={14} className="text-ok" /> : ICONS[item]}</span>
                  <span className="min-w-0">
                    <b className={`block text-ui ${done ? "text-muted line-through decoration-subtle" : "text-foreground"}`}>{t(title[item])}</b>
                    <span className="block text-meta leading-snug text-subtle">{t(body[item])}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-meta text-subtle">
            {t("start.next.more")}
            {(["tray", "sidebar", "conversation"] as const).map((p) => (
              <button key={p} type="button" onClick={() => replayGuide(`panel.${p}`)} className="text-accent hover:underline">{t(`onboarding.panel.${p}.title`)}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The gap above the card, and below another overlay it would otherwise sit under. */
const TOP_GAP = 8;
/** How far down another overlay may start and still count as one at the top. */
const TOP_ZONE = 64;

/**
 * Where the card starts (px from the conversation's top): below the other overlays floating at the top that it would
 * overlap (the status capsule on the right), so neither covers the other's buttons. Re-measured when they change.
 */
function useClearTop(ref: RefObject<HTMLDivElement | null>, shown: boolean): number {
  const [top, setTop] = useState(TOP_GAP);
  useLayoutEffect(() => {
    const el = ref.current;
    const root = el?.closest("[data-overlay-root]");
    const item = el?.closest("[data-overlay-item]");
    if (!shown || !el || !root || !item) return;
    const win = el.ownerDocument.defaultView!;
    const drawn = (node: Element, out: Element[]) => {
      for (const child of node.children) {
        const cs = win.getComputedStyle(child);
        if (cs.display === "contents" || cs.pointerEvents === "none") drawn(child, out);
        else out.push(child);
      }
      return out;
    };
    const measure = () => {
      const base = (el.offsetParent ?? root.parentElement)?.getBoundingClientRect().top ?? 0;
      const card = el.firstElementChild?.getBoundingClientRect();
      if (!card) return;
      let next = TOP_GAP;
      for (const other of root.querySelectorAll(":scope > [data-overlay-item]")) {
        if (other === item) continue;
        for (const box of drawn(other, []).map((x) => x.getBoundingClientRect())) {
          if (!box.height || box.top - base > TOP_ZONE || box.right <= card.left || box.left >= card.right) continue;
          next = Math.max(next, Math.ceil(box.bottom - base) + TOP_GAP);
        }
      }
      setTop((old) => (old === next ? old : next));
    };
    measure();
    const mo = new win.MutationObserver(measure);
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    const ro = new win.ResizeObserver(measure);
    ro.observe(root.parentElement ?? el);
    return () => {
      mo.disconnect();
      ro.disconnect();
    };
  }, [ref, shown]);
  return top;
}

/** `conversation.overlay`: the card over the top of this agent's column while it is the one 开始使用 wrote to. */
export function TryNextOverlay({ sessionId, reserve }: { sessionId: string; reserve(layout: OverlayLayout | null): void }) {
  const hostId = useConvHost();
  const state = useStartState();
  const shown = tryNextFor(state, hostId, sessionId);
  const name = useApp((s) => s.sidebar?.active.find((r) => r.cutexSessionId === sessionId)?.displayName ?? "");
  const frame = useRef<HTMLDivElement>(null);
  const top = useClearTop(frame, shown);
  useEffect(() => {
    reserve(shown ? { anchor: "top", overColumn: true } : null);
    return () => reserve(null);
  }, [shown, reserve]);
  if (!shown) return null;
  return (
    <div ref={frame} style={{ top }} className="pointer-events-none absolute inset-x-0 z-[5] flex justify-center px-4">
      <div className="w-full max-w-[44rem]">
        <TryNextCard hostId={hostId} sessionId={sessionId} name={name} />
      </div>
    </div>
  );
}
