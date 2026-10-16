// Extra reasons for the red dot on the sidebar 设置 entry, set by modules from outside React (their
// activate()). The shell only reads them; a module clears its own reason when it stops.
import { create } from "zustand";

/** Module id → i18n key of the dot's tooltip line (null / absent: nothing to say). */
export const useSettingsAttentionStore = create<{ byModule: Record<string, string> }>(() => ({ byModule: {} }));

export function setSettingsAttention(moduleId: string, titleKey: string | null): void {
  useSettingsAttentionStore.setState((s) => {
    if ((s.byModule[moduleId] ?? null) === titleKey) return s;
    const byModule = { ...s.byModule };
    if (titleKey) byModule[moduleId] = titleKey;
    else delete byModule[moduleId];
    return { byModule };
  });
}

/** The tooltip keys of every module that wants the dot, in a stable order. */
export function useSettingsAttention(): string[] {
  const byModule = useSettingsAttentionStore((s) => s.byModule);
  return Object.keys(byModule)
    .sort()
    .map((id) => byModule[id]!);
}
