// `cutex:<kind>/<key>` links and images in Markdown (docs/desktop-modules.md §19.6, contract 1.7): a
// chip that opens the target through services.refs.open. Live only when the kind has a shown
// `ref.target` provider; the provider may decorate the chip (useLink) and serve image bytes
// (thumbnail). Anything else renders as plain text with the raw link as its tooltip.
// Shell file: no feature names.
import { Link2, type LucideIcon } from "lucide-react";
import { Children, isValidElement, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { contextMenu, type MenuEntry } from "../lib/contextMenu";
import { cutexLinkRef, linkableKind, type CutexLinkTarget } from "../lib/cutexLinks";
import { THUMBNAIL_MAX_BYTES } from "../lib/fileKinds";
import { useThumbnail, type ThumbnailBytes } from "../lib/fileThumbnails";
import { useUiPrefs } from "../lib/prefs";
import { refActionEntries } from "../lib/refActions";
import { services } from "../modules/app";
import { useSlot } from "../modules/react";
import type { AppSlotEntry, CutexRef, RefLinkView, RefOpenResult } from "../modules/slots";
import { useApp } from "../store";
import { convNotify, useConvHost, useConvScope, type ConversationScopeValue } from "../lib/conversationScope";

type TargetEntry = AppSlotEntry<"ref.target">;

/** Plain text of rendered link children (the ref's title). */
function textOf(node: ReactNode): string {
  let out = "";
  Children.forEach(node, (child) => {
    if (typeof child === "string" || typeof child === "number") out += String(child);
    else if (isValidElement<{ children?: ReactNode }>(child)) out += textOf(child.props.children);
  });
  return out;
}

function useTarget(kind: string): TargetEntry | null {
  const entries = useSlot("ref.target");
  if (!linkableKind(kind)) return null;
  return entries.find((e) => e.mode === "show" && e.item.kind === kind) ?? null;
}

function useLinkRef(target: CutexLinkTarget, text: string): CutexRef {
  // Links in the open conversation are its agent's host's.
  const hostId = useConvHost();
  return cutexLinkRef(hostId, target, text);
}

function explain(t: (key: MessageKey, vars?: Record<string, string | number>) => string, r: RefOpenResult, conv: ConversationScopeValue | null) {
  if (r.status === "opened") return;
  const reason = r.status === "stale" ? t("gutter.reason.stale") : t(`gutter.reason.${r.reason}` as MessageKey);
  convNotify(conv, t("gutter.unavailable", { reason }), "error");
}

function useOpen() {
  const { t } = useI18n();
  const conv = useConvScope();
  return (ref: CutexRef, how?: "auto" | "peek" | "page") => void services.refs.open(ref, how ? { how } : {}).then((r) => explain(t, r, conv));
}

function menuFor(ref: CutexRef, open: (ref: CutexRef, how?: "auto" | "peek" | "page") => void, t: (key: MessageKey) => string): () => MenuEntry[] {
  return () => [
    { label: t("gutter.openLeft"), onSelect: () => open(ref, "peek") },
    { label: t("gutter.openRight"), onSelect: () => open(ref, "page") },
    ...refActionEntries(ref, true),
  ];
}

// The tone colours the badge; only a muted (gone) target dims the link text itself.
const TONE: Record<NonNullable<RefLinkView["tone"]>, string> = {
  normal: "text-accent",
  muted: "text-muted line-through decoration-1",
  warn: "text-accent",
};
const BADGE: Record<NonNullable<RefLinkView["tone"]>, string> = {
  normal: "text-subtle",
  muted: "text-subtle",
  warn: "text-warn",
};

function Chip({ cref, view, children }: { cref: CutexRef; view: RefLinkView | null; children: ReactNode }) {
  const { t } = useI18n();
  const open = useOpen();
  // Module icons are lucide components (slots.ts Icon); "1em" keeps them inline with the text.
  const Icon = (view?.icon ?? Link2) as LucideIcon;
  const activate = () => open(cref);
  return (
    <a
      role="link"
      tabIndex={0}
      title={view?.tooltip ?? cref.title}
      className={`cursor-pointer hover:underline ${TONE[view?.tone ?? "normal"]}`}
      onContextMenu={contextMenu(menuFor(cref, open, t))}
      onClick={(e: ReactMouseEvent) => {
        e.preventDefault();
        activate();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        activate();
      }}
    >
      <Icon aria-hidden size="1em" strokeWidth={1.75} className="mr-[0.2em] inline-block shrink-0 align-[-0.125em] opacity-80" />
      {children}
      {view?.badge && <span className={`ml-1 inline-block rounded bg-surface-2 px-1 align-[0.05em] text-[0.8em] no-underline ${BADGE[view.tone ?? "normal"]}`}>{view.badge}</span>}
    </a>
  );
}

/** Calls the provider's useLink (stable: this component is keyed by the provider id). */
function DecoratedChip({ entry, cref, children }: { entry: TargetEntry; cref: CutexRef; children: ReactNode }) {
  const use = entry.item.useLink!;
  const view = use(cref);
  return (
    <Chip cref={cref} view={view}>
      {children}
    </Chip>
  );
}

function LinkChip({ entry, cref, children }: { entry: TargetEntry; cref: CutexRef; children: ReactNode }) {
  return entry.item.useLink ? (
    <DecoratedChip key={entry.item.id} entry={entry} cref={cref}>
      {children}
    </DecoratedChip>
  ) : (
    <Chip cref={cref} view={null}>
      {children}
    </Chip>
  );
}

/** `[text](cutex:kind/key)`. */
export function CutexLink({ href, target, children }: { href: string; target: CutexLinkTarget; children: ReactNode }) {
  const entry = useTarget(target.kind);
  const cref = useLinkRef(target, textOf(children));
  if (!entry) return <span title={href}>{children}</span>;
  return (
    <LinkChip entry={entry} cref={cref}>
      {children}
    </LinkChip>
  );
}

function RefThumbnail({ entry, cref, alt, fallback }: { entry: TargetEntry; cref: CutexRef; alt: string; fallback: ReactNode }) {
  const { t } = useI18n();
  const open = useOpen();
  const thumbnail = entry.item.thumbnail!;
  const read = (): Promise<ThumbnailBytes> =>
    thumbnail(cref, THUMBNAIL_MAX_BYTES).then((img) => {
      if (!img) throw new Error("no image");
      return img;
    });
  const { ref, state } = useThumbnail(`${cref.hostId}|ref|${cref.kind}/${cref.key}`, read);
  if (state.status === "failed") return <>{fallback}</>;
  return (
    <span ref={ref} className="my-1.5 block">
      {state.status === "ok" ? (
        <img
          src={state.src}
          alt={alt}
          title={cref.title}
          draggable={false}
          tabIndex={0}
          role="link"
          onClick={() => open(cref)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            open(cref);
          }}
          onContextMenu={contextMenu(menuFor(cref, open, t))}
          className="block h-auto max-h-80 w-auto max-w-[min(100%,320px)] cursor-zoom-in rounded-md border border-border bg-surface-2 object-contain"
        />
      ) : (
        <span aria-hidden className="block h-24 w-40 animate-pulse rounded-md border border-border bg-surface-2" />
      )}
    </span>
  );
}

/** `![alt](cutex:kind/key)`: the provider's thumbnail when it has one, else a chip named by the alt text. */
export function CutexImage({ src, target, alt }: { src: string; target: CutexLinkTarget; alt: string }) {
  const images = useUiPrefs().messageImages;
  const entry = useTarget(target.kind);
  const label = alt.trim() || target.key;
  const cref = useLinkRef(target, label);
  if (!entry) return <span title={src}>{label}</span>;
  const chip = (
    <LinkChip entry={entry} cref={cref}>
      {label}
    </LinkChip>
  );
  if (images !== "thumbnail" || !entry.item.thumbnail) return chip;
  return <RefThumbnail key={entry.item.id} entry={entry} cref={cref} alt={label} fallback={chip} />;
}
