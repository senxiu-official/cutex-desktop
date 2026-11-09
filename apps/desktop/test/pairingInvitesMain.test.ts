import { describe, expect, it, vi } from "vitest";
import type { PairingInvite } from "@cutex-desktop/cutex-client";
import { approvePairing, pairingConfirmOptions, type PairingConfirmOptions } from "../src/main/pairingInvites";
import type { UsersResult } from "../src/shared/users";

const FUTURE = new Date(Date.now() + 120_000).toISOString();
const invite = (over: Partial<PairingInvite> = {}): PairingInvite => ({
  inviteId: "rpi-1",
  status: "pending",
  expiresAt: FUTURE,
  userId: "owner",
  scope: "full",
  label: null,
  deviceId: null,
  request: { requestId: "rpr-1", deviceName: "Pixel 9", platform: "android", shortCode: "482913", csrSha256: null, keySha256: null, route: "relay" },
  ...over,
});
const TEXTS = { title: "Allow on {host}", message: "Allow {device} full control of {host}?", detail: "Code {code} · {platform} · {user}", allow: "Allow", cancel: "Cancel", platforms: { android: "Android" } };

async function call<T>(run: () => Promise<T>): Promise<UsersResult<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    return { ok: false, error: { code: (e as { code?: string }).code ?? "x", message: String(e) } };
  }
}

function client(rows: PairingInvite[]) {
  return {
    pairingInvites: vi.fn(async () => rows),
    approvePairingRequest: vi.fn(async (_i: string, _r: string, _c: string) => ({ ...rows[0]!, status: "approved" as const })),
    users: vi.fn(async () => ({ users: [{ id: "owner", name: "Sam", displayName: null }] }) as never),
  };
}

describe("main: allowing a pairing request", () => {
  it("full control: native dialog with the code, then approves with the host's listed code", async () => {
    const c = client([invite()]);
    const seen: PairingConfirmOptions[] = [];
    const r = await approvePairing(c, call, async (o) => (seen.push(o), true), "HOST-A", "rpi-1", "rpr-1", TEXTS);
    expect(r).toMatchObject({ ok: true, invite: { status: "approved" } });
    expect(seen).toEqual([{ title: "Allow on HOST-A", message: "Allow Pixel 9 full control of HOST-A?", detail: "Code 482 913 · Android · Sam", buttons: ["Allow", "Cancel"] }]);
    expect(c.approvePairingRequest).toHaveBeenCalledWith("rpi-1", "rpr-1", "482913");
  });

  it("the owner cancels the dialog, or there is no dialog: nothing is approved", async () => {
    const c = client([invite()]);
    expect(await approvePairing(c, call, async () => false, "HOST-A", "rpi-1", "rpr-1", TEXTS)).toEqual({ ok: false, canceled: true });
    expect(await approvePairing(c, call, null, "HOST-A", "rpi-1", "rpr-1", TEXTS)).toEqual({ ok: false, canceled: true });
    expect(c.approvePairingRequest).not.toHaveBeenCalled();
  });

  it("chat / read: no dialog (confirmed in place), still the listed code", async () => {
    const c = client([invite({ scope: "chat" })]);
    const confirm = vi.fn(async () => true);
    expect((await approvePairing(c, call, confirm, "HOST-A", "rpi-1", "rpr-1", TEXTS)).ok).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(c.approvePairingRequest).toHaveBeenCalledWith("rpi-1", "rpr-1", "482913");
  });

  it("a request that is gone or replaced is never approved", async () => {
    for (const rows of [[], [invite({ status: "invited", request: null })], [invite({ request: { ...invite().request!, requestId: "rpr-other" } })], [invite({ status: "approved" })]]) {
      const c = client(rows);
      const confirm = vi.fn(async () => true);
      expect(await approvePairing(c, call, confirm, "HOST-A", "rpi-1", "rpr-1", TEXTS)).toEqual({ ok: false, changed: true });
      expect(confirm).not.toHaveBeenCalled();
      expect(c.approvePairingRequest).not.toHaveBeenCalled();
    }
  });

  it("a refusal reading the list comes back as a value", async () => {
    const c = { ...client([]), pairingInvites: vi.fn(async () => { throw Object.assign(new Error("owner_local_only"), { code: "owner_local_only" }); }) };
    expect(await approvePairing(c, call, async () => true, "HOST-A", "rpi-1", "rpr-1", TEXTS)).toMatchObject({ ok: false, error: { code: "owner_local_only" } });
  });

  it("the dialog always shows the code, even when a template leaves it out", () => {
    const o = pairingConfirmOptions(invite(), "HOST-A", "Sam", { title: "", message: "Allow?", detail: "", allow: "", cancel: "", platforms: {} });
    expect(o.detail).toContain("482 913");
    expect(o.buttons).toEqual(["Allow", "Cancel"]);
    expect(o.title).toBe("HOST-A");
  });
});
