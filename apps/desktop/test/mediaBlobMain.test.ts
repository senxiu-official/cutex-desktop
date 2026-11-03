import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { imageActionBytes, mediaReadRequest } from "../src/main/eventMedia";
const fixture = vi.hoisted(() => ({ clients: [] as any[], feeds: [] as any[], write: vi.fn(), save: vi.fn(), copy: vi.fn(), decode: vi.fn(), features: [] as string[], blobAlias: false }));
vi.mock("node:fs/promises", async original => ({ ...(await original<object>()), writeFile: fixture.write }));
vi.mock("electron", () => ({ app: {}, BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
  dialog: { showSaveDialog: fixture.save }, shell: {}, clipboard: { write: fixture.copy },
  ClipboardItem: class { constructor(public items: unknown) {} }, nativeImage: { createFromBuffer: fixture.decode } }));
vi.mock("../src/main/errorLog", () => ({ logError: vi.fn() }));
vi.mock("@cutex-desktop/cutex-client", () => ({
  LIVE_DELTAS_FEATURE: "live-text-deltas",
  CutexClient: class {
    constructor(public endpoint: unknown) { fixture.clients.push(this); }
    historyMedia = vi.fn(); eventBlob = vi.fn();
    uploadAttachment = vi.fn(async () => ({ path: "/remote/image.png" }));
    submitInput = vi.fn(async () => ({ accepted: true }));
    bootstrap = vi.fn(async () => ({}));
    capabilities = vi.fn(async () => ({ hostId: "h", featureList: fixture.features, eventMediaBlobs: fixture.blobAlias }));
    host() { return new Promise(() => {}); }
  }, CutexApiError: class extends Error {}, CutexUnreachableError: class extends Error {},
  EventFeed: class { constructor(_client: unknown, public handlers: any) { fixture.feeds.push(this); } start=vi.fn(); stop=vi.fn(); }, openStream: vi.fn(),
  userAccessOf: () => ({ isOwner: true }),
}));
import { DaemonService } from "../src/main/daemon";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
const sha = "a".repeat(64), bytes = new Uint8Array(Buffer.from(png, "base64")), expected = { mime: "image/png", size: bytes.length };
const payload = () => ({ bytes, ...expected });
let service: DaemonService;
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
const switchTo = (host = "a", remote = true) => {
  service.useEndpoint({ baseUrl: `http://${host}.invalid`, token: "fixture" } as any, { remote });
  const client = fixture.clients.at(-1); client.historyMedia.mockResolvedValue(payload()); client.eventBlob.mockResolvedValue(payload()); return client;
};
function gate<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
beforeEach(() => {
  fixture.clients.length = 0; fixture.feeds.length = 0; fixture.features = []; fixture.blobAlias = false;
  fixture.write.mockReset().mockResolvedValue(undefined); fixture.copy.mockReset().mockResolvedValue(undefined); fixture.save.mockReset().mockResolvedValue({ canceled: true });
  fixture.decode.mockReset().mockReturnValue({ isEmpty: () => false, toPNG: () => Buffer.from(png, "base64") });
  service = new DaemonService(() => {});
});
afterEach(() => { service.stop(); Object.defineProperty(process, "platform", originalPlatform); });

it("uses distinct authenticated client methods and returns typed bytes without constructing data URLs", async () => {
  const client = switchTo();
  expect(await service.historyMedia("cutex.s1", sha, expected)).toEqual(payload());
  expect(client.historyMedia).toHaveBeenCalledWith("cutex.s1", sha, { transport: "bytes", expected });
  expect(await service.eventBlob("cutex.s1", sha, expected)).toEqual(payload());
  expect(client.eventBlob).toHaveBeenCalledWith("cutex.s1", sha, expected);
  expect(await service.historyMedia("cutex.s1", sha)).not.toHaveProperty("dataUrl");
});

