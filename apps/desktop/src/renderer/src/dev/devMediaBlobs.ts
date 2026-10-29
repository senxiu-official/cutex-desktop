// ?mediaBlobs[&perf=quiet][&mediaDelay=milliseconds]: code-drawn images, no external data.
import type { HistoryMediaExpected, HistoryMediaPayload, ImageActionInput, ImageActionResult } from "../../../shared/ipc";
import type { MediaBlobDescriptor } from "../../../shared/mediaBlobs";
import type { MockCore } from "./mockTypes";

export const MEDIA_BLOBS_SCENE = typeof location !== "undefined" && new URLSearchParams(location.search).has("mediaBlobs");
const SESSION = "eva";
type Fixture = { thread: { id: string; turns: { id: string; [key: string]: unknown }[] }; image: MediaBlobDescriptor; bytes: Uint8Array; inline: string };
let prepared: Promise<Fixture> | null = null;
let fixture: Fixture | null = null;

async function graph(): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(640, 320);
  const context = canvas.getContext("2d");
  if (!context) throw Error("mock_media_canvas_unavailable");
  const texture = context.createImageData(640, 320);
  for (let y = 0; y < 320; y++) for (let x = 0; x < 640; x++) {
    const at = (y * 640 + x) * 4, shade = (x * 73 + y * 19 + x * y % 251) % 19;
    texture.data.set([236 + shade, 236 + shade, 236 + shade, 255], at);
  }
  context.putImageData(texture, 0, 0);
  context.fillStyle = "#1e3a5f";
  context.fillRect(0, 0, 640, 48);
  context.fillStyle = "#ffffff"; context.font = "bold 20px sans-serif";
  context.fillText("Native media · sample chart", 24, 31);
  for (let i = 0; i < 8; i++) {
    const height = [62, 100, 84, 141, 118, 172, 156, 192][i]!;
    context.fillStyle = i % 2 ? "#38a9a0" : "#5279ce";
    context.fillRect(38 + i * 72, 277 - height, 40, height);
  }
  context.strokeStyle = "#dc7647"; context.lineWidth = 4; context.beginPath();
  for (let i = 0; i < 8; i++) {
    const y = [204, 170, 184, 131, 151, 98, 119, 76][i]!;
    if (!i) context.moveTo(58, y); else context.lineTo(58 + i * 72, y);
  }
  context.stroke();
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}

/** The same canonical thread is used by bootstrap, history and core.threadRead. */
export function prepareMediaBlobs(): Promise<Fixture> {
  prepared ??= (async () => {
    const bytes = await graph();
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
    const image: MediaBlobDescriptor = { type: "cutexBlob", blobId: hash, sha256: hash, mime: "image/png", size: bytes.byteLength, width: 640, height: 320, url: `cutex-blob:${SESSION}/${hash}` };
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const inline = `data:image/png;base64,${btoa(binary)}`;
    const failed = { ...image, blobId: "f".repeat(64), sha256: "f".repeat(64), url: `cutex-blob:${SESSION}/${"f".repeat(64)}` };
    const generated = (id: string, result: unknown, revisedPrompt: string) => ({ type: "imageGeneration", id, status: "completed", revisedPrompt, result });
    fixture = { bytes, image, inline, thread: { id: `thread-${SESSION}`, turns: [{
      id: "media-blobs-turn", status: "completed", startedAt: 1792800000, completedAt: 1792800001,
      items: [
        { type: "userMessage", id: "media-blobs-prompt", content: [{ type: "text", text: "Compare the legacy inline chart with the generated image and browser screenshot." }, { type: "image", url: inline }] },
        generated("media-blobs-generated", image, "Generated chart"),
        { type: "mcpToolCall", id: "media-blobs-truncated", _cutexTruncated: { reason: "event_size_limit", maxBytes: 262144, resyncRequired: true } },
        { type: "mcpToolCall", id: "media-blobs-browser", server: "cutex", tool: "browser_screenshot", status: "completed", arguments: { title: "Browser chart" }, result: { content: [{ type: "image", mimeType: "image/png", data: image }], isError: false } },
        generated("media-blobs-failed", failed, "Unavailable stored image"),
        generated("media-blobs-unsupported", { type: "imageNotLoaded", mime: "image/svg+xml", reason: "unsupported_media" }, "Unsupported image"),
        generated("media-blobs-oversize", { type: "imageNotLoaded", mime: "image/png", size: 33 * 1024 * 1024, reason: "blob_size_limit" }, "Image beyond the read limit"),
      ],
    }] } };
    return fixture;
  })();
  return prepared;
}

