// 接下来 image row (owner 2026-11-18): a queued message with an image showed 「… [localImage]」 with an empty image pill
// before ↵. Now: ↵, then the message in its own order (text, a thumbnail), and no item type ever shows as text.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { inputPreviewText, inputSegments } from "../src/shared/inputPreview";

vi.mock("../src/renderer/src/components/ImageThumbs", () => ({ ImageThumb: ({ image }: { image: { kind: string; path?: string } }) => createElement("i", { "data-thumb": image.path ?? image.kind }) }));
vi.mock("../src/renderer/src/lib/mentionWire", () => ({ mentionPlainText: (t: string) => t }));
import { QueuedMessageInline } from "../src/renderer/src/components/QueuedMessageInline";

const owner = [{ type: "text", text: "但是放弃委托这里没显示是什么委托也" }, { type: "localImage", path: "C:\\shots\\a.png" }];

describe("input preview (shared/inputPreview)", () => {
  it("never shows an item type as text", () => {
    expect(inputPreviewText(owner)).toBe("但是放弃委托这里没显示是什么委托也");
    expect(inputPreviewText([{ type: "image", url: "data:image/png;base64,AAAA" }, { type: "text", text: "看图" }])).toBe("看图");
    expect(inputPreviewText([{ type: "brandNew" }, { type: "text", text: "x" }])).toBe("x");
    for (const parts of [owner, [{ type: "brandNew" }], [{ type: "image", url: "data:image/png;base64,AAAA" }]]) expect(inputPreviewText(parts)).not.toMatch(/\[\w+\]/);
  });
  it("skills and file mentions read by name, once", () => {
    expect(inputPreviewText([{ type: "text", text: "看看" }, { type: "mention", name: "notes.md", path: "/w/notes.md" }])).toBe("看看 @notes.md");
    expect(inputPreviewText([{ type: "text", text: "用 $review 查" }, { type: "skill", name: "review", path: "/s/review" }])).toBe("用 $review 查");
    expect(inputPreviewText([{ type: "mention", path: "/w/dir/plan.md" }])).toBe("@plan.md");
    expect(inputPreviewText([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("a\nb");
  });
  it("segments keep message order: text, then the image", () => {
    expect(inputSegments(owner).map((s) => s.kind)).toEqual(["text", "image"]);
  });
});

describe("queued owner row (components/QueuedMessageInline)", () => {
  it("renders the text and then the thumbnail, with no placeholder", () => {
    const html = renderToStaticMarkup(createElement(QueuedMessageInline, { input: owner, hostId: "local" }));
    expect(html).not.toContain("[localImage]");
    expect(html.indexOf("但是放弃委托")).toBeLessThan(html.indexOf('data-thumb="C:\\shots\\a.png"'));
  });
});
