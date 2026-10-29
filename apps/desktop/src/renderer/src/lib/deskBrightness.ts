// 桌面亮度 (owner 2026-10-21; docs/desktop-modules.md §25.6): the desktop dims by what is in front of it —
// nothing (没有窗格时), a conversation or page (有对话或页面打开时), the panes filling the screen (窗格占满屏幕时:
// a maximised / full-screen panel, the Settings Shelf maximised, a full-window page, 工作区宽度 = 铺满窗口, or 智能
// with two workspaces).
// The rule is lib/workSurface `deskState`; this hook (components/ChipTray DesktopStage) marks <html
// data-desk-state>, the values are appearance CSS variables (lib/appearanceModel), components/tray.css
// dims the background and the content. Shell code: names no feature.
import { useEffect } from "react";
import { useAppearance } from "./appearance";
import { conversationPanes } from "./paneLayout";
import { usePanes } from "./paneStore";
import { useSettingsShelf } from "./settingsShelf";
import { useSide } from "./sideLayoutStore";
import { rowWidthMode } from "./workspaceRow";
import { deskState, type DeskState } from "./workSurface";

/** Marks <html data-desk-state> while mounted. `deskOn`: the desktop's content is on screen; `fullWindow`: a full-window page. */
export function useDeskState(deskOn: boolean, fullWindow: boolean): DeskState {
  const settingsMax = useSettingsShelf((s) => s.open && s.maximized);
  const paneMax = usePanes((s) => !!s.layout.max);
  const toolMode = useSide((s) => !!s.mode);
  const workspaces = usePanes((s) => conversationPanes(s.layout).length);
  const fill = rowWidthMode(useAppearance().workspaceWidth, workspaces) === "fill";
  const state = deskState({ covered: settingsMax || fullWindow, deskOn, filled: paneMax || toolMode || fill });
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.deskState = state;
    return () => {
      delete root.dataset.deskState;
    };
  }, [state]);
  return state;
}
