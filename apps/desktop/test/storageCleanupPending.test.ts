// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { cleanupPending } from "../src/renderer/src/modules/storage/cleanupPending";
const request = { requestId: "12345678-1234-4234-8234-123456789abc", previewId: "22345678-1234-4234-8234-123456789abc", items: ["item-a"], confirmed: true as const, confirmText: "删除" };
describe("cleanup pending consent persistence", () => {
  it("survives remount/reload, stays host-bound and clears after a receipt", () => {
    const store = cleanupPending("test-a"); store.write(request);
    expect(cleanupPending("test-a").read()).toEqual(request); expect(cleanupPending("test-b").read()).toBeNull();
    store.write(null); expect(cleanupPending("test-a").read()).toBeNull();
  });
  it("rejects malformed consent and strips untrusted extra fields", () => {
    const key = "cutex-desktop.storage-cleanup.pending:test-c";
    localStorage.setItem(key, JSON.stringify({ ...request, confirmed: false })); expect(cleanupPending("test-c").read()).toBeNull();
    localStorage.setItem(key, JSON.stringify({ ...request, token: "must-not-propagate", paths: ["outside"] })); expect(cleanupPending("test-c").read()).toEqual(request);
    localStorage.removeItem(key);
  });
});
