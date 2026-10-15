// The big alert page (main/ownerAlert.ts; owner-notify `bigAlert`). Plain DOM, no React: it is a
// small always-on-top window. Talks only to `window.ownerAlert` (preload/ownerAlert.ts). Without that
// bridge (browser preview at /owner-alert.html) it shows sample alerts.
import "./ownerAlert.css";
import { isAppLocale, matchAppLocale } from "../../../shared/locales";
import type { OwnerAlertBridge, OwnerAlertItem, OwnerAlertLocale, OwnerAlertState } from "../../../shared/ownerAlert";
import { hashColor } from "../lib/avatar";
import { loadTheme } from "../lib/theme";
import { alertStrings, chimeNotes, pickFirst, refsLine, timeLabel } from "./model";

declare global {
  interface Window {
    ownerAlert?: OwnerAlertBridge;
  }
}

const bridge: OwnerAlertBridge = window.ownerAlert ?? previewBridge();

let state: OwnerAlertState = { locale: "zh-CN", sound: false, alerts: [] };
let index = 0;
let replying: string | null = null;
let draft = "";
let busy = false;
let error: string | null = null;
const seen = new Set<string>();
let first = true;

const theme = loadTheme();
if (theme !== "system") document.documentElement.dataset.theme = theme;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setState(next: OwnerAlertState): void {
  const fresh = next.alerts.filter((a) => !seen.has(a.notificationId));
  for (const a of next.alerts) seen.add(a.notificationId);
  const currentId = state.alerts[index]?.notificationId;
  state = next;
  // Stay on the alert being read; a new one jumps to it.
  const target = fresh.length ? pickFirst(fresh).notificationId : currentId;
  const at = state.alerts.findIndex((a) => a.notificationId === target);
  index = at >= 0 ? at : Math.min(index, Math.max(0, state.alerts.length - 1));
  if (replying && !state.alerts.some((a) => a.notificationId === replying)) {
    replying = null;
    draft = "";
  }
  const ringing = fresh.filter((a) => a.sound ?? state.sound);
  if (ringing.length) playChime(ringing.some((a) => a.level === "urgent"));
  first = false;
  render();
}

function render(): void {
  const t = alertStrings(state.locale);
  const root = document.getElementById("alert")!;
  root.replaceChildren();
  const alert = state.alerts[index];
  if (!alert) return;
  const card = el("div", `card level-${alert.level}`);
  card.append(el("div", "stripe"));

  const head = el("div", "head");
  const avatar = el("div", "avatar", [...alert.agentName.trim()][0]?.toUpperCase() ?? "?");
  avatar.style.background = hashColor(alert.agentName);
  const who = el("div", "who");
  const nameRow = el("div", "name-row");
  nameRow.append(el("span", "name", alert.agentName), el("span", `badge badge-${alert.level}`, t.level[alert.level]));
  who.append(nameRow, el("div", "meta", `${alert.title || t.title} · ${timeLabel(alert.createdAt, Date.now(), state.locale)}`));
  head.append(avatar, who);
  if (state.alerts.length > 1) {
    const pager = el("div", "pager");
    const prev = el("button", "nav", "‹");
    prev.disabled = index === 0;
    prev.title = t.prev;
    prev.onclick = () => go(index - 1);
    const next = el("button", "nav", "›");
    next.disabled = index === state.alerts.length - 1;
    next.title = t.next;
    next.onclick = () => go(index + 1);
    pager.append(prev, el("span", "count", `${index + 1} / ${state.alerts.length}`), next);
    head.append(pager);
  }
  card.append(head);

  const body = el("div", "body");
  body.append(el("div", "text", alert.text));
  const refs = refsLine(alert, t);
  if (refs) body.append(el("div", "refs", refs));
  card.append(body);

  if (replying === alert.notificationId) {
    const box = el("div", "reply");
    const area = el("textarea");
    area.value = draft;
    area.placeholder = t.replyPlaceholder;
    area.maxLength = 20000;
    area.oninput = () => {
      draft = area.value;
      send.disabled = busy || !draft.trim();
    };
    area.onkeydown = (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void sendReply(alert);
      } else if (e.key === "Escape") {
        replying = null;
        render();
      }
    };
    const row = el("div", "actions");
    const cancel = el("button", "btn", t.cancel);
    cancel.onclick = () => {
      replying = null;
      error = null;
      render();
    };
    const send = el("button", "btn primary", busy ? t.sending : t.send);
    send.disabled = busy || !draft.trim();
    send.onclick = () => void sendReply(alert);
    row.append(el("span", "hint", t.replyHint), cancel, send);
    box.append(area, row);
    card.append(box);
    queueMicrotask(() => area.focus());
  } else {
    const row = el("div", "actions");
    if (alert.needsReply) row.append(el("span", "needs", t.needsReply));
    else row.append(el("span", "spacer"));
    const open = el("button", "btn", t.open);
    open.disabled = busy;
    open.onclick = () => void run(() => bridge.open(alert.notificationId));
    row.append(open);
    if (alert.needsReply) {
      const reply = el("button", "btn", t.reply);
      reply.disabled = busy;
      reply.onclick = () => {
        replying = alert.notificationId;
        error = null;
        render();
      };
      row.append(reply);
    }
    const ack = el("button", "btn primary", t.ack);
    ack.disabled = busy;
    ack.onclick = () => void run(() => bridge.ack(alert.notificationId));
    row.append(ack);
    card.append(row);
  }
  if (error) card.append(el("div", "error", error));
  root.append(card);
}

