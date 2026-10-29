// @vitest-environment jsdom
// Design 025: a user message image cutex replaced by `cutex-media:<session>/<sha256>` is read through the
// host when shown; a plain data: URL still renders as is.
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const historyMedia = vi.fn(async () => ({ dataUrl: "data:image/png;base64,iVBORw0KGgo=" }));
vi.mock("../src/renderer/src/store", () => ({
  hostApi: () => ({ historyMedia, hostFile: vi.fn() }),
  useApp: (select: (s: unknown) => unknown) => select({}),
  featuresOf: () => new Set<string>(),
}));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (k: string) => k }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { MessageImages } = await import("../src/renderer/src/components/ImageThumbs");

it("loads a cutex-media image through the host, keeps a data URL inline", async () => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:legacy-history") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  const sha = "ab".repeat(32);
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => {
    root.render(h(MessageImages, { hostId: "host02", images: [{ kind: "url", url: `cutex-media:cutex.s1/${sha}` }, { kind: "url", url: "data:image/png;base64,AAAA" }] }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const srcs = [...host.querySelectorAll("img")].map((img) => img.getAttribute("src"));
  expect(historyMedia).toHaveBeenCalledWith("cutex.s1", sha);
  expect(srcs).toEqual(["blob:legacy-history", "data:image/png;base64,AAAA"]);
  act(() => root.unmount());
});
