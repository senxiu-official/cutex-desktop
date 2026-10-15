// `ref.target` kind `artifact` (docs/desktop-modules.md §19.6, contract 1.7): `cutex:artifact/<ref>`
// links open artifacts.view (reference card or right side); the chip shows name · version · type, and
// a badge when a pinned link has a newer version or the artifact is gone; image links get thumbnails.
import { BarChart3, ClipboardList, Database, FileBox, FileText, Send, Table2 } from "lucide-react";
import { ARTIFACT_CONTENT_MAX, parseArtifactRef, type ArtifactKind } from "../../../../shared/artifactStore";
import { useI18n } from "../../i18n";
import { services } from "../app";
import type { CutexRef, Icon, RefImage, RefLinkView, RefOpenResult } from "../slots";
import { VIEW } from "./model";
import { loadContent, resolveNow, useArtifactCache, useResolved } from "./store";

export const KIND_ICON: Record<ArtifactKind, Icon> = {
  report: FileText,
  figure: BarChart3,
  table: Table2,
  data: Database,
  plan: ClipboardList,
  handoff: Send,
  other: FileBox,
};

/** The artifacts.view ref of an `artifact` ref (same host, key = the artifact ref). */
export function viewRef(ref: CutexRef): CutexRef {
  return { hostId: ref.hostId, kind: VIEW, key: ref.key, title: ref.title, params: { ref: ref.key } };
}

export function openArtifactRef(ref: CutexRef, how: "auto" | "peek" | "page"): RefOpenResult | Promise<RefOpenResult> {
  if (!parseArtifactRef(ref.key)) return { status: "unavailable", reason: "bad-ref" };
  const known = useArtifactCache.getState().resolved[`${ref.hostId}|${ref.key}`];
  if (known && !known.ok) return { status: "unavailable", reason: "gone" };
  // An artifact is a document: a plain click opens it on the right side (owner 2026-10-12), the
  // reference card only on request (「在左侧打开」).
  return services.refs.open(viewRef(ref), { how: how === "auto" ? "page" : how });
}

/** The chip's look (a hook; resolves are batched and cached per host). */
export function useArtifactLink(ref: CutexRef): RefLinkView | null {
  const { t } = useI18n();
  const parts = parseArtifactRef(ref.key);
  const item = useResolved(ref.hostId, parts ? ref.key : null);
  if (!parts) return { tone: "muted", tooltip: ref.key };
  if (!item) return { icon: FileBox, tooltip: ref.key };
  if (!item.ok) return { icon: FileBox, tone: "muted", badge: t(item.error === "forbidden" ? "artifacts.link.forbidden" : "artifacts.link.deleted"), tooltip: ref.key };
  const tooltip = t("artifacts.link.tooltip", { name: item.name, n: item.version, kind: t(`artifacts.kind.${item.kind}`) });
  const newer = parts.version !== "latest" && item.latestVersion > item.version;
  const badge = newer ? t("artifacts.link.newer", { n: item.latestVersion }) : item.archived ? t("artifacts.link.archived") : undefined;
  return { icon: KIND_ICON[item.kind] ?? FileBox, tooltip, ...(badge ? { badge } : {}), ...(newer ? { tone: "warn" as const } : {}) };
}

/** An image link's bytes: resolve, then the (immutable) version's content when it is an image. */
export async function artifactThumbnail(ref: CutexRef, maxBytes: number): Promise<RefImage | null> {
  const parts = parseArtifactRef(ref.key);
  if (!parts) return null;
  const item = await resolveNow(ref.hostId, ref.key);
  if (!item?.ok || !item.mediaType.toLowerCase().startsWith("image/")) return null;
  const content = await loadContent(ref.hostId, item.artifactId, item.version, Math.min(maxBytes, ARTIFACT_CONTENT_MAX));
  if (!content || content.truncated) return null;
  return { mime: content.mediaType || item.mediaType, encoding: content.encoding, content: content.content, size: content.totalBytes, truncated: content.truncated };
}
