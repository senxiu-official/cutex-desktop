// cutex/services/revealRequested → a card in the owning agent's conversation (modules/services/reveal.ts).
import { describe, expect, it } from "vitest";
import { parseServiceReveal, revealIsLive, revealPath, serviceLink } from "../src/renderer/src/modules/services/reveal";

const at = "2026-10-13T01:00:00.000Z";
const envelope = (params: Record<string, unknown>) => ({ eventId: "e7", receivedAt: at, cutexSessionId: "cutex.host", cutex: { method: "cutex/services/revealRequested", params } });

describe("service reveal requests", () => {
  it("parses cutex's payload; the host is the connection's, not cutex's host name", () => {
    const r = parseServiceReveal("workstation", envelope({ slug: "reader-doodle", hostId: "WORKSTATION", ownerCutexSessionId: "s9", path: "/view?x=1", requestedAt: at }));
    expect(r).toEqual({ hostId: "workstation", eventId: "e7", slug: "reader-doodle", path: "/view?x=1", sessionId: "s9", receivedAt: Date.parse(at) });
    expect(serviceLink(r!)).toBe("cutex:service/reader-doodle/view?x=1");
  });
  it("no owner → no session; bad slugs and other events are dropped", () => {
    expect(parseServiceReveal("local", envelope({ slug: "a", hostId: "h", ownerCutexSessionId: null, path: "/", requestedAt: at }))?.sessionId).toBeNull();
    expect(parseServiceReveal("local", envelope({ slug: "Bad_Slug", path: "/" }))).toBeNull();
    expect(parseServiceReveal("local", envelope({ slug: "../x", path: "/" }))).toBeNull();
    expect(parseServiceReveal("local", { cutex: { method: "cutex/services/changed", params: { slug: "a" } } })).toBeNull();
  });
  it("keeps only paths the cutex:service/ link form accepts", () => {
    expect(revealPath("/a/b")).toBe("/a/b");
    for (const bad of ["a", "//evil.example/x", "/a b", "/a#frag", "/a\\b", "/%E0%A4%A", "/\u0007", 5, null]) expect(revealPath(bad)).toBe("/");
  });
  it("only live requests make a card", () => {
    const start = Date.parse(at) - 1000;
    expect(revealIsLive({ receivedAt: Date.parse(at) }, Date.parse(at) + 1000, start)).toBe(true);
    expect(revealIsLive({ receivedAt: Date.parse(at) }, Date.parse(at) + 10 * 60_000, start)).toBe(false);
    expect(revealIsLive({ receivedAt: start - 60_000 }, start, start)).toBe(false);
  });
});
