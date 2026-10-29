// What a workspace drag shows (docs/desktop-modules.md §24.13; prototype .claude/preview-workspaces.html): a
// shield over the window (the cursor; a guest page under it never sees the drag), the target lit up in the
// colour of what a drop does — 投影 blue, 并排 teal, 替换 violet, refused grey — with its label inside, the
// window's edge bands, a legend at the top, and a ghost pill (name + action) at the pointer. State and the
// probe live in lib/workspaces (`startWorkspaceDrag`); nothing here takes pointer events except the shield.
import { useI18n } from "../i18n";
import { useWorkspaceDrag, WS_EDGE, type WsTone } from "../lib/workspaces";
import { useOverlayHoles } from "../lib/overlayHoles";
import { DROP_TINT, dropTint } from "../lib/dropTint";
import { useOwnerWindow } from "../lib/ownerContext";
import { OwnerLayer } from "./OwnerLayer";

// The 动作预告 colours (docs/design/008): blue = into a Shelf / here, green = beside, red = replace, grey = refused.
const TONE: Record<WsTone, string> = { project: "var(--accent)", beside: "var(--ok)", replace: "var(--danger)", refuse: "var(--fg-subtle)" };

/** In the window the drag runs in (a desk window's drag draws there, multi-window). */
export function WorkspaceDndLayer() {
  const doc = useWorkspaceDrag((s) => s.doc);
  return (
    <OwnerLayer doc={doc}>
      <WorkspaceDndView />
    </OwnerLayer>
  );
}

function WorkspaceDndView() {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const s = useWorkspaceDrag();
  const holes = useOverlayHoles(!!s.ref);
  if (!s.ref) return null;
  const color = s.tone ? TONE[s.tone] : "var(--fg-subtle)";
  const work = typeof document === "undefined" ? null : win.document.querySelector<HTMLElement>("[data-side-work]")?.getBoundingClientRect();
  const edge = s.outcome?.kind === "beside" ? s.outcome.side : null;
  return (
    <>
      <div data-ws-dnd data-ws-dnd-shield className="fixed inset-0 z-[47]" style={{ cursor: s.tone === "refuse" || !s.tone ? "no-drop" : "grabbing" }} />
      {/* Under every menu / popover (styles.css 「Layers」; lib/overlayHoles: a hole where each open one is). */}
      <div data-ws-dnd aria-hidden className="pointer-events-none fixed inset-0 z-[48]" style={holes ? { clipPath: holes } : undefined}>
        {work &&
          (["left", "right"] as const).map((side) => (
            <div
              key={side}
              data-ws-dnd
              data-ws-edge={side}
              aria-hidden
              className="pointer-events-none fixed z-[48] flex items-center justify-center"
              style={{ top: work.top + 6, height: work.height - 12, width: WS_EDGE, left: side === "left" ? work.left : work.right - WS_EDGE }}
            >
              <i className="block w-1 rounded transition-[height] duration-(--motion-short) ease-(--ease-standard)" style={{ height: edge === side ? 200 : 120, background: edge === side ? TONE.beside : "color-mix(in srgb, var(--ok) 55%, transparent)" }} />
            </div>
          ))}
        {work && (
          <div data-ws-dnd aria-hidden className="pointer-events-none fixed z-[49] flex -translate-x-1/2 items-center gap-3.5 rounded-full border border-transparent bg-background px-3.5 py-1 text-meta/[inherit] whitespace-nowrap text-muted shadow-e2" style={{ left: work.left + work.width / 2, top: work.top + 10 }}>
            <span className="flex items-center gap-1.5">
              <i className="block size-2 rounded-sm" style={{ background: TONE.project }} />
              {t("ws.legend.project")}
            </span>
            <span className="flex items-center gap-1.5">
              <i className="block size-2 rounded-sm" style={{ background: TONE.beside }} />
              {t("ws.legend.beside")}
            </span>
            <span className="flex items-center gap-1.5">
              <i className="block size-2 rounded-sm" style={{ background: TONE.replace }} />
              {t("ws.legend.replace")}
            </span>
          </div>
        )}
        {s.zone && (
          <div
            data-ws-dnd
            data-ws-zone={s.outcome?.kind ?? ""}
            className={`${DROP_TINT} pointer-events-none fixed z-[48] rounded-card border-2 border-dashed transition-[left,top,width,height] duration-(--motion-short) ease-(--ease-standard)`}
            // 拖放落点预览: the dashed outline in the action's colour; 框线+底色 also tints it (lib/dropTint).
            style={{ ...dropTint(color, 11), left: s.zone.left, top: s.zone.top, width: s.zone.width, height: s.zone.height, borderColor: color }}
          >
            <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-px rounded-card px-4 py-[7px] text-ui/[inherit] font-semibold whitespace-nowrap text-white shadow-e2" style={{ background: s.tone === "refuse" ? "var(--fg-muted)" : color }}>
              {s.label}
              {s.sub && <small className="text-caption/[inherit] font-normal opacity-90">{s.sub}</small>}
            </div>
          </div>
        )}
        <div
          data-ws-dnd
          data-ws-ghost=""
          className="pointer-events-none fixed z-[49] flex -translate-x-[30%] -translate-y-1/2 -rotate-2 items-center gap-2 rounded-full border border-transparent bg-background py-[5px] pr-3 pl-3 text-ui/[inherit] font-medium whitespace-nowrap shadow-e2"
          style={{ left: s.x + 14, top: s.y + 18 }}
        >
          {s.title}
          <span className="rounded-full px-[7px] text-caption/[inherit] leading-[18px] font-semibold" style={s.tone && s.tone !== "refuse" ? { background: color, color: "#fff" } : { background: "var(--surface-2)", color: "var(--fg-muted)" }}>
            {s.action}
          </span>
        </div>
      </div>
    </>
  );
}
