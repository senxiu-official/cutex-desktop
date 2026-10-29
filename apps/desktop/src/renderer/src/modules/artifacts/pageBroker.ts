// The parent side of an agent page's three channels (shared/pageBridge.ts, docs/desktop-modules.md §10.2):
// accepts a message only from this frame instance (its window, opaque origin "null"), only in the fixed
// schema and sizes, and forwards it to main over the frames IPC — main decides. A copy is forwarded only
// while a user gesture is active in that frame (the click that asked for it); anything else is answered
// or dropped here. Replies go back to the same frame window; nothing else is ever posted to the page.
import { PAGE_MAX_IN_FLIGHT, PAGE_MESSAGE_TAG, parsePageMessage, type PageCall, type PageResult } from "../../../../shared/pageBridge";

export interface PageBrokerDeps {
  frame: Pick<HTMLIFrameElement, "contentWindow">;
  /** The main-prepared document id the frame shows (main binds it to the artifact). */
  frameId: string;
  forward(frameId: string, call: PageCall): Promise<PageResult>;
  /** True while a user gesture in this frame is active (checked when a copy request arrives). */
  gesture(): boolean;
  copied(): void;
  /** Where messages arrive: the window the frame is drawn in (the main window or a desk; default the main window). */
  host?: Pick<Window, "addEventListener" | "removeEventListener">;
}

/** Live check of the gesture behind a copy: transient activation (propagated from the frame) with focus in that frame. */
export function frameGestureActive(frame: Element, doc: Document = document): boolean {
  const activation = (doc.defaultView?.navigator as Navigator & { userActivation?: { isActive: boolean } } | undefined)?.userActivation;
  return !!activation?.isActive && doc.hasFocus() && doc.activeElement === frame;
}

export function attachPageBroker(deps: PageBrokerDeps): () => void {
  const host = deps.host ?? window;
  let inFlight = 0;
  let live = true;
  const listener = (event: MessageEvent) => {
    const source = deps.frame.contentWindow;
    if (!live || !source || event.source !== source || event.origin !== "null") return;
    const parsed = parsePageMessage(event.data);
    if (!parsed) return;
    const reply = (result: PageResult) => {
      if (live && deps.frame.contentWindow === source) source.postMessage({ tag: PAGE_MESSAGE_TAG, re: parsed.id, ...result }, "*");
    };
    if ("error" in parsed) return reply({ ok: false, error: parsed.error });
    if (inFlight >= PAGE_MAX_IN_FLIGHT) return reply({ ok: false, error: "busy" });
    const { call } = parsed;
    if (call.op === "copy" && !deps.gesture()) return reply({ ok: false, error: "no_gesture" });
    inFlight++;
    deps.forward(deps.frameId, call).then(
      (result) => {
        inFlight--;
        if (call.op === "copy" && result.ok && live) deps.copied();
        reply(result);
      },
      () => {
        inFlight--;
        reply({ ok: false, error: "unavailable" });
      },
    );
  };
  host.addEventListener("message", listener as EventListener);
  return () => {
    live = false;
    host.removeEventListener("message", listener as EventListener);
  };
}
