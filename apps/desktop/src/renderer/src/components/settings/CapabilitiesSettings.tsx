// Settings → Agent capabilities: MCP servers, skills, hooks — cute-codex global config on the
// shared CODEX_HOME via cutex `POST /v2/codex/requests` (DESIGN §7 gap 21). Changes reach agents
// on their next launch / resume (the page header says so: source tag "Codex 设置 · host").
// Writes are `config/batchWrite` edits built in lib/codexTools.ts (secrets are never written back).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Pencil, X } from "lucide-react";
import type { ConfigEdit, HookMetadata, HooksListResponse, ListMcpServerStatusResponse, McpServerConnectionStatus, McpServerStatus, SkillMetadata, SkillScope, SkillsListResponse } from "@cutex-desktop/protocol/codex/v2";
import type { DaemonApi, FsFile } from "../../../../shared/ipc";
import { useI18n, type MessageKey } from "../../i18n";
import { settingsAnchorId } from "../../lib/settingsNav";
import {
  emptyMcpDraft,
  groupHooks,
  hookEnabledEdit,
  hookHandlerText,
  hookNeedsReview,
  hookRevokeEdits,
  hookTrustEdits,
  HOOK_TRUST_TONE,
  mcpDraftErrors,
  mcpDraftFrom,
  mcpServerEdits,
  quoteKey,
  setToolEnabled,
  skillMdPath,
  stripFrontMatter,
  toolEnabled,
  type HookGroup,
  type MapEntry,
  type McpDraft,
  type McpServerConfig,
} from "../../lib/codexTools";
import { HOST_FILE_READ_FEATURE } from "../../lib/workspace";
import { Markdown } from "../Markdown";
import { AddButton, ArmedRemove, Button, EmptyState, ErrorNote, IconButton, LinkRow, ListRow, Loading, NumberField, RefreshButton, Section, Segmented, SettingRow, TextArea, TextInput, Toggle } from "./Form";
import { useTargetApi, useTargetFeatures } from "../../lib/targetHost";
import { useApp } from "../../store";
import { SKILLS_ARCHIVE_FEATURE, type SkillArchiveRecord, type SkillArchiveResult } from "../../../../shared/skillsArchive";
import { ArchivedSkills, ArchiveSkillButton } from "./SkillsArchive";

type McpConfig = Record<string, McpServerConfig>;

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** `config/batchWrite` on the shared CODEX_HOME config.toml. */
async function writeCodexConfig(api: DaemonApi, edits: ConfigEdit[]): Promise<void> {
  if (edits.length) await api.codexRequest("config/batchWrite", { edits });
}

/**
 * 「{{agent}}跟随共享配置」 is set once, on 插件 (FollowSharedSection); MCP / 技能 / 钩子 show its state
 * and a link there (settings audit 2026-10-15 #29). Hidden on a cutex whose settings lack the field.
 */
function FollowSharedLink() {
  const api = useTargetApi();
  const { t } = useI18n();
  const openSettings = useApp((s) => s.openSettings);
  const [follow, setFollow] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    api.getSettings().then((s) => setFollow(s.codexConfigFollowShared), () => setFollow(undefined));
  }, []);
  if (follow === undefined) return null;
  return (
    <Section>
      <LinkRow
        label={t("codex-config.plugins.follow")}
        hint={t(follow ? "codex-config.plugins.followOn" : "codex-config.plugins.followOff")}
        link={t("codex-config.plugins.followLink")}
        onClick={() => openSettings("plugins")}
      />
    </Section>
  );
}

