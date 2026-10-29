// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES } from "../src/shared/ipc";
import { pathTextImages } from "../src/renderer/src/lib/pathTextImages";

const host = vi.hoisted(() => ({ fsRead: true, hostFile: vi.fn(), hostApi: vi.fn() }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock("../src/renderer/src/lib/contextMenu", () => ({ contextMenu: () => () => {}, openMenuFrom: vi.fn() }));
vi.mock("../src/renderer/src/bridge", () => ({ api: {}, apiFor: () => ({}), bridge: {}, onEvent: () => () => {} }));
vi.mock("../src/renderer/src/store", () => ({
  useApp: Object.assign((select: (s: unknown) => unknown) => select({}), {
    getState: () => ({ hosts: { hosts: [{ id: "remote-host", conn: { epoch: "one" } }] } }),
  }),
  featuresOf: (_state: unknown, hostId: string) => new Set(host.fsRead && hostId === "remote-host" ? ["fs-file-read"] : []),
  hostApi: (hostId: string) => { host.hostApi(hostId); return { hostFile: host.hostFile }; },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { MessageImages } = await import("../src/renderer/src/components/ImageThumbs");
const { resetThumbnailCache } = await import("../src/renderer/src/lib/fileThumbnails");

// The actual backend wording is the wire contract, including punctuation and canonical JSON.
const PREFIX = "[Image supplied as a file path on this agent's host; use your image-reading tool to inspect it. Path is a JSON string: ";
const marker = (path: string) => `${PREFIX}${JSON.stringify(path)}]`;
const pathImage = (path: string) => ({ kind: "path", path, delivery: "pathText" });
const WINDOWS = 'C:\\Users\\owner\\Pictures\\say "hello".png';
const POSIX = "/home/远程/图片/猫]咪.png";
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PNG = `data:image/png;base64,${PNG_B64}`;

describe("backend path-text display projection", () => {
  it("extracts multiple LF-delimited photos in order, preserving Windows escapes and POSIX Unicode/brackets", () => {
    const result = pathTextImages(`看这两张\n${marker(WINDOWS)}\n${marker(POSIX)}`);
    expect(result).toEqual({ text: "看这两张", images: [pathImage(WINDOWS), pathImage(POSIX)] });
  });

  it.each([WINDOWS, POSIX, "\\\\server\\share\\image.png"])("a standalone canonical absolute path: %s", (path) => {
    expect(pathTextImages(marker(path))).toEqual({ text: "", images: [pathImage(path)] });
  });

  it("preserves surrounding prose and extracts repeated markers without deduplication", () => {
    expect(pathTextImages(`before\n${marker(POSIX)}\nmiddle\n${marker(POSIX)}\nafter`)).toEqual({
      text: "before\nmiddle\nafter", images: [pathImage(POSIX), pathImage(POSIX)],
    });
  });

  const unchanged: [string, string][] = [
    ["ordinary text", "look at /home/owner/a.png"],
    ["invalid JSON", `${PREFIX}"/home/a.png]`],
    ["unescaped Windows backslashes", `${PREFIX}"C:\\Users\\owner\\a.png"]`],
    ["JSON object", `${PREFIX}{"path":"/home/a.png"}]`],
    ["JSON array", `${PREFIX}["/home/a.png"]]`],
    ["JSON null", `${PREFIX}null]`],
    ["noncanonical JSON whitespace", `${PREFIX} ${JSON.stringify(POSIX)}]`],
    ["noncanonical slash escape", `${PREFIX}"\\/home/a.png"]`],
    ["noncanonical Unicode escape", `${PREFIX}"/home/\\u0061.png"]`],
    ["relative path", marker("images/a.png")],
    ["drive-relative path", marker("C:a.png")],
    ["home-relative path", marker("~/a.png")],
    ["file URL", marker("file:///home/a.png")],
    ["inline prefix", `see ${marker(POSIX)}`],
    ["inline suffix", `${marker(POSIX)} please`],
    ["quoted marker", `"${marker(POSIX)}"`],
    ["blockquote", `> ${marker(POSIX)}`],
    ["inline code", `\`${marker(POSIX)}\``],
    ["leading space", ` ${marker(POSIX)}`],
    ["trailing space", `${marker(POSIX)} `],
    ["altered backend wording", marker(POSIX).replace("use your image-reading tool", "use an image-reading tool")],
    ["backtick fenced example", `\`\`\`text\n${marker(POSIX)}\n\`\`\``],
    ["tilde fenced example", `~~~text\n${marker(POSIX)}\n~~~`],
    ["unclosed fence", `\`\`\`\n${marker(POSIX)}`],
  ];
  it.each(unchanged)("leaves %s unchanged", (_name, text) => {
    expect(pathTextImages(text)).toEqual({ text, images: [] });
  });

  it("converts a real marker after a fenced example while retaining the example", () => {
    const example = `\`\`\`text\n${marker(WINDOWS)}\n\`\`\``;
    expect(pathTextImages(`${example}\n${marker(POSIX)}`)).toEqual({ text: example, images: [pathImage(POSIX)] });
  });
});

let root: ReturnType<typeof createRoot> | null = null;
let el: HTMLDivElement;
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => {}); };
const thumbs = () => [...el.querySelectorAll<HTMLButtonElement>('[data-testid="image-thumb"]')];
const zoom = () => document.body.querySelector<HTMLElement>('[data-testid="message-image-zoom"]');
const badges = () => [...el.querySelectorAll<HTMLElement>("[title]")].filter((element) => element.textContent === "image.pathText");
function renderPaths(paths = [POSIX]) {
  const parsed = pathTextImages(paths.map(marker).join("\n"));
  act(() => root!.render(h("div", null, parsed.text, h(MessageImages, { images: parsed.images, hostId: "remote-host", messageId: "path-text-message" }))));
}

describe("path-text images use the shared message thumbnail and remote host read", () => {
  beforeEach(() => {
    resetThumbnailCache();
    host.fsRead = true;
    host.hostApi.mockReset();
    host.hostFile.mockReset();
    host.hostFile.mockResolvedValue({ encoding: "base64", content: PNG_B64, mime: "image/png", size: 70, truncated: false });
    el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    el.remove();
    resetThumbnailCache();
  });

  it("reads both images with the send cap on their remote host and opens the same ImageZoom", async () => {
    renderPaths([WINDOWS, POSIX]);
    await flush();
    expect(host.hostApi).toHaveBeenCalledWith("remote-host");
    expect(host.hostApi.mock.calls.every(([hostId]) => hostId === "remote-host")).toBe(true);
    expect(host.hostFile).toHaveBeenCalledTimes(2);
    expect(host.hostFile).toHaveBeenCalledWith(WINDOWS, MAX_IMAGE_BYTES);
    expect(host.hostFile).toHaveBeenCalledWith(POSIX, MAX_IMAGE_BYTES);
    expect(thumbs().map((thumb) => thumb.querySelector("img")!.getAttribute("src"))).toEqual([PNG, PNG]);
    expect(badges().map((badge) => badge.title)).toEqual([WINDOWS, POSIX]);
    expect(el.textContent).not.toContain(PREFIX);
    expect(el.querySelector('[data-testid="message-image-chip"]')).toBeNull();
    act(() => thumbs()[1]!.click());
    expect(zoom()!.querySelector("img")!.getAttribute("src")).toBe(PNG);
    act(() => zoom()!.click());
    expect(zoom()).toBeNull();
  });

  it.each([403, 404])("keeps the badge and replaces an HTTP %s read failure with the path-text unavailable message", async (status) => {
    host.hostFile.mockRejectedValue(Object.assign(new Error(`HTTP ${status}`), { status }));
    renderPaths();
    await flush();
    expect(host.hostFile).toHaveBeenCalledWith(POSIX, MAX_IMAGE_BYTES);
    expect(thumbs()).toHaveLength(0);
    expect(el.textContent).toContain("image.pathTextUnavailable");
    expect(badges().map((badge) => badge.title)).toEqual([POSIX]);
    expect(el.textContent).not.toContain(PREFIX);
  });

  it("without fs-file-read shows unavailable with its badge and does not read any host file", async () => {
    host.fsRead = false;
    renderPaths();
    await flush();
    expect(host.hostFile).not.toHaveBeenCalled();
    expect(thumbs()).toHaveLength(0);
    expect(el.textContent).toContain("image.pathTextUnavailable");
    expect(badges().map((badge) => badge.title)).toEqual([POSIX]);
    expect(el.textContent).not.toContain(PREFIX);
  });

  it("a browser image decode failure keeps the badge and shows unavailable without the raw marker", async () => {
    // jsdom does not decode images: dispatch the error the browser emits for corrupt bytes.
    host.hostFile.mockResolvedValue({ encoding: "base64", content: btoa("corrupt image"), mime: "image/png", size: 13, truncated: false });
    renderPaths();
    await flush();
    expect(thumbs()).toHaveLength(1);
    act(() => thumbs()[0]!.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(thumbs()).toHaveLength(0);
    expect(el.textContent).toContain("image.pathTextUnavailable");
    expect(badges().map((badge) => badge.title)).toEqual([POSIX]);
    expect(el.textContent).not.toContain(PREFIX);
    expect(zoom()).toBeNull();
  });
});
