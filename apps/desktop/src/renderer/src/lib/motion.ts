// Motion tokens for the JS-driven motions (owner 2026-10-22, checklist #24, docs/design/021-motion.md): the same
// three durations and one curve as motion.css (test/motion.test.ts keeps them in step). Never animated: an edge
// drag, a window resize (lib/columnGlide `resizing`, the row's `still`), the first paint (`motionReady`); with
// reduced motion every duration is 0. Shell code.

export const MOTION = { short: 120, medium: 200, long: 280 } as const;
export type MotionToken = keyof typeof MOTION;
export const EASE_STANDARD = "cubic-bezier(0.2, 0.8, 0.2, 1)";

export function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Ready unless the app start holds it (startMotion); tests and tools never wait.
let ready = true;
/** False until the first paint has settled (nothing animates into the first layout). */
export function motionReady(): boolean {
  return ready;
}

/** A token's duration now: 0 with reduced motion or before the first paint has settled. */
export function motionMs(token: MotionToken): number {
  return ready && !reducedMotion() ? MOTION[token] : 0;
}

/** Whether a JS motion should run at all now. */
export const motionAllowed = (): boolean => ready && !reducedMotion();

/** App start: `data-motion-hold` until two frames after the first paint (motion.css turns every transition off meanwhile). */
export function startMotion(): void {
  if (typeof document === "undefined" || typeof requestAnimationFrame !== "function") {
    ready = true;
    return;
  }
  const root = document.documentElement;
  root.setAttribute("data-motion-hold", "");
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      ready = true;
      root.removeAttribute("data-motion-hold");
    }),
  );
}

/** Tests. */
export function setMotionReady(on: boolean): void {
  ready = on;
}
