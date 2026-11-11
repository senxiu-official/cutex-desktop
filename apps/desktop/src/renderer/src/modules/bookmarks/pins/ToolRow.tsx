// timeline.tool for `owner_pin`: one small card where the agent pinned something 「📌 放进备忘 · 要你定 · 标题 →」,
// with the pin's current state (已完成 once resolved); a click opens 备忘 at 要处理. The agent's reply text is never touched.
// Running: one live line; refused / failed: the error like other tool rows.
import { Loader2, Pin, X } from "lucide-react";
import { Tag } from "../../../components/Tag";
import { useI18n, type MessageKey } from "../../../i18n";
import { useConvHost } from "../../../lib/conversationScope";
import { toolErrorText } from "../../../lib/taskRows";
import type { RawItem } from "../../../lib/timeline";
import { services } from "../../app";
import { KIND_ICON, KIND_TONE, pinCallOf } from "./calls";
import { BOOKMARKS } from "../model";
import { usePins } from "./store";

export function PinToolRow({ item }: { item: RawItem; sessionId: string }) {
  const { t } = useI18n();
  const hostId = useConvHost();
  const call = pinCallOf(item);
  const live = usePins((s) => (call?.pinId ? s.byHost[hostId]?.pins.find((p) => p.pinId === call.pinId) : undefined));
  if (!call) return null;
  if (call.status === "running")
    return (
      <div className="my-0.5 flex items-center gap-1.5 text-xs text-muted">
        <Loader2 size={13} className="animate-spin text-accent" />
        <span>{t("bookmarks.memo.tool.pinning")}</span>
      </div>
    );
  if (call.status === "failed") {
    const error = toolErrorText(item);
    return (
      <div className="my-0.5 text-xs">
        <div className="flex items-center gap-1.5 text-danger"><X size={13} /><span className="font-medium">{t("bookmarks.memo.tool.failed", { board: t("bookmarks.memo.title") })}</span></div>
        {error && <pre className="mt-0.5 ml-5 max-h-40 overflow-auto font-mono text-caption/[inherit] whitespace-pre-wrap text-danger opacity-80">{error}</pre>}
      </div>
    );
  }
  const kind = live?.kind ?? call.kind;
  const Icon = KIND_ICON[kind];
  const title = live?.title ?? call.title;
  const state = live?.state ?? (call.action === "resolved" ? "done" : "open");
  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => services.side.open(BOOKMARKS, { tab: "pins" }, { binding: { kind: "host", hostId } })}
        className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs hover:bg-hover"
        data-owner-pin-call={call.pinId ?? ""}
      >
        <Pin size={13} className="shrink-0 text-accent" />
        <span className="shrink-0 text-muted">{t(`bookmarks.memo.tool.${call.action}` as MessageKey, { board: t("bookmarks.memo.title") })}</span>
        <Icon size={13} className={`shrink-0 ${KIND_TONE[kind]}`} aria-label={t(`bookmarks.memo.kind.${kind}` as MessageKey)} />
        <span className={`min-w-0 truncate font-medium ${state === "open" ? "text-foreground" : "text-subtle line-through"}`}>{title}</span>
        {state !== "open" && <Tag>{t(`bookmarks.memo.state.${state}` as MessageKey)}</Tag>}
        <span className="shrink-0 text-accent">→</span>
      </button>
    </div>
  );
}
