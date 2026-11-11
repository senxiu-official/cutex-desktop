// 百度网盘 Shelf page (side component, bound to a host). Top to bottom: the host and account line; then
// by connection state: the app form (no app saved), the Baidu login (device code: the owner opens Baidu's
// page and enters the code; we only poll), or the browser (search · breadcrumb · folders and files ·
// a file's details with 「下载到…」); at the bottom the host's downloads with progress, speed, time left
// and 暂停 / 继续 / 取消. Downloads run in that host's daemon, into a folder on that host (main's folder
// dialog for this machine, the in-app folder browser for a remote host, else a typed path).
// No upload, delete, rename or share. The feed and the login poll stop when the page is not on screen.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, Copy, Download, ExternalLink, File, Folder, FolderOpen, HardDrive, Loader2, LogIn, Pause, Play, RefreshCw, Search, X } from "lucide-react";
import { BAIDU_PAN_FEATURE, PAN_SEARCH_MAX, panActive, type PanDownload, type PanFile } from "../../../../shared/baiduPan";
import { LOCAL_HOST_ID, REMOTE_FEATURES } from "../../../../shared/hosts";
import { api } from "../../bridge";
import { Button, IconBtn, btnFace, btnShape } from "../../components/Button";
import { ArmedButton } from "../../components/ArmedButton";
import { TextInput } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { copyQuietly } from "../../lib/copyFeedback";
import { formatDate } from "../../lib/dateText";
import { useListHosts } from "../../lib/hostLists";
import { useOwnerDocument } from "../../lib/ownerContext";
import { pickDirectory } from "../../lib/remoteMode";
import { rowsOf } from "../../lib/viewHost";
import { featuresOf, sidebarOf, useApp } from "../../store";
import type { SideBodyProps } from "../slots";
import { baseName, controlsOf, crumbs, errorText, etaSeconds, fmtBytes, fmtEta, fmtRate, progressOf, STATE_KEY, targetDirProblem, vipKey } from "./model";
import { acquireFeed, cancelAuth, clearSearch, configure, control, disconnect, loadConnection, loadDownloads, loadMore, openDir, pollAuth, search, select, startAuth, startDownload, submitAuthCode, usePan, emptyHost, type HostPan } from "./store";

/** Persisted per page (small JSON): the chosen host and the last folder per host. */
export interface PanState {
  hostId?: string | null;
  targetDirs?: Record<string, string>;
}

const EMPTY = emptyHost();
const useHost = (hostId: string): HostPan => usePan((s) => s.hosts[hostId] ?? EMPTY);

/** The window is shown (document not hidden); polling stops otherwise. */
function useDocumentShown(): boolean {
  const doc = useOwnerDocument();
  const [shown, setShown] = useState(() => !doc.hidden);
  useEffect(() => {
    const on = () => setShown(!doc.hidden);
    on();
    doc.addEventListener("visibilitychange", on);
    return () => doc.removeEventListener("visibilitychange", on);
  }, [doc]);
  return shown;
}

