// Where a module's own settings open from its row on 设置 → 模块 (docs/desktop-modules.md §5.1; owner 2026-11-27):
// the 「设置」 action. Only what the module contributes right now counts, so a disabled module (no contributions) or a
// page waiting for / missing a host capability (slot mode not "show") has no action. Its page first (a detail page
// under 模块, e.g. NCI, 桌宠, or one elsewhere, e.g. WhatsApp under 通知), else its first card on another page.
import type { SettingsTab } from "../store"; // type only (erased)

interface Entry<I> { moduleId: string; mode: string; item: I }

export interface ModuleSettingsRoute { page: SettingsTab; anchor?: string }

export function moduleSettingsRoute(
  moduleId: string,
  pages: readonly Entry<{ page: SettingsTab }>[],
  sections: readonly Entry<{ id: string; page: SettingsTab; titleKey?: unknown }>[],
): ModuleSettingsRoute | null {
  const page = pages.find((e) => e.moduleId === moduleId && e.mode === "show");
  if (page) return { page: page.item.page };
  const section = sections.find((e) => e.moduleId === moduleId && e.mode === "show" && e.item.titleKey);
  return section ? { page: section.item.page, anchor: section.item.id } : null;
}
