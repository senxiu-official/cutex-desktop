// cutex r295: main forwards only the writable heavyReadConcurrency of the settings view; the host-computed default, the
// running number and the choices are read-only (a stray copy must not make a save fail).
import { expect, it, vi } from "vitest";
import { DaemonService } from "../src/main/daemon";
import type { GlobalSettings } from "../src/shared/ipc";

it("PATCH /v2/settings carries heavyReadConcurrency (a number or null) and never the read-only fields", async () => {
  const request = vi.fn(async () => ({ restartRequired: [] }));
  const self = { requireClient: () => ({ request }) } as unknown as DaemonService;
  const view = { heavyReadConcurrencyDefault: 4, heavyReadConcurrencyActive: 4, heavyReadConcurrencyOptions: [2, 4, 6, 8] } as Partial<GlobalSettings>;
  await DaemonService.prototype.patchSettings.call(self, { ...view, heavyReadConcurrency: 6 });
  await DaemonService.prototype.patchSettings.call(self, { ...view, heavyReadConcurrency: null });
  expect(request.mock.calls).toEqual([
    ["PATCH", "/v2/settings", { body: { heavyReadConcurrency: 6 } }],
    ["PATCH", "/v2/settings", { body: { heavyReadConcurrency: null } }],
  ]);
});
