import { describe, expect, it } from "vitest";
import { deviceLabel, parseDeviceLabel } from "../src/shared/hosts";
import { clientTokenName, friendlyDeviceLabel } from "../src/renderer/src/lib/deviceNames";

const t = (_key: "device.appOnHost", vars: { app: string; host: string }) => `${vars.host} 上的 ${vars.app}`;

describe("parseDeviceLabel", () => {
  it("reads hash, folder and host from the end", () => {
    expect(parseDeviceLabel("desktop-mhs-087278-Cutex-257920")).toEqual({ host: "mhs-087278", folder: "Cutex", hash: "257920" });
    expect(parseDeviceLabel("desktop-HOST-A-side_1-abcdef")).toEqual({ host: "HOST-A", folder: "side_1", hash: "abcdef" });
    // An empty folder name: desktop-<host>-<hash>.
    expect(parseDeviceLabel("desktop-laptop-0a1b2c")).toEqual({ host: "laptop", folder: null, hash: "0a1b2c" });
  });
  it("round-trips deviceLabel", () => {
    const label = deviceLabel("mhs-087278", "C:\\Users\\me\\AppData\\Roaming\\Cutex");
    expect(parseDeviceLabel(label)).toMatchObject({ host: "mhs-087278", folder: "Cutex" });
    expect(parseDeviceLabel(deviceLabel("workbox", "/home/me/.config/cutex.dev"))).toMatchObject({ host: "workbox", folder: "cutex.dev" });
  });
  it("refuses anything else", () => {
    for (const label of ["desktop-WORKSTATION", "desktop-", "desktop--abcdef", "desktop-a--b-abcdef", "laptop-x-abcdef", "Pixel 9", "desktop-host-ABCDEF", "desktop-host-abcdeg", "desktop-host-abcdef0", ""]) {
      expect(parseDeviceLabel(label), label).toBeNull();
    }
  });
});

describe("client token names", () => {
  const token = { tokenId: "mct-1", label: "desktop-mhs-087278-Cutex-257920" };
  it("shows just the host for the installed app, host + folder otherwise", () => {
    expect(friendlyDeviceLabel(token.label, t)).toBe("mhs-087278");
    expect(friendlyDeviceLabel("desktop-mhs-087278-migration-257920", t)).toBe("mhs-087278 上的 migration");
    expect(friendlyDeviceLabel("desktop-laptop-0a1b2c", t)).toBe("laptop");
    expect(friendlyDeviceLabel("desktop-WORKSTATION", t)).toBeNull();
  });
  it("prefers the owner's name, then the device's own name, then the friendly label, then the raw label", () => {
    expect(clientTokenName({ ...token, ownerName: "Office PC", deviceName: "x" }, t)).toBe("Office PC");
    expect(clientTokenName({ ...token, ownerName: "  ", deviceName: "Pixel 9" }, t)).toBe("Pixel 9");
    expect(clientTokenName(token, t)).toBe("mhs-087278");
    expect(clientTokenName({ tokenId: "mct-2", label: "desktop-WORKSTATION" }, t)).toBe("desktop-WORKSTATION");
    expect(clientTokenName({ tokenId: "mct-3", label: "" }, t)).toBe("mct-3");
  });
});
