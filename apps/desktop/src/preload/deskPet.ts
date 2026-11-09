// Preload of the desk pet window (main/deskPet.ts): the frames main sends, and "a drag goes on" / "open the menu".
// Nothing of the main window's bridge is exposed here.
import { contextBridge, ipcRenderer } from "electron";
import type { DeskPetStageBox, DeskPetWindowBridge, DeskPetWindowRequest, DeskPetWindowState, DeskPetWindowTick } from "../shared/deskPet";
import { DESK_PET_WINDOW_CHANNEL, DESK_PET_WINDOW_DRAG, DESK_PET_WINDOW_STATE, DESK_PET_WINDOW_TICK } from "../shared/deskPetWindow";

const invoke = (request: DeskPetWindowRequest) => ipcRenderer.invoke(DESK_PET_WINDOW_CHANNEL, request);

const bridge: DeskPetWindowBridge = {
  state: () => invoke({ op: "state" }) as Promise<DeskPetWindowState | null>,
  onState(listener) {
    ipcRenderer.on(DESK_PET_WINDOW_STATE, (_event, state: DeskPetWindowState) => listener(state));
  },
  onTick(listener) {
    ipcRenderer.on(DESK_PET_WINDOW_TICK, (_event, tick: DeskPetWindowTick) => listener(tick));
  },
  dragStart: () => void invoke({ op: "dragStart" }),
  dragMove: () => ipcRenderer.send(DESK_PET_WINDOW_DRAG),
  dragEnd: () => void invoke({ op: "dragEnd" }),
  menu: () => void invoke({ op: "menu" }),
  stage: (kind) => invoke({ op: "stage", kind }) as Promise<DeskPetStageBox | null>,
};

contextBridge.exposeInMainWorld("deskPet", bridge);
