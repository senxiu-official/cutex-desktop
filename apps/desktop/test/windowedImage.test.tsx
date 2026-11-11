// @vitest-environment jsdom
// Artifact images of any size (owner 2026-11-09 「又开始防我了」: a 15 MB image said 图片太大，无法预览): read in the
// content route's windows into one Blob (lib/windowedImage), shown from an object URL revoked on unmount, progress
// while it loads, 仍然打开 only above IMAGE_PREVIEW_PROMPT_BYTES.
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArtifactVersion } from "../src/shared/artifactStore";

const f = vi.hoisted(() => ({ content: vi.fn() }));
vi.mock("../src/renderer/src/modules/app", () => ({ services: { daemonFor: () => ({ artifactStoreContent: f.content }) } }));
vi.mock("../src/renderer/src/i18n", () => ({ useI18n: () => ({ t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key} ${JSON.stringify(vars)}` : key) }) }));
vi.mock("../src/renderer/src/components/SideImage", () => ({ SideImage: ({ src }: { src: string }) => h("img", { src, "data-side-image": "" }) }));
vi.mock("../src/renderer/src/lib/fileActions", () => ({ canRevealLocal: () => false, performFilePathAction: vi.fn() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { loadWindowedImage, IMAGE_PREVIEW_PROMPT_BYTES } = await import("../src/renderer/src/lib/windowedImage");
const { ArtifactImage } = await import("../src/renderer/src/modules/artifacts/ArtifactImage");

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
/** The content route over `bytes`, `win` bytes per window at most. */
const route = (bytes: Uint8Array, win: number) => async (offset: number, maxBytes: number) => {
  const part = bytes.slice(offset, offset + Math.min(maxBytes, win));
  return { encoding: "base64" as const, content: b64(part), truncated: offset + part.length < bytes.length, totalBytes: bytes.length, offset, version: 1, mediaType: "image/png", sha256: null, externalChanged: null };
};

describe("loadWindowedImage", () => {
  it("joins every window into one Blob, reporting progress; a generic type is taken from the bytes", async () => {
    const seen: number[] = [];
    const r = await loadWindowedImage(route(PNG, 6), { size: PNG.length, mime: "application/octet-stream", name: "x.bin", windowBytes: 6, onProgress: (d) => seen.push(d) });
    expect(r.state).toBe("ready");
    if (r.state !== "ready") return;
    expect(r.mime).toBe("image/png");
    expect(new Uint8Array(await r.blob.arrayBuffer())).toEqual(PNG);
    expect(seen).toEqual([6, 12, 18, 21]);
  });

  it("an SVG (text) is one image; bytes that are no image say so; a gone version throws; abort stops between windows", async () => {
    const svg = await loadWindowedImage(async () => ({ encoding: "utf8", content: "<svg xmlns='http://www.w3.org/2000/svg'/>", truncated: false, totalBytes: 42 }), { size: 42, mime: "image/svg+xml", name: "a.svg" });
    expect(svg).toMatchObject({ state: "ready", mime: "image/svg+xml" });
    const text = Uint8Array.from([1, 2, 3, 4]);
    expect(await loadWindowedImage(route(text, 4), { size: 4, mime: "application/octet-stream", name: "a.bin" })).toEqual({ state: "not-image", size: 4 });
    await expect(loadWindowedImage(async () => null, { size: 4, mime: "image/png", name: "a.png" })).rejects.toThrow("unavailable");
    const stop = new AbortController();
    const read = vi.fn(async (o: number, m: number) => { stop.abort(); return route(PNG, 6)(o, m); });
    await expect(loadWindowedImage(read, { size: PNG.length, mime: "image/png", name: "a.png", windowBytes: 6, signal: stop.signal })).rejects.toThrow("aborted");
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("ArtifactImage", () => {
  let root: Root;
  let host: HTMLDivElement;
  const created: string[] = [];
  const revoked: string[] = [];
  beforeEach(() => {
    f.content.mockReset();
    created.length = 0; revoked.length = 0;
    URL.createObjectURL = vi.fn(() => { const u = `blob:x/${created.length}`; created.push(u); return u; });
    URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => { host.remove(); });
  const version = (bytes: number) => ({ artifactId: "af-1", version: 2, ref: "", link: "", storage: "blob" as const, sha256: null, bytes, mediaType: "image/png", sourcePath: "/x/a.png", note: null, producer: { kind: "agent" as const, sessionId: null, displayName: null, runtimeGeneration: null, turnId: null, askId: null, profile: null } as ArtifactVersion["producer"], git: null, createdAt: "" });

  it("a 15 MB image (four windows) shows, and its object URL is revoked when the view leaves", async () => {
    const big = new Uint8Array(15 * 1024 * 1024);
    big.set(PNG);
    f.content.mockImplementation((_id: string, _v: number, o: { offset: number; maxBytes: number }) => route(big, 4 * 1024 * 1024)(o.offset, o.maxBytes));
    await act(async () => root.render(h(ArtifactImage, { hostId: "local", name: "群像.png", typed: "群像.png", version: version(big.length) })));
    for (let i = 0; i < 10 && !host.querySelector("[data-side-image]"); i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(f.content).toHaveBeenCalledTimes(4);
    expect(host.querySelector("[data-side-image]")!.getAttribute("src")).toBe("blob:x/0");
    expect(host.textContent).not.toContain("imageTooLarge");
    act(() => root.unmount());
    expect(revoked).toEqual(["blob:x/0"]);
  });

  it("shows progress while a big image loads", async () => {
    let release!: () => void;
    f.content.mockImplementationOnce(() => new Promise((r) => (release = () => r(route(PNG, 100)(0, 100)))));
    await act(async () => root.render(h(ArtifactImage, { hostId: "local", name: "a.png", typed: "a.png", version: version(64 * 1024 * 1024) })));
    expect(host.querySelector("[data-artifact-image-loading] progress")).not.toBeNull();
    await act(async () => release());
    act(() => root.unmount());
  });

  it("over the prompt size it waits for 仍然打开, then reads", async () => {
    f.content.mockImplementation((_id: string, _v: number, o: { offset: number; maxBytes: number }) => route(PNG, 100)(o.offset, o.maxBytes));
    await act(async () => root.render(h(ArtifactImage, { hostId: "local", name: "a.png", typed: "a.png", version: version(IMAGE_PREVIEW_PROMPT_BYTES + 1) })));
    expect(host.querySelector("[data-artifact-image-ask]")).not.toBeNull();
    expect(f.content).not.toHaveBeenCalled();
    await act(async () => host.querySelector<HTMLButtonElement>("[data-artifact-image-anyway]")!.click());
    expect(f.content).toHaveBeenCalled();
    act(() => root.unmount());
  });
});
