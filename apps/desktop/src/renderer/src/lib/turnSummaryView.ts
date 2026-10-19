// React side of the turn summary (lib/turnSummary): which picked links exist (documents the turn did
// not change are checked through the host file read before they show) and what a click on a file or
// link does (side-pane preview, browser, show in folder, copy).
import { createElement, useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, FileText, FolderOpen, type LucideIcon } from "lucide-react";
import { api, apiFor } from "../bridge";
import { useI18n } from "../i18n";
import { hostApi, useApp } from "../store";
import { convNotify, useConvFeatures, useConvHost, useConvScope, useConvSidebar } from "./conversationScope";
import type { MenuEntry } from "./contextMenu";
import { openMenuFrom } from "./contextMenu";
import { LOCAL_HOST_ID } from "../../../shared/hosts";
import { copyText, outsideFileMenu } from "./menus";
import type { OpenModifiers } from "./openModifiers";
import type { TurnLink } from "./turnSummary";
import { HOST_FILE_READ_FEATURE, resolveFileHref, rootFor, scopeFor } from "./workspace";
import { openFile, openHostFile } from "./sideOpen";

const icon = (Icon: LucideIcon) => createElement(Icon, { size: 14 });

/** host|path → exists. Finished turns never change, so one answer per file is enough. */
const exists = new Map<string, boolean>();
const checking = new Map<string, Promise<boolean>>();

function checkExists(hostId: string, abs: string): Promise<boolean> {
  const key = `${hostId}|${abs}`;
  const known = exists.get(key);
  if (known !== undefined) return Promise.resolve(known);
  let p = checking.get(key);
  if (!p) {
    // One byte is enough: only whether the read succeeds matters.
    p = hostApi(hostId).hostFile(abs, 1).then(
      () => true,
      () => false,
    );
    p.then((ok) => {
      exists.set(key, ok);
      checking.delete(key);
    });
    checking.set(key, p);
  }
  return p;
}

/** `links` minus the ones whose existence check failed or is still running. */
export function useExistingLinks(links: readonly TurnLink[]): TurnLink[] {
  const hostId = useConvHost();
  const [, setTick] = useState(0);
  const toCheck = links.filter((l) => l.verify && l.abs);
  const signature = toCheck.map((l) => l.abs).join("\n");
  useEffect(() => {
    let live = true;
    const missing = toCheck.filter((l) => !exists.has(`${hostId}|${l.abs}`));
    if (!missing.length) return;
    void Promise.all(missing.map((l) => checkExists(hostId, l.abs!))).then(() => live && setTick((n) => n + 1));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, signature]);
  return links.filter((l) => !l.verify || !l.abs || exists.get(`${hostId}|${l.abs}`) === true);
}

export interface FileActions {
  /** The shown path: workspace-relative inside the root, else as written. */
  display: string;
  abs: string | null;
  /** Side-pane preview (workspace fs/file or host fs-file-read); null when neither can read it. */
  preview: ((mods?: OpenModifiers) => void) | null;
  /** Default click: preview, else the path menu from `el`. `mods`: Ctrl/⌘ / middle click = a new kept tab (lib/openModifiers). */
  open(el: HTMLElement, mods?: OpenModifiers): void;
  /** 打开方式 entries. */
  menu(): MenuEntry[];
}

/** What the summary can do with paths of `sessionId`'s workspace. */
export function useFileActions(sessionId: string): (path: string) => FileActions {
  const { t } = useI18n();
  // The conversation's host (lib/conversationScope).
  const sidebar = useConvSidebar();
  const hostRead = useConvFeatures().has(HOST_FILE_READ_FEATURE);
  const remote = useConvHost() !== LOCAL_HOST_ID;
  const conv = useConvScope();
  return useMemo(() => {
    const scope = scopeFor(sidebar, sessionId);
    const root = scope ? rootFor(sidebar, scope) : null;
    return (path: string): FileActions => {
      const ref = resolveFileHref(path, root);
      const rel = ref?.rel ?? null;
      const abs = ref?.abs ?? null;
      const app = useApp.getState();
      const preview = rel && scope ? (mods?: OpenModifiers) => void openFile(rel, null, "link", mods) : hostRead && abs ? (mods?: OpenModifiers) => void openHostFile(abs, null, mods) : null;
      const full = abs ?? path;
      const menu = (): MenuEntry[] => [
        preview && { label: t("conversation.turnSummary.sidePreview"), icon: icon(FileText), onSelect: () => preview() },
        !remote && abs && { label: t("conversation.turnSummary.reveal"), icon: icon(FolderOpen), onSelect: () => void apiFor(LOCAL_HOST_ID).revealPath(abs).catch((e: unknown) => convNotify(conv, e instanceof Error ? e.message : String(e), "error")) },
        { label: t("conversation.turnSummary.copyPath"), icon: icon(Copy), onSelect: () => copyText(full) },
      ];
      return {
        display: rel ?? path,
        abs,
        preview,
        open: (el, mods) => (preview ? preview(mods) : openMenuFrom(el, ref ? outsideFileMenu(ref, full, remote, t, null) : menu())),
        menu,
      };
    };
  }, [sidebar, sessionId, hostRead, remote, t, conv]);
}

/** Default click and 打开方式 entries of a picked link. */
export function linkActions(link: TurnLink, files: (path: string) => FileActions, t: ReturnType<typeof useI18n>["t"]): { open(el: HTMLElement, mods?: OpenModifiers): void; menu(): MenuEntry[] } {
  if (link.kind === "web") {
    const browse = () => void api.openExternal(link.target);
    return {
      open: browse,
      menu: () => [
        { label: t("conversation.turnSummary.browser"), icon: icon(ExternalLink), onSelect: browse },
        { label: t("menu.copyLink"), icon: icon(Copy), onSelect: () => copyText(link.target) },
      ],
    };
  }
  const f = files(link.abs ?? link.target);
  return { open: f.open, menu: f.menu };
}
