// 新建浏览器身份 / 改名和颜色 (design browser-profiles v3 §3): a name, one of six theme colours and the initial on its
// mark. Main checks and stores it; a revision conflict shows the newest values and asks again. The default identity
// starts uncoloured and keeps that until the owner picks a colour.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useI18n, type MessageKey } from "../../i18n";
import { useOwnerDocument } from "../../lib/ownerContext";
import { isImeComposing } from "../../lib/ime";
import { btn } from "../../components/Button";
import { SettingsGroup } from "../../components/settings/Form";
import { BROWSER_IDENTITY_COLORS, type BrowserIdentityColor, type BrowserIdentityView } from "../../../../shared/browserIdentity";
import { identityById, identityRequest } from "./identities";
import { IdentityBadge } from "./IdentityBadge";

const code = (e: unknown): string => {
  const raw = e instanceof Error ? e.message : String(e);
  return /([a-z_]+)$/.exec(raw)?.[1] ?? raw;
};

export function IdentityEditDialog({ editing, onClose, onCreated }: { editing?: BrowserIdentityView; onClose(): void; onCreated?(view: BrowserIdentityView): void }) {
  const { t } = useI18n();
  const doc = useOwnerDocument();
  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState<BrowserIdentityColor | null>(editing ? editing.color : BROWSER_IDENTITY_COLORS[0]);
  const [initial, setInitial] = useState(editing?.initial ?? "");
  const [revision, setRevision] = useState(editing?.revision ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const trimmed = name.trim();
  const shownInitial = [...initial.trim()][0] || [...trimmed][0] || "";

  async function submit() {
    if (!trimmed || busy) return;
    setBusy(true); setError(null);
    try {
      if (editing) {
        const change: { name?: string; color?: BrowserIdentityColor; initial?: string } = {};
        if (trimmed !== editing.name) change.name = trimmed;
        if (color && color !== editing.color) change.color = color;
        if (shownInitial && shownInitial !== editing.initial) change.initial = shownInitial;
        if (Object.keys(change).length) await identityRequest((ids) => ids.update(editing.id, revision, change));
      } else {
        const view = await identityRequest((ids) => ids.create(trimmed, color ?? BROWSER_IDENTITY_COLORS[0]));
        onCreated?.(view);
      }
      onClose();
    } catch (e) {
      const c = code(e);
      if (editing && c === "revision_conflict") {
        const fresh = identityById(editing.id);
        if (fresh) { setName(fresh.name); setColor(fresh.color); setInitial(fresh.initial); setRevision(fresh.revision); }
        setError(t("browser.identity.edit.conflict"));
      } else setError(c);
    } finally { setBusy(false); }
  }

  const title = t(editing ? "browser.identity.edit.renameTitle" : "browser.identity.edit.title");
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/30 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} data-identity-dialog={editing ? "edit" : "new"}
        className="w-[24rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-4 shadow-2xl"
        onKeyDown={(e) => { if (e.key === "Escape" && !busy) onClose(); }}>
        <div className="flex items-center gap-2">
          <IdentityBadge view={{ name: trimmed, color, initial: shownInitial }} size={22} />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
          <button type="button" title={t("browser.identity.page.cancel")} aria-label={t("browser.identity.page.cancel")} disabled={busy} onClick={onClose}
            className="shrink-0 rounded-md p-1 text-subtle hover:bg-surface-2 hover:text-foreground disabled:opacity-50"><X size={15} /></button>
        </div>
        <SettingsGroup agents="none" source="local">
        <label className="mt-3 block text-xs text-muted">{t("browser.identity.edit.name")}
          <input ref={input} value={name} maxLength={40} placeholder={t("browser.identity.edit.namePlaceholder")} data-identity-name
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !isImeComposing(e)) void submit(); }}
            className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-accent" />
        </label>
        <div className="mt-3 text-xs text-muted">{t("browser.identity.edit.color")}</div>
        <div role="radiogroup" aria-label={t("browser.identity.edit.color")} className="mt-1 flex flex-wrap gap-1.5">
          {BROWSER_IDENTITY_COLORS.map((c) => {
            const label = t(`browser.identity.color.${c}` as MessageKey);
            return (
              <button key={c} type="button" role="radio" aria-checked={color === c} aria-label={label} title={label} data-identity-color={c} onClick={() => setColor(c)}
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 ${color === c ? "border-foreground" : "border-transparent hover:border-border"}`}>
                <span className="h-5 w-5 rounded-full" style={{ background: `var(--identity-${c})` }} />
              </button>
            );
          })}
        </div>
        {editing && (
          <label className="mt-3 block text-xs text-muted">{t("browser.identity.edit.initial")}
            <input value={initial} maxLength={2} onChange={(e) => setInitial(e.target.value)} data-identity-initial
              className="mt-1 block w-16 rounded-md border border-border bg-background px-2 py-1.5 text-center text-sm text-foreground outline-none focus:border-accent" />
          </label>
        )}
        </SettingsGroup>
        {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btn({ variant: "ghost", size: "sm" })} disabled={busy} onClick={onClose}>{t("browser.identity.page.cancel")}</button>
          <button type="button" className={btn({ variant: "primary", size: "sm" })} disabled={!trimmed || busy} onClick={() => void submit()} data-identity-submit>
            {t(editing ? "browser.identity.edit.save" : "browser.identity.edit.create")}
          </button>
        </div>
      </div>
    </div>,
    doc.body,
  );
}
