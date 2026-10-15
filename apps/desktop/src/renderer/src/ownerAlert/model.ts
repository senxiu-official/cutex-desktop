// Pure parts of the big alert page (strings, time label, chime) — unit-tested.
import type { OwnerNotifyLevel } from "@cutex-desktop/protocol";
import type { OwnerAlertItem, OwnerAlertLocale } from "../../../shared/ownerAlert";

export interface AlertStrings {
  title: string;
  level: Record<OwnerNotifyLevel, string>;
  open: string;
  reply: string;
  ack: string;
  send: string;
  sending: string;
  cancel: string;
  needsReply: string;
  replyPlaceholder: string;
  replyHint: string;
  delegation: string;
  job: string;
  prev: string;
  next: string;
  justNow: string;
  minutesAgo: string;
}

const STRINGS: Record<OwnerAlertLocale, AlertStrings> = {
  "zh-CN": {
    title: "给你的消息",
    level: { info: "告知", attention: "需要你", urgent: "紧急" },
    open: "打开",
    reply: "回复",
    ack: "知道了",
    send: "发送",
    sending: "发送中…",
    cancel: "取消",
    needsReply: "需要回复",
    replyPlaceholder: "回复这条消息…",
    replyHint: "Ctrl+Enter 发送",
    delegation: "委托",
    job: "任务",
    prev: "上一条",
    next: "下一条",
    justNow: "刚刚",
    minutesAgo: "{n} 分钟前",
  },
  en: {
    title: "Message for you",
    level: { info: "Inform", attention: "Needs you", urgent: "Urgent" },
    open: "Open",
    reply: "Reply",
    ack: "Got it",
    send: "Send",
    sending: "Sending…",
    cancel: "Cancel",
    needsReply: "Needs a reply",
    replyPlaceholder: "Reply to this message…",
    replyHint: "Ctrl+Enter to send",
    delegation: "Delegation",
    job: "Job",
    prev: "Previous",
    next: "Next",
    justNow: "just now",
    minutesAgo: "{n} min ago",
  },
  "zh-Hant-CN": {
    title: "給你的消息",
    level: { info: "告知", attention: "需要你", urgent: "緊急" },
    open: "開啟",
    reply: "回覆",
    ack: "知道了",
    send: "傳送",
    sending: "傳送中…",
    cancel: "取消",
    needsReply: "需要回覆",
    replyPlaceholder: "回覆這則訊息…",
    replyHint: "Ctrl+Enter 傳送",
    delegation: "委託",
    job: "任務",
    prev: "上一則",
    next: "下一則",
    justNow: "剛剛",
    minutesAgo: "{n} 分鐘前",
  },
  "en-AU": {
    title: "Message for you",
    level: { info: "Inform", attention: "Needs you", urgent: "Urgent" },
    open: "Open",
    reply: "Reply",
    ack: "Got it",
    send: "Send",
    sending: "Sending…",
    cancel: "Cancel",
    needsReply: "Needs a reply",
    replyPlaceholder: "Reply to this message…",
    replyHint: "Ctrl+Enter to send",
    delegation: "Delegation",
    job: "Job",
    prev: "Previous",
    next: "Next",
    justNow: "just now",
    minutesAgo: "{n} min ago",
  },
  "ru-RU": {
    title: "Сообщение для вас",
    level: { info: "Уведомление", attention: "Обратите внимание", urgent: "Срочно" },
    open: "Открыть",
    reply: "Ответить",
    ack: "Понятно",
    send: "Отправить",
    sending: "Отправка…",
    cancel: "Отмена",
    needsReply: "Требуется ответ",
    replyPlaceholder: "Ответить на это сообщение…",
    replyHint: "Ctrl+Enter — отправить",
    delegation: "Делегирование",
    job: "Задача",
    prev: "Предыдущее",
    next: "Следующее",
    justNow: "только что",
    minutesAgo: "{n} мин. назад",
  },
  "fr-FR": {
    title: "Message pour vous",
    level: { info: "Info", attention: "Attention", urgent: "Urgent" },
    open: "Ouvrir",
    reply: "Répondre",
    ack: "Compris",
    send: "Envoyer",
    sending: "Envoi…",
    cancel: "Annuler",
    needsReply: "Réponse attendue",
    replyPlaceholder: "Répondre à ce message…",
    replyHint: "Ctrl+Entrée pour envoyer",
    delegation: "Délégation",
    job: "Tâche",
    prev: "Précédent",
    next: "Suivant",
    justNow: "à l’instant",
    minutesAgo: "il y a {n} min",
  },
  "es-ES": {
    title: "Mensaje para ti",
    level: { info: "Aviso", attention: "Atención", urgent: "Urgente" },
    open: "Abrir",
    reply: "Responder",
    ack: "Entendido",
    send: "Enviar",
    sending: "Enviando…",
    cancel: "Cancelar",
    needsReply: "Requiere respuesta",
    replyPlaceholder: "Responde a este mensaje…",
    replyHint: "Ctrl+Intro para enviar",
    delegation: "Delegación",
    job: "Tarea",
    prev: "Anterior",
    next: "Siguiente",
    justNow: "ahora mismo",
    minutesAgo: "hace {n} min",
  },
  "pt-BR": {
    title: "Mensagem para você",
    level: { info: "Aviso", attention: "Atenção", urgent: "Urgente" },
    open: "Abrir",
    reply: "Responder",
    ack: "Entendido",
    send: "Enviar",
    sending: "Enviando…",
    cancel: "Cancelar",
    needsReply: "Requer resposta",
    replyPlaceholder: "Responda a esta mensagem…",
    replyHint: "Ctrl+Enter para enviar",
    delegation: "Delegação",
    job: "Tarefa",
    prev: "Anterior",
    next: "Próximo",
    justNow: "agora mesmo",
    minutesAgo: "há {n} min",
  },
  "it-IT": {
    title: "Messaggio per te",
    level: { info: "Info", attention: "Attenzione", urgent: "Urgente" },
    open: "Apri",
    reply: "Rispondi",
    ack: "Capito",
    send: "Invia",
    sending: "Invio…",
    cancel: "Annulla",
    needsReply: "Richiede risposta",
    replyPlaceholder: "Rispondi a questo messaggio…",
    replyHint: "Ctrl+Invio per inviare",
    delegation: "Delega",
    job: "Lavoro",
    prev: "Precedente",
    next: "Successivo",
    justNow: "proprio ora",
    minutesAgo: "{n} min fa",
  },
  "de-DE": {
    title: "Nachricht für dich",
    level: { info: "Info", attention: "Beachtung", urgent: "Dringend" },
    open: "Öffnen",
    reply: "Antworten",
    ack: "Verstanden",
    send: "Senden",
    sending: "Wird gesendet…",
    cancel: "Abbrechen",
    needsReply: "Antwort erforderlich",
    replyPlaceholder: "Auf diese Nachricht antworten…",
    replyHint: "Ctrl+Enter zum Senden",
    delegation: "Delegierung",
    job: "Job",
    prev: "Zurück",
    next: "Weiter",
    justNow: "gerade eben",
    minutesAgo: "vor {n} Min.",
  },
  "ja-JP": {
    title: "あなたへのメッセージ",
    level: { info: "通知", attention: "要注意", urgent: "緊急" },
    open: "開く",
    reply: "返信",
    ack: "了解",
    send: "送信",
    sending: "送信中…",
    cancel: "キャンセル",
    needsReply: "返信が必要",
    replyPlaceholder: "このメッセージに返信…",
    replyHint: "Ctrl+Enter で送信",
    delegation: "委任",
    job: "ジョブ",
    prev: "前へ",
    next: "次へ",
    justNow: "たった今",
    minutesAgo: "{n} 分前",
  },
  "ko-KR": {
    title: "내게 온 메시지",
    level: { info: "알림", attention: "주의", urgent: "긴급" },
    open: "열기",
    reply: "답장",
    ack: "확인",
    send: "보내기",
    sending: "보내는 중…",
    cancel: "취소",
    needsReply: "답장 필요",
    replyPlaceholder: "이 메시지에 답장…",
    replyHint: "Ctrl+Enter로 보내기",
    delegation: "위임",
    job: "작업",
    prev: "이전",
    next: "다음",
    justNow: "방금",
    minutesAgo: "{n}분 전",
  },
};

