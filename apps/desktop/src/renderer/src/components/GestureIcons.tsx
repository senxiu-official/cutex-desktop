// Icons for mouse gestures (owner 2026-10-24: the 点击与手势 chips show icons, the words go to the tooltip / aria-label).
// lucide-react ships mouse-left / mouse-right but no middle click: MouseMiddle is lucide's `mouse` body (same 24-unit box,
// stroke and radius) with the wheel filled. Anything that draws a lib/gestures input uses GestureInputIcon.
import { createLucideIcon, HandGrab, MouseLeft, MouseRight, Timer, type LucideIcon } from "lucide-react";
import type { GestureInput } from "../lib/gestures";

export const MouseMiddle = createLucideIcon("mouse-middle", [
  ["rect", { x: "5", y: "2", width: "14", height: "20", rx: "7", key: "body" }],
  ["rect", { x: "10.25", y: "5", width: "3.5", height: "6", rx: "1.75", fill: "currentColor", key: "wheel" }],
]);

export const GESTURE_ICONS: Record<GestureInput, LucideIcon> = {
  left: MouseLeft,
  right: MouseRight,
  middle: MouseMiddle,
  drag: HandGrab,
  longPress: Timer,
};

/** A gesture input's icon (decorative: the caller labels it). */
export function GestureInputIcon({ input, size = 15 }: { input: GestureInput; size?: number }) {
  const Icon = GESTURE_ICONS[input];
  return <Icon size={size} strokeWidth={2} aria-hidden />;
}
