// The one opaque frame shape the desktop uses for untrusted HTML (docs/desktop-modules.md §10.2):
// external plugin pages (plugin-sandbox) and agent pages (artifacts.view). Renderer side only.

/** Scripts run, nothing else: no allow-same-origin (opaque origin), no popups, forms, top navigation, downloads. */
export const OPAQUE_FRAME_SANDBOX = "allow-scripts";
/** Permissions policy: no device, clipboard, fullscreen or payment access. */
export const OPAQUE_FRAME_ALLOW = "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'; payment 'none'";

type FrameLike = Pick<HTMLIFrameElement, "title" | "setAttribute">;

/** Applies the frame attributes; `src` is set by the caller to a main-prepared one-use document URL. */
export function applyOpaqueFrame<F extends FrameLike>(frame: F, title: string): F {
  frame.title = title;
  frame.setAttribute("sandbox", OPAQUE_FRAME_SANDBOX);
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.setAttribute("allow", OPAQUE_FRAME_ALLOW);
  return frame;
}

export function createOpaqueFrame(title: string): HTMLIFrameElement {
  return applyOpaqueFrame(document.createElement("iframe"), title);
}

/**
 * Calls `navigated` once when the frame loads a second document (a page that navigated itself;
 * main refuses the navigation, so the second load is an error page). Returns the unsubscribe.
 */
export function onFrameNavigatedAway(frame: Pick<HTMLIFrameElement, "addEventListener" | "removeEventListener">, navigated: () => void): () => void {
  let loads = 0;
  const listener = () => {
    if (++loads === 2) navigated();
  };
  frame.addEventListener("load", listener);
  return () => frame.removeEventListener("load", listener);
}
