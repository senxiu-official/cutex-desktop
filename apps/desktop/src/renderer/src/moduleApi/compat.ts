// Compile-time check, no code: what the public package promises must fit what the app actually takes. A public item has to
// be a valid app item once the app's closed message keys read as `string`; the app's services have to provide the public
// ones. An app change that breaks a stable slot or service stops the typecheck here, not a module at load time.
import type { ComponentType, ReactNode } from "react";
import type * as Public from "@cutex-desktop/module-api";
import type { MessageKey } from "../i18n";
import type { ModuleContext, ModuleServices, SlotMap } from "../modules/slots";

/**
 * A shape in comparable form: closed message keys read as `string`; a component reads as the function of its props (the
 * class half of ComponentType would make a component taking fewer props not fit, though at run time it does). A menu row's
 * `onSelect` is left out: the public one is optional for a disabled row, and lib/contextMenu runAction takes both.
 */
type Norm<T> =
  [T] extends [MessageKey | null | undefined] ? string | Exclude<T, MessageKey>
  : T extends readonly (infer E)[] ? readonly Norm<E>[]
  : [T] extends [ReactNode] ? T
  : T extends ComponentType<infer P> ? (props: P) => unknown
  : T extends (...args: infer A) => infer R ? (...args: A) => Norm<R>
  : T extends object ? { [K in keyof T as K extends "onSelect" ? never : K]: Norm<T[K]> }
  : T;

type Fits<S extends Public.SlotId> = Norm<Public.SlotMap[S]> extends Norm<SlotMap[S]> ? true : { slot: S; publicItem: Norm<Public.SlotMap[S]>; appItem: Norm<SlotMap[S]> };

/** Every stable slot is one of the app's, and every public item fits it. */
export const slotsFit: { [S in Public.SlotId]: Fits<S> } = {
  "nav.primary": true,
  "main.page": true,
  "settings.page": true,
  "settings.section": true,
  "conversation.status": true,
  "timeline.codeBlockAction": true,
  "ref.action": true,
  "notify.method": true,
  "tray.entry": true,
  "identity.menu": true,
  "desktop.widget": true,
};

/** The app's services provide every public one. */
export const servicesFit = (app: ModuleServices): Public.ModuleServices => app;

/** A stable module gets the app's context. `prefs` is the same object: its public types take a module's own interfaces, and the run-time check is still finite JSON. */
export const contextFits = (app: ModuleContext): Omit<Public.ModuleContext, "contribute" | "t" | "prefs"> => app;
