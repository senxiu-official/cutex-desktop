// Settings pages over cutex global settings (`/v2/settings`) and the shared user-level AGENTS.md
// (`/v2/user-instructions`): 新建默认 (new agent + quick-start defaults, auto
// titles), 指令 (AGENTS.md, 运行环境说明 = cutex agent-harness); plus the 协作 page's agent 间消息格式 (消息总线 lives in modules/agent-bus/BusSettings.tsx).
import { useEffect, useState } from "react";
import type { AgentHarnessPreview, AgentHarnessSectionId, GlobalSettings, ProfileItem, UserInstructions } from "../../../../shared/ipc";
import { useI18n } from "../../i18n";
import { AGENT_HARNESS_FEATURE, useGlobalSettings } from "../../lib/globalSettings";
import { pickHarnessAgent } from "../../lib/harnessPreview";
import { settingsAnchorId } from "../../lib/settingsNav";
import { AUTO_TITLES_FEATURE, QUICK_CHAT_PROFILE_FEATURE } from "../../lib/profileCreate";
import { useThreadDefaults } from "../../lib/threadDefaults";
import { useApp } from "../../store";
import { Button, EmptyState, ErrorNote, LinkRow, Loading, Notice, Section, Segmented, Select, SettingRow, TextField, Toggle } from "./Form";
import { ThreadDefaultRows } from "./ThreadDefaults";
import { useTargetApi, useTargetFeatures, useTargetHostId, useTargetSidebar, useTargetIsFocus } from "../../lib/targetHost";
import { useOrderedProfiles } from "../../lib/profileOrder";

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function useProfiles(): ProfileItem[] | null {
  const api = useTargetApi();
  const [profiles, setProfiles] = useState<ProfileItem[] | null>(null);
  useEffect(() => {
    api.listProfiles().then((r) => setProfiles(r?.profiles ?? []), () => setProfiles([]));
  }, []);
  // In the owner's manual profile order of that host (lib/profileOrder).
  return useOrderedProfiles(profiles, useTargetHostId());
}

/**
 * Settings → 新建默认. 新建 agent (default profile, ask-or-not, permission
 * defaults) and 快速启动 (its own profile + permission defaults; no scratch-folder row: cutex does not report the path), auto titles. The default model is
 * per profile (edited on the profile page).
 */
export function DefaultsPage() {
  const { t } = useI18n();
  const { settings, error, patch } = useGlobalSettings();
  const threads = useThreadDefaults();
  const profiles = useProfiles();
  const focus = useApp((s) => s.settingsFocus);
  // openSettings("defaults", { anchor: "quickWork" }) scrolls to the 快速启动 section.
  useEffect(() => {
    if (!focus?.anchor || !settings) return;
    document.getElementById(settingsAnchorId(focus.anchor))?.scrollIntoView({ block: "start" });
    useApp.setState({ settingsFocus: null });
  }, [focus, settings]);
  if (error && !settings) return <ErrorNote>{error}</ErrorNote>;
  if (!settings)
    return (
      <Section>
        <Loading rows={4} />
      </Section>
    );
  const names = (profiles ?? []).map((p) => p.name);
  return (
    <>
      {(error || threads.error) && <ErrorNote>{error ?? threads.error}</ErrorNote>}
      {!threads.supported && <Notice>{t("agent-config.threadDefaults.unsupported")}</Notice>}
      <Section id={settingsAnchorId("newAgent")} title={t("agent-config.defaults.newAgent")} hint={t("agent-config.defaults.newAgentHint")}>
        <SettingRow label={t("agent-config.defaults.profile")}>
          <Select value={settings.defaultProfile ?? ""} options={names.map((n) => ({ value: n, label: n }))} onChange={(v) => void patch({ defaultProfile: v })} />
        </SettingRow>
        <SettingRow label={t("agent-config.defaults.directLaunch")} hint={t("agent-config.defaults.directLaunchHint")}>
          <Toggle checked={settings.defaultProfileDirectLaunch} onChange={(v) => void patch({ defaultProfileDirectLaunch: v })} />
        </SettingRow>
        {threads.state && <ThreadDefaultRows kind="agent" current={threads.state.current.agent} builtin={threads.state.builtin.agent} onPatch={(f) => void threads.patch("agent", f)} />}
      </Section>
      <QuickWorkSection profiles={names} quickChatDefaultProfile={settings.quickChatDefaultProfile ?? null} onProfile={(v) => void patch({ quickChatDefaultProfile: v })} threads={threads} />
      <ThreadTitleSection />
    </>
  );
}

