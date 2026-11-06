import type { CSSProperties } from "react";
import { mediaDimensions } from "../../../shared/mediaBlobs";
import type { MessageImage } from "../../../shared/input";

/** `contentBox`: the bounds cap the picture inside the border, as a message image laid out from its bytes is. */
export type ImageBounds = { maxWidth?: number; maxHeight?: number; contentBox?: boolean };
export function imageDimensions(image: MessageImage) {
  return image.kind === "blob" ? mediaDimensions(image.blob) : image.kind === "path" ? mediaDimensions(image) : undefined;
}
/** One responsive border box is shared by the placeholder and decoded image. */
export function imageBox(dimensions: { width: number; height: number } | undefined, bounds: ImageBounds = {}): CSSProperties | undefined {
  if (!dimensions) return undefined;
  const { width, height } = dimensions;
  const scale = Math.min(1, (bounds.maxWidth ?? width) / width, (bounds.maxHeight ?? 320) / height);
  // Not min(100%, …): a cyclic percentage in the shrink-to-fit image row, which Chrome lays out 0 px wide.
  const box: CSSProperties = { width: `${width * scale}px`, aspectRatio: `${width} / ${height}`, height: "auto", minWidth: 0, minHeight: 0, maxWidth: "100%", position: "relative", flexShrink: 0 };
  return bounds.contentBox ? { ...box, boxSizing: "content-box", padding: 0, justifyContent: "center" } : box;
}
export function zoomImageBox(dimensions: { width: number; height: number } | undefined): CSSProperties | undefined {
  if (!dimensions) return undefined;
  const { width, height } = dimensions;
  return { width: `min(${width}px, calc(100vw - 4rem), calc((100dvh - 4rem) * ${width / height}))`, aspectRatio: `${width} / ${height}`, position: "relative" };
}