function useCodex<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    load().then(setData, (e: unknown) => setError(errorText(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(reload, [reload]);
  return { data, error, reload, setError };
}

const STATUS_COLOR: Record<McpServerConnectionStatus, string> = {
  notStarted: "text-subtle",
  starting: "text-muted",
  connected: "text-accent",
  authenticationRequired: "text-warn",
  failed: "text-danger",
  cancelled: "text-subtle",
  disabled: "text-subtle",
};

/** A labelled block whose control is too wide for a SettingRow's right column (lists, maps). */
function FieldBlock({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="border-b border-border py-2.5 last:border-b-0">
      <div className="text-sm">{label}</div>
      {hint && <div className="text-xs text-subtle">{hint}</div>}
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

/** Key / value rows (env, headers). Existing secrets show "已设置 · 修改" and are never prefilled. */
function MapEditor({ entries, onChange, secret, keyPlaceholder, valuePlaceholder }: { entries: MapEntry[]; onChange(next: MapEntry[]): void; secret?: boolean; keyPlaceholder: string; valuePlaceholder: string }) {
  const { t } = useI18n();
  const patch = (i: number, p: Partial<MapEntry>) => onChange(entries.map((e, j) => (j === i ? { ...e, ...p } : e)));
  return (
    <div className="space-y-1.5">
      {entries.map((e, i) => (
        <div key={i} className="flex items-center gap-2">
          {e.existing ? (
            <span className="w-48 truncate font-mono text-xs" title={e.key}>
              {e.key}
            </span>
          ) : (
            <TextInput mono width="w-48" label={keyPlaceholder} value={e.key} onChange={(v) => patch(i, { key: v })} placeholder={keyPlaceholder} />
          )}
          {e.kept ? (
            <span className="flex w-56 items-center gap-1.5 text-xs text-subtle">
              {t("codex-config.mcp.secretSet")} ·
              <button className="rounded text-accent hover:underline focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none" onClick={() => patch(i, { kept: false, value: "" })}>
                {t("codex-config.mcp.secretChange")}
              </button>
            </span>
          ) : (
            <TextInput mono width="w-56" autoFocus={e.existing && secret} type={secret ? "password" : "text"} label={`${e.key || keyPlaceholder} ${valuePlaceholder}`} value={e.value} onChange={(v) => patch(i, { value: v })} placeholder={valuePlaceholder} />
          )}
          {e.existing && secret && !e.kept && (
            <button className="rounded text-xs text-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none" onClick={() => patch(i, { kept: true, value: "" })}>
              {t("codex-config.mcp.secretKeep")}
            </button>
          )}
          <IconButton label={t("codex-config.mcp.removeEntry", { name: e.key || keyPlaceholder })} danger onClick={() => onChange(entries.filter((_, j) => j !== i))}>
            <X size={14} />
          </IconButton>
        </div>
      ))}
      <AddButton onClick={() => onChange([...entries, { key: "", value: "", existing: false, kept: false }])}>{t("codex-config.mcp.addEntry")}</AddButton>
    </div>
  );
}

/** Add / edit form at the top of the "configured" card. `name` null = new server. */
function McpServerForm({ name: editing, original, tools, taken, onDone }: { name: string | null; original: McpServerConfig | null; tools: string[]; taken: string[]; onDone(saved: boolean): void }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const [name, setName] = useState(editing ?? "");
  const [draft, setDraft] = useState<McpDraft>(() => (original ? mcpDraftFrom(original) : emptyMcpDraft()));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<McpDraft>) => setDraft((d) => ({ ...d, ...p }));
  const problems = mcpDraftErrors(draft);
  const nameProblem = editing ? null : !/^[A-Za-z0-9_-]+$/.test(name) ? "invalid" : taken.includes(name) ? "taken" : null;
  const toolNames = [...new Set([...tools, ...(draft.enabledTools ?? []), ...draft.disabledTools])].sort();
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await writeCodexConfig(api, mcpServerEdits(editing ?? name, original, draft));
      onDone(true);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="-mx-4 border-b border-border bg-surface-2/50 px-4 pt-2 pb-3">
      <div className="flex h-7 items-center gap-2">
        <h4 className="min-w-0 truncate text-sm font-medium">{editing ? t("codex-config.mcp.editTitle", { name: editing }) : t("codex-config.mcp.add")}</h4>
        <span className="text-xs text-subtle">{t("codex-config.mcp.restartNote")}</span>
      </div>
      {!editing && (
        <SettingRow label={t("codex-config.mcp.name")} hint={nameProblem === "taken" ? <span className="text-danger">{t("codex-config.mcp.nameTaken")}</span> : undefined}>
          <TextInput mono width="w-48" value={name} onChange={setName} placeholder="my-server" />
        </SettingRow>
      )}
      <SettingRow label={t("codex-config.mcp.transport")}>
        <Segmented value={draft.transport} options={[{ value: "stdio", label: "stdio" }, { value: "http", label: "HTTP" }]} onChange={(v) => set({ transport: v })} />
      </SettingRow>
      {draft.transport === "stdio" ? (
        <>
          <SettingRow label={t("codex-config.mcp.command")}>
            <TextInput mono value={draft.command} onChange={(v) => set({ command: v })} placeholder="npx" />
          </SettingRow>
          <SettingRow label={t("codex-config.mcp.args")} hint={t("codex-config.mcp.argsHint")}>
            <TextArea mono rows={Math.min(8, Math.max(2, draft.args.split("\n").length + 1))} value={draft.args} onChange={(v) => set({ args: v })} placeholder={"-y\n@scope/server"} />
          </SettingRow>
          <SettingRow label={t("codex-config.mcp.cwd")}>
            <TextInput mono value={draft.cwd} onChange={(v) => set({ cwd: v })} placeholder={t("codex-config.mcp.optional")} />
          </SettingRow>
          <FieldBlock label={t("codex-config.mcp.env")} hint={t("codex-config.mcp.secretHint")}>
            <MapEditor secret entries={draft.env} onChange={(env) => set({ env })} keyPlaceholder="NAME" valuePlaceholder={t("codex-config.mcp.value")} />
          </FieldBlock>
        </>
      ) : (
        <>
          <SettingRow label="URL">
            <TextInput mono width="w-64" value={draft.url} onChange={(v) => set({ url: v })} placeholder="https://…/mcp" />
          </SettingRow>
          <SettingRow label={t("codex-config.mcp.tokenEnv")} hint={t("codex-config.mcp.tokenEnvHint")}>
            <TextInput mono value={draft.bearerTokenEnvVar} onChange={(v) => set({ bearerTokenEnvVar: v })} placeholder="MY_TOKEN" />
          </SettingRow>
          <FieldBlock label={t("codex-config.mcp.headers")} hint={t("codex-config.mcp.secretHint")}>
            <MapEditor secret entries={draft.httpHeaders} onChange={(httpHeaders) => set({ httpHeaders })} keyPlaceholder="Header" valuePlaceholder={t("codex-config.mcp.value")} />
          </FieldBlock>
          <FieldBlock label={t("codex-config.mcp.envHeaders")} hint={t("codex-config.mcp.envHeadersHint")}>
            <MapEditor entries={draft.envHttpHeaders} onChange={(envHttpHeaders) => set({ envHttpHeaders })} keyPlaceholder="Header" valuePlaceholder="ENV_VAR" />
          </FieldBlock>
        </>
      )}
      <SettingRow label={t("codex-config.mcp.startupTimeout")}>
        <NumberField value={draft.startupTimeoutSec} range={[1, 3600]} unit={t("codex-config.mcp.seconds")} placeholder="—" onCommit={(v) => set({ startupTimeoutSec: v })} />
      </SettingRow>
      <SettingRow label={t("codex-config.mcp.toolTimeout")}>
        <NumberField value={draft.toolTimeoutSec} range={[1, 86400]} unit={t("codex-config.mcp.seconds")} placeholder="—" onCommit={(v) => set({ toolTimeoutSec: v })} />
      </SettingRow>
      {editing && (
        <FieldBlock label={t("codex-config.mcp.toolsTitle")} hint={toolNames.length ? t("codex-config.mcp.toolsHint") : t("codex-config.mcp.toolsUnknown")}>
          {toolNames.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-x-4 gap-y-1">
              {toolNames.map((tool) => (
                <label key={tool} className="flex min-w-0 items-center gap-2 py-0.5">
                  <Toggle label={tool} checked={toolEnabled(draft, tool)} onChange={(on) => setDraft((d) => setToolEnabled(d, tool, on))} />
                  <span className="min-w-0 truncate font-mono text-xs" title={tool}>
                    {tool}
                  </span>
                </label>
              ))}
            </div>
          )}
        </FieldBlock>
      )}
      {problems.includes("duplicateKey") && <ErrorNote>{t("codex-config.mcp.duplicateKey")}</ErrorNote>}
      {problems.includes("redacted") && <ErrorNote>{t("codex-config.mcp.redactedValue")}</ErrorNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex justify-end gap-2 pt-2">
        <Button disabled={busy} onClick={() => onDone(false)}>
          {t("settings.cancel")}
        </Button>
        <Button primary disabled={busy || !!nameProblem || problems.length > 0} onClick={() => void save()}>
          {t("settings.save")}
        </Button>
      </div>
    </div>
  );
}

function BuiltinMcp() {
  const api = useTargetApi();
  const { t } = useI18n();
  const managed = useCodex(() => api.managedMcp());
  const [open, setOpen] = useState<string | null>(null);
  const servers = managed.data?.servers ?? [
    { name: "cutex", approvalMode: "approve", toolsSource: "daemon", tools: null },
    { name: "cutex_job", approvalMode: "auto", toolsSource: "external", tools: null, configured: false },
  ];
  return (
    <Section id={settingsAnchorId("builtin")} title={t("codex-config.mcp.builtin")} hint={t("codex-config.mcp.builtinHint")}>
      {servers.map((s) => (
        <ListRow
          key={s.name}
          title={s.name}
          detail={<span className="block whitespace-normal">{s.name === "cutex" ? t("codex-config.mcp.builtin.cutex") : t("codex-config.mcp.builtin.job")}</span>}
          actions={
            s.tools ? (
              <button aria-expanded={open === s.name} onClick={() => setOpen(open === s.name ? null : s.name)} className="flex items-center gap-0.5 rounded text-xs text-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">
                {t("settings.mcp.tools", { n: s.tools.length })}
                {open === s.name ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            ) : (
              <span className="text-xs text-subtle">{s.configured === false ? t(s.name === "cutex_job" ? "codex-config.mcp.jobNotInstalled" : "codex-config.mcp.notConfigured") : "—"}</span>
            )
          }
          below={
            open === s.name && s.tools ? (
              <div className="mt-2 mb-1 space-y-1 rounded-lg bg-surface-2 p-2">
                {s.tools.map((tool) => (
                  <div key={tool.name} className="text-xs">
                    <span className="font-mono text-foreground">{tool.name}</span> <span className="text-subtle">{tool.description}</span>
                  </div>
                ))}
              </div>
            ) : undefined
          }
        />
      ))}
    </Section>
  );
}

const toolNamesOf = (st: McpServerStatus | undefined): string[] => (st ? Object.entries(st.tools).map(([key, tool]) => tool?.name ?? key) : []);

export function McpPage() {
  const api = useTargetApi();
  const { t } = useI18n();
  const config = useCodex(async () => {
    const r = (await api.codexRequest("config/read", {})) as { config: { mcp_servers?: McpConfig } };
    return r.config.mcp_servers ?? {};
  });
  const status = useCodex(async () => (await api.codexRequest("mcpServerStatus/list", { detail: "toolsAndAuthOnly" })) as ListMcpServerStatusResponse);
  /** The form at the top of the card: "" = add, a name = edit, null = closed. */
  const [form, setForm] = useState<string | null>(null);
  const reloadAll = () => {
    config.reload();
    status.reload();
  };
  const write = async (edits: ConfigEdit[]) => {
    try {
      await writeCodexConfig(api, edits);
      reloadAll();
    } catch (e) {
      config.setError(errorText(e));
    }
  };
  const login = async (name: string) => {
    try {
      const r = (await api.codexRequest("mcpServer/oauth/login", { name })) as { authorizationUrl: string };
      window.open(r.authorizationUrl, "_blank");
    } catch (e) {
      config.setError(errorText(e));
    }
  };
  const statusOf = (name: string): McpServerStatus | undefined => status.data?.data.find((s) => s.name === name);
  const names = Object.keys(config.data ?? {}).sort();
  const serverPath = (name: string) => `mcp_servers.${quoteKey(name)}`;
  return (
    <>
      <FollowSharedLink />
      <Section
        id={settingsAnchorId("configured")}
        title={t("codex-config.mcp.configured")}
        hint={t("codex-config.mcp.scopedHint")}
        actions={
          <>
            <RefreshButton onClick={() => void api.codexRequest("config/mcpServer/reload").then(reloadAll, (e: unknown) => config.setError(errorText(e)))} />
            <AddButton disabled={form !== null} onClick={() => setForm("")}>
              {t("codex-config.mcp.add")}
            </AddButton>
          </>
        }
      >
        {form !== null && config.data && (
          <McpServerForm
            key={form}
            name={form || null}
            original={form ? (config.data[form] ?? null) : null}
            tools={form ? toolNamesOf(statusOf(form)) : []}
            taken={names}
            onDone={(saved) => {
              setForm(null);
              if (saved) reloadAll();
            }}
          />
        )}
        {config.error && <ErrorNote>{config.error}</ErrorNote>}
        {!config.data && !config.error && <Loading />}
        {config.data && names.length === 0 && form === null && <EmptyState>{t("codex-config.mcp.none")}</EmptyState>}
        {names.map((name) => {
          const cfg = config.data![name]!;
          const st = statusOf(name);
          const tools = st ? Object.keys(st.tools).length : null;
          const runtime = st?.runtimeStatus ?? null;
          return (
            <ListRow
              key={name}
              title={<span className="font-mono">{name}</span>}
              detail={[cfg.url ?? [cfg.command, ...(cfg.args ?? [])].filter(Boolean).join(" "), tools !== null ? t("settings.mcp.tools", { n: tools }) : null].filter(Boolean).join(" · ")}
              actions={
                <>
                  {runtime && <span className={`text-xs ${STATUS_COLOR[runtime] ?? "text-muted"}`}>{t(`codex-config.mcp.status.${runtime}` as MessageKey)}</span>}
                  {st && (st.authStatus === "notLoggedIn" || runtime === "authenticationRequired") && <Button onClick={() => void login(name)}>{t("codex-config.mcp.login")}</Button>}
                  <IconButton label={t("codex-config.mcp.edit", { name })} disabled={form !== null} onClick={() => setForm(name)}>
                    <Pencil size={13} />
                  </IconButton>
                  <Toggle label={name} checked={cfg.enabled !== false} onChange={(v) => void write([{ keyPath: `${serverPath(name)}.enabled`, value: v, mergeStrategy: "replace" }])} />
                  <ArmedRemove title={t("codex-config.mcp.remove", { name })} onRemove={() => void write([{ keyPath: serverPath(name), value: null, mergeStrategy: "replace" }])} />
                </>
              }
              below={st?.toolsError ? <p className="pb-1 text-xs break-words whitespace-pre-wrap text-danger">{st.toolsError}</p> : undefined}
            />
          );
        })}
      </Section>
      <BuiltinMcp />
    </>
  );
}

const SCOPES: SkillScope[] = ["user", "repo", "admin", "system"];
const SKILL_MAX_BYTES = 256 * 1024;

/** SKILL.md through cutex `GET /v2/fs/file` (host path), read-only. */
function SkillContent({ path }: { path: string }) {
  const api = useTargetApi();
  const { t } = useI18n();
  const [file, setFile] = useState<FsFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.hostFile(skillMdPath(path), SKILL_MAX_BYTES).then(setFile, (e: unknown) => setError(errorText(e)));
  }, [path]);
  return (
    <div className="mb-2 max-h-[28rem] overflow-y-auto rounded-lg bg-surface-2 px-3 py-2">
      <p className="mb-1 truncate font-mono text-[11px] text-subtle" title={skillMdPath(path)}>
        {skillMdPath(path)}
      </p>
      {!file && !error && <p className="text-xs text-subtle">{t("codex-config.skills.loading")}</p>}
      {error && <ErrorNote>{error}</ErrorNote>}
      {file && file.encoding === "utf8" && <Markdown text={stripFrontMatter(file.content)} compact />}
      {file?.truncated && <p className="pt-1 text-xs text-subtle">{t("codex-config.skills.truncated")}</p>}
    </div>
  );
}

export function SkillsPage() {
  const api = useTargetApi();
  const { t } = useI18n();
  const features = useTargetFeatures();
  const canRead = features.has(HOST_FILE_READ_FEATURE);
  const canArchive = features.has(SKILLS_ARCHIVE_FEATURE);
  const skills = useCodex(async () => (await api.codexRequest("skills/list", { forceReload: false })) as SkillsListResponse);
  const archives = useCodex(async () => (await api.skillArchives())?.archives ?? []);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const refusalText = (r: Extract<SkillArchiveResult, { ok: false }>) =>
    r.error.code === "skill_name_taken" ? t("codex-config.skills.error.nameTaken") : r.error.code === "skill_not_archivable" ? t("codex-config.skills.error.notArchivable") : r.error.message;
  /** Archive / restore, then re-scan (cutex stops the warm config app-server; forceReload covers an older one). */
  const runArchive = async (key: string, call: () => Promise<SkillArchiveResult>) => {
    setBusy(key);
    setArchiveError(null);
    try {
      const r = await call();
      if (!r.ok) setArchiveError(refusalText(r));
      await api.codexRequest("skills/list", { forceReload: true }).catch(() => undefined);
      skills.reload();
      archives.reload();
    } catch (e) {
      setArchiveError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const archiveSkill = (skill: SkillMetadata) => runArchive(skill.path, () => api.archiveSkill(skill.path));
  const restoreSkill = (record: SkillArchiveRecord) => runArchive(record.id, () => api.restoreSkill(record.id));
  const toggle = async (skill: SkillMetadata, enabled: boolean) => {
    try {
      await api.codexRequest("skills/config/write", { path: skill.path, enabled });
      skills.reload();
    } catch (e) {
      skills.setError(errorText(e));
    }
  };
  const all = skills.data?.data.flatMap((entry) => entry.skills) ?? [];
  const errors = skills.data?.data.flatMap((entry) => entry.errors) ?? [];
  const byScope = new Map<SkillScope, SkillMetadata[]>();
  for (const s of all) byScope.set(s.scope, [...(byScope.get(s.scope) ?? []), s]);
  const scopes = [...byScope.keys()].sort((a, b) => SCOPES.indexOf(a) - SCOPES.indexOf(b));
  return (
    <>
      <FollowSharedLink />
      {skills.error && <ErrorNote>{skills.error}</ErrorNote>}
      {archiveError && <ErrorNote>{archiveError}</ErrorNote>}
      {!skills.data && !skills.error && (
        <Section>
          <Loading rows={3} />
        </Section>
      )}
      {skills.data && all.length === 0 && (
        <Section actions={<RefreshButton onClick={skills.reload} />}>
          <EmptyState>{t("codex-config.skills.none")}</EmptyState>
        </Section>
      )}
      {scopes.map((scope, i) => (
        <Section key={scope} title={t(`codex-config.skills.scope.${scope}` as MessageKey)} actions={i === 0 ? <RefreshButton onClick={skills.reload} /> : undefined}>
          {byScope.get(scope)!.map((s) => (
            <div key={s.path}>
              <SettingRow label={s.interface?.displayName ?? s.name} hint={s.interface?.shortDescription ?? s.shortDescription ?? s.description}>
                {s.pluginId && <span className="text-[11px] text-subtle">{s.pluginId}</span>}
                {canRead && (
                  <button aria-expanded={open === s.path} onClick={() => setOpen(open === s.path ? null : s.path)} className="flex items-center gap-0.5 rounded text-xs whitespace-nowrap text-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:outline-none">
                    {open === s.path ? t("codex-config.skills.hide") : t("codex-config.skills.view")}
                    {open === s.path ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                )}
                {canArchive && s.scope === "user" && !s.pluginId && <ArchiveSkillButton name={s.interface?.displayName ?? s.name} disabled={busy !== null} onArchive={() => void archiveSkill(s)} />}
                <Toggle label={s.name} checked={s.enabled} onChange={(v) => void toggle(s, v)} />
              </SettingRow>
              {open === s.path && <SkillContent path={s.path} />}
            </div>
          ))}
        </Section>
      ))}
      {canArchive && <ArchivedSkills archives={archives.data ?? []} busy={busy} onRestore={(r) => void restoreSkill(r)} />}
      {errors.length > 0 && (
        <Section title={t("codex-config.codex.errors")}>
          {errors.map((e, i) => (
            <p key={i} className="py-1 font-mono text-xs break-words text-danger">
              {JSON.stringify(e)}
            </p>
          ))}
        </Section>
      )}
    </>
  );
}

function hookGroupLabel(g: HookGroup, t: ReturnType<typeof useI18n>["t"]): string {
  return g.kind === "plugin" ? t("codex-config.hooks.group.plugin", { name: g.pluginId ?? "?" }) : t(`codex-config.hooks.group.${g.kind}` as MessageKey);
}

function HookRow({ hook, busy, onWrite }: { hook: HookMetadata; busy: boolean; onWrite(edits: ConfigEdit[]): void }) {
  const { t } = useI18n();
  const title = `${t(`codex-config.hooks.event.${hook.eventName}` as MessageKey)}${hook.matcher ? ` · ${hook.matcher}` : ""}`;
  const handler = hookHandlerText(hook);
  return (
    <ListRow
      title={title}
      detail={
        <span className="font-mono" title={`${handler}\n${hook.sourcePath}`}>
          {hook.handlerType === "mcpTool" ? `MCP · ${handler}` : handler}
        </span>
      }
      actions={
        <>
          <span className={`text-xs ${HOOK_TRUST_TONE[hook.trustStatus]}`}>{t(`codex-config.hooks.trust.${hook.trustStatus}` as MessageKey)}</span>
          {!hook.isManaged && hookNeedsReview(hook) && (
            <Button disabled={busy} onClick={() => onWrite(hookTrustEdits([hook]))}>
              {t("codex-config.hooks.trust")}
            </Button>
          )}
          {!hook.isManaged && hook.trustStatus === "trusted" && (
            <Button disabled={busy} onClick={() => onWrite(hookRevokeEdits([hook]))}>
              {t("codex-config.hooks.revoke")}
            </Button>
          )}
          {/* An untrusted / modified hook does not run whatever its switch says: shown off until trusted. */}
          {!hook.isManaged && hookNeedsReview(hook) ? (
            <span title={t("codex-config.hooks.runsOnceTrusted")}>
              <Toggle label={title} disabled checked={false} onChange={() => {}} />
            </span>
          ) : (
            <Toggle label={title} disabled={busy || hook.isManaged} checked={hook.enabled} onChange={(v) => onWrite([hookEnabledEdit(hook.key, v)])} />
          )}
        </>
      }
    />
  );
}

export function HooksPage() {
  const api = useTargetApi();
  const { t } = useI18n();
  const hooks = useCodex(async () => (await api.codexRequest("hooks/list", {})) as HooksListResponse);
  const [busy, setBusy] = useState(false);
  const groups = groupHooks(hooks.data?.data ?? []);
  const all = groups.flatMap((g) => g.hooks);
  const pending = all.filter((h) => !h.isManaged && hookNeedsReview(h));
  const warnings = hooks.data?.data.flatMap((e) => e.warnings) ?? [];
  const errors = hooks.data?.data.flatMap((e) => e.errors) ?? [];
  const write = async (edits: ConfigEdit[]) => {
    setBusy(true);
    try {
      await writeCodexConfig(api, edits);
      hooks.reload();
    } catch (e) {
      hooks.setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <FollowSharedLink />
      <Section
        title={t("codex-config.hooks")}
        hint={hooks.data && groups.every((g) => g.kind === "plugin") ? t("codex-config.hooks.viaPlugins") : undefined}
        actions={
          <>
            {pending.length > 0 && (
              <Button disabled={busy} onClick={() => void write(hookTrustEdits(pending))}>
                {t("codex-config.hooks.trustAll", { n: pending.length })}
              </Button>
            )}
            <RefreshButton onClick={hooks.reload} />
          </>
        }
      >
        {hooks.error && <ErrorNote>{hooks.error}</ErrorNote>}
        {!hooks.data && !hooks.error && <Loading />}
        {hooks.data && all.length === 0 && <EmptyState>{t("codex-config.hooks.none")}</EmptyState>}
        {groups.map((g) => (
          <div key={g.id}>
            <div className="-mx-4 flex h-7 items-center gap-2 border-b border-border bg-surface-2/50 px-4 text-xs font-medium text-muted">
              <span className="min-w-0 truncate">{hookGroupLabel(g, t)}</span>
              <span className="text-subtle">{g.hooks.length}</span>
            </div>
            {g.hooks.map((h) => (
              <HookRow key={h.key} hook={h} busy={busy} onWrite={(edits) => void write(edits)} />
            ))}
          </div>
        ))}
        {warnings.map((w, i) => (
          <p key={`w${i}`} className="py-1 text-xs break-words text-warn">
            {w}
          </p>
        ))}
        {errors.map((e, i) => (
          <p key={`e${i}`} className="py-1 font-mono text-xs break-words text-danger">
            {e.path}: {e.message}
          </p>
        ))}
      </Section>
    </>
  );
}
