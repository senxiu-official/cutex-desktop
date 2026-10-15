// Settings → NCI 远程作业 (module nci, host page; cutex inbound-mail, optional nci-verification /
// nci-host-keygen): a step-by-step setup guide. Each step shows done / todo from GET /v2/inbound-mail
// and GET /v2/nci-verification (lib/nciSetup.ts):
// ① cutex generates the dedicated Gadi key on the host (the private half never leaves cutex)
// ② on Gadi: the qstat-only helper script + the restricted authorized_keys line (Gadi home filled in)
// ③ Gadi host keys (pasted ssh-keyscan lines, fingerprints, "checked against NCI's" box)
// ④ Gadi username — ③④ and the key are saved together (useGeneratedKey); advanced: a key file
//   chosen by main (never shown here)
// ⑤ the PBS mailbox (IMAP; write-only app password) and the address agents get
// ⑥ test the mailbox, turn the Gadi check on.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Circle, Copy } from "lucide-react";
import type { JobResult } from "../../../../shared/ipc";
import { INBOUND_MAIL_FEATURE, NCI_HOST_KEYGEN_FEATURE, NCI_MAIL_ADDRESS_FEATURE, NCI_VERIFICATION_FEATURE, type InboundMailStatus, type NciHelper, type NciVerificationStatus } from "../../../../shared/remoteJobs";
import { MaskedText } from "../../components/MaskedText";
import { ArmedRemove, Button, ErrorNote, Loading, Notice, Section, Select, SettingRow, TextArea, TextInput, Toggle } from "../../components/settings/Form";
import { useI18n, type MessageKey } from "../../i18n";
import { copyText } from "../../lib/menus";
import { authorizedKeysFor, hasNciKey, nciSteps, normalizeGadiHome, sshFingerprint, type NciStepId, type NciStepState } from "../../lib/nciSetup";
import { intervalLabel, mailboxDraft, mailPasswordRequired, mailToView, NCI_MODULE, parseHostKeys, validMailAddress } from "../../lib/remoteJobs";
import { settingsAnchorId } from "../../lib/settingsNav";
import { useTargetApi, useTargetFeatures, useTargetHostId } from "../../lib/targetHost";
import { formatAbsolute, formatWhen, useClock } from "../../lib/time";
import { useHostData } from "../../lib/useHostScope";
import { useModulePref } from "../react";

const INTERVALS = [1800, 3600, 3 * 3600, 6 * 3600, 12 * 3600, 86400, 7 * 86400];
const NUMBERS = ["①", "②", "③", "④", "⑤", "⑥"];
// Search anchors, spelled out so settings search can find them (test/settingsSearch.test.ts).
const ANCHORS: Record<NciStepId, string> = {
  key: settingsAnchorId("nci-key"),
  gadi: settingsAnchorId("nci-gadi"),
  hostKeys: settingsAnchorId("nci-host-keys"),
  username: settingsAnchorId("nci-username"),
  mailbox: settingsAnchorId("nci-mailbox"),
  enable: settingsAnchorId("nci-enable"),
};
const KNOWN_CODES = new Set([
  "mail_authentication_failed",
  "mail_connection_failed",
  "mail_protocol_failed",
  "mail_fetch_failed",
  "mail_password_required",
  "invalid_mail_config",
  "mail_not_configured",
  "nci_verification_unavailable",
  "job_service_unavailable",
  "job_service_source_disabled",
  "qstat_host_key_confirmation_required",
  "qstat_private_key_required",
  "qstat_private_key_encrypted",
  "qstat_invalid_private_key",
  "qstat_invalid_host_key",
  "qstat_invalid_config",
  "qstat_not_configured",
  "qstat_key_exists",
  "invalid_reply",
  "unsupported",
]);

type Note = { tone: "ok" | "error"; text: string } | null;

function useCodeText() {
  const { t } = useI18n();
  return (code: string | null | undefined, message?: string) => {
    if (!code) return "";
    if (KNOWN_CODES.has(code)) return t(`nci.code.${code}` as MessageKey);
    return message && message !== code ? `${code}: ${message}` : code;
  };
}

function NoteLine({ note }: { note: Note }) {
  if (!note) return null;
  return <p className={`my-2 text-xs ${note.tone === "ok" ? "text-muted" : "text-danger"}`}>{note.text}</p>;
}

