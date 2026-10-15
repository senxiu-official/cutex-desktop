// 成果 actions shared by the library, the view and the timeline card: open a version, copy its link,
// owner edits (star / rename / archive / delete, CAS on the revision), the delegation link.
import { artifactMarkdown, artifactRef, parseArtifactRef, type ArtifactPatch, type ArtifactSummary } from "../../../../shared/artifactStore";
import type { CutexRefusal } from "../../../../shared/ipc";
import { translate, type MessageKey } from "../../i18n";
import { confirmDialog, promptDialog, type MenuEntry } from "../../lib/contextMenu";
import { requesterSession } from "../../lib/delegations";
import { delegationOn, loadDelegationDetail, useDelegations } from "../../lib/delegationStore";
import { hostKey } from "../../lib/hostKeys";
import { focusDelegation } from "../../lib/focusRequest";
import { copyText } from "../../lib/menus";
import { agentHost, useApp } from "../../store";
import { services } from "../app";
import type { CutexRef, RefOpenResult, SideOpen } from "../slots";
import { ARTIFACT_REF_KIND, VIEW } from "./model";
import { invalidateArtifact, loadDetail } from "./store";

const notice = (text: string, tone: "info" | "error" = "info") => services.ui.notice(text, tone);

/** A cutex refusal in words (known artifact codes, else cutex's message). */
export function refusalText(error: CutexRefusal): string {
  const known = ["artifact_path_forbidden", "artifact_quota_exceeded", "artifact_name_conflict", "artifact_not_found", "artifact_revision_conflict"];
  return known.includes(error.code) ? translate(`artifacts.err.${error.code}` as MessageKey) : translate("artifacts.err.other", { message: error.message || error.code });
}

export function explainOpen(r: RefOpenResult): void {
  if (r.status === "opened") return;
  const reason = r.status === "stale" ? translate("gutter.reason.stale") : translate(`gutter.reason.${r.reason}` as MessageKey);
  notice(translate("gutter.unavailable", { reason }), "error");
}

/** An `artifact` ref (what a `cutex:artifact/<ref>` link stands for) on the open agent's host. */
export function artifactCutexRef(ref: string, title: string): CutexRef {
  return { hostId: agentHost(useApp.getState()), kind: ARTIFACT_REF_KIND, key: ref, title: title.slice(0, 200) || ref, params: {} };
}

/** Open a version as a tab: from inside the side (SideBodyProps.open) or anywhere (refs). */
export function openVersion(open: SideOpen | null, ref: string, name: string, how: "auto" | "page" = "page"): void {
  if (open) {
    const r = open(VIEW, { ref, name }, { focus: true });
    if (r.status !== "opened") explainOpen(r.status === "stale" ? r : { status: "unavailable", reason: r.reason === "bad-params" ? "bad-ref" : r.reason === "no-agent" ? "gone" : r.reason === "agent-feature" || r.reason === "unknown-kind" ? "module-off" : r.reason });
    return;
  }
  void services.refs.open({ ...artifactCutexRef(ref, name), kind: VIEW, params: { ref, name } }, { how }).then(explainOpen);
}

/** `[name vN](cutex:artifact/…)` to the clipboard (latest: `[name](…@latest)`). */
export function copyArtifactLink(ref: string, name: string): void {
  const parts = parseArtifactRef(ref);
  const text = parts && parts.version !== "latest" ? `${name} v${parts.version}` : name;
  copyText(artifactMarkdown(text, ref));
}

async function patch(hostId: string, a: ArtifactSummary, change: Omit<ArtifactPatch, "expectedRevision">): Promise<boolean> {
  const r = await services.daemonFor(hostId).artifactStorePatch(a.artifactId, { expectedRevision: a.revision, ...change });
  invalidateArtifact(hostId, a.artifactId);
  if (r.ok) return true;
  if (r.error.code === "artifact_revision_conflict") {
    void loadDetail(hostId, a.artifactId);
    notice(translate("artifacts.conflict"), "error");
  } else notice(refusalText(r.error), "error");
  return false;
}

/** The owner's menu rows for one artifact (library rows, the view's header). */
export function artifactMenu(hostId: string, a: ArtifactSummary, open: SideOpen | null): MenuEntry[] {
  const latest = artifactRef(a.artifactId, "latest");
  const pinned = artifactRef(a.artifactId, a.latestVersion);
  return [
    { label: translate("artifacts.openLatest"), onSelect: () => openVersion(open, latest, a.name) },
    { label: translate("artifacts.openPinned", { n: a.latestVersion }), onSelect: () => openVersion(open, pinned, a.name) },
    { label: translate("artifacts.copyLink"), onSelect: () => copyArtifactLink(pinned, a.name) },
    "separator",
    { label: translate(a.starred ? "artifacts.unstar" : "artifacts.star"), onSelect: () => void patch(hostId, a, { starred: !a.starred }) },
    {
      label: translate("artifacts.rename"),
      onSelect: async () => {
        const name = await promptDialog(translate("artifacts.renameTitle"), a.name);
        if (name && name.trim() && name.trim() !== a.name) await patch(hostId, a, { name: name.trim() });
      },
    },
    { label: translate(a.archivedAt ? "artifacts.unarchive" : "artifacts.archive"), onSelect: () => void patch(hostId, a, { archived: !a.archivedAt }) },
    {
      label: translate("artifacts.delete"),
      danger: true,
      onSelect: async () => {
        if (!(await confirmDialog(translate("artifacts.deleteConfirm", { name: a.name, n: a.latestVersion }), true))) return;
        const r = await services.daemonFor(hostId).artifactStoreDelete(a.artifactId);
        invalidateArtifact(hostId, a.artifactId);
        if (r.ok) notice(translate("artifacts.deleted", { name: a.name }));
        else notice(refusalText(r.error), "error");
      },
    },
  ];
}

/** The delegation behind a version of `hostId`'s store: the requester's card (an owner-made one: the 委托 page). */
export async function openDelegation(hostId: string, askId: string, producerSession: string | null): Promise<void> {
  const known = delegationOn(useDelegations.getState().byKey, hostId, askId) ?? (await loadDelegationDetail(hostId, askId));
  const requester = known ? requesterSession(known.requester) : null;
  if (requester) focusDelegation(requester, askId, hostId);
  else services.ui.openPage("delegations.page", producerSession ? { agent: producerSession } : {});
}

/** The title of `hostId`'s delegation when the store knows it (cheap selector). */
export function useDelegationTitle(hostId: string, askId: string | null): string | null {
  return useDelegations((s) => (askId ? (s.byKey[hostKey(hostId, askId)]?.title ?? s.details[hostKey(hostId, askId)]?.title ?? null) : null));
}
