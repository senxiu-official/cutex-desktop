// Window-level Esc → stop the running turn (decision in lib/escInterrupt.ts). Mounted by the
// composer of the open conversation, so it is gone on Settings and other pages; with several
// conversations on screen only the focused one's acts (`focused`).
import { useEffect, useRef } from "react";
import { anyOverlayOpen } from "./openOverlays";
import { conversationEscDecision, inSideRoot, isEditableTarget, overlayInDom, pageHasSelection, type ConversationEscContext } from "./escInterrupt";
import { sideLayersActive } from "./sideLayoutStore";

export interface ConversationEscState extends Pick<ConversationEscContext, "preset" | "turnId" | "pendingSteers" | "delegation"> {
  /** Popups the DOM probe cannot see (composer panels, pending approvals / questions). */
  blocked: boolean;
  /**
   * This conversation holds the focus (panes step 2: with two conversations side by side only the
   * focused one's Esc stops its turn; the other one's listener ignores the key). Default true.
   */
  focused?: boolean;
}

export interface ConversationEscHandlers {
  arm: () => void;
  act: (action: "interrupt" | "interruptSendSteers") => void;
}

export function useConversationEsc(state: ConversationEscState, handlers: ConversationEscHandlers): void {
  const latest = useRef({ state, handlers });
  latest.current = { state, handlers };
  useEffect(() => {
    let armed: { turnId: string; at: number } | null = null;
    // Taken in the capture phase, before any handler of this key press closes its popup (React may
    // re-render between listeners, so the popup could be gone by the bubble phase).
    let snapshot: { event: KeyboardEvent; overlay: boolean; sideLayers: boolean } | null = null;
    const onCapture = (e: KeyboardEvent) => {
      if (e.key === "Escape") snapshot = { event: e, overlay: anyOverlayOpen() || overlayInDom(), sideLayers: sideLayersActive() };
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const overlay = snapshot?.event === e ? snapshot.overlay : true;
      const sideLayers = snapshot?.event === e ? snapshot.sideLayers : true;
      snapshot = null;
      const { state: s, handlers: h } = latest.current;
      if (s.focused === false) return;
      const now = Date.now();
      const d = conversationEscDecision(
        { key: e.key, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey, repeat: e.repeat, composing: e.isComposing, defaultPrevented: e.defaultPrevented },
        {
          ...s,
          blocked: s.blocked || overlay,
          editableFocus: isEditableTarget(e.target) || isEditableTarget(document.activeElement),
          textSelection: pageHasSelection(),
          inSide: inSideRoot(e.target) || inSideRoot(document.activeElement),
          sideLayers,
          armed,
          now,
        },
      );
      if (d.kind === "ignore") return;
      e.preventDefault();
      if (d.kind === "clearSelection") {
        window.getSelection()?.removeAllRanges();
      } else if (d.kind === "arm") {
        armed = { turnId: d.turnId, at: now };
        h.arm();
      } else {
        armed = null;
        h.act(d.action);
      }
    };
    window.addEventListener("keydown", onCapture, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onCapture, true);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