export function mediaBlobsThread(): Fixture["thread"] | null { return fixture?.thread ?? null; }

export async function mockEventBlob(session: string, hash: string, expected?: HistoryMediaExpected): Promise<HistoryMediaPayload | null> {
  if (!MEDIA_BLOBS_SCENE) return null;
  const value = await prepareMediaBlobs();
  if (session !== SESSION || hash !== value.image.sha256) throw Error("mock_event_blob_unavailable");
  if (expected && (expected.mime !== value.image.mime || expected.size !== value.image.size)) throw Error("mock_event_blob_metadata_mismatch");
  const requested = Number(new URLSearchParams(location.search).get("mediaDelay"));
  const delay = Number.isFinite(requested) ? Math.min(30_000, Math.max(0, Math.floor(requested))) : 0;
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  return { bytes: value.bytes.slice(), mime: value.image.mime, size: value.image.size };
}

/** Preview actions acknowledge the UI only: no clipboard or filesystem APIs. */
export async function mockMediaImageAction(input: ImageActionInput, action: "copy" | "save"): Promise<ImageActionResult> {
  if (!MEDIA_BLOBS_SCENE) return { status: "cancelled" };
  const value = await prepareMediaBlobs();
  if (input.kind === "inline") {
    if (input.dataUrl !== value.inline) throw Error("mock_image_unavailable");
  } else {
    await mockEventBlob(input.sessionId, input.sha256,
      input.mime !== undefined && input.size !== undefined ? { mime: input.mime, size: input.size } : undefined);
  }
  return { status: action === "copy" ? "copied" : "saved" };
}

export function installDevMediaBlobs(core: MockCore): void {
  const windowState = window as unknown as { __mediaBlobsReady: boolean; __mediaBlobsError?: string };
  windowState.__mediaBlobsReady = false;
  // Seed before the first automatic onboarding check; update its in-memory
  // state too below in case another module imported it before the bridge.
  localStorage.setItem("cutex-desktop.onboarding", JSON.stringify({ doneRevision: 2, whatsNew: false, lastWhatsNew: "0.2.0", testEveryBuild: false, lastTestBuild: null }));
  const show = async () => {
    await prepareMediaBlobs();
    const [{ useApp }, onboarding] = await Promise.all([import("../store"), import("../lib/onboarding")]);
    onboarding.setTestEveryBuild(false); onboarding.setWhatsNewEnabled(false);
    onboarding.openOnboarding({ kind: "intro" }); onboarding.closeOnboarding("0.2.0");
    for (let attempt = 0; attempt < 100 && !useApp.getState().sidebar; attempt++) await new Promise(resolve => setTimeout(resolve, 50));
    if (!useApp.getState().sidebar) throw Error("mock_media_sidebar_not_ready");
    const eva = core.projectRecords().active.find(s => s.cutexSessionId === SESSION);
    if (eva) eva.runtime.activeTurnId = null;
    core.markIdle(SESSION);
    await useApp.getState().refreshHostSidebar("local");
    await useApp.getState().select(SESSION, "local");
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    // Use the normal jump path so scroll-follow knows this is an intentional
    // reading position, rather than snapping the virtualized rows to the end.
    await (await import("../lib/refServices")).timelineFocusTurn("local", SESSION, "media-blobs-turn", { back: false });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    windowState.__mediaBlobsReady = true;
  };
  void show().catch(() => { windowState.__mediaBlobsError = "mock_media_scene_failed"; });
}
