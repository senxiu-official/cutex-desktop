import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ list: vi.fn(), quota: vi.fn() }));
vi.mock("../src/renderer/src/lib/profileSnapshot", () => ({ loadProfileList: m.list }));
vi.mock("../src/renderer/src/lib/targetHost", () => ({ loadHostQuota: m.quota }));
import { prepareUsage } from "../src/renderer/src/lib/usagePreparation";
import { fireHostSwitch } from "../src/renderer/src/lib/hostSwitch";
beforeEach(() => { fireHostSwitch(); vi.resetAllMocks(); });
it("shares the profile and quota warm-up between the menu and flyout", async () => {
  const finish: Array<() => void> = [];
  m.list.mockResolvedValue({ profiles: [{ name: "a" }, { name: "b" }] });
  m.quota.mockImplementation(() => new Promise<void>(r => { finish.push(r); }));
  const first = prepareUsage("h");
  expect(prepareUsage("h")).toBe(first);
  await Promise.resolve();
  expect(m.list).toHaveBeenCalledTimes(1);
  expect(m.quota).toHaveBeenCalledTimes(2);
  // Both reads may fail independently; the warm-up still settles and can refresh next opening.
  fireHostSwitch();
  m.quota.mockResolvedValue(undefined);
  await prepareUsage("h"); finish.forEach(r => r()); await first;
  expect(m.list).toHaveBeenCalledTimes(2);
});
it("settles even if one profile's quota is unavailable and refreshes on the next opening", async () => {
  m.list.mockResolvedValue({ profiles: [{ name: "a" }] });
  m.quota.mockRejectedValue(new Error("offline"));
  await expect(prepareUsage("h")).resolves.toEqual({ profiles: [{ name: "a" }] });
  await prepareUsage("h");
  expect(m.list).toHaveBeenCalledTimes(2);
});
