import { expect, it, vi } from "vitest";
import type { SessionResource } from "@cutex-desktop/protocol";
import { OperatorRestartNotices, recordOperatorRuntimeNotice } from "../src/main/operatorRestart";

const session = (busy = false, generation = 8) => ({ cutexSessionId: "member", lifecycle: "active", runtime: { status: "online", activeTurnId: busy ? "turn" : null, runtimeGeneration: generation } }) as SessionResource;
function setup(busy = false) {
  const resource = session(busy), notices = new OperatorRestartNotices();
  return { resource, notices, read: vi.fn(async () => resource), current: vi.fn(() => true) };
}
it.each([false, true])("only records a notice for an online runtime, busy=%s", async busy => {
  const f = setup(busy); expect(await recordOperatorRuntimeNotice(f)).toEqual({ state: "required" });
  expect(f.read).toHaveBeenCalledOnce(); expect(f.notices.current([f.resource])).toEqual(["member"]);
  expect(f.resource.runtime.status).toBe("online"); expect(f.resource.runtime.activeTurnId).toBe(busy ? "turn" : null);
});
it("does not record a notice after the host changes during the read", async () => {
  const f = setup(); f.current.mockReturnValue(false);
  await expect(recordOperatorRuntimeNotice(f)).rejects.toThrow("host_changed"); expect(f.notices.current([f.resource])).toEqual([]);
});
it("does not start an offline member; manual restart clears the generation notice", async () => {
  const f = setup(true); await recordOperatorRuntimeNotice(f);
  expect(f.notices.current([session(false, 9)])).toEqual([]);
  f.notices.require(f.resource); f.resource.runtime.status = "offline";
  expect(await recordOperatorRuntimeNotice(f)).toEqual({ state: "offline" }); expect(f.notices.current([f.resource])).toEqual([]);
});
it("does not keep notices for retired or removed members", async () => {
  const f = setup(); await recordOperatorRuntimeNotice(f);
  f.resource.lifecycle = "retired"; expect(f.notices.current([f.resource])).toEqual([]);
  f.notices.require(session()); expect(f.notices.current([])).toEqual([]);
});
