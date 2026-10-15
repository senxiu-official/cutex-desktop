import { describe, expect, it } from "vitest";
import { entryCapabilities, hostGate, isRouteMissing } from "./hostGating";

const host = (caps: string[], featuresKnown = true) => ({ features: new Set(caps), featuresKnown });

describe("hostGate", () => {
  it("passes entries without requirements on any host, even unknown ones", () => {
    expect(hostGate([], null)).toEqual({ ok: true, waiting: false, missing: [] });
    expect(hostGate([], host([], false)).ok).toBe(true);
  });
  it("gates on the given host's capabilities, not any other host's", () => {
    // host-a (r226) has notes; Workstation (r225) does not: the module is active, the Workstation conversation is not.
    expect(hostGate(["notes"], host(["notes", "side-chat"])).ok).toBe(true);
    expect(hostGate(["notes"], host(["alarms-api"]))).toEqual({ ok: false, waiting: false, missing: ["notes"] });
  });
  it("is waiting (not ok) while the host's featureList is loading or the host is not connected", () => {
    expect(hostGate(["notes"], host([], false))).toEqual({ ok: false, waiting: true, missing: [] });
    expect(hostGate(["notes"], null)).toEqual({ ok: false, waiting: true, missing: [] });
  });
  it("lists every missing capability once", () => {
    expect(hostGate(["a", "b", "a"], host(["b"])).missing).toEqual(["a"]);
  });
});

describe("entryCapabilities", () => {
  it("unions module and item requirements", () => {
    expect(entryCapabilities({ requires: { capabilities: ["notes"] } }, { requires: { capabilities: ["notes", "x"] } })).toEqual(["notes", "x"]);
    expect(entryCapabilities(undefined, {})).toEqual([]);
  });
});

describe("isRouteMissing", () => {
  it("recognises a missing management v2 route (as it arrives over IPC)", () => {
    expect(isRouteMissing(new Error("route_not_found: management v2 route not found"))).toBe(true);
    expect(isRouteMissing("route_not_found: management v2 route not found")).toBe(true);
    expect(isRouteMissing({ status: 404, code: "route_not_found", message: "x" })).toBe(true);
    expect(isRouteMissing("404 Not Found")).toBe(true);
  });
  it("leaves real errors alone, including a 404 with an app code", () => {
    expect(isRouteMissing("note_not_found: no such note")).toBe(false);
    expect(isRouteMissing(Object.assign(new Error("note_not_found: gone"), { status: 404, code: "note_not_found" }))).toBe(false);
    expect(isRouteMissing("revision_conflict: stale")).toBe(false);
    expect(isRouteMissing(null)).toBe(false);
  });
});
