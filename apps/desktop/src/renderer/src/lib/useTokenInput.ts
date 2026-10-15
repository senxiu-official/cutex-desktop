import { useState } from "react";
import { parseWindow } from "./contextPresets";

/** Keep the custom entry open even when its numeric value happens to match a preset. */
export function useTokenInput(value: number | null, onChange: (value: number | null) => void, onValidityChange?: (valid: boolean) => void) {
  const [entry, setEntry] = useState<{ text: string; value: number | null } | null>(null);
  // Parent reset/undo changed the controlled value; discard only the old local entry.
  if (entry && entry.value !== value) setEntry(null);
  const current = entry?.value === value ? entry : null;
  return {
    custom: current !== null,
    text: current?.text ?? (value === null ? "" : String(value)),
    invalid: current !== null && parseWindow(current.text) === null,
    begin: () => {
      setEntry({ text: value === null ? "" : String(value), value });
      onValidityChange?.(value !== null);
    },
    choose: (next: number | null) => {
      setEntry(null);
      onValidityChange?.(true);
      onChange(next);
    },
    type: (text: string) => {
      const next = parseWindow(text);
      setEntry({ text, value: next ?? value });
      onValidityChange?.(next !== null);
      if (next !== null) onChange(next);
    },
  };
}
