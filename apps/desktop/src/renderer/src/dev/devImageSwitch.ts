// ?imageSwitch[=N][&imageBig]: a Codex agent (Eva) generating N images (default 3; `imageBig`: ~3–4 MB
// noise PNGs), shaped like cutex r263 serves them. Live: `item/completed` imageGeneration whose `result`
// is an event blob descriptor (`cutex-blob:<session>/<sha256 of the bytes>`). History (bootstrap / history
// with media=ref): `result` = `cutex-media:<session>/<sha256 of the base64 text>` (cutex media_refs
// `sha_hex(payload)`). Both are read back through the real CutexClient against an in-page stand-in for
// the two cutex routes, so the preview exercises the client's checks as main does.
// `window.__imageSwitch.generate()` plays the generating turn; then open another agent and come back.
import { CutexClient } from "@cutex-desktop/cutex-client";
import type { HistoryMediaExpected, HistoryMediaPayload } from "../../../shared/ipc";
import type { MediaBlobDescriptor } from "../../../shared/mediaBlobs";
import type { MockCore } from "./mockTypes";

const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
export const IMAGE_SWITCH_SCENE = params.has("imageSwitch");
const COUNT = Math.min(24, Math.max(1, Number(params.get("imageSwitch")) || 3));
const BIG = params.has("imageBig");
const SESSION = "eva";
const THREAD = `thread-${SESSION}`;
type Image = { bytes: Uint8Array; base64: string; refSha: string; blob: MediaBlobDescriptor };
let prepared: Promise<Image[]> | null = null;
let images: Image[] | null = null;
let generated = false;

const hex = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function draw(k: number): Promise<Uint8Array> {
  const size = BIG ? 1024 : 512;
  const canvas = new OffscreenCanvas(size, size);
  const g = canvas.getContext("2d")!;
  if (BIG) {
    // Noise does not compress: ~3–4 MB per PNG, like the owner's generated avatars.
    const data = g.createImageData(size, size);
    for (let i = 0; i < data.data.length; i += 4) data.data.set([(Math.random() * 256) | 0, (Math.random() * 256) | 0, (k * 40 + Math.random() * 60) | 0, 255], i);
    g.putImageData(data, 0, 0);
  } else {
    g.fillStyle = `hsl(${(k * 67) % 360} 55% 55%)`; g.fillRect(0, 0, size, size);
  }
  g.fillStyle = "#fff"; g.font = `bold ${size / 8}px sans-serif`; g.fillText(`avatar ${k + 1}`, size / 10, size / 2);
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}

function prepare(): Promise<Image[]> {
  prepared ??= Promise.all(Array.from({ length: COUNT }, async (_, k) => {
    const bytes = await draw(k);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const base64 = btoa(binary), sha = await hex(bytes);
    const blob: MediaBlobDescriptor = { type: "cutexBlob", blobId: sha, sha256: sha, mime: "image/png", size: bytes.byteLength, url: `cutex-blob:${SESSION}/${sha}` };
    return { bytes, base64, refSha: await hex(new TextEncoder().encode(base64)), blob };
  }));
  return prepared;
}

const item = (k: number, result: unknown) => ({ type: "imageGeneration", id: `img-switch-${k}`, status: "completed", revisedPrompt: `Avatar ${k + 1}`, result, savedPath: `C:/Users/owner/.codex/generated_images/img-switch-${k}.png` });
const prompt = { type: "userMessage", id: "img-switch-prompt", content: [{ type: "text", text: `画 ${COUNT} 张头像。` }] };

/** Eva's thread/read: the prompt, and after the live turn its images as media=ref history. */
export function imageSwitchThread(): { thread: { id: string; turns: { id: string }[] } } | null {
  if (!images) return null;
  const turns = [{ id: "img-switch-t0", status: "completed", startedAt: 1792800000, completedAt: 1792800001, items: [prompt, { type: "agentMessage", id: "img-switch-a0", text: "好的，开始画。" }] }];
  if (generated) turns.push({ id: "img-switch-t1", status: "completed", startedAt: 1792800010, completedAt: 1792800020,
    items: images.map((image, k) => item(k, `cutex-media:${SESSION}/${image.refSha}`)) as never });
  return { thread: { id: THREAD, turns } };
}

/** cutex `GET /v2/sessions/{id}/media/{sha}` and `/blobs/{sha}` as r263 answers them. */
async function cutexRoutes(input: string | URL | Request): Promise<Response> {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const match = /^\/v2\/sessions\/([^/]+)\/(media|blobs)\/([0-9a-f]{64})$/.exec(url.pathname);
  const all = await prepare();
  // The media route tries the event blob store first (byte digests), then the history media cache (text digests).
  const found = match && decodeURIComponent(match[1]!) === SESSION
    ? all.find((image) => image.blob.sha256 === match[3]) ?? (match[2] === "media" ? all.find((image) => image.refSha === match[3]) : undefined)
    : undefined;
  if (!found) return new Response(JSON.stringify({ code: "media_not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  return new Response(new Uint8Array(found.bytes), { status: 200, headers: { "Content-Type": "image/png", "Content-Length": String(found.bytes.byteLength) } });
}
const client = new CutexClient({ baseUrl: "http://cutex.mock.invalid", token: "mock" } as never, { fetch: cutexRoutes as typeof fetch });

/** Every read the scene answered: [route, sha256 prefix, bytes or null]. */
const reads: [string, string, number | null][] = [];
/** DaemonService.historyMedia / eventBlob (main) over the scene's routes. */
export async function imageSwitchMedia(kind: "media" | "blob", sessionId: string, sha256: string, expected?: HistoryMediaExpected): Promise<HistoryMediaPayload | null> {
  const media = kind === "blob" ? await client.eventBlob(sessionId, sha256, expected) : await client.historyMedia(sessionId, sha256, { transport: "bytes", ...(expected ? { expected } : {}) });
  reads.push([kind, sha256.slice(0, 8), media?.size ?? null]);
  return media ? { bytes: media.bytes, mime: media.mime, size: media.size } : null;
}

export function installDevImageSwitch(core: MockCore): void {
  const state = window as unknown as { __imageSwitch: unknown };
  const ready = prepare().then((all) => { images = all; });
  state.__imageSwitch = {
    ready: () => ready.then(() => true),
    reads: () => reads.slice(),
    /** The generating turn, live: each image arrives as an event blob descriptor. */
    async generate(stepMs = 150) {
      await ready;
      const turnId = "img-switch-t1";
      core.markBusy(SESSION, turnId);
      core.nativeEvent(SESSION, "turn/started", { threadId: THREAD, turn: { id: turnId, status: "inProgress", startedAt: Date.now() / 1000 } });
      for (const [k, image] of images!.entries()) {
        core.nativeEvent(SESSION, "item/started", { threadId: THREAD, turnId, item: { type: "imageGeneration", id: `img-switch-${k}`, status: "inProgress", result: "" } });
        await new Promise((r) => setTimeout(r, stepMs));
        core.nativeEvent(SESSION, "item/completed", { threadId: THREAD, turnId, item: item(k, image.blob) });
      }
      generated = true;
      core.nativeEvent(SESSION, "turn/completed", { threadId: THREAD, turn: { id: turnId, status: "completed", completedAt: Date.now() / 1000 } });
      core.markIdle(SESSION);
      return images!.length;
    },
  };
}
