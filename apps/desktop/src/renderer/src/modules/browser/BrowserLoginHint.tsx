import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useI18n } from "../../i18n";
import { useTrackOverlay } from "../../lib/openOverlays";
import { btn } from "../../components/Button";
import { useOwnerWindow } from "../../lib/ownerContext";

interface Props { disabled: boolean; openOwner(): Promise<void>; dismiss(): Promise<void> }

/** A quiet pool label. The explanation is opened deliberately, never an always-on alert. */
export function BrowserLoginPoolPill({ disabled, openOwner }: Pick<Props, "disabled" | "openOwner">) {
  const win = useOwnerWindow();
  const { t } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [place, setPlace] = useState({ top: 0, left: 8 });
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const generation = useRef(0), busy = useRef(false);
  useTrackOverlay(open);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPlace({ top: Math.max(8, Math.min(rect.bottom + 6, win.innerHeight - (panel.current?.offsetHeight ?? 0) - 8)),
      left: Math.max(8, Math.min(rect.right - 288, win.innerWidth - 296)) });
    panel.current?.focus();
  }, [open, win]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    };
    const close = () => setOpen(false);
    const doc = win.document;
    doc.addEventListener("pointerdown", outside);
    doc.addEventListener("focusin", outside);
    win.addEventListener("keydown", key, true);
    win.addEventListener("resize", close);
    win.addEventListener("blur", close);
    return () => {
      doc.removeEventListener("pointerdown", outside); doc.removeEventListener("focusin", outside);
      win.removeEventListener("keydown", key, true); win.removeEventListener("resize", close); win.removeEventListener("blur", close);
    };
  }, [open, win]);
  async function openInOwner() {
    if (busy.current || disabled) return;
    busy.current = true;
    const token = ++generation.current;
    setPending(true); setFailed(false);
    try { await openOwner(); if (generation.current === token) setOpen(false); }
    catch { if (generation.current === token) setFailed(true); }
    finally { busy.current = false; if (generation.current === token) setPending(false); }
  }
  return <>
    <button ref={trigger} type="button" data-browser-login-pool aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { setFailed(false); setOpen(value => !value); }}
      className="flex h-6 min-w-0 shrink items-center gap-1 rounded-full bg-surface-2 px-2 text-caption text-muted hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent">
      <span className="truncate">{t("browser.login.poolLabel")}</span><Info size={13} aria-hidden="true" className="shrink-0" />
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-modal="false" aria-label={t("browser.login.poolTitle")} tabIndex={-1}
      data-popover="" data-browser-login-explanation style={place}
      className="float fixed z-[160] max-h-[calc(100vh-16px)] w-72 max-w-[calc(100vw-16px)] overflow-y-auto p-3 text-xs text-muted outline-none">
      <p className="mb-1 font-medium text-foreground">{t("browser.login.poolTitle")}</p>
      <p className="mb-3 leading-relaxed">{t("browser.login.poolHint")}</p>
      <button type="button" className={btn()} disabled={disabled || pending} onClick={() => void openInOwner()}>{t("browser.login.openOwner")}</button>
      {failed && <p role="alert" className="mt-2 text-danger">{t("browser.login.failed")}</p>}
    </div>, win.document.body)}
  </>;
}

/** Only mounted for the current origin after main reports login input. Dismissal lives in main. */
export function BrowserLoginWarning({ disabled, openOwner, dismiss }: Props) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  const active = useRef(true), busy = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function run(action: () => Promise<void>) {
    if (disabled || busy.current) return;
    busy.current = true; setPending(true); setFailed(false);
    try { await action(); } catch { if (active.current) setFailed(true); }
    finally { busy.current = false; if (active.current) setPending(false); }
  }
  return <div data-browser-login-warning role="status" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-surface-2 px-3 py-1.5 text-xs text-muted">
    <span className="min-w-0 flex-1">{t("browser.login.warning")}</span>
    <button type="button" disabled={disabled || pending} className="shrink-0 text-accent underline-offset-2 hover:underline disabled:opacity-40" onClick={() => void run(openOwner)}>{t("browser.login.openOwner")}</button>
    <button type="button" disabled={disabled || pending} className="shrink-0 hover:text-foreground disabled:opacity-40" onClick={() => void run(dismiss)}>{t("browser.login.dismiss")}</button>
    {failed && <span role="alert" className="text-danger">{t("browser.login.failed")}</span>}
  </div>;
}
