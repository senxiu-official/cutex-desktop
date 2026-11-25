// The one test that touches the real Windows Credential Manager (the owner's, per Windows user: there is no private
// copy). Runs only with CUTEX_TEST_WINCRED=1 on Windows, and only after telling the Director. Every credential lives
// under a random `Cutex 浏览器测试/<uuid>/` prefix and is deleted in afterAll whatever happens.
// No Windows Hello: the store here uses the stand-in guard; the Hello calls are the no-UI ones only (availability,
// opening a key that does not exist).
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { credDelete, credList, credRead, credWrite, helloAvailability, helloKeyExists } from "../src/main/browser/passwords/win32";
import { credentialSlots, devMemoryGuard } from "../src/main/browser/passwords/guards";
import { createPasswordStore } from "../src/main/browser/passwords/store";

const enabled = process.platform === "win32" && process.env.CUTEX_TEST_WINCRED === "1";
const PREFIX = `Cutex 浏览器测试/${randomUUID()}/`;

describe.runIf(enabled)("Windows Credential Manager (real, env-gated)", () => {
  afterAll(async () => {
    for (const c of await credList(PREFIX)) await credDelete(c.target);
    expect(await credList(PREFIX)).toEqual([]);
  });

  it("writes, lists, reads, overwrites and deletes generic credentials", async () => {
    const blob = Buffer.from([1, 2, 3, 0, 255]);
    await credWrite(`${PREFIX}a`, "mika@example.com", "Cutex 浏览器测试", blob);
    expect(await credList(PREFIX)).toEqual([{ target: `${PREFIX}a`, username: "mika@example.com", comment: "Cutex 浏览器测试" }]);
    expect((await credRead(`${PREFIX}a`))?.equals(blob)).toBe(true);
    await credWrite(`${PREFIX}a`, "other", "Cutex 浏览器测试", Buffer.from("x"));
    expect((await credRead(`${PREFIX}a`))?.toString()).toBe("x");
    expect(await credDelete(`${PREFIX}a`)).toBe(true);
    expect(await credDelete(`${PREFIX}a`)).toBe(false);
    expect(await credRead(`${PREFIX}a`)).toBeNull();
  });

  it("the store over real Credential Manager slots (stand-in guard): save, reconcile, fill, delete", async () => {
    const slots = credentialSlots(PREFIX);
    let index: string | null = null;
    const io = { read: () => index, write: (t: string) => { index = t; } };
    const guard = devMemoryGuard();
    const store = createPasswordStore({ kind: "devMemory", guard, slots, index: io, graceEnabled: () => false });
    const saved = await store.save("default", "https://login.example.com", "mika", Buffer.from("pw-real"));
    const names = (await credList(PREFIX)).map((c) => c.target.slice(PREFIX.length)).sort();
    expect(names).toEqual([`default/${saved.id}`, "vault"]);
    const blob = await credRead(`${PREFIX}default/${saved.id}`);
    expect(blob!.includes(Buffer.from("pw-real"))).toBe(false);
    let value = "";
    await store.useForFill(saved.id, async (s) => { value = s.toString(); });
    expect(value).toBe("pw-real");
    // Deleted "in Control Panel": a new store instance drops it from the index.
    await credDelete(`${PREFIX}default/${saved.id}`);
    const again = createPasswordStore({ kind: "devMemory", guard, slots, index: io, graceEnabled: () => false });
    expect(await again.list("default")).toEqual([]);
  });

  it("Hello calls that show nothing: availability, and a key that does not exist", async () => {
    expect([0, 1, 2, 3, 4]).toContain(await helloAvailability());
    expect(await helloKeyExists(`probe-${randomUUID()}`)).toBe(false);
  });
});
