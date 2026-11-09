// 转为智能体… for a quick chat (lib/quickChatPromote, cutex quick-chat-promote-v1): an own name (unique on the host)
// and 独立 or a project (the shared searchable picker); a running chat is stopped first, after the owner's click.
// The conversation, its history and the session ID stay; on success the sidebar shows it as an agent in place.
import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { closeDialog } from "../lib/contextMenu";
import { captureHostAction, onHostReset } from "../lib/hostSwitch";
import { isImeComposing } from "../lib/ime";
import { useUiPrefs } from "../lib/prefs";
import { securityProjectIds } from "../lib/securityPicker";
import { chatRunning, newPromoteRequest, promoteNameProblem, sendPromote, sessionOn, stopChat, takenNamesOn, type PromoteOutcome } from "../lib/quickChatPromote";
import { isQuickChat } from "../lib/sidebar";
import { sidebarOf, useApp } from "../store";
import { FORMAL_NAME_MAX } from "../../../shared/agentRename";
import { promoteErrorKey, type PromoteRequest } from "../../../shared/quickChatPromote";
import { Button } from "./Button";
import { SearchableSelect, type SearchablePickerOption } from "./SearchablePicker";

const STANDALONE = "";
/** cutex's placeholder thread name ("Session 01a110ec"): not offered as the agent's name. */
const PLACEHOLDER = /^Session [0-9a-f]{8}$/;

