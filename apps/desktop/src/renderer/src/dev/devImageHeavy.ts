// Deterministic, synthetic image history. No network, filesystem or owner data.
// ?imageheavy=300&heavyMode=mixed|refs|inline&heavyTurns=60&heavyTransport=direct|clone|json
import type { HistoryMediaPayload } from "../../../shared/ipc";

const query = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
export const IMAGE_HEAVY = query.has("imageheavy");
export const IMAGE_HEAVY_SESSION = "demo-done";
const count = Math.min(1000, Math.max(0, Number(query.get("imageheavy")) || 0));
const turns = Math.min(200, Math.max(1, Number(query.get("heavyTurns")) || 60));
const mode = query.get("heavyMode") || "mixed";
const transport = query.get("heavyTransport") || "direct";
type Image = { bytes: Uint8Array; url: string; sha: string; path: string };
let prepared: Promise<void> | null = null;
let thread: { id: string; turns: { id: string; [key: string]: unknown }[] } | null = null;
const images: Image[] = [];
const calls: { kind: string; ms: number; bytes: number }[] = [];
const metrics = { count, turns, mode, transport, width: 1024, height: 1024, encodedBytes: 0, minBytes: Infinity, maxBytes: 0, inlineChars: 0, prepareMs: 0, calls };
const descriptor = (image: Image) => ({ type: "cutexBlob", blobId: image.sha, sha256: image.sha, mime: "image/jpeg", size: image.bytes.length, width: 1024, height: 1024, url: `cutex-blob:${IMAGE_HEAVY_SESSION}/${image.sha}` });

export function prepareImageHeavy(): Promise<void> {
  if (!IMAGE_HEAVY) return Promise.resolve();
  prepared ??= (async () => {
    const start = performance.now();
    const canvas = new OffscreenCanvas(1024, 1024), context = canvas.getContext("2d")!;
    for (let i = 0; i < count; i++) {
      const pixels = context.createImageData(1024, 1024);
      let seed = (i + 1) * 2654435761 >>> 0;
      for (let p = 0; p < pixels.data.length; p += 4) {
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        const n = seed >>> 24, x = (p / 4) % 1024, y = Math.floor(p / 4096);
        pixels.data[p] = (x / 8 + n / 2 + i * 13) % 256;
        pixels.data[p + 1] = (y / 8 + n / 2 + i * 7) % 256;
        pixels.data[p + 2] = (128 + n / 2 + i * 3) % 256;
        pixels.data[p + 3] = 255;
      }
      context.putImageData(pixels, 0, 0);
      context.fillStyle = "#10243b"; context.fillRect(20, 20, 984, 100);
      context.fillStyle = "white"; context.font = "bold 48px sans-serif";
      context.fillText(`Synthetic image ${i + 1} / ${count}`, 40, 85);
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
      const url = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob); });
      images.push({ bytes, url, sha, path: `/synthetic/image-heavy/${i}.jpg` });
      metrics.encodedBytes += bytes.length; metrics.minBytes = Math.min(metrics.minBytes, bytes.length); metrics.maxBytes = Math.max(metrics.maxBytes, bytes.length);
      // Yield between encodes: fixture setup is explicitly outside the opening measurement.
      if (i % 10 === 9) await new Promise(resolve => setTimeout(resolve, 0));
    }
    thread = { id: `thread-${IMAGE_HEAVY_SESSION}`, turns: Array.from({ length: turns }, (_, turn) => {
      const items: Record<string, unknown>[] = [{ type: "userMessage", id: `heavy-u-${turn}`, content: [{ type: "text", text: `Synthetic image batch ${turn + 1}: compare composition and colours.` }] }];
      const content = items[0]!.content as unknown[];
      for (let i = Math.floor(turn * count / turns); i < Math.floor((turn + 1) * count / turns); i++) {
        const image = images[i]!, route = i % 5;
        const inline = mode === "inline" || (mode === "mixed" && [0, 2, 3].includes(route));
        if (inline) metrics.inlineChars += image.url.length;
        const value = inline ? image.url : descriptor(image);
        if (route < 2) content.push(route === 1 && mode !== "inline" ? { type: "localImage", path: image.path } : { type: "image", url: value });
        else if (route === 2) items.push({ type: "mcpToolCall", id: `heavy-tool-${i}`, server: "synthetic", tool: "render_image", status: "completed", arguments: { index: i }, result: { content: [{ type: "image", mimeType: "image/jpeg", data: inline ? image.url.slice(image.url.indexOf(",") + 1) : value }] } });
        else items.push({ type: "imageGeneration", id: `heavy-gen-${i}`, status: "completed", revisedPrompt: `Synthetic result ${i}`, result: inline ? image.url.slice(image.url.indexOf(",") + 1) : value });
      }
      items.push({ type: "agentMessage", id: `heavy-a-${turn}`, text: `Batch ${turn + 1} complete. All images in this fixture are generated locally for benchmarking.` });
      return { id: `heavy-turn-${turn}`, status: "completed", startedAt: 1792800000 + turn * 60, completedAt: 1792800040 + turn * 60, items };
    }) };
    metrics.prepareMs = performance.now() - start;
    if (!count) metrics.minBytes = 0;
  })();
  return prepared;
}

export function imageHeavyThread() { return thread; }
export function imageHeavyResponse<T>(value: T, kind: string): T {
  const start = performance.now();
  const result = transport === "json" ? JSON.parse(JSON.stringify(value)) as T : transport === "clone" ? structuredClone(value) : value;
  calls.push({ kind, ms: performance.now() - start, bytes: 0 });
  return result;
}
export async function imageHeavyMedia(session: string, sha: string): Promise<HistoryMediaPayload | null> {
  if (!IMAGE_HEAVY || session !== IMAGE_HEAVY_SESSION) return null;
  const start = performance.now(), image = images.find(image => image.sha === sha);
  if (!image) return null;
  calls.push({ kind: "eventBlob", ms: performance.now() - start, bytes: image.bytes.length });
  return { bytes: image.bytes.slice(), mime: "image/jpeg", size: image.bytes.length };
}
export function imageHeavyFile(path: string) {
  if (!IMAGE_HEAVY || !path.startsWith("/synthetic/image-heavy/")) return null;
  const image = images[Number(path.split("/").pop()?.split(".")[0])];
  if (!image) return null;
  calls.push({ kind: "hostFile", ms: 0, bytes: image.bytes.length });
  return { path, size: image.bytes.length, modifiedAt: "2026-10-26T00:00:00Z", encoding: "base64" as const, content: image.url.slice(image.url.indexOf(",") + 1), truncated: false, mime: "image/jpeg" };
}
if (IMAGE_HEAVY) Object.assign(window, { __imageHeavy: { prepare: prepareImageHeavy, metrics, resetCalls: () => { calls.length = 0; } } });
