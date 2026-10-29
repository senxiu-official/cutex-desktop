// cutex's own pages take the app's light / dark, other sites the OS's (owner 2026-10-23); the browser
// debugger is exclusive, so the emulation never takes it from the agent provider or a carrier's dialog guard.
import { describe, expect, it } from "vitest";
import { emulatedMediaParams, emulateGuestScheme, wantedScheme, type SchemeDebugger } from "../src/main/browser/pageScheme";

function fakeGuest() {
  const sent: unknown[] = [];
  let attached = false;
  let attaches = 0;
  let detaches = 0;
  const dbg: SchemeDebugger = {
    isAttached: () => attached,
    attach: () => {
      if (attached) throw new Error("already attached");
      attached = true;
      attaches++;
    },
    detach: () => {
      attached = false;
      detaches++;
    },
    sendCommand: async (method, params) => {
      sent.push([method, (params as { features: { value: string }[] }).features[0]!.value]);
      return {};
    },
  };
  return {
    guest: { isDestroyed: () => false, debugger: dbg },
    sent,
    other: { attach: () => dbg.attach(), detach: () => dbg.detach() },
    get attached() { return attached; },
    get attaches() { return attaches; },
    get detaches() { return detaches; },
  };
}

describe("page scheme", () => {
  it("only an own page whose app scheme differs from the OS is told anything", () => {
    expect(wantedScheme(true, "dark", "light")).toBe("dark");
    expect(wantedScheme(true, "light", "dark")).toBe("light");
    expect(wantedScheme(true, "dark", "dark")).toBeNull();
    expect(wantedScheme(false, "dark", "light")).toBeNull();
    expect(emulatedMediaParams("dark")).toEqual({ features: [{ name: "prefers-color-scheme", value: "dark" }] });
    expect(emulatedMediaParams(null)).toEqual({ features: [{ name: "prefers-color-scheme", value: "" }] });
  });

  it("nothing wanted, nothing attached: no session, no command", () => {
    const g = fakeGuest();
    const s = emulateGuestScheme(g.guest, { canOwn: () => true });
    s.set(null);
    expect(g.attaches).toBe(0);
    expect(g.sent).toEqual([]);
  });

  it("an owner tab on an own page: attaches, emulates; leaving the page detaches (the emulation ends with it)", async () => {
    const g = fakeGuest();
    const s = emulateGuestScheme(g.guest, { canOwn: () => true });
    s.set("dark");
    expect(g.attached).toBe(true);
    expect(g.sent).toEqual([["Emulation.setEmulatedMedia", "dark"]]);
    s.set("dark"); // same scheme again: no repeat
    expect(g.sent).toHaveLength(1);
    s.set(null);
    expect(g.attached).toBe(false);
    expect(g.detaches).toBe(1);
  });

  it("hands the debugger to the agent provider and re-applies in its session; takes it back after", () => {
    const g = fakeGuest();
    const s = emulateGuestScheme(g.guest, { canOwn: () => true });
    s.set("dark");
    // Provider: beforeAttach → yieldTo, attach, afterAttach → resync.
    s.yieldTo();
    expect(g.attached).toBe(false);
    g.other.attach();
    s.resync();
    expect(g.sent).toEqual([["Emulation.setEmulatedMedia", "dark"], ["Emulation.setEmulatedMedia", "dark"]]);
    // Navigating to another site while the provider holds it: cleared in its session, never detached.
    s.set(null);
    expect(g.sent.at(-1)).toEqual(["Emulation.setEmulatedMedia", ""]);
    expect(g.attached).toBe(true);
    // Back to an own page, then the provider lets go (afterDetach → resync): the tab owns it again.
    s.set("light");
    g.other.detach();
    s.resync();
    expect(g.attached).toBe(true);
    expect(g.sent.at(-1)).toEqual(["Emulation.setEmulatedMedia", "light"]);
  });

  it("a carrier (canOwn false) is never attached by the scheme; it sends through the dialog guard's session", () => {
    const g = fakeGuest();
    const s = emulateGuestScheme(g.guest, { canOwn: () => false });
    s.set("dark");
    expect(g.attaches).toBe(0);
    expect(g.sent).toEqual([]);
    g.other.attach(); // the guard resumes
    s.resync();
    expect(g.sent).toEqual([["Emulation.setEmulatedMedia", "dark"]]);
    s.yieldTo(); // not ours: nothing detached
    expect(g.attached).toBe(true);
  });

  it("dispose lets go of an owned session", () => {
    const g = fakeGuest();
    const s = emulateGuestScheme(g.guest, { canOwn: () => true });
    s.set("dark");
    s.dispose();
    expect(g.attached).toBe(false);
    s.set("dark");
    expect(g.attaches).toBe(1);
  });
});
