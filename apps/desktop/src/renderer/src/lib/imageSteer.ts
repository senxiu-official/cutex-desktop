// Images in steers (cutex `image-input-steering`, r264). A busy agent queues an ordinary send with images
// by default (the host setting `imageInput.busyBehavior`); the original image goes out when the turn ends
// (cutex does this; the desktop never steers it on its own). An explicit 插话 (Ctrl+Enter, the queue row's
// 插话, a drop onto the turn, owner join) inserts it: Claude as the image's file path on the target host
// (`pathText`), Codex the image itself (`nativeImage`); a runtime that declares `unsupported` refuses and
// the message stays queued. Without the feature (older cutex) nothing here changes today's behaviour.
// Pure (no React, no store).
import type { GlobalSettings, ImageBusyBehavior, ImageDelivery } from "../../../shared/ipc";
export { imageDeliveryOf } from "../../../shared/imageDelivery";

export const IMAGE_INPUT_STEERING_FEATURE = "image-input-steering";

/** A session's image steering: `native.schema.capabilities.features.imageInputSteering` (Kestrel's correction 2026-10-26;
 *  the draft's `capabilities.imageInput` was a wrong path, and `capabilities.features.imageInput` stays the old boolean
 *  "accepts images at all" — never read as steering). */
export type ImageSteering = "pathText" | "nativeImage" | "unsupported";

type ResourceLike = { native?: { schema?: { capabilities?: unknown } | null } | null } | null | undefined;

/** The session's declared image steering; null = not declared (older cutex, schema not loaded). */
export function imageSteeringOf(resource: ResourceLike): ImageSteering | null {
  const caps = resource?.native?.schema?.capabilities as { features?: { imageInputSteering?: unknown } | null } | null | undefined;
  // The object ({busyBehaviorDefault, steering, requiresTargetHostPath}) or, should cutex flatten it, the mode itself.
  const raw = caps?.features?.imageInputSteering;
  const v = typeof raw === "string" ? raw : (raw as { steering?: unknown } | null | undefined)?.steering;
  return v === "pathText" || v === "nativeImage" || v === "unsupported" ? v : null;
}

/**
 * What an explicit steer with images can do on this agent: null without the host feature (today's
 * behaviour) or while the session declares nothing (cutex decides; its refusal is shown).
 */
export function imageSteerMode(features: { has(feature: string): boolean }, resource: ResourceLike): ImageSteering | null {
  return features.has(IMAGE_INPUT_STEERING_FEATURE) ? imageSteeringOf(resource) : null;
}

/** Input items carry an image (`image` data / URL or `localImage` host path). */
export function hasImageInput(items: readonly unknown[] | null | undefined): boolean {
  return (items ?? []).some((x) => {
    const t = (x as { type?: unknown } | null)?.type;
    return t === "image" || t === "localImage";
  });
}

/**
 * The composer's explicit 插话 (Ctrl+Enter) of a draft while a turn runs:
 * - `plain`: submit `auto` as always (no images, idle, or a host without the feature).
 * - `queueThenSteer`: submit `auto` (cutex queues it by default) and, when it lands queued, steer that
 *   queue item (`cutex/userInput/queue/steer`, same clientUserMessageId; never starts a turn).
 * - `refuse`: the runtime cannot insert images into a running turn: queue it and say so.
 */
export type DraftSteerPlan = "plain" | "queueThenSteer" | "refuse";

export function draftSteerPlan(ctx: { feature: boolean; busy: boolean; images: boolean; mode: ImageSteering | null }): DraftSteerPlan {
  if (!ctx.feature || !ctx.busy || !ctx.images) return "plain";
  return ctx.mode === "unsupported" ? "refuse" : "queueThenSteer";
}

/** A queued item with images refused locally before any request (the runtime declares `unsupported`). */
export function refusesImageSteer(mode: ImageSteering | null, input: readonly unknown[]): boolean {
  return mode === "unsupported" && hasImageInput(input);
}

/** `imageInput.busyBehavior` of a `/v2/settings` view; undefined = older cutex / not loaded (cutex default: queue). */
export function readImageBusyBehavior(settings: Pick<GlobalSettings, "imageInput"> | null | undefined): ImageBusyBehavior | undefined {
  const v = settings?.imageInput?.busyBehavior;
  return v === "queue" || v === "steer" ? v : undefined;
}

/** The PATCH body for the host setting. */
export function imageBusyPatch(busyBehavior: ImageBusyBehavior): Pick<GlobalSettings, "imageInput"> {
  return { imageInput: { busyBehavior } };
}

/** Receipt text key of a confirmed insert with images; null when cutex sent no receipt (nothing is said). */
export function imageDeliveryKey(delivery: ImageDelivery | null | undefined): "queue.insert.pathText" | "queue.insert.nativeImage" | null {
  return delivery === "pathText" ? "queue.insert.pathText" : delivery === "nativeImage" ? "queue.insert.nativeImage" : null;
}
