import { isElement } from "./ownerWindow";
// Looping CSS animations share one phase (perf §9). Spinners, running rings, pulsing dots, the typing dots: each
// infinite animation started at its own moment, and the browser runs a main-thread frame at every iteration
// boundary of every one of them — with a dozen running agents on screen that was a frame on nearly every vsync
// while nothing changed (idle: ~58 main frames/s, each walking the whole page's paint tree; 400 turns open: ~1.4 s
// of main thread per 5 s). Aligned to the document timeline's origin, the boundaries coincide: same motion, same
// speed, same per-element delays (a staggered row of dots keeps its stagger), only the phase a loop starts at.
const MAX_LOOP_MS = 4000;

function align(animation: Animation): void {
  const timing = animation.effect?.getTiming?.();
  if (!timing || timing.iterations !== Infinity) return;
  const duration = typeof timing.duration === "number" ? timing.duration : NaN;
  if (!(duration > 0 && duration <= MAX_LOOP_MS)) return;
  if (animation.playState !== "running" || animation.startTime === 0) return;
  animation.startTime = 0;
}

/** Aligns every looping CSS animation as it starts (document-level `animationstart`, capture). Idempotent. */
export function installAnimationPhase(doc: Document = document): () => void {
  if (typeof doc.getAnimations !== "function") return () => {};
  const onStart = (e: Event) => {
    const { target, animationName } = e as AnimationEvent;
    if (!isElement(target)) return;
    for (const a of target.getAnimations()) if ((a as CSSAnimation).animationName === animationName) align(a);
  };
  doc.addEventListener("animationstart", onStart, true);
  for (const a of doc.getAnimations()) align(a);
  return () => doc.removeEventListener("animationstart", onStart, true);
}
