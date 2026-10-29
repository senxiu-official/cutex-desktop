import type { CSSProperties } from "react";
import { mediaDimensions } from "../../../shared/mediaBlobs";
import type { MessageImage } from "../../../shared/input";

export type ImageBounds = { maxWidth?: number; maxHeight?: number };
export function imageDimensions(image: MessageImage) {
  return image.kind === "blob" ? mediaDimensions(image.blob) : undefined;
}
/** One responsive border box is shared by the placeholder and decoded image. */
export function imageBox(dimensions: { width: number; height: number } | undefined, bounds: ImageBounds = {}): CSSProperties | undefined {
  if (!dimensions) return undefined;
  const { width, height } = dimensions;
  const scale = Math.min(1, (bounds.maxWidth ?? width) / width, (bounds.maxHeight ?? 320) / height);
  return { width: `min(100%, ${width * scale}px)`, aspectRatio: `${width} / ${height}`, height: "auto", minWidth: 0, minHeight: 0, maxWidth: "100%", position: "relative", flexShrink: 0 };
}
export function zoomImageBox(dimensions: { width: number; height: number } | undefined): CSSProperties | undefined {
  if (!dimensions) return undefined;
  const { width, height } = dimensions;
  return { width: `min(${width}px, calc(100vw - 4rem), calc((100dvh - 4rem) * ${width / height}))`, aspectRatio: `${width} / ${height}`, position: "relative" };
}
