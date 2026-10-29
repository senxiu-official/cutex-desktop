// The three buttons of the visual language (docs/design/040 §2): primary (solid accent), secondary (`--surface-2` face)
// and ghost (a hover face only); 28 px high (`sm` 24), `rounded-ctl`; an icon button is the same height as a square.
// A destructive action is a secondary button with red text. `btn()` gives the class string for the places that need a
// plain <button> (menus, rows); `Button` / `IconButton` wrap it. The composer's send / stop pair keeps its own shape.
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "md" | "sm";

const BASE = "inline-flex shrink-0 items-center justify-center gap-1 rounded-ctl font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40";
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent hover:brightness-110 active:brightness-95",
  secondary: "bg-surface-2 text-foreground hover:bg-hover active:bg-pressed",
  ghost: "text-muted hover:bg-hover hover:text-foreground active:bg-pressed",
};
const SIZE: Record<ButtonSize, { text: string; icon: string }> = {
  md: { text: "h-7 px-3 text-ui", icon: "size-7" },
  sm: { text: "h-6 px-2 text-meta", icon: "size-6" },
};

export function btn({ variant = "secondary", size = "md", icon = false, danger = false }: { variant?: ButtonVariant; size?: ButtonSize; icon?: boolean; danger?: boolean } = {}): string {
  return `${btnShape({ size, icon })} ${btnFace({ variant, danger })}`;
}

/** The size / shape half of `btn()` (a click-twice ArmedButton keeps it and swaps only the face). */
export function btnShape({ size = "md", icon = false }: { size?: ButtonSize; icon?: boolean } = {}): string {
  return `${BASE} ${icon ? SIZE[size].icon : SIZE[size].text}`;
}

/** The colour half of `btn()`. */
export function btnFace({ variant = "secondary", danger = false }: { variant?: ButtonVariant; danger?: boolean } = {}): string {
  return `${VARIANT[variant]}${danger ? " text-danger hover:text-danger" : ""}`;
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize; danger?: boolean; children?: ReactNode };

export function Button({ variant, size, danger, className = "", type = "button", ...rest }: Props) {
  return <button type={type} {...rest} className={`${btn({ variant, size, danger })} ${className}`} />;
}

/** Square icon button; `label` is both the tooltip and the accessible name. */
export function IconBtn({ label, variant = "ghost", size, danger, className = "", type = "button", ...rest }: Props & { label: string }) {
  return <button type={type} title={label} aria-label={label} {...rest} className={`${btn({ variant, size, icon: true, danger })} ${className}`} />;
}
