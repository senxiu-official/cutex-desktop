import { beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ load: vi.fn(), run: vi.fn(), notify: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ translate: (key: string) => key }));
vi.mock("../src/renderer/src/modules/app", () => ({ appModules: () => ({ snapshot: () => [{
  moduleId: "example", mode: "show", item: { id: "source", kinds: ["artifact"], titleKey: "source", icon: () => null, submenu: fixture.load, run: fixture.run },
}] }) }));
vi.mock("../src/renderer/src/modules/react", () => ({ useSlot: () => [] }));
vi.mock("../src/renderer/src/lib/hostGatingView", () => ({ entryGateNow: () => ({ ok: true }) }));
vi.mock("../src/renderer/src/store", () => ({ useApp: { getState: () => ({ notify: fixture.notify }) } }));
import { refActionEntries } from "../src/renderer/src/lib/refActions";
import type { MenuAction } from "../src/renderer/src/lib/contextMenu";

beforeEach(() => vi.clearAllMocks());
it("adapts module source actions to lazy normal submenus without fetching while the parent is built", async () => {
  const ref = { hostId: "remote", kind: "artifact", key: "pinned@2", title: "report", params: {} };
  const child = { label: "Copy exact path", onSelect: vi.fn() };
  fixture.load.mockResolvedValue([child]);
  const row = refActionEntries(ref)[0] as MenuAction;
  expect(fixture.load).not.toHaveBeenCalled();
  expect(row.flyout).toBeUndefined();
  expect(typeof row.submenu).toBe("function");
  const loaded = await (row.submenu as () => Promise<unknown[]>)();
  expect(loaded).toEqual([child]);
  expect(fixture.load).toHaveBeenCalledExactlyOnceWith(ref);
  expect(fixture.run).not.toHaveBeenCalled();
  expect(child.onSelect).not.toHaveBeenCalled();
});
it("reports loader errors and preserves standalone action behavior", async () => {
  fixture.load.mockRejectedValueOnce(Error("not available"));
  const row = refActionEntries({ hostId: "remote", kind: "artifact", key: "pinned@2", title: "report", params: {} })[0] as MenuAction;
  expect(await (row.submenu as () => Promise<unknown[]>)()).toEqual([]);
  expect(fixture.notify).toHaveBeenCalledExactlyOnceWith("not available", "error");
  await row.onSelect();
  expect(fixture.run).toHaveBeenCalledTimes(1);
});
