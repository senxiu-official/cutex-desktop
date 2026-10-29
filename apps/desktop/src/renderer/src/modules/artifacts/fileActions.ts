// Artifact file actions use only cutex's version-specific sourcePath. A blob's
// internal storage path is not exposed by this API and must never be inferred.
import { parseArtifactRef, type ArtifactDetail, type ArtifactVersion } from "../../../../shared/artifactStore";
import { translate, type MessageKey } from "../../i18n";
import { openMenuAt, type MenuEntry } from "../../lib/contextMenu";
import { fileActions } from "../../lib/fileActions";
import { captureHostAction } from "../../lib/hostSwitch";
import { copyText } from "../../lib/menus";
import { services } from "../app";
import { resolveVersion } from "./model";
import { isHTMLElement } from "../../lib/ownerWindow";
import { activeAppDocument } from "../../lib/appWindowSet";

/** No latest fallback for a missing pinned version, including malformed data. */
export function artifactFileVersion(detail: ArtifactDetail | null | undefined, ref: string): ArtifactVersion | null {
  const parts = parseArtifactRef(ref);
  if (!parts || detail?.artifact.artifactId !== parts.artifactId) return null;
  const version = resolveVersion(detail, parts.version);
  return version?.artifactId === parts.artifactId && typeof version.sourcePath === "string" && version.sourcePath.trim()
    ? version : null;
}

/** Library rows pass latest; a pinned view must pass its displayed version. */
export function artifactSourceFileEntries(hostId: string, version: ArtifactVersion | null | undefined): MenuEntry[] {
  if (!version || typeof version.sourcePath !== "string" || !version.sourcePath.trim()) return [];
  return fileActions({ hostId, path: version.sourcePath, artifact: { id: version.artifactId, version: version.version }, open: true, copyLabel: translate("artifacts.copyFilePath" as MessageKey) }, translate);
}

/** Chips' cheap resolve response has no path. Read the pinned detail only when
 * the source submenu opens, never for every rendered chip. */
export async function loadArtifactSourceFileEntries(hostId: string, ref: string): Promise<MenuEntry[]> {
  const parts = parseArtifactRef(ref);
  if (!parts) return [];
  const current = captureHostAction(hostId);
  try {
    const detail = await services.daemonFor(hostId).artifactStoreGet(parts.artifactId);
    if (!current()) return [];
    const rows = artifactSourceFileEntries(hostId, artifactFileVersion(detail, ref));
    if (!rows.length) services.ui.notice(translate("artifacts.sourceFileUnavailable" as MessageKey));
    return rows;
  } catch (error) {
    if (current()) services.ui.notice(String(error), "error");
    return [];
  }
}

/** The focused element of the app window in front (a desk window's, multi-window). */
function focusedElement(): HTMLElement | null {
  const active = activeAppDocument().activeElement;
  return isHTMLElement(active) ? active : null;
}

export async function openArtifactSourceFileMenu(hostId: string, ref: string, anchor?: HTMLElement): Promise<void> {
  const parts = parseArtifactRef(ref);
  if (!parts) return;
  const current = captureHostAction(hostId);
  const element = anchor ?? (typeof document !== "undefined" ? focusedElement() : null);
  const rect = element?.getBoundingClientRect();
  const point = { x: rect?.left ?? 0, y: rect?.bottom ?? 0 };
  const rows = await loadArtifactSourceFileEntries(hostId, ref);
  if (current() && rows.length) openMenuAt(point.x, point.y, rows);
}

/** Copy a linked version's exact registered source path (fetching detail only when chosen). */
export async function copyArtifactSourcePath(hostId: string, ref: string): Promise<void> {
  const parts = parseArtifactRef(ref);
  if (!parts) return;
  const current = captureHostAction(hostId);
  try {
    const detail = await services.daemonFor(hostId).artifactStoreGet(parts.artifactId);
    if (!current()) return;
    const version = artifactFileVersion(detail, ref);
    if (!version) {
      services.ui.notice(translate("artifacts.sourceFileUnavailable" as MessageKey));
      return;
    }
    copyText(version.sourcePath);
  } catch (error) {
    if (current()) services.ui.notice(String(error), "error");
  }
}