function QuickWorkSection({ profiles, quickChatDefaultProfile, onProfile, threads }: { profiles: string[]; quickChatDefaultProfile: string | null; onProfile(v: string | null): void; threads: ReturnType<typeof useThreadDefaults> }) {
  const { t } = useI18n();
  const hasProfile = useTargetFeatures().has(QUICK_CHAT_PROFILE_FEATURE);
  const current = quickChatDefaultProfile ?? "";
  // "" = follow the 新建 agent default; a profile that no longer exists still shows (cutex reports it).
  const options = [{ value: "", label: t("agent-config.quickChats.profileGlobal") }, ...[...new Set([...profiles, ...(current ? [current] : [])])].map((n) => ({ value: n, label: n }))];
  return (
    <Section id={settingsAnchorId("quickWork")} title={t("agent-config.quickChats")} hint={t("agent-config.quickChats.hint")}>
      <SettingRow label={t("agent-config.quickChats.profile")} hint={hasProfile ? t("agent-config.quickChats.profileHintOn") : t("agent-config.quickChats.profileHint")}>
        <Select disabled={!hasProfile} options={hasProfile ? options : options.slice(0, 1)} value={hasProfile ? current : ""} onChange={(v) => onProfile(v || null)} />
      </SettingRow>
      {threads.state && <ThreadDefaultRows kind="quickChat" current={threads.state.current.quickChat} builtin={threads.state.builtin.quickChat} onPatch={(f) => void threads.patch("quickChat", f)} />}
    </Section>
  );
}

/** 自动标题: `autoThreadTitles` / `threadTitleModel` (cutex auto-thread-titles). */
function ThreadTitleSection() {
  const { t } = useI18n();
  const supported = useTargetFeatures().has(AUTO_TITLES_FEATURE);
  const { settings, error, patch } = useGlobalSettings();
  if (!supported) return null;
  const enabled = settings?.autoThreadTitles ?? true;
  return (
    <Section id={settingsAnchorId("titles")} title={t("agent-config.titles")} hint={t("agent-config.titles.hint")}>
      {error && <ErrorNote>{error}</ErrorNote>}
      <SettingRow label={t("agent-config.titles.auto")}>
        <Toggle disabled={!settings} checked={enabled} onChange={(v) => void patch({ autoThreadTitles: v })} />
      </SettingRow>
      <SettingRow label={t("agent-config.titles.model")} hint={t("agent-config.titles.modelHint")}>
        <TextField mono maxLength={200} disabled={!settings || !enabled} placeholder={t("agent-config.titles.modelAuto")} value={settings?.threadTitleModel ?? ""} onCommit={(v) => patch({ threadTitleModel: v.trim() || null })} />
      </SettingRow>
    </Section>
  );
}

