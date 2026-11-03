import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ save: vi.fn(), write: vi.fn(), window: null as object | null }));
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => fixture.window, getAllWindows: () => [] }, dialog: { showSaveDialog: fixture.save } }));
vi.mock("node:fs/promises", async original => ({ ...(await original<object>()), writeFile: fixture.write }));
import { remoteJobsApi } from "../src/main/remoteJobsApi";

const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
const helper = { fileName: "cutex-helper", installPath: "~/bin/helper.py", script: "print('helper')\n", sha256: "a".repeat(64) };
function api(fileName = helper.fileName) {
  const request = vi.fn().mockResolvedValue({ ...helper, fileName });
  return { service: remoteJobsApi({ request } as unknown as Parameters<typeof remoteJobsApi>[0]), request };
}
beforeEach(() => {
  Object.defineProperty(process, "platform", { ...platform, value: "darwin" });
  fixture.window = null;
  fixture.save.mockReset().mockResolvedValue({ canceled: true });
  fixture.write.mockReset().mockResolvedValue(undefined);
});
afterEach(() => Object.defineProperty(process, "platform", platform));

it.each(["cutex-helper", "cutex-helper.py", "cutex-helper.PY"])("offers a Python default and macOS-compatible filter for %s", async fileName => {
  const { service, request } = api(fileName);
  fixture.save.mockResolvedValueOnce({ canceled: false, filePath: "/fixture/owner-choice" });
  expect(await service.saveNciHelper()).toEqual({ ok: true, value: { path: "/fixture/owner-choice" } });
  expect(request).toHaveBeenCalledExactlyOnceWith("GET", "/v2/nci-verification/helper", {});
  const options = fixture.save.mock.calls[0]![0];
  expect(options.defaultPath).toMatch(/^cutex-helper\.py$/i);
  expect(options.filters).toEqual([{ name: "Python", extensions: ["py"] }]);
  expect(fixture.write).toHaveBeenCalledExactlyOnceWith("/fixture/owner-choice", helper.script, { encoding: "utf8", mode: 0o600 });
});

it.each([{ canceled: true, filePath: "/fixture/ignored.py" }, { canceled: false }])("does not write the helper for an unusable selection: %j", async result => {
  fixture.save.mockResolvedValueOnce(result);
  expect(await api().service.saveNciHelper()).toEqual({ ok: false, code: "cancelled", message: "" });
  expect(fixture.write).not.toHaveBeenCalled();
});

it("parents the save panel when a focused window exists", async () => {
  fixture.window = {};
  await api().service.saveNciHelper();
  expect(fixture.save).toHaveBeenCalledWith(fixture.window, { defaultPath: "cutex-helper.py", filters: [{ name: "Python", extensions: ["py"] }] });
  expect(fixture.write).not.toHaveBeenCalled();
});