export function alertStrings(locale: OwnerAlertLocale): AlertStrings {
  return STRINGS[locale] ?? STRINGS["zh-CN"];
}

/** "刚刚" / "5 分钟前" within the hour, else the local time (HH:MM, with the date when not today). */
export function timeLabel(createdAt: string, now: number, locale: OwnerAlertLocale): string {
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at)) return "";
  const t = alertStrings(locale);
  const mins = Math.floor((now - at) / 60_000);
  if (mins < 1) return t.justNow;
  if (mins < 60) return t.minutesAgo.replace("{n}", String(mins));
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return new Date(now).toDateString() === d.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

/** "委托 ask-42 · 任务 job-7f3a", or null. */
export function refsLine(alert: Pick<OwnerAlertItem, "delegation" | "job">, t: Pick<AlertStrings, "delegation" | "job">): string | null {
  const parts = [alert.delegation ? `${t.delegation} ${alert.delegation}` : null, alert.job ? `${t.job} ${alert.job}` : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

const RANK = { urgent: 2, attention: 1, info: 0 } as const;

/** Which of the newly arrived alerts to show first: the most urgent, then the newest (input oldest first). */
export function pickFirst<T extends Pick<OwnerAlertItem, "level">>(fresh: readonly T[]): T {
  let best = fresh[0]!;
  for (const a of fresh) if (RANK[a.level] >= RANK[best.level]) best = a;
  return best;
}

/** Notes of the chime (seconds from start): a rising two-tone; urgent repeats it. */
export function chimeNotes(urgent: boolean): { freq: number; at: number; dur: number }[] {
  const once = [
    { freq: 880, at: 0, dur: 0.18 },
    { freq: 1318.5, at: 0.16, dur: 0.32 },
  ];
  return urgent ? [...once, ...once.map((n) => ({ ...n, at: n.at + 0.55 }))] : once;
}
