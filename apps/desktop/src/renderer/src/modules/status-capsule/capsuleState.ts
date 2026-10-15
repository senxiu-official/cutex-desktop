// The capsule's view registry and its `reveal` (the "capsule" status surface, docs/desktop-modules.md
// §16.4). A mounted capsule registers itself per agent; reveal opens it at an item's section only
// while that view is mounted ("not-ready" otherwise — nothing queues). Open / folded state stays in
// the ui prefs (capsuleOpen, capsuleFoldedItems), so turning the module off keeps it.
import { getUiPrefs, setUiPref } from "../../lib/prefs";
import { toggleFoldedId } from "../../lib/statusItems";

/** DOM id of a capsule section's header (scroll target). */
export const capsuleSectionId = (itemId: string) => `capsule-${itemId}`;

const views = new Map<string, { onReveal?: () => void }>();

/** A mounted capsule for `sessionId`; returns the release (idempotent; a newer view stays). `onReveal`: told before a reveal opens it. */
export function registerCapsuleView(sessionId: string, onReveal?: () => void): () => void {
  const token = { onReveal };
  views.set(sessionId, token);
  return () => {
    if (views.get(sessionId) === token) views.delete(sessionId);
  };
}

export const capsuleViewMounted = (sessionId: string) => views.has(sessionId);

export function toggleCapsuleFolded(itemId: string): void {
  setUiPref("capsuleFoldedItems", toggleFoldedId(getUiPrefs().capsuleFoldedItems, itemId));
}

/** Opens the capsule at an item's section, unfolding it. */
export function revealInCapsule({ sessionId, itemId }: { sessionId: string; itemId: string }): "opened" | "not-ready" {
  const view = views.get(sessionId);
  if (!view) return "not-ready";
  view.onReveal?.();
  setUiPref("capsuleOpen", true);
  const folded = getUiPrefs().capsuleFoldedItems;
  if (folded.includes(itemId)) setUiPref("capsuleFoldedItems", toggleFoldedId(folded, itemId));
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      // The view may have gone (agent switched, module turned off) by the next frame.
      if (views.get(sessionId) === view) document.getElementById(capsuleSectionId(itemId))?.scrollIntoView({ block: "nearest" });
    });
  }
  return "opened";
}
