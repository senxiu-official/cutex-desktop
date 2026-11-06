// Mounts the one tooltip (lib/tips, design 040 §2.1 level T) in this window and in every desk window as they open.
// Write `data-tip="…"` on an element to give it a tip; `data-tip-side` (above / below / left / right) picks a side.
import { useEffect } from "react";
import { onEveryAppWindow } from "../lib/appWindowSet";
import { installTips } from "../lib/tips";

export function TipHost() {
  useEffect(() => onEveryAppWindow(installTips), []);
  return null;
}
