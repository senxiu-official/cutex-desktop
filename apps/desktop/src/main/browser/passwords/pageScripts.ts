// Fixed scripts main runs in a password tab's main frame, in isolated world 1007 (page scripts cannot see it or its
// globals). They are reached only after main observed the owner's own input in an owner tab that no agent holds.
// Nothing here is built from page or agent input: the only parameters are main's own constants.
//   field   which login field the owner just clicked, and where (the app draws the fill list there)
//   submit  the user name and password of the form the owner is submitting (Enter in a field / click on its button)
//   gone    whether the password field has disappeared (a successful login moved on)
//   fill    one step, with no page script able to run in between: re-check the frame's origin and that it is the
//           top frame, focus + select one field of the remembered form, confirm it holds the focus, and insert the
//           text (execCommand insertText: real beforeinput / input events; value + input event where that is refused)
// Version 1: main frame only, open shadow roots, no cross-origin iframes (WebFrameMain has no isolated world).
export const PASSWORD_WORLD = 1007;

const COMMON = `
  const visible = (el) => { if (!el || !el.isConnected || el.disabled || el.readOnly) return false; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none'; };
  const tokens = (el) => (el.getAttribute('autocomplete') || '').toLowerCase().split(/\\s+/);
  const deepActive = () => { let el = document.activeElement; for (let d = 0; d < 12 && el && el.shadowRoot && el.shadowRoot.activeElement; d++) el = el.shadowRoot.activeElement; return el; };
  const scopeOf = (el) => (el && (el.form || el.closest('form'))) || document;
  const passwords = (scope) => [...scope.querySelectorAll('input[type=password]')].filter(visible);
  const usable = (p) => !tokens(p).some((t) => t === 'new-password' || t === 'one-time-code');
  const isUserField = (el) => el && el.tagName === 'INPUT' && ['text', 'email', 'tel', ''].includes(el.type) && (
    tokens(el).includes('username') || ['email'].includes(el.type) || /user|mail|login|account|identifier|phone/i.test((el.name || '') + ' ' + (el.id || '')));
  const userFieldOf = (scope, password) => {
    const fields = [...scope.querySelectorAll('input')].filter((el) => ['text', 'email', 'tel', ''].includes(el.type) && visible(el) && !tokens(el).includes('one-time-code'));
    const marked = fields.find((el) => tokens(el).includes('username'));
    if (marked) return marked;
    if (password) { const before = fields.filter((el) => el.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING); if (before.length) return before[before.length - 1]; return null; }
    return fields.find(isUserField) || (fields.length === 1 ? fields[0] : null);
  };
  const state = (globalThis.__cutexPasswords ||= { target: null });
`;

/** → { role: "username" | "password", rect } | null. Remembers the field's form for a later fill. */
export const FIELD_SCRIPT = `new Promise((resolve) => setTimeout(() => { try {
  ${COMMON}
  const el = deepActive();
  if (!el || el.tagName !== 'INPUT' || !visible(el)) return resolve(null);
  let role = null;
  if (el.type === 'password') role = usable(el) ? 'password' : null;
  else if (tokens(el).includes('one-time-code')) role = null;
  else if (isUserField(el) || (['text', 'email', 'tel'].includes(el.type) && passwords(scopeOf(el)).length > 0)) role = 'username';
  if (!role) return resolve(null);
  state.target = new WeakRef(el);
  const r = el.getBoundingClientRect();
  resolve({ role, rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
} catch { resolve(null); } }, 0))`;

