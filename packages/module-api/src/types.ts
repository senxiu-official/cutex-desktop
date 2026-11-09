// The neutral shapes every module sees. Nothing here names the app's own files: this package is all a module may import.
import type { ComponentType } from "react";

/** `^[a-z][a-z0-9-]{0,63}$`. Never changes once published: prefs and message keys are stored under it. */
export type ModuleId = string;
/** `<moduleId>.<name>`, unique within a slot. */
export type ItemId = `${string}.${string}`;
export type HostKind = "local" | "ssh";
export type HostPlatform = "windows" | "linux" | "macos";
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
/** Flat string params of a page; they live in memory only. */
export type PageParams = Readonly<Record<string, string | undefined>>;
/** A message key in your own catalog: `<moduleId>.<name>`. */
export type MessageKey = string;
/** Any `lucide-react` icon fits. */
export type Icon = ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

export interface ModuleRequires {
  /** Every one must be in the host's capability list. */
  capabilities?: readonly string[];
  /** Must be active; they activate first, and this module stops when one stops. */
  modules?: readonly ModuleId[];
  /** Omitted = any. */
  hostKinds?: readonly HostKind[];
  /** Only the focus host counts. Default: any connected host satisfying the rest activates the module. */
  focusHost?: boolean;
  /** An optional host component your pages need; the app shows a card to set it up instead of the page while it is missing. */
  component?: string;
}

export interface SlotItemBase {
  /** Must start with your module id and a dot. */
  id: ItemId;
  /** Ascending. The app's own items use multiples of 100. */
  order?: number;
  requires?: { capabilities?: readonly string[] };
  /** How the item shows while its requirements are not met. Each slot has its own default. */
  unavailable?: "hide" | "disable" | "notice";
}

/** `T` when it can be stored as JSON, so your own interfaces and arrays of them are fine; never for a function or the like. */
export type Jsonable<T> = T extends Json
  ? T
  : T extends ((...args: never[]) => unknown) | symbol | bigint | undefined
    ? never
    : T extends readonly (infer U)[]
      ? readonly Jsonable<U>[]
      : T extends object
        ? { [K in keyof T]: Jsonable<T[K]> }
        : never;

/** Your module's own settings, kept on this device. Removing the module keeps them. A property set to `undefined` throws: leave it out. */
export interface ModulePrefs {
  get<T>(key: string, fallback: T & Jsonable<T>): T;
  set<T>(key: string, value: T & Jsonable<T>): void;
  subscribe(listener: () => void): () => void;
}

export interface ModuleHostContext {
  readonly id: string;
  readonly kind: HostKind;
  /** Empty until the capabilities have loaded. */
  readonly features: ReadonlySet<string>;
}

export interface ModuleHostEntry extends ModuleHostContext {
  readonly featuresKnown: boolean;
  readonly focus: boolean;
  readonly inScope: boolean;
}

/** A live view of the connected hosts. Changes do not restart a module: subscribe. */
export interface ModuleHostsContext {
  /** Connected hosts, the focus host first. */
  list(): readonly ModuleHostEntry[];
  get(id: string): ModuleHostEntry | undefined;
  /** Ends with the module. */
  subscribe(listener: () => void): () => void;
}
