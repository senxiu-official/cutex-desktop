// Authenticated media references; a digest alone never identifies an authorized read.
import { useSyncExternalStore } from "react";
import { parseCutexMediaRef } from "../../../shared/mediaBlobs";
import { invalidateThumbnailHost, ThumbnailUnavailable, type ThumbnailBytes } from "./fileThumbnails";
import { hostApi, useApp } from "../store";
import { captureHostAction, onHostReset } from "./hostSwitch";
import { hostAccessStore } from "./hostAccess";
export const MEDIA_REF_PREFIX = "cutex-media:";
export interface MediaRef { sessionId: string; sha256: string; kind?: "blob" | "media" }
export function parseMediaRef(url: string | null | undefined): MediaRef | null { return parseCutexMediaRef(url); }
const resets = new Map<string, number>(), observed = new Map<string, string>();
const listeners = new Set<() => void>();
function authority(hostId: string): string {
  const state = useApp.getState?.();
  const host = state?.hosts?.hosts.find((item) => item.id === hostId);
  return JSON.stringify([resets.get(hostId) ?? 0, host ? [host.kind, host.conn?.epoch ?? null, host.tokenId ?? null] : null, hostAccessStore.get()[hostId] ?? null]);
}
function publishChanges() {
  let changed = false;
  for (const [host, before] of observed) {
    const after = authority(host);
    if (after !== before) { observed.set(host, after); invalidateThumbnailHost(host); changed = true; }
  }
  if (changed) for (const listener of [...listeners]) listener();
}
onHostReset((host) => {
  resets.set(host, (resets.get(host) ?? 0) + 1);
  invalidateThumbnailHost(host); observed.set(host, authority(host));
  for (const listener of [...listeners]) listener();
});
hostAccessStore.subscribe(publishChanges);
// Stores mocked by an old consumer may provide only the selector hook.
useApp.subscribe?.(publishChanges);
export function mediaAuthorityKey(hostId: string): string { const key = authority(hostId); if (!observed.has(hostId)) observed.set(hostId, key); return key; }
export function useMediaAuthority(hostId: string | null | undefined): string {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => hostId ? mediaAuthorityKey(hostId) : "", () => "");
}
export const mediaKey = (hostId: string, ref: MediaRef) => JSON.stringify([hostId, ref.kind ?? "media", ref.sessionId, ref.sha256, mediaAuthorityKey(hostId)]);
export function captureMediaAuthority(hostId: string): () => boolean {
  const current = captureHostAction(hostId), key = mediaAuthorityKey(hostId);
  return () => current() && key === mediaAuthorityKey(hostId);
}
export async function readHistoryMedia(hostId: string, ref: MediaRef, expected?: { mime: string; size: number }): Promise<ThumbnailBytes> {
  const current = captureMediaAuthority(hostId);
  const api = hostApi(hostId);
  const read = ref.kind === "blob" ? api.eventBlob.bind(api) : api.historyMedia.bind(api);
  const media = expected ? await read(ref.sessionId, ref.sha256, expected) : await read(ref.sessionId, ref.sha256);
  if (!current()) throw Error("media_authority_changed");
  if (media && "bytes" in media) {
    const bytes = media.bytes instanceof Uint8Array ? media.bytes : new Uint8Array(media.bytes);
    if (bytes.byteLength !== media.size || media.size <= 0 || media.size > 32 * 1024 * 1024 || (expected && (expected.size !== media.size || expected.mime !== media.mime))) throw new ThumbnailUnavailable("media_invalid");
    return { encoding: "bytes", bytes, mime: media.mime, size: media.size, truncated: false };
  }
  const match = media && /^data:([^;,]+);base64,(.*)$/s.exec(media.dataUrl);
  if (!match) throw new ThumbnailUnavailable("media_not_found");
  const content = match[2]!, size = Math.floor(content.length * 3 / 4) - (content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0);
  if (expected && (expected.mime !== match[1] || expected.size !== size)) throw new ThumbnailUnavailable("media_invalid");
  if (size <= 0 || size > 32 * 1024 * 1024) throw new ThumbnailUnavailable("media_invalid");
  const decoded = atob(content), bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
  return { encoding: "bytes", bytes, mime: match[1]!, size: bytes.byteLength, truncated: false };
}
