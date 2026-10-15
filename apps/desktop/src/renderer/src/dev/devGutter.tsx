// Browser-preview demo of the two sides (docs/desktop-modules.md §19), installed by dev/mockBridge.ts
// with `?gutter`: a left-gutter list of sample refs (a Wave turn, a far-back one, another agent's
// turn, a missing turn, an agent, a file preview), a `ref.action` (copy the ref as JSON) and a margin
// `timeline.turnAttachment` on every tenth Wave turn. Click a row = services.refs.open(ref); right
// click = pick how. Dev only: nothing here reaches a production bundle.
import { Bookmark, Copy, StickyNote } from "lucide-react";
import { useI18n } from "../i18n";
import { contextMenu } from "../lib/contextMenu";
import { agentRef, turnRef } from "../lib/refs";
import { instanceRef } from "../lib/refServices";
import { sideRegistry } from "../lib/sideComponents";
import { appModules, services } from "../modules/app";
import { defineModule, type CutexRef, type GutterBodyProps, type TurnAttachmentProps } from "../modules/slots";
import type { ItemId, Json } from "../modules/types";
import { useApp } from "../store";

const hostOf = () => useApp.getState().hosts?.active ?? "local";

/** A component ref the way the shell builds one (parseParams → init → toRef). */
function componentRef(kind: ItemId, params: Json): CutexRef | null {
  const item = sideRegistry().get(kind)?.item;
  const parsed = item?.parseParams(params);
  return item && parsed ? instanceRef(hostOf(), kind, item.init(parsed, null)) : null;
}

function sampleRefs(): CutexRef[] {
  const host = hostOf();
  const wave = (n: number) => turnRef({ hostId: host, sessionId: "wave", turnId: `wave-t${n}`, agentName: "Wave-Director", ordinal: n, snippet: `第 ${n} 轮：看一下 release-notes 的第 ${n} 条。` });
  return [
    wave(236),
    wave(36),
    wave(3),
    turnRef({ hostId: host, sessionId: "eva", turnId: "turn-1", agentName: "Eva", snippet: "（另一个 agent 的一轮）" }),
    turnRef({ hostId: host, sessionId: "wave", turnId: "wave-t999", agentName: "Wave-Director", snippet: "已撤销的一轮" }),
    agentRef(host, "mika", "Mika"),
    componentRef("workspace.preview", { path: "docs/DESIGN.md" }),
  ].filter((r): r is CutexRef => !!r);
}

const open = (ref: CutexRef, how?: "auto" | "peek" | "page" | "jump") =>
  void services.refs.open(ref, how ? { how } : undefined).then((r) => {
    if (r.status !== "opened") services.ui.notice(`${ref.title}: ${r.status === "stale" ? "stale" : r.reason}`, "error");
  });

function RefsList({ close, docked }: GutterBodyProps) {
  const { t } = useI18n();
  const refs = sampleRefs();
  return (
    <div className="flex flex-col gap-0.5 p-1">
      <div className="px-2 pt-1 pb-1.5 text-xs text-subtle">{t("gutter.demo.hint")}</div>
      {refs.map((ref) => (
        <button
          key={`${ref.kind}:${ref.key}`}
          onClick={() => {
            open(ref);
            // A popover closes after a pick; a docked list stays (close() would fold it away).
            if (!docked) close();
          }}
          onContextMenu={contextMenu(() => [
            { label: t("gutter.openLeft"), onSelect: () => open(ref, "peek") },
            { label: t("gutter.openRight"), onSelect: () => open(ref, "page") },
            ref.kind === "turn" && { label: t("gutter.jump"), onSelect: () => open(ref, "jump") },
          ])}
          className="flex min-w-0 flex-col items-start rounded-lg px-2 py-1.5 text-left hover:bg-hover"
        >
          <span className="w-full truncate text-[13px]">{ref.title}</span>
          <span className="w-full truncate text-[11px] text-subtle">
            {ref.kind}
            {ref.snapshot?.snippet ? ` · ${ref.snapshot.snippet}` : ""}
          </span>
        </button>
      ))}
    </div>
  );
}

function MarginNote({ turnId, where, width }: TurnAttachmentProps) {
  const { t } = useI18n();
  const n = /^wave-t(\d+)$/.exec(turnId)?.[1];
  if (!n || Number(n) % 10 !== 0) return null;
  return (
    <div className={`rounded-lg border border-card-border bg-background px-2.5 py-1.5 text-xs text-muted shadow-sm ${where === "inline" ? "my-1" : ""}`} style={where === "margin" ? { width } : undefined}>
      <div className="flex items-center gap-1 font-medium text-foreground">
        <StickyNote size={12} className="text-accent" />
        {t("gutter.demo.note")} · #{n}
      </div>
      <div className="mt-0.5 line-clamp-2">{where === "margin" ? "margin" : "inline"} · {width}px</div>
    </div>
  );
}

const devGutter = defineModule({
  id: "dev-gutter",
  titleKey: "gutter.demo.title",
  descriptionKey: "gutter.demo.hint",
  contributes: {
    "conversation.gutter": [{ id: "dev-gutter.refs", side: "left", order: 100, titleKey: "gutter.demo.title", icon: Bookmark, Body: RefsList, dockMinWidth: 260 }],
    "ref.action": [
      {
        id: "dev-gutter.copy",
        icon: Copy,
        titleKey: "gutter.demo.action",
        run: async (ref) => {
          await navigator.clipboard?.writeText(JSON.stringify(ref, null, 2)).catch(() => {});
          services.ui.notice(JSON.stringify(ref).slice(0, 160));
        },
      },
    ],
    "timeline.turnAttachment": [{ id: "dev-gutter.note", order: 100, margin: { side: "right", minWidth: 180 }, Attachment: MarginNote }],
  },
});

/** Adds the demo module once the module host has started (main.tsx starts it after the bridge). */
export function installDevGutter(): void {
  const tryAdd = () => {
    try {
      void appModules().addModules([devGutter]);
    } catch {
      setTimeout(tryAdd, 50);
    }
  };
  tryAdd();
}
