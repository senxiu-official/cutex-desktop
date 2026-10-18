import { useEffect, useRef, useState } from "react";
import { Camera, Globe, LoaderCircle, ShieldAlert, ShieldX, X } from "lucide-react";
import type { BrowserTurnShot } from "../../../../shared/browser";
import { browserErrorKey } from "./browserState";
import { bridge } from "../../bridge";
import { useI18n } from "../../i18n";
import type { RawItem } from "../../lib/timeline";
import { useApp } from "../../store";
import type { TurnAttachmentProps } from "../slots";
import { useTimelineContext } from "../timelineItemsView";
import { afterBrowserHostsDelivered, browserHostCurrent, useBrowserHostEpoch } from "./hosts";
import { browserLoadedToolItem, browserTimelineImage, browserTimelineRefusalKey, browserToolView, browserTurnShots, isBrowserTool } from "./browserTimeline";

function Screenshot({ src }: { src: string }) {
  const { t } = useI18n();
  const [invalid, setInvalid] = useState(false);
  if (invalid) return <p className="text-xs text-subtle">{t("browser.timeline.imageUnavailable")}</p>;
  return <img src={src} alt={t("browser.timeline.screenshot")} loading="lazy" decoding="async"
    className="mt-1 max-h-80 max-w-full rounded border border-border object-contain"
    onError={() => setInvalid(true)} onLoad={event => {
      const image = event.currentTarget;
      if (image.naturalWidth < 1 || image.naturalHeight < 1 || image.naturalWidth > 1600 || image.naturalHeight > 1600) setInvalid(true);
    }} />;
}

/** Browser tool output has no raw-JSON fallback: summaries cannot reveal filled values. */
function ToolRow({ item, sessionId, hostId, epoch }: { item: RawItem; sessionId: string; hostId: string; epoch: string | null }) {
  const { t } = useI18n();
  const turnId = useApp(state => state.sessions[sessionId]?.timeline.entries.get(item.id)?.turnId ?? null);
  const [full, setFull] = useState<RawItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<ReturnType<typeof browserErrorKey> | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const model = browserToolView(full ?? item);
  if (!model) return null;
  const load = async () => {
    if (loading || !turnId || !epoch || !bridge.browser) return;
    const token = ++generation.current;
    setLoading(true); setFailed(null);
    try {
      await afterBrowserHostsDelivered();
      if (!browserHostCurrent(hostId, epoch)) return;
      const reply = await bridge.browser.forHost(hostId).toolItem(sessionId, turnId, item.id);
      if (token !== generation.current || !browserHostCurrent(hostId, epoch)) return;
      const loaded = browserLoadedToolItem(reply, item);
      if (!loaded) throw new Error("invalid_result");
      setFull(loaded);
    } catch (error) { if (token === generation.current) setFailed(browserErrorKey(error)); }
    finally { if (token === generation.current) setLoading(false); }
  };
  // Waiting for / declined by the owner is not a failure: amber / muted, no ✕ (approvals: the request's card).
  const approval = model.approval;
  const Icon = model.state === "running" ? LoaderCircle : approval === "required" ? ShieldAlert : approval === "denied" ? ShieldX : model.state === "failed" ? X : Globe;
  const tone = approval === "required" ? "text-warn-text" : approval === "denied" ? "text-muted" : model.state === "failed" ? "text-danger" : "text-muted";
  return <div className="my-1 min-w-0 text-xs" data-browser-tool={model.tool} data-browser-tool-approval={approval ?? undefined}>
    <div className={`flex min-w-0 items-center gap-1.5 ${tone}`}>
      <Icon size={13} className={model.state === "running" ? "shrink-0 animate-spin" : "shrink-0"} aria-label={approval ? t(approval === "required" ? "tool.approvalRequired" : "tool.declined") : t(`browser.timeline.${model.state}`)} />
      <span className="min-w-0 truncate font-medium">{model.title || t(model.summary)}</span>
      {model.title && <span className="shrink-0 text-subtle">{t(model.summary)}</span>}
      {approval && <span className="shrink-0">· {t(approval === "required" ? "tool.approvalRequired" : "tool.declined")}</span>}
    </div>
    {model.errorCode && <p className={`ml-5 text-[11px] ${approval ? "text-subtle" : "text-danger"}`}>{t(browserTimelineRefusalKey(model.errorCode) ?? browserErrorKey(model.errorCode))}</p>}
    {model.image && <Screenshot key={model.image} src={model.image} />}
    {model.imageState === "not-loaded" && !failed && <button type="button" onClick={() => void load()}
      disabled={loading || !turnId || !epoch} className="mt-1 flex items-center gap-1 text-accent enabled:hover:underline disabled:text-subtle">
      <Camera size={12} />{t(loading ? "browser.timeline.loading" : "browser.timeline.loadImage")}
    </button>}
    {(failed || model.imageState === "invalid" || (model.imageState === "not-loaded" && !turnId))
      && <p className="mt-1 text-subtle">{t(failed ?? "browser.timeline.imageUnavailable")}</p>}
  </div>;
}