function CopyButton({ text, label, disabled }: { text: string | null; label?: string; disabled?: boolean }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1500);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <Button
      disabled={disabled || !text}
      onClick={() => {
        if (!text) return;
        copyText(text);
        setDone(true);
      }}
    >
      <span className="inline-flex items-center gap-1">
        {done ? <Check size={12} /> : <Copy size={12} />}
        {done ? t("nci.copied") : (label ?? t("nci.copy"))}
      </span>
    </Button>
  );
}

/** A long value (a key, a line) across the card's full width, with a copy button. */
function BlockRow({ label, hint, text, copyLabel }: { label: ReactNode; hint?: ReactNode; text: string; copyLabel?: string }) {
  return (
    <div className="border-b border-border py-2.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm">{label}</div>
          {hint && <div className="text-xs text-subtle">{hint}</div>}
        </div>
        <CopyButton text={text} label={copyLabel} />
      </div>
      <div className="mt-1.5 rounded-md bg-background px-2 py-1.5 font-mono text-xs break-all select-text">{text}</div>
    </div>
  );
}

/** Plain text paragraph inside a card (hint-like, but part of the step). */
function Para({ children, tone }: { children: ReactNode; tone?: "warn" | "danger" }) {
  return <p className={`py-2 text-xs ${tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-subtle"}`}>{children}</p>;
}

function StateBadge({ state }: { state: NciStepState }) {
  const { t } = useI18n();
  const tone =
    state === "done" ? "bg-ok/15 text-ok" : state === "todo" ? "bg-accent/15 text-accent" : state === "manual" ? "bg-warn/15 text-warn" : "bg-surface-2 text-subtle";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {state === "done" ? <Check size={11} /> : <Circle size={9} />}
      {t(`nci.state.${state}` as MessageKey)}
    </span>
  );
}

/** Loads one status of the target host; a reply from before a host switch is dropped. */
function useStatus<T>(load: (() => Promise<JobResult<T>>) | null) {
  const hostId = useTargetHostId();
  const connected = useHostData(hostId)?.daemon.kind === "connected";
  const [value, setValue] = useState<T | null | undefined>(undefined);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(() => {
    const mine = ++seq.current;
    const fn = loadRef.current;
    if (!fn) return;
    fn()
      .then((r) => {
        if (mine !== seq.current) return;
        if (r.ok) (setValue(r.value), setError(null));
        else (setValue(null), setError({ code: r.code, message: r.message }));
      })
      .catch((e: unknown) => mine === seq.current && (setValue(null), setError({ code: "unreachable", message: e instanceof Error ? e.message : String(e) })));
  }, []);
  useEffect(() => {
    seq.current++;
    setValue(undefined);
    setError(null);
    if (connected && load) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on host / connection change
  }, [hostId, connected, !!load, reload]);
  // A write's reply replaces the value; it also invalidates a load still in flight.
  const set = useCallback((v: T) => {
    seq.current++;
    setValue(v);
    setError(null);
  }, []);
  return { value, set, error, reload, guard: () => seq.current };
}
type Status<T> = ReturnType<typeof useStatus<T>>;

/** One step's card: ① title + state badge. */
function Step({ id, index, state, title, hint, children }: { id: NciStepId; index: number; state: NciStepState; title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <Section id={ANCHORS[id]} title={`${NUMBERS[index]} ${title}`} hint={hint} actions={<StateBadge state={state} />}>
      {children}
    </Section>
  );
}

// ---------- ① key ----------

