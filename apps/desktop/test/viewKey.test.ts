// lib/viewKey (panes step 1c): store keys of agent views, `<host>\n<session id>`.
import { describe, expect, it } from "vitest";
import { isViewOf, viewKey, viewKeyParts } from "../src/renderer/src/lib/viewKey";

describe("view keys", () => {
  it("name the host and the agent; the same id on two hosts gives two keys", () => {
    expect(viewKey("local", "a1")).toBe("local\na1");
    expect(viewKey("local", "a1")).not.toBe(viewKey("ssh-t", "a1"));
    expect(viewKeyParts(viewKey("ssh-t", "cutex.a-1"))).toEqual({ hostId: "ssh-t", sessionId: "cutex.a-1" });
  });

  it("select one host's keys (a host id that prefixes another is not that host)", () => {
    expect(isViewOf(viewKey("ssh", "a1"), "ssh")).toBe(true);
    expect(isViewOf(viewKey("ssh-t", "a1"), "ssh")).toBe(false);
    expect(isViewOf("a1", "local")).toBe(false);
  });
});
