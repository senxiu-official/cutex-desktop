// 「显示桌面」 (Ctrl+Shift+D; lib/paneActions showDesktop — press again to put the layout back). Owner 2026-10-23: its
// place is the window bar's left group, last before ⋯ (components/SidebarNav TitleBarEntries; the narrow bar folds it
// into the ⋯ list) — no longer the right-hand group. Shell code: names no feature.
import { Monitor } from "lucide-react";
import { useI18n } from "../i18n";
import type { MenuAction } from "../lib/contextMenu";
import { showDesktop, useDesktop, useDesktopShown } from "../lib/paneActions";
import { keyVar } from "../lib/keybindings";


/** Its tooltip now: 显示桌面, or (shown, with a layout to put back) 放回 — with the shortcut; `name`: the same without it. */
function useTip(): { shown: boolean; tip: string; name: string } {
  const { t } = useI18n();
  const shown = useDesktopShown();
  const snapshot = useDesktop((s) => s.snapshot);
  const back = shown && !!snapshot;
  return { shown, tip: back ? t("pane.desktopBack", keyVar("paneDesktop")) : t("pane.desktop", keyVar("paneDesktop")), name: back ? t("titlebar.desktopBack") : t("titlebar.showDesktop") };
}

/** The flat icon in the window bar: pressed while the desktop shows. */
export function ShowDesktopButton({ className }: { className: string }) {
  const { shown, tip } = useTip();
  return (
    <button onClick={showDesktop} title={tip} aria-label={tip} aria-pressed={shown} data-show-desktop="" data-titlebar-entry="show-desktop" className={`${className} relative shrink-0 ${shown ? "bg-surface-2 text-foreground" : ""}`}>
      <Monitor size={16} />
    </button>
  );
}

/** Its row in the narrow bar's ⋯ list: its name only (no row there shows a shortcut; the button's tooltip has it). */
export function useShowDesktopRow(): MenuAction {
  const { name } = useTip();
  return { label: name, icon: <Monitor size={14} />, onSelect: showDesktop };
}
