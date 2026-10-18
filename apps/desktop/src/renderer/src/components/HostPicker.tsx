// Host choice of create forms (new agent / project) and of host settings pages (multi-host P1 step 2c;
// RFC §9.2, §9.3): `⊞ ● name ⌄` with the switcher's row look. Hosts that are not online are listed
// greyed with their status and cannot be picked. Which mode to show and the defaults: lib/hostPick.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Layers } from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { canTargetHost, type HostPickerMode } from "../lib/hostPick";
import type { HostLook } from "../lib/hostScope";
import { useTrackOverlay } from "../lib/openOverlays";
import { useHostScope } from "../lib/useHostScope";
import { HostDot, HostPlatformIcon } from "./HostMark";
import { ScriptText } from "./ScriptText";

function HostFace({ host }: { host: HostLook }) {
  const { t } = useI18n();
  return (
    <>
      <HostPlatformIcon platform={host.platform} className="text-muted" />
      <HostDot color={host.color} status={host.indicator.status} />
      <span className="min-w-0 truncate">
        <ScriptText text={host.label} />
        {host.local && <span className="text-subtle"> · {t("titlebar.local")}</span>}
      </span>
    </>
  );
}

/**
 * `mode` from lib/hostPick `hostPickerMode` ("none" renders nothing). `title` = what the choice means
 * (tooltip); the menu lists every configured host in switcher order.
 */
/** `up`: the list opens above the trigger (a picker at the bottom of the window, e.g. under an input). */
/**
 * `chip`: the right half of a scope tag (settings: 「cutex 后端 · ● HOST-A ▾」, owner 2026-10-18 Q2b) —
 * chip-sized, host colour dot and name only.
 * `all`: a first row 「全部主机」 (a settings page that can show every host at once; lib/settingsAllHosts).
 * While `all.selected` the trigger shows it; picking a host (also `value`) calls `onChange`.
 * `only`: list just these hosts (e.g. the ones a 「全部主机」 view includes).
 */
export function HostPicker({ value, onChange, mode, title, prefix = false, up = false, only, all, chip = false }: { value: string; onChange(hostId: string): void; mode: HostPickerMode; title: string; prefix?: boolean; up?: boolean; only?: readonly string[]; all?: { label: string; hint?: string; selected: boolean; onSelect(): void }; chip?: boolean }) {
  const { t } = useI18n();
  const scope = useHostScope();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useTrackOverlay(open);
  const current = scope.host(value);
  const hosts = only ? scope.hosts.filter((h) => only.includes(h.id)) : scope.hosts;
  useEffect(() => {
    if (!open) return;
    setCursor(all?.selected ? -1 : Math.max(0, hosts.findIndex((h) => h.id === value)));
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (mode === "none" || !current) return null;
  const label = prefix && <span className="shrink-0 text-subtle">{t("hostPicker.label")}：</span>;
  const chipFace = (
    <>
      <HostDot color={current.color} status={current.indicator.status} size={6} />
      <span className="min-w-0 truncate">
        <ScriptText text={current.label} />
      </span>
    </>
  );
  if (mode === "label" && chip)
    return (
      <span title={title} className="inline-flex h-5 max-w-48 items-center gap-1 rounded-r bg-accent/12 pr-1.5 text-[11px] text-accent">
        {chipFace}
      </span>
    );
  if (mode === "label")
    return (
      <span title={title} className="inline-flex h-6 items-center gap-1.5 text-[13px]">
        {label}
        <HostFace host={current} />
      </span>
    );
  const pick = (h: HostLook | undefined) => {
    if (!h || !canTargetHost(h)) return;
    setOpen(false);
    if (h.id !== value || all?.selected) onChange(h.id);
  };
  const pickAll = () => {
    setOpen(false);
    if (!all?.selected) all?.onSelect();
  };
  const first = all ? -1 : 0;
  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") (e.preventDefault(), setOpen(true));
      return;
    }
    if (e.key === "Escape") (e.preventDefault(), e.stopPropagation(), setOpen(false));
    else if (e.key === "Enter") (e.preventDefault(), cursor < 0 ? pickAll() : pick(hosts[cursor]));
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      for (let i = cursor + step; i >= first && i < hosts.length; i += step) if (i < 0 || canTargetHost(hosts[i]!)) return setCursor(i);
    }
  };
  const status = (h: HostLook) => (h.indicator.status === "online" ? null : t(`host.status.${h.indicator.status}` as MessageKey));
  return (
    <div ref={ref} className="relative inline-flex" onKeyDown={onKey}>
      <button
        type="button"
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={
          chip
            ? `inline-flex h-5 max-w-48 items-center gap-1 rounded-r bg-accent/12 pr-1.5 text-[11px] text-accent hover:brightness-125 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none ${open ? "brightness-125" : ""}`
            : `inline-flex h-7 max-w-64 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-[13px] hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:outline-none ${open ? "bg-surface-2" : ""}`
        }
      >
        {label}
        {all?.selected ? (
          <>
            <Layers size={13} className="shrink-0 text-muted" />
            <span className="min-w-0 truncate">{all.label}</span>
          </>
        ) : chip ? (
          chipFace
        ) : (
          <>
            <HostFace host={current} />
            {status(current) && <span className="shrink-0 text-xs text-subtle">{status(current)}</span>}
          </>
        )}
        <ChevronDown size={chip ? 11 : 13} className={`shrink-0 ${chip ? "" : "text-subtle"}`} />
      </button>
      {open && (
        <div role="listbox" aria-label={title} className={`absolute ${up ? "bottom-full mb-1" : "top-full mt-1"} left-0 z-40 max-h-80 min-w-64 overflow-y-auto rounded-xl border border-border bg-surface p-1 shadow-xl`}>
          {all && (
            <button
              type="button"
              role="option"
              aria-selected={all.selected}
              onMouseEnter={() => setCursor(-1)}
              onClick={pickAll}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${cursor === -1 ? "bg-surface-2" : ""}`}
            >
              <Layers size={14} className="shrink-0 text-muted" />
              <span className="min-w-0 truncate">{all.label}</span>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-xs text-subtle">
                {all.hint}
                <span className="w-3.5 text-accent">{all.selected && <Check size={13} />}</span>
              </span>
            </button>
          )}
          {hosts.map((h, i) => {
            const enabled = canTargetHost(h);
            return (
              <button
                key={h.id}
                type="button"
                role="option"
                aria-selected={h.id === value && !all?.selected}
                disabled={!enabled}
                onMouseEnter={() => enabled && setCursor(i)}
                onClick={() => pick(h)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm disabled:opacity-50 ${i === cursor && enabled ? "bg-surface-2" : ""}`}
              >
                <HostFace host={h} />
                <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-xs text-subtle">
                  {status(h) ?? (!h.inScope && t("hostPicker.outOfScope"))}
                  <span className="w-3.5 text-accent">{h.id === value && !all?.selected && <Check size={13} />}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
