// image-input-steering (r264): the optional `imageDelivery` receipt cutex adds to a submit / queue-steer
// success and to `cutex/userInput/submitted` — only when the native really accepted the images. Read
// defensively (the protocol package does not declare it); anything else = no receipt, never a guess.
import type { ImageDelivery } from "./ipc";

export function imageDeliveryOf(value: unknown): ImageDelivery | undefined {
  const v = (value as { imageDelivery?: unknown } | null | undefined)?.imageDelivery;
  return v === "pathText" || v === "nativeImage" ? v : undefined;
}