export function PanPage({ hostId: bound, instance, setState, visible }: SideBodyProps<PanState>) {
  const { t } = useI18n();
  const state = instance.state ?? {};
  const list = useListHosts();
  const labels = useApp((s) => s.hosts?.hosts);
  const panHosts = useMemo(() => list.data.filter((d) => d.features.has(BAIDU_PAN_FEATURE)).map((d) => d.hostId), [list.data]);
  const hostId = [state.hostId, bound].find((h): h is string => !!h && panHosts.includes(h)) ?? panHosts[0] ?? bound ?? LOCAL_HOST_ID;
  const h = useHost(hostId);
  const shown = useDocumentShown();
  const live = visible && shown;

  useEffect(() => {
    if (live) void loadConnection(hostId);
  }, [hostId, live]);
  // Downloads follow the host's feed only while this page is on screen (released on hide / close).
  useEffect(() => (live && h.connection?.configured ? acquireFeed(hostId) : undefined), [hostId, live, h.connection?.configured]);

  const label = (id: string) => labels?.find((x) => x.id === id)?.label ?? id;
  const setHost = (id: string) => setState({ ...state, hostId: id });
  const refresh = async () => {
    const r = await loadConnection(hostId);
    if (r.ok && r.value.state === "connected") await (h.search ? search(hostId, h.search.key) : openDir(hostId, h.listing.dir));
    if (r.ok && r.value.configured) void loadDownloads(hostId);
  };
  const conn = h.connection;

  let body: ReactNode;
  if (!conn) body = h.connError ? <Problem text={errorText(t, h.connError)} retry={() => void loadConnection(hostId)} /> : <Loading />;
  else if (!conn.configured) body = <AppForm hostId={hostId} />;
  else if (conn.state !== "connected") body = <Login hostId={hostId} live={live} />;
  else body = <Browser hostId={hostId} state={state} setState={setState} />;

  return (
    <div className="flex h-full min-h-0 flex-col text-ui" data-baidu-pan={hostId}>
      <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        {panHosts.length > 1 ? (
          <select className="min-w-0 max-w-[45%] truncate rounded-md border border-border bg-transparent px-1.5 py-0.5 text-meta" aria-label={t("baidu-pan.host")} value={hostId} onChange={(e) => setHost(e.target.value)}>
            {panHosts.map((id) => <option key={id} value={id}>{label(id)}</option>)}
          </select>
        ) : (
          <span className="min-w-0 truncate text-meta text-muted" title={t("baidu-pan.host")}>{label(hostId)}</span>
        )}
        <Account conn={conn} />
        <span className="flex-1" />
        <IconBtn size="sm" label={t("baidu-pan.refresh")} onClick={() => void refresh()}><RefreshCw size={13} /></IconBtn>
        {conn?.configured && (
          <ArmedButton shape={btnShape({ size: "sm" })} idle={btnFace({ variant: "ghost" })} hint={t("baidu-pan.disconnectHint")} onConfirm={() => void disconnect(hostId)} testId="pan-disconnect">
            {t("baidu-pan.disconnect")}
          </ArmedButton>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      <Downloads hostId={hostId} downloads={h.downloads} feed={h.feed} error={h.downloadsError} />
    </div>
  );
}

function Account({ conn }: { conn: HostPan["connection"] }) {
  const { t } = useI18n();
  if (!conn?.account) return null;
  const vip = vipKey(conn.account.vipType);
  return (
    <span className="flex min-w-0 items-center gap-1 text-meta" data-pan-account>
      <span className="min-w-0 truncate">{conn.account.name}</span>
      {vip && <span className="shrink-0 rounded px-1 text-caption font-medium text-accent ring-1 ring-accent/40">{t(vip)}</span>}
    </span>
  );
}

const Loading = () => {
  const { t } = useI18n();
  return <div className="flex items-center gap-2 px-3 py-4 text-subtle"><Loader2 size={14} className="animate-spin" aria-hidden />{t("baidu-pan.loading")}</div>;
};

function Problem({ text, retry }: { text: string; retry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-start gap-2 px-3 py-4" role="alert">
      <span className="text-danger">{text}</span>
      {retry && <Button size="sm" onClick={retry}>{t("baidu-pan.retry")}</Button>}
    </div>
  );
}

/* ---- the app (first time on a host) ---- */

function AppForm({ hostId }: { hostId: string }) {
  const { t } = useI18n();
  const h = useHost(hostId);
  const [appId, setAppId] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const ready = appId.trim() && clientId.trim() && secret.trim() && !h.saving;
  const save = async () => {
    if (!ready) return;
    if (await configure(hostId, { appId, clientId, clientSecret: secret })) setSecret("");
  };
  return (
    <form className="flex flex-col gap-3 overflow-auto px-3 py-3" onSubmit={(e) => (e.preventDefault(), void save())} data-pan-app-form>
      <div>
        <div className="font-medium">{t("baidu-pan.setup.title")}</div>
        <p className="mt-1 text-meta text-subtle">{t("baidu-pan.setup.hint")}</p>
      </div>
      <Field label="AppId"><TextInput width="w-full" mono value={appId} onChange={setAppId} label="AppId" /></Field>
      <Field label={t("baidu-pan.setup.appKey")}><TextInput width="w-full" mono value={clientId} onChange={setClientId} label={t("baidu-pan.setup.appKey")} /></Field>
      <Field label={t("baidu-pan.setup.secret")} hint={t("baidu-pan.setup.secretHint")}><TextInput width="w-full" mono type="password" value={secret} onChange={setSecret} label={t("baidu-pan.setup.secret")} /></Field>
      {h.saveError && <span className="text-meta text-danger" role="alert">{errorText(t, h.saveError)}</span>}
      <div><Button type="submit" variant="primary" disabled={!ready}>{h.saving ? t("baidu-pan.saving") : t("baidu-pan.setup.save")}</Button></div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-meta text-muted">{label}</span>
      {children}
      {hint && <span className="text-caption text-subtle">{hint}</span>}
    </label>
  );
}

/* ---- Baidu login (device code) ---- */

function Login({ hostId, live }: { hostId: string; live: boolean }) {
  const { t } = useI18n();
  const h = useHost(hostId);
  const { auth, authPhase } = h;
  // Poll at the daemon's interval, only while the page is on screen.
  useEffect(() => {
    if (!live || authPhase !== "pending" || !auth) return;
    const timer = setInterval(() => void pollAuth(hostId), Math.max(5, auth.intervalSeconds) * 1000);
    return () => clearInterval(timer);
  }, [hostId, live, authPhase, auth]);
  const left = useCountdown(auth?.expiresAt ?? null, live && authPhase === "pending");

  if (authPhase === "pending" && auth)
    return (
      <div className="flex flex-col gap-3 overflow-auto px-3 py-3" data-pan-login="pending">
        <div className="font-medium">{t("baidu-pan.login.pendingTitle")}</div>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-meta">
          <li>
            {t("baidu-pan.login.step1")}
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Button size="sm" variant="primary" onClick={() => void api.openExternal(auth.verificationUrl)} title={auth.verificationUrl}><ExternalLink size={13} />{t("baidu-pan.login.open")}</Button>
              <Button size="sm" variant="ghost" onClick={() => void copyQuietly(auth.verificationUrl)}><Copy size={13} />{t("baidu-pan.login.copyLink")}</Button>
            </div>
          </li>
          <li>
            {t("baidu-pan.login.step2")}
            <div className="mt-1 flex items-center gap-2">
              <code className="rounded-md bg-surface px-2 py-1 font-mono text-title tracking-widest" data-pan-user-code>{auth.userCode}</code>
              <IconBtn size="sm" label={t("baidu-pan.login.copyCode")} onClick={() => void copyQuietly(auth.userCode)}><Copy size={13} /></IconBtn>
            </div>
          </li>
          <li>{t("baidu-pan.login.step3")}</li>
        </ol>
        <div className="flex items-center gap-2 text-meta text-subtle">
          <Loader2 size={13} className="animate-spin" aria-hidden />
          <span>{t("baidu-pan.login.waiting")}</span>
          {left !== null && <span className="tabular-nums">· {t("baidu-pan.login.expiresIn", { time: fmtEta(left) })}</span>}
        </div>
        {h.authError && <span className="text-meta text-warn-text">{errorText(t, h.authError)}</span>}
        <div><Button size="sm" variant="ghost" onClick={() => cancelAuth(hostId)}>{t("baidu-pan.cancel")}</Button></div>
      </div>
    );

  const again = authPhase === "expired" || authPhase === "failed";
  return (
    <div className="flex flex-col items-start gap-2 overflow-auto px-3 py-4" data-pan-login={authPhase}>
      <div className="font-medium">{h.connection?.state === "needsAuth" && h.connection.account ? t("baidu-pan.login.again") : t("baidu-pan.login.title")}</div>
      <p className="text-meta text-subtle">{t("baidu-pan.login.hint")}</p>
      {authPhase === "expired" && <span className="text-meta text-warn-text">{t("baidu-pan.login.expired")}</span>}
      {authPhase === "failed" && <span className="text-meta text-danger" role="alert">{errorText(t, h.authError) || t("baidu-pan.login.failed")}</span>}
      <Button variant="primary" disabled={authPhase === "starting"} onClick={() => void startAuth(hostId)} data-pan-login-start>
        <LogIn size={14} />{authPhase === "starting" ? t("baidu-pan.login.starting") : again ? t("baidu-pan.login.retry") : t("baidu-pan.login.start")}
      </Button>
      <CodeLogin hostId={hostId} busy={authPhase === "starting"} />
    </div>
  );
}

/** The authorization-code / OOB fallback, folded: for an old app the device code does not work with. */
function CodeLogin({ hostId, busy }: { hostId: string; busy: boolean }) {
  const { t } = useI18n();
  const [redirect, setRedirect] = useState("oob");
  const [code, setCode] = useState("");
  const submit = async () => {
    const c = code;
    setCode(""); // used once, never kept or shown again
    await submitAuthCode(hostId, c, redirect);
  };
  return (
    <details className="mt-2 w-full border-t border-border/60 pt-2 text-meta" data-pan-code-login>
      <summary className="cursor-pointer text-muted">{t("baidu-pan.code.title")}</summary>
      <form className="mt-2 flex flex-col gap-2" onSubmit={(e) => (e.preventDefault(), code.trim() && void submit())}>
        <p className="text-caption text-subtle">{t("baidu-pan.code.hint")}</p>
        <Field label={t("baidu-pan.code.redirect")} hint={t("baidu-pan.code.redirectHint")}><TextInput width="w-full" mono value={redirect} onChange={setRedirect} label={t("baidu-pan.code.redirect")} /></Field>
        <Field label={t("baidu-pan.code.code")}><TextInput width="w-full" mono type="password" value={code} onChange={setCode} label={t("baidu-pan.code.code")} /></Field>
        <div><Button size="sm" type="submit" disabled={busy || !code.trim()}>{t("baidu-pan.code.submit")}</Button></div>
      </form>
    </details>
  );
}

/** Whole seconds until `iso`, ticking each second while `on`. */
function useCountdown(iso: string | null, on: boolean): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  if (!iso) return null;
  const ms = Date.parse(iso) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : null;
}

/* ---- browse / search / details ---- */

function Browser({ hostId, state, setState }: { hostId: string; state: PanState; setState(s: PanState): void }) {
  const { t, locale } = useI18n();
  const h = useHost(hostId);
  const [key, setKey] = useState("");
  const { listing, search: found, selected } = h;
  useEffect(() => setKey(found?.key ?? ""), [hostId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (selected) return <Details hostId={hostId} file={selected} state={state} setState={setState} />;
  const files = found ? found.files : listing.files;
  const loading = found ? found.loading : listing.loading;
  const error = found ? found.error : listing.error;
  const tooLong = [...key.trim()].length > PAN_SEARCH_MAX;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form className="flex items-center gap-1 px-3 pt-2" onSubmit={(e) => (e.preventDefault(), !tooLong && void search(hostId, key))} role="search">
        <div className="relative min-w-0 flex-1">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-subtle" aria-hidden />
          <input className="h-7 w-full rounded-md border border-border bg-transparent pl-7 pr-2 text-ui outline-none focus:border-accent" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t("baidu-pan.search.placeholder")} aria-label={t("baidu-pan.search.label")} aria-invalid={tooLong} data-pan-search />
        </div>
        {found && <IconBtn size="sm" label={t("baidu-pan.search.clear")} onClick={() => (setKey(""), clearSearch(hostId))}><X size={13} /></IconBtn>}
      </form>
      {tooLong && <span className="px-3 pt-1 text-caption text-warn-text">{t("baidu-pan.search.tooLong", { max: PAN_SEARCH_MAX })}</span>}
      <nav className="flex min-w-0 flex-wrap items-center gap-0.5 px-3 py-1.5 text-meta" aria-label={t("baidu-pan.crumbs")} data-pan-crumbs>
        {crumbs(found ? found.dir : listing.dir).map((c, i, all) => (
          <span key={c.path} className="flex min-w-0 items-center gap-0.5">
            {i > 0 && <ChevronRight size={12} className="shrink-0 text-subtle" aria-hidden />}
            <button type="button" className={`min-w-0 truncate rounded px-1 hover:bg-hover ${i === all.length - 1 && !found ? "font-medium" : "text-muted"}`} onClick={() => void openDir(hostId, c.path)} aria-current={i === all.length - 1 && !found ? "page" : undefined}>
              {i === 0 ? t("baidu-pan.root") : c.name}
            </button>
          </span>
        ))}
        {found && <span className="text-subtle">· {t("baidu-pan.search.results", { key: found.key, n: found.files.length })}</span>}
      </nav>
      {found?.hasMore && <span className="px-3 pb-1 text-caption text-subtle">{t("baidu-pan.search.more")}</span>}
      <div className="min-h-0 flex-1 overflow-auto" data-pan-list>
        {error && <Problem text={errorText(t, error)} retry={() => void (found ? search(hostId, found.key) : openDir(hostId, listing.dir))} />}
        {!error && !loading && files.length === 0 && <div className="px-3 py-4 text-subtle">{found ? t("baidu-pan.search.none") : t("baidu-pan.empty")}</div>}
        <ul>
          {files.map((f) => (
            <li key={f.id}>
              <button type="button" className="flex w-full min-w-0 items-center gap-2 px-3 py-1 text-left hover:bg-hover" onClick={() => (f.isDir ? void openDir(hostId, f.path) : select(hostId, f))} title={f.path} data-pan-file={f.isDir ? "dir" : "file"}>
                {f.isDir ? <Folder size={15} className="shrink-0 text-accent" aria-hidden /> : <File size={15} className="shrink-0 text-subtle" aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                {!f.isDir && <span className="shrink-0 tabular-nums text-meta text-subtle">{fmtBytes(f.size)}</span>}
                <span className="w-[5.5rem] shrink-0 text-right tabular-nums text-caption text-subtle">{f.modifiedAt ? formatDate(f.modifiedAt * 1000, locale, { year: "numeric", month: "2-digit", day: "2-digit" }) : ""}</span>
              </button>
            </li>
          ))}
        </ul>
        {loading && <Loading />}
        {!found && listing.hasMore && !listing.loading && <div className="px-3 py-2"><Button size="sm" variant="ghost" onClick={() => void loadMore(hostId)}>{t("baidu-pan.more")}</Button></div>}
      </div>
    </div>
  );
}

function Details({ hostId, file, state, setState }: { hostId: string; file: PanFile; state: PanState; setState(s: PanState): void }) {
  const { t, locale } = useI18n();
  const h = useHost(hostId);
  const features = useApp((s) => featuresOf(s, hostId));
  const remote = hostId !== LOCAL_HOST_ID;
  const canPick = !remote || features.has(REMOTE_FEATURES.dirBrowse);
  const [dir, setDir] = useState(state.targetDirs?.[hostId] ?? "");
  const [done, setDone] = useState<PanDownload | null>(null);
  const problem = targetDirProblem(dir);
  const remember = (d: string) => setState({ ...state, targetDirs: { ...state.targetDirs, [hostId]: d } });
  const pick = async () => {
    const d = await pickDirectory(dir || null, hostId);
    if (d) (setDir(d), remember(d));
  };
  const start = async () => {
    if (problem) return;
    remember(dir.trim());
    const d = await startDownload(hostId, file, dir);
    if (d) setDone(d);
  };
  const meta: [MessageKey, string][] = [
    ["baidu-pan.details.path", file.path],
    ["baidu-pan.details.size", fmtBytes(file.size)],
    ["baidu-pan.details.modified", file.modifiedAt ? formatDate(file.modifiedAt * 1000, locale, { dateStyle: "medium", timeStyle: "short" }) : "—"],
  ];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-3 py-2" data-pan-details>
      <button type="button" className="flex items-center gap-1 self-start text-meta text-muted hover:text-foreground" onClick={() => select(hostId, null)}><ArrowLeft size={13} />{t("baidu-pan.back")}</button>
      <div className="flex min-w-0 items-start gap-2">
        <File size={18} className="mt-0.5 shrink-0 text-subtle" aria-hidden />
        <span className="min-w-0 break-all font-medium">{file.name}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta">
        {meta.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-subtle">{t(k)}</dt>
            <dd className="min-w-0 break-all">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
        <span className="text-meta text-muted">{t("baidu-pan.details.saveTo", { host: hostName(hostId) })}</span>
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1"><TextInput width="w-full" mono value={dir} onChange={setDir} placeholder={remote ? t("baidu-pan.details.pathPlaceholderRemote") : t("baidu-pan.details.pathPlaceholder")} label={t("baidu-pan.details.saveToLabel")} /></div>
          {canPick && <Button size="sm" onClick={() => void pick()}><FolderOpen size={13} />{t("baidu-pan.details.pick")}</Button>}
        </div>
        {dir && problem && <span className="text-caption text-warn-text">{t(problem === "dots" ? "baidu-pan.details.dots" : problem === "relative" ? "baidu-pan.details.relative" : "baidu-pan.details.emptyDir")}</span>}
        {!canPick && <span className="text-caption text-subtle">{t("baidu-pan.details.noBrowse")}</span>}
        <span className="text-caption text-subtle">{t("baidu-pan.details.noOverwrite")}</span>
        <div className="flex items-center gap-2">
          <Button variant="primary" disabled={!!problem || h.starting} onClick={() => void start()} data-pan-start><Download size={14} />{h.starting ? t("baidu-pan.details.starting") : t("baidu-pan.details.download")}</Button>
          {done && !h.startError && <span className="text-meta text-ok-text">{t("baidu-pan.details.started")}</span>}
        </div>
        {h.startError && <span className="text-meta text-danger" role="alert">{errorText(t, h.startError)}</span>}
      </div>
    </div>
  );
}

const hostName = (hostId: string) => useApp.getState().hosts?.hosts.find((x) => x.id === hostId)?.label ?? hostId;

/* ---- downloads ---- */

function Downloads({ hostId, downloads, feed, error }: { hostId: string; downloads: PanDownload[]; feed: HostPan["feed"]; error: HostPan["downloadsError"] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(true);
  const active = downloads.filter(panActive).length;
  if (!downloads.length && !error) return null;
  return (
    <section className="flex max-h-[45%] min-h-0 flex-col border-t border-border/60" aria-label={t("baidu-pan.downloads")} data-pan-downloads>
      <button type="button" className="flex items-center gap-2 px-3 py-1.5 text-left text-meta font-medium" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
        <span>{t("baidu-pan.downloads")}</span>
        {active > 0 && <span className="text-subtle">{t("baidu-pan.downloads.active", { n: active })}</span>}
        <span className="flex-1" />
        {feed === "retrying" && <span className="font-normal text-caption text-warn-text">{t("baidu-pan.downloads.reconnecting")}</span>}
      </button>
      {open && (
        <div className="min-h-0 overflow-auto pb-1">
          {error && <span className="block px-3 text-meta text-danger">{errorText(t, error)}</span>}
          <ul>{downloads.map((d) => <DownloadRow key={d.id} hostId={hostId} d={d} />)}</ul>
        </div>
      )}
    </section>
  );
}

function DownloadRow({ hostId, d }: { hostId: string; d: PanDownload }) {
  const { t } = useI18n();
  const agent = useApp((s) => (d.caller.kind === "agent" && d.caller.id ? rowsOf(sidebarOf(s, hostId)).find((r) => r.cutexSessionId === d.caller.id)?.displayName ?? null : null));
  const pct = progressOf(d);
  const eta = etaSeconds(d);
  const c = controlsOf(d);
  const busy = useRef(false);
  const act = (a: "pause" | "resume" | "cancel") => {
    if (busy.current) return;
    busy.current = true;
    void control(hostId, d.id, a).finally(() => (busy.current = false));
  };
  const tone = d.state === "failed" ? "bg-danger" : d.state === "completed" ? "bg-ok" : d.state === "paused" || d.state === "cancelled" ? "bg-subtle" : "bg-accent";
  const amounts = [d.totalBytes != null ? `${fmtBytes(d.downloadedBytes)} / ${fmtBytes(d.totalBytes)}` : fmtBytes(d.downloadedBytes), d.state === "downloading" && d.bytesPerSecond > 0 ? fmtRate(d.bytesPerSecond) : null, eta !== null ? t("baidu-pan.downloads.left", { time: fmtEta(eta) }) : null].filter(Boolean).join(" · ");
  return (
    <li className="flex flex-col gap-0.5 px-3 py-1.5" data-pan-download={d.state}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate" title={d.remote}>{baseName(d.remote)}</span>
        <span className={`shrink-0 text-caption ${d.state === "failed" ? "text-danger" : "text-subtle"}`}>{t(STATE_KEY[d.state])}{pct !== null && (d.state === "downloading" || d.state === "paused") ? ` ${Math.floor(pct)}%` : ""}</span>
        {c.pause && <IconBtn size="sm" label={t("baidu-pan.downloads.pause")} onClick={() => act("pause")}><Pause size={13} /></IconBtn>}
        {c.resume && <IconBtn size="sm" label={d.state === "failed" ? t("baidu-pan.downloads.retry") : t("baidu-pan.downloads.resume")} onClick={() => act("resume")}><Play size={13} /></IconBtn>}
        {c.cancel && <IconBtn size="sm" label={t("baidu-pan.downloads.cancel")} onClick={() => act("cancel")}><X size={13} /></IconBtn>}
        {d.state === "completed" && hostId === LOCAL_HOST_ID && <IconBtn size="sm" label={t("baidu-pan.downloads.reveal")} onClick={() => void api.revealPath(d.targetPath)}><FolderOpen size={13} /></IconBtn>}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct === null ? undefined : Math.round(pct)} aria-label={baseName(d.remote)}>
        <div className={`h-full rounded-full ${tone} ${pct === null && panActive(d) ? "w-1/3 animate-pulse" : ""}`} style={pct === null ? undefined : { width: `${pct}%` }} />
      </div>
      <div className="flex min-w-0 items-center gap-2 text-caption text-subtle">
        <span className="shrink-0 tabular-nums">{amounts}</span>
        <span className="flex min-w-0 items-center gap-1" title={d.targetPath}><HardDrive size={11} className="shrink-0" aria-hidden /><span className="min-w-0 truncate font-mono [direction:rtl] text-left"><bdi>{d.targetPath || d.targetDir}</bdi></span></span>
      </div>
      {agent !== null || d.caller.kind === "agent" ? <span className="text-caption text-subtle">{t("baidu-pan.downloads.byAgent", { name: agent ?? d.caller.id ?? "—" })}</span> : null}
      {d.error && <span className="text-caption text-danger">{errorText(t, d.error)}</span>}
    </li>
  );
}
