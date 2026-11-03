// r269 (plan components-021 §2; contract frozen in shared/componentIndex.ts): the needsUser part of a component card
// when cutex reports which checks of an adapter's user-installed dependencies failed. Per failed check: plain text, what
// cutex expected / found / looked at, copyable commands for the target host's platform (lib/componentExternal), cutex's own
// steps; then the path form (owner action `configure`; 恢复默认 / `--clear-*` clear stored paths) and 重新检测 (`check`).
// `checkedAt: null` (never checked / invalidated by a path change) is unverified, never ready: a note says so.
// r270 (cutex component-external-ui-v1): the form edits cutex's `storedConfig` (the owner's exact overrides) and shows the
// `resolved` path under each field; 恢复默认 only for stored fields; saving sends the changed fields only. An issue's `actual`
// is one short line and its `diagnostics` sit in a collapsed area. r269 daemons (none of these fields): as before.
// Once cutex reports the adapter ready, the same form stays reachable in a collapsed 「路径设置」 (ComponentPathSettings).
// The desktop never installs or probes anything itself: the owner runs the commands on the host, cutex judges the result.
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { componentClearCli, type ComponentExternal, type ComponentIndexRelease } from "../../../shared/components";
import { useI18n, type MessageKey } from "../i18n";
import { configureFields, configureFormState, configurePathOk, externalGuides, type CommandBlock, type IssueGuide } from "../lib/componentExternal";
import { configureComponent, requestComponent } from "../lib/componentStore";
import { formatWhen } from "../lib/time";
import { useHostLook } from "../lib/useHostScope";
import { Button, SettingsGroup } from "./settings/Form";

/** `release`: the index row of `external.version` (its signed externalRuntime supplies package versions cutex did not list). */
export function ComponentExternalGuide({ name, hostId, external, component, compact, release }: { name: string; hostId: string; external: ComponentExternal; component: string; compact: boolean; release?: ComponentIndexRelease }) {
  const { t, locale } = useI18n();
  const look = useHostLook(hostId);
  const guides = externalGuides(name, external, look?.platform ?? null, release);
  const checked = external.checkedAt ? Date.parse(external.checkedAt) : NaN;
  return (
    <div className="mt-2 space-y-3" data-component-external={name}>
      <p className="text-xs text-subtle">{t("modules.component.external.intro", { component, host: look?.label ?? hostId })}</p>
      {external.checkedAt === null && <p className="text-xs text-warn" data-external-unverified="">{t("modules.component.external.unverified", { version: external.version })}</p>}
      {guides.length > 0 && <ol className="space-y-3">
        {guides.map((g, i) => (
          <IssueItem key={`${g.issue.code}:${i}`} guide={g} component={component} />
        ))}
      </ol>}
      <ConfigureForm name={name} hostId={hostId} external={external} compact={compact} />
      {Number.isFinite(checked) && <p className="text-xs text-subtle">{t("modules.component.external.checkedAt", { when: formatWhen(checked / 1000, Date.now(), locale) })}</p>}
    </div>
  );
}

/**
 * A ready adapter (checked, no failed checks): the same path form, collapsed. Saving / 恢复默认 re-probe as in the guide; when
 * cutex then reports failed checks the caller shows the full guide instead.
 */
export function ComponentPathSettings({ name, hostId, external, compact }: { name: string; hostId: string; external: ComponentExternal; compact: boolean }) {
  const { t } = useI18n();
  return (
    <details className="text-xs" data-component-paths={name}>
      <summary className="cursor-pointer text-subtle select-none hover:text-foreground">{t("modules.component.external.pathSettings")}</summary>
      <div className="mt-1.5">
        <ConfigureForm name={name} hostId={hostId} external={external} compact={compact} />
      </div>
    </details>
  );
}

