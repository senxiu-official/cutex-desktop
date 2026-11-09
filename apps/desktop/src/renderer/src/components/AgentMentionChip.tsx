import { useEffect, useRef } from "react";
import { agentIndex } from "../lib/agentLook";
import { agentMentionMarkdown, parseAgentMentionHref } from "../lib/agentMentions";
import { realAgentName } from "../lib/agentAlias";
import { useApp } from "../store";
import { archivedUnread } from "../lib/useArchivedAgents";
import { useI18n } from "../i18n";
import { openMenuFrom } from "../lib/contextMenu";
import { copyText } from "../lib/menus";
import { Avatar } from "./Avatar";
import { stripSelectionChrome } from "../lib/contentSelection";
import { isElement } from "../lib/ownerWindow";
import { replaceMathSources } from "../lib/mathCopy";

const documents = new WeakMap<Document, { elements: Set<HTMLElement>; copy(event: ClipboardEvent): void }>();
const blocks = new Set(["P", "DIV", "LI", "PRE", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "H5", "H6", "TR"]);
function plainSelection(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType === 1 && (node as Element).tagName === "BR") return "\n";
  const value = Array.from(node.childNodes, plainSelection).join("");
  return node.nodeType === 1 && blocks.has((node as Element).tagName) ? `${value}\n` : value;
}

/** Native selection copy keeps complete mentions as wire links; partial labels stay ordinary text. */
function retainMentionCopy(doc: Document, chip: HTMLElement): () => void {
  let entry = documents.get(doc);
  if (!entry) {
    const elements = new Set<HTMLElement>();
    const copy = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData) return;
      const target = event.target;
      if (isElement(target) && target.closest('input, textarea, [contenteditable="true"]')) return;
      const selection = doc.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
      const range = selection.getRangeAt(0);
      const anchor = selection.anchorNode?.nodeType === 1 ? selection.anchorNode as Element : selection.anchorNode?.parentElement;
      if (anchor?.closest('input, textarea, [contenteditable="true"]')) return;
      const candidates = [...elements].filter(element => element.dataset.agentMentionWire && range.intersectsNode(element));
      if (!candidates.length) return;
      const fragment = range.cloneContents();
      let changed = false;
      const wholeLabel = candidates.find(candidate => candidate.contains(range.commonAncestorContainer)
        && fragment.textContent === candidate.querySelector("[data-agent-mention-name]")?.textContent);
      if (wholeLabel) {
        fragment.replaceChildren(doc.createTextNode(wholeLabel.dataset.agentMentionWire!));
        changed = true;
      }
      for (const element of fragment.querySelectorAll<HTMLElement>("[data-agent-mention-wire]")) {
        const original = candidates.find(candidate => candidate.dataset.agentMentionWire === element.dataset.agentMentionWire && candidate.textContent === element.textContent);
        if (!original) continue;
        element.replaceWith(doc.createTextNode(original.dataset.agentMentionWire!));
        changed = true;
      }
      if (!changed) return;
      replaceMathSources(fragment, range);
      stripSelectionChrome(fragment);
      const last = fragment.lastChild;
      const text = last?.nodeType === 1 && blocks.has((last as Element).tagName) ? plainSelection(fragment).replace(/\n$/, "") : plainSelection(fragment);
      event.clipboardData.setData("text/plain", text);
      const html = doc.createElement("div"); html.append(fragment);
      event.clipboardData.setData("text/html", html.innerHTML);
      event.preventDefault();
    };
    entry = { elements, copy };
    documents.set(doc, entry);
    doc.addEventListener("copy", copy);
  }
  entry.elements.add(chip);
  return () => {
    entry.elements.delete(chip);
    if (entry.elements.size === 0) { doc.removeEventListener("copy", entry.copy); documents.delete(doc); }
  };
}

/**
 * One em high, with the label supplying its baseline and the avatar centred independently.
 * A 1lh box adds its descent to the line's strut and makes that line taller. The presence mark scales
 * together from Avatar's pixel reference into a fixed 1em slot, before any picture loads. The name clips only sideways
 * (ellipsis): its box is that 1em too, and `truncate`'s overflow:hidden cut the @ and descenders (j, g, y) above and below.
 */
export const MENTION_AVATAR = 16;

/**
 * Exact identity; the current authorized sidebar snapshots supply host, name and appearance. An id not in them
 * (archived, host offline) shows a plain @name; while a host's archived agents are not read yet it still opens,
 * reading them first. `host`: the link's host (another host's agent), kept in a copied link.
 */
export function AgentMentionChip({ id, name, host = null, interactive = true }: { id: string; name: string; host?: string | null; interactive?: boolean }) {
  const { t } = useI18n();
  const valid = parseAgentMentionHref(`cutex:agent/${id}`) !== null;
  const entry = useApp(state => valid ? agentIndex(state).get(id) ?? null : null);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => ref.current ? retainMentionCopy(ref.current.ownerDocument, ref.current) : undefined, []);
  const currentName = entry?.session.displayName || entry?.session.formalAgentName || name || id;
  // Copied as the link the agent would get: its own name (lib/mentionWire), the chip shows the 显示名称.
  const wire = valid ? agentMentionMarkdown((entry && realAgentName(entry.session)) || name || id, id, host) : undefined;
  const unread = useApp(state => valid && !entry && archivedUnread(state));
  const open = interactive && (!!entry || unread);
  const activate = async () => {
    // Re-read at the gesture: rename/removal/host changes since render cannot route to a stale host.
    let current = valid ? agentIndex(useApp.getState()).get(id) : null;
    if (interactive && !current && valid && archivedUnread(useApp.getState())) { await useApp.getState().ensureArchived(); current = agentIndex(useApp.getState()).get(id); }
    if (interactive && current) void useApp.getState().openAgent(id, current.hostId);
  };
  const presence = entry?.session.runtime.status === "online" ? "online" : entry?.session.runtime.status === "offline" ? "offline" : "unknown";
  return (
    <span ref={ref} data-agent-mention={id} data-agent-mention-wire={wire} data-mention-host={entry?.hostId} data-mention-presence={presence}
      role={open ? "link" : undefined} tabIndex={open ? 0 : undefined}
      aria-label={open ? t("mention.agentOpen", { name: currentName }) + (entry ? ` · ${entry.hostId} · ${t(`mention.${presence}`)}` : "") : undefined}
      title={entry ? `${currentName} · ${entry.hostId}` : currentName}
      className={`inline-flex h-[1em] max-w-full items-baseline gap-[0.2em] rounded align-baseline leading-none text-accent ${open ? "cursor-pointer hover:bg-surface-2" : ""}`}
      onClick={open ? event => { event.preventDefault(); event.stopPropagation(); void activate(); } : undefined}
      onKeyDown={open ? event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); void activate(); } } : undefined}
      onContextMenu={wire && interactive ? event => { event.preventDefault(); event.stopPropagation(); openMenuFrom(event.currentTarget, [{ label: t("composer.mention.copy"), onSelect: () => copyText(wire) }], { toggle: false }); } : undefined}>
      {entry && <span data-mention-avatar className="inline-flex size-[1em] flex-none items-center justify-center self-center">
        <span className="inline-flex flex-none" style={{ zoom: `calc(1em / ${MENTION_AVATAR}px)` }}>
          <Avatar seed={id} name={currentName} avatar={entry.session.avatar} avatarMode={entry.session.avatarMode} size={MENTION_AVATAR} status={{ presence }} />
        </span>
      </span>}
      <span data-agent-mention-name className="min-w-0 overflow-x-clip overflow-y-visible text-ellipsis whitespace-nowrap">@{currentName}</span>
    </span>
  );
}