/** trigger "enter": the owner pressed Enter in a field; "click": the owner released the mouse on a button. */
export function submitScript(trigger: "enter" | "click"): string {
  return `(() => { try {
  ${COMMON}
  const el = deepActive();
  if (!el) return null;
  if (${trigger === "enter" ? "el.tagName !== 'INPUT'" : "!(el.tagName === 'BUTTON' || (el.tagName === 'INPUT' && ['submit', 'button', 'image'].includes(el.type)) || el.getAttribute('role') === 'button')"}) return null;
  const scope = scopeOf(el);
  const list = passwords(scope);
  if (list.length === 0) {
    const user = userFieldOf(scope, null);
    const name = user && typeof user.value === 'string' ? user.value.trim() : '';
    return name && name.length <= 256 ? { kind: 'username', username: name } : null;
  }
  if (list.length !== 1 || !usable(list[0])) return null;
  const password = list[0].value;
  if (typeof password !== 'string' || !password || password.length > 512) return null;
  const user = userFieldOf(scope, list[0]);
  const username = user && typeof user.value === 'string' ? user.value.trim().slice(0, 256) : '';
  return { kind: 'login', username, password };
} catch { return null; } })()`;
}

export const GONE_SCRIPT = `(() => { try {
  ${COMMON}
  return passwords(document).filter(usable).length === 0;
} catch { return false; } })()`;

/**
 * Fills one field of the form the owner clicked (FIELD_SCRIPT) in a single script turn: false — and nothing typed —
 * when the frame is not the top frame of `origin`, the field is gone or not focusable, or the focus is elsewhere.
 * `text` reaches only this page's own field (the site the login belongs to).
 */
export function fillScript(role: "username" | "password", text: string, origin: string): string {
  return `(() => { try {
  ${COMMON}
  if (window.top !== window || location.origin !== ${JSON.stringify(origin)}) return false;
  const clicked = state.target && state.target.deref();
  if (!clicked || !clicked.isConnected) return false;
  const scope = scopeOf(clicked);
  const list = passwords(scope).filter(usable);
  const password = clicked.type === 'password' ? clicked : (list.length === 1 ? list[0] : null);
  const el = ${role === "password" ? "password" : "(clicked.type === 'password' ? userFieldOf(scope, clicked) : clicked)"};
  if (!el || !visible(el)) return false;
  el.focus();
  el.select();
  if (deepActive() !== el) return false;
  const text = ${JSON.stringify(text)};
  let done = false;
  try { done = document.execCommand('insertText', false, text) && el.value === text; } catch {}
  if (!done) {
    try { el.setRangeText(text, 0, el.value.length, 'end'); } catch { el.value = text; }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return el.value === text;
} catch { return false; } })()`;
}

/** Which fields the remembered form has (fill types into those only). */
export const FORM_SCRIPT = `(() => { try {
  ${COMMON}
  const clicked = state.target && state.target.deref();
  if (!clicked || !clicked.isConnected) return null;
  const scope = scopeOf(clicked);
  const list = passwords(scope).filter(usable);
  const password = clicked.type === 'password' ? clicked : (list.length === 1 ? list[0] : null);
  const user = clicked.type === 'password' ? userFieldOf(scope, clicked) : clicked;
  return { username: !!user && visible(user), password: !!password && visible(password) };
} catch { return null; } })()`;

export type FieldProbe = { role: "username" | "password"; rect: { x: number; y: number; width: number; height: number } };
export type SubmitProbe = { kind: "username"; username: string } | { kind: "login"; username: string; password: string };

const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e6;
export function parseFieldProbe(v: unknown): FieldProbe | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { role?: unknown; rect?: { x?: unknown; y?: unknown; width?: unknown; height?: unknown } };
  if ((o.role !== "username" && o.role !== "password") || !o.rect) return null;
  const { x, y, width, height } = o.rect;
  if (![x, y, width, height].every(finite)) return null;
  return { role: o.role, rect: { x: x as number, y: y as number, width: width as number, height: height as number } };
}
export function parseSubmitProbe(v: unknown): SubmitProbe | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { kind?: unknown; username?: unknown; password?: unknown };
  if (typeof o.username !== "string" || o.username.length > 256 || /[\x00-\x1f\x7f]/.test(o.username)) return null;
  if (o.kind === "username") return o.username ? { kind: "username", username: o.username } : null;
  if (o.kind === "login" && typeof o.password === "string" && o.password.length > 0 && o.password.length <= 512) return { kind: "login", username: o.username, password: o.password };
  return null;
}