function IssueItem({ guide, component }: { guide: IssueGuide; component: string }) {
  const { t } = useI18n();
  const { issue } = guide;
  const vars = { component, expected: issue.expected ?? "—", actual: issue.actual ?? "—" };
  return (
    <li className="rounded-md border border-border/70 px-3 py-2" data-external-issue={issue.code}>
      <p className="text-sm font-medium">{guide.known ? t(`modules.component.external.${issue.code}.title` as MessageKey, vars) : t("modules.component.external.unknown", { code: issue.code })}</p>
      {guide.known && <p className="mt-0.5 text-xs text-subtle">{t(`modules.component.external.${issue.code}.what` as MessageKey, vars)}</p>}
      {(issue.expected || issue.actual || issue.path) && (
        <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {issue.expected && <><dt className="text-subtle">{t("modules.component.external.expected")}</dt><dd className="min-w-0 font-mono break-all">{issue.expected}</dd></>}
          {/* r270: one compact line, the trace is in the diagnostics below. r269 cutex may put a whole probe stack trace here: 4 lines, the rest on hover. */}
          {issue.actual && <><dt className="text-subtle">{t("modules.component.external.actual")}</dt>{issue.diagnostics !== undefined ? <dd className="min-w-0 font-mono break-all" data-external-actual="">{issue.actual}</dd> : <dd className="line-clamp-4 min-w-0 font-mono break-all" title={issue.actual}>{issue.actual}</dd>}</>}
          {issue.path && <><dt className="text-subtle">{t("modules.component.external.path")}</dt><dd className="min-w-0 font-mono break-all select-all">{issue.path}</dd></>}
        </dl>
      )}
      {issue.diagnostics !== undefined && (
        <details className="mt-1.5 text-xs" data-external-diagnostics={issue.code}>
          <summary className="cursor-pointer text-subtle select-none hover:text-foreground">{t("modules.component.external.diagnostics")}</summary>
          {/* Owner-only host diagnostics (≤ 64 KiB); React escapes it. */}
          <pre className="mt-1 max-h-60 overflow-auto rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{issue.diagnostics}</pre>
        </details>
      )}
      {guide.commands.map((block) => (
        <Commands key={block.platform} block={block} />
      ))}
      {issue.steps.length > 0 && (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs">
          {issue.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
    </li>
  );
}

function Commands({ block }: { block: CommandBlock }) {
  const { t } = useI18n();
  return <CopyBlock label={t(block.platform === "linux" ? "modules.component.external.linux" : "modules.component.external.windows")} text={block.lines.join("\n")} data={{ "data-external-commands": block.platform }} />;
}

/** A labelled, copyable command block. */
function CopyBlock({ label, text, data }: { label: string; text: string; data: Record<`data-${string}`, string> }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <div className="mt-2" {...data}>
      <div className="flex items-center justify-between gap-2 text-xs text-subtle">
        <span>{label}</span>
        <button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-hover hover:text-foreground" onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}>
          {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
          {t(copied ? "modules.component.external.copied" : "modules.component.copy")}
        </button>
      </div>
      <pre className="mt-1 rounded-md border border-border bg-surface-2 px-2 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap select-all [overflow-wrap:anywhere]">{text}</pre>
    </div>
  );
}

const FIELD_KEY = { externalRoot: "modules.component.external.root", node: "modules.component.external.node", rg: "modules.component.external.rg" } as const;
const HINT_KEY = { externalRoot: "modules.component.external.rootHint", node: "modules.component.external.nodeHint", rg: "modules.component.external.rgHint" } as const;

/** Paths cutex uses on the target host (empty: cutex's default / PATH). Saving asks cutex to store them and check again. */
function ConfigureForm({ name, hostId, external, compact }: { name: string; hostId: string; external: ComponentExternal; compact: boolean }) {
  const { t } = useI18n();
  const fields = configureFields(name, external);
  // 恢复默认 clears stored paths (null = cutex's default / environment discovery again); which ones: lib/componentExternal.
  const form = configureFormState(external, fields);
  const { initial, stored, resettable, exact } = form;
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState<"save" | "check" | "reset" | null>(null);
  const initialKey = `${exact}\n${initial.externalRoot}\n${initial.node}\n${initial.rg}`;
  // A re-read with other stored paths (another desktop, the CLI) replaces the fields.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- initialKey stands for initial
  useEffect(() => setValues(initial), [initialKey]);
  const bad = fields.filter((f) => !configurePathOk(values[f]));
  const changedField = (f: (typeof fields)[number]) => values[f].trim() !== initial[f];
  const changed = fields.some(changedField);
  const save = () => {
    setBusy("save");
    // r270 (stored overrides known): only the changed fields; an absent one keeps its stored override. r269: every field.
    const send = exact ? fields.filter(changedField) : fields;
    void configureComponent(hostId, name, Object.fromEntries(send.map((f) => [f, values[f].trim() || null]))).finally(() => setBusy(null));
  };
  const reset = () => {
    setBusy("reset");
    void configureComponent(hostId, name, Object.fromEntries(stored.map((f) => [f, null]))).finally(() => setBusy(null));
  };
  const recheck = () => {
    setBusy("check");
    void requestComponent(hostId, name, "check").finally(() => setBusy(null));
  };
  return (
    <div className="rounded-md border border-border/70 px-3 py-2" data-component-configure={name}>
      <p className="text-xs font-medium">{t("modules.component.external.configure")}</p>
      {/* Stored on the host by cutex; new agents of this runtime start with them. */}
      <SettingsGroup agents="newAgents" source="host"><div className={`mt-1.5 grid gap-2 ${compact ? "" : "sm:grid-cols-[auto_1fr]"} items-center text-xs`}>
        {fields.map((f) => (
          <label key={f} className="contents">
            <span className="text-subtle">{t(FIELD_KEY[f])}</span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <input
                value={values[f]}
                onChange={(e) => setValues({ ...values, [f]: e.target.value })}
                placeholder={t(HINT_KEY[f])}
                spellCheck={false}
                aria-invalid={!configurePathOk(values[f])}
                className="min-w-0 rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent/60 aria-[invalid=true]:border-warn"
              />
              {/* r270: the path cutex actually uses, apart from what is stored (the input). Stored null: cutex found it itself. */}
              {form.resolved?.[f] && (
                <span className="min-w-0 text-subtle" data-external-resolved={f}>
                  {t(exact && form.storedValues?.[f] === null ? "modules.component.external.resolvedFound" : "modules.component.external.resolvedUsed")}{" "}
                  <span className="font-mono break-all select-all">{form.resolved[f]}</span>
                </span>
              )}
            </span>
          </label>
        ))}
      </div></SettingsGroup>
      {bad.length > 0 && <p className="mt-1 text-xs text-warn">{t("modules.component.external.absolute")}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button primary disabled={!changed || bad.length > 0 || busy !== null} onClick={save}>{t("modules.component.external.save")}</Button>
        <Button disabled={busy !== null} onClick={recheck}>{busy === "check" ? t("modules.component.external.checking") : t("modules.component.external.recheck")}</Button>
        {resettable && <Button disabled={busy !== null} onClick={reset} title={t("modules.component.external.resetHint")}>{t("modules.component.external.reset")}</Button>}
      </div>
      {resettable && <CopyBlock label={t("modules.component.external.resetCli")} text={componentClearCli(name, stored)} data={{ "data-external-reset-cli": name }} />}
    </div>
  );
}
