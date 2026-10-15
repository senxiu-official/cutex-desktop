// Preload of the big alert window (main/ownerAlert.ts): only ack / reply / open of the alerts main
// shows, plus receiving that state. Nothing of the main window's bridge is exposed here.
import { contextBridge, ipcRenderer } from "electron";
import { OWNER_ALERT_CHANNEL, OWNER_ALERT_STATE, type OwnerAlertBridge, type OwnerAlertRequest, type OwnerAlertState } from "../shared/ownerAlert";

const invoke = <T>(request: OwnerAlertRequest) => ipcRenderer.invoke(OWNER_ALERT_CHANNEL, request) as Promise<T>;

const bridge: OwnerAlertBridge = {
  state: () => invoke({ op: "state" }),
  onState(listener) {
    ipcRenderer.on(OWNER_ALERT_STATE, (_event, state: OwnerAlertState) => listener(state));
  },
  ack: (notificationId) => invoke({ op: "ack", notificationId }),
  reply: (notificationId, text) => invoke({ op: "reply", notificationId, text }),
  open: (notificationId) => invoke({ op: "open", notificationId }),
};

contextBridge.exposeInMainWorld("ownerAlert", bridge);
