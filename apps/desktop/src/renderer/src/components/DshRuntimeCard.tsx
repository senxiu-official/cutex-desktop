// Settings → 运行时 groups of the ACP runtimes (DSH r265, Kimi Code r266; lib/acpRuntimes): the versions of the
// runtime's optional component and the agents pinned to each, what it depends on, the 「暂不建议使用」 label (one switch
// per runtime) and the way to a Profile that uses it. A host without the runtime's capability shows nothing (Kimi: also shown, to offer the install, when cutex knows Kimi Code).
// r270: also shown when the host has component-index-v1 and lists the component (a fresh host installs DSH from here); the
// Profile link stays behind the runtime's capability (lib/acpRuntimes acpRuntimeProfiles), the guide behind external-runtime-root-v1.
import { useI18n, type MessageKey } from "../i18n";
import { ACP_RUNTIME_INFO, acpRuntimeProfiles, acpRuntimeShown, type AcpRuntime } from "../lib/acpRuntimes";
import { formatNodeRange, nodeRequirement } from "../lib/componentExternal";
import { useComponentState, useHostComponents } from "../lib/componentView";
import { useTargetFeatures, useTargetHostId } from "../lib/targetHost";
import { ComponentCard } from "./ComponentCard";
import { ComponentIndexPanel } from "./ComponentIndexPanel";
import { RuntimeGroup } from "./RuntimeVersions";
import { Tag } from "./Tag";
import { useApp } from "../store";
import { setSettingsHost } from "../lib/settingsHost";

/** Per-runtime text of the group (the rest comes from lib/acpRuntimes). */
const TEXT: Record<AcpRuntime, { notRecommended: MessageKey; usage: MessageKey; profile: MessageKey }> = {
  dsh: { notRecommended: "dsh.notRecommended", usage: "runtimes.dshUsage", profile: "runtimes.dshProfile" },
  kimi: { notRecommended: "kimi.notRecommended", usage: "runtimes.kimiUsage", profile: "runtimes.kimiProfile" },
};

/** Every ACP runtime the host can start, in lib/acpRuntimes order. */
export function AcpRuntimeSettings() {
  const hostId = useTargetHostId();
  const features = useTargetFeatures();
  const names = useHostComponents(hostId).list?.components.map((c) => c.name);
  return <>{(Object.keys(ACP_RUNTIME_INFO) as AcpRuntime[]).filter((r) => acpRuntimeShown(r, features, names)).map((r) => <AcpRuntimeCard key={r} runtime={r} hostId={hostId} />)}</>;
}

export function DshRuntimeSettings() {
  const hostId = useTargetHostId();
  const features = useTargetFeatures();
  const names = useHostComponents(hostId).list?.components.map((c) => c.name);
  return acpRuntimeShown("dsh", features, names) ? <DshRuntimeCard hostId={hostId} /> : null;
}

export function DshRuntimeCard({ hostId }: { hostId: string }) {
  return <AcpRuntimeCard runtime="dsh" hostId={hostId} />;
}

export function AcpRuntimeCard({ runtime, hostId }: { runtime: AcpRuntime; hostId: string }) {
  const { t } = useI18n();
  const features = useTargetFeatures();
  const info = ACP_RUNTIME_INFO[runtime];
  const text = TEXT[runtime];
  const { state, entry } = useComponentState(hostId, info.component);
  const component = entry.list?.components.find(c => c.name === info.component);
  const dsh = runtime === "dsh" ? component?.dsh : undefined;
  const kimi = runtime === "kimi" ? component?.kimi : undefined;
  const list = (component?.versions ?? []).map(v => ({ release: v.version, version: null, sha256Prefix: null, path: null, selected: v.version === component?.selected, missing: false, agentCount: v.pinnedBy, agents: [] }));
  const ready = state.kind === "body" && !!component && component.state !== "missing";
  const depsReady = dsh ? dsh.node.ready : kimi?.node ? kimi.node.ready : true;
  // r270: the full range (node.range / external.nodeRange), a plain minimum only without one; the version only as observed.
  const node = nodeRequirement(component, dsh?.node ?? kimi?.node);
  const nodeVersion = node?.version ?? t("runtimes.nodeVersionUnknown");
  const nodeLine = !node ? t("runtimes.nodeUnknown") : node.range ? t("runtimes.nodeRange", { range: formatNodeRange(node.range), version: nodeVersion }) : t("runtimes.node", { minimum: node.minimum!, version: nodeVersion });
  return <RuntimeGroup hostId={hostId} kind={runtime} title={info.label} list={list} currentVersion={component?.selected} status={ready ? <Tag tone={depsReady === false ? "attention" : "accent"}>{t(depsReady === false ? "dsh.notReady" : "dsh.ready")}</Tag> : undefined} dependencies={<>
    {info.notRecommended && <p data-dsh-not-recommended="" data-runtime-not-recommended={runtime} className="text-warn">{t(text.notRecommended)}</p>}
    <p>{t(text.usage)}</p>
    {runtime === "dsh" && <>
      {dsh && !component?.selected && <p>DSH {dsh.version}</p>}
      <p data-runtime-node="">{nodeLine}</p>
    </>}
    {runtime === "kimi" && <>
      {kimi && kimi.version !== component?.selected && <p>Kimi Code {kimi.version}</p>}
      <p>{t("runtimes.kimiDependency")}</p>
      <p data-runtime-node="">{nodeLine}</p>
    </>}
    {acpRuntimeProfiles(runtime, features) && <button className="text-left text-accent hover:underline" onClick={() => { useApp.getState().openSettings("profiles", { create: true }); setSettingsHost(hostId); }}>{t(text.profile)}</button>}
  </>}>
    <ComponentIndexPanel name={info.component} hostId={hostId} component={component} entry={entry} title={info.label} />
    {state.kind === "waiting" ? <p className="text-xs text-subtle">…</p> : state.kind === "body" ? null : <ComponentCard name={info.component} hostId={hostId} state={state} refusal={entry.refusal?.name === info.component && entry.refusal.action !== "indexCheck" ? entry.refusal.error : null} variant="compact" offerAbove />}
  </RuntimeGroup>;
}
