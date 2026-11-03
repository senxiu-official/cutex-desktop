import { ErrorNote, Loading } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useHostRuntimes } from "../../lib/runtimesStore";
import { RuntimeGroup } from "../../components/RuntimeVersions";
import { useTargetHostId } from "../../lib/targetHost";
import { useComponentState } from "../../lib/componentView";
import { CLAUDE_RUNTIME_COMPONENT } from "../../lib/componentCard";
import { ComponentCard } from "../../components/ComponentCard";
import { ComponentIndexPanel } from "../../components/ComponentIndexPanel";
import { Tag } from "../../components/Tag";

export function RuntimesSection() {
  const { t } = useI18n();
  const host = useHostRuntimes();
  const hostId = useTargetHostId();
  const { state, entry } = useComponentState(hostId, CLAUDE_RUNTIME_COMPONENT);
  const component = entry.list?.components.find(c => c.name === CLAUDE_RUNTIME_COMPONENT);
  if (!host) return null;
  const { view, error } = host;
  const cli = component?.claudeCli;
  const cliVersion = cli?.selected === "system" ? cli.system?.version : cli?.bundled.version;
  const currentClaude = view?.claude.find(r => r.selected)?.release;
  const bundledPython = Number(/claude-r(\d+)/.exec(currentClaude ?? "")?.[1]) >= 28;
  const ready = (available: boolean) => <Tag tone={available ? "accent" : "attention"}>{t(available ? "dsh.ready" : "dsh.notReady")}</Tag>;
  return <>
    <RuntimeGroup kind="native" title="cute-codex" list={view?.native ?? []} status={view ? ready(view.native.some(r => r.selected && !r.missing)) : undefined} dependencies={<p>{t("runtimes.nativeDependency")}</p>}>
      {!view && (error ? <ErrorNote>{error}</ErrorNote> : <Loading rows={2} />)}
    </RuntimeGroup>
    <RuntimeGroup kind="claude" title="Claude" list={view?.claude ?? []} status={view && state.kind === "body" ? ready(view.claude.some(r => r.selected && !r.missing)) : undefined} dependencies={<>
      <p>{t(bundledPython ? "runtimes.bundledPython" : "runtimes.pythonUnknown")}</p>
      <p>{cli ? t("runtimes.cli", { source: t(cli.selected === "bundled" ? "runtimes.bundled" : "runtimes.system"), version: cliVersion ?? "—" }) : t("runtimes.cliUnknown")}</p>
    </>}>
      {!view && (error ? <ErrorNote>{error}</ErrorNote> : <Loading rows={2} />)}
      <ComponentIndexPanel name={CLAUDE_RUNTIME_COMPONENT} hostId={hostId} component={component} entry={entry} title="Claude Code" />
      {state.kind !== "body" && state.kind !== "waiting" && <ComponentCard name={CLAUDE_RUNTIME_COMPONENT} hostId={hostId} state={state} refusal={entry.refusal?.name === CLAUDE_RUNTIME_COMPONENT && entry.refusal.action !== "indexCheck" ? entry.refusal.error : null} variant="compact" offerAbove />}
    </RuntimeGroup>
  </>;
}