it("accepts legacy history payloads without routing new blobs back to owner media", async () => {
  const client = switchTo();
  client.historyMedia.mockResolvedValue({ contentType: "image/png", data: "iVBORw==" });
  expect(await service.historyMedia("cutex.s1", sha)).toEqual({ dataUrl: "data:image/png;base64,iVBORw==" });
  client.eventBlob.mockResolvedValue(null);
  expect(await service.eventBlob("cutex.s1", sha)).toBeNull();
  expect(client.historyMedia).toHaveBeenCalledTimes(1);
});

it("rejects invalid session/hash/metadata before any network method", async () => {
  const client = switchTo();
  for (const args of [["../other", sha], ["cutex.s1", "A".repeat(64)], ["cutex.s1", sha, { ...expected, url: "https://bad.invalid" }]])
    await expect(service.eventBlob(...args as [string, string, any])).rejects.toThrow("invalid_media_reference");
  expect(client.eventBlob).not.toHaveBeenCalled();
  expect(() => mediaReadRequest("cutex.s1", sha, { mime: "text/html", size: Infinity })).toThrow();
});

it("rejects stale read replies after A to B to A reconnects", async () => {
  const client = switchTo(), pending = gate<ReturnType<typeof payload>>();
  client.eventBlob.mockReturnValue(pending.promise);
  const read = service.eventBlob("cutex.s1", sha);
  switchTo("b"); switchTo("a"); pending.resolve(payload());
  await expect(read).rejects.toThrow("host switched");
});

it("recognizes r258 capability alone when requesting reference history", async () => {
  const client = switchTo(); fixture.features = ["event-media-blobs"];
  await service.capabilities(); await service.bootstrap("cutex.s1", 3);
  expect(client.bootstrap).toHaveBeenCalledWith("cutex.s1", { turnLimit: 3, mediaRefs: true });
});

it.each(["flag", "camel"])("normalizes %s capability aliases without mutating the host reply", async alias => {
  const client = switchTo(); fixture.features = alias === "camel" ? ["eventMediaBlobs"] : []; fixture.blobAlias = alias === "flag";
  const original = await client.capabilities();
  const caps = await service.capabilities();
  expect(caps?.featureList).toContain("event-media-blobs");
  expect(original.featureList).not.toContain("event-media-blobs");
});

it.each(["blob", "media"] as const)("resolves %s references through the bound source session then uploads bytes to the target", async kind => {
  const client = switchTo();
  const url = `cutex-${kind === "blob" ? "blob" : "media"}:cutex.source/${sha}`;
  await service.submit("cutex.target", "", "auto", false, { extra: [{ type: "image", url }] });
  expect(kind === "blob" ? client.eventBlob : client.historyMedia).toHaveBeenCalled();
  expect(kind === "blob" ? client.historyMedia : client.eventBlob).not.toHaveBeenCalled();
  expect(client.uploadAttachment).toHaveBeenCalledWith("cutex.target", bytes, "image/png");
  expect(client.submitInput.mock.calls[0]![1]).toEqual([{ type: "localImage", path: "/remote/image.png" }]);
});

it("uploads local resend bytes and leaves source params unchanged", async () => {
  const client = switchTo("local", false), extra = [{ type: "image" as const, url: `cutex-blob:cutex.s1/${sha}` }];
  await service.submit("cutex.target", "", "auto", false, { extra });
  expect(client.uploadAttachment).toHaveBeenCalledWith("cutex.target", bytes, "image/png");
  expect(client.submitInput.mock.calls[0]![1]).toEqual([{ type: "localImage", path: "/remote/image.png" }]);
  expect(extra[0]!.url).toMatch(/^cutex-blob:/);
});

it("refuses a missing or stale resend rather than silently sending text-only input", async () => {
  const client = switchTo(); client.eventBlob.mockResolvedValue(null);
  await expect(service.submit("cutex.target", "text", "auto", false, { extra: [{ type: "image", url: `cutex-blob:cutex.s1/${sha}` }] })).rejects.toThrow("image_unavailable");
  expect(client.submitInput).not.toHaveBeenCalled();
  const pending = gate<ReturnType<typeof payload>>(); client.eventBlob.mockReturnValue(pending.promise);
  const send = service.submit("cutex.target", "", "auto", false, { extra: [{ type: "image", url: `cutex-blob:cutex.s1/${sha}` }] });
  await Promise.resolve(); switchTo("b"); pending.resolve(payload());
  await expect(send).rejects.toThrow("host switched");
  expect(client.uploadAttachment).not.toHaveBeenCalled();
});

