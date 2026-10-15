/** A square crop in source-image pixels. Position is the normalized crop centre. */
export type CropPosition = { x: number; y: number; zoom: number };
export const INITIAL_CROP: CropPosition = { x: 0.5, y: 0.5, zoom: 1 };

export function squareCrop(width: number, height: number, position: CropPosition) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error("Invalid image dimensions");
  const zoom = Number.isFinite(position.zoom) ? Math.max(1, Math.min(4, position.zoom)) : 1;
  const size = Math.min(width, height) / zoom;
  const x = Number.isFinite(position.x) ? position.x : 0.5;
  const y = Number.isFinite(position.y) ? position.y : 0.5;
  return { x: Math.max(0, Math.min(width - size, x * width - size / 2)), y: Math.max(0, Math.min(height - size, y * height - size / 2)), size };
}

/** Apply the same crop as the preview, releasing the decoded image even if canvas fails. */
export async function croppedPicture(file: Blob, position: CropPosition, px: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const crop = squareCrop(bitmap.width, bitmap.height, position);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, px, px);
    return canvas.toDataURL("image/webp", 0.9);
  } finally {
    bitmap.close();
  }
}