function KeyStep({ nci, state, keygen }: { nci: Status<NciVerificationStatus>; state: NciStepState; keygen: boolean }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const codeText = useCodeText();
  const status = nci.value ?? null;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const has = hasNciKey(status);
  const generate = async (replace: boolean) => {
    const mine = nci.guard();
    setBusy(true);
    setNote(null);
    try {
      const r = await api.generateNciKey(replace);
      if (mine !== nci.guard()) return;
      if (r.ok) (nci.set(r.value), setNote({ tone: "ok", text: t("nci.key.generated") }));
      else setNote({ tone: "error", text: codeText(r.code, r.message) });
    } catch (e) {
      setNote({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  return (
    <Step id="key" index={0} state={state} title={t("nci.key.title")} hint={t("nci.key.hint")}>
      {nci.error && <ErrorNote>{codeText(nci.error.code, nci.error.message)}</ErrorNote>}
      {nci.value === undefined && !nci.error && <Loading rows={2} />}
      {status && has && status.publicKey && (
        <>
          <BlockRow
            label={t("nci.key.publicKey")}
            hint={status.keySource ? t(`nci.key.source.${status.keySource}` as MessageKey) : undefined}
            text={status.publicKey}
          />
          {status.publicKeyFingerprint && (
            <SettingRow label={t("nci.key.fingerprint")}>
              <MaskedText value={status.publicKeyFingerprint} className="font-mono text-xs text-muted" copy testId="nci-key-fingerprint" />
            </SettingRow>
          )}
          {status.pendingGeneratedKey && <Para tone="warn">{t("nci.key.pending")}</Para>}
        </>
      )}
      {nci.value !== undefined && !keygen && <Para>{t("nci.noKeygen")}</Para>}
      {status && keygen && (
        <>
          {!has && <Para>{t("nci.key.advancedPointer")}</Para>}
          {confirming && <Para tone="warn">{t("nci.key.regenerateConfirm")}</Para>}
          <NoteLine note={note} />
          <div className="flex items-center justify-end gap-2 py-2">
            {!has && (
              <Button primary disabled={busy} onClick={() => void generate(false)}>
                {t("nci.key.generate")}
              </Button>
            )}
            {has && !confirming && (
              <Button disabled={busy} onClick={() => setConfirming(true)}>
                {t("nci.key.regenerate")}
              </Button>
            )}
            {has && confirming && (
              <>
                <Button disabled={busy} onClick={() => setConfirming(false)}>
                  {t("nci.cancel")}
                </Button>
                <Button primary disabled={busy} onClick={() => void generate(true)}>
                  {t("nci.key.regenerateOk")}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </Step>
  );
}

// ---------- ② on Gadi ----------

function GadiStep({ nci, state, keygen }: { nci: Status<NciVerificationStatus>; state: NciStepState; keygen: boolean }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const codeText = useCodeText();
  const hostId = useTargetHostId();
  const [home, setHome] = useModulePref<string>(NCI_MODULE, `gadiHome:${hostId}`, "");
  const [helper, setHelper] = useState<NciHelper | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState(false);
  const status = nci.value ?? null;
  const line = authorizedKeysFor(status, home);
  const homeBad = home.trim() !== "" && !normalizeGadiHome(home);
  const loadHelper = async (): Promise<NciHelper | null> => {
    if (helper) return helper;
    const r = await api.nciHelper();
    if (r.ok) {
      setHelper(r.value);
      return r.value;
    }
    setNote({ tone: "error", text: t("nci.gadi.helperFailed", { error: codeText(r.code, r.message) }) });
    return null;
  };
  const copyHelper = async () => {
    setBusy(true);
    setNote(null);
    try {
      const h = await loadHelper();
      if (h) (copyText(h.script), setNote({ tone: "ok", text: t("nci.copied") }));
    } finally {
      setBusy(false);
    }
  };
  const saveHelper = async () => {
    setBusy(true);
    setNote(null);
    try {
      void loadHelper();
      const r = await api.saveNciHelper();
      if (r.ok) setNote({ tone: "ok", text: t("nci.gadi.helperSaved", { path: r.value.path }) });
      else if (r.code !== "cancelled") setNote({ tone: "error", text: t("nci.gadi.helperFailed", { error: codeText(r.code, r.message) }) });
    } catch (e) {
      setNote({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Step id="gadi" index={1} state={state} title={t("nci.gadi.title")} hint={t("nci.gadi.hint")}>
      {keygen && (
        <div className="border-b border-border py-2.5">
          <div className="text-sm">{t("nci.gadi.helper")}</div>
          <div className="text-xs text-subtle">{t("nci.gadi.helperHint", { path: helper?.installPath ?? "~/.cutex/nci-qstat-only.py" })}</div>
          {helper && <div className="mt-1 font-mono text-[11px] break-all text-subtle select-text">{t("nci.gadi.helperSha", { sha: helper.sha256 })}</div>}
          <NoteLine note={note} />
          <div className="mt-2 flex items-center justify-end gap-2">
            <Button disabled={busy} onClick={() => void copyHelper()}>
              {t("nci.gadi.helperCopy")}
            </Button>
            <Button disabled={busy} onClick={() => void saveHelper()}>
              {t("nci.gadi.helperSave")}
            </Button>
          </div>
        </div>
      )}
      <SettingRow label={t("nci.gadi.home")} hint={homeBad ? <span className="text-danger">{t("nci.gadi.homeInvalid")}</span> : t("nci.gadi.homeHint")}>
        <TextInput value={home} onChange={(v) => setHome(v.trim())} placeholder="/home/123/ab1234" mono width="w-56" label={t("nci.gadi.home")} />
      </SettingRow>
      {line ? (
        <BlockRow label={t("nci.gadi.line")} hint={t("nci.gadi.lineHint")} text={line} copyLabel={t("nci.gadi.lineCopy")} />
      ) : (
        <SettingRow label={t("nci.gadi.line")} hint={t("nci.gadi.lineHint")}>
          <span className="text-xs text-subtle">{t(hasNciKey(status) ? "nci.gadi.lineNeedsHome" : "nci.gadi.lineNeedsKey")}</span>
        </SettingRow>
      )}
    </Step>
  );
}

// ---------- ③ host keys + ④ username (saved together) ----------

interface IdentityDraft {
  hostKeys: string;
  confirmed: boolean;
  username: string;
}

function useFingerprints(keys: readonly string[]): (string | null)[] {
  const [prints, setPrints] = useState<(string | null)[]>([]);
  const joined = keys.join("\n");
  useEffect(() => {
    let live = true;
    void Promise.all(keys.map((k) => sshFingerprint(k).catch(() => null))).then((p) => live && setPrints(p));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the joined text
  }, [joined]);
  return prints;
}

function HostKeysStep({ nci, state, draft, setDraft }: { nci: Status<NciVerificationStatus>; state: NciStepState; draft: IdentityDraft; setDraft(d: IdentityDraft): void }) {
  const { t } = useI18n();
  const status = nci.value ?? null;
  const parsed = parseHostKeys(draft.hostKeys);
  const prints = useFingerprints(parsed.keys);
  const saved = status?.hostKeyFingerprints ?? [];
  return (
    <Step id="hostKeys" index={2} state={state} title={t("nci.hostKeys.title")} hint={t("nci.hostKeys.hint")}>
      <div className="border-b border-border py-2.5">
        <div className="text-sm">{t("nci.hostKeys.label")}</div>
        <div className="mt-1.5">
          <TextArea value={draft.hostKeys} onChange={(v) => setDraft({ ...draft, hostKeys: v, confirmed: false })} placeholder="gadi.nci.org.au ssh-ed25519 AAAA…" mono rows={4} width="w-full" label={t("nci.hostKeys.label")} />
        </div>
        {parsed.invalid > 0 && <div className="mt-1 text-xs text-danger">{t("nci.hostKeys.invalid", { n: parsed.invalid })}</div>}
        {parsed.keys.length > 8 && <div className="mt-1 text-xs text-danger">{t("nci.hostKeys.tooMany")}</div>}
        {parsed.keys.length > 0 && (
          <div className="mt-2 text-xs">
            <div className="text-subtle">{t("nci.hostKeys.fingerprints")}</div>
            {parsed.keys.map((k, i) => (
              <div key={k} className="font-mono text-[11px] break-all text-muted select-text">
                {k.split(" ")[0]} {prints[i] ?? "…"}
              </div>
            ))}
          </div>
        )}
        {parsed.keys.length === 0 && saved.length > 0 && (
          <div className="mt-2 text-xs">
            <div className="text-subtle">{t("nci.hostKeys.saved")}</div>
            {saved.map((f, i) => (
              <div key={i} className="font-mono text-[11px] break-all text-muted select-text">
                {(status?.hostKeys?.[i] ?? "").split(" ")[0]} {f}
              </div>
            ))}
          </div>
        )}
      </div>
      <SettingRow label={t("nci.hostKeys.confirm")} hint={t("nci.hostKeys.confirmHint")}>
        <Toggle checked={draft.confirmed} onChange={(v) => setDraft({ ...draft, confirmed: v })} disabled={parsed.keys.length === 0} label={t("nci.hostKeys.confirm")} />
      </SettingRow>
    </Step>
  );
}

function UsernameStep({ nci, state, draft, setDraft, verification }: { nci: Status<NciVerificationStatus>; state: NciStepState; draft: IdentityDraft; setDraft(d: IdentityDraft): void; verification: boolean }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const codeText = useCodeText();
  const status = nci.value ?? null;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const [advanced, setAdvanced] = useState(false);
  const parsed = parseHostKeys(draft.hostKeys);
  const username = draft.username.trim();
  const usernameBad = username !== "" && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(username);
  const ready = !!username && !usernameBad && parsed.keys.length >= 1 && parsed.keys.length <= 8 && parsed.invalid === 0 && draft.confirmed;
  const pending = !!status?.pendingGeneratedKey;
  // Something to save: a pending key, or a username / host keys that differ from the saved ones.
  const changed = pending || !status?.configured || status.username !== username || JSON.stringify(status.hostKeys ?? []) !== JSON.stringify(parsed.keys);
  const canSave = ready && changed && (pending || !!status?.privateKeyStored);
  const save = async (pickKey: boolean) => {
    const mine = nci.guard();
    setBusy(true);
    setNote(null);
    try {
      const r = await api.putNciVerification({
        username,
        hostKeys: parsed.keys,
        hostKeyConfirmed: draft.confirmed,
        ...(pickKey ? { pickPrivateKey: true } : pending ? { useGeneratedKey: true } : {}),
      });
      if (mine !== nci.guard()) return;
      if (r.ok) (nci.set(r.value), setNote({ tone: "ok", text: t("nci.username.saved") }));
      else if (r.code !== "cancelled") setNote({ tone: "error", text: codeText(r.code, r.message) });
    } catch (e) {
      setNote({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Step id="username" index={3} state={state} title={t("nci.username.title")} hint={t("nci.username.hint")}>
      <SettingRow label={t("nci.username.label")} hint={usernameBad ? <span className="text-danger">{t("nci.username.invalid")}</span> : undefined}>
        <TextInput value={draft.username} onChange={(v) => setDraft({ ...draft, username: v.trim() })} placeholder="ab1234" mono width="w-40" label={t("nci.username.label")} />
      </SettingRow>
      {verification && (
        <>
          <Para>{hasNciKey(status) ? t("nci.username.saveHint") : t("nci.username.needsKey")}</Para>
          <NoteLine note={note} />
          <div className="flex items-center justify-end gap-2 py-2">
            <Button primary disabled={busy || !canSave} onClick={() => void save(false)}>
              {t("nci.username.save")}
            </Button>
          </div>
          <div className="border-t border-border py-2">
            <button className="inline-flex items-center gap-1 text-xs text-subtle hover:text-foreground" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
              {advanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {t("nci.advanced.title")}
            </button>
            {advanced && (
              <div className="mt-1">
                <Para>{t("nci.advanced.hint")}</Para>
                {!ready && <Para tone="warn">{t("nci.advanced.needsSteps")}</Para>}
                <div className="flex justify-end pb-1">
                  <Button disabled={busy || !ready} onClick={() => void save(true)}>
                    {t("nci.advanced.pick")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </Step>
  );
}

// ---------- ⑤ mailbox ----------

function MailStep({ mail, state, supportsAddress }: { mail: Status<InboundMailStatus>; state: NciStepState; supportsAddress: boolean }) {
  const { t } = useI18n();
  const api = useTargetApi();
  const codeText = useCodeText();
  const status = mail.value ?? null;
  const [draft, setDraft] = useState(() => mailboxDraft(status));
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [note, setNote] = useState<Note>(null);
  // Refill when a (new) status arrives; the password field always starts empty.
  useEffect(() => setDraft(mailboxDraft(status)), [status]);
  const set = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const needsPassword = mailPasswordRequired(status, draft);
  const addressBad = draft.address.trim() !== "" && !validMailAddress(draft.address.trim());
  const portOk = Number.isInteger(draft.port) && draft.port > 0 && draft.port < 65536;
  const complete = !!draft.server.trim() && !!draft.username.trim() && portOk && !addressBad && (!needsPassword || !!draft.password);
  const dirty = JSON.stringify({ ...mailboxDraft(status), password: "" }) !== JSON.stringify({ ...draft, password: "" }) || !!draft.password;
  const run = async (kind: "save" | "delete") => {
    const mine = mail.guard();
    setBusy(kind);
    setNote(null);
    try {
      const r = kind === "save" ? await api.putInboundMail({ ...draft, address: draft.address.trim() || null, password: draft.password || undefined }) : await api.deleteInboundMail();
      if (mine !== mail.guard()) return;
      if (r.ok) (mail.set(r.value), setNote({ tone: "ok", text: t(kind === "save" ? "nci.mail.saved" : "nci.mail.deleted") }));
      else setNote({ tone: "error", text: codeText(r.code, r.message) });
    } catch (e) {
      setNote({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setDraft((d) => ({ ...d, password: "" }));
      setBusy(null);
    }
  };
  const view = mailToView(supportsAddress ? status : status ? { ...status, nciMailToStatus: undefined } : status);
  return (
    <Step id="mailbox" index={4} state={state} title={t("nci.mail.title")} hint={t("nci.mail.hint")}>
      <ul className="list-disc space-y-0.5 py-2 pl-4 text-xs text-subtle">
        <li>{t("nci.mail.tip.dedicated")}</li>
        <li>{t("nci.mail.tip.appPassword")}</li>
        <li>{t("nci.mail.tip.direct")}</li>
        <li>{t("nci.mail.tip.spam")}</li>
      </ul>
      {mail.error && <ErrorNote>{codeText(mail.error.code, mail.error.message)}</ErrorNote>}
      {mail.value === undefined && !mail.error && <Loading rows={3} />}
      {mail.value !== undefined && (
        <>
          <SettingRow label={t("nci.mail.server")} hint={t("nci.mail.serverHint")}>
            <span className="flex items-center gap-1.5">
              <TextInput value={draft.server} onChange={(v) => set("server", v.trim())} placeholder="imap.gmail.com" mono width="w-48" label={t("nci.mail.server")} />
              <TextInput value={String(draft.port)} onChange={(v) => set("port", /^\d{0,5}$/.test(v) ? Number(v) : draft.port)} mono width="w-16" label={t("nci.mail.port")} />
            </span>
          </SettingRow>
          <SettingRow label={t("nci.mail.username")} hint={t("nci.mail.usernameHint")}>
            <TextInput value={draft.username} onChange={(v) => set("username", v)} placeholder="nci-jobs@example.org" mono width="w-64" label={t("nci.mail.username")} />
          </SettingRow>
          <SettingRow label={t("nci.mail.password")} hint={t(needsPassword ? "nci.mail.passwordHint" : "nci.mail.passwordKeep")}>
            <TextInput type="password" value={draft.password} onChange={(v) => set("password", v)} placeholder={needsPassword ? t("nci.mail.passwordRequired") : t("nci.mail.passwordSaved")} width="w-64" label={t("nci.mail.password")} />
          </SettingRow>
          <SettingRow label={t("nci.mail.address")} hint={addressBad ? <span className="text-danger">{t("nci.mail.addressInvalid")}</span> : t("nci.mail.addressHint")}>
            <TextInput value={draft.address} onChange={(v) => set("address", v)} placeholder={validMailAddress(draft.username.trim()) ? draft.username.trim() : "nci-jobs@example.org"} mono width="w-64" label={t("nci.mail.address")} />
          </SettingRow>
          <SettingRow label={t("nci.mail.mailbox")}>
            <TextInput value={draft.mailbox} onChange={(v) => set("mailbox", v)} mono width="w-32" label={t("nci.mail.mailbox")} />
          </SettingRow>
          <SettingRow label={t("nci.mail.enabled")} hint={t("nci.mail.enabledHint")}>
            <Toggle checked={draft.enabled} onChange={(v) => set("enabled", v)} label={t("nci.mail.enabled")} />
          </SettingRow>
          <SettingRow label={t("nci.mail.nci")} hint={t("nci.mail.nciHint")}>
            <Toggle checked={draft.sources.includes("nci")} onChange={(v) => set("sources", v ? ["nci"] : [])} label={t("nci.mail.nci")} />
          </SettingRow>
          {status?.configured && (
            <SettingRow label={t("nci.mail.agentAddress")} hint={t("nci.mail.agentAddressHint")}>
              {view.address ? (
                <span className="font-mono text-xs text-muted select-text">{view.address}</span>
              ) : (
                <span className="text-xs text-warn">{t(`nci.mail.reason.${view.reason ?? "unknown"}` as MessageKey)}</span>
              )}
            </SettingRow>
          )}
          {view.jobServiceMissing && <Notice>{t("nci.mail.jobServiceMissing", { file: status?.notifyAddressFile ?? "" })}</Notice>}
          <NoteLine note={note} />
          <div className="flex items-center justify-end gap-2 py-2">
            {status?.configured && <ArmedRemove title={t("nci.mail.delete")} armedLabel={t("nci.mail.deleteConfirm")} disabled={!!busy} onRemove={() => void run("delete")} />}
            <Button primary onClick={() => void run("save")} disabled={!!busy || !complete || !dirty}>
              {t("nci.save")}
            </Button>
          </div>
        </>
      )}
    </Step>
  );
}

// ---------- ⑥ test + turn on ----------

function EnableStep({ mail, nci, state, hasMail, verification }: { mail: Status<InboundMailStatus>; nci: Status<NciVerificationStatus>; state: NciStepState; hasMail: boolean; verification: boolean }) {
  const { t, locale } = useI18n();
  const api = useTargetApi();
  const codeText = useCodeText();
  const now = useClock();
  const m = mail.value ?? null;
  const s = nci.value ?? null;
  const [busy, setBusy] = useState<"test" | "verify" | "interval" | "delete" | null>(null);
  const [note, setNote] = useState<Note>(null);
  const counts = m?.counts ?? {};
  const test = async () => {
    setBusy("test");
    setNote(null);
    try {
      const r = await api.testInboundMail(null);
      setNote(r.ok ? { tone: "ok", text: t("nci.enable.testOk") } : { tone: "error", text: codeText(r.code, r.message) });
      mail.reload();
    } catch (e) {
      setNote({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  /** Same username / host keys (no key: the stored one stays), only `enabled` / interval change. */
  const update = async (kind: "verify" | "interval", patch: { enabled?: boolean; pollIntervalSeconds?: number }) => {
    if (!s?.configured || !s.username) return;
    const mine = nci.guard();
    setBusy(kind);
    setNote(null);
    try {
      const r = await api.putNciVerification({ username: s.username, hostKeys: s.hostKeys ?? [], hostKeyConfirmed: true, enabled: patch.enabled ?? s.enabled, pollIntervalSeconds: patch.pollIntervalSeconds ?? s.pollIntervalSeconds });
      if (mine !== nci.guard()) return;
      if (r.ok) nci.set(r.value);
      else setNote({ tone: "error", text: codeText(r.code, r.message) });
    } catch (e) {
      setNote({ tone: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    const mine = nci.guard();
    setBusy("delete");
    setNote(null);
    try {
      const r = await api.deleteNciVerification();
      if (mine !== nci.guard()) return;
      if (r.ok) (nci.set(r.value), setNote({ tone: "ok", text: t("nci.enable.deleted") }));
      else setNote({ tone: "error", text: codeText(r.code, r.message) });
    } finally {
      setBusy(null);
    }
  };
  return (
    <Step id="enable" index={5} state={state} title={t("nci.enable.title")} hint={t("nci.enable.hint")}>
      {hasMail && (
        <SettingRow
          label={t("nci.enable.mailStatus")}
          hint={
            m?.configured ? (
              <>
                {!m.enabled ? t("nci.enable.mailOff") : m.errorCode ? <span className="text-danger">{codeText(m.errorCode)}</span> : m.lastConnectedAt ? t("nci.enable.connectedAt", { at: formatWhen(m.lastConnectedAt, now, locale) }) : t("nci.enable.notYet")}
                <br />
                {t("nci.enable.counts", { processed: counts.processed ?? 0, applied: counts.applied ?? 0, pending: counts.pending ?? 0, rejected: counts.rejected ?? 0 })}
              </>
            ) : (
              t("nci.code.mail_not_configured")
            )
          }
        >
          <Button disabled={!!busy || !m?.configured} onClick={() => void test()}>
            {busy === "test" ? t("nci.testing") : t("nci.enable.testMail")}
          </Button>
        </SettingRow>
      )}
      {verification ? (
        <>
          <SettingRow
            label={t("nci.enable.verify")}
            hint={
              !s?.configured ? (
                t("nci.enable.notConfigured")
              ) : (
                <>
                  {!s.enabled ? t("nci.enable.off") : s.errorCode ? <span className="text-danger">{codeText(s.errorCode)}</span> : t("nci.enable.on", { interval: intervalLabel(s.pollIntervalSeconds ?? 21600) })}
                  <br />
                  <span title={s.lastQueryAt ? formatAbsolute(s.lastQueryAt) : undefined}>
                    {s.lastQueryAt ? t("nci.enable.lastQuery", { at: formatWhen(s.lastQueryAt, now, locale), n: s.queryCount ?? 0 }) : t("nci.enable.noQuery")}
                    {s.lastSuccessAt ? ` · ${t("nci.enable.lastSuccess", { at: formatWhen(s.lastSuccessAt, now, locale) })}` : ""}
                    {" · "}
                    {t("nci.enable.tracked", { n: s.trackedJobs ?? 0 })}
                  </span>
                </>
              )
            }
          >
            <Toggle checked={!!s?.enabled} disabled={!!busy || !s?.configured} onChange={(v) => void update("verify", { enabled: v })} label={t("nci.enable.verify")} />
          </SettingRow>
          {s?.configured && (
            <SettingRow label={t("nci.enable.interval")} hint={t("nci.enable.intervalHint")}>
              <Select
                value={String(s.pollIntervalSeconds ?? 21600)}
                disabled={!!busy}
                options={INTERVALS.map((v) => ({ value: String(v), label: intervalLabel(v) }))}
                onChange={(v) => void update("interval", { pollIntervalSeconds: Number(v) })}
                label={t("nci.enable.interval")}
              />
            </SettingRow>
          )}
        </>
      ) : (
        <Para>{t("nci.noVerification")}</Para>
      )}
      <NoteLine note={note} />
      {verification && (s?.configured || s?.pendingGeneratedKey) && (
        <div className="flex justify-end py-2">
          <ArmedRemove title={t("nci.enable.delete")} armedLabel={t("nci.enable.deleteConfirm")} disabled={!!busy} onRemove={() => void remove()} />
        </div>
      )}
    </Step>
  );
}

// ---------- page ----------

function identityDraft(s: NciVerificationStatus | null | undefined): IdentityDraft {
  return { hostKeys: (s?.hostKeys ?? []).join("\n"), confirmed: !!s?.configured, username: s?.username ?? "" };
}

/** Settings → NCI 远程作业. */
export function NciSettings() {
  const { t } = useI18n();
  const api = useTargetApi();
  const features = useTargetFeatures();
  const hasMail = features.has(INBOUND_MAIL_FEATURE);
  const verification = features.has(NCI_VERIFICATION_FEATURE);
  const keygen = verification && features.has(NCI_HOST_KEYGEN_FEATURE);
  const mail = useStatus<InboundMailStatus>(hasMail ? () => api.inboundMail() : null);
  const nci = useStatus<NciVerificationStatus>(verification ? () => api.nciVerification() : null);
  // ③④ share one draft (saved together); refilled when the saved identity changes.
  const [draft, setDraft] = useState<IdentityDraft>(() => identityDraft(nci.value));
  const savedIdentity = JSON.stringify([nci.value?.configured, nci.value?.username, nci.value?.hostKeys]);
  useEffect(() => setDraft(identityDraft(nci.value)), [savedIdentity]); // eslint-disable-line react-hooks/exhaustive-deps -- keyed by the saved identity

  const steps = nciSteps({ mail: hasMail, verification, keygen, mailStatus: hasMail ? mail.value : null, nciStatus: verification ? nci.value : null });
  const stateOf = (id: NciStepId) => steps.find((s) => s.id === id)!.state;
  const allDone = steps.every((s) => s.state === "done" || s.state === "unsupported");
  return (
    <>
      {!verification && <Notice tone="info">{t("nci.noVerification")}</Notice>}
      {allDone && <Notice tone="info">{t("nci.allDone")}</Notice>}
      {verification && (
        <>
          <KeyStep nci={nci} state={stateOf("key")} keygen={keygen} />
          <GadiStep nci={nci} state={stateOf("gadi")} keygen={keygen} />
          <HostKeysStep nci={nci} state={stateOf("hostKeys")} draft={draft} setDraft={setDraft} />
          <UsernameStep nci={nci} state={stateOf("username")} draft={draft} setDraft={setDraft} verification={verification} />
        </>
      )}
      {hasMail ? <MailStep mail={mail} state={stateOf("mailbox")} supportsAddress={features.has(NCI_MAIL_ADDRESS_FEATURE)} /> : <Notice>{t("nci.mail.unsupported")}</Notice>}
      <EnableStep mail={mail} nci={nci} state={stateOf("enable")} hasMail={hasMail} verification={verification} />
    </>
  );
}