it("copies a validated image through the native clipboard, with no file or URL input", async () => {
  const client = switchTo();
  expect(await service.imageAction({ kind: "blob", sessionId: "cutex.s1", sha256: sha, ...expected }, "copy")).toEqual({ status: "copied" });
  expect(client.eventBlob).toHaveBeenCalledWith("cutex.s1", sha, expected);
  expect(fixture.copy).toHaveBeenCalledOnce(); expect(fixture.save).not.toHaveBeenCalled();
  const clipboardPng = fixture.copy.mock.calls[0]![0][0].items["image/png"] as Blob;
  expect(clipboardPng.type).toBe("image/png");
  expect(new Uint8Array(await clipboardPng.arrayBuffer())).toEqual(bytes);
  expect(fixture.write).not.toHaveBeenCalled();
});

it("copies a JPEG blob as PNG through the session's blob read (Copy image in the lightbox)", async () => {
  const client = switchTo(), jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  client.eventBlob.mockResolvedValue({ bytes: jpeg, mime: "image/jpeg", size: jpeg.length });
  expect(await service.imageAction({ kind: "blob", sessionId: "cutex.s1", sha256: sha, mime: "image/jpeg", size: jpeg.length }, "copy")).toEqual({ status: "copied" });
  expect(client.eventBlob).toHaveBeenCalledWith("cutex.s1", sha, { mime: "image/jpeg", size: jpeg.length });
  expect(new Uint8Array(fixture.decode.mock.calls[0]![0])).toEqual(jpeg);
  const written = fixture.copy.mock.calls[0]![0][0].items["image/png"] as Blob;
  expect(new Uint8Array(await written.arrayBuffer())).toEqual(bytes);
});

it("saves original bytes only to the native dialog's selected path and handles cancellation", async () => {
  switchTo(); fixture.save.mockResolvedValueOnce({ canceled: false, filePath: "/fixture/image.png" });
  expect(await service.imageAction({ kind: "media", sessionId: "cutex.s1", sha256: sha }, "save")).toEqual({ status: "saved" });
  expect(fixture.write).toHaveBeenCalledWith("/fixture/image.png", bytes);
  expect(await service.imageAction({ kind: "media", sessionId: "cutex.s1", sha256: sha }, "save")).toEqual({ status: "cancelled" });
  expect(fixture.write).toHaveBeenCalledOnce();
});

