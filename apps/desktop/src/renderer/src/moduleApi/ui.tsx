// The app's side of `@cutex-desktop/module-api/ui` (docs/desktop-modules.md §30): thin wrappers that pass on only the frozen
// public props, so a change to an app component's own props can never reach a module.
import type { MouseEvent, ReactNode } from "react";
import { PageBody, PageToolbar as AppPageToolbar } from "../components/Page";
import { btn } from "../components/Button";
import { HostPicker as AppHostPicker } from "../components/HostPicker";
import {
  EmptyState as AppEmptyState,
  ListRow as AppListRow,
  Loading as AppLoading,
  Notice as AppNotice,
  NumberField as AppNumberField,
  Section as AppSection,
  Segmented as AppSegmented,
  Select as AppSelect,
  SettingRow as AppSettingRow,
  TextField as AppTextField,
  TextInput as AppTextInput,
  Toggle as AppToggle,
} from "../components/settings/Form";
import { StatusIcon as AppStatusIcon } from "../components/StatusIcon";
import { openMenuAt, openMenuFrom, type MenuEntry as AppMenuEntry } from "../lib/contextMenu";
import { hostPickerMode } from "../lib/hostPick";
import { isHTMLElement } from "../lib/ownerWindow";
import { useHostScope } from "../lib/useHostScope";
import type { MenuEntry } from "@cutex-desktop/module-api";

export function Page({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return <PageBody aside={aside}>{children}</PageBody>;
}

export function PageToolbar({ children }: { children?: ReactNode }) {
  return <AppPageToolbar>{children}</AppPageToolbar>;
}

export function Section({ title, hint, actions, children }: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return <AppSection title={title} hint={hint} actions={actions}>{children}</AppSection>;
}

// A module's setting lives in its own prefs on this device and agents do not feel it.
export function SettingRow({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return <AppSettingRow label={label} hint={hint} agents="none" source="local">{children}</AppSettingRow>;
}

export function ListRow({ leading, title, detail, actions }: { leading?: ReactNode; title: ReactNode; detail?: ReactNode; actions?: ReactNode }) {
  return <AppListRow leading={leading} title={title} detail={detail} actions={actions} />;
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange(checked: boolean): void; disabled?: boolean; label?: string }) {
  return <AppToggle checked={checked} onChange={onChange} disabled={disabled} label={label} />;
}

export function Select<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: readonly { value: NoInfer<T>; label: string; disabled?: boolean }[]; onChange(value: NoInfer<T>): void; disabled?: boolean; label?: string }) {
  return <AppSelect value={value} options={[...options]} onChange={onChange} disabled={disabled} label={label} />;
}

export function Segmented<T extends string>({ value, options, onChange, disabled, label }: { value: T; options: readonly { value: NoInfer<T>; label: string; title?: string }[]; onChange(value: NoInfer<T>): void; disabled?: boolean; label?: string }) {
  return <AppSegmented value={value} options={[...options]} onChange={onChange} disabled={disabled} label={label} />;
}

export function TextInput({ value, onChange, placeholder, mono, disabled, maxLength, label }: { value: string; onChange(value: string): void; placeholder?: string; mono?: boolean; disabled?: boolean; maxLength?: number; label?: string }) {
  return <AppTextInput value={value} onChange={onChange} placeholder={placeholder} mono={mono} disabled={disabled} maxLength={maxLength} label={label} />;
}

export function TextField({ value, onCommit, placeholder, mono, disabled, maxLength, label }: { value: string; onCommit(value: string): void | Promise<unknown>; placeholder?: string; mono?: boolean; disabled?: boolean; maxLength?: number; label?: string }) {
  return <AppTextField value={value} onCommit={onCommit} placeholder={placeholder} mono={mono} disabled={disabled} maxLength={maxLength} label={label} />;
}

export function NumberField({ value, range, unit, step, slider, onCommit, disabled, label, placeholder }: { value: number | null; range: readonly [number, number]; unit?: string; step?: number; slider?: boolean; onCommit(value: number | null): void; disabled?: boolean; label?: string; placeholder?: string }) {
  return <AppNumberField value={value} range={range} unit={unit} step={step} slider={slider} onCommit={onCommit} disabled={disabled} label={label} placeholder={placeholder} />;
}

export function Button({ children, onClick, variant, size, danger, disabled, title }: { children: ReactNode; onClick?(event: MouseEvent<HTMLButtonElement>): void; variant?: "primary" | "secondary" | "ghost"; size?: "md" | "sm"; danger?: boolean; disabled?: boolean; title?: string }) {
  return <button type="button" onClick={onClick} disabled={disabled} title={title} className={btn({ variant, size, danger })}>{children}</button>;
}

export function IconButton({ label, children, onClick, variant = "ghost", size, danger, disabled }: { label: string; children: ReactNode; onClick?(event: MouseEvent<HTMLButtonElement>): void; variant?: "secondary" | "ghost"; size?: "md" | "sm"; danger?: boolean; disabled?: boolean }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className={btn({ variant, size, icon: true, danger })}>{children}</button>;
}

export function TrayButton({ label, children, text, onClick }: { label: string; children?: ReactNode; text?: string; onClick?(event: MouseEvent<HTMLButtonElement>): void }) {
  return (
    <button type="button" data-tray-item="" data-tray-text={text === undefined ? undefined : ""} className="tray-item" data-tip={label} aria-label={label} onClick={onClick}>
      {children}
      {text !== undefined && <span className="tray-item-text">{text}</span>}
    </button>
  );
}

// Styled like streamdown's Copy / Download beside it (modules/terminal/RunCodeButton).
export function CodeBlockButton({ label, children, onClick, disabled }: { label: string; children: ReactNode; onClick?(event: MouseEvent<HTMLButtonElement>): void; disabled?: boolean }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled} className="cursor-pointer rounded p-1 text-muted transition-all hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">{children}</button>;
}

export function StatusIcon({ kind, size }: { kind: "blocked" | "review" | "active" | "closed" | "error" | "starting" | "running" | "stopped"; size?: number }) {
  return <AppStatusIcon kind={kind} size={size} />;
}

export function HostPicker({ value, onChange, title }: { value: string; onChange(hostId: string): void; title: string }) {
  const scope = useHostScope();
  return <AppHostPicker value={value} onChange={onChange} title={title} mode={hostPickerMode(scope, value)} />;
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return <AppEmptyState action={action}>{children}</AppEmptyState>;
}

export function Notice({ children, tone }: { children: ReactNode; tone?: "warn" | "info" }) {
  return <AppNotice tone={tone}>{children}</AppNotice>;
}

export function Loading({ rows }: { rows?: number }) {
  return <AppLoading rows={rows} />;
}

export function openMenu(at: HTMLElement | { x: number; y: number }, entries: MenuEntry[]): void {
  const list = entries as AppMenuEntry[];
  if (isHTMLElement(at)) openMenuFrom(at, list);
  else openMenuAt(at.x, at.y, list);
}
