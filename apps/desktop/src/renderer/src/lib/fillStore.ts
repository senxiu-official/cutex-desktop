import { create } from "zustand";
import { emptyFillRatios, parseFillRatios, type FillRatios } from "./fillLayout";
const KEY = "cutex-desktop.fill-ratios.v1";
function load(): Record<string, FillRatios> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, parseFillRatios(value)]));
  } catch { return {}; }
}
export const useFillRatios = create<{ scopes: Record<string, FillRatios> }>(() => ({ scopes: load() }));
export const DEFAULT_FILL_RATIOS = emptyFillRatios();
export function setFillRatios(scope: string, value: FillRatios, persist = true): void {
  const scopes = { ...useFillRatios.getState().scopes, [scope]: value };
  useFillRatios.setState({ scopes });
  if (persist) persistFillRatios();
}
export function persistFillRatios(): void {
  try { localStorage.setItem(KEY, JSON.stringify(useFillRatios.getState().scopes)); } catch { /* storage unavailable */ }
}
