// The palette's item list (hooks only): built from what the app already holds, once per data change.
// The only fetch is the artifact lists, started when the palette opens (artifacts.ts caches them).
import { useEffect, useMemo, useState } from "react";
import { ARTIFACTS_FEATURE } from "../../../../shared/artifactStore";
import { useI18n } from "../../i18n";
import { hostData, type HostLook } from "../../lib/hostScope";
import { useScopedAttention, useScopedSidebar } from "../../lib/scopedSidebarView";
import { featuresOf, useApp } from "../../store";
import { services } from "../app";
import { useSlot } from "../react";
import { cachedArtifacts, loadArtifacts, type ProjectRef } from "./artifacts";
import { agentItems, artifactItems, newShelfPageItem, pageItems, serviceItems, shelfPageItems, type ArtifactSource, type HostState, type ServiceSource } from "./items";
import type { QsItem } from "./model";
import { loadPinyin, pinyinNow, withPinyin } from "./pinyin";
import { readShelfPages } from "./shelfPages";
import { newPage } from "../../lib/sideActions";

export interface PaletteData {
  items: QsItem[];
  /** There are Shelf pages (the 「Shelf 页」 chip shows). */
  shelves: boolean;
  /** Artifact lists still loading (none cached yet). */
  loadingArtifacts: boolean;
  /** Host look by id, for the host chips; null = no chips (one-host scope without marks). */
  hostLook(hostId: string | undefined): HostLook | null;
}

export function usePaletteItems(): PaletteData {
  const { t } = useI18n();
  const scoped = useScopedSidebar();
  const attention = useScopedAttention(scoped.model, scoped.scope);
  const servicesFocus = useApp((s) => s.services);
  const byHost = useApp((s) => s.byHost);
  const nav = useSlot("nav.primary");

  // 成果: per project of each host with `artifacts` (sidebar order), fetched once per open.
  const projects = useMemo<ProjectRef[]>(() => {
    const state = useApp.getState();
    return scoped.model.groups.flatMap((g) => {
      const hostId = g.hostId ?? scoped.scope.focus;
      if (g.kind !== "project" || scoped.stateOf(hostId) !== "live" || !featuresOf(state, hostId).has(ARTIFACTS_FEATURE)) return [];
      return [{ hostId, projectId: g.id, name: g.name }];
    });
    // Project identity only: the rows' activity changes must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped.model.groups.map((g) => `${g.hostId}|${g.id}`).join(",")]);
  const [artifacts, setArtifacts] = useState<ArtifactSource[]>(() => cachedArtifacts(projects));
  const [loading, setLoading] = useState(projects.length > 0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    void loadArtifacts(projects, (hostId, query) => services.daemonFor(hostId).artifactStoreList(query)).then((lists) => {
      if (!live) return;
      setArtifacts(lists);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [projects]);

  // Read once per open: the palette is modal, the Shelves do not change under it.
  const [shelfPages] = useState(readShelfPages);

  const agentList = useMemo(
    () => agentItems({ groups: scoped.model.groups, chats: scoped.model.chats, signals: attention.signals, stateOf: scoped.stateOf, focus: scoped.scope.focus }, t),
    [scoped, attention.signals, t],
  );
  const serviceList = useMemo(() => {
    const state = useApp.getState();
    const hosts: ServiceSource[] = scoped.hosts.map(({ look, state: hostState }) => ({
      hostId: look.id,
      services: (look.connected ? hostData(state, look.id)?.services : null) ?? [],
      state: hostState as HostState,
    }));
    return serviceItems(hosts, t);
    // servicesFocus / byHost: the lists themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped.hosts, servicesFocus, byHost, t]);
  const artifactList = useMemo(() => artifactItems(artifacts, t), [artifacts, t]);
  const pageList = useMemo(() => {
    const top = nav.filter((e) => (e.item.area ?? "top") === "top");
    const footer = nav.filter((e) => e.item.area === "footer");
    return pageItems([...top, ...footer].map((e) => ({ item: e.item, disabled: e.mode !== "show" })), t);
  }, [nav, t]);
  const shelfList = useMemo(() => [...shelfPageItems(shelfPages, t), newShelfPageItem(t, () => void newPage(), shelfPages.length)], [shelfPages, t]);

  // Pinyin (pinyin.ts): loaded on the first open (a separate chunk), the titles' readings computed per list change.
  const [pinyin, setPinyin] = useState(pinyinNow);
  useEffect(() => {
    if (pinyin) return;
    let live = true;
    void loadPinyin().then((lib) => live && setPinyin(lib));
    return () => {
      live = false;
    };
  }, [pinyin]);

  const items = useMemo(() => withPinyin([...agentList, ...serviceList, ...artifactList, ...pageList, ...shelfList], pinyin), [agentList, serviceList, artifactList, pageList, shelfList, pinyin]);
  const hostLook = useMemo(() => {
    const looks = new Map(scoped.scope.hosts.map((h) => [h.id, h]));
    const marks = scoped.scope.showHostMarks;
    return (hostId: string | undefined) => (marks && hostId ? (looks.get(hostId) ?? null) : null);
  }, [scoped.scope]);
  // The Shelf pages scope is always there: 新建空页 makes the first page too.
  return { items, shelves: true, loadingArtifacts: loading && artifacts.length === 0, hostLook };
}