export function InstructionsPage() {
  const api = useTargetApi();
  const { t } = useI18n();
  const [doc, setDoc] = useState<UserInstructions | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const harness = useTargetFeatures().has(AGENT_HARNESS_FEATURE);
  useEffect(() => {
    api.userInstructions().then(
      (d) => {
        setDoc(d);
        setText(d.content);
      },
      (e: unknown) => setError(errorText(e)),
    );
  }, []);
  const save = async () => {
    if (!doc) return;
    setError(null);
    try {
      const next = await api.putUserInstructions(text, doc.revision);
      setDoc(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <>
      <Section
        id={settingsAnchorId("user")}
        title={t("agent-config.instructions.user")}
        hint={doc ? t(harness ? "agent-config.instructions.userHintBoth" : "agent-config.instructions.userHint", { path: doc.path }) : undefined}
        actions={
          <>
            {saved && <span className="text-xs text-subtle">{t("settings.saved")}</span>}
            <Button primary disabled={!doc || text === doc.content} onClick={() => void save()}>
              {t("settings.save")}
            </Button>
          </>
        }
      >
        {doc?.overrideActive && <Notice>{t("agent-config.instructions.override", { path: doc.overridePath })}</Notice>}
        {error && <ErrorNote>{error}</ErrorNote>}
        <textarea
          aria-label={t("agent-config.instructions.user")}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          className="my-2 h-80 w-full resize-y rounded-lg border border-border bg-background p-3 font-mono text-xs outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30"
        />
      </Section>
      {harness && <HarnessSection />}
    </>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

/**
 * 指令 → 运行环境说明 (cutex `agent-harness`): the `agentHarness.enabled` toggle (new runtimes only)
 * and a read-only preview of what cutex adds at launch for one agent (`GET /v2/sessions/{id}/harness`).
 */
function HarnessSection() {
  const api = useTargetApi();
  const { t } = useI18n();
  const { settings, error, patch } = useGlobalSettings();
  const agents = useTargetSidebar()?.active ?? [];
  // The selected agent is the focus host's (another host's settings start from its first agent).
  const isFocus = useTargetIsFocus();
  const focusSelected = useApp((s) => s.selectedId);
  const selectedId = isFocus ? focusSelected : null;
  const [picked, setPicked] = useState<string | null>(null);
  const agentId = pickHarnessAgent(
    picked,
    selectedId,
    agents.map((a) => a.cutexSessionId),
  );
  const agentName = agents.find((a) => a.cutexSessionId === agentId)?.displayName ?? null;
  const enabled = settings?.agentHarness?.enabled ?? settings?.agentHarnessDefault?.enabled ?? true;
  const [preview, setPreview] = useState<AgentHarnessPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [part, setPart] = useState("all");
  useEffect(() => {
    if (!agentId) return;
    let live = true;
    setPreviewError(null);
    api.agentHarness(agentId).then(
      (p) => live && setPreview(p),
      (e: unknown) => {
        if (!live) return;
        setPreview(null);
        setPreviewError(errorText(e));
      },
    );
    return () => {
      live = false;
    };
  }, [agentId, enabled]);
  const shown = preview && preview.cutexSessionId === agentId ? preview : null;
  const sectionTitle = (id: string) => (HARNESS_SECTIONS.includes(id) ? t(`agent-config.harness.section.${id as AgentHarnessSectionId}`) : id);
  const current = shown?.sections.find((s) => s.id === part) ?? null;
  const body = current ? current.text : (shown?.text ?? "");
  return (
    <Section id={settingsAnchorId("harness")} title={t("agent-config.harness")} hint={t("agent-config.harness.hint")}>
      {error && <ErrorNote>{error}</ErrorNote>}
      <SettingRow label={t("agent-config.harness.enabled")}>
        <Toggle disabled={!settings} checked={enabled} onChange={(v) => void patch({ agentHarness: { enabled: v } })} />
      </SettingRow>
      <SettingRow label={agentName ? t("agent-config.harness.previewFor", { name: agentName }) : t("agent-config.harness.preview")} hint={t("agent-config.harness.previewHint")}>
        {agents.length > 0 && (
          <Select
            label={t("agent-config.harness.agent")}
            value={agentId ?? ""}
            options={[...(agentId ? [] : [{ value: "", label: t("agent-config.harness.pickPlaceholder") }]), ...agents.map((a) => ({ value: a.cutexSessionId, label: a.displayName }))]}
            onChange={(v) => setPicked(v || null)}
          />
        )}
      </SettingRow>
      {agents.length === 0 && <EmptyState>{t("agent-config.harness.noAgents")}</EmptyState>}
      {agents.length > 0 && !agentId && <EmptyState>{t("agent-config.harness.pick")}</EmptyState>}
      {previewError && <ErrorNote>{previewError}</ErrorNote>}
      {agentId && !shown && !previewError && <Loading rows={3} />}
      {shown && (
        <div className="space-y-2 py-2">
          {!shown.enabled && <Notice tone="info">{t("agent-config.harness.off")}</Notice>}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
            <span className="font-medium text-foreground">{shown.runtime === "claude" ? "Claude" : "Codex"}</span>
            <span>·</span>
            <span>{t(`agent-config.harness.placement.${shown.placement}`)}</span>
            <span>·</span>
            <span>{t("agent-config.harness.total", { bytes: formatBytes(shown.bytes) })}</span>
          </div>
          {shown.runtime === "codex" && <div className="text-xs text-subtle">{t("agent-config.harness.codexNote")}</div>}
          <div className="flex overflow-x-auto">
            <Segmented
              label={t("agent-config.harness.preview")}
              value={current ? part : "all"}
              options={[{ value: "all", label: t("agent-config.harness.all") }, ...shown.sections.map((s) => ({ value: s.id, label: sectionTitle(s.id) }))]}
              onChange={setPart}
            />
          </div>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            <span className="font-medium">{current ? sectionTitle(current.id) : t("agent-config.harness.all")}</span>
            <span className="font-mono text-subtle">{formatBytes(current ? current.bytes : shown.bytes)}</span>
          </div>
          <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs whitespace-pre-wrap break-words">{body}</pre>
        </div>
      )}
    </Section>
  );
}

const HARNESS_SECTIONS: readonly string[] = ["cutex", "agentsMdUser", "agentsMdProject", "fileReferences", "memory"] satisfies AgentHarnessSectionId[];

/** 协作 → agent 间消息格式: prefix / suffix around forwarded agent messages, saved on Enter / blur.
 *  Gone with cutex `agent-harness` (r218 drops the templates); shown while the settings carry them. */
export function MessageTemplatesSection() {
  const { t } = useI18n();
  const { settings, error, patch } = useGlobalSettings();
  const harness = useTargetFeatures().has(AGENT_HARNESS_FEATURE);
  if (harness || (settings && !("agentMessagePrefixTemplate" in settings) && !("agentMessageSuffixTemplate" in settings))) return null;
  return (
    <Section id={settingsAnchorId("templates")} title={t("agent-config.instructions.templates")} hint={t("agent-config.instructions.templatesHint")}>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!settings && !error && <Loading rows={2} />}
      {settings && (
        <>
          <SettingRow label={t("agent-config.instructions.prefix")}>
            <TextField mono value={settings.agentMessagePrefixTemplate ?? ""} onCommit={(v) => patch({ agentMessagePrefixTemplate: v || null })} />
          </SettingRow>
          <SettingRow label={t("agent-config.instructions.suffix")}>
            <TextField mono value={settings.agentMessageSuffixTemplate ?? ""} onCommit={(v) => patch({ agentMessageSuffixTemplate: v || null })} />
          </SettingRow>
        </>
      )}
    </Section>
  );
}

