// Quota auto-continue cache (lib/quotaContinue.ts): a GET that started before a PATCH / DELETE answer
// or a host event does not overwrite the newer view.
import { describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ listeners: [] as ((e: unknown) => void)[], api: { quotaAutoContinue: vi.fn(), setQuotaAutoContinue: vi.fn(), cancelQuotaAutoContinue: vi.fn() } }));
vi.mock("../src/renderer/src/bridge", () => ({ bridge: { on: (_n: string, fn: (e: unknown) => void) => { env.listeners.push(fn); return () => {}; } } }));
vi.mock("../src/renderer/src/store", () => ({ hostApi: () => env.api, featuresOf: () => new Set(), useApp: Object.assign(vi.fn(), { getState: () => ({ notify: vi.fn() }) }) }));
const { loadQuotaContinue, setQuotaContinue, useQuotaCache } = await import("../src/renderer/src/lib/quotaContinue");

const view = (enabled: boolean) => ({ cutexSessionId: "cutex.a", enabled, pending: null, last: null });
const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

describe("quota auto-continue cache ordering", () => {
  it("an older GET does not overwrite a newer PATCH answer", async () => {
    const get = deferred<ReturnType<typeof view>>();
    env.api.quotaAutoContinue.mockReturnValueOnce(get.promise);
    const loading = loadQuotaContinue("h", "cutex.a");
    env.api.setQuotaAutoContinue.mockResolvedValueOnce({ ok: true, view: view(false) });
    await setQuotaContinue("h", "cutex.a", false);
    get.resolve(view(true));
    await loading;
    expect(useQuotaCache.getState().byKey["h|cutex.a"]?.enabled).toBe(false);
  });

  it("an older GET does not overwrite a newer event; a later GET applies", async () => {
    const get = deferred<ReturnType<typeof view>>();
    env.api.quotaAutoContinue.mockReturnValueOnce(get.promise);
    const loading = loadQuotaContinue("h", "cutex.a");
    for (const fn of env.listeners) fn({ hostId: "h", envelope: { cutex: { method: "cutex/quotaAutoContinue/changed", params: { cutexSessionId: "cutex.a", quotaAutoContinue: view(true) } } } });
    expect(useQuotaCache.getState().byKey["h|cutex.a"]?.enabled).toBe(true);
    get.resolve(view(false));
    await loading;
    expect(useQuotaCache.getState().byKey["h|cutex.a"]?.enabled).toBe(true);
    env.api.quotaAutoContinue.mockResolvedValueOnce(view(false));
    await loadQuotaContinue("h", "cutex.a");
    expect(useQuotaCache.getState().byKey["h|cutex.a"]?.enabled).toBe(false);
  });
});
