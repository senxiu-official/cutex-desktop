// Pasted / dropped images → data: URLs within the size cap (downscaled when too large). Browser-only.
import { MAX_IMAGE_BYTES } from "../../../shared/ipc";
import { dataUrlBytes } from "../../../shared/input";

const MAX_DIM = 2048;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("not an image"));
    img.src = url;
  });
}

/** Re-encode as JPEG, longest side ≤ MAX_DIM, stepping quality down until it fits. */
async function downscale(url: string, maxBytes: number): Promise<string | null> {
  const img = await loadImage(url);
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const q of [0.9, 0.8, 0.65, 0.5]) {
    const out = canvas.toDataURL("image/jpeg", q);
    if (dataUrlBytes(out) <= maxBytes) return out;
  }
  return null;
}

const SENDABLE = /^data:image\/(png|jpeg|gif|webp|bmp);base64,/;

/** null = could not be made to fit / not an image. `maxBytes`: the agent's limit (Claude 5 MB). */
export async function imageFileToDataUrl(file: Blob, maxBytes = MAX_IMAGE_BYTES): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  const limit = Math.min(maxBytes, MAX_IMAGE_BYTES);
  const url = await readAsDataUrl(file);
  if (SENDABLE.test(url) && dataUrlBytes(url) <= limit) return url;
  try {
    return await downscale(url, limit);
  } catch {
    return null;
  }
}