function go(i: number): void {
  index = Math.max(0, Math.min(state.alerts.length - 1, i));
  replying = null;
  error = null;
  render();
}

async function run(action: () => Promise<{ ok: true } | { ok: false; message: string }>): Promise<boolean> {
  busy = true;
  error = null;
  render();
  try {
    const r = await action();
    if (!r.ok) error = r.message;
    return r.ok;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    return false;
  } finally {
    busy = false;
    render();
  }
}

async function sendReply(alert: OwnerAlertItem): Promise<void> {
  const text = draft.trim();
  if (!text || busy) return;
  if (await run(() => bridge.reply(alert.notificationId, text))) {
    replying = null;
    draft = "";
    render();
  }
}

let audio: AudioContext | null = null;
/** A short generated chime (no audio assets); urgent rings twice. */
function playChime(urgent: boolean): void {
  try {
    audio ??= new AudioContext();
    const ctx = audio;
    const start = ctx.currentTime + 0.05;
    for (const note of chimeNotes(urgent)) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = note.freq;
      gain.gain.setValueAtTime(0.0001, start + note.at);
      gain.gain.exponentialRampToValueAtTime(0.25, start + note.at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + note.at + note.dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + note.at);
      osc.stop(start + note.at + note.dur + 0.05);
    }
  } catch {
    // no audio device: silent
  }
}

/** Browser preview (no Electron): sample alerts, actions just drop them. */
function previewBridge(): OwnerAlertBridge {
  const params = new URLSearchParams(location.search);
  const raw = params.get("lang");
  const locale: OwnerAlertLocale = isAppLocale(raw) ? raw : matchAppLocale(navigator.language) ?? "en";
  const now = Date.now();
  let s: OwnerAlertState = {
    locale,
    sound: false,
    alerts: [
      { notificationId: "ntf-demo-1", agentId: "eva", agentName: "Eva", level: "urgent", text: "生产库迁移卡在第 3 步：`users` 表的外键约束和旧数据冲突。\n\n要我回滚到迁移前的快照，还是先手动清理那 12 行孤儿数据？", createdAt: new Date(now - 40_000).toISOString(), needsReply: true, delegation: "ask-42", job: null },
      { notificationId: "ntf-demo-2", agentId: "alden", agentName: "Alden", level: "attention", text: "Release build finished; the installer is on the share: \\\\build-share\\releases\\desktop\\2026-10-15\\nightly\\Cutex-Setup-0.0.0-nightly-x64-full-installer-with-debug-symbols.exe", createdAt: new Date(now - 5_000).toISOString(), needsReply: false, delegation: null, job: "job-7f3a" },
    ],
  };
  if (params.get("one") === "1") s = { ...s, alerts: s.alerts.slice(0, 1) };
  let listener: ((st: OwnerAlertState) => void) | null = null;
  const drop = async (id: string) => {
    s = { ...s, alerts: s.alerts.filter((a) => a.notificationId !== id) };
    listener?.(s);
    return { ok: true as const };
  };
  return { state: async () => s, onState: (l) => (listener = l), ack: drop, reply: drop, open: drop };
}

bridge.onState(setState);
void bridge.state().then((s) => {
  // Sound only for alerts that arrive while the window is up, plus the first batch.
  if (first) setState(s);
});
setInterval(() => {
  if (state.alerts.length && !replying) render();
}, 30_000);
