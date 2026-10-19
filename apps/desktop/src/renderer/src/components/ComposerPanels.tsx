// Panels the slash commands open above the composer: /status, /memories, /experimental, plus the
// read-only project memory viewer ("+" → 记忆 → 项目记忆).
// Same frame as the palette (rounded-xl border bg-surface shadow); Esc / ✕ / outside click close.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { ExperimentalFeaturesView, ProjectMemoryView } from "../../../shared/ipc";
import { useI18n } from "../i18n";
import { confirmDialog } from "../lib/contextMenu";
import { describeError } from "../lib/agentFeatures";
import { hostApi, unsupportedNotice } from "../store";
import { convApi, useConvScope } from "../lib/conversationScope";
import { useConvHost } from "../lib/conversationScope";
import { services } from "../modules/app";
import { hostPageParam } from "../lib/targetHost";
import { ProjectMemoryList } from "./ProjectMemory";

function Panel({ title, onClose, actions, tall, children }: { title: string; onClose(): void; actions?: ReactNode; tall?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} className={`absolute right-0 bottom-full left-0 z-30 mb-1.5 ${tall ? "max-h-[60vh]" : "max-h-96"} overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl`}>
      <div className="flex items-center gap-2 px-2.5 pt-1.5 pb-1 text-xs text-subtle">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {actions}
        <button onClick={onClose} title={t("common.close")} className="rounded p-0.5 hover:text-foreground">
          <X size={13} />
        </button>
      </div>
      <div className="px-2.5 pb-2">{children}</div>
    </div>
  );
}

export interface StatusRow {
  label: string;
  value: string;
  tone?: "warn" | "accent";
}

export function StatusPanel({ rows, onClose }: { rows: StatusRow[]; onClose(): void }) {
  const { t } = useI18n();
  return (
    <Panel title={t("slash.status.title")} onClose={onClose}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <dt className="text-subtle">{r.label}</dt>
            <dd className={`min-w-0 truncate ${r.tone === "warn" ? "text-warn" : r.tone === "accent" ? "text-accent" : ""}`} title={r.value}>
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export function MemoriesPanel({ sessionId, threadId, onClose }: { sessionId: string; threadId: string; onClose(): void }) {
  const conv = useConvScope();
  const { t } = useI18n();
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const run = async (fn: () => Promise<void>, done: string) => {
    try {
      await fn();
      setStatus({ text: done, error: false });
    } catch (e) {
      // "Not available for this agent" (Claude) reads as information, not as a failure.
      const d = describeError(e, unsupportedNotice);
      setStatus({ text: d.text, error: !d.unsupported });
    }
  };
  const btn = "rounded-md bg-surface-2 px-2 py-1 text-xs hover:text-foreground";
  return (
    <Panel title={t("slash.memories.title")} onClose={onClose}>
      <p className="mb-2 text-xs text-subtle">{t("slash.memories.hint")}</p>
      <div className="flex flex-wrap gap-1.5">
        <button className={btn} onClick={() => void run(() => convApi(conv, sessionId).setMemoryMode(sessionId, threadId, "enabled"), t("slash.memories.enabledDone"))}>
          {t("slash.memories.enable")}
        </button>
        <button className={btn} onClick={() => void run(() => convApi(conv, sessionId).setMemoryMode(sessionId, threadId, "disabled"), t("slash.memories.disabledDone"))}>
          {t("slash.memories.disable")}
        </button>
        <button
          className={`${btn} text-danger`}
          onClick={() =>
            void (async () => {
              if (await confirmDialog(t("slash.memories.resetConfirm"), true)) await run(() => convApi(conv, sessionId).resetMemory(sessionId), t("slash.memories.resetDone"));
            })()
          }
        >
          {t("slash.memories.reset")}
        </button>
      </div>
      {status && <p className={`mt-2 text-xs ${status.error ? "text-danger" : "text-muted"}`}>{status.text}</p>}
    </Panel>
  );
}

/** Project memory, read-only and without leaving the conversation; editing lives on the Projects page. */
export function ProjectMemoryPanel({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose(): void }) {
  const { t } = useI18n();
  const [memory, setMemory] = useState<ProjectMemoryView | null | undefined>(undefined);
  // The open agent's project: on that agent's host.
  const hostId = useConvHost();
  useEffect(() => {
    let cancelled = false;
    setMemory(undefined);
    hostApi(hostId).projectMemory(projectId).then(
      (m) => !cancelled && setMemory(m),
      () => !cancelled && setMemory(null),
    );
    return () => {
      cancelled = true;
    };
  }, [hostId, projectId]);
  return (
    <Panel
      tall
      title={`${t("projects.memory")} · ${projectName}`}
      onClose={onClose}
      actions={
        <button
          onClick={() => {
            onClose();
            services.ui.openPage("projects.page", { project: projectId, tab: "memory", ...hostPageParam(hostId) });
          }}
          className="shrink-0 text-accent hover:underline"
        >
          {t("composer.tools.memory.editInProject")} →
        </button>
      }
    >
      <p className="text-[11px] text-subtle">{t("composer.tools.memory.projectReadOnly")}</p>
      <ProjectMemoryList hostId={hostId} projectId={projectId} memory={memory} indexOpenInitially />
    </Panel>
  );
}

export function ExperimentalPanel({ sessionId, threadId, onClose }: { sessionId: string; threadId: string | null; onClose(): void }) {
  const conv = useConvScope();
  const { t } = useI18n();
  const [view, setView] = useState<ExperimentalFeaturesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => convApi(conv, sessionId).experimentalFeatures(sessionId, threadId).then(setView, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, threadId]);
  const toggle = async (name: string, enabled: boolean) => {
    try {
      await convApi(conv, sessionId).setExperimentalFeature(name, enabled);
      setView((v) => (v ? { ...v, features: v.features.map((f) => (f.name === name ? { ...f, enabled } : f)) } : v));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Panel title={t("slash.experimental.title")} onClose={onClose}>
      <p className="mb-2 text-xs text-subtle">{t(view?.source === "config" ? "slash.experimental.configHint" : "slash.experimental.hint")}</p>
      {!view && !error && <p className="text-xs text-subtle">{t("common.loading")}</p>}
      {view && view.features.length === 0 && <p className="text-xs text-subtle">{t("slash.experimental.none")}</p>}
      {view?.features.map((f) => (
        <label key={f.name} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 hover:bg-surface-2">
          <input type="checkbox" className="mt-1" checked={f.enabled} onChange={(e) => void toggle(f.name, e.target.checked)} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm">
              {f.displayName ?? f.name}
              {f.stage && <span className="ml-1.5 text-[11px] text-subtle">{f.stage}</span>}
            </span>
            {f.description && <span className="block text-xs text-subtle">{f.description}</span>}
          </span>
        </label>
      ))}
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </Panel>
  );
}
