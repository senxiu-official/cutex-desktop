// Preload of the 项目看板 window (main/board.ts): its state, its own prefs, a refresh, and "show this in the main
// window". Nothing of the main window's bridge (no daemon calls, no tokens) is exposed here.
import { contextBridge, ipcRenderer } from "electron";
import { BOARD_CHANNEL, BOARD_STATE, type BoardBridge, type BoardRequest, type BoardState } from "../shared/board";

const invoke = <T>(request: BoardRequest) => ipcRenderer.invoke(BOARD_CHANNEL, request) as Promise<T>;

const bridge: BoardBridge = {
  state: () => invoke({ op: "state" }),
  onState(listener) {
    ipcRenderer.on(BOARD_STATE, (_event, state: BoardState) => listener(state));
  },
  setPrefs: (patch) => invoke({ op: "prefs", patch }),
  open: (target) => invoke({ op: "open", target }),
  refresh: () => invoke({ op: "refresh" }),
};

contextBridge.exposeInMainWorld("board", bridge);