export function BrowserToolRow({ item, sessionId }: { item: RawItem; sessionId: string }) {
  const { hostId } = useTimelineContext();
  const epoch = useBrowserHostEpoch(hostId);
  return <ToolRow key={`${hostId}\0${epoch}\0${sessionId}\0${item.id}`} item={item} sessionId={sessionId} hostId={hostId} epoch={epoch} />;
}

function TurnShot({ shot, hostId, epoch }: { shot: BrowserTurnShot; hostId: string; epoch: string }) {
  const { t } = useI18n();
  const [src, setSrc] = useState<string | null>(null), [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false), [failed, setFailed] = useState<ReturnType<typeof browserErrorKey> | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  const show = async () => {
    if (loading) return;
    if (open) { setOpen(false); setSrc(null); return; }
    const token = ++generation.current;
    setLoading(true); setFailed(null);
    try {
      await afterBrowserHostsDelivered();
      if (!browserHostCurrent(hostId, epoch)) return;
      if (!bridge.browser) throw new Error("browser_unavailable");
      const reply = await bridge.browser.forHost(hostId).turnShot(shot.id);
      if (token !== generation.current || !browserHostCurrent(hostId, epoch)) return;
      const image = reply.mimeType === shot.mimeType ? browserTimelineImage(reply.mimeType, reply.data) : null;
      if (!image) throw new Error("invalid_result");
      setSrc(image); setOpen(true);
    } catch (error) { if (token === generation.current) setFailed(browserErrorKey(error)); }
    finally { if (token === generation.current) setLoading(false); }
  };
  return <div>
    <button type="button" onClick={() => void show()} disabled={loading} aria-expanded={open}
      className="flex items-center gap-1 text-accent enabled:hover:underline disabled:text-subtle">
      <Camera size={12} />{t(loading ? "browser.timeline.loading" : open ? "browser.timeline.hideShot" : "browser.timeline.showShot")}
      <span className="text-subtle">{shot.width} × {shot.height}</span>
    </button>
    {open && src && <Screenshot key={src} src={src} />}
    {failed && <p className="text-subtle">{t(failed)}</p>}
  </div>;
}

function TurnShots({ hostId, sessionId, turnId, where, width, epoch }: TurnAttachmentProps & { epoch: string }) {
  const { t } = useI18n();
  const [shots, setShots] = useState<BrowserTurnShot[]>([]);
  const turnState = useApp(state => {
    const timeline = state.sessions[sessionId]?.timeline, turn = timeline?.turns.find(entry => entry.id === turnId);
    const used = turn?.entryIds.some(id => { const entry = timeline?.entries.get(id); return entry?.kind === "tool" && isBrowserTool(entry.item); });
    return `${turn?.status ?? "unknown"}|${turn?.completedAt ?? 0}|${used ? 1 : 0}`;
  });
  useEffect(() => {
    const [status, completedAt, used] = turnState.split("|");
    if (status === "inProgress" || used !== "1" || !bridge.browser) return;
    let disposed = false, timer: ReturnType<typeof setTimeout> | undefined;
    // A just-completed turn can precede its bounded capture worker. Historic turns are read once.
    const recent = Number(completedAt) * 1000 > Date.now() - 60_000;
    const delays = recent ? [0, 500, 1500, 3500, 7500, 15000] : [0];
    const read = async (attempt: number) => {
      try {
        await afterBrowserHostsDelivered();
        if (disposed || !browserHostCurrent(hostId, epoch)) return;
        if (!bridge.browser) throw new Error("browser_unavailable");
        const values = await bridge.browser.forHost(hostId).turnShots(sessionId, turnId);
        if (disposed || !browserHostCurrent(hostId, epoch)) return;
        // Defense in depth: never display another turn's metadata, arbitrary IDs or huge lists.
        const valid = browserTurnShots(values, turnId);
        if (!valid) return;
        setShots(valid);
        // Two workers can finish different leased tabs at different times. Keep the bounded
        // read-only window even after the first image; otherwise later shots are never shown.
        if (attempt + 1 < delays.length) timer = setTimeout(() => void read(attempt + 1), delays[attempt + 1]);
      } catch { /* No image is promised when the tab closed or its retention expired. */ }
    };
    void read(0);
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [hostId, sessionId, turnId, epoch, turnState]);
  if (!shots.length) return null;
  return <section className="my-1 space-y-1 rounded-md border border-border bg-surface p-2 text-xs" style={where === "margin" ? { width } : undefined}
    aria-label={t("browser.timeline.turnShots")} data-browser-turn-shots={turnId}>
    <p className="font-medium text-muted">{t("browser.timeline.turnShots")}</p>
    <p className="text-[11px] text-subtle">{t("browser.timeline.ownerOnly")}</p>
    {shots.map(shot => <TurnShot key={shot.id} shot={shot} hostId={hostId} epoch={epoch} />)}
  </section>;
}

/** Owner-only attachment: never inserted into native history or the next model turn. */
export function BrowserTurnAttachment(props: TurnAttachmentProps) {
  const epoch = useBrowserHostEpoch(props.hostId);
  return epoch ? <TurnShots key={`${props.hostId}\0${epoch}\0${props.sessionId}\0${props.turnId}`} {...props} epoch={epoch} /> : null;
}
