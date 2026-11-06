import { RuntimeCleanup } from "./RuntimeCleanup";
import { useTargetHostId } from "../lib/targetHost";
import { useHostData } from "../lib/useHostScope";
import { useRuntimePruneStore } from "../lib/runtimePruneStore";
import { mergeRuntimePruneVersions } from "../lib/runtimePruneView";
import { RUNTIME_PRUNE_FEATURE } from "../../../shared/runtimes";
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { InstalledRuntime } from "../../../shared/runtimes";
import { useI18n } from "../i18n";
import { Section } from "./settings/Form";
import { Tag } from "./Tag";
import { nativeVersionText } from "../lib/runtimeVersion";

/** Shared presentation only; host stores supply all runtime state. */
export function RuntimeGroup({ hostId: suppliedHost, kind, title, list, currentVersion, status, dependencies, children }: { hostId?: string; kind: "native" | "claude" | "dsh" | "kimi" | "acp"; title: string; list: readonly InstalledRuntime[]; currentVersion?: string | null; status?: ReactNode; dependencies?: ReactNode; children?: ReactNode }) {
  const { t } = useI18n();
  const targetHost = useTargetHostId();
  const hostId = suppliedHost ?? targetHost;
  const data = useHostData(hostId);
  const plan = useRuntimePruneStore(s => s.byHost[hostId]?.plan);
  const pruneEnabled = kind !== "acp" && data?.daemon.kind === "connected" && data.features.has(RUNTIME_PRUNE_FEATURE);
  if (pruneEnabled)
    list = mergeRuntimePruneVersions(list, plan?.versions.filter(v => v.kind === kind) ?? []);
  const current = list.find(r => r.selected);
  const version = current && kind === "native"
    ? nativeVersionText(current.version, current.sha256Prefix, t("runtimes.unknownVersion"))
    : current?.version || current?.release || currentVersion;
  const unused = list.filter(r => !r.selected && !r.missing && r.agentCount === 0);
  const visible = list.filter(r => r.selected || r.missing || r.agentCount > 0);
  return <Section title={title}>
    <div data-runtime-group={title} className="min-w-0 space-y-3 py-1">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 text-xs text-muted">{version ? <>{t("runtimes.current")} <strong className="font-mono font-medium break-all text-foreground">{version}</strong></> : t("runtimes.noCurrent")}</p>
        {status}
      </div>
      {dependencies && <div className="space-y-1 text-xs leading-relaxed text-subtle">{dependencies}</div>}
      {visible.length > 0 && <ul className="divide-y divide-border/60">{visible.map(r => <RuntimeRow key={`${r.release}:${r.sha256Prefix ?? ""}`} runtime={r} native={kind === "native"} />)}</ul>}
      {unused.length > 0 && <details className="border-t border-border/60 pt-2" data-unused-runtimes=""><summary className="cursor-pointer text-xs text-muted hover:text-foreground">{t(pruneEnabled ? "runtimes.unreferenced" : "runtimes.unused", { n: unused.length })}</summary><ul className="mt-2 divide-y divide-border/60">{unused.map(r => <RuntimeRow key={`${r.release}:${r.sha256Prefix ?? ""}`} runtime={r} native={kind === "native"} />)}</ul></details>}
      {kind !== "acp" && <RuntimeCleanup key={`${hostId}:${kind}`} hostId={hostId} kind={kind} />}
      {children}
    </div>
  </Section>;
}

function RuntimeRow({ runtime: r, native }: { runtime: InstalledRuntime; native: boolean }) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const expandable = r.agentCount > 0 && r.agents.length > 0;
  const Chevron = open ? ChevronDown : ChevronRight;
  const shown = r.agents.slice(0, 60);
  const more = r.agentCount - shown.length;
  return <li className="py-1">
    <button disabled={!expandable} aria-expanded={expandable ? open : undefined} onClick={() => setOpen(!open)} className="flex w-full flex-wrap items-start gap-x-2 gap-y-1 rounded py-1 text-left text-xs enabled:hover:bg-hover focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">
      <span className="flex min-w-0 flex-1 basis-36 items-start gap-2"><span className="mt-0.5 flex w-3.5 shrink-0 justify-center text-subtle">{expandable && <Chevron size={13} />}</span><span className="min-w-0 font-mono break-all text-foreground" title={r.path ?? undefined}>{native ? nativeVersionText(r.version, r.sha256Prefix, t("runtimes.unknownVersion")) : r.version || r.release}</span></span>
      {r.selected && <Tag tone="accent">{t("runtimes.selected")}</Tag>}
      {r.missing && <Tag tone="attention" title={t("runtimes.missingHint")}>{t("runtimes.missing")}</Tag>}
      <span className="ml-auto shrink-0 text-muted">{t("runtimes.agents", { n: r.agentCount })}</span>
    </button>
    {open && expandable && <p className="pl-[1.375rem] text-xs leading-relaxed break-words text-muted select-text">{shown.map((a, i) => <span key={a.id} title={a.id}>{i > 0 ? locale.startsWith("zh") ? "、" : ", " : ""}{a.name}</span>)}{more > 0 && <span> · {t("runtimes.moreAgents", { n: more })}</span>}</p>}
  </li>;
}
