// Accessible names for settings controls: `SettingRow` (components/settings/Form.tsx) publishes the
// ids of its label and hint, and every form control inside it (Toggle, Segmented, Select, TextField,
// NumberField) picks them up as aria-labelledby / aria-describedby unless it got an explicit label.
import { createContext, useContext } from "react";

export interface RowA11y {
  labelId: string;
  hintId?: string;
}

export const RowA11yContext = createContext<RowA11y | null>(null);

/** ARIA props for a control: an explicit `label` wins, else the enclosing SettingRow's label / hint. */
export function useRowA11y(label?: string): { "aria-label"?: string; "aria-labelledby"?: string; "aria-describedby"?: string } {
  const row = useContext(RowA11yContext);
  if (label) return { "aria-label": label, ...(row?.hintId ? { "aria-describedby": row.hintId } : {}) };
  if (!row) return {};
  return { "aria-labelledby": row.labelId, ...(row.hintId ? { "aria-describedby": row.hintId } : {}) };
}

/** Roving focus for a radio group: the index Left / Right / Up / Down / Home / End moves to, or null. */
export function radioKeyTarget(key: string, index: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/** Clamps a typed number into `range` (rounded); null when the text is not a number. */
export function parseClamped(text: string, range: readonly [number, number]): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return null;
  return Math.min(range[1], Math.max(range[0], Math.round(n)));
}
