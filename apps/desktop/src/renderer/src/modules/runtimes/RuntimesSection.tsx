// Settings → 运行时 → 已安装的运行时 (cutex runtimes-view): per native cute-codex release and per
// Claude runtime, how many agents are pinned to it (expand for their names). Data: lib/runtimesStore
// (loaded by the 运行时 page), adapted from the wire in shared/runtimes.ts.
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { InstalledRuntime } from "../../../../shared/runtimes";
import { ErrorNote, Loading, Section } from "../../components/settings/Form";
import { useI18n } from "../../i18n";
import { useHostRuntimes } from "../../lib/runtimesStore";

/** Names shown when a runtime row is expanded (the rest is a count). */
const MAX_NAMES = 60;

export function RuntimesSection() {
  const { t } = useI18n();
  const host = useHostRuntimes();
  if (!host) return null;
  const { view, error } = host;
  return (
    <Section title={t("runtimes.installed")} hint={t("runtimes.hint")}>
      {!view && !error && <Loading rows={2} />}
      {!view && error && <ErrorNote>{error}</ErrorNote>}
      {view && (
        <>
          <Group title={t("runtimes.native")} list={view.native} />
          <Group title={t("runtimes.claude")} list={view.claude} />
        </>
      )}
    </Section>
  );
}

function Group({ title, list }: { title: string; list: readonly InstalledRuntime[] }) {
  const { t } = useI18n();
  return (
    <div className="-mx-4 border-b border-border px-4 pt-2.5 pb-1.5 last:border-b-0">
      <p className="pb-1 text-xs font-medium text-muted">{title}</p>
      {list.length === 0 ? (
        <p className="py-1 text-xs text-subtle">{t("runtimes.none")}</p>
      ) : (
        <ul>
          {list.map((r) => (
            <RuntimeRow key={r.release} runtime={r} />
          ))}
        </ul>
      )}
    </div>
  );
}

function RuntimeRow({ runtime: r }: { runtime: InstalledRuntime }) {
  const { t, locale } = useI18n();
  const sep = locale === "zh-CN" ? "、" : ", ";
  const [open, setOpen] = useState(false);
  const expandable = r.agentCount > 0;
  const Chevron = open ? ChevronDown : ChevronRight;
  const count = r.agentCount > 0 ? t("runtimes.agents", { n: r.agentCount }) : t("runtimes.noAgents");
  const shown = r.agents.slice(0, MAX_NAMES);
  const more = r.agentCount - shown.length;
  return (
    <li className="py-0.5">
      <button
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded py-1 text-left text-xs enabled:hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none"
      >
        <span className="flex w-3.5 shrink-0 justify-center text-subtle">{expandable && <Chevron size={13} />}</span>
        <span className="w-20 shrink-0 truncate font-mono text-foreground" title={r.path ?? undefined}>
          {r.release}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-subtle" title={r.path ?? undefined}>
          {r.version && r.version !== r.release ? r.version : ""}
        </span>
        {r.selected && (
          <span className="shrink-0 rounded bg-accent/15 px-1 text-[10px] text-accent" title={t("runtimes.selectedHint")}>
            {t("runtimes.selected")}
          </span>
        )}
        {r.missing && (
          <span className="shrink-0 rounded bg-warn/15 px-1 text-[10px] text-warn-text" title={t("runtimes.missingHint")}>
            {t("runtimes.missing")}
          </span>
        )}
        <span className={`w-20 shrink-0 text-right ${r.agentCount > 0 ? "text-muted" : "text-subtle"}`}>{count}</span>
      </button>
      {open && expandable && (
        <p className="pt-0.5 pb-1.5 pl-[1.375rem] text-xs leading-relaxed text-muted select-text">
          {shown.map((a, i) => (
            <span key={a.id} title={a.id}>
              {a.name}
              {i < shown.length - 1 ? sep : ""}
            </span>
          ))}
          {more > 0 && <span className="text-subtle">{`${shown.length ? " · " : ""}${t("runtimes.moreAgents", { n: more })}`}</span>}
        </p>
      )}
    </li>
  );
}
