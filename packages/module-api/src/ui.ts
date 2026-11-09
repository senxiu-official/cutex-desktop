// @cutex-desktop/module-api/ui: the app's own look, as components with frozen props.
// A new look for the app changes how these draw and never what you pass them.
import type { MouseEvent, ReactNode } from "react";
import type { MenuEntry } from "./slots";

/** A page's scrolling column, with the app's gutters and width. `aside`: a panel beside it when there is room. */
export declare function Page(props: { children: ReactNode; aside?: ReactNode }): ReactNode;
/** A row for filters and actions at the top of a page. */
export declare function PageToolbar(props: { children?: ReactNode }): ReactNode;
/** A titled card holding rows. */
export declare function Section(props: { title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children: ReactNode }): ReactNode;
/** One setting: label and hint on the left, its control on the right. In a Section. */
export declare function SettingRow(props: { label: ReactNode; hint?: ReactNode; children?: ReactNode }): ReactNode;
/** One thing in a list: a leading mark, a name, a grey line, actions on the right. In a Section. */
export declare function ListRow(props: { leading?: ReactNode; title: ReactNode; detail?: ReactNode; actions?: ReactNode }): ReactNode;
/** Applies at once. */
export declare function Toggle(props: { checked: boolean; onChange(checked: boolean): void; disabled?: boolean; label?: string }): ReactNode;
/** Applies at once. */
export declare function Select<T extends string>(props: { value: T; options: readonly { value: NoInfer<T>; label: string; disabled?: boolean }[]; onChange(value: NoInfer<T>): void; disabled?: boolean; label?: string }): ReactNode;
/** A short row of choices. Applies at once. */
export declare function Segmented<T extends string>(props: { value: T; options: readonly { value: NoInfer<T>; label: string; title?: string }[]; onChange(value: NoInfer<T>): void; disabled?: boolean; label?: string }): ReactNode;
/** Reports every keystroke. For a draft you save yourself. */
export declare function TextInput(props: { value: string; onChange(value: string): void; placeholder?: string; mono?: boolean; disabled?: boolean; maxLength?: number; label?: string }): ReactNode;
/** Applies on Enter or when it loses focus. */
export declare function TextField(props: { value: string; onCommit(value: string): void | Promise<unknown>; placeholder?: string; mono?: boolean; disabled?: boolean; maxLength?: number; label?: string }): ReactNode;
/** Applies on Enter or when it loses focus. `null` = emptied. */
export declare function NumberField(props: { value: number | null; range: readonly [number, number]; unit?: string; step?: number; slider?: boolean; onCommit(value: number | null): void; disabled?: boolean; label?: string; placeholder?: string }): ReactNode;
export declare function Button(props: { children: ReactNode; onClick?(event: MouseEvent<HTMLButtonElement>): void; variant?: "primary" | "secondary" | "ghost"; size?: "md" | "sm"; danger?: boolean; disabled?: boolean; title?: string }): ReactNode;
/** `label` is its tooltip and accessible name. `children` is the icon. */
export declare function IconButton(props: { label: string; children: ReactNode; onClick?(event: MouseEvent<HTMLButtonElement>): void; variant?: "secondary" | "ghost"; size?: "md" | "sm"; danger?: boolean; disabled?: boolean }): ReactNode;
/** A button that fits the tray (`tray.entry`). `children` is the icon. `text` is a short live value such as a countdown, up to about 6 characters: it goes after the icon and the button widens to fit. Give at least one of the two. */
export declare function TrayButton(props: { label: string; children?: ReactNode; text?: string; onClick?(event: MouseEvent<HTMLButtonElement>): void }): ReactNode;
/** A button that fits a code block's toolbar (`timeline.codeBlockAction`), beside its Copy and Download. `children` is a 14 px icon. */
export declare function CodeBlockButton(props: { label: string; children: ReactNode; onClick?(event: MouseEvent<HTMLButtonElement>): void; disabled?: boolean }): ReactNode;
/** A small state mark. */
export declare function StatusIcon(props: { kind: "blocked" | "review" | "active" | "closed" | "error" | "starting" | "running" | "stopped"; size?: number }): ReactNode;
/** Pick one of the owner's hosts; draws nothing with only one. Hosts that are not online cannot be picked. */
export declare function HostPicker(props: { value: string; onChange(hostId: string): void; title: string }): ReactNode;
/** A short line for an empty list, with an optional action. In a Section. */
export declare function EmptyState(props: { children: ReactNode; action?: ReactNode }): ReactNode;
/** A warning or a remark inside a card. */
export declare function Notice(props: { children: ReactNode; tone?: "warn" | "info" }): ReactNode;
/** Placeholder rows while something loads. */
export declare function Loading(props: { rows?: number }): ReactNode;
/** Opens the app's menu under an element, or at a point (for a right click). */
export declare function openMenu(at: HTMLElement | { x: number; y: number }, entries: MenuEntry[]): void;
