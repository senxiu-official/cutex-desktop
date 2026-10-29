// Shelf page icons (owner 2026-10-25): a pinned page (固定, `shared`) keeps its own / kind icon (服务 = the server,
// 浏览器 = the globe…) — the Rail and the Shelf's top-left add a pin corner; an empty page has its own icon (a dashed
// square), never the Shelf toggle's panel icons nor the layers icon, nor 服务's server.
import { describe, expect, it } from "vitest";
import { Folder, Globe, Layers, Server, SquareDashed } from "lucide-react";
import { EMPTY_PAGE_ICON, pageIcon } from "../src/renderer/src/lib/shelfIcons";

const kindIcon = (kind: string) => (kind === "services.list" ? Server : kind === "files" ? Folder : kind === "browser" ? Globe : null);

describe("pageIcon", () => {
  it("a pinned page keeps its kind icon or its own (never the pin itself)", () => {
    expect(pageIcon({ shared: true, cards: [{ kind: "services.list" }] } as never, kindIcon)).toBe(Server);
    expect(pageIcon({ shared: true, cards: [{ kind: "browser" }] } as never, kindIcon)).toBe(Globe);
    expect(pageIcon({ shared: true, icon: "folder", cards: [{ kind: "browser" }] } as never, kindIcon)).toBe(Folder);
  });

  it("its own icon, else its first pane's kind, else the empty page's dashed square", () => {
    expect(pageIcon({ icon: "folder", cards: [] } as never, kindIcon)).toBe(Folder);
    expect(pageIcon({ cards: [{ kind: "services.list" }] } as never, kindIcon)).toBe(Server);
    expect(pageIcon({ cards: [] } as never, kindIcon)).toBe(SquareDashed);
    expect(pageIcon({ cards: [{ kind: "unknown" }] } as never, kindIcon)).toBe(SquareDashed);
    expect(EMPTY_PAGE_ICON).not.toBe(Layers);
    expect(EMPTY_PAGE_ICON).not.toBe(Server);
  });
});