export function QuickChatPromoteDialog({ sessionId, hostId, resolve }: { sessionId: string; hostId: string; resolve(value: null): void }) {
  const { t } = useI18n();
  const session = useApp((s) => [...(sidebarOf(s, hostId)?.active ?? [])].find((x) => x.cutexSessionId === sessionId) ?? null);
  const sidebar = useApp((s) => sidebarOf(s, hostId));
  const { projectOrder } = useUiPrefs();
  const [name, setName] = useState(() => {
    const shown = session?.displayName?.trim() ?? "";
    return shown && !PLACEHOLDER.test(shown) ? shown : "";
  });
  const [projectId, setProjectId] = useState(STANDALONE);
  const [busy, setBusy] = useState<null | "stopping" | "promoting">(null);
  const [outcome, setOutcome] = useState<Extract<PromoteOutcome, { ok: false }> | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const current = useRef(captureHostAction(hostId));
  const mounted = useRef(true);
  const alive = () => mounted.current && current.current();
  const close = () => { closeDialog(); resolve(null); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => onHostReset((host) => { if (host === hostId) close(); }), [hostId]);

  const projects = sidebar?.projects?.projects ?? [];
  const options = useMemo<SearchablePickerOption[]>(() => {
    const byId = new Map(projects.filter((p) => p.lifecycle === "active").map((p) => [p.project_id, p]));
    return [
      { value: STANDALONE, label: t("promote.standalone"), group: "" },
      ...securityProjectIds(sidebar, projectOrder ?? [], hostId).filter((id) => byId.has(id)).map((id) => ({
        value: id, label: byId.get(id)!.presentation.display_name || id, group: t("promote.projects"), searchText: id,
      })),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, sidebar, projectOrder, hostId, t]);
  const taken = useMemo(() => takenNamesOn(hostId, sessionId), [sidebar, hostId, sessionId]);
  const problem = promoteNameProblem(name, taken);
  const running = !!session && chatRunning(session);
  // The request 重试 sends again unchanged (an uncertain answer, or `complete: false`).
  const pending = outcome?.error.retrySame ? outcome.request : null;
  const stillChat = !!session && isQuickChat(session, sidebar?.hostRows?.[sessionId]);

  async function promote(request: PromoteRequest) {
    setBusy("promoting");
    setOutcome(null);
    const result = await sendPromote(hostId, sessionId, request);
    if (!alive()) return;
    setBusy(null);
    if (result.ok) setDone(result.result.name);
    else setOutcome(result);
  }

  async function submit() {
    if (busy || !session) return;
    if (pending) return void promote(pending);
    if (problem) return;
    try {
      if (running) {
        setBusy("stopping");
        await stopChat(hostId, session);
        if (!alive()) return;
      }
      const fresh = sessionOn(hostId, sessionId) ?? session;
      await promote(newPromoteRequest(fresh, name, projectId || null));
    } catch (e) {
      if (!alive()) return;
      setBusy(null);
      setOutcome({ ok: false, error: { code: "stop", message: e instanceof Error ? e.message : String(e), retrySame: false }, request: newPromoteRequest(session, name, projectId || null) });
    }
  }

  const where = projectId ? (projects.find((p) => p.project_id === projectId)?.presentation.display_name ?? projectId) : null;
  if (done)
    return (
      <div className="space-y-3 text-sm" data-testid="quick-chat-promote-dialog" data-done="">
        <h2 className="flex items-center gap-1.5 font-medium text-foreground">
          <Bot size={14} className="text-subtle" />
          {t("promote.title")}
        </h2>
        <p role="status">{t(where ? "promote.doneProject" : "promote.done", { name: done, project: where ?? "" })}</p>
        <div className="flex justify-end">
          <Button variant="primary" onClick={close}>{t("promote.close")}</Button>
        </div>
      </div>
    );

  const errorText = outcome && (outcome.error.code === "incomplete"
    ? t("promote.error.incomplete")
    : outcome.error.code === "stop"
      ? t("promote.error.stopFailed", { message: outcome.error.message })
      : t(promoteErrorKey(outcome.error.code) as MessageKey, { message: outcome.error.message }));
  const nameHint = problem === "taken" ? t("promote.name.taken") : problem === "tooLong" ? t("promote.name.tooLong", { max: FORMAL_NAME_MAX }) : problem === "control" ? t("promote.name.control") : null;
  const blocked = !!busy || !session || !stillChat || (!pending && !!problem);
  return (
    <form
      className="space-y-3 text-sm"
      data-testid="quick-chat-promote-dialog"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <h2 className="flex items-center gap-1.5 font-medium text-foreground">
          <Bot size={14} className="text-subtle" />
          {t("promote.title")}
        </h2>
        <p className="mt-1 text-xs text-muted">{t("promote.hint")}</p>
      </div>
      {!session && <p className="text-xs text-danger-text" role="alert">{t("promote.error.sessionGone")}</p>}
      <label className="block space-y-1">
        <span className="text-xs text-muted">{t("promote.name")}</span>
        <input
          autoFocus
          value={name}
          disabled={!!busy || !!pending}
          maxLength={FORMAL_NAME_MAX * 2}
          onChange={(e) => { setName(e.target.value); setOutcome(null); }}
          onKeyDown={(e) => { if (isImeComposing(e)) e.stopPropagation(); }}
          placeholder={t("promote.namePlaceholder")}
          aria-invalid={!!nameHint}
          className="w-full rounded-md border border-border bg-background px-2 py-1 outline-none focus:border-accent"
        />
        <span className={`block text-xs ${nameHint ? "text-warn-text" : "text-subtle"}`}>{nameHint ?? t("promote.nameHint")}</span>
      </label>
      <div className="space-y-1">
        <span className="block text-xs text-muted">{t("promote.where")}</span>
        <SearchableSelect
          value={projectId}
          options={options}
          onChange={(v) => { setProjectId(v); setOutcome(null); }}
          disabled={!!busy || !!pending}
          width="w-80"
          triggerClassName="flex w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-2 py-1 text-sm outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-50"
          label={t("promote.where")}
          placeholder={t("promote.searchProjects")}
          emptyLabel={t("agentPicker.empty")}
        />
      </div>
      {running && !pending && <p className="rounded-md bg-warn/10 px-2 py-1.5 text-xs text-warn-text">{t(session?.runtime.activeTurnId ? "promote.runningBusy" : "promote.running")}</p>}
      {errorText && <p className={`text-xs ${outcome!.error.retrySame ? "text-warn-text" : "text-danger-text"}`} role="alert">{errorText}</p>}
      <div className="flex items-center justify-end gap-2">
        {busy && (
          <span className="mr-auto flex items-center gap-1.5 text-xs text-muted">
            <Loader2 size={12} className="animate-spin" />
            {t(busy === "stopping" ? "promote.stopping" : "promote.promoting")}
          </span>
        )}
        <Button variant="ghost" type="button" onClick={close}>{t("promote.cancel")}</Button>
        <Button variant="primary" type="submit" disabled={blocked}>
          {t(pending ? "promote.retry" : running ? "promote.stopAndSubmit" : "promote.submit")}
        </Button>
      </div>
    </form>
  );
}