it.each([
  ["image/png", "png", bytes],
  ["image/jpeg", "jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4])],
  ["image/webp", "webp", new Uint8Array(Buffer.from("RIFF0000WEBP", "ascii"))],
] as const)("offers a suffixed native image default and undotted %s filter", async (mime, extension, original) => {
  Object.defineProperty(process, "platform", { ...originalPlatform, value: "darwin" });
  const client = switchTo();
  client.historyMedia.mockResolvedValue({ bytes: original, mime, size: original.length });
  // A native panel may return the owner's bare name. Do not redirect that confirmed target.
  fixture.save.mockResolvedValueOnce({ canceled: false, filePath: "/fixture/renamed" });
  expect(await service.imageAction({ kind: "media", sessionId: "cutex.s1", sha256: sha }, "save")).toEqual({ status: "saved" });
  expect(fixture.save).toHaveBeenCalledWith({ defaultPath: `image.${extension}`, filters: [{ name: mime, extensions: [extension] }] });
  expect(fixture.write).toHaveBeenCalledExactlyOnceWith("/fixture/renamed", original);
});

it.each([{ canceled: true, filePath: "/fixture/ignored.png" }, { canceled: false }])("does not save images for an unusable native selection: %j", async result => {
  switchTo(); fixture.save.mockResolvedValueOnce(result);
  expect(await service.imageAction({ kind: "media", sessionId: "cutex.s1", sha256: sha }, "save")).toEqual({ status: "cancelled" });
  expect(fixture.write).not.toHaveBeenCalled();
});

it.each(["report.MD", "report.md", `${"x".repeat(200)}.MD`, "", "a/b:report"])("offers a safe Markdown default for %s without losing or doubling its suffix", async name => {
  Object.defineProperty(process, "platform", { ...originalPlatform, value: "darwin" });
  fixture.save.mockResolvedValueOnce({ canceled: false, filePath: "/fixture/owner-choice" });
  expect(await service.saveMarkdown(name, "# export")).toBe("/fixture/owner-choice");
  const options = fixture.save.mock.calls[0]![0];
  expect(options.defaultPath).toMatch(/\.md$/i);
  expect(options.defaultPath).not.toMatch(/\.md\.md$/i);
  expect(options.defaultPath.length).toBeLessThanOrEqual(120);
  expect(options.defaultPath).not.toMatch(/[\\/:*?"<>|\u0000-\u001f]/);
  expect(options.filters).toEqual([{ name: "Markdown", extensions: ["md"] }]);
  if (name === "report.MD" || name === "report.md") expect(options.defaultPath).toMatch(/^report\.md$/i);
  expect(fixture.write).toHaveBeenCalledExactlyOnceWith("/fixture/owner-choice", "# export", "utf8");
});

it.each([{ canceled: true, filePath: "/fixture/ignored.md" }, { canceled: false }])("does not write Markdown for an unusable native selection: %j", async result => {
  fixture.save.mockResolvedValueOnce(result);
  expect(await service.saveMarkdown("report", "# export")).toBeNull();
  expect(fixture.write).not.toHaveBeenCalled();
});

it("rejects corrupt images and host changes while the save dialog is open", async () => {
  switchTo(); fixture.decode.mockReturnValueOnce({ isEmpty: () => true });
  await expect(service.imageAction({ kind: "blob", sessionId: "cutex.s1", sha256: sha }, "copy")).rejects.toThrow("image_unavailable");
  expect(fixture.copy).not.toHaveBeenCalled();
  const pending = gate<{ canceled: boolean; filePath: string }>(); fixture.save.mockReturnValueOnce(pending.promise);
  const save = service.imageAction({ kind: "blob", sessionId: "cutex.s1", sha256: sha }, "save");
  for (let i=0;i<6;i++) await Promise.resolve();
  switchTo("b"); pending.resolve({ canceled: false, filePath: "/fixture/image.png" });
  await expect(save).rejects.toThrow("host switched"); expect(fixture.write).not.toHaveBeenCalled();
});

it("preserves original GIF bytes instead of re-encoding saved images", async () => {
  const client = switchTo(), gif = new TextEncoder().encode("GIF89a-synthetic-decoded-by-native-fixture");
  client.eventBlob.mockResolvedValue({bytes:gif,mime:"image/gif",size:gif.length});
  fixture.save.mockResolvedValue({canceled:false,filePath:"/fixture/image.gif"});
  await service.imageAction({kind:"blob",sessionId:"cutex.s1",sha256:sha},"save");
  expect(fixture.write).toHaveBeenCalledWith("/fixture/image.gif",gif);
});

it("accepts bounded inline image actions but rejects URL/path/extra-field inputs", async () => {
  switchTo();
  expect(await service.imageAction({ kind: "inline", dataUrl: `data:image/png;base64,${png}` }, "copy")).toEqual({ status: "copied" });
  for (const dataUrl of ["https://example.invalid/image.png", "file:///secret.png", "data:text/html;base64,AAAA", "data:image/png;base64,!!!="])
    await expect(service.imageAction({ kind: "inline", dataUrl }, "save")).rejects.toThrow();
  await expect(service.imageAction({ kind: "inline", dataUrl: "data:image/png;base64,iVBORw==", path: "/secret" } as any, "save")).rejects.toThrow("invalid_image_action");
});

it("keeps blob and legacy media actions separate and checks expected metadata", async () => {
  const read = vi.fn().mockResolvedValue(payload());
  await imageActionBytes({ kind: "blob", sessionId: "cutex.s1", sha256: sha, ...expected }, read);
  expect(read).toHaveBeenCalledWith("cutex.s1", sha, expected, true);
  await expect(imageActionBytes({ kind: "media", sessionId: "cutex.s1", sha256: sha, mime: "image/jpeg" }, read)).rejects.toThrow("image_unavailable");
});

it("coalesces partial-event reloads and does not resync again when the same event replays", async () => {
  const emit = vi.fn(); service = new DaemonService(emit); switchTo();
  const event = (id: string) => ({ cutexSessionId: "cutex.s1", eventId:id, cursor:id, streamId:"stream",
    native:{kind:"notification",message:{method:"item/completed",params:{item:{type:"agentMessage",text:"partial"}},
      _cutexTruncated:{reason:"event_size_limit",resyncRequired:true}}} });
  await service.subscribe("cutex.s1", {streamId:"stream",after:null});
  fixture.feeds.at(-1).handlers.event(event("a"));
  fixture.feeds.at(-1).handlers.event(event("b"));
  await Promise.resolve();
  expect(emit.mock.calls.filter(([name])=>name==="sessionResync")).toHaveLength(1);
  expect(emit.mock.calls.findIndex(([name])=>name==="sessionEvent")).toBeLessThan(emit.mock.calls.findIndex(([name])=>name==="sessionResync"));
  await service.subscribe("cutex.s1", {streamId:"stream",after:"b"});
  fixture.feeds.at(-1).handlers.event(event("a")); await Promise.resolve();
  expect(emit.mock.calls.filter(([name])=>name==="sessionResync")).toHaveLength(1);
  fixture.feeds.at(-1).handlers.event(event("c")); await Promise.resolve();
  expect(emit.mock.calls.filter(([name])=>name==="sessionResync")).toHaveLength(2);
});

it("drops queued partial-event resync when its connection or session is replaced", async () => {
  const emit = vi.fn(); service = new DaemonService(emit); switchTo();
  await service.subscribe("cutex.s1", {streamId:"stream",after:null});
  const old = fixture.feeds.at(-1);
  const event = {cutexSessionId:"cutex.s1",eventId:"a",cursor:"a",streamId:"stream",native:{message:{method:"item/completed",params:{},_cutexTruncated:{reason:"event_size_limit",resyncRequired:true}}}};
  old.handlers.event(event); switchTo("b"); await Promise.resolve();
  expect(emit.mock.calls.filter(([name])=>name==="sessionResync")).toHaveLength(0);
  old.handlers.event(event); await Promise.resolve();
  expect(emit.mock.calls.filter(([name])=>name==="sessionEvent")).toHaveLength(1);
});

it("reloads once more for a newer partial event arriving during an in-flight canonical read", async () => {
  const emit = vi.fn(); service = new DaemonService(emit); switchTo();
  const event = (id: string) => ({cutexSessionId:"cutex.s1",eventId:id,cursor:id,streamId:"stream",native:{message:{method:"item/completed",params:{},_cutexTruncated:{reason:"event_size_limit",resyncRequired:true}}}});
  await service.subscribe("cutex.s1", {streamId:"stream",after:null});
  fixture.feeds.at(-1).handlers.event(event("a")); await Promise.resolve();
  fixture.feeds.at(-1).handlers.event(event("b")); await Promise.resolve();
  expect(emit.mock.calls.filter(([name])=>name==="sessionResync")).toHaveLength(1);
  await service.subscribe("cutex.s1", {streamId:"stream",after:"a"}); await Promise.resolve();
  expect(emit.mock.calls.filter(([name])=>name==="sessionResync")).toHaveLength(2);
  fixture.feeds.at(-1).handlers.event(event("b")); await Promise.resolve();
  await service.subscribe("cutex.s1", {streamId:"stream",after:"b"}); await Promise.resolve();
  expect(emit.mock.calls.filter(([name])=>name==="sessionResync")).toHaveLength(2);
});
