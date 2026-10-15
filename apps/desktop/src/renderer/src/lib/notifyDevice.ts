// This device's off switches for device methods (Settings → 通知 → 本设备): the host's tables decide
// when to notify; a device may only switch desktop / sound / big alert OFF for itself, never add.
// Stored by main (DesktopPrefs.notifyOff, so main's big alert honours them before the UI loads);
// in the browser preview (no shell bridge) in localStorage.
import { useSyncExternalStore } from "react";
import { DEVICE_OFF_NONE, parseDeviceOff, type DeviceMethod, type DeviceOff } from "../../../shared/notificationLevels";
import { bridge } from "../bridge";

const PREVIEW_KEY = "cutex-desktop.notifyOff";
const listeners = new Set<() => void>();
let current: DeviceOff = DEVICE_OFF_NONE;
let loaded = false;

function set(next: DeviceOff): void {
  current = next;
  for (const l of listeners) l();
}

/** Read the stored switches (main, or localStorage in the preview). */
export async function loadDeviceOff(): Promise<DeviceOff> {
  const shell = bridge.shell;
  if (shell?.setNotifyOff) {
    try {
      set(parseDeviceOff((await shell.state()).prefs.notifyOff));
    } catch {
      // keep the last value
    }
  } else {
    try {
      set(parseDeviceOff(JSON.parse(localStorage.getItem(PREVIEW_KEY) ?? "{}")));
    } catch {
      set(DEVICE_OFF_NONE);
    }
  }
  loaded = true;
  return current;
}

export function deviceOff(): DeviceOff {
  if (!loaded) void loadDeviceOff();
  return current;
}

export async function setDeviceOff(method: DeviceMethod, off: boolean): Promise<void> {
  const next = { ...current, [method]: off };
  set(next);
  const shell = bridge.shell;
  if (shell?.setNotifyOff) {
    set(parseDeviceOff((await shell.setNotifyOff(next)).prefs.notifyOff));
    return;
  }
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(next));
  } catch {
    // this session only
  }
}

export function useDeviceOff(): DeviceOff {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    deviceOff,
  );
}
